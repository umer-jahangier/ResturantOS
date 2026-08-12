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
import io.restaurantos.pos.service.PrintAgentEnrolmentService;
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
    @Autowired PrintAgentEnrolmentService enrolmentService;
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
                "7000007-8", "17-00-9999-000-11", REGISTRY, "Asia/Karachi"));

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
        /*
         * QUEUED, not ISSUED — and this assertion was left saying ISSUED for a phase, RED, in a
         * suite nobody re-ran.
         *
         * S1-06 made a ROUTED issue land in QUEUED on purpose: the agent's work query selects
         * `status = 'QUEUED'`, so an ISSUED row addressed to a real printer is a row no agent will
         * ever claim — the branch has a thermal printer, the job exists, and the only paper that
         * can ever appear is a browser dialog. That is the register's "window.print() count 2,
         * agent calls 0" from the server end, and it is fixed. The status is asserted here so the
         * fix cannot be undone by an "obvious" simplification later.
         *
         * The sentence's other half — that an UNROUTED issue stays ISSUED — is the next test.
         */
        assertThat(rows.get(0).getStatus()).isEqualTo(PrintJobStatus.QUEUED);
        assertThat(rows.get(0).getDocument()).contains("CUSTOMER_RECEIPT");
    }

    /**
     * The branch with NO receipt printer. Its row must stay {@code ISSUED}: nothing is going to
     * collect it, the document exists and was handed over, and the browser dialog is the honest and
     * only path (D-26-01). Queueing it would put a job in front of an agent that can never address
     * it, and the bill screen would show a bill "printing" for ever.
     */
    @Test
    @DisplayName("a branch with no receipt printer issues to the sentinel and stays ISSUED")
    void unroutedIssue_staysIssued() {
        // Built while the branch still HAS a printer, so `paidOrder`'s own dispatch assertion still
        // means what it says; the registry is emptied afterwards, and `paidOrder` has already
        // cleared the rows, so the issue below assembles from scratch against the empty one.
        OrderDto order = paidOrder();

        when(userBranchClient.getBranch(any(), any())).thenReturn(new UserBranchClient.BranchDetail(
                branchId, "Floating Terrace", null, "+92 51 234 5678",
                "7000007-8", "17-00-9999-000-11",
                "{\"printers\":[],\"kitchenStations\":[],\"agent\":null,"
                        + "\"header\":null,\"footer\":null,\"fbr\":null}", "Asia/Karachi"));

        PrintJobService.IssuedDocument issued = printJobService.issue(order.id(), branchId, null);

        assertThat(issued.targetPrinterId()).isEqualTo(PrintJob.UNASSIGNED_TARGET);
        assertThat(issued.status()).isEqualTo(PrintJobStatus.ISSUED);
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

    // ══ 9. The bill screen must be able to tell "queued" from "queued and nothing is coming" ══

    /**
     * F8. The receipt screen rendered <b>"Sent to the receipt printer … the branch print agent will
     * put it on paper"</b> for every routed bill, and said it whether or not a single agent had ever
     * polled. Measured live on 2026-08-12: nine enrolled agents on Floating Terrace F-7, every one
     * of them reading "Not responding", and the cashier told paper was coming.
     *
     * <p>The screen could not have known better: the ONE response it is entitled to — the issue of
     * its own bill — carried a printer id and nothing else, and the endpoint that knows about agents
     * carries {@code pos.printers.admin}, which a cashier does not hold. So the fix is here, on the
     * response, and these assertions are what make the screen's four different sentences possible.
     */
    @Test
    @DisplayName("an issued bill carries the branch's agent presence, so the screen can stop guessing")
    void issue_carriesAgentPresence() {
        OrderDto order = paidOrder();

        // Nothing enrolled. The row is QUEUED and NOTHING is going to collect it — two facts the
        // screen has to be able to state together, because "queued" alone reads as "on its way".
        PrintJobService.IssuedDocument orphan = printJobService.issue(order.id(), branchId, null);
        assertThat(orphan.status()).isEqualTo(PrintJobStatus.QUEUED);
        assertThat(orphan.agent().enrolled()).isZero();
        assertThat(orphan.agent().label()).isNull();
        assertThat(orphan.agent().lastSeenAt()).isNull();

        // Enrolled and NAMED — but it has never polled, so there is still no evidence it can print.
        // "Enrolled" must never be readable as "answering"; that conflation is the whole finding.
        PrintAgentEnrolmentService.Enrolled agent = enrolmentService.enrol(branchId, "Back office PC");
        PrintJobService.IssuedDocument named = printJobService.issue(order.id(), branchId, null);
        assertThat(named.agent().enrolled()).isEqualTo(1);
        assertThat(named.agent().label()).isEqualTo("Back office PC");
        assertThat(named.agent().lastSeenAt()).isNull();

        // It polls. The timestamp is the ONLY evidence this product has that a machine is in a
        // position to put paper in a customer's hand, and it is now on the cashier's own response.
        enrolmentService.recordSeen(agent.agentId());
        PrintJobService.IssuedDocument live = printJobService.issue(order.id(), branchId, null);
        assertThat(live.agent().lastSeenAt()).isNotNull();
        assertThat(live.agent().label()).isEqualTo("Back office PC");
    }

    @Test
    @DisplayName("a revoked agent is not presence — the screen must not count a machine we refuse")
    void revokedAgent_isNotCountedAsPresence() {
        OrderDto order = paidOrder();
        PrintAgentEnrolmentService.Enrolled agent = enrolmentService.enrol(branchId, "Old till");
        enrolmentService.recordSeen(agent.agentId());
        enrolmentService.revoke(agent.agentId());

        PrintJobService.IssuedDocument issued = printJobService.issue(order.id(), branchId, null);

        // Its credential is refused on the very next poll, so it will never claim this job. A
        // presence count that included it would put "printing…" on screen for ever.
        assertThat(issued.agent().enrolled()).isZero();
        assertThat(issued.agent().label()).isNull();
        assertThat(issued.agent().lastSeenAt()).isNull();
    }

    /**
     * The screen watches this row until the agent's own acknowledgement arrives. If {@code fetch}
     * did not re-read the CURRENT status, "Printing…" would never become "Printed" and the product
     * would be back to predicting.
     */
    @Test
    @DisplayName("re-serving a job reports its CURRENT status, so a screen can watch it reach paper")
    void fetch_reportsTheLiveStatus() {
        OrderDto order = paidOrder();
        PrintJobService.IssuedDocument issued = printJobService.issue(order.id(), branchId, null);
        assertThat(issued.status()).isEqualTo(PrintJobStatus.QUEUED);

        PrintJob row = printJobRepository.findScoped(tenantId, issued.printJobId()).orElseThrow();
        row.setStatus(PrintJobStatus.PRINTED);
        printJobRepository.saveAndFlush(row);

        assertThat(printJobService.fetch(issued.printJobId()).status())
                .isEqualTo(PrintJobStatus.PRINTED);
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

    /**
     * A settled order with a CLEAN print history.
     *
     * <p><b>Why the clearing step exists (26-07).</b> Firing an order now enqueues a kitchen ticket
     * and closing one now enqueues the customer receipt, both dispatched after their transaction
     * commits. So by the time this helper returns, {@code print_jobs} already holds two rows — and
     * every assertion in this file is about the ISSUE and REPRINT machinery, which starts counting
     * from an empty slot. Left in place, the auto-enqueued receipt would take sequence 1 and the
     * first explicit {@code issue()} would come back stamped "REPRINT #2".
     *
     * <p>The rows are ASSERTED before they are removed, so this helper cannot quietly paper over a
     * dispatch regression: if 26-07's dispatch stops firing, this fails here rather than somewhere
     * confusing later. The dispatch behaviour itself is proved in {@code PrintDispatchIT}.
     *
     * <p>A hard delete, deliberately: {@code lockSlotForSequence} and {@code findFirstIssue} do not
     * filter on {@code deletedAt}, so a soft-deleted row would still occupy sequence 1.
     */
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

        List<PrintJob> dispatched = printJobRepository.findHistoryForOrder(tenantId, order.id());
        assertThat(dispatched)
                .as("26-07 must have dispatched a kitchen ticket on the fire and a receipt on the close")
                .hasSize(2);
        assertThat(dispatched.stream().map(PrintJob::getDocumentType))
                .containsExactlyInAnyOrder(PrintDocument.DocumentType.KITCHEN_TICKET,
                        PrintDocument.DocumentType.CUSTOMER_RECEIPT);
        printJobRepository.deleteAllInBatch(dispatched);

        return orderService.getOrder(order.id(), branchId);
    }
}
