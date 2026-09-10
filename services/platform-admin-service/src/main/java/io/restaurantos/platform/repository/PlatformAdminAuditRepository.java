package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.PlatformAdminAuditEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

/**
 * Reads over {@code platform_admin_audit} — what platform operators have done to tenant accounts.
 *
 * <p>Write-side is {@link io.restaurantos.platform.service.PlatformAdminAuditRecorder} and nothing
 * else; the table is append-only at the trigger layer (changeset 050) so there is no update and no
 * delete to expose. {@code save} is inherited and is the only mutating method used.
 *
 * <p>The finder shapes follow {@link ImpersonationLogRepository} rather than inventing a second
 * convention: one derived method per filter combination, date-bounded, paged. That interface
 * records at length why an unbounded {@code List} finder over a monotonically growing accountability
 * table is the wrong shape — the same reasoning applies here verbatim, and this table grows faster
 * because it records refusals as well as successes.
 *
 * <p>Callers pass {@code Instant.EPOCH} and {@code now()} when a bound is omitted, so an absent
 * filter reads "everything" rather than "nothing". {@code Between} is SQL {@code BETWEEN} and is
 * inclusive at both ends.
 */
@Repository
public interface PlatformAdminAuditRepository extends JpaRepository<PlatformAdminAuditEntity, UUID> {

    /** Everything, newest first, in a window. */
    Page<PlatformAdminAuditEntity> findByOccurredAtBetween(
        Instant from, Instant to, Pageable pageable);

    /**
     * "Where has operator X been?" — one indexed read over one table, and the question
     * {@code audit_db} is structurally incapable of answering: {@code audit_events} is per-tenant
     * with FORCED row-level security, so the same question there is one query and one token per
     * tenant, and it misses any tenant whose outbox delivery failed.
     */
    Page<PlatformAdminAuditEntity> findByPlatformUserIdAndOccurredAtBetween(
        UUID platformUserId, Instant from, Instant to, Pageable pageable);

    /** "What has the platform done to MY tenant?" */
    Page<PlatformAdminAuditEntity> findByTenantIdAndOccurredAtBetween(
        UUID tenantId, Instant from, Instant to, Pageable pageable);

    /** Everything done to one account, across operators. */
    Page<PlatformAdminAuditEntity> findByTargetUserIdAndOccurredAtBetween(
        UUID targetUserId, Instant from, Instant to, Pageable pageable);
}
