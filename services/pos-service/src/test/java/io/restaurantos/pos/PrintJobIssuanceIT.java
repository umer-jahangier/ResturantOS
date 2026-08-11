package io.restaurantos.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.PrintJobService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Issuance, reprints, and the two things that make a reprint trustworthy: it is the SAME BYTES, and
 * it says it is a reprint.
 */
class PrintJobIssuanceIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired PrintJobService printJobService;
    @Autowired PrintJobRepository printJobRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;

    @MockitoBean UserBranchClient userBranchClient;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    static final String REGISTRY = """
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
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Chicken Karahi");
        item.setBasePricePaisa(185_000L);
        item.setTaxRatePct(new BigDecimal("16.00"));
        item.setTaxRateCode("GST-16");
        menuItemId = menuItemRepository.save(item).getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));
        when(userBranchClient.getBranch(any(), any())).thenReturn(new UserBranchClient.BranchDetail(
                branchId, "Floating Terrace", null, "+92 51 234 5678",
                "7000007-8", "17-00-9999-000-11", REGISTRY));

        openTillForCashier(branchId);
    }

    // ══ 1. The first issue ════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("the first issue is sequence one, not a reprint, and writes exactly one row")
    void firstIssue_isSequenceOne_andWritesOneRow() {
        OrderDto order = paidOrder();

        PrintJobService.IssuedDocument issued = printJobService.issue(order.id(), branchId, null);

        assertThat(issued.document().issue().sequenceNumber()).isEqualTo(1L);
        assertThat(issued.document().issue().reprint()).isFalse();
        assertThat(issued.document().issue().originalIssuedAt()).isNull();
        assertThat(issued.targetPrinterId()).isEqualTo("receipt-1");

        List<PrintJob> rows = printJobRepository.findHistoryForOrder(tenantId, order.id());
        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getStatus()).isEqualTo(PrintJobStatus.ISSUED);
        assertThat(rows.get(0).getDocument()).contains("CUSTOMER_RECEIPT");
    }

    // ══ 2. A reprint is the SAME BYTES ═══════════════════════════════════════════════════════

    @Test
    @DisplayName("a reprint is byte-identical to the original apart from its issue metadata")
    void reprint_isByteIdenticalApartFromIssueMetadata() throws Exception {
        OrderDto order = paidOrder();

        PrintJobService.IssuedDocument first = printJobService.issue(order.id(), branchId, null);
        PrintJobService.IssuedDocument second = printJobService.issue(order.id(), branchId, null);

        assertThat(second.document().issue().sequenceNumber()).isEqualTo(2L);
        assertThat(second.document().issue().reprint()).isTrue();
        assertThat(second.document().issue().originalIssuedAt())
                .as("a reprint must say what it is a reprint OF")
                .isEqualTo(first.document().issue().issuedAt());

        // Byte identity, asserted on the SERIALISED forms with only the issue block removed. Not
        // field-by-field: a field-by-field comparison only covers the fields somebody remembered
        // to list, and the whole point is that NOTHING else moved.
        String a = objectMapper.writeValueAsString(first.document());
        String b = objectMapper.writeValueAsString(second.document());
        assertThat(stripIssueBlock(b)).isEqualTo(stripIssueBlock(a));

        // And a third issue still copies the ORIGINAL, not the second one.
        PrintJobService.IssuedDocument third = printJobService.issue(order.id(), branchId, null);
        assertThat(third.document().issue().sequenceNumber()).isEqualTo(3L);
        assertThat(third.document().issue().originalIssuedAt())
                .isEqualTo(first.document().issue().issuedAt());
        assertThat(stripIssueBlock(objectMapper.writeValueAsString(third.document())))
                .isEqualTo(stripIssueBlock(a));
    }

    /**
     * The assembler runs ONCE, for the first issue, however many times the document is reprinted.
     *
     * <p>This is the assertion behind the byte-identity one. Two runs of an assembler agreeing is
     * not the same fact as the assembler having run once — and it is the second fact that survives
     * a price edit between the original and the reprint.
     */
    @Test
    @DisplayName("reprinting never calls the assembler again")
    void reprint_doesNotCallTheAssembler() {
        OrderDto order = paidOrder();

        printJobService.issue(order.id(), branchId, null);
        // The branch lookup is the assembler's only outbound call, so its invocation count is a
        // proxy for the assembler's — and unlike a spy on a @Service, it needs no proxy surgery.
        verify(userBranchClient, atLeastOnce()).getBranch(any(), any());
        org.mockito.Mockito.clearInvocations(userBranchClient);

        printJobService.issue(order.id(), branchId, null);
        printJobService.issue(order.id(), branchId, null);

        verify(userBranchClient, times(0)).getBranch(any(), any());
    }

    // ══ 3. Idempotency ═══════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("two issues with the same idempotency key are one issue, not two")
    void sameIdempotencyKey_returnsTheSameIssue_andWritesOneRow() {
        OrderDto order = paidOrder();
        String key = "settle-" + UUID.randomUUID();

        PrintJobService.IssuedDocument a = printJobService.issue(order.id(), branchId, key);
        PrintJobService.IssuedDocument b = printJobService.issue(order.id(), branchId, key);

        assertThat(b.printJobId()).isEqualTo(a.printJobId());
        assertThat(b.document().issue().sequenceNumber()).isEqualTo(a.document().issue().sequenceNumber());
        assertThat(printJobRepository.findHistoryForOrder(tenantId, order.id())).hasSize(1);
    }

    // ══ 4 & 5. Fetching ══════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("fetching a stored job re-serves it unchanged and allocates nothing")
    void fetch_reServesTheStoredBody_andAllocatesNothing() throws Exception {
        OrderDto order = paidOrder();
        PrintJobService.IssuedDocument issued = printJobService.issue(order.id(), branchId, null);

        PrintJobService.IssuedDocument fetched = printJobService.fetch(issued.printJobId());

        assertThat(objectMapper.writeValueAsString(fetched.document()))
                .isEqualTo(objectMapper.writeValueAsString(issued.document()));
        assertThat(printJobRepository.findHistoryForOrder(tenantId, order.id())).hasSize(1);
    }

    @Test
    @DisplayName("another tenant's job is NOT FOUND — never an empty document")
    void fetch_fromAnotherTenant_isNotFound() {
        OrderDto order = paidOrder();
        PrintJobService.IssuedDocument issued = printJobService.issue(order.id(), branchId, null);

        tenantContext.set(UUID.randomUUID(), branchId, UUID.randomUUID(), null);

        assertThatThrownBy(() -> printJobService.fetch(issued.printJobId()))
                .isInstanceOf(io.restaurantos.shared.exception.ResourceNotFoundException.class);
    }

    // ══ 7. Concurrency ═══════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("two concurrent issues never receive the same sequence number")
    void concurrentIssues_doNotShareASequenceNumber() throws Exception {
        OrderDto order = paidOrder();
        printJobService.issue(order.id(), branchId, null);   // seq 1, warms the slot

        UUID tid = tenantId;
        UUID bid = branchId;
        UUID cid = cashierId;
        UUID oid = order.id();

        Callable<Long> task = () -> {
            tenantContext.set(tid, bid, cid, null);
            try {
                return printJobService.issue(oid, bid, null).document().issue().sequenceNumber();
            } finally {
                tenantContext.clear();
            }
        };

        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Long> f1 = pool.submit(task);
            Future<Long> f2 = pool.submit(task);
            Long s1 = resultOrNull(f1);
            Long s2 = resultOrNull(f2);

            // Either both succeeded with DIFFERENT numbers, or one lost the race and failed
            // loudly. What must never happen is both succeeding with the same number, which is
            // two pieces of paper claiming to be the same issue.
            if (s1 != null && s2 != null) {
                assertThat(s1).isNotEqualTo(s2);
            }
            List<PrintJob> rows = printJobRepository.findHistoryForOrder(tid, oid);
            assertThat(rows.stream().map(PrintJob::getIssueSeq).distinct().count())
                    .as("every persisted row must carry a distinct sequence")
                    .isEqualTo(rows.size());
        } finally {
            pool.shutdownNow();
            tenantContext.set(tid, bid, cid, null);
        }
    }

    // ══ 8. The two-station case the index revision exists for ════════════════════════════════

    /**
     * Two kitchen tickets, same order, same document type, DIFFERENT targets, both sequence one.
     *
     * <p>This is the case a unique index scoped to (tenant, order, type, seq) would break on the
     * very first multi-station fire — the second station's ticket would collide with the first
     * station's and the order would fail to fire. It is asserted here, in 26-03, rather than
     * discovered in 26-07, because the index is written here.
     */
    @Test
    @DisplayName("two stations of one order each get sequence one for their own printer")
    void twoStationTickets_forOneOrder_eachStartAtSequenceOne() {
        UUID orderId = UUID.randomUUID();

        PrintJob hot = kitchenTicketRow(orderId, "kitchen-hot", 1, 1);
        PrintJob cold = kitchenTicketRow(orderId, "kitchen-cold", 1, 1);

        printJobRepository.saveAndFlush(hot);
        printJobRepository.saveAndFlush(cold);

        List<PrintJob> rows = printJobRepository.findHistoryForOrder(tenantId, orderId);
        assertThat(rows).hasSize(2);
        assertThat(rows).allMatch(j -> j.getIssueSeq() == 1);
        assertThat(rows.stream().map(PrintJob::getTargetPrinterId))
                .containsExactlyInAnyOrder("kitchen-hot", "kitchen-cold");

        // And the revision key still bites within ONE target: a retried dispatch of the same
        // revision to the same station must not print a second ticket (26-07's guard).
        PrintJob duplicate = kitchenTicketRow(orderId, "kitchen-hot", 2, 1);
        assertThatThrownBy(() -> printJobRepository.saveAndFlush(duplicate))
                .as("uq_print_jobs_revision must refuse a second ticket for the same revision")
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private PrintJob kitchenTicketRow(UUID orderId, String target, int seq, int revision) {
        PrintJob job = new PrintJob();
        job.setTenantId(tenantId);
        job.setBranchId(branchId);
        job.setOrderId(orderId);
        job.setDocumentType(PrintDocument.DocumentType.KITCHEN_TICKET);
        job.setTargetPrinterId(target);
        job.setIssueSeq(seq);
        job.setRevisionNo(revision);
        job.setStatus(PrintJobStatus.ISSUED);
        job.setDocument("{\"schemaVersion\":\"1.0\",\"type\":\"KITCHEN_TICKET\"}");
        job.setIssuedAt(java.time.Instant.now());
        return job;
    }

    private static Long resultOrNull(Future<Long> future) {
        try {
            return future.get();
        } catch (Exception e) {
            return null;   // lost the race; the assertion above covers what that must mean
        }
    }

    /** The serialised document with its issue block removed, so only the body remains. */
    private static String stripIssueBlock(String json) {
        return json.replaceAll("\"issue\":\\{[^}]*}", "\"issue\":{}");
    }

    private OrderDto paidOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        for (OrderDto.OrderItemDto item : sent.items()) {
            orderService.markItemServed(order.id(), item.id());
        }
        long total = orderService.getOrder(order.id(), branchId).totalPaisa();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, total, null);
        return orderService.getOrder(order.id(), branchId);
    }
}
