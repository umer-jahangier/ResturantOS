package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * A void or refund reason is operator free text — {@code VoidOrderRequest}/{@code RefundRequest}
 * cap it at {@code @Size(max = 500)} and the POS dialog's textarea at {@code maxLength={500}}.
 * Both reasons were being handed to {@code IdempotencyService.checkAndLock} as the
 * {@code requestHash} argument, which {@code DefaultIdempotencyService} stored VERBATIM into
 * {@code idempotency_keys.request_hash VARCHAR(64)}. Any reason longer than 64 characters —
 * i.e. any ordinary explanatory sentence — aborted the insert with Postgres
 * {@code 22001 string_data_right_truncation}, so the operator got a 500 and the check was never
 * voided.
 *
 * These tests run against the real Flyway schema on a real Postgres (see {@link PosTestBase}),
 * so the 64-char column is genuinely enforced — a schema regenerated from the JPA annotations
 * would not reproduce the failure. Tests (1) and (2) fail with a DataIntegrityViolationException
 * before the fix. Test (3) pins the idempotency semantics the fix must not trade away: digesting
 * the payload still has to dedupe a replay.
 */
class LongFreeTextReasonIT extends PosTestBase {

    /**
     * 200 characters — comfortably inside the DTO's 500-char contract and the shape of a real
     * shift-note, but more than triple the 64-char idempotency column.
     */
    private static final String LONG_REASON =
            "Table walked out during the kitchen delay on the biryani order; duty manager "
            + "authorised the clear-down after confirming with the floor supervisor that no "
            + "items had been fired and nothing was tendered.";

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired RefundService refundService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        assertThat(LONG_REASON).hasSize(200);

        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Biryani");
        item.setBasePricePaisa(45000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        setSecurityContext(cashierId, List.of("pos.order.void.own", "pos.order.refund"));
        openTillForCashier(branchId);
    }

    private void setSecurityContext(UUID userId, List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                userId, tenantId, branchId,
                List.of("CASHIER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private OrderDto createOpenOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    private OrderDto createClosedOrder() {
        OrderDto order = createOpenOrder();
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        return closeViaServeAndPay(orderService, paymentService, order, branchId);
    }

    // ── (1) the reported defect: a normal explanatory sentence must void the check ──────────

    @Test
    void void_withReasonLongerThanIdempotencyColumn_succeeds() {
        OrderDto order = createOpenOrder();
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        OrderDto voided = orderService.voidOrder(
                order.id(), new VoidOrderRequest(LONG_REASON), UUID.randomUUID().toString());

        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);
        // The reason itself belongs on the order, in full — only the idempotency fingerprint
        // is bounded. Truncating the operator's note would be a different bug, not a fix.
        assertThat(orderRepository.findById(order.id()).orElseThrow().getVoidReason())
                .isEqualTo(LONG_REASON);

        long voidedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count();
        assertThat(voidedEvents).isEqualTo(1);
    }

    // ── (2) the sibling defect: refund concatenates reason + amount into the same column ────

    @Test
    void refund_withReasonLongerThanIdempotencyColumn_succeeds() {
        OrderDto closed = createClosedOrder();
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);
        outboxRepository.deleteAll();

        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        OrderDto refunded = refundService.refund(
                closed.id(),
                new RefundRequest(closed.totalPaisa(), LONG_REASON, "FULL"),
                UUID.randomUUID().toString());

        assertThat(refunded.status()).isEqualTo(OrderStatus.REFUNDED);
    }

    // ── (3) dedupe still works when the payload is digested rather than stored raw ──────────

    @Test
    void void_replayedWithSameKeyAndSameLongReason_isDeduped() {
        OrderDto order = createOpenOrder();
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        String idempotencyKey = UUID.randomUUID().toString();
        OrderDto first = orderService.voidOrder(
                order.id(), new VoidOrderRequest(LONG_REASON), idempotencyKey);
        OrderDto second = orderService.voidOrder(
                order.id(), new VoidOrderRequest(LONG_REASON), idempotencyKey);

        assertThat(first.status()).isEqualTo(OrderStatus.VOIDED);
        assertThat(second.status()).isEqualTo(OrderStatus.VOIDED);

        long voidedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_VOIDED".equals(e.getEventType()))
                .count();
        assertThat(voidedEvents).isEqualTo(1);
    }

    // Conflict detection for a key reused with a DIFFERENT long reason is deliberately not
    // asserted here: voidOrder consults getCompletedResponse first and returns the stored
    // result before checkAndLock is ever reached, so the conflict branch is unreachable from
    // this layer once the key is COMPLETED. That semantic is pinned directly against
    // IdempotencyService in shared-lib's SharedLibVerificationIT.
}
