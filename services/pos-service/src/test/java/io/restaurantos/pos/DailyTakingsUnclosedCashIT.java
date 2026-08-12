package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.DailyTakingsDto;
import io.restaurantos.pos.dto.DailyTakingsDto.TenderLine;
import io.restaurantos.pos.dto.OrderDto;
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
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * S0-02 — "Cash taken against an open order never reaches the Takings screen".
 *
 * <p>Every query in {@code DailyTakingsService} used to be dated by {@code orders.closed_at}, and
 * POS-23 closes an order only when it is fully paid AND fully served. So the ordinary case — the
 * customer pays while the food is still on the pass — produced a CASH payment with a null
 * {@code closed_at}, and the takings screen omitted it from the header totals and the tender split
 * at the same time. The money was in the drawer, the till's expected closing counted it
 * ({@code TillServiceImpl.closeTill} sums CASH payments regardless of close), and the one screen
 * built to reconcile the two showed neither the cash nor any hint that it was missing.
 *
 * <p>What is asserted here, in the order it matters:
 * <ol>
 *   <li>the cash reaches the CASH tender line at all — the defect itself;</li>
 *   <li>it is ALSO reported as unclosed holdings, so the surplus in the drawer is explained
 *       rather than merely present;</li>
 *   <li>closing the order later does not count that cash a second time — which is why the fix
 *       changed the date basis instead of dropping the {@code closed_at} filter;</li>
 *   <li>a payment is dated by when it was TAKEN, not by when its order closed, so a bill settled
 *       across midnight cannot land in two trading days;</li>
 *   <li>the day a cash-up screen defaults to is the trading day, not the calendar day.</li>
 * </ol>
 */
class DailyTakingsUnclosedCashIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired DailyTakingsService takingsService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;
    @Autowired JdbcTemplate jdbcTemplate;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;

    /** Rs 250.00 a plate, so a Rs 77.00 part-payment is applied in full rather than capped. */
    static final long ITEM_PRICE_PAISA = 25_000L;
    /** The distinctive amount the gap register used, so the IT and the browser proof agree. */
    static final long CASH_PAISA = 7_700L;

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
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        openTillForCashier(branchId);
    }

    /** An order that has been fired to the kitchen and NOT served — so it cannot close. */
    private OrderDto sentButUnservedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.sendToKds(order.id(), null);
    }

    /** Reads the takings for the business day the payments were just recorded on. */
    private DailyTakingsDto takingsForToday() {
        return takingsService.forDate(DailyTakingsService.currentBusinessDate(), branchId);
    }

    private Optional<TenderLine> cashLine(DailyTakingsDto takings) {
        return takings.byTender().stream().filter(t -> "CASH".equals(t.method())).findFirst();
    }

    // ── 1. The defect ────────────────────────────────────────────────────────────────────────

    @Test
    void cashTakenOnAnOpenOrder_appearsOnTheCashTenderLine() {
        OrderDto order = sentButUnservedOrder();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, CASH_PAISA, null);

        // Precondition of the whole gap: the order is genuinely NOT closed. If POS-23 ever starts
        // closing on payment alone this test would pass for the wrong reason, so it is asserted.
        assertThat(orderService.getOrder(order.id(), branchId).status())
                .as("a paid-but-unserved order must still be open")
                .isNotEqualTo(OrderStatus.CLOSED);

        DailyTakingsDto takings = takingsForToday();

        assertThat(cashLine(takings))
                .as("Rs 77.00 taken in cash must reach the CASH tender line even though the "
                        + "order it was taken against is still open")
                .isPresent()
                .hasValueSatisfying(line -> {
                    assertThat(line.amountPaisa()).isEqualTo(CASH_PAISA);
                    assertThat(line.paymentCount()).isEqualTo(1);
                });
    }

    // ── 2. …and it is explained, not merely present ──────────────────────────────────────────

    @Test
    void cashTakenOnAnOpenOrder_isStatedAsUnclosedHoldings() {
        OrderDto order = sentButUnservedOrder();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, CASH_PAISA, null);

        DailyTakingsDto takings = takingsForToday();

        assertThat(takings.unclosed().cashPaisa()).isEqualTo(CASH_PAISA);
        assertThat(takings.unclosed().totalPaisa()).isEqualTo(CASH_PAISA);
        assertThat(takings.unclosed().orderCount()).isEqualTo(1);
        assertThat(takings.unclosed().paymentCount()).isEqualTo(1);

        // The per-line subset must agree with the summary, or the screen shows two numbers for
        // one fact and the reader has to guess which is real.
        assertThat(cashLine(takings)).hasValueSatisfying(line -> {
            assertThat(line.unclosedAmountPaisa()).isEqualTo(CASH_PAISA);
            assertThat(line.unclosedPaymentCount()).isEqualTo(1);
        });

        // The sales figures are deliberately NOT moved: nothing has been sold until the bill is
        // finalised, and finance dates its revenue entry from ORDER_CLOSED.
        assertThat(takings.orderCount()).isZero();
        assertThat(takings.netSalesPaisa()).isZero();
    }

    // ── 3. Closing it later must not count the cash twice ────────────────────────────────────

    @Test
    void closingTheOrderLater_doesNotCountTheSameCashTwice() {
        OrderDto order = sentButUnservedOrder();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, CASH_PAISA, null);

        long cashWhileOpen = cashLine(takingsForToday()).orElseThrow().amountPaisa();

        // Serve every line and settle the rest, which is the only path to CLOSED (POS-23).
        OrderDto closed = closeViaServeAndPay(orderService, paymentService, order, branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        DailyTakingsDto after = takingsForToday();
        long remainder = ITEM_PRICE_PAISA - CASH_PAISA;

        assertThat(cashLine(after)).hasValueSatisfying(line -> {
            assertThat(line.amountPaisa())
                    .as("the Rs 77.00 must be counted once, not once while open and again on close")
                    .isEqualTo(cashWhileOpen + remainder)
                    .isEqualTo(ITEM_PRICE_PAISA);
            assertThat(line.paymentCount()).isEqualTo(2);
            assertThat(line.unclosedAmountPaisa()).isZero();
        });

        assertThat(after.unclosed().cashPaisa()).isZero();
        assertThat(after.unclosed().orderCount()).isZero();

        // Only NOW does it become a sale.
        assertThat(after.orderCount()).isEqualTo(1);
        assertThat(after.netSalesPaisa()).isEqualTo(ITEM_PRICE_PAISA);
    }

    // ── 4. A payment belongs to the day it was taken, not the day its order closed ────────────

    @Test
    void aPaymentIsDatedByWhenItWasTaken_notByWhenItsOrderClosed() {
        OrderDto order = sentButUnservedOrder();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, CASH_PAISA, null);
        LocalDate takenOn = DailyTakingsService.currentBusinessDate();

        // Move the ORDER's close into the future without touching the payment — the multi-day
        // settlement the naive "just drop the closed_at filter" fix would have double-counted.
        closeViaServeAndPay(orderService, paymentService, order, branchId);
        int moved = jdbcTemplate.update(
                "UPDATE orders SET closed_at = closed_at + interval '2 days' WHERE id = ?", order.id());
        assertThat(moved).as("the fixture must actually have moved the close").isEqualTo(1);

        DailyTakingsDto dayTaken = takingsService.forDate(takenOn, branchId);
        DailyTakingsDto dayClosed = takingsService.forDate(takenOn.plusDays(2), branchId);

        assertThat(cashLine(dayTaken)).hasValueSatisfying(l ->
                assertThat(l.amountPaisa()).isEqualTo(ITEM_PRICE_PAISA));
        assertThat(cashLine(dayClosed))
                .as("the cash must NOT be reported again on the day the bill was finalised")
                .isEmpty();

        // The SALE, by contrast, belongs to the day the bill was finalised.
        assertThat(dayTaken.orderCount()).isZero();
        assertThat(dayClosed.orderCount()).isEqualTo(1);
    }

    // ── 5. The trading day a cash-up defaults to ─────────────────────────────────────────────

    @Test
    void theDefaultDay_isTheTradingDay_notTheCalendarDay() {
        // 02:00 UTC: the kitchen is still working last night's service.
        assertThat(DailyTakingsService.businessDateOf(Instant.parse("2026-08-12T02:00:00Z")))
                .isEqualTo(LocalDate.parse("2026-08-11"));
        // 05:00 UTC, past the 04:00 roll: a new trading day.
        assertThat(DailyTakingsService.businessDateOf(Instant.parse("2026-08-12T05:00:00Z")))
                .isEqualTo(LocalDate.parse("2026-08-12"));
        // Exactly on the boundary, the new day has started.
        assertThat(DailyTakingsService.businessDateOf(Instant.parse("2026-08-12T04:00:00Z")))
                .isEqualTo(LocalDate.parse("2026-08-12"));
    }

}
