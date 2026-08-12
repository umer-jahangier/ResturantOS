package io.restaurantos.pos.repository;

import io.restaurantos.pos.domain.model.PrintJob;
import io.restaurantos.shared.print.PrintDocument;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Every finder here names {@code tenantId} in its PREDICATE, not only in the RLS policy.
 *
 * <p>26-CONTEXT is explicit about why. Under {@code FORCE ROW LEVEL SECURITY} an unscoped query
 * returns ZERO ROWS rather than erroring, so a wiring break — a GUC that did not get set on this
 * connection, a consumer that ran outside the tenant-aware path — presents to the cashier as a
 * receipt with no items and to the developer as nothing at all. The predicate in the query means
 * the same break produces a query that is obviously wrong when you read it, and the policy remains
 * the thing that stops a caller with the WRONG tenant.
 */
@Repository
public interface PrintJobRepository extends JpaRepository<PrintJob, UUID> {

    /** One stored job, for the re-serve path. */
    @Query("SELECT j FROM PrintJob j WHERE j.tenantId = :tenantId AND j.id = :id AND j.deletedAt IS NULL")
    Optional<PrintJob> findScoped(@Param("tenantId") UUID tenantId, @Param("id") UUID id);

    /**
     * The highest sequence already allocated for this routing slot, taken under a write lock.
     *
     * <p>{@code PESSIMISTIC_WRITE} rather than a read-then-increment: two cashiers hitting Reprint
     * at the same moment would otherwise both read n and both write n+1, and the unique index
     * would turn one of them into a 500 the cashier cannot act on. The index is still the backstop
     * — this is the fast path that stops it firing.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
           SELECT j FROM PrintJob j
           WHERE j.tenantId = :tenantId
             AND j.orderId = :orderId
             AND j.documentType = :documentType
             AND j.targetPrinterId = :targetPrinterId
           ORDER BY j.issueSeq DESC
           """)
    List<PrintJob> lockSlotForSequence(@Param("tenantId") UUID tenantId,
                                       @Param("orderId") UUID orderId,
                                       @Param("documentType") PrintDocument.DocumentType documentType,
                                       @Param("targetPrinterId") String targetPrinterId);

    /** The first issue for a routing slot — the bytes a reprint re-serves. */
    @Query("""
           SELECT j FROM PrintJob j
           WHERE j.tenantId = :tenantId
             AND j.orderId = :orderId
             AND j.documentType = :documentType
             AND j.targetPrinterId = :targetPrinterId
             AND j.issueSeq = 1
           """)
    Optional<PrintJob> findFirstIssue(@Param("tenantId") UUID tenantId,
                                      @Param("orderId") UUID orderId,
                                      @Param("documentType") PrintDocument.DocumentType documentType,
                                      @Param("targetPrinterId") String targetPrinterId);

    /** The replay guard on the issuance POST. */
    @Query("SELECT j FROM PrintJob j WHERE j.tenantId = :tenantId AND j.idempotencyKey = :key")
    Optional<PrintJob> findByIdempotencyKey(@Param("tenantId") UUID tenantId,
                                            @Param("key") String key);

