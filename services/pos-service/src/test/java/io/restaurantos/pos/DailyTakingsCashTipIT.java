package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CloseTillRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.DailyTakingsDto;
import io.restaurantos.pos.dto.DailyTakingsDto.TenderLine;
import io.restaurantos.pos.dto.DailyTakingsDto.TillReconciliation;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.DailyTakingsService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * F20 — "the cash tip is in the drawer, and the OWNER's Takings screen never said so".
 *
 * <h2>The defect</h2>
 *
 * <p>F20 gave cashiers a tip box and made {@code TillServiceImpl.closeTill} count a cash tip into
 * the drawer — {@code p.getAmountPaisa() + p.getTipPaisa()} — which is RIGHT: the guest physically
 * put the note there. {@code DailyTakingsService.tenderSplit} and {@code unclosedTakings} summed
 * {@code p.amount_paisa} ONLY. So on one page, a till's EXPECTED CASH (read straight from
 * {@code till_sessions.expected_closing_paisa}) included the tips while the tender split above it
 * did not, and <b>the two figures diverged by exactly the day's cash tips with nothing naming the
 * difference</b>. The screen's own copy promised the split was "what the drawers and the card
 * terminals took today" and told the reader to "expect the count to include it".
 *
 * <p>Measured live on 2026-08-12 at Floating Terrace HQ: Rs 185.00 of cash tips and Rs 300.00 of
 * card tips on the day, and the word "tip" appeared NOWHERE on the rendered page. The two figures
 * below are those, to the paisa.
 *
 * <h2>What is asserted, and why it is a reconciliation and not a presence check</h2>
 *
 * <p>"A tip number is on the screen" is the assertion this codebase has been burned by: a figure
 * can be present and still not be the one the drawer is short of. The assertion that matters is
 * the IDENTITY the cash-up is done with, stated over figures from BOTH sides of the gap —
 * {@code DailyTakingsService} on one side, {@code TillServiceImpl} on the other:
 *
 * <pre>
 *   till.expectedClosingPaisa == openingFloat + cashLine.amountPaisa + cashLine.tipPaisa
 * </pre>
 *
 * <p>and, said the other way round so the failure names the cause rather than a number:
 * the gap left by the amount alone IS the cash tip.
 *
 * <h2>Falsification</h2>
 *
 * <p>Restore the production defect by summing only the amount in {@code tenderSplit} — drop the
 * {@code COALESCE(SUM(p.tip_paisa), 0)} column and pass {@code 0L} to {@code TenderLine} — and
 * {@link #aCashTipReconcilesTheDrawerAgainstTheTakingsScreen} fails on the identity, off by
 * exactly Rs 185.00. It cannot pass on a build that reports the tip as a plain zero, which is
 * precisely what shipped.
 */
class DailyTakingsCashTipIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired DailyTakingsService takingsService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;
    TillSessionDto till;

    /** Rs 250.00 a plate, no tax and no service charge, so every figure below is checkable by hand. */
    static final long ITEM_PRICE_PAISA = 25_000L;
    /** Rs 3,000.00 — the float on live till b17269cb, whose expected closing already carried tips. */
    static final long OPENING_FLOAT_PAISA = 300_000L;
    /** Rs 185.00 — the cash tips measured at Floating Terrace HQ on 2026-08-12. In the drawer. */
    static final long CASH_TIP_PAISA = 18_500L;
    /** Rs 300.00 — the card tips on the same day. NOT in the drawer; with the acquirer. */
    static final long CARD_TIP_PAISA = 30_000L;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);

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
        menuItemId = menuItemRepository.save(item).getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));

        // A REAL float, not the zero PosTestBase opens with: an identity that holds at 0 would
        // still hold if the float were being dropped, and this test is about an addition being
        // dropped. Rs 3,000.00 makes every term of the reconciliation non-zero.
        till = tillService.openTill(new OpenTillRequest(branchId, OPENING_FLOAT_PAISA));
    }

    /** An order fired to the kitchen and fully served — everything but the money. */
    private OrderDto servedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto fired = orderService.sendToKds(order.id(), null);
        for (OrderDto.OrderItemDto line : fired.items()) {
            if (line.kdsStatus() != OrderItemStatus.SERVED && line.kdsStatus() != OrderItemStatus.CANCELLED) {
                orderService.markItemServed(order.id(), line.id());
            }
        }
        return orderService.getOrder(order.id(), branchId);
    }

    /** An order fired to the kitchen and NOT served — so it cannot close, whatever it is paid. */
    private OrderDto sentButUnservedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.sendToKds(order.id(), null);
    }

    private DailyTakingsDto takingsForToday() {
        return takingsService.forDate(takingsService.currentBusinessDate(branchId), branchId);
    }

    private Optional<TenderLine> line(DailyTakingsDto takings, String method) {
        return takings.byTender().stream().filter(t -> method.equals(t.method())).findFirst();
    }

    // ── 1. The reconciliation. This is the test. ─────────────────────────────────────────────

    @Test
    void aCashTipReconcilesTheDrawerAgainstTheTakingsScreen() {
        // A cash check with a Rs 185.00 tip, and a card check with a Rs 300.00 one. Both tips
        // exist so the test can prove the screen keeps them APART: only one of them is in a drawer,
        // and a single combined "tips" figure would reconcile neither.
        OrderDto cashCheck = servedOrder();
        paymentService.recordPayment(cashCheck.id(), PaymentMethod.CASH, cashCheck.totalPaisa(),
                null, null, null, CASH_TIP_PAISA);

        OrderDto cardCheck = servedOrder();
        paymentService.recordPayment(cardCheck.id(), PaymentMethod.CARD, cardCheck.totalPaisa(),
                null, "auth-1", null, CARD_TIP_PAISA);

        // Both bills must be settled and served, or closeTill refuses the till and this test would
        // be asserting the identity over a drawer nobody could have counted.
        assertThat(orderService.getOrder(cashCheck.id(), branchId).status()).isEqualTo(OrderStatus.CLOSED);
        assertThat(orderService.getOrder(cardCheck.id(), branchId).status()).isEqualTo(OrderStatus.CLOSED);

        // The cashier counts the drawer. Expected closing is computed by closeTill and stored on
        // till_sessions — the very column the Takings screen reads for its EXPECTED CASH.
        long counted = OPENING_FLOAT_PAISA + ITEM_PRICE_PAISA + CASH_TIP_PAISA;
        TillSessionDto closed = tillService.closeTill(till.id(), new CloseTillRequest(counted, "end of shift"));

        DailyTakingsDto takings = takingsForToday();
        TenderLine cash = line(takings, "CASH").orElseThrow(
                () -> new AssertionError("no CASH tender line — the day took cash"));
        TenderLine card = line(takings, "CARD").orElseThrow(
                () -> new AssertionError("no CARD tender line — the day took a card"));
        TillReconciliation shownTill = takings.tills().stream()
                .filter(t -> t.tillSessionId().equals(till.id())).findFirst().orElseThrow();

        // ── The identity the evening cash-up is actually done with ───────────────────────────
        // Left side: TillServiceImpl.closeTill, via till_sessions.expected_closing_paisa.
        // Right side: DailyTakingsService.tenderSplit, via the CASH line.
        // These are two independent implementations over the same payments. Before the fix they
        // disagreed by exactly the cash tips and this screen was the one that was wrong.
        assertThat(shownTill.expectedClosingPaisa())
                .as("the till's EXPECTED CASH must be reachable from the tender split the same "
                        + "screen shows above it: float + cash taken + cash tips")
                .isEqualTo(shownTill.openingFloatPaisa() + cash.amountPaisa() + cash.tipPaisa());

        // Said the other way round, so a failure names the CAUSE and not just a number: whatever
        // the amount alone leaves unexplained is the cash tip, to the paisa. On the shipped build
        // the left side was Rs 185.00 and the right side was Rs 0.00.
        assertThat(shownTill.expectedClosingPaisa() - shownTill.openingFloatPaisa() - cash.amountPaisa())
                .as("the gap between the expected drawer and the cash tender line IS the cash tip")
                .isEqualTo(CASH_TIP_PAISA)
                .isEqualTo(cash.tipPaisa());

        // The drawer matched, and it could only match because the tip was counted on both sides.
        assertThat(closed.variancePaisa())
                .as("a correctly counted drawer with a tip in it is NOT a variance")
                .isZero();

        // ── The card tip is reported, and is NOT in the drawer ───────────────────────────────
        // This is why the tip is a column per tender and not one row under the split: a combined
        // Rs 485.00 would reconcile against nothing at all.
        assertThat(card.tipPaisa()).isEqualTo(CARD_TIP_PAISA);
        assertThat(shownTill.expectedClosingPaisa())
                .as("a card tip never entered the drawer and must not be expected in it")
                .isNotEqualTo(shownTill.openingFloatPaisa() + cash.amountPaisa()
                        + cash.tipPaisa() + card.tipPaisa());

        // ── A tip is never inside the amount that settled the bill ───────────────────────────
        assertThat(cash.amountPaisa()).isEqualTo(ITEM_PRICE_PAISA);
        assertThat(card.amountPaisa()).isEqualTo(ITEM_PRICE_PAISA);
    }

    // ── 2. headerTotals is CORRECT AS-IS and stays that way ──────────────────────────────────

    /**
     * A tip is not revenue — {@code order_payments.tip_paisa} never enters
     * {@code orders.total_paisa} and finance credits it to a Tips Payable liability. So it belongs
     * in NEITHER gross, net, nor total billed, and this test exists to fail on any future fix that
     * "makes the numbers add up" by folding it into the sales figures.
     */
    @Test
    void aTipIsNotRevenue_andReachesNoSalesFigure() {
        OrderDto cashCheck = servedOrder();
        paymentService.recordPayment(cashCheck.id(), PaymentMethod.CASH, cashCheck.totalPaisa(),
                null, null, null, CASH_TIP_PAISA);

        DailyTakingsDto takings = takingsForToday();

        assertThat(takings.orderCount()).isEqualTo(1);
        assertThat(takings.grossSalesPaisa()).isEqualTo(ITEM_PRICE_PAISA);
        assertThat(takings.netSalesPaisa()).isEqualTo(ITEM_PRICE_PAISA);
        assertThat(takings.totalBilledPaisa()).isEqualTo(ITEM_PRICE_PAISA);

        // …while the drawer figure DOES carry it. The whole point: the two bases differ, on
        // purpose, and the screen now states the figure that explains the difference.
        assertThat(line(takings, "CASH").orElseThrow().tipPaisa()).isEqualTo(CASH_TIP_PAISA);
    }

    // ── 3. A tip on a bill that has not closed is still in the drawer ────────────────────────

    /**
     * The unclosed bridge is what the screen turns into "expect the count to include it". A cash
     * tip taken against an order that is still open is in the drawer exactly like the cash that
     * settled the bill, so a bridge that omitted it made that sentence short by the tip — and a
     * cashier acting on it would report the restaurant's own gratuity as an overage.
     *
     * <p>Reconciled here against {@code getReconciliation}'s LIVE expected cash rather than
     * {@code expected_closing_paisa}, because a till with an open order cannot be closed at all —
     * which is exactly the state a manager reads this panel in.
     */
    @Test
    void aCashTipOnAnOpenBill_isReportedAsBeingInTheDrawerToo() {
        OrderDto open = sentButUnservedOrder();
        paymentService.recordPayment(open.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA,
                null, null, null, CASH_TIP_PAISA);

        // Precondition of the whole case. If POS-23 ever closes on payment alone this test would
        // pass for the wrong reason.
        assertThat(orderService.getOrder(open.id(), branchId).status())
                .as("a paid-but-unserved order must still be open")
                .isNotEqualTo(OrderStatus.CLOSED);

        DailyTakingsDto takings = takingsForToday();

        assertThat(takings.unclosed().cashPaisa()).isEqualTo(ITEM_PRICE_PAISA);
        assertThat(takings.unclosed().cashTipPaisa())
                .as("the tip on an open bill is in the drawer and must be stated")
                .isEqualTo(CASH_TIP_PAISA);
        assertThat(takings.unclosed().tipPaisa()).isEqualTo(CASH_TIP_PAISA);
        assertThat(takings.unclosed().orderCount()).isEqualTo(1);

        // The live drawer bar and this screen must agree while the shift is still running, for the
        // same reason the closed-till identity has to hold at the end of it.
        long liveExpected = tillService.getReconciliation(till.id()).liveExpectedCashPaisa();
        assertThat(liveExpected)
                .as("the running expected drawer must equal float + cash taken + cash tips")
                .isEqualTo(OPENING_FLOAT_PAISA + ITEM_PRICE_PAISA + CASH_TIP_PAISA);
        assertThat(liveExpected - OPENING_FLOAT_PAISA
                - line(takings, "CASH").orElseThrow().amountPaisa())
                .as("and the part the amount alone does not explain is the tip")
                .isEqualTo(takings.unclosed().cashTipPaisa());
    }
}
