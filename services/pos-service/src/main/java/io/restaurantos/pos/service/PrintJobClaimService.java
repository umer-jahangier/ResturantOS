package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.PrintJobStatus;
import io.restaurantos.pos.domain.model.PrintAgent;
import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.pos.repository.PrintJobRepository;
import io.restaurantos.shared.print.PrintDocument;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * The channel an agent uses to come and get its work.
 *
 * <h2>The lease, and what it is actually for</h2>
 *
 * <p>A claim is not a handover, it is a <b>lease</b>. Without one, an agent that loses power
 * between claiming a ticket and printing it leaves that ticket in {@code CLAIMED} forever: the
 * kitchen never gets paper, nothing errors, and the only symptom is a chef waiting. The sweep
 * returns expired claims to the queue with the attempt count incremented — which retries the work
 * AND makes a permanently failing job eventually dead-letter rather than loop.
 *
 * <h2>The double-print window, sized rather than denied</h2>
 *
 * <p>If a delivery outlasts its lease, the sweep may hand the job to another agent while the first
 * is still printing. Both then put bytes on a printer, and the customer's kitchen gets two tickets.
 * This is mitigated, not eliminated:
 *
 * <ul>
 *   <li><b>The server's reclaim is authoritative.</b> A late acknowledgement — one whose lease has
 *       expired, or whose job has since been claimed by a different agent — is a <b>no-op</b>. It
 *       does not mark PRINTED a job another agent is mid-way through, and it does not increment an
 *       attempt count that no longer belongs to it.</li>
 *   <li><b>The lease is generous relative to the work.</b> {@link #DEFAULT_LEASE_SECONDS} seconds
 *       against a job that takes a printer a second or two, so reaching the window requires the
 *       agent to be genuinely wedged rather than merely slow.</li>
 * </ul>
 *
 * <p>The residual window is real: an agent that hangs for longer than the lease and then completes
 * will print a ticket a second agent has already printed. A duplicated kitchen ticket is a wasted
 * plate; pretending the window does not exist would be worse than sizing it. Documented here, in
 * the agent's README, and in 26-11's summary.
 *
 * <h2>Scoping</h2>
 *
 * <p>Every query names the tenant AND the branch in its predicate, in addition to the forced RLS
 * policy. Under forced RLS an unscoped query returns zero rows rather than erroring — so a wiring
 * break here would present as an agent that quietly never prints, which is indistinguishable from a
 * quiet restaurant. The branch comes from the agent ROW, never from anything the client sent.
 */
@Service
public class PrintJobClaimService {

    private static final Logger log = LoggerFactory.getLogger(PrintJobClaimService.class);

    /** Generous against a job that takes a printer a second or two. See the double-print note. */
    public static final long DEFAULT_LEASE_SECONDS = 120;

    /** Mirrors the agent-side queue's {@code MAX_ATTEMPTS} (26-06), so the two halves agree. */
    public static final int MAX_ATTEMPTS = 5;

    /** A bound so one agent cannot drain a busy branch's whole queue into one process's memory. */
    public static final int MAX_BATCH = 20;

    private final PrintJobRepository printJobRepository;
    private final Clock clock;
    private final Duration lease;

    public PrintJobClaimService(PrintJobRepository printJobRepository,
                                Clock clock,
                                @Value("${restaurantos.print.lease-seconds:" + DEFAULT_LEASE_SECONDS + "}")
                                long leaseSeconds) {
        this.printJobRepository = printJobRepository;
        this.clock = clock;
        this.lease = Duration.ofSeconds(leaseSeconds);
    }

    /**
     * @param jobs empty when there is nothing to do. <b>An explicitly empty list, never an error</b>
     *             — the forced-RLS zero-rows trap means "nothing queued" and "wired wrong" must not
     *             look the same to the agent, and the agent branches on this.
     */
    public record ClaimResult(List<ClaimedJob> jobs, Instant leaseExpiresAt) {}

    public record ClaimedJob(UUID printJobId, String targetPrinterId, String documentType,
                             String document) {}

    /** What an agent reports back. */
    public enum AckResult { DELIVERED, FAILED }

    /**
     * @param applied false when the acknowledgement arrived too late to matter — the lease had
     *                expired and the job had been reclaimed. The agent is told, so a late ack is
     *                visibly a no-op rather than silently one.
     */
    public record AckOutcome(boolean applied, PrintJobStatus status) {}

    // ── Claim ────────────────────────────────────────────────────────────────────────────────

    @Transactional
    public ClaimResult claim(PrintAgent agent, int max) {
        int batch = Math.min(Math.max(max, 1), MAX_BATCH);
        Instant now = clock.instant();
        Instant expiry = now.plus(lease);

        // SKIP LOCKED, so two agents polling the same branch at the same instant take DIFFERENT
        // jobs rather than one of them blocking on the other's row locks and timing out its poll.
        List<PrintJob> claimable = printJobRepository.lockClaimableForBranch(
                agent.getTenantId(), agent.getBranchId(), now, batch);

        for (PrintJob job : claimable) {
            job.setStatus(PrintJobStatus.CLAIMED);
            job.setClaimedByAgentId(agent.getId());
            job.setLeaseExpiresAt(expiry);
        }
        printJobRepository.saveAllAndFlush(claimable);

        return new ClaimResult(
                claimable.stream()
                        .map(j -> new ClaimedJob(j.getId(), j.getTargetPrinterId(),
                                j.getDocumentType().name(), j.getDocument()))
                        .toList(),
                claimable.isEmpty() ? null : expiry);
    }

    // ── Acknowledge ──────────────────────────────────────────────────────────────────────────

    @Transactional
    public AckOutcome acknowledge(PrintAgent agent, UUID printJobId, AckResult result, String error) {
        Instant now = clock.instant();

        PrintJob job = printJobRepository.findScoped(agent.getTenantId(), printJobId).orElse(null);
        if (job == null || !agent.getBranchId().equals(job.getBranchId())) {
            // Another branch's job, another tenant's job, or none. Same answer for all three: this
            // agent has nothing to say about it.
            return new AckOutcome(false, null);
        }

        boolean stillOurs = job.getStatus() == PrintJobStatus.CLAIMED
                && agent.getId().equals(job.getClaimedByAgentId())
                && job.getLeaseExpiresAt() != null
                && job.getLeaseExpiresAt().isAfter(now);

        if (!stillOurs) {
            // THE SERVER'S RECLAIM IS AUTHORITATIVE. Marking this PRINTED would mark as done a job
            // a sibling agent may be printing right now.
            log.info("late acknowledgement for print job {} from agent {} ignored (status {})",
                    printJobId, agent.getId(), job.getStatus());
            return new AckOutcome(false, job.getStatus());
        }

        if (result == AckResult.DELIVERED) {
            job.setStatus(PrintJobStatus.PRINTED);
            job.setLeaseExpiresAt(null);
            job.setLastError(null);
        } else {
            job.setAttempts(job.getAttempts() + 1);
            job.setLastError(truncate(error));
            job.setLeaseExpiresAt(null);
            job.setClaimedByAgentId(null);
            if (job.getAttempts() >= MAX_ATTEMPTS) {
                job.setStatus(PrintJobStatus.DEAD_LETTERED);
            } else {
                job.setStatus(PrintJobStatus.QUEUED);
                job.setNextAttemptAt(now.plus(backoff(job.getAttempts())));
            }
        }
        printJobRepository.saveAndFlush(job);
        return new AckOutcome(true, job.getStatus());
    }

    // ── The sweep ────────────────────────────────────────────────────────────────────────────

    /**
     * Return expired claims to the queue.
     *
     * <p>Tenant-wide by necessity: this runs on a timer with no request and therefore no tenant
     * context, so it uses a native statement that names no tenant. That is safe precisely because it
     * names no tenant — it is not reading rows into a response, it is moving a status back — but it
     * is the one query in this class that RLS does not scope, and saying so here is the point.
     *
     * @return how many leases were reclaimed
     */
    @Transactional
    public int reclaimExpiredLeases() {
        int reclaimed = printJobRepository.reclaimExpiredLeases(clock.instant());
        if (reclaimed > 0) {
            log.warn("reclaimed {} print job(s) whose agent lease expired without an acknowledgement",
                    reclaimed);
        }
        return reclaimed;
    }

    /** Exponential with a ceiling, mirroring the agent-side queue's shape. */
    private static Duration backoff(int attempts) {
        long seconds = Math.min(300L, (long) Math.pow(2, Math.max(0, attempts - 1)) * 5L);
        return Duration.ofSeconds(seconds);
    }

    private static String truncate(String error) {
        if (error == null) {
            return null;
        }
        return error.length() <= 500 ? error : error.substring(0, 500);
    }

    /** Named so a caller does not re-derive it. */
    public static PrintDocument.DocumentType kitchenTicket() {
        return PrintDocument.DocumentType.KITCHEN_TICKET;
    }
}
