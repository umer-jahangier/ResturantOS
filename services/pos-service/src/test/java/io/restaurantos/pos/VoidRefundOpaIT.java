package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.authz.OpaInput;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class VoidRefundOpaIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
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

        // Stub Finance period as OPEN (needed for closeViaServeAndPay in refund tests)
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        // Set up security context with cashier principal
        setSecurityContext(cashierId, List.of("pos.order.void.own"), Map.of());

        // Financial-integrity guard: every order here is created by the cashier before being
        // voided/refunded, which now requires an OPEN till for that cashier.
        openTillForCashier(branchId);
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
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        return closeViaServeAndPay(orderService, paymentService, order, branchId);
    }

    // ── Discount override / split bill (phase 18b) ────────────────────────────

    /**
     * {@code pos.rego}'s {@code pos.order.discount.override} rule, a dead letter until phase 18b.
     *
     * <p>Bound to ORDER-scope discounts only. {@code pos.order.discount.override} is held by the
     * same roles as {@code pos.order.discount.order} (OWNER, MANAGER, TENANT_ADMIN) and NOT by
     * CASHIER, who holds {@code pos.order.discount.line} — so gating every discount on it would have
     * withdrawn a working capability from cashiers. {@link #lineScopeDiscount_doesNotConsultThePolicy}
     * is the guard on that boundary.
     */
    @Test
    void orderScopeDiscount_deniedByOpa_isRefused() {
        OrderDto order = createOpenOrder();
        setSecurityContext(cashierId, List.of("pos.order.discount.override"), Map.of());
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(false));

        assertThatThrownBy(() -> orderService.applyDiscount(order.id(),
                new ApplyDiscountRequest("ORDER", null, "FLAT", BigDecimal.TEN)))
                .isInstanceOf(PermissionDeniedException.class);

        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        assertThat(captor.getValue().action())
                .as("must evaluate the discount-override rule, not some other pos action")
                .isEqualTo("pos.order.discount.override");
        assertThat(captor.getValue().resource().branchId())
                .as("the ORDER's branch, not the caller's — passing the caller's own branch would "
                        + "compare it against itself and enforce nothing")
                .isEqualTo(branchId);
    }

    @Test
    void orderScopeDiscount_allowedByOpa_isApplied() {
        OrderDto order = createOpenOrder();
        setSecurityContext(cashierId, List.of("pos.order.discount.override"), Map.of());
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        assertThat(orderService.applyDiscount(order.id(),
                new ApplyDiscountRequest("ORDER", null, "FLAT", BigDecimal.TEN)))
                .isNotNull();
    }

    /**
     * The behaviour-preservation guard. A cashier applying a LINE discount must not be sent to the
     * override rule — if this starts failing, the gate has been widened past the roles that hold
     * {@code pos.order.discount.override} and cashiers have silently lost line discounts.
     */
    @Test
    void lineScopeDiscount_doesNotConsultThePolicy() {
        OrderDto order = createOpenOrder();
        OrderDto withItem = orderService.getOrder(order.id(), branchId);
        UUID lineId = withItem.items().get(0).id();
        setSecurityContext(cashierId, List.of("pos.order.discount.line"), Map.of());
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(false));

        assertThat(orderService.applyDiscount(order.id(),
                new ApplyDiscountRequest("LINE", lineId, "FLAT", BigDecimal.ONE)))
                .isNotNull();

        verify(opaClient, never()).evaluate(eq("pos"), any());
    }

    // ── Void tests ────────────────────────────────────────────────────────────

    @Test
    void cashier_voids_own_OPEN_order_withOpaAllow_succeeds() {
        OrderDto order = createOpenOrder();

        // OPA allows: cashier has void.own, order is OPEN, they're the creator
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        OrderDto voided = orderService.voidOrder(order.id(), new VoidOrderRequest("Customer left"), UUID.randomUUID().toString());
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);

        ArgumentCaptor<OpaInput> captor = ArgumentCaptor.forClass(OpaInput.class);
        verify(opaClient).evaluate(eq("pos"), captor.capture());
        assertThat(captor.getValue().resource().createdBy()).isEqualTo(cashierId);

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

        // S0-01: this used to refund 5000 of an 8000 bill while calling the scope "FULL", and
        // asserted the order went REFUNDED — i.e. it pinned a terminal, un-refundable order with
        // 3000 paisa of the customer's money never returned. "Full" is now DERIVED from money
        // taken vs money given back, so a full reversal is the bill's own 8000.
        OrderDto refunded = refundService.refund(closed.id(),
                new RefundRequest(closed.totalPaisa(), "Item defective", "FULL"),
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
