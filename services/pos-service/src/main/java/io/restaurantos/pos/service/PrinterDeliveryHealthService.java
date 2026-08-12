package io.restaurantos.pos.service;

import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Whether each of a branch's printers is actually putting paper out (S8).
 *
 * <h2>Why this is not the agent's health, and not the registry's completeness</h2>
 *
 * <p>The printers screen already had two answers and neither was this one.
 *
 * <ul>
 *   <li><b>Agent liveness</b> ({@code print_agents.last_seen_at}) says a MACHINE is polling. A
 *       polling agent with a dead printer bolted to it reads "Connected".</li>
 *   <li><b>Registry completeness</b> ({@code unroutedStations}) says a station has NO printer
 *       configured. A station with a perfectly configured printer that has refused every
 *       connection for an hour is not in that list, and is exactly the case a kitchen meets.</li>
 * </ul>
 *
 * <p>So a manager could look at a fully green screen while the grill printed nothing. This service
 * answers the third question — what has this printer done with the jobs it was given — from the
 * only record of it there is: the {@code print_jobs} rows the agent acknowledged.
 *
 * <h2>What "PRINTING" does and does not claim</h2>
 *
 * <p>{@link State#PRINTING} means the agent reported the bytes delivered. Neither a TCP socket nor
 * a spooler tells anyone that paper moved — {@code tcp9100.ts} and {@code system-printer.ts} both
 * say so in their own headers — and no wording produced from this service may claim otherwise.
 * What it does prove is the negative, which is the one a restaurant needs: a printer reporting
 * {@link State#FAILING} is definitely not printing.
 */
@Service
public class PrinterDeliveryHealthService {

    /**
     * One trading day. Long enough that a printer which failed at lunch is still reported at
     * dinner; short enough that yesterday's dead printer, since fixed, is not.
     */
    public static final int WINDOW_HOURS = 24;

    private final PrintJobRepository printJobRepository;
    private final TenantContext tenantContext;

    public PrinterDeliveryHealthService(PrintJobRepository printJobRepository,
                                        TenantContext tenantContext) {
        this.printJobRepository = printJobRepository;
        this.tenantContext = tenantContext;
    }

    public enum State {
        /** No job has been given to this printer in the window. Says nothing either way. */
        NEVER_USED,
        /** The most recent job was delivered. */
        PRINTING,
        /** The most recent job is queued or claimed and nothing has failed since. */
        WAITING,
        /** The most recent job FAILED or was dead-lettered. This printer is not printing. */
        FAILING
    }

    /**
     * @param printerId the {@code PrinterEntry.id} from the branch registry, which is how the
     *                  screen joins this back to the printer the manager is looking at
     * @param lastError the transport's own words, unedited. "connect ECONNREFUSED 127.0.0.1:9102"
     *                  tells whoever is standing at the printer exactly what to go and check;
     *                  "printing failed" tells them nothing.
     */
    public record PrinterDelivery(String printerId, State state, long waiting, long printed,
                                  long failed, Instant lastAttemptAt, Instant lastPrintedAt,
                                  String lastError) {}

    public record BranchPrintHealth(int windowHours, List<PrinterDelivery> printers) {}

    @Transactional(readOnly = true)
    public BranchPrintHealth forBranch(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();
        Instant since = Instant.now().minus(Duration.ofHours(WINDOW_HOURS));

        Map<String, long[]> counts = new HashMap<>();
        Map<String, Instant> lastPrinted = new HashMap<>();
        for (Object[] row : printJobRepository.summariseDeliveryByPrinter(tenantId, branchId, since)) {
            String printerId = String.valueOf(row[0]);
            counts.put(printerId, new long[] {toLong(row[1]), toLong(row[2]), toLong(row[3])});
            Instant printedAt = toInstant(row[4]);
            if (printedAt != null) {
                lastPrinted.put(printerId, printedAt);
            }
        }

        List<PrinterDelivery> out = new ArrayList<>();
        for (Object[] row : printJobRepository.latestDeliveryByPrinter(tenantId, branchId, since)) {
            String printerId = String.valueOf(row[0]);
            String status = row[1] == null ? "" : String.valueOf(row[1]);
            String lastError = row[2] == null ? null : String.valueOf(row[2]);
            Instant lastAttemptAt = toInstant(row[3]);
            long attempts = toLong(row[4]);
            State state = stateOf(status, attempts, lastError);
            long[] c = counts.getOrDefault(printerId, new long[] {0, 0, 0});
            out.add(new PrinterDelivery(printerId, state, c[0], c[1], c[2],
                    lastAttemptAt, lastPrinted.get(printerId),
                    // The error is only carried while it is still the CURRENT story. A printer whose
                    // latest job succeeded must not display the error from the one before it — that
                    // is how a fixed printer keeps looking broken and gets replaced for nothing.
                    state == State.FAILING ? lastError : null));
        }
        return new BranchPrintHealth(WINDOW_HOURS, out);
    }

    /**
     * <h2>Why QUEUED is not automatically "waiting"</h2>
     *
     * <p>A failed delivery does not leave a FAILED row. {@code PrintJobClaimService.acknowledge}
     * increments {@code attempts}, stores the transport's error and puts the job BACK to QUEUED
     * with a backoff; DEAD_LETTERED arrives only on the fifth attempt. So a printer that has been
     * refusing connections for four minutes presents as a QUEUED row, and a rule that read status
     * alone would report it as "waiting" for the entire window in which a kitchen notices.
     */
    private static State stateOf(String status, long attempts, String lastError) {
        return switch (status) {
            case "PRINTED" -> State.PRINTING;
            case "FAILED", "DEAD_LETTERED" -> State.FAILING;
            case "QUEUED", "CLAIMED" ->
                    attempts > 0 || lastError != null ? State.FAILING : State.WAITING;
            default -> State.NEVER_USED;
        };
    }

    private static long toLong(Object value) {
        return value instanceof Number number ? number.longValue() : 0L;
    }

    /**
     * The JDBC driver returns a {@code timestamptz} as one of several types depending on version
     * and configuration. Named rather than cast, because a ClassCastException here would take out a
     * settings screen for a value that is only ever rendered as "4 minutes ago".
     */
    private static Instant toInstant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime.toInstant();
        }
        return null;
    }
}
