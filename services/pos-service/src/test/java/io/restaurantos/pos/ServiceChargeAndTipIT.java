package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.dto.ServiceChargeDtos.ServiceChargePolicyDto;
import io.restaurantos.pos.dto.ServiceChargeDtos.UpdateServiceChargeRequest;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.ReceiptDocumentAssembler;
import io.restaurantos.pos.service.ServiceChargeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.exception.FieldValidationException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * A branch sets a service charge, a guest is billed it, and a cashier takes a tip (F20).
 *
 * <h2>The defect this file exists to fail on</h2>
 *
 * <p>{@code orders.service_charge_paisa} has existed since V1 and is read by
 * {@code DailyTakingsService}, by {@code ORDER_CLOSED}, by finance's revenue recipe and by the
 * printed bill. <b>No code path anywhere assigned it.</b> Measured live on 2026-08-12:
 * {@code service_charge_paisa} non-zero on <b>0 of 195</b> orders in {@code pos_db}, while the
 * charge page and every guest's receipt printed {@code Service charge Rs 0.00} — a charge the
 * restaurant is told about, cannot influence, and never collects. Tips were worse: no column, no
 * field, no control.
 *
 * <h2>Falsification — how each test was watched to fail</h2>
 *
 * <ul>
 *   <li>{@link #aFivePercentBranchBillsADineInCheckToThePaisa} — delete the
 *       {@code applyServiceCharge(order, subtotal - totalDiscount)} call from
 *       {@code OrderServiceImpl.recomputeOrderTotals} and it fails on
 *       {@code serviceChargePaisa}, which stays at 0 exactly as it did in production. This is the
 *       whole defect in one assertion.</li>
 *   <li>{@link #aBranchWithNoPolicyPrintsNoServiceChargeLineAtAll} — restore the unconditional
 *       {@code new PrintDocument.Totals(..)} that passed no label, and the document comes back
 *       carrying a service-charge caption for a branch that takes none, which is what let every
 *       renderer print {@code Rs 0.00}.</li>
 *   <li>{@link #takeawayIsNotChargedWhenThePolicyIsDineInOnly} fails against any implementation
 *       that applies the rate without asking {@code BranchServiceCharge.appliesTo}.</li>
 *   <li>{@link #aTipIsRecordedBesideTheSaleAndNeverInsideIt} fails to compile against the pre-F20
 *       {@code recordPayment}, and fails on {@code totalPaisa} against any implementation that
 *       applies the tip to the balance.</li>
 *   <li>{@link #aCashierCannotSetTheRateAndAManagerCanOnlyReadIt} fails against a service that
 *       gates the write on anything a cashier holds.</li>
 * </ul>
 */
class ServiceChargeAndTipIT extends PosTestBase {

    /*
     * The receipt assembler reads branch identity over feign, mocked so the document's header is
     * deterministic and this file stays about the money — the fail-soft behaviour of that call is
     * ReceiptDocumentAssemblerIT's subject, not this one's. The @MockitoBean now lives on
     * PosTestBase, because ActiveBranchGuard made the same client load-bearing on createOrder for
     * every suite in the module; this class binds to the inherited field.
     */

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired ServiceChargeService serviceChargeService;
    @Autowired ReceiptDocumentAssembler receiptAssembler;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;
    @Autowired TenantContext tenantContext;
    @Autowired PlatformTransactionManager transactionManager;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID ownerId;
    UUID menuItemId;

    /** Rs 500.00 a plate, no tax — so every figure below is checkable by hand. */
    private static final long UNIT_PRICE_PAISA = 50_000L;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        ownerId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Chicken Karahi");
        item.setBasePricePaisa(UNIT_PRICE_PAISA);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        asCashier();
        openTillForCashier(branchId);
    }

    private void asCashier() {
        // Exactly what a cashier holds. NOT pos.menu.view's manage sibling, and emphatically not
        // pos.service_charge.manage — the whole point of the pricing read being ungated is that
        // this principal must still get the right total.
        setSecurityContext(cashierId, List.of("CASHIER"),
                List.of("pos.order.create", "pos.order.update", "pos.order.close"));
    }

    private void asOwner() {
        setSecurityContext(ownerId, List.of("OWNER"),
                List.of("pos.menu.view", "pos.service_charge.manage"));
    }

    private void asManager() {
        // A branch manager: reads the menu, and therefore reads the policy. Does not set it.
        setSecurityContext(UUID.randomUUID(), List.of("MANAGER"), List.of("pos.menu.view"));
    }

    private void setSecurityContext(UUID userId, List<String> roles, List<String> permissions) {
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, roles, permissions,
                Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        tenantContext.set(tenantId, branchId, userId, null);
    }

    /** The owner configures the branch, then hands the till back to the cashier. */
    private ServiceChargePolicyDto configure(String ratePct, String label,
                                             boolean dineIn, boolean takeaway, boolean pickup) {
        asOwner();
        ServiceChargePolicyDto saved = serviceChargeService.update(branchId,
                new UpdateServiceChargeRequest(true, new BigDecimal(ratePct), label,
                        dineIn, takeaway, pickup));
        asCashier();
        return saved;
    }

    private OrderDto ringTwoPlates(OrderType type) {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), type, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 2, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    // ── (1) THE DEFECT: a configured branch actually bills the charge ──────────────────────

    /**
     * 5% of two Rs 500.00 plates is Rs 50.00, and that figure has to be the same on the order row,
     * on the DTO the charge screen renders, and inside the receipt document — to the paisa.
     */
    @Test
    void aFivePercentBranchBillsADineInCheckToThePaisa() {
        configure("5.00", "Service charge", true, false, false);

        OrderDto check = ringTwoPlates(OrderType.DINE_IN);

        assertThat(check.subtotalPaisa()).isEqualTo(100_000L);
        assertThat(check.serviceChargePaisa())
                .as("the whole defect: this stayed at 0 on all 195 live orders")
                .isEqualTo(5_000L);
        assertThat(check.serviceChargePct()).isEqualByComparingTo("5.00");
        assertThat(check.serviceChargeLabel()).isEqualTo("Service charge");
        assertThat(check.totalPaisa()).isEqualTo(105_000L);

        // The row Postgres actually holds — a service that returns the right numbers and persists
        // the wrong ones is exactly the failure this file exists to catch.
        Persisted row = readBack(check.id());
        assertThat(row.serviceChargePaisa()).isEqualTo(5_000L);
        assertThat(row.serviceChargePct()).isEqualByComparingTo("5.00");
        assertThat(row.serviceChargeLabel()).isEqualTo("Service charge");

        // The identity the customer receipt refuses to print without, and the one finance balances
        // the revenue journal entry against.
        assertThat(row.subtotalPaisa() - row.discountPaisa() + row.taxPaisa()
                + row.serviceChargePaisa())
                .isEqualTo(row.totalPaisa());
    }

    /**
     * The rate rides the base, not a fixed amount: adding a third plate moves the charge with it.
     * A one-shot charge stamped at creation would pass the test above and fail here.
     */
    @Test
    void addingADishRecomputesTheChargeAgainstTheNewSubtotal() {
        configure("5.00", "Service charge", true, false, false);
        OrderDto check = ringTwoPlates(OrderType.DINE_IN);
        assertThat(check.serviceChargePaisa()).isEqualTo(5_000L);

        orderService.addItem(check.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto after = orderService.getOrder(check.id(), branchId);

        assertThat(after.subtotalPaisa()).isEqualTo(150_000L);
        assertThat(after.serviceChargePaisa()).isEqualTo(7_500L);
        assertThat(after.totalPaisa()).isEqualTo(157_500L);
    }

    /**
     * HALF_UP to the paisa, in BigDecimal, on a rate and a base that do not divide cleanly.
     *
     * <p>12.5% of Rs 500.05 is 6250.625 paisa. HALF_UP gives 6251; a double would give
     * 6250.624999999999 and truncate to 6250, and {@code Math.round} on the float would be a coin
     * toss on the machine. One paisa on one check is the difference between the screen, the paper
     * and the ledger agreeing and not.
     */
    @Test
    void theRateIsAppliedHalfUpToTheWholePaisa() {
        configure("12.50", "Service charge", true, false, false);

        MenuCategory cat = menuCategoryRepository.findAll().stream()
                .filter(c -> tenantId.equals(c.getTenantId())).findFirst().orElseThrow();
        MenuItem odd = new MenuItem();
        odd.setTenantId(tenantId);
        odd.setCategory(cat);
        odd.setName("Odd-priced dish");
        odd.setBasePricePaisa(50_005L);
        odd.setTaxRatePct(new BigDecimal("0.00"));
        odd = menuItemRepository.save(odd);

        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(odd.getId(), branchId, 1, null, null));
        OrderDto check = orderService.getOrder(order.id(), branchId);

        assertThat(check.subtotalPaisa()).isEqualTo(50_005L);
        assertThat(check.serviceChargePaisa()).isEqualTo(6_251L);
        assertThat(check.totalPaisa()).isEqualTo(56_256L);
    }

    // ── (2) the channels ──────────────────────────────────────────────────────────────────

    /**
     * A service charge pays for table service. A branch that charges dine-in only must not charge
     * the guest who walked to the counter — the most common way a restaurant gets this wrong in
     * public.
     */
    @Test
    void takeawayIsNotChargedWhenThePolicyIsDineInOnly() {
        configure("5.00", "Service charge", true, false, false);

        OrderDto takeaway = ringTwoPlates(OrderType.TAKEAWAY);

        assertThat(takeaway.serviceChargePaisa()).isZero();
        assertThat(takeaway.serviceChargePct()).isEqualByComparingTo("0");
        assertThat(takeaway.serviceChargeLabel())
                .as("no label means the receipt prints no service-charge line at all")
                .isNull();
        assertThat(takeaway.totalPaisa()).isEqualTo(100_000L);
    }

    /** Switching the charge off takes it back off an OPEN check the next time anything changes. */
    @Test
    void switchingThePolicyOffClearsTheChargeFromAnOpenCheck() {
        configure("5.00", "Service charge", true, false, false);
        OrderDto check = ringTwoPlates(OrderType.DINE_IN);
        assertThat(check.serviceChargePaisa()).isEqualTo(5_000L);

        asOwner();
        serviceChargeService.update(branchId, new UpdateServiceChargeRequest(
                false, new BigDecimal("5.00"), "Service charge", true, false, false));
        asCashier();

        orderService.addItem(check.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto after = orderService.getOrder(check.id(), branchId);

        assertThat(after.serviceChargePaisa()).isZero();
        assertThat(after.serviceChargeLabel()).isNull();
        assertThat(after.totalPaisa()).isEqualTo(150_000L);
    }

    // ── (3) the zero line does not print ──────────────────────────────────────────────────

    /**
     * The other half of the finding: on a branch with no service charge configured, the receipt
     * document must carry NO service-charge caption, so no renderer can print
     * {@code Service charge Rs 0.00}.
     */
    @Test
    void aBranchWithNoPolicyPrintsNoServiceChargeLineAtAll() {
        stubBranch();
        OrderDto check = ringTwoPlates(OrderType.DINE_IN);
        assertThat(check.serviceChargePaisa()).isZero();
        closeViaServeAndPay(orderService, paymentService, check, branchId);

        PrintDocument doc = receiptAssembler.assembleReceipt(check.id(), branchId).document();

        assertThat(doc.totals().serviceChargeLabel())
                .as("a null label is the ONLY thing that tells a renderer to omit the row")
                .isNull();
        assertThat(doc.totals().serviceChargeRatePercent()).isNull();
        assertThat(doc.totals().serviceCharge().paisa()).isZero();
    }

    /** And with a policy, the paper says what it is and what rate it was. */
    @Test
    void aConfiguredBranchPrintsTheChargeItsNameAndItsRate() {
        stubBranch();
        configure("5.00", "Service fee", true, false, false);
        OrderDto check = ringTwoPlates(OrderType.DINE_IN);
        closeViaServeAndPay(orderService, paymentService, check, branchId);

        PrintDocument doc = receiptAssembler.assembleReceipt(check.id(), branchId).document();

        assertThat(doc.totals().serviceChargeLabel()).isEqualTo("Service fee");
        assertThat(doc.totals().serviceChargeRatePercent()).isEqualTo("5.00");
        assertThat(doc.totals().serviceCharge().paisa()).isEqualTo(5_000L);
        assertThat(doc.totals().serviceCharge().formatted()).isEqualTo("Rs 50.00");

        // The identity the assembler refuses to print without, restated against the document.
        assertThat(doc.totals().subtotal().paisa() - doc.totals().discount().paisa()
                + doc.totals().tax().paisa() + doc.totals().serviceCharge().paisa())
                .isEqualTo(doc.totals().grandTotal().paisa());
    }

    // ── (4) the tip ───────────────────────────────────────────────────────────────────────

    /**
     * A Rs 1,000.00 bill settled with a Rs 100.00 tip on a card. The card is charged Rs 1,100.00,
     * the BILL is settled at Rs 1,000.00, and the two figures never merge.
     */
    @Test
    void aTipIsRecordedBesideTheSaleAndNeverInsideIt() {
        OrderDto check = ringTwoPlates(OrderType.DINE_IN);
        assertThat(check.totalPaisa()).isEqualTo(100_000L);

        long applied = paymentService.recordPayment(
                check.id(), PaymentMethod.CARD, 100_000L, null, "slip-88", null, 10_000L);

        assertThat(applied)
                .as("the tip must not count toward what settled the bill")
                .isEqualTo(100_000L);

        OrderDto after = orderService.getOrder(check.id(), branchId);
        assertThat(after.totalPaisa())
                .as("a tip is not owed, so it can never enter the order total")
                .isEqualTo(100_000L);

        List<OrderPaymentDto> payments = paymentService.listPayments(check.id());
        assertThat(payments).hasSize(1);
        assertThat(payments.get(0).amountPaisa()).isEqualTo(100_000L);
        assertThat(payments.get(0).tipPaisa()).isEqualTo(10_000L);
        assertThat(payments.get(0).tenderedPaisa())
                .as("tendered == amount + tip + change; the card was charged the larger figure")
                .isEqualTo(110_000L);
        assertThat(payments.get(0).changePaisa()).isZero();
    }

    /** Cash: the guest puts down Rs 1,200 on a Rs 1,000 bill and says "keep Rs 100". */
    @Test
    void aCashTipComesOutOfTheTenderBeforeTheChange() {
        OrderDto check = ringTwoPlates(OrderType.DINE_IN);

        paymentService.recordPayment(
                check.id(), PaymentMethod.CASH, 100_000L, 120_000L, null, null, 10_000L);

        OrderPaymentDto row = paymentService.listPayments(check.id()).get(0);
        assertThat(row.amountPaisa()).isEqualTo(100_000L);
        assertThat(row.tipPaisa()).isEqualTo(10_000L);
        assertThat(row.tenderedPaisa()).isEqualTo(120_000L);
        assertThat(row.changePaisa())
                .as("tendered - applied - tip; the old formula would have handed back the tip")
                .isEqualTo(10_000L);
    }

    /**
     * A tip on a tender where no money changes hands now is refused, and the refusal names the
     * field so the charge screen can bind it.
     */
    @Test
    void aTipIsRefusedOnATenderThatMovesNoMoneyNow() {
        OrderDto check = ringTwoPlates(OrderType.DINE_IN);

        assertThatThrownBy(() -> paymentService.recordPayment(
                check.id(), PaymentMethod.LOYALTY_POINTS, 100_000L, null, null, null, 10_000L))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("tip cannot be taken");

        assertThatThrownBy(() -> paymentService.recordPayment(
                check.id(), PaymentMethod.CARD, 100_000L, null, null, null, -1L))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("cannot be negative");

        assertThat(paymentService.listPayments(check.id()))
                .as("a refused tender must persist nothing")
                .isEmpty();
    }

    // ── (5) who may set it ────────────────────────────────────────────────────────────────

    /**
     * A cashier cannot re-price the building; a manager can read the rate they are asked about at
     * the table but not change it; the owner can do both.
     */
    @Test
    void aCashierCannotSetTheRateAndAManagerCanOnlyReadIt() {
        configure("5.00", "Service charge", true, false, false);

        asCashier();
        assertThatThrownBy(() -> serviceChargeService.update(branchId, new UpdateServiceChargeRequest(
                true, new BigDecimal("25.00"), "Service charge", true, false, false)))
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("pos.service_charge.manage");

        asManager();
        ServiceChargePolicyDto asManagerSees = serviceChargeService.get(branchId);
        assertThat(asManagerSees.enabled()).isTrue();
        assertThat(asManagerSees.ratePct()).isEqualByComparingTo("5.00");
        assertThat(asManagerSees.canManage())
                .as("the screen renders read-only from this, rather than refusing the page")
                .isFalse();
        assertThatThrownBy(() -> serviceChargeService.update(branchId, new UpdateServiceChargeRequest(
                true, new BigDecimal("25.00"), "Service charge", true, false, false)))
                .isInstanceOf(PermissionDeniedException.class);

        asOwner();
        assertThat(serviceChargeService.get(branchId).canManage()).isTrue();
    }

    /**
     * An unconfigured branch answers with a policy, never a 404 — see the DTO's javadoc.
     *
     * <p>This used to read {@code get(UUID.randomUUID())}, which passed only because the read
     * accepted any UUID on earth. That made the test a statement about two different things at
     * once — "a branch of mine with no row" and "a branch that is not mine" — and it was the
     * second one that was the defect. It now asks the question it was always meant to ask, about
     * the caller's OWN branch, which no test in this class has configured. The other half moved to
     * {@code ServiceChargeBranchIsolationIT}, where a foreign branch is required to 404.
     */
    @Test
    void anUnconfiguredBranchReadsAsNoServiceChargeRatherThanAnAbsence() {
        asOwner();
        ServiceChargePolicyDto policy = serviceChargeService.get(branchId);
        assertThat(policy.enabled()).isFalse();
        assertThat(policy.ratePct()).isEqualByComparingTo("0");
        assertThat(policy.label()).isEqualTo("Service charge");
        assertThat(policy.dineIn()).isTrue();
    }

    /** An armed control that charges nothing is worse than an absent one. Refused, by field. */
    @Test
    void anEnabledPolicyAtZeroPercentIsRefusedNamingTheField() {
        asOwner();
        assertThatThrownBy(() -> serviceChargeService.update(branchId, new UpdateServiceChargeRequest(
                true, BigDecimal.ZERO, "Service charge", true, false, false)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("percentage above 0");

        assertThatThrownBy(() -> serviceChargeService.update(branchId, new UpdateServiceChargeRequest(
                true, new BigDecimal("5.00"), "Service charge", false, false, false)))
                .isInstanceOf(FieldValidationException.class)
                .hasMessageContaining("at least one channel");
    }

    // ── helpers ───────────────────────────────────────────────────────────────────────────

    /**
     * The receipt assembler reads branch identity over feign. Fail-soft by design, but a stub
     * keeps the document's header deterministic and the test about the money.
     */
    private void stubBranch() {
        when(userBranchClient.getBranch(any(), any()))
                .thenReturn(new UserBranchClient.BranchDetail(
                        branchId, "Floating Terrace", null, null, null, null, null, "Asia/Karachi"));
    }

    private Persisted readBack(UUID orderId) {
        return new TransactionTemplate(transactionManager).execute(status -> {
            var row = orderRepository.findById(orderId).orElseThrow();
            return new Persisted(row.getSubtotalPaisa(), row.getDiscountPaisa(), row.getTaxPaisa(),
                    row.getServiceChargePaisa(), row.getServiceChargePct(),
                    row.getServiceChargeLabel(), row.getTotalPaisa(), row.getStatus());
        });
    }

    /** What Postgres actually holds, detached — so no assertion can accidentally lazy-load. */
    private record Persisted(long subtotalPaisa, long discountPaisa, long taxPaisa,
                             long serviceChargePaisa, BigDecimal serviceChargePct,
                             String serviceChargeLabel, long totalPaisa, OrderStatus status) {}
}
