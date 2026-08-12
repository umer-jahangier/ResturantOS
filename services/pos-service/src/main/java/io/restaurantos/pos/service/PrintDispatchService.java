package io.restaurantos.pos.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.shared.print.PrintDocument;
import io.restaurantos.shared.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Hangs printing off the two order transitions that produce paper — the fire and the close —
 * without ever being able to stop either of them.
 *
 * <h2>The propagation boundary is the load-bearing decision in this class</h2>
 *
 * <p>An earlier draft of this plan ran the enqueue inside the fire's own transaction and relied on
 * a {@code try/catch} to keep failures away from the order path. That is wrong, and wrong in a way
 * that reads as correct in review and passes every test that only forces Java-level faults. <b>An
 * insert that breaches a database constraint inside the caller's transaction marks that transaction
 * ROLLBACK-ONLY. Catching the resulting exception in Java does not clear the flag</b>, so the
 * surrounding order transaction still fails at commit. A duplicate sequence in the print subsystem
 * would take down the fire — exactly what this plan forbids.
 *
 * <p>Two alternatives were considered and rejected:
 *
 * <ul>
 *   <li><b>Same transaction with a try/catch</b> — rejected for the rollback-only reason above.
 *       {@code PrintDispatchIT} proves it by forcing a REAL duplicate insert against
 *       {@code uq_print_jobs_revision}. A mocked exception would pass under the broken design and
 *       would therefore certify the defect.</li>
 *   <li><b>{@code REQUIRES_NEW} invoked inline, before the fire commits</b> — rejected because the
 *       ticket would commit independently and then survive a fire that rolled back. The kitchen
 *       would cook an order that does not exist. In a cloud deployment (D-26-06) the cook is in a
 *       different building from the database, so nobody would notice until the plate arrived.</li>
 * </ul>
 *
 * <p>What ships is an <b>after-commit</b> boundary: the fire seam registers a
 * {@link TransactionSynchronization}, and dispatch runs in a transaction of its own once the fire
 * has committed. A rollback-only flag cannot reach the fire because the fire is already committed;
 * nothing is enqueued for an order that did not happen because the callback never runs.
 *
 * <h2>Its one real cost, stated rather than hidden</h2>
 *
 * <p>A process death in the window between the fire's commit and the dispatch transaction loses
 * that ticket <i>with no row to show for it</i>. The kitchen display is unaffected — it is
 * event-driven and remains the source of truth, so food still gets cooked — but the paper ticket is
 * silently absent, and silence is the failure mode this phase exists to eliminate. That gap is
 * closed with DETECTION, not with a claim: see
 * {@code scripts/reconcile-missing-kitchen-tickets.sql} and
 * {@code PrintJobRepository.findFiresWithNoTicket}.
 *
 * <h2>Failure recording, precisely</h2>
 *
 * <p>Two different things are called "a failure" here and they are recorded differently:
 *
 * <ul>
 *   <li>A station with items and <b>no printer configured</b> writes a real row with status
 *       {@link PrintJobStatus#FAILED} and a last-error naming the station. It is a routing gap a
 *       manager fixes, and it must be discoverable by query rather than by a chef noticing.</li>
 *   <li>A <b>write failure</b> — a duplicate, a serialisation error, an unreachable settings
 *       service — is logged at ERROR and left to the reconciliation query. It is deliberately NOT
 *       written as a second row: on the duplicate case the row already exists (that is what the
 *       index just told us), and on the others there is nothing trustworthy to write.</li>
 * </ul>
 */
@Service
public class PrintDispatchService {

    private static final Logger log = LoggerFactory.getLogger(PrintDispatchService.class);

    /**
     * Prefixes the {@code last_error} of a ticket that had nowhere to go, so a query can separate
     * "this station has no printer" from "this printer refused the bytes".
     */
    public static final String UNROUTABLE = "UNROUTABLE: ";

    private final KitchenTicketAssembler kitchenTicketAssembler;
    private final PrintJobService printJobService;
    private final UserBranchClient userBranchClient;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    public PrintDispatchService(KitchenTicketAssembler kitchenTicketAssembler,
                                PrintJobService printJobService,
                                UserBranchClient userBranchClient,
                                TenantContext tenantContext,
                                ObjectMapper objectMapper) {
        this.kitchenTicketAssembler = kitchenTicketAssembler;
        this.printJobService = printJobService;
        this.userBranchClient = userBranchClient;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
    }

    // ── Registration: the ONLY way the order path is allowed to reach this class ──────────────

    /**
     * Register a kitchen-ticket dispatch to run once the current transaction has COMMITTED.
     *
     * <p>Called from inside {@code sendToKds}. Nothing prints yet; nothing is written yet. If the
     * fire rolls back, this callback never runs and the table stays empty.
     *
     * <p>The {@code try/catch(Throwable)} inside the callback is not defensive decoration. Spring
     * <b>rethrows</b> an exception escaping {@code afterCommit} to the caller of the transactional
     * method — so an unguarded failure here would surface to the cashier as a failed fire even
     * though the order committed perfectly. That is the same defect as the rollback-only one,
     * arriving from the other side.
     */
    public void dispatchKitchenTicketsAfterCommit(UUID orderId, UUID branchId, int revisionNo,
                                                  Set<UUID> firedItemIds) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            // No transaction to hang off (a test calling the service directly with no tx, or a
            // future caller outside @Transactional). Dispatch immediately rather than silently
            // doing nothing — "no ticket, no row, no log" is the outcome this phase exists to kill.
            guarded(() -> dispatchKitchenTickets(orderId, branchId, revisionNo, firedItemIds),
                    "kitchen tickets", orderId);
            return;
        }
        TenantContext.TenantSnapshot snapshot = tenantContext.snapshot();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                // The callback runs on the same thread, but restore the snapshot anyway: a future
                // caller that clears the context in a finally block would otherwise dispatch with
                // no tenant, and under FORCE RLS that reads as "no data" rather than as an error.
                tenantContext.restore(snapshot);
                guarded(() -> dispatchKitchenTickets(orderId, branchId, revisionNo, firedItemIds),
                        "kitchen tickets", orderId);
            }
        });
    }

    /**
     * As above, for the customer receipt.
     *
     * <p>Registered from TWO seams, and the order of the two is the whole of finding §3-3:
     *
     * <ul>
     *   <li>the <b>settlement</b> seam ({@code PaymentServiceImpl.recordPayment}, the moment the
     *       last paisa of the bill is tendered) — this is the one that produces the guest's
     *       paper; and</li>
     *   <li>the <b>close</b> seam ({@code OrderServiceImpl.performClose}), kept as the backstop
     *       for a check that reaches CLOSED without a settlement dispatch having run.</li>
     * </ul>
     *
     * <p>Both carry the SAME order-scoped idempotency key, so whichever fires first issues the
     * original and the other is a replay that writes nothing. See {@link #automaticReceiptKey}.
     */
    public void dispatchReceiptAfterCommit(UUID orderId, UUID branchId) {
        if (!TransactionSynchronizationManager.isSynchronizationActive()) {
            guarded(() -> dispatchReceipt(orderId, branchId), "receipt", orderId);
            return;
        }
        TenantContext.TenantSnapshot snapshot = tenantContext.snapshot();
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCommit() {
                tenantContext.restore(snapshot);
                guarded(() -> dispatchReceipt(orderId, branchId), "receipt", orderId);
            }
        });
    }

    private void guarded(Runnable work, String what, UUID orderId) {
        try {
            work.run();
        } catch (Throwable t) {
            // Nothing about printing may reach the order path. The reconciliation query is the
            // durable record; this line is the one an operator greps for.
            log.error("print dispatch of {} for order {} FAILED after the order committed. "
                            + "The order is unaffected. Reconcile with "
                            + "scripts/reconcile-missing-kitchen-tickets.sql",
                    what, orderId, t);
        }
    }

    // ── The dispatch transactions themselves ─────────────────────────────────────────────────

    /**
     * One ticket per station, each enqueued in its OWN transaction.
     *
     * <p>Per-station isolation matters: a two-station fire in which the hot pass duplicates must
     * still print the cold pass. A single transaction around both would roll the good one back with
     * the bad one.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void dispatchKitchenTickets(UUID orderId, UUID branchId, int revisionNo,
                                       Set<UUID> firedItemIds) {
        if (firedItemIds == null || firedItemIds.isEmpty()) {
            return;
        }
        List<KitchenTicketAssembler.StationTicket> tickets =
                kitchenTicketAssembler.assemble(orderId, branchId, revisionNo, firedItemIds);
        if (tickets.isEmpty()) {
            return;
        }
        JsonNode registry = readRegistry(branchId);

        for (KitchenTicketAssembler.StationTicket ticket : tickets) {
            String target = kitchenPrinterFor(registry, ticket.stationCode());
            boolean routed = target != null;
            try {
                printJobService.enqueueKitchenTicket(
                        orderId,
                        branchId,
                        routed ? target : PrintJob.UNASSIGNED_TARGET,
                        revisionNo,
                        ticket.document(),
                        routed ? PrintJobStatus.QUEUED : PrintJobStatus.FAILED,
                        routed ? null : UNROUTABLE + "no kitchen printer configured for station "
                                + ticket.stationCode());
            } catch (Exception e) {
                // Already in its own transaction, so this rolls back only THIS station's row.
                log.error("enqueue of the {} ticket for order {} revision {} failed: {}",
                        ticket.stationCode(), orderId, revisionNo, e.toString());
            }
        }
    }

    /**
     * The idempotency key for the receipt this product issues BY ITSELF, as opposed to one a
     * cashier asked for by pressing Print bill.
     *
     * <p>Order-scoped rather than seam-scoped, and that is the fix for finding §3-3. It shipped as
     * {@code "dispatch:close:" + orderId}, which named the close as the thing that produces a bill
     * — and so a check that was paid at 02:59 and marked served at 03:15 had its ORIGINAL receipt
     * stamped 03:15. The guest was handed their change sixteen minutes before any paper existed,
     * and a guest who paid and walked out before the kitchen bumped the last line got none at all.
     *
     * <p>With one key per ORDER, the settlement dispatch issues the bill and the close dispatch
     * replays it: {@code PrintJobServiceImpl.issueReceipt} returns the stored issue verbatim on a
     * key it has already seen, writing no row and allocating no sequence. So the close cannot
     * produce a second original — and it cannot produce a second sheet of paper either, which it
     * would if the two seams kept separate keys. Nobody is standing at the pass waiting for a
     * duplicate bill; the guest already has theirs.
     */
    public static String automaticReceiptKey(UUID orderId) {
        return "dispatch:receipt:" + orderId;
    }

    /**
     * The customer receipt, enqueued for the agent.
     *
     * <p>Enqueues NOTHING when the branch has no receipt printer. That branch prints through the
     * browser (D-26-01) and a stream of unroutable rows would be noise rather than signal — which
     * is the opposite of the kitchen case, where an unrouted station is a configuration defect
     * somebody has to fix. "Enqueued nothing" and "enqueued and lost it" must be distinguishable in
     * the data, and here they are: no row at all versus a FAILED row.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void dispatchReceipt(UUID orderId, UUID branchId) {
        JsonNode registry = readRegistry(branchId);
        if (receiptPrinterFor(registry) == null) {
            return;
        }
        printJobService.enqueueReceipt(orderId, branchId, automaticReceiptKey(orderId));
    }

    // ── The branch printer registry ──────────────────────────────────────────────────────────

    private JsonNode readRegistry(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        try {
            UserBranchClient.BranchDetail detail = userBranchClient.getBranch(branchId, tenantId);
            if (detail == null || detail.receiptConfig() == null || detail.receiptConfig().isBlank()) {
                return null;
            }
            return objectMapper.readTree(detail.receiptConfig());
        } catch (Exception e) {
            // Fail-SOFT, the same direction ReceiptDocumentAssembler chose: an unreadable registry
            // must never take the order path with it. Every station then reads as unroutable, which
            // is the honest answer — we genuinely do not know where to send the ticket.
            log.warn("branch {} printer registry unreadable while dispatching: {}", branchId, e.toString());
            return null;
        }
    }

    /** The KITCHEN-role entry whose station code matches, or null when there is none. */
    private String kitchenPrinterFor(JsonNode registry, String stationCode) {
        if (registry == null || stationCode == null) {
            return null;
        }
        for (JsonNode printer : registry.path("printers")) {
            if (!"KITCHEN".equals(printer.path("role").asText())) {
                continue;
            }
            if (stationCode.equalsIgnoreCase(printer.path("stationCode").asText(null))) {
                String id = printer.path("id").asText(null);
                if (id != null && !id.isBlank()) {
                    return id;
                }
            }
        }
        return null;
    }

    private String receiptPrinterFor(JsonNode registry) {
        if (registry == null) {
            return null;
        }
        for (JsonNode printer : registry.path("printers")) {
            if ("RECEIPT".equals(printer.path("role").asText())) {
                String id = printer.path("id").asText(null);
                if (id != null && !id.isBlank()) {
                    return id;
                }
            }
        }
        return null;
    }

    /** Exposed for the dispatch tests and for 26-10's registry screen preview. */
    public String resolveKitchenTarget(UUID branchId, String stationCode) {
        return kitchenPrinterFor(readRegistry(branchId), stationCode);
    }

    /** The document type a kitchen ticket carries; named so callers do not re-derive it. */
    public static PrintDocument.DocumentType kitchenDocumentType() {
        return PrintDocument.DocumentType.KITCHEN_TICKET;
    }
}
