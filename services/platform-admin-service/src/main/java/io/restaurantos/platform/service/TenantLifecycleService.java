package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.exception.StateInvalidException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Tenant lifecycle transitions (PLATFORM-02 / SC2).
 *
 * Valid transitions:
 *   ACTIVE          → SUSPENDED
 *   SUSPENDED       → ACTIVE   (reactivate)
 *   ACTIVE/SUSPENDED → CANCELLED
 *   CANCELLED        → PURGED   (CLOSED PERMANENTLY — a status change. NOTHING IS DELETED.)
 *
 * <h2>PURGED does not mean purged, and this comment used to say it did</h2>
 *
 * <p>This line read "hard-delete on explicit request only" and the endpoint behind it was
 * {@code DELETE /api/v1/platform/tenants/{id}} answering {@code 204 No Content} — the two loudest
 * signals in HTTP that something is gone. {@link #closePermanently} sets a status column and writes
 * a Redis key. It deletes NOTHING: not the tenant row, not the HQ branch in {@code user_db}, not the
 * admin user in {@code auth_db}, not the chart of accounts in {@code finance_db}, not orders,
 * inventory, payroll or files.
 *
 * <p><b>The claim had already spread.</b> Two other components were reasoning from it —
 * {@code PlatformDtos} and {@code ImpersonationQueryService} both explained their null-handling by
 * saying a PURGED tenant's registration row is deleted, so their lookups miss. The lookups do not
 * miss, because the row is still there. Both are corrected.
 *
 * <p><b>Why this was made honest rather than made true.</b> A real erasure crosses fifteen databases
 * that share no foreign keys, so a saga that misses one leaves the platform telling a customer their
 * data is erased when it is not — worse than not offering erasure at all. And the hard question is
 * not technical: {@code audit_events} and {@code impersonation_log} are DELIBERATELY immutable
 * (append-only, enforced by triggers) so that nobody can rewrite history, and financial records
 * generally carry retention obligations that outlive an erasure request. Which of those an erasure
 * may touch is a decision for the product owner with legal advice, not one to settle inside a
 * lifecycle service. What an actual erasure path would require is written up in
 * {@code .planning/decisions/D-TENANT-ERASURE.md}.
 *
 * <p>The wider codebase already holds this position: V15/V12/V7 all take "deactivate, never delete"
 * because {@code orders.branch_id} must keep naming a real row.
 *
 * <p>On suspend/reactivate/cancel the tenant status key is written to Redis immediately
 * ({@code tenant:status:{tenantId}}) so the gateway enforces the new status on the next request.
 */
@Service
public class TenantLifecycleService {

    private static final Logger log = LoggerFactory.getLogger(TenantLifecycleService.class);

    private final TenantRepository tenantRepository;
    private final FeatureFlagAdminService featureFlagAdminService;
    private final StringRedisTemplate redis;

    public TenantLifecycleService(TenantRepository tenantRepository,
                                   FeatureFlagAdminService featureFlagAdminService,
                                   StringRedisTemplate redis) {
        this.tenantRepository = tenantRepository;
        this.featureFlagAdminService = featureFlagAdminService;
        this.redis = redis;
    }

    @Transactional
    public TenantEntity suspend(UUID tenantId, String reason) {
        TenantEntity tenant = requireTenant(tenantId);
        requireStatus(tenant, TenantStatus.ACTIVE, "suspend");
        tenant.setStatus(TenantStatus.SUSPENDED);
        tenant.setSuspendedAt(Instant.now());
        tenantRepository.save(tenant);
        updateStatusKey(tenantId, TenantStatus.SUSPENDED);
        featureFlagAdminService.invalidateAll(tenantId);
        log.info("[lifecycle] tenant={} → SUSPENDED reason={}", tenantId, reason);
        return tenant;
    }

    @Transactional
    public TenantEntity reactivate(UUID tenantId) {
        TenantEntity tenant = requireTenant(tenantId);
        requireStatus(tenant, TenantStatus.SUSPENDED, "reactivate");
        tenant.setStatus(TenantStatus.ACTIVE);
        tenant.setSuspendedAt(null);
        tenantRepository.save(tenant);
        updateStatusKey(tenantId, TenantStatus.ACTIVE);
        log.info("[lifecycle] tenant={} → ACTIVE (reactivated)", tenantId);
        return tenant;
    }

    @Transactional
    public TenantEntity cancel(UUID tenantId, String reason) {
        TenantEntity tenant = requireTenant(tenantId);
        if (tenant.getStatus() != TenantStatus.ACTIVE && tenant.getStatus() != TenantStatus.SUSPENDED) {
            // Same 409-not-500 reasoning as requireStatus below: a well-formed request in the
            // wrong state is a CONFLICT, not a server fault.
            throw new StateInvalidException(
                "Cannot cancel tenant " + tenantId + " in status " + tenant.getStatus()
                + " (required: ACTIVE or SUSPENDED)");
        }
        tenant.setStatus(TenantStatus.CANCELLED);
        tenant.setCancelledAt(Instant.now());
        tenantRepository.save(tenant);
        updateStatusKey(tenantId, TenantStatus.CANCELLED);
        featureFlagAdminService.invalidateAll(tenantId);
        log.info("[lifecycle] tenant={} → CANCELLED reason={}", tenantId, reason);
        return tenant;
    }

    /**
     * Closes a cancelled tenant permanently. <b>This does not delete anything.</b>
     *
     * <p>Named {@code purge} until 2026-08-13, behind {@code DELETE /tenants/{id}} answering
     * {@code 204 No Content}. It has never deleted a byte: the tenant row stays in
     * {@code platform_db}, its HQ branch stays in {@code user_db}, its admin stays in
     * {@code auth_db}, its chart of accounts stays in {@code finance_db}, and so on across fifteen
     * databases. Renamed so the name states what it does, because the old one made a data-erasure
     * promise the platform could not keep — and two other components had already written code
     * around that promise being true.
     *
     * <p>The tenant becomes unusable: PURGED is refused by
     * {@code TenantSubscriptionService} for any tier change, the Redis status key makes the gateway
     * reject its requests, and the platform console hides it by default. That is a strong close.
     * It is not erasure, and a customer asking "is my data gone" must not be told yes on the
     * strength of this call.
     *
     * <p>See {@code .planning/decisions/D-TENANT-ERASURE.md} for what a real erasure would require
     * and the two questions that are the product owner's to answer before it is built.
     */
    @Transactional
    public TenantEntity closePermanently(UUID tenantId) {
        TenantEntity tenant = requireTenant(tenantId);
        requireStatus(tenant, TenantStatus.CANCELLED, "close");
        tenant.setStatus(TenantStatus.PURGED);
        tenantRepository.save(tenant);
        updateStatusKey(tenantId, TenantStatus.PURGED);
        // Deliberately not "purged": the log is read during incidents, and it should not be the
        // thing that convinces somebody the data is gone.
        log.info("[lifecycle] tenant={} → PURGED (closed permanently; no data deleted)", tenantId);
        return tenant;
    }

    // --- Private helpers ---

    private TenantEntity requireTenant(UUID tenantId) {
        return tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));
    }

    /**
     * Refuses a transition from the wrong status — as a 409, not a 500 (known defect E2E-D5).
     *
     * <p>This threw {@code IllegalStateException}, which no handler claims, so it fell through to
     * the catch-all and every ordering mistake came back as
     * {@code 500 INTERNAL_ERROR — "An unexpected error occurred"}. The precondition was right and
     * the caller was told nothing: a client could not tell "you called these in the wrong order"
     * from "the server is broken", and the only way to learn the sequence was to read this file.
     * It also meant a genuine 500 here was indistinguishable from routine misuse in alerting.
     *
     * <p>{@link StateInvalidException} maps to {@code 409 STATE_INVALID} in shared-lib's handler,
     * which is what the rest of this service already returns for "well-formed request, wrong state"
     * — see PlatformAdminExceptionHandler's own note that 409 is right because the caller is
     * entitled to make the request and a 400 would send them hunting for a typo.
     *
     * <p>The message still names the operation, the current status and the required one, because a
     * refusal a caller cannot act on is only marginally better than a 500.
     */
    private void requireStatus(TenantEntity tenant, TenantStatus required, String operation) {
        if (tenant.getStatus() != required) {
            throw new StateInvalidException(
                "Cannot " + operation + " tenant " + tenant.getId() +
                " in status " + tenant.getStatus() + " (required: " + required + ")");
        }
    }

    /** Write current status to gateway Redis key so suspension takes effect immediately at the edge. */
    private void updateStatusKey(UUID tenantId, TenantStatus status) {
        redis.opsForValue().set("tenant:status:" + tenantId, status.name());
    }
}
