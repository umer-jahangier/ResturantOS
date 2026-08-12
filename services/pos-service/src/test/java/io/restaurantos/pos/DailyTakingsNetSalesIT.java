package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.ApplyDiscountRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.DailyTakingsDto;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.DailyTakingsService;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
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
import static org.mockito.Mockito.when;

/**
 * F5 — "Net sales" was the bill total, so it came out LARGER than gross sales.
 *
 * <p>The takings screen showed, on one real trading day:
 *
 * <pre>
 *   GROSS SALES  Rs 43,350.00
 *   DISCOUNTS    Rs    950.00
 *   TAX          Rs  3,566.40
 *   NET SALES    Rs 45,966.40   ← larger than gross
 * </pre>
 *
 * <p>because {@code DailyTakingsService.forDate} handed {@code SUM(orders.total_paisa)} — the bill
 * total, tax included — to the field named {@code netSalesPaisa}. In a restaurant P&amp;L net sales
 * is gross <b>less</b> discounts and <b>excluding</b> tax; output tax is a liability owed onward,
 * not revenue. An accountant reading that screen over-states revenue by the whole tax line.
 *
 * <h2>Why this is asserted with a discount AND a tax, on a closed order</h2>
 *
 * <p>Those are the only conditions under which the four figures can be told apart. Take the tax
 * away and net, gross and total collapse onto one number and every arrangement of them passes —
 * which is exactly how {@code DailyTakingsUnclosedCashIT} (tax rate 0.00, no discount) stayed green
 * through the whole life of this defect. A test whose fixture cannot distinguish right from wrong
 * is not evidence, and this repository has shipped several.
 */
class DailyTakingsNetSalesIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired DailyTakingsService takingsService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    /** Rs 1,000.00 a plate. */
    static final long ITEM_PRICE_PAISA = 100_000L;
    /** A real tax rate, so tax is a number that can be seen to be inside or outside a figure. */
    static final BigDecimal TAX_RATE_PCT = new BigDecimal("16.00");
    /** Rs 50.00 off — the discount is FLAT so its paisa value is not itself a rounding question. */
    static final BigDecimal DISCOUNT_RUPEES = new BigDecimal("50.00");
    static final long DISCOUNT_PAISA = 5_000L;

    @BeforeEach
    void setUp() {
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
        item.setName("Karahi");
        item.setBasePricePaisa(ITEM_PRICE_PAISA);
        item.setTaxRatePct(TAX_RATE_PCT);
        menuItemId = menuItemRepository.save(item).getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));

        // A whole-order discount runs pos.rego's pos.order.discount.override rule. This test is
        // about arithmetic, not authorization — VoidRefundOpaIT owns the deny path — so the
        // manager who is entitled to give it is modelled and OPA is stubbed to allow.
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId,
                List.of("MANAGER"), List.of("pos.order.discount.override"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));

        openTillForCashier(branchId);
    }

    /**
     * One closed bill with a real discount and a real tax on it.
     *
     * <p>The discount is ORDER-scope on purpose. A LINE-scope discount writes an
     * {@code order_discounts} row and never reaches {@code orders.discount_paisa} —
     * {@code recomputeOrderTotals} rolls up {@code OrderItem.discountPaisa}, which
     * {@code applyDiscount} does not set — so a fixture built on one would present a Rs 0.00
     * discount and quietly stop testing anything. That is reported separately; here it is simply
     * avoided, and the fixture asserts its own discount before anything else is claimed.
     */
    private OrderDto discountedTaxedClosedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        orderService.applyDiscount(order.id(),
                new ApplyDiscountRequest("ORDER", null, "FLAT", DISCOUNT_RUPEES,
                        "Regular guest, waited 40 minutes"));

        OrderDto closed = closeViaServeAndPay(orderService, paymentService, order, branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);
        return closed;
    }

    private DailyTakingsDto takingsForToday() {
        return takingsService.forDate(takingsService.currentBusinessDate(branchId), branchId);
    }

    // ── The fixture itself must be able to fail ─────────────────────────────────────────────

    @Test
    void theFixtureCarriesADiscountAndATax_orNothingBelowProvesAnything() {
        OrderDto order = discountedTaxedClosedOrder();

        assertThat(order.discountPaisa())
                .as("without a discount, gross and net are the same number and the defect hides")
                .isEqualTo(DISCOUNT_PAISA);
        assertThat(order.taxPaisa())
                .as("without a tax, net and total are the same number and the defect hides")
                .isGreaterThan(0L);
    }

    // ── The defect ──────────────────────────────────────────────────────────────────────────

    @Test
    void netSales_isGrossLessDiscounts_andNeverExceedsGross() {
        discountedTaxedClosedOrder();

        DailyTakingsDto t = takingsForToday();

        assertThat(t.orderCount()).isEqualTo(1);
        assertThat(t.grossSalesPaisa()).isEqualTo(ITEM_PRICE_PAISA);
        assertThat(t.discountsPaisa()).isEqualTo(DISCOUNT_PAISA);

        assertThat(t.netSalesPaisa())
                .as("net sales is gross LESS discounts — the P&L definition of the word")
                .isEqualTo(t.grossSalesPaisa() - t.discountsPaisa())
                .isEqualTo(ITEM_PRICE_PAISA - DISCOUNT_PAISA);

        assertThat(t.netSalesPaisa())
                .as("a figure named 'net' can never be larger than the gross it came out of — "
                        + "this is the invariant the takings screen broke")
                .isLessThanOrEqualTo(t.grossSalesPaisa())
                .isLessThan(t.grossSalesPaisa());
    }

    @Test
    void taxIsOutsideNetSales_andIsStatedOnItsOwn() {
        discountedTaxedClosedOrder();

        DailyTakingsDto t = takingsForToday();

        assertThat(t.taxPaisa()).as("the fixture must actually be taxed").isGreaterThan(0L);
        assertThat(t.netSalesPaisa())
                .as("output tax is collected for the tax authority and is not revenue, so it "
                        + "cannot be inside net sales")
                .isEqualTo(t.grossSalesPaisa() - t.discountsPaisa())
                .isNotEqualTo(t.grossSalesPaisa() - t.discountsPaisa() + t.taxPaisa());
    }

    @Test
    void totalBilled_isWhatTheBillCameTo_andCarriesTheTax() {
        OrderDto order = discountedTaxedClosedOrder();

        DailyTakingsDto t = takingsForToday();

        assertThat(t.totalBilledPaisa())
                .as("total billed is the sum of the bills, to the paisa")
                .isEqualTo(order.totalPaisa());

        assertThat(t.totalBilledPaisa())
                .as("net + tax + service charge = total billed, so the six tiles reconcile by "
                        + "hand and a reader is never asked to guess which one includes what")
                .isEqualTo(t.netSalesPaisa() + t.taxPaisa() + t.serviceChargePaisa());

        assertThat(t.totalBilledPaisa())
                .as("and it is the figure that used to be shown under the word 'net'")
                .isGreaterThan(t.netSalesPaisa());
    }

    // ── A day with nothing on it must still be internally consistent ────────────────────────

    @Test
    void anEmptyDayIsAllZeroes_notANegativeNet() {
        DailyTakingsDto t = takingsService.forDate(
                takingsService.currentBusinessDate(branchId).minusDays(400), branchId);

        assertThat(t.grossSalesPaisa()).isZero();
        assertThat(t.discountsPaisa()).isZero();
        assertThat(t.netSalesPaisa()).isZero();
        assertThat(t.totalBilledPaisa()).isZero();
        assertThat(t.orderCount()).isZero();
    }
}
