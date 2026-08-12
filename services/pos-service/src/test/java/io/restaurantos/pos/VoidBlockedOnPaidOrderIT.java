package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.StateInvalidException;
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
 * S0-01 — <b>a void must never outrun a payment.</b>
 *
 * <p>The defect this pins: {@code POST /pos/orders/{id}/void} returned 200 on an order that had
 * been paid in full, the order vanished from every operator screen, and its {@code order_payments}
 * row stayed live in the database with no reversing entry. Refund — the operation that DOES write
 * a reversal — was gated on {@code status == CLOSED}, and a paid-but-unserved check is
 * {@code SENT_TO_KDS}, never CLOSED. So the destructive control was the only reachable one.
 *
 * <p>Every assertion here is on state read back from Postgres through the service seams the HTTP
 * controllers delegate to (the 07.2-05 direct-service-call IT convention), never on a mock.
 *
 * <p><b>Falsification.</b> Revert any ONE of the three gates and a named test below fails:
 * <ul>
 *   <li>drop the payment check in {@code OrderServiceImpl.voidOrder} ->
 *       {@link #voidOnPaidOrder_isRefused_andTheOrderAndItsPaymentAreLeftUntouched} fails on a
 *       void that returns VOIDED;</li>
 *   <li>revert {@code OrderStateMachine} to {@code CLOSED -> REFUNDED} only ->
 *       {@link #fullRefundOnPaidUnservedOrder_reachesRefunded_andWritesAReversingRow} fails with
 *       "Illegal order transition: SENT_TO_KDS -> REFUNDED";</li>
 *   <li>restore {@code RefundServiceImpl}'s {@code status != CLOSED -> 409} -> the same test
 *       fails with "Refund only allowed on CLOSED orders".</li>
 * </ul>
 */
class VoidBlockedOnPaidOrderIT extends PosTestBase {

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
    static final long ITEM_PRICE_PAISA = 168200L; // the register's Rs 1,682.00, to the paisa

    @BeforeEach
    void setUp() {
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
        item.setName("Chicken Karahi");
        item.setBasePricePaisa(ITEM_PRICE_PAISA);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId, List.of("MANAGER"),
                List.of("pos.order.void.own", "pos.order.void.any", "pos.order.refund"),
                Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));

        openTillForCashier(branchId);
    }

    /** The exact shape from the register: ring one item, fire it, take the cash. Stays SENT_TO_KDS. */
    private OrderDto paidUnservedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        paymentService.recordPayment(sent.id(), PaymentMethod.CASH, sent.totalPaisa(), "cash-1");
        OrderDto reread = orderService.getOrder(sent.id(), branchId);
        assertThat(reread.status())
                .as("the register's precondition: fully paid, and NOT closed — CLOSED needs Served too")
                .isEqualTo(OrderStatus.SENT_TO_KDS);
        return reread;
    }

    private long netPaisa(List<OrderPaymentDto> rows) {
        return rows.stream().mapToLong(OrderPaymentDto::amountPaisa).sum();
    }

    // ── The defect ──────────────────────────────────────────────────────────────────────

    @Test
    void voidOnPaidOrder_isRefused_andTheOrderAndItsPaymentAreLeftUntouched() {
        OrderDto order = paidUnservedOrder();

        assertThatThrownBy(() -> orderService.voidOrder(
                order.id(), new VoidOrderRequest("customer changed their mind"), UUID.randomUUID().toString()))
                .isInstanceOf(PosExceptions.OrderHasPaymentsException.class)
                .hasMessageContaining("cannot be voided")
                .hasMessageContaining("Use Refund");

        // Read the ORDER back out of Postgres — a refusal that still mutated is not a refusal.
        OrderDto after = orderService.getOrder(order.id(), branchId);
        assertThat(after.status()).isEqualTo(OrderStatus.SENT_TO_KDS);

        // And the money is exactly where it was: one live tender, nothing reversed, nothing lost.
        List<OrderPaymentDto> rows = paymentService.listPayments(order.id());
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).kind()).isEqualTo(OrderPaymentDto.KIND_PAYMENT);
        assertThat(netPaisa(rows)).isEqualTo(ITEM_PRICE_PAISA);
    }

    /**
     * Positive control. Without this, "void is refused" could be satisfied by breaking void
     * outright — the exact shape of fix this repo has shipped before and had to undo.
     */
    @Test
    void voidOnUnpaidOrder_stillSucceeds() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id(), null);

        OrderDto voided = orderService.voidOrder(
                order.id(), new VoidOrderRequest("guest walked out"), UUID.randomUUID().toString());

        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);
        assertThat(orderService.getOrder(order.id(), branchId).status()).isEqualTo(OrderStatus.VOIDED);
    }

    /** A partial tender is money in the drawer too — the strict policy, not "fully paid". */
    @Test
    void voidOnPartiallyPaidOrder_isAlsoRefused() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        paymentService.recordPayment(sent.id(), PaymentMethod.CASH, 5000L, "part-1");

        assertThatThrownBy(() -> orderService.voidOrder(
                sent.id(), new VoidOrderRequest("oops"), UUID.randomUUID().toString()))
                .isInstanceOf(PosExceptions.OrderHasPaymentsException.class);

        assertThat(orderService.getOrder(sent.id(), branchId).status())
                .isEqualTo(OrderStatus.SENT_TO_KDS);
    }

    // ── The path that has to exist instead ──────────────────────────────────────────────

    @Test
    void fullRefundOnPaidUnservedOrder_reachesRefunded_andWritesAReversingRow() {
        OrderDto order = paidUnservedOrder();

        OrderDto refunded = refundService.refund(
                order.id(),
                new RefundRequest(ITEM_PRICE_PAISA, "guest left, money returned", "FULL"),
                UUID.randomUUID().toString());

        assertThat(refunded.status()).isEqualTo(OrderStatus.REFUNDED);
        assertThat(orderService.getOrder(order.id(), branchId).status())
                .as("read back over the repository, not from the returned DTO")
                .isEqualTo(OrderStatus.REFUNDED);

        List<OrderPaymentDto> rows = paymentService.listPayments(order.id());
        assertThat(rows)
                .as("the original tender AND its reversal — never a live payment on its own")
                .hasSize(2);
        assertThat(rows).extracting(OrderPaymentDto::kind)
                .containsExactlyInAnyOrder(OrderPaymentDto.KIND_PAYMENT, OrderPaymentDto.KIND_REFUND);
        assertThat(rows).filteredOn(r -> OrderPaymentDto.KIND_REFUND.equals(r.kind()))
                .singleElement()
                .satisfies(r -> {
                    assertThat(r.amountPaisa()).isEqualTo(-ITEM_PRICE_PAISA);
                    assertThat(r.method())
                            .as("the reversal names the tender it gives back, so the till can subtract it")
                            .isEqualTo("CASH");
                });
        assertThat(netPaisa(rows))
                .as("net money held against the order is zero to the paisa")
                .isZero();
    }

    @Test
    void refundOnAnOrderThatWasNeverPaid_isRefused() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);

        assertThatThrownBy(() -> refundService.refund(
                sent.id(), new RefundRequest(100L, "no", "FULL"), UUID.randomUUID().toString()))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("Nothing to refund");
    }

    @Test
    void refundAboveWhatWasTaken_isRefused_ratherThanClamped() {
        OrderDto order = paidUnservedOrder();

        assertThatThrownBy(() -> refundService.refund(
                order.id(),
                new RefundRequest(ITEM_PRICE_PAISA + 1, "too much", "PARTIAL"),
                UUID.randomUUID().toString()))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("exceeds");

        assertThat(netPaisa(paymentService.listPayments(order.id()))).isEqualTo(ITEM_PRICE_PAISA);
    }

    @Test
    void twoPartialRefunds_cannotTogetherExceedWhatWasTaken() {
        OrderDto order = paidUnservedOrder();
        long half = ITEM_PRICE_PAISA / 2;

        refundService.refund(order.id(), new RefundRequest(half, "half back", "PARTIAL"),
                UUID.randomUUID().toString());

        assertThat(orderService.getOrder(order.id(), branchId).status())
                .as("a partial reversal does not terminate the order")
                .isEqualTo(OrderStatus.SENT_TO_KDS);
        assertThat(netPaisa(paymentService.listPayments(order.id())))
                .isEqualTo(ITEM_PRICE_PAISA - half);

        assertThatThrownBy(() -> refundService.refund(
                order.id(),
                new RefundRequest(ITEM_PRICE_PAISA - half + 1, "and a bit more", "PARTIAL"),
                UUID.randomUUID().toString()))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("exceeds");

        // Reversing the rest DOES terminate it — the "full" decision is derived from money taken
        // vs money returned, never from the client's scope string.
        refundService.refund(order.id(),
                new RefundRequest(ITEM_PRICE_PAISA - half, "rest back", "PARTIAL"),
                UUID.randomUUID().toString());

        assertThat(orderService.getOrder(order.id(), branchId).status()).isEqualTo(OrderStatus.REFUNDED);
        assertThat(netPaisa(paymentService.listPayments(order.id()))).isZero();
    }

    /**
     * A split-tender bill reverses tender by tender: the till subtracts only the cash that
     * physically left the drawer, and the card reversal is a separate, correctly-labelled row.
     */
    @Test
    void refundOnASplitTenderBill_reversesEachMethodSeparately() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        paymentService.recordPayment(sent.id(), PaymentMethod.CASH, 100000L, "cash-1");
        paymentService.recordPayment(sent.id(), PaymentMethod.CARD, ITEM_PRICE_PAISA - 100000L, "card-1");

        refundService.refund(sent.id(),
                new RefundRequest(ITEM_PRICE_PAISA, "whole bill back", "FULL"),
                UUID.randomUUID().toString());

        List<OrderPaymentDto> reversals = paymentService.listPayments(sent.id()).stream()
                .filter(r -> OrderPaymentDto.KIND_REFUND.equals(r.kind()))
                .toList();
        assertThat(reversals).hasSize(2);
        assertThat(reversals).extracting(OrderPaymentDto::method)
                .containsExactlyInAnyOrder("CASH", "CARD");
        assertThat(reversals).extracting(OrderPaymentDto::amountPaisa)
                .containsExactlyInAnyOrder(-100000L, -(ITEM_PRICE_PAISA - 100000L));
        assertThat(netPaisa(paymentService.listPayments(sent.id()))).isZero();
    }

    /**
     * The drawer count. Cash that was refunded is cash that is no longer in the till, and the
     * expected-closing figure has to say so or the cashier is written up for a shortage they did
     * not cause.
     */
    @Test
    void cashRefund_reducesTheTillsExpectedCash() {
        TillSessionDto till = tillService.listTills(cashierId, "OPEN").get(0);
        long expectedBefore = tillService.getReconciliation(till.id()).liveExpectedCashPaisa();

        OrderDto order = paidUnservedOrder();
        long expectedAfterPayment = tillService.getReconciliation(till.id()).liveExpectedCashPaisa();
        assertThat(expectedAfterPayment).isEqualTo(expectedBefore + ITEM_PRICE_PAISA);

        refundService.refund(order.id(),
                new RefundRequest(ITEM_PRICE_PAISA, "money returned", "FULL"),
                UUID.randomUUID().toString());

        assertThat(tillService.getReconciliation(till.id()).liveExpectedCashPaisa())
                .as("the refunded cash left the drawer — expected cash must fall back")
                .isEqualTo(expectedBefore);
    }
}
