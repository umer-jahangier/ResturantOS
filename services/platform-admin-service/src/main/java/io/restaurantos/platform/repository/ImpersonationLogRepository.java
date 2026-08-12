package io.restaurantos.platform.repository;

import io.restaurantos.platform.entity.ImpersonationLogEntity;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.UUID;

/**
 * Reads over {@code impersonation_log} — the record of platform staff assuming tenant users'
 * identities.
 *
 * <h2>What was here before, and why it was replaced rather than reused</h2>
 *
 * <p>This interface declared exactly one finder, {@code findByTenantIdOrderByStartedAtDesc(UUID)},
 * and it had <b>zero callers anywhere in the product</b>. It was written for a read path that was
 * never built: the write side records every impersonation, and until now nothing in the platform
 * could read one back. The endpoints on {@code PlatformAdminController} are that path, and giving
 * that method its first caller was the obvious move — so it is worth stating why it is not the one
 * taken.
 *
 * <p>It returns an unbounded {@code List}. {@code impersonation_log} only grows (it is immutable at
 * the trigger layer — {@code trg_impersonation_log_immutable}, changeset 040 — so there is no delete
 * and no archival path), and a tenant under active support load accumulates a row per session
 * forever. An endpoint built on that finder would load every row a tenant has ever had into the
 * heap to render the newest twenty, and would do it on a service whose other endpoints hold the
 * control plane for every restaurant on the platform. It also has no date filter, and
 * <i>"where has admin X been, between these two dates"</i> is the question this table exists to
 * answer.
 *
 * <p>So the finder is replaced by three paged, date-bounded shapes — the same "one method per
 * filter combination" structure {@code AuditQueryController} uses next door, which keeps every
 * query derived by Spring Data and avoids a nullable-parameter JPQL predicate (a
 * {@code :param is null or column = :param} form over a {@code uuid} column is where PostgreSQL
 * starts refusing to infer a parameter type).
 *
 * <h2>Every query here is read-only, and the table has no writer but one</h2>
 *
 * <p>{@code ImpersonationService.impersonate} is the sole writer, in the same transaction that
 * mints the token. Nothing updates a row: {@code ended_at} has no writer anywhere in this product,
 * which is why status is derived from {@code expires_at} instead — see
 * {@code ImpersonationQueryService.statusOf}.
 */
@Repository
public interface ImpersonationLogRepository extends JpaRepository<ImpersonationLogEntity, UUID> {

    /**
     * One tenant's impersonations, newest first, within a half-open-ish window.
     *
     * <p>{@code Between} is SQL {@code BETWEEN} and therefore inclusive at both ends. The callers
     * pass {@code EPOCH} and {@code now()} when a bound is omitted, so an omitted filter reads
     * "everything", not "nothing".
     */
    Page<ImpersonationLogEntity> findByTenantIdAndStartedAtBetween(
        UUID tenantId, Instant from, Instant to, Pageable pageable);

    /**
     * Every impersonation performed by one platform administrator, across all tenants.
     *
     * <p>This is the question that cannot be asked of {@code audit_db.audit_events} at all:
     * {@code audit_events} is per-tenant with FORCED row-level security, so "where has admin X
     * been" there means iterating every tenant with a token for each. Here it is one indexed read
     * over one table.
     *
     * <p>{@code adminUserId} is the entity field; the column is {@code platform_user_id}.
     */
    Page<ImpersonationLogEntity> findByAdminUserIdAndStartedAtBetween(
        UUID adminUserId, Instant from, Instant to, Pageable pageable);

    /** Every impersonation on the platform in a window, newest first. */
    Page<ImpersonationLogEntity> findByStartedAtBetween(
        Instant from, Instant to, Pageable pageable);
}
