package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.repository.TenantRepository;
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
 *   CANCELLED        → PURGED   (hard-delete on explicit request only)
 *
 * On suspend/reactivate/cancel the tenant status key is written to Redis immediately
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
            throw new IllegalStateException(
                "Cannot cancel tenant " + tenantId + " in status " + tenant.getStatus());
        }
        tenant.setStatus(TenantStatus.CANCELLED);
        tenant.setCancelledAt(Instant.now());
        tenantRepository.save(tenant);
        updateStatusKey(tenantId, TenantStatus.CANCELLED);
        featureFlagAdminService.invalidateAll(tenantId);
        log.info("[lifecycle] tenant={} → CANCELLED reason={}", tenantId, reason);
        return tenant;
    }

    @Transactional
    public void purge(UUID tenantId) {
        TenantEntity tenant = requireTenant(tenantId);
        requireStatus(tenant, TenantStatus.CANCELLED, "purge");
        tenant.setStatus(TenantStatus.PURGED);
        tenantRepository.save(tenant);
        updateStatusKey(tenantId, TenantStatus.PURGED);
        log.info("[lifecycle] tenant={} → PURGED", tenantId);
    }

    // --- Private helpers ---

    private TenantEntity requireTenant(UUID tenantId) {
        return tenantRepository.findById(tenantId)
            .orElseThrow(() -> new IllegalArgumentException("Tenant not found: " + tenantId));
    }

    private void requireStatus(TenantEntity tenant, TenantStatus required, String operation) {
        if (tenant.getStatus() != required) {
            throw new IllegalStateException(
                "Cannot " + operation + " tenant " + tenant.getId() +
                " in status " + tenant.getStatus() + " (required: " + required + ")");
        }
    }

    /** Write current status to gateway Redis key so suspension takes effect immediately at the edge. */
    private void updateStatusKey(UUID tenantId, TenantStatus status) {
        redis.opsForValue().set("tenant:status:" + tenantId, status.name());
    }
}