    /**
     * Fires that produced no kitchen ticket — the backstop for the ONE gap the after-commit
     * dispatch design genuinely has (26-07).
     *
     * <p>Dispatch runs after the fire transaction commits, so a process death in that window loses
     * the ticket with no row to show for it. The kitchen display is unaffected and the food still
     * gets cooked, but the paper is silently absent — and silence is the failure mode this phase
     * exists to eliminate. This query makes it loud. It follows the precedent of
     * {@code scripts/reconcile-unposted-events.sql}, and the same statement is checked in at
     * {@code scripts/reconcile-missing-kitchen-tickets.sql} for an operator with only psql.
     *
     * <p>Routing is deliberately NOT part of the predicate. An unrouted station still writes a row
     * (a FAILED one naming the station), so "no row at all" means the dispatch never ran — which is
     * exactly and only the thing this is looking for.
     *
     * @return one row per (order_id, revision_no) that was fired and never got a ticket
     */
    @Query(value = """
           SELECT DISTINCT oi.order_id, oi.revision_no
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE o.tenant_id = :tenantId
             AND o.sent_to_kds_at >= :firedFrom
             AND o.sent_to_kds_at < :firedTo
             AND oi.revision_no > 0
             AND oi.kds_status <> 'CANCELLED'
             AND NOT EXISTS (
                 SELECT 1 FROM print_jobs p
                 WHERE p.tenant_id = o.tenant_id
                   AND p.order_id = oi.order_id
                   AND p.document_type = 'KITCHEN_TICKET'
                   AND p.revision_no = oi.revision_no)
           ORDER BY 1, 2
           """, nativeQuery = true)
    List<Object[]> findFiresWithNoTicket(@Param("tenantId") UUID tenantId,
                                         @Param("firedFrom") java.time.Instant firedFrom,
                                         @Param("firedTo") java.time.Instant firedTo);

    /**
     * One branch's claimable work, oldest first, under {@code FOR UPDATE SKIP LOCKED} (26-11).
     *
     * <p><b>SKIP LOCKED, not plain FOR UPDATE.</b> Two agents may legitimately serve one branch — a
     * till and a spare. With a plain row lock the second one blocks on the first's rows until its
     * own HTTP poll times out, which turns a redundant agent into a liability. With SKIP LOCKED it
     * simply takes different jobs.
     *
     * <p>Native rather than JPQL because JPA has no way to express SKIP LOCKED portably, and
     * expressing it is the entire point of the query.
     */
    @Query(value = """
           SELECT * FROM print_jobs
           WHERE tenant_id = :tenantId
             AND branch_id = :branchId
             AND status = 'QUEUED'
             AND deleted_at IS NULL
             AND (next_attempt_at IS NULL OR next_attempt_at <= :now)
           ORDER BY created_at
           LIMIT :batch
           FOR UPDATE SKIP LOCKED
           """, nativeQuery = true)
    List<PrintJob> lockClaimableForBranch(@Param("tenantId") UUID tenantId,
                                          @Param("branchId") UUID branchId,
                                          @Param("now") java.time.Instant now,
                                          @Param("batch") int batch);

    /**
     * Return every expired claim to the queue, incrementing its attempt count (26-11).
     *
     * <p>Runs on a timer, so there is no request and no tenant context — and therefore <b>this is
     * the one statement in this repository that does not name a tenant</b>. That is safe because it
     * reads nothing into a response: it moves a status back and touches no row belonging to a
     * caller. Stated rather than left for a reader to notice.
     *
     * <p>A job at the attempt limit is dead-lettered here rather than looping forever, so an agent
     * that reliably dies mid-job produces a finite number of retries and then a visible dead letter.
     */
    @org.springframework.data.jpa.repository.Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query(value = """
           UPDATE print_jobs
              SET status = CASE WHEN attempts + 1 >= 5 THEN 'DEAD_LETTERED' ELSE 'QUEUED' END,
                  attempts = attempts + 1,
                  claimed_by_agent_id = NULL,
                  lease_expires_at = NULL,
                  next_attempt_at = :now,
                  last_error = 'LEASE_EXPIRED: the agent claimed this job and never acknowledged it',
                  updated_at = now()
            WHERE status = 'CLAIMED'
              AND lease_expires_at IS NOT NULL
              AND lease_expires_at <= :now
           """, nativeQuery = true)
    int reclaimExpiredLeases(@Param("now") java.time.Instant now);

