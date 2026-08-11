package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.api.ApiResponse;
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
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Plan 13-16 (D-30): the till requirement moved from order creation to cash settlement, and this
 * is the half that makes the move a TIGHTENING rather than a relaxation.
 *
 * <p>Before this plan {@code PaymentServiceImpl.recordPayment} only backfilled the till
 * best-effort ({@code .ifPresent(...)}), so a CASH payment taken by a user with no open till was
 * accepted and the order stayed unlinked — invisible to {@code TillServiceImpl.closeTill}'s
 * expected-closing sum, which is exactly the "charged but the till shows 0" reconciliation gap.
 * Now a CASH tender without an OPEN till for the PAYING user is refused outright.
 *
 * <p>Deliberately scoped to CASH: card and wallet tenders never pass through the drawer, and
 * requiring a till for them would break the counter-less flows this phase enables. That scope is
 * pinned by {@link #cardPayment_withNoTill_isAccepted_andLeavesTillNull} rather than by a comment.
 */
class CashPaymentRequiresTillIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired TillService tillService;
    @Autowired OrderRepository orderRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID waiterId;
    UUID menuItemId;

    static final long ITEM_PRICE_PAISA = 20000L;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        waiterId = UUID.randomUUID();
        // `pos.till.open` / `pos.till.close`, not the `pos.till.manage` this used to name — that
        // code is in no catalogue and on no role. It never made the test fail, because
        // TillService is called directly here and consults no permission, but a fixture that
        // claims to be a cashier has to be made of codes a cashier actually holds; otherwise the
        // day a gate is added at this seam the failure arrives with a misleading cause.
        actAs(cashierId, List.of(
                "pos.order.create", "pos.order.send_to_kds", "pos.till.open", "pos.till.close"));

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Karahi");
        item.setBasePricePaisa(ITEM_PRICE_PAISA);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        // Finance period OPEN — precondition for maybeCloseOrder's Paid-AND-Served close.
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    // ── Accepted: the paying user has an OPEN till ───────────────────────────────────────────

    @Test
    void cashPayment_byCashierWithOpenTill_isAccepted_andOrderBoundToThatTill() {
        // Counter service, unchanged from before this plan: the till is open BEFORE the order is
        // taken, so the binding happens at creation and settlement simply confirms it.
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 50000L));

        OrderDto served = createServedOrder();
        assertThat(orderRepository.findById(served.id()).orElseThrow().getTillSessionId())
                .isEqualTo(till.id());

        paymentService.recordPayment(served.id(), PaymentMethod.CASH, served.totalPaisa(), null);

        Order settled = orderRepository.findById(served.id()).orElseThrow();
        assertThat(settled.getStatus()).isEqualTo(OrderStatus.CLOSED);
        assertThat(settled.getTillSessionId()).isEqualTo(till.id());
    }

    @Test
    void cashPayment_onWaiterOrder_backfillsPayingCashiersTill() {
        // The waiter path this phase enables: order created with no till at all, settled by a
        // cashier who does have one. The cash must land in the SETTLING cashier's drawer.
        actAs(waiterId, List.of("pos.order.create", "pos.order.send_to_kds"));
        OrderDto served = createServedOrder();
        assertThat(orderRepository.findById(served.id()).orElseThrow().getTillSessionId()).isNull();

        actAs(cashierId, List.of("pos.till.open", "pos.till.close"));
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 50000L));

        paymentService.recordPayment(served.id(), PaymentMethod.CASH, served.totalPaisa(), null);

        Order settled = orderRepository.findById(served.id()).orElseThrow();
        assertThat(settled.getStatus()).isEqualTo(OrderStatus.CLOSED);
        assertThat(settled.getTillSessionId()).isEqualTo(till.id());
        // The waiter remains the order's originator; only the till moved.
        assertThat(settled.getCashierId()).isEqualTo(waiterId);
    }

    // ── Refused: no OPEN till for the paying user ────────────────────────────────────────────

    // GUIDE-CLAIM: FIN-GUIDE-0001 — "Settling in cash needs an open till; settling by card does
    // not." This test and cardPayment_withNoTill_isAccepted_andLeavesTillNull below are the two
    // halves the finance guide's sentence rests on. Do not disable either without deleting the
    // claim from frontend/lib/finance/guide/claims.json; `make verify-guide-claims` enforces it.
    @Test
    void cashPayment_withNoTillAtAll_isRefused_andNothingIsApplied() {
        OrderDto served = createServedOrder();

        assertThatThrownBy(() ->
                paymentService.recordPayment(served.id(), PaymentMethod.CASH, served.totalPaisa(), null))
                .isInstanceOf(PosExceptions.NoOpenTillException.class);

        // The refusal must be total: no payment row, order not closed, till still null.
        assertThat(paymentService.listPayments(served.id())).isEmpty();
        Order after = orderRepository.findById(served.id()).orElseThrow();
        assertThat(after.getStatus()).isNotEqualTo(OrderStatus.CLOSED);
        assertThat(after.getTillSessionId()).isNull();
    }

    @Test
    void cashPayment_whenOnlyTillSessionIsClosed_isRefused() {
        // The case a naive findByCashierId (no status filter) would wrongly admit: the cashier HAS
        // a till session, it is simply CLOSED. Cash into a closed drawer can never be reconciled.
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 50000L));
        tillService.closeTill(till.id(), new CloseTillRequest(50000L, "end of shift"));

        OrderDto served = createServedOrder();
        assertThat(orderRepository.findById(served.id()).orElseThrow().getTillSessionId()).isNull();

        assertThatThrownBy(() ->
                paymentService.recordPayment(served.id(), PaymentMethod.CASH, served.totalPaisa(), null))
                .isInstanceOf(PosExceptions.NoOpenTillException.class);

        assertThat(orderRepository.findById(served.id()).orElseThrow().getTillSessionId()).isNull();
    }

    // ── Scope: non-cash tenders are unaffected ───────────────────────────────────────────────

    @Test
    void cardPayment_withNoTill_isAccepted_andLeavesTillNull() {
        OrderDto served = createServedOrder();

        paymentService.recordPayment(served.id(), PaymentMethod.CARD, served.totalPaisa(), "card-ref-1");

        Order settled = orderRepository.findById(served.id()).orElseThrow();
        assertThat(settled.getStatus()).isEqualTo(OrderStatus.CLOSED);
        // A card tender does not pass through the drawer, so it neither requires nor creates a
        // till link. Widening the CASH rule to non-cash would break counter-less service.
        assertThat(settled.getTillSessionId()).isNull();
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────────────────────

    private OrderDto createServedOrder() {
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        return orderService.markItemServed(sent.id(), sent.items().get(0).id());
    }

    /** Sets BOTH TenantContext (till/cashier resolution) and the Spring SecurityContext
     *  (service-layer permission gates) — see StationAdminIT.authenticateAs. */
    private void actAs(UUID userId, List<String> permissions) {
        tenantContext.set(tenantId, branchId, userId, null);
        JwtClaims claims = new JwtClaims(
                userId, tenantId, branchId, List.of("OWNER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
