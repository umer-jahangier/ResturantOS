package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.PrintDispatchService;
import io.restaurantos.pos.service.PrintJobService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.when;

/**
 * <b>The bill is produced when the guest pays, not when the kitchen marks the last plate served.</b>
 *
 * <h2>The defect this file exists for</h2>
 *
 * <p>Full-shift walkthrough §3-3, measured on 2026-08-12: order {@code ORD-20260812-0164} was paid
 * in cash at {@code 02:59:24} and its receipt was stamped
 * {@code *** REPRINT #2 *** Originally issued 2026-08-12T03:15:24.754Z} — the instant
 * <i>Mark served &amp; close order</i> was pressed, sixteen minutes later. Every
 * {@code CUSTOMER_RECEIPT} row in the live database carried the idempotency key
 * {@code dispatch:close:<orderId>}: the product genuinely believed a bill was something a CLOSE
 * produces. So the cashier handed over the change with no paper, and a guest who paid and left
 * before the kitchen bumped the last line got no bill at all — for them the close never came.
 *
 * <h2>Why the existing suite was green through all of it</h2>
 *
 * <p>{@code PrintDispatchIT.closingEnqueuesTheReceipt} and {@code PrintJobIssuanceIT.paidOrder}
 * both drive settlement through {@code closeViaServeAndPay}, which serves EVERY line first and pays
 * last. On that path payment and close land in the same transaction, so "the receipt exists after
 * settlement" and "the receipt exists after the close" are the same assertion and neither can tell
 * the two apart. This file settles a check that is <b>fired but not served</b> — the state a
 * restaurant actually takes money in — and stops there.
 *
 * <p>Watched fail before the fix: {@link #theBillExistsTheMomentTheCheckIsSettled} reported
 * {@code Expecting actual not to be empty}, and {@link #theOriginalIsStampedAtTenderNotAtClose}
 * reported the original's {@code issuedAt} arriving with the close rather than with the tender.
 */
class ReceiptAtTenderIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired PrintJobRepository printJobRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    @MockitoBean UserBranchClient userBranchClient;
    /** A SPY, not a mock: every test but {@link #aPrintFailureAtTenderDoesNotFailThePayment} needs
     *  the real issuance machinery, and that one needs a genuine throw from inside it. */
    @MockitoSpyBean PrintJobService printJobService;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    /** A branch with a receipt printer AND a kitchen printer — the shape F-7 actually has. */
    static final String FULL_REGISTRY = """
        {"agent":{"baseUrl":"http://127.0.0.1:7654","lanUrl":null},
         "printers":[
           {"id":"receipt-1","terminalId":null,"role":"RECEIPT","stationCode":null,
            "transport":"TCP","host":"10.0.7.21","port":9100,"systemPrinterName":null,
            "widthMm":80,"columns":48,"columnsMeasured":true,"codepage":"CP437",
            "cut":"PARTIAL","drawerPin":2,"drawerPulseMs":100},
           {"id":"kitchen-hot","terminalId":null,"role":"KITCHEN","stationCode":"HOT",
            "transport":"TCP","host":"10.0.7.31","port":9100,"systemPrinterName":null,
            "widthMm":80,"columns":48,"columnsMeasured":true,"codepage":"CP437",
            "cut":"FULL","drawerPin":null,"drawerPulseMs":null}],
         "header":null,"footer":null,"fbr":null,"kitchenStations":[]}
        """;

    /** No RECEIPT entry: the browser-bill branch of D-26-01. */
    static final String KITCHEN_ONLY_REGISTRY = """
        {"agent":{"baseUrl":"http://127.0.0.1:7654","lanUrl":null},
         "printers":[
           {"id":"kitchen-hot","terminalId":null,"role":"KITCHEN","stationCode":"HOT",
            "transport":"TCP","host":"10.0.7.31","port":9100,"systemPrinterName":null,
            "widthMm":80,"columns":48,"columnsMeasured":true,"codepage":"CP437",
            "cut":"FULL","drawerPin":null,"drawerPulseMs":null}],
         "header":null,"footer":null,"fbr":null,"kitchenStations":[]}
        """;

    @BeforeEach
    void setUp() {
        reset(printJobService);
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
        item.setBasePricePaisa(185_000L);
        item.setTaxRatePct(new BigDecimal("16.00"));
        item.setTaxRateCode("GST-16");
        item.setKdsStation("HOT");
        menuItemId = menuItemRepository.save(item).getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));
        registry(FULL_REGISTRY);
        openTillForCashier(branchId);
    }

    // ══ 1. THE ONE. Money in, paper out — with nothing served ═════════════════════════════════

    @Test
    @DisplayName("a check settled in full produces its bill at that moment, with nothing served")
    void theBillExistsTheMomentTheCheckIsSettled() {
        OrderDto order = firedOrder();

        payInFull(order);

        // The order is deliberately NOT closed: no line has been served, so the Paid-AND-Served
        // seam has not fired. This is the state the guest walks out in.
        OrderDto afterPayment = orderService.getOrder(order.id(), branchId);
        assertThat(afterPayment.status())
                .as("the point of this test is a bill on an order that has NOT been closed")
                .isEqualTo(OrderStatus.SENT_TO_KDS);

        List<PrintJob> bills = receipts(order.id());
        assertThat(bills)
                .as("the cashier has taken the money and handed over change; there must be a bill")
                .hasSize(1);

        PrintJob bill = bills.get(0);
        assertThat(bill.getIssueSeq()).as("this is the ORIGINAL, not a reprint").isEqualTo(1);
        assertThat(bill.getOriginalIssuedAt()).isNull();
        assertThat(bill.getStatus())
                .as("a branch with a receipt printer gets a job the agent can claim")
                .isEqualTo(PrintJobStatus.QUEUED);
        assertThat(bill.getTargetPrinterId()).isEqualTo("receipt-1");
        assertThat(bill.getRevisionNo())
                .as("a receipt carries a null revision and stays out of the revision index")
                .isNull();

        // Within seconds of the payment, not sixteen minutes later.
        Instant paidAt = onlyPayment(order.id()).recordedAt();
        assertThat(Duration.between(paidAt, bill.getIssuedAt()).abs())
                .as("issued %s, paid %s — the bill must be stamped at the tender", bill.getIssuedAt(), paidAt)
                .isLessThan(Duration.ofSeconds(10));
    }

    // ══ 2. The close afterwards is a no-op, and any later bill is a REPRINT ═══════════════════

    @Test
    @DisplayName("closing afterwards issues no second original; the next bill is a reprint of the tender's")
    void theOriginalIsStampedAtTenderNotAtClose() {
        OrderDto order = firedOrder();
        payInFull(order);

        PrintJob atTender = receipts(order.id()).get(0);
        Instant originalIssuedAt = atTender.getIssuedAt();

        // Now the kitchen catches up and the check closes.
        orderService.markAllItemsServed(order.id());
        assertThat(orderService.getOrder(order.id(), branchId).status()).isEqualTo(OrderStatus.CLOSED);

        assertThat(receipts(order.id()))
                .as("the close must not print a second bill for a guest who already left with theirs")
                .hasSize(1);
        assertThat(receipts(order.id()).get(0).getIssuedAt())
                .as("and it must not restamp the original either")
                .isEqualTo(originalIssuedAt);

        // The bill a cashier reaches AFTER the close — the Print bill button — is a reprint, and
        // it says what it is a reprint OF.
        PrintJobService.IssuedDocument reissued = printJobService.issue(order.id(), branchId, null);
        assertThat(reissued.document().issue().sequenceNumber()).isEqualTo(2L);
        assertThat(reissued.document().issue().reprint()).isTrue();
        assertThat(reissued.document().issue().originalIssuedAt())
                .as("the original this reprints is the TENDER's bill, not the close's")
                .isEqualTo(originalIssuedAt);
    }

    // ══ 3. A part-paid check is not a bill ════════════════════════════════════════════════════

    @Test
    @DisplayName("a part payment prints nothing; the bill appears when the last paisa lands")
    void aPartPaymentPrintsNothing() {
        OrderDto order = firedOrder();
        long total = orderService.getOrder(order.id(), branchId).totalPaisa();

        paymentService.recordPayment(order.id(), PaymentMethod.CASH, total / 2, null, null, null);
        assertThat(receipts(order.id()))
                .as("half the money is not a transaction the guest walks away from")
                .isEmpty();

        paymentService.recordPayment(order.id(), PaymentMethod.CASH, total - (total / 2), null, null, null);
        assertThat(receipts(order.id()))
                .as("the balance is settled — now there is a bill, exactly one")
                .hasSize(1);
    }

    // ══ 4. A branch with no receipt printer still prints in the browser ═══════════════════════

    @Test
    @DisplayName("a branch with no receipt printer enqueues nothing at tender either — not a failed row")
    void aBranchWithNoReceiptPrinterEnqueuesNothingAtTender() {
        registry(KITCHEN_ONLY_REGISTRY);
        OrderDto order = firedOrder();

        payInFull(order);

        // D-26-01: that tenant's bill comes out of the browser, and "prints in the browser" must
        // stay distinguishable from "the printer is broken" — no row versus a FAILED row.
        assertThat(receipts(order.id())).isEmpty();
        assertThat(printJobRepository.findHistoryForOrder(tenantId, order.id()))
                .allSatisfy(j -> assertThat(j.getDocumentType())
                        .isEqualTo(PrintDocument.DocumentType.KITCHEN_TICKET));
    }

    // ══ 5. A broken printer cannot refuse money the guest has handed over ═════════════════════

    @Test
    @DisplayName("a failure inside the receipt dispatch does not fail the tender")
    void aPrintFailureAtTenderDoesNotFailThePayment() {
        doThrow(new IllegalStateException("forced failure inside the receipt enqueue"))
                .when(printJobService).enqueueReceipt(any(), any(), anyString());

        OrderDto order = firedOrder();
        long total = orderService.getOrder(order.id(), branchId).totalPaisa();

        long applied = paymentService.recordPayment(order.id(), PaymentMethod.CASH, total, null, null, null);

        assertThat(applied)
                .as("the money must land whatever the printer is doing")
                .isEqualTo(total);
        assertThat(onlyPayment(order.id()).amountPaisa()).isEqualTo(total);
        assertThat(receipts(order.id()))
                .as("the receipt genuinely did not enqueue — that is the point of the forced failure")
                .isEmpty();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private void registry(String json) {
        when(userBranchClient.getBranch(any(), any())).thenReturn(new UserBranchClient.BranchDetail(
                branchId, "Floating Terrace", null, "+92 51 234 5678",
                "7000007-8", "17-00-9999-000-11", json, "Asia/Karachi"));
    }

    /** A check rung and fired, with NOTHING served — how a cashier meets an order at the till. */
    private OrderDto firedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id(), null);
        return orderService.getOrder(order.id(), branchId);
    }

    private void payInFull(OrderDto order) {
        long total = orderService.getOrder(order.id(), branchId).totalPaisa();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, total, total, null, null);
    }

    private OrderPaymentDto onlyPayment(UUID orderId) {
        List<OrderPaymentDto> rows = paymentService.listPayments(orderId);
        assertThat(rows).hasSize(1);
        return rows.get(0);
    }

    private List<PrintJob> receipts(UUID orderId) {
        return printJobRepository.findHistoryForOrder(tenantId, orderId).stream()
                .filter(j -> j.getDocumentType() == PrintDocument.DocumentType.CUSTOMER_RECEIPT)
                .toList();
    }

    /** Referenced so the key this whole file turns on cannot be renamed silently. */
    @SuppressWarnings("unused")
    private static final String AUTOMATIC_KEY_SHAPE =
            PrintDispatchService.automaticReceiptKey(new UUID(0, 0));
}