    /**
     * What each of a branch's printers has actually DONE lately (S8).
     *
     * <h2>Why this query exists</h2>
     *
     * <p>The printers screen could describe a printer in complete detail and had no way to say
     * whether anything had ever come out of it. When the GRILL printer was switched off, the
     * kitchen jobs failed, the rows went FAILED with the transport's own error on them, and every
     * surface in the product carried on exactly as before — the registry still read like a working
     * configuration and the alert about unrouted stations still said GRILL was fine, because GRILL
     * HAD a printer. "Configured, and silently not printing" is the state a restaurant discovers
     * during service.
     *
     * <p>{@code ISSUED} is excluded on purpose. That status means the document was produced and
     * handed to nobody — an unrouted branch printing an HTML bill in a browser — so counting it as
     * "waiting" would report a queue that no agent will ever drain.
     *
     * <p><b>A job whose last attempt failed is usually QUEUED, not FAILED.</b> Measured here rather
     * than assumed: {@code PrintJobClaimService.acknowledge} answers a failed delivery by
     * incrementing {@code attempts}, storing the transport's error and putting the row back to
     * QUEUED with a backoff — {@code DEAD_LETTERED} arrives only after five attempts, which with
     * that backoff is several minutes. Counting only FAILED and DEAD_LETTERED would leave a screen
     * silent for the whole window in which a kitchen notices, which is the window that matters.
     *
     * @return one row per target printer:
     *         {@code [target_printer_id, waiting, printed, failed, last_printed_at]}
     */
    @Query(value = """
           SELECT target_printer_id,
                  COUNT(*) FILTER (WHERE status IN ('QUEUED', 'CLAIMED')),
                  COUNT(*) FILTER (WHERE status = 'PRINTED'),
                  COUNT(*) FILTER (WHERE status IN ('FAILED', 'DEAD_LETTERED')
                                      OR (status IN ('QUEUED', 'CLAIMED') AND attempts > 0)),
                  MAX(updated_at) FILTER (WHERE status = 'PRINTED')
           FROM print_jobs
           WHERE tenant_id = :tenantId
             AND branch_id = :branchId
             AND deleted_at IS NULL
             AND created_at >= :since
             AND status <> 'ISSUED'
           GROUP BY target_printer_id
           """, nativeQuery = true)
    List<Object[]> summariseDeliveryByPrinter(@Param("tenantId") UUID tenantId,
                                              @Param("branchId") UUID branchId,
                                              @Param("since") java.time.Instant since);

    /**
     * The MOST RECENT thing each printer did, which is what decides the sentence on screen.
     *
     * <p>Counts alone cannot: a printer with nine failures and a success a second ago is working,
     * and one with nine successes and a failure a second ago is not. The screen has to report the
     * latter as unable to print even though it is nine-tenths healthy, because the next ticket is
     * the one the kitchen is waiting for.
     *
     * @return {@code [target_printer_id, status, last_error, updated_at, attempts]}, newest per
     *         printer. {@code attempts} is here because a retrying job reads QUEUED — see the
     *         summary query above for why that distinction decides the sentence on screen.
     */
    @Query(value = """
           SELECT DISTINCT ON (target_printer_id)
                  target_printer_id, status, last_error, updated_at, attempts
           FROM print_jobs
           WHERE tenant_id = :tenantId
             AND branch_id = :branchId
             AND deleted_at IS NULL
             AND created_at >= :since
             AND status <> 'ISSUED'
           ORDER BY target_printer_id, updated_at DESC
           """, nativeQuery = true)
    List<Object[]> latestDeliveryByPrinter(@Param("tenantId") UUID tenantId,
                                           @Param("branchId") UUID branchId,
                                           @Param("since") java.time.Instant since);

    /** Every issue of every document for one order — the reprint history (26-08). */
    @Query("""
           SELECT j FROM PrintJob j
           WHERE j.tenantId = :tenantId AND j.orderId = :orderId AND j.deletedAt IS NULL
           ORDER BY j.issuedAt ASC
           """)
    List<PrintJob> findHistoryForOrder(@Param("tenantId") UUID tenantId,
                                       @Param("orderId") UUID orderId);
}
