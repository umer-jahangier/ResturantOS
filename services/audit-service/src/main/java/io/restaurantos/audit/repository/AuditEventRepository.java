package io.restaurantos.audit.repository;

import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.entity.AuditEventId;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Repository for the append-only audit_events table.
 * Only INSERT (via save/saveAndFlush) is used at runtime — no updates or deletes.
 *
 * <h2>Why four finders and four counters rather than one dynamic query</h2>
 *
 * <p>The read screen filters on {@code action} and on {@code resourceType}, independently, so the
 * query has four shapes. The obvious compaction is a single JPQL with
 * {@code (:action IS NULL OR e.action = :action)} — which is where an untyped null bind parameter
 * meets PostgreSQL and produces {@code could not determine data type of parameter $n} at runtime,
 * on the branch nobody exercised. Spring Data derives all eight of these from their names, so each
 * shape is a statement the driver can always type, and a missing one is a compile error rather than
 * a 500 on the third filter combination a user tries.
 *
 * <p>Every method is tenant-first and takes the tenant as its own parameter: there is no method here
 * that can be called without naming a tenant, so a caller cannot accidentally read across the
 * boundary by omitting a predicate. {@code AuditQueryController} supplies it from the verified
 * token and from nothing else.
 */
@Repository
public interface AuditEventRepository extends JpaRepository<AuditEventEntity, AuditEventId> {

    // ── page reads ─────────────────────────────────────────────────────────────

    List<AuditEventEntity> findByTenantIdAndOccurredAtBetween(
            UUID tenantId, Instant from, Instant to, Pageable pageable);

    List<AuditEventEntity> findByTenantIdAndActionAndOccurredAtBetween(
            UUID tenantId, String action, Instant from, Instant to, Pageable pageable);

    List<AuditEventEntity> findByTenantIdAndResourceTypeAndOccurredAtBetween(
            UUID tenantId, String resourceType, Instant from, Instant to, Pageable pageable);

    List<AuditEventEntity> findByTenantIdAndActionAndResourceTypeAndOccurredAtBetween(
            UUID tenantId, String action, String resourceType, Instant from, Instant to,
            Pageable pageable);

    // ── totals ─────────────────────────────────────────────────────────────────
    //
    // The screen states "Showing 51–100 of 208". Without a real count the pager can only offer
    // "next" and hope, which is how a reader concludes the log ends where the first page does.

    long countByTenantIdAndOccurredAtBetween(UUID tenantId, Instant from, Instant to);

    long countByTenantIdAndActionAndOccurredAtBetween(
            UUID tenantId, String action, Instant from, Instant to);

    long countByTenantIdAndResourceTypeAndOccurredAtBetween(
            UUID tenantId, String resourceType, Instant from, Instant to);

    long countByTenantIdAndActionAndResourceTypeAndOccurredAtBetween(
            UUID tenantId, String action, String resourceType, Instant from, Instant to);

    // ── the filter vocabulary, read from the rows rather than declared ──────────

    /**
     * The action names this tenant actually has in the window, alphabetically.
     *
     * <p>Read from the data rather than from {@code AuditEventCatalog}: the catalog says what MAY
     * be audited across the platform, which for a restaurant with no payroll module includes a
     * dozen options that can only ever return nothing. A filter offering a choice that yields an
     * empty list is the product inviting the user to conclude their log is missing rows.
     */
    @Query("""
            SELECT DISTINCT e.action FROM AuditEventEntity e
            WHERE e.tenantId = :tenantId
              AND e.occurredAt BETWEEN :from AND :to
            ORDER BY e.action
            """)
    List<String> findDistinctActions(@Param("tenantId") UUID tenantId,
                                     @Param("from") Instant from,
                                     @Param("to") Instant to);

    /** The resource types this tenant actually has in the window, alphabetically. */
    @Query("""
            SELECT DISTINCT e.resourceType FROM AuditEventEntity e
            WHERE e.tenantId = :tenantId
              AND e.occurredAt BETWEEN :from AND :to
              AND e.resourceType IS NOT NULL
            ORDER BY e.resourceType
            """)
    List<String> findDistinctResourceTypes(@Param("tenantId") UUID tenantId,
                                           @Param("from") Instant from,
                                           @Param("to") Instant to);
}
