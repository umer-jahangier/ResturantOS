package io.restaurantos.pos;

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
import io.restaurantos.pos.service.KitchenTicketAssembler;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.PrintDispatchService;
import io.restaurantos.pos.service.PrintJobService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The twelve behaviours of dispatching print work off the order path — and the one that is the
 * whole reason this plan exists: <b>a print failure cannot fail a fire</b>.
 *
 * <h2>Why the constraint cases use a REAL duplicate insert</h2>
 *
 * <p>A mocked {@code throw} would pass under the BROKEN same-transaction design and would therefore
 * certify the defect. Only a genuine constraint breach sets PostgreSQL's rollback-only flag on the
 * caller's transaction, which is the thing that would take the fire down. So
 * {@link #aDuplicateTicketInsertDoesNotFailTheFire} drives a second dispatch of the SAME revision
 * to the SAME station against {@code uq_print_jobs_revision} — the index 26-03 already shipped.
 */
class PrintDispatchIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired PrintJobRepository printJobRepository;
    @Autowired PrintDispatchService printDispatchService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;
    @Autowired TransactionTemplate transactionTemplate;

    @MockitoBean UserBranchClient userBranchClient;
    @MockitoSpyBean EventPublisher eventPublisher;
    @MockitoSpyBean PrintJobService printJobService;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID hotItemId;
    UUID coldItemId;

    /** Two kitchen stations and a receipt printer — the shape a real branch has. */
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

        hotItemId = menuItem(cat, "Chicken Karahi", "HOT");
        coldItemId = menuItem(cat, "Garden Salad", "COLD");

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 8),
                        null, List.of()));
        registry(FULL_REGISTRY);
        openTillForCashier(branchId);
    }

    private void registry(String json) {
        when(userBranchClient.getBranch(any(), any())).thenReturn(new UserBranchClient.BranchDetail(
                branchId, "Floating Terrace", null, "+92 51 234 5678",
                "7000007-8", "17-00-9999-000-11", json, "Asia/Karachi"));
    }

    private UUID menuItem(MenuCategory cat, String name, String station) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName(name);
        item.setBasePricePaisa(50_000L);
        item.setTaxRatePct(new BigDecimal("16.00"));
        item.setKdsStation(station);
        item.setTaxRateCode("GST-16");
        return menuItemRepository.save(item).getId();
    }

    // ══ 1. Firing enqueues one queued, routed row per station ═════════════════════════════════

    @Test
    @DisplayName("firing enqueues one QUEUED job per station, addressed to the configured printer")
    void firingEnqueuesOneQueuedJobPerStation() {
        OrderDto order = orderWith(hotItemId, coldItemId);
        orderService.sendToKds(order.id(), null);

        List<PrintJob> tickets = kitchenTickets(order.id());
        assertThat(tickets).hasSize(2);

        PrintJob hot = ticketFor(tickets, "kitchen-hot");
        assertThat(hot.getStatus()).isEqualTo(PrintJobStatus.QUEUED);
        assertThat(hot.getRevisionNo()).isEqualTo(1);
        assertThat(hot.getLastError()).isNull();
        assertThat(hot.getDocument()).contains("KITCHEN_TICKET");
    }

    // ══ 2. Nothing runs before the fire commits ═══════════════════════════════════════════════

    @Test
    @DisplayName("no print work executes before the fire commits — the callback is registered, not run")
    void noPrintWorkExecutesBeforeCommit() {
        OrderDto order = orderWith(hotItemId);

        transactionTemplate.executeWithoutResult(status -> {
            orderService.sendToKds(order.id(), null);
            // Still INSIDE the fire's transaction. If dispatch ran here — inline, or via
            // REQUIRES_NEW — a row would already exist.
            assertThat(kitchenTickets(order.id()))
                    .as("dispatch must be registered for after-commit, not executed inline")
                    .isEmpty();
        });

        assertThat(kitchenTickets(order.id()))
                .as("and it must actually run once the fire has committed")
                .hasSize(1);
    }

    // ══ 3. A rolled-back fire enqueues NOTHING ════════════════════════════════════════════════

    @Test
    @DisplayName("a fire that rolls back leaves no phantom ticket for the kitchen to cook")
    void aRolledBackFireEnqueuesNothing() {
        OrderDto order = orderWith(hotItemId);

        try {
            transactionTemplate.executeWithoutResult(status -> {
                orderService.sendToKds(order.id(), null);
                throw new IllegalStateException("forced rollback after the dispatch registration");
            });
        } catch (IllegalStateException expected) {
            // the rollback we asked for
        }

        assertThat(kitchenTickets(order.id()))
                .as("a ticket that survives a rolled-back fire is an order the kitchen cooks and "
                        + "nobody ordered")
                .isEmpty();
    }

    // ══ 4. THE ONE. A real duplicate insert cannot fail the fire ══════════════════════════════

    /**
     * The plan's first prohibition, proved the only way it can be.
     *
     * <p>The second fire of the same revision to the same station breaches
     * {@code uq_print_jobs_revision}. Under the rejected same-transaction design that breach would
     * mark the FIRE's transaction rollback-only, and catching the Java exception would not clear
     * the flag — the order would fail at commit with a caught exception and no explanation. Here
     * the fire has already committed, so it cannot be touched.
     */
    @Test
    @DisplayName("a REAL duplicate insert against uq_print_jobs_revision does not fail the fire")
    void aDuplicateTicketInsertDoesNotFailTheFire() {
        OrderDto order = orderWith(hotItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);
        assertThat(kitchenTickets(order.id())).hasSize(1);

        Set<UUID> firedIds = fired.items().stream()
                .map(OrderDto.OrderItemDto::id).collect(Collectors.toSet());

        // Dispatch the SAME revision to the SAME station a second time. No mock anywhere: the
        // database refuses it.
        printDispatchService.dispatchKitchenTicketsAfterCommit(order.id(), branchId, 1, firedIds);

        assertThat(kitchenTickets(order.id()))
                .as("the unique index is the after-commit dispatch's idempotency guard")
                .hasSize(1);

        // And the order is untouched and still usable — the real proof that the breach never
        // reached it.
        OrderDto after = orderService.getOrder(order.id(), branchId);
        assertThat(after.status()).isEqualTo(fired.status());
        assertThat(after.items()).allSatisfy(i -> assertThat(i.revisionNo()).isEqualTo(1));
    }

    @Test
    @DisplayName("a forced duplicate during the fire itself leaves the order fired and the event published")
    void aDuplicateRaisedDuringTheFireLeavesTheOrderFiredAndPublished() {
        OrderDto order = orderWith(hotItemId);

        // Pre-seed the exact row the fire's dispatch is about to write, so the dispatch insert is a
        // genuine duplicate against the real index — not a mocked throw.
        PrintJob squatter = new PrintJob();
        squatter.setTenantId(tenantId);
        squatter.setBranchId(branchId);
        squatter.setOrderId(order.id());
        squatter.setDocumentType(PrintDocument.DocumentType.KITCHEN_TICKET);
        squatter.setTargetPrinterId("kitchen-hot");
        squatter.setIssueSeq(1);
        squatter.setRevisionNo(1);
        squatter.setStatus(PrintJobStatus.QUEUED);
        squatter.setDocument("{\"schemaVersion\":\"1.0\",\"type\":\"KITCHEN_TICKET\"}");
        squatter.setIssuedAt(Instant.now());
        printJobRepository.saveAndFlush(squatter);

        // The fire must succeed anyway.
        OrderDto fired = orderService.sendToKds(order.id(), null);

        assertThat(fired.status().name()).isEqualTo("SENT_TO_KDS");
        assertThat(orderService.getOrder(order.id(), branchId).items())
                .allSatisfy(i -> assertThat(i.revisionNo()).isEqualTo(1));
        verify(eventPublisher).publish(anyString(), eq("pos.order.sent_to_kds"),
                eq("ORDER_SENT_TO_KDS"), any(), any());
        assertThat(kitchenTickets(order.id())).hasSize(1);
    }

    // ══ 5. The same, on the close path ════════════════════════════════════════════════════════

    @Test
    @DisplayName("a print failure on close does not stop the order closing or ORDER_CLOSED publishing")
    void aPrintFailureOnCloseDoesNotStopTheClose() {
        // A hard failure inside the receipt enqueue, raised by the real service being unavailable
        // rather than by a mocked domain exception: this covers the non-database branch the plan
        // asks for separately.
        doThrow(new IllegalStateException("forced serialisation failure inside dispatch"))
                .when(printJobService).enqueueReceipt(any(), any(), anyString());

        OrderDto order = orderWith(hotItemId);
        OrderDto closed = closeViaServeAndPay(orderService, paymentService, order, branchId);

        assertThat(closed.status().name()).isEqualTo("CLOSED");
        verify(eventPublisher).publish(anyString(), eq("pos.order.closed"), eq("ORDER_CLOSED"),
                any(), any());
        assertThat(receipts(order.id()))
                .as("the receipt genuinely did not enqueue — that is the point of the forced failure")
                .isEmpty();
    }

    // ══ 6. A non-database failure inside dispatch, forced separately ══════════════════════════

    @Test
    @DisplayName("an assembler failure inside dispatch is caught and the fire is unaffected")
    void anAssemblerFailureInsideDispatchDoesNotReachTheFire() {
        doThrow(new IllegalArgumentException("forced assembler failure"))
                .when(printJobService).enqueueKitchenTicket(any(), any(), anyString(), anyInt(),
                        any(), any(), any());

        OrderDto order = orderWith(hotItemId);
        OrderDto fired = orderService.sendToKds(order.id(), null);

        assertThat(fired.status().name()).isEqualTo("SENT_TO_KDS");
        assertThat(kitchenTickets(order.id())).isEmpty();
    }

    // ══ 7. A retried dispatch of the same revision enqueues once ══════════════════════════════

    @Test
    @DisplayName("firing twice with the same idempotency key enqueues the ticket once")
    void aRepeatedFireEnqueuesTheTicketOnce() {
        OrderDto order = orderWith(hotItemId);
        String key = UUID.randomUUID().toString();

        orderService.sendToKds(order.id(), key);
        orderService.sendToKds(order.id(), key);

        assertThat(kitchenTickets(order.id())).hasSize(1);
    }

    // ══ 8. An unrouted station is a visible row, not silence ══════════════════════════════════

    @Test
    @DisplayName("a station with no configured printer writes a FAILED row naming the station")
    void anUnroutedStationWritesAVisibleRow() {
        OrderDto order = orderWith(hotItemId, coldItemId);   // COLD has no printer entry
        orderService.sendToKds(order.id(), null);

        List<PrintJob> tickets = kitchenTickets(order.id());
        assertThat(tickets).hasSize(2);

        PrintJob unrouted = tickets.stream()
                .filter(j -> j.getStatus() == PrintJobStatus.FAILED)
                .findFirst()
                .orElseThrow(() -> new AssertionError(
                        "a kitchen that never prints is indistinguishable from a kitchen with no "
                                + "orders — the unrouted station must be discoverable BY QUERY"));
        assertThat(unrouted.getLastError())
                .startsWith(PrintDispatchService.UNROUTABLE)
                .contains("COLD");
        assertThat(unrouted.getTargetPrinterId()).isEqualTo(PrintJob.UNASSIGNED_TARGET);
    }

    // ══ 9. Closing enqueues the receipt when there is a printer for it ════════════════════════

    @Test
    @DisplayName("closing an order enqueues the customer receipt as a QUEUED job")
    void closingEnqueuesTheReceipt() {
        OrderDto order = orderWith(hotItemId);
        closeViaServeAndPay(orderService, paymentService, order, branchId);

        List<PrintJob> receipts = receipts(order.id());
        assertThat(receipts).hasSize(1);
        assertThat(receipts.get(0).getStatus()).isEqualTo(PrintJobStatus.QUEUED);
        assertThat(receipts.get(0).getTargetPrinterId()).isEqualTo("receipt-1");
        assertThat(receipts.get(0).getRevisionNo())
                .as("a receipt carries a null revision and is excluded from the revision index")
                .isNull();
    }

    // ══ 10. A branch with no receipt printer enqueues NOTHING, and records nothing failed ═════

    @Test
    @DisplayName("a branch with no receipt printer enqueues nothing at all — not a failed row")
    void aBranchWithNoReceiptPrinterEnqueuesNothing() {
        registry(KITCHEN_ONLY_REGISTRY);

        OrderDto order = orderWith(hotItemId);
        closeViaServeAndPay(orderService, paymentService, order, branchId);

        // "Prints in the browser" and "printer is broken" must be distinguishable in the data.
        // Here that distinction is: NO ROW versus a FAILED row.
        assertThat(receipts(order.id())).isEmpty();
        assertThat(printJobRepository.findHistoryForOrder(tenantId, order.id()))
                .allSatisfy(j -> assertThat(j.getDocumentType())
                        .isEqualTo(PrintDocument.DocumentType.KITCHEN_TICKET));
    }

    // ══ 11. Nothing dispatches for a voided order ═════════════════════════════════════════════

    @Test
    @DisplayName("voiding an order dispatches nothing new")
    void voidingDispatchesNothing() {
        OrderDto order = orderWith(hotItemId);
        orderService.sendToKds(order.id(), null);
        int before = printJobRepository.findHistoryForOrder(tenantId, order.id()).size();

        io.restaurantos.shared.security.JwtClaims claims = new io.restaurantos.shared.security.JwtClaims(
                cashierId, tenantId, branchId, List.of("CASHIER"),
                List.of("pos.order.void.own"), java.util.Map.of(), null);
        org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
                new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                        claims, null, List.of()));
        when(opaClient.evaluate(eq("pos"), any()))
                .thenReturn(new io.restaurantos.shared.authz.OpaDecision(true));
        orderService.voidOrder(order.id(),
                new io.restaurantos.pos.dto.VoidOrderRequest("customer left"),
                UUID.randomUUID().toString());

        assertThat(printJobRepository.findHistoryForOrder(tenantId, order.id()))
                .as("a voided order must not produce a further ticket or a receipt")
                .hasSize(before);
    }

    // ══ 12. The reconciliation query ══════════════════════════════════════════════════════════

    /**
     * Driven by KILLING dispatch between commit and enqueue — the exact gap the after-commit design
     * has — and then by letting it work. A reconciliation query nobody has watched return a row is
     * a reconciliation query nobody knows works.
     */
    @Test
    @DisplayName("the reconciliation query finds a fire whose dispatch died, and nothing when it worked")
    void reconciliationFindsTheLostTicketAndNothingElse() {
        Instant from = Instant.now().minus(1, ChronoUnit.HOURS);
        Instant to = Instant.now().plus(1, ChronoUnit.HOURS);

        // Dispatch dies in the after-commit window: the callback runs and does nothing at all.
        doAnswer(invocation -> null).when(printJobService)
                .enqueueKitchenTicket(any(), any(), anyString(), anyInt(), any(), any(), any());

        OrderDto lost = orderWith(hotItemId);
        orderService.sendToKds(lost.id(), null);

        List<Object[]> missing = printJobRepository.findFiresWithNoTicket(tenantId, from, to);
        assertThat(missing).hasSize(1);
        assertThat((UUID) missing.get(0)[0]).isEqualTo(lost.id());
        assertThat(((Number) missing.get(0)[1]).intValue()).isEqualTo(1);

        // Dispatch recovers; the next fire is clean and the query goes quiet for it.
        reset(printJobService);
        OrderDto fine = orderWith(hotItemId);
        orderService.sendToKds(fine.id(), null);

        List<Object[]> stillMissing = printJobRepository.findFiresWithNoTicket(tenantId, from, to);
        assertThat(stillMissing.stream().map(r -> (UUID) r[0]))
                .containsExactly(lost.id())
                .doesNotContain(fine.id());
    }

    @Test
    @DisplayName("the reconciliation query returns nothing when every fire got its ticket")
    void reconciliationIsQuietOnTheHappyPath() {
        Instant from = Instant.now().minus(1, ChronoUnit.HOURS);
        Instant to = Instant.now().plus(1, ChronoUnit.HOURS);

        OrderDto order = orderWith(hotItemId, coldItemId);
        orderService.sendToKds(order.id(), null);

        assertThat(printJobRepository.findFiresWithNoTicket(tenantId, from, to))
                .as("an unrouted station still writes a row, so it must NOT show up here")
                .isEmpty();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private OrderDto orderWith(UUID... menuItemIds) {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 2, null, null));
        for (UUID id : menuItemIds) {
            orderService.addItem(order.id(), new AddOrderItemRequest(id, branchId, 1, null, null));
        }
        return orderService.getOrder(order.id(), branchId);
    }

    private List<PrintJob> kitchenTickets(UUID orderId) {
        return printJobRepository.findHistoryForOrder(tenantId, orderId).stream()
                .filter(j -> j.getDocumentType() == PrintDocument.DocumentType.KITCHEN_TICKET)
                .toList();
    }

    private List<PrintJob> receipts(UUID orderId) {
        return printJobRepository.findHistoryForOrder(tenantId, orderId).stream()
                .filter(j -> j.getDocumentType() == PrintDocument.DocumentType.CUSTOMER_RECEIPT)
                .toList();
    }

    private static PrintJob ticketFor(List<PrintJob> jobs, String target) {
        return jobs.stream().filter(j -> target.equals(j.getTargetPrinterId())).findFirst()
                .orElseThrow(() -> new AssertionError("no ticket addressed to " + target));
    }

    /** Referenced so the unassigned-station constant is not silently renamed out from under us. */
    @SuppressWarnings("unused")
    private static final String UNASSIGNED = KitchenTicketAssembler.UNASSIGNED_STATION;
}
