package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.pos.service.SplitTenderCalculator;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

class VoidRefundOpaIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired RefundService refundService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Drinks-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Chai");
        item.setBasePricePaisa(8000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        // Stub Finance period as OPEN (needed for closeOrder in refund tests)
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        // Set up security context with cashier principal
        setSecurityContext(cashierId, List.of("pos.order.void.own"), Map.of());
    }

    private void setSecurityContext(UUID userId, List<String> permissions, Map<String, Object> attributes) {
        JwtClaims claims = new JwtClaims(
                userId, tenantId, branchId,
                List.of("CASHIER"), permissions, attributes, null);
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(claims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);
    }

    private OrderDto createOpenOrder() {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    private OrderDto createClosedOrder() {
        OrderDto order = createOpenOrder();
        var payments = List.of(new SplitTenderCalculator.PaymentEntry("CASH", order.totalPaisa(), null));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        return orderService.closeOrder(order.id(), new CloseOrderRequest(payments), UUID.randomUUID().toString());
    }

    // ── Void tests ────────────────────────────────────────────────────────────

    @Test
    void cashier_voids_own_OPEN_order_withOpaAllow_succeeds() {
        OrderDto order = createOpenOrder();

        // OPA allows: cashier has void.own, order is OPEN, they're the creator
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        OrderDto voided = orderService.voidOrder(order.id(), new VoidOrderRequest("Customer left"), UUID.randomUUID().toString());
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);

        long voidedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count();
        assertThat(voidedEvents).isEqualTo(1);
    }

    @Test
    void cashier_voids_another_users_order_withOpaDeny_returns403() {
        OrderDto order = createOpenOrder();

        // OPA denies: cashier doesn't have void.any
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() ->
                orderService.voidOrder(order.id(), new VoidOrderRequest("Test"), UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class);

        // No ORDER_VOIDED event
        long voidedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count();
        assertThat(voidedEvents).isEqualTo(0);
    }

    @Test
    void manager_uses_void_any_withOpaAllow_succeeds() {
        // Create order as cashier
        OrderDto order = createOpenOrder();

        // Switch to manager context
        UUID managerId = UUID.randomUUID();
        setSecurityContext(managerId, List.of("pos.order.void.any"), Map.of());
        tenantContext.set(tenantId, branchId, managerId, null);

        // OPA allows: manager has void.any
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        OrderDto voided = orderService.voidOrder(order.id(), new VoidOrderRequest("Manager override"), UUID.randomUUID().toString());
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);
    }

    @Test
    void idempotent_void_replay_produces_single_ORDER_VOIDED_event() {
        OrderDto order = createOpenOrder();

        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        String idempotencyKey = UUID.randomUUID().toString();
        OrderDto first = orderService.voidOrder(order.id(), new VoidOrderRequest("Duplicate test"), idempotencyKey);
        OrderDto second = orderService.voidOrder(order.id(), new VoidOrderRequest("Duplicate test"), idempotencyKey);

        assertThat(first.status()).isEqualTo(OrderStatus.VOIDED);
        assertThat(second.status()).isEqualTo(OrderStatus.VOIDED);

        long voidedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count();
        assertThat(voidedEvents).isEqualTo(1);
    }

    // ── Refund tests ──────────────────────────────────────────────────────────

    @Test
    void refund_within_approval_limit_succeeds_and_publishes_ORDER_REFUNDED() {
        // Close the order first
        OrderDto closed = createClosedOrder();
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        outboxRepository.deleteAll();

        // OPA allows refund: within approval limit
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));
        setSecurityContext(cashierId, List.of("pos.order.refund"), Map.of("approval_limit_paisa", 10000));

        OrderDto refunded = refundService.refund(closed.id(),
                new RefundRequest(5000L, "Item defective", "FULL"),
                UUID.randomUUID().toString());
        assertThat(refunded.status()).isEqualTo(OrderStatus.REFUNDED);

        long refundedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_REFUNDED".equals(e.getEventType()))
                .count();
        assertThat(refundedEvents).isEqualTo(1);
    }

    @Test
    void refund_over_approval_limit_withOpaDeny_returns403() {
        OrderDto closed = createClosedOrder();

        outboxRepository.deleteAll();

        // OPA denies: over limit
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(false));
        setSecurityContext(cashierId, List.of("pos.order.refund"), Map.of("approval_limit_paisa", 1000));

        assertThatThrownBy(() ->
                refundService.refund(closed.id(),
                        new RefundRequest(15000L, "Over limit", "FULL"),
                        UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class);

        long refundedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_REFUNDED".equals(e.getEventType()))
                .count();
        assertThat(refundedEvents).isEqualTo(0);
    }
}
