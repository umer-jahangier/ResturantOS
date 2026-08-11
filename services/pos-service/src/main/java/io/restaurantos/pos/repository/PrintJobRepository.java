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

    /** Every issue of every document for one order — the reprint history (26-08). */
    @Query("""
           SELECT j FROM PrintJob j
           WHERE j.tenantId = :tenantId AND j.orderId = :orderId AND j.deletedAt IS NULL
           ORDER BY j.issuedAt ASC
           """)
    List<PrintJob> findHistoryForOrder(@Param("tenantId") UUID tenantId,
                                       @Param("orderId") UUID orderId);
}
