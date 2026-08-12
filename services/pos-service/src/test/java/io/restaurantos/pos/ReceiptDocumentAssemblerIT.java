package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.ApplyDiscountRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.ReceiptDocumentAssembler;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.print.ReceiptAmount;
import io.restaurantos.shared.print.ReceiptMoneyFormatter;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The receipt is assembled from PERSISTED money and from nothing else.
 *
 * <p>Every assertion below is on integers first and on the rendered string second, in that order,
 * because GA-007 is a screen that rendered raw paisa and made every total one hundred times too
 * large. A receipt is the same defect with the customer holding the evidence, so the paisa and the
 * string are checked against each other on every amount the document carries.
 */
class ReceiptDocumentAssemblerIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired ReceiptDocumentAssembler assembler;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;
    @Autowired TenantContext tenantContext;

    /** Mocked so this suite controls the printer registry rather than dialing a service. */
    @MockitoBean UserBranchClient userBranchClient;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID karahiId;
    UUID waterId;
    MenuCategory category;

    /** Rs 1,850.00 at 16% — the food line. */
    static final long KARAHI_PAISA = 185_000L;
    /** Rs 80.33 at 5% — chosen so the tax lands on a non-zero paisa remainder. */
    static final long WATER_PAISA = 8_033L;

    static final String CONFIGURED_REGISTRY = """
        {"agent":{"baseUrl":"http://127.0.0.1:7654","lanUrl":null},
         "printers":[
           {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
            "transport":"TCP","host":"10.0.7.21","port":9100,"systemPrinterName":null,
            "widthMm":80,"columns":48,"columnsMeasured":true,"codepage":"CP437",
            "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":100}],
         "header":null,"footer":null,"fbr":null,"kitchenStations":[]}
        """;

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
        category = menuCategoryRepository.save(cat);
        cat = category;

        karahiId = saveItem(cat, "Chicken Karahi", KARAHI_PAISA, "16.00", "GST-16");
        waterId = saveItem(cat, "Mineral Water 1.5L", WATER_PAISA, "5.00", "ICT-05");

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));

        // An ORDER-scope discount consults OPA and reads the caller's principal, so the fixture
        // needs a real SecurityContext — the same shape VoidRefundOpaIT uses.
        JwtClaims claims = new JwtClaims(cashierId, tenantId, branchId,
                List.of("MANAGER"), List.of("pos.order.discount.override"), Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));

        stubBranch(CONFIGURED_REGISTRY);
        openTillForCashier(branchId);
    }

    private UUID saveItem(MenuCategory cat, String name, long pricePaisa, String ratePct, String rateCode) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName(name);
        item.setBasePricePaisa(pricePaisa);
        item.setTaxRatePct(new BigDecimal(ratePct));
        item.setTaxRateCode(rateCode);
        return menuItemRepository.save(item).getId();
    }

    private void stubBranch(String receiptConfigJson) {
        when(userBranchClient.getBranch(any(), any())).thenReturn(new UserBranchClient.BranchDetail(
                branchId, "Floating Terrace",
                "{\"line1\":\"Street 12, F-7 Markaz\",\"city\":\"Islamabad\"}",
                "+92 51 234 5678", "7000007-8", "17-00-9999-000-11",
                receiptConfigJson));
    }

    // ══ 1 & 2. The totals ARE the order's totals, to the paisa ════════════════════════════════

    @Test
    @DisplayName("every total on the document equals the order row's own paisa value")
    void totalsEqualThePersistedOrderExactly() {
        OrderDto order = servedOrderWithDiscountAndServiceCharge();
        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();

        OrderDto persisted = orderService.getOrder(order.id(), branchId);

        assertThat(doc.totals().subtotal().paisa()).isEqualTo(persisted.subtotalPaisa());
        assertThat(doc.totals().discount().paisa()).isEqualTo(persisted.discountPaisa());
        assertThat(doc.totals().serviceCharge().paisa()).isEqualTo(persisted.serviceChargePaisa());
        assertThat(doc.totals().tax().paisa()).isEqualTo(persisted.taxPaisa());
        assertThat(doc.totals().grandTotal().paisa()).isEqualTo(persisted.totalPaisa());

        // The service charge is genuinely non-zero on this fixture, so the field is exercised
        // rather than passing by being zero on both sides.
        assertThat(persisted.serviceChargePaisa()).isPositive();
        assertThat(persisted.discountPaisa()).isPositive();

        // Two rate codes, and the breakdown sums to the printed tax total exactly.
        assertThat(doc.taxBreakdown()).hasSize(2);
        assertThat(doc.taxBreakdown().stream().map(PrintDocument.TaxLine::rateCode))
                .containsExactlyInAnyOrder("GST-16", "ICT-05");
        long taxSum = doc.taxBreakdown().stream().mapToLong(t -> t.amount().paisa()).sum();
        assertThat(taxSum).isEqualTo(doc.totals().tax().paisa());
    }

    // ══ F6. The breakdown line is written for the guest, not for the ledger ═══════════════════

    /**
     * The walkthrough found `Tax (16.00%) [OTHER]` on a bill; the live re-run found worse —
     * `SR-STD-17 (17.00%) [SR-STD-17]`, because the assembler used the rate CODE as the label for
     * every classified item and only rescued the unclassified one. The renderers then appended the
     * code a second time. This is the server half.
     *
     * <p>The code itself still travels on the document: it is the identity of the bucket, and a
     * stored print job is what a support engineer reads six weeks later. It is simply not a word
     * the paper says.
     */
    @Test
    @DisplayName("every breakdown line is labelled in words, never with the ledger rate code")
    void theBreakdownIsLabelledForAGuestNotForTheLedger() {
        OrderDto order = servedOrderWithDiscountAndServiceCharge();
        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();

        assertThat(doc.taxBreakdown()).hasSize(2);
        for (PrintDocument.TaxLine line : doc.taxBreakdown()) {
            assertThat(line.rateCode())
                    .as("the bucket keeps its machine identity on the document")
                    .isNotBlank();
            assertThat(line.label())
                    .as("the guest's bill would read \"%s\" — a ledger classification, not a phrase",
                            line.label())
                    .isNotEqualTo(line.rateCode())
                    .isEqualTo("Sales Tax");
            assertThat(line.ratePercent())
                    .as("a tax line with no percentage cannot be checked by the person paying it")
                    .isNotNull();
        }
        assertThat(doc.taxBreakdown().stream().map(PrintDocument.TaxLine::ratePercent))
                .containsExactlyInAnyOrder("16.00", "5.00");
    }

    /**
     * An item with no rate code lands in a residual bucket the ASSEMBLER invents and calls
     * {@code OTHER}. `OTHER` is not a tax anyone charges — it is a sentinel — and it reached a
     * customer's paper. Two unclassified items at different rates used to share that one bucket,
     * so the line stated the FIRST rate against the SUM of both: a percentage that produces no
     * amount on the bill. Making the label authoritative without fixing that would have turned a
     * visibly-odd line into a quietly wrong one.
     */
    @Test
    @DisplayName("unclassified rates get a line each, so no printed percentage is a lie")
    void unclassifiedRatesAreNotLumpedUnderOnePercentage() {
        long base = 100_000L; // Rs 1,000.00 — round, so no rounding mode is on trial here
        UUID plainSixteen = saveItem(category, "Unclassified 16", base, "16.00", null);
        UUID plainFive = saveItem(category, "Unclassified 5", base, "5.00", null);

        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(plainSixteen, branchId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(plainFive, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        for (OrderDto.OrderItemDto item : sent.items()) {
            orderService.markItemServed(order.id(), item.id());
        }

        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();

        assertThat(doc.taxBreakdown()).hasSize(2);
        assertThat(doc.taxBreakdown().stream().map(PrintDocument.TaxLine::ratePercent))
                .containsExactlyInAnyOrder("16.00", "5.00");
        for (PrintDocument.TaxLine line : doc.taxBreakdown()) {
            assertThat(line.label()).isEqualTo("Sales Tax");
            long stated = new BigDecimal(line.ratePercent())
                    .movePointLeft(2)
                    .multiply(BigDecimal.valueOf(base))
                    .setScale(0, java.math.RoundingMode.HALF_UP)
                    .longValueExact();
            assertThat(line.amount().paisa())
                    .as("the line prints %s%%, so its amount must be that much of Rs 1,000.00",
                            line.ratePercent())
                    .isEqualTo(stated);
        }
        long sum = doc.taxBreakdown().stream().mapToLong(t -> t.amount().paisa()).sum();
        assertThat(sum)
                .as("the breakdown must still add up to the printed tax total, exactly")
                .isEqualTo(doc.totals().tax().paisa());
    }

    @Test
    @DisplayName("the document's own money identities hold as integers")
    void theDocumentsMoneyIdentitiesHold() {
        OrderDto order = servedOrderWithDiscountAndServiceCharge();
        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();
        OrderDto persisted = orderService.getOrder(order.id(), branchId);

        // Identity 1, stated in the shape THIS codebase computes: `subtotal` is GROSS — before
        // line discounts and before tax — so it equals Σ(lineTotal + lineDiscount − lineTax),
        // NOT Σ lineTotal. (OrderPricingCalculator.aggregateOrderTotals.)
        long lineTotals = doc.lines().stream().mapToLong(l -> l.lineTotal().paisa()).sum();
        long lineDiscounts = persisted.items().stream()
                .mapToLong(OrderDto.OrderItemDto::discountPaisa).sum();
        long lineTaxes = persisted.items().stream()
                .mapToLong(OrderDto.OrderItemDto::taxPaisa).sum();
        assertThat(lineTotals + lineDiscounts - lineTaxes).isEqualTo(doc.totals().subtotal().paisa());

        // Identity 2: subtotal − discount + tax + service charge == total.
        assertThat(doc.totals().subtotal().paisa()
                - doc.totals().discount().paisa()
                + doc.totals().tax().paisa()
                + doc.totals().serviceCharge().paisa())
                .isEqualTo(doc.totals().grandTotal().paisa());
    }

    /** The assembler refuses rather than printing a bill that does not add up. */
    @Test
    @DisplayName("a corrupted order total makes the assembler REFUSE, not print")
    void anOrderThatDoesNotAddUpIsRefused() {
        OrderDto order = servedOrderWithDiscountAndServiceCharge();

        Order row = orderRepository.findById(order.id()).orElseThrow();
        row.setTotalPaisa(row.getTotalPaisa() + 1L);   // one paisa of corruption
        orderRepository.saveAndFlush(row);

        assertThatThrownBy(() -> assembler.assembleReceipt(order.id(), branchId))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("Refusing to print");
    }

    // ══ 3. Tenders ════════════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("the tenders equal the persisted payments, and a cash tender carries change")
    void tendersMirrorThePersistedPaymentRows() {
        OrderDto order = servedOrderWithDiscountAndServiceCharge();
        long total = orderService.getOrder(order.id(), branchId).totalPaisa();
        // Over-tender: the customer hands over a round Rs 5,000 note.
        long handedOver = 500_000L;
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, handedOver, null);

        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();
        List<OrderPaymentDto> payments = paymentService.listPayments(order.id());

        assertThat(doc.tenders()).hasSize(payments.size());
        long documentApplied = doc.tenders().stream().mapToLong(t -> t.amountApplied().paisa()).sum();
        long persistedApplied = payments.stream().mapToLong(OrderPaymentDto::amountPaisa).sum();
        assertThat(documentApplied).isEqualTo(persistedApplied).isEqualTo(total);

        PrintDocument.Tender cash = doc.tenders().get(0);
        assertThat(cash.method()).isEqualTo("CASH");
        assertThat(cash.amountTendered().paisa()).isEqualTo(handedOver);
        assertThat(cash.change().paisa()).isEqualTo(handedOver - total);
        assertThat(cash.change().paisa()).isPositive();
    }

    // ══ 4. Every rendered string re-parses ════════════════════════════════════════════════════

    @Test
    @DisplayName("every amount on the document re-parses to its own paisa value")
    void everyAmountReParsesToItsOwnPaisa() {
        OrderDto order = paidOrder(PaymentMethod.CASH);
        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();

        List<ReceiptAmount> amounts = collectAmounts(doc);
        assertThat(amounts).hasSizeGreaterThan(10);
        for (ReceiptAmount amount : amounts) {
            assertThat(ReceiptMoneyFormatter.parse(amount.formatted()))
                    .as("%s must re-parse to %d paisa", amount.formatted(), amount.paisa())
                    .isEqualTo(amount.paisa());
        }
        // And at least one of them carries a real paisa remainder, so the assertion has teeth.
        assertThat(amounts).anyMatch(a -> a.paisa() % 100 != 0);
    }

    // ══ 5. The drawer ═════════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a cash tender opens the drawer with the CONFIGURED pin and pulse; a card does not")
    void cashOpensTheDrawerFromConfiguration_andCardDoesNot() {
        OrderDto cashOrder = paidOrder(PaymentMethod.CASH);
        PrintDocument cashDoc = assembler.assembleReceipt(cashOrder.id(), branchId).document();

        assertThat(cashDoc.drawer()).isNotNull();
        assertThat(cashDoc.drawer().kick()).isTrue();
        assertThat(cashDoc.drawer().connectorPin()).isEqualTo(2);
        assertThat(cashDoc.drawer().pulseMs()).isEqualTo(100);
        assertThat(cashDoc.cut().mode()).isEqualTo(PrintDocument.CutMode.PARTIAL);

        OrderDto cardOrder = paidOrder(PaymentMethod.CARD);
        PrintDocument cardDoc = assembler.assembleReceipt(cardOrder.id(), branchId).document();
        assertThat(cardDoc.drawer())
                .as("a card-only order must not open the till")
                .isNull();
    }

    // ══ 6 & 7. Degradation — a tenant with no printer still gets a bill (D-26-01, DoD 6) ═════

    @Test
    @DisplayName("a branch with NO printer configured still gets a document")
    void aBranchWithNoPrinterStillGetsABill() {
        stubBranch(null);
        OrderDto order = paidOrder(PaymentMethod.CASH);

        ReceiptDocumentAssembler.Assembled assembled = assembler.assembleReceipt(order.id(), branchId);
        PrintDocument doc = assembled.document();

        assertThat(doc.totals().grandTotal().paisa()).isPositive();
        assertThat(doc.drawer()).as("nothing to kick").isNull();
        assertThat(doc.cut().mode())
                .as("conservative: never command a cut on hardware we know nothing about")
                .isEqualTo(PrintDocument.CutMode.NONE);
        assertThat(assembled.targetPrinterId()).isEqualTo("unassigned");
        // The header still prints — the branch identity is not the printer registry.
        assertThat(doc.header().branchName()).isEqualTo("Floating Terrace");
        assertThat(doc.footer().lines()).anyMatch(l -> l.contains("No printer configured"));
    }

    @Test
    @DisplayName("user-service unreachable degrades the document and never fails the settlement")
    void anUnreachableUserServiceDegradesRatherThanBlocks() {
        when(userBranchClient.getBranch(any(), any()))
                .thenThrow(new IllegalStateException("connection refused"));
        OrderDto order = paidOrder(PaymentMethod.CASH);

        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();

        assertThat(doc.totals().grandTotal().paisa()).isPositive();
        assertThat(doc.drawer()).isNull();
        assertThat(doc.cut().mode()).isEqualTo(PrintDocument.CutMode.NONE);
        assertThat(doc.header()).isNull();
        // Recorded ON THE PAPER, so a support engineer reading a reprint six weeks later can tell
        // why the drawer did not open.
        assertThat(doc.footer().lines())
                .anyMatch(l -> l.contains("Printer configuration unavailable"));
    }

    // ══ 8. The fiscal region exists and is empty — Phase 27 owns FBR ══════════════════════════

    @Test
    @DisplayName("the fiscal region is PRESENT and entirely null (D-26-03; Phase 27 populates it)")
    void theFiscalRegionIsDeclaredAndEmpty() {
        OrderDto order = paidOrder(PaymentMethod.CASH);
        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();

        assertThat(doc.fiscal()).as("the region is reserved, not omitted").isNotNull();
        assertThat(doc.fiscal().fbrInvoiceNumber()).isNull();
        assertThat(doc.fiscal().qrPayload()).isNull();
        assertThat(doc.fiscal().qrSizeMm()).isNull();
        assertThat(doc.fiscal().logoAssetId()).isNull();
        assertThat(doc.fiscal().noticeLine()).isNull();
    }

    // ══ 9. Cancelled lines are not billable ══════════════════════════════════════════════════

    @Test
    @DisplayName("a cancelled line does not appear on the bill, and the totals still balance")
    void cancelledLinesAreNotBilled() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(karahiId, branchId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(waterId, branchId, 2, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);

        UUID waterLineId = sent.items().stream()
                .filter(i -> i.menuItemId().equals(waterId)).findFirst().orElseThrow().id();
        orderService.cancelItem(order.id(), waterLineId);

        OrderDto afterCancel = orderService.getOrder(order.id(), branchId);
        for (OrderDto.OrderItemDto item : afterCancel.items()) {
            if (item.menuItemId().equals(karahiId)) {
                orderService.markItemServed(order.id(), item.id());
            }
        }
        long total = orderService.getOrder(order.id(), branchId).totalPaisa();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, total, null);

        PrintDocument doc = assembler.assembleReceipt(order.id(), branchId).document();

        assertThat(doc.lines()).hasSize(1);
        assertThat(doc.lines().get(0).name()).isEqualTo("Chicken Karahi");
        // The identities still hold with the cancelled line excluded, which is the point: the
        // aggregation excludes it too, so the two agree.
        assertThat(doc.totals().subtotal().paisa()
                - doc.totals().discount().paisa()
                + doc.totals().tax().paisa()
                + doc.totals().serviceCharge().paisa())
                .isEqualTo(doc.totals().grandTotal().paisa());
    }

    // ══ 10. Another tenant's order is not assemblable ════════════════════════════════════════

    @Test
    @DisplayName("an order belonging to another tenant cannot be assembled into a receipt")
    void anotherTenantsOrderIsNotAssemblable() {
        OrderDto order = paidOrder(PaymentMethod.CASH);

        UUID otherTenant = UUID.randomUUID();
        tenantContext.set(otherTenant, branchId, UUID.randomUUID(), null);

        assertThatThrownBy(() -> assembler.assembleReceipt(order.id(), branchId))
                .as("never a document, and never an empty one either")
                .isInstanceOf(RuntimeException.class);
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────────────────────

    /**
     * A served order with two items, a line discount and a NON-ZERO service charge.
     *
     * <p>The service charge is written directly onto the row, with the total adjusted by the same
     * amount so both identities still hold: pos-service has no public seam that sets one, and a
     * fixture where the field is zero on both sides would let a receipt that ignores it pass.
     */
    private OrderDto servedOrderWithDiscountAndServiceCharge() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(karahiId, branchId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(waterId, branchId, 2, null, null));
        orderService.applyDiscount(order.id(),
                new ApplyDiscountRequest("ORDER", null, "FLAT", new BigDecimal("100.00")));

        OrderDto sent = orderService.sendToKds(order.id(), null);
        for (OrderDto.OrderItemDto item : sent.items()) {
            orderService.markItemServed(order.id(), item.id());
        }

        Order row = orderRepository.findById(order.id()).orElseThrow();
        long serviceCharge = 22_706L;
        row.setServiceChargePaisa(serviceCharge);
        row.setTotalPaisa(row.getTotalPaisa() + serviceCharge);
        orderRepository.saveAndFlush(row);

        return orderService.getOrder(order.id(), branchId);
    }

    /** A served, fully-settled order paid with a single tender of the given method. */
    private OrderDto paidOrder(PaymentMethod method) {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(karahiId, branchId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(waterId, branchId, 2, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        for (OrderDto.OrderItemDto item : sent.items()) {
            orderService.markItemServed(order.id(), item.id());
        }
        long total = orderService.getOrder(order.id(), branchId).totalPaisa();
        paymentService.recordPayment(order.id(), method, total, null);
        return orderService.getOrder(order.id(), branchId);
    }

    private static List<ReceiptAmount> collectAmounts(PrintDocument doc) {
        List<ReceiptAmount> out = new ArrayList<>();
        doc.lines().forEach(l -> {
            out.add(l.unitPrice());
            out.add(l.lineTotal());
        });
        out.add(doc.totals().subtotal());
        out.add(doc.totals().discount());
        out.add(doc.totals().serviceCharge());
        out.add(doc.totals().tax());
        out.add(doc.totals().grandTotal());
        doc.taxBreakdown().forEach(t -> out.add(t.amount()));
        doc.tenders().forEach(t -> {
            out.add(t.amountApplied());
            out.add(t.amountTendered());
            out.add(t.change());
        });
        return out;
    }
}
