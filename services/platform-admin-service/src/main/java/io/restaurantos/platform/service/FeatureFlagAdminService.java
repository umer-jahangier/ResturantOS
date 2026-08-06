package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.TenantFeatureEntity;
import io.restaurantos.platform.repository.TenantFeatureRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * Feature-flag management with dual-key Redis invalidation (PLATFORM-04 / SC6).
 *
 * Two Redis key shapes must be invalidated atomically when a flag is toggled:
 *   1. Gateway shape (03-01):   tenant_features:{tenantId}:{featureCode}
 *   2. Aspect/service shape:    feature:{tenantId}:{featureCode}
 *
 * Both keys are deleted on write so the next read-through from any consumer
 * will re-populate from the DB source of truth.
 */
@Service
public class FeatureFlagAdminService {

    private static final Logger log = LoggerFactory.getLogger(FeatureFlagAdminService.class);

    private final TenantFeatureRepository featureRepository;
    private final StringRedisTemplate redis;

    public FeatureFlagAdminService(TenantFeatureRepository featureRepository,
                                   StringRedisTemplate redis) {
        this.featureRepository = featureRepository;
        this.redis = redis;
    }

    /**
     * Returns all features for a tenant as a map of featureCode → enabled.
     */
    public Map<String, Boolean> getFeatures(UUID tenantId) {
        return featureRepository.findByTenantId(tenantId).stream()
            .collect(Collectors.toMap(
                TenantFeatureEntity::getFeatureCode,
                TenantFeatureEntity::isEnabled
            ));
    }

    /**
     * Toggle a feature and immediately invalidate both Redis key shapes.
     * Called by SuperAdmin via PATCH /api/v1/platform/tenants/{tenantId}/features/{code}
     * and also by gateway /internal/platform/tenants/{tenantId}/features/{code}.
     *
     * <p><b>Every call through here marks the row as an override</b> (13-14). This method is only
     * ever reached from the two SuperAdmin-facing endpoints above, so an administrator touching a
     * flag is by definition making a deliberate decision — and PLATFORM-10 says that decision
     * outranks the tier default. Marking it is what lets
     * {@link #reconcileToTierDefaults(UUID, Map)} leave it alone on a later tier change instead of
     * quietly undoing it. Tier-seeded rows are written directly through the repository by
     * {@code ProvisioningService} and by the reconciler below, neither of which sets the marker.
     */
    @Transactional
    public boolean setFeature(UUID tenantId, String featureCode, boolean enabled) {
        TenantFeatureEntity feature = featureRepository
            .findByTenantIdAndFeatureCode(tenantId, featureCode)
            .orElseGet(() -> {
                TenantFeatureEntity f = new TenantFeatureEntity();
                f.setTenantId(tenantId);
                f.setFeatureCode(featureCode);
                return f;
            });
        feature.setEnabled(enabled);
        feature.setOverride(true);
        featureRepository.save(feature);

        // Dual-key SET: write both Redis key shapes synchronously (SC6 mandate)
        invalidateBothKeyShapes(tenantId, featureCode, enabled);

        log.info("[feature-flag] tenant={} feature={} enabled={} override=true — Redis invalidated",
            tenantId, featureCode, enabled);
        return enabled;
    }

    /**
     * Bring a tenant's feature rows into line with a tier's defaults, and report which codes
     * actually moved.
     *
     * <p>This is the qualitative half of a tier change (13-14 / PLATFORM-03). Codes the new tier
     * unlocks become enabled; codes it no longer covers become disabled; a code the tenant has no
     * row for at all gets one, which also backfills tenants provisioned before a code existed.
     *
     * <p><b>Rows marked {@code is_override} are skipped, in BOTH directions.</b> That is
     * PLATFORM-10 stated as code: an enterprise-only feature a SuperAdmin granted to a starter
     * tenant survives a downgrade, and a module a SuperAdmin deliberately switched OFF is not
     * switched back on by an upgrade. Skipping only the first direction would be the more tempting
     * half-measure and would silently re-enable something an administrator turned off for a reason.
     *
     * <p>Cache invalidation goes through {@link #invalidateBothKeyShapes}, the same private path
     * {@link #setFeature} uses — deliberately not reimplemented. Writing one of the two key shapes
     * leaves the other serving the previous answer, which is indistinguishable from a tier change
     * that did not take effect. Only codes whose stored value CHANGED are re-written, so an
     * upgrade does not churn twenty keys to alter three.
     *
     * <p>Nothing is deleted. A disabled feature keeps its row and every record the module owns
     * elsewhere; disabling gates access at the gateway (403 FEATURE_DISABLED) and nothing more, so
     * re-enabling restores the tenant exactly.
     *
     * @param defaults the target tier's full code→enabled map, from
     *                 {@link io.restaurantos.platform.config.TierFeatureDefaults#defaultsFor(String)}
     * @return the codes whose enabled state changed, in iteration order; empty when nothing moved
     */
    @Transactional
    public List<String> reconcileToTierDefaults(UUID tenantId, Map<String, Boolean> defaults) {
        Map<String, TenantFeatureEntity> existing = featureRepository.findByTenantId(tenantId).stream()
            .collect(Collectors.toMap(TenantFeatureEntity::getFeatureCode, f -> f, (a, b) -> a));

        List<String> changed = new ArrayList<>();
        List<TenantFeatureEntity> toSave = new ArrayList<>();

        for (Map.Entry<String, Boolean> entry : defaults.entrySet()) {
            String code = entry.getKey();
            boolean target = Boolean.TRUE.equals(entry.getValue());
            TenantFeatureEntity row = existing.get(code);

            if (row != null && row.isOverride()) {
                log.info("[feature-flag] tenant={} feature={} left at {} — SuperAdmin override is "
                    + "authoritative over the tier default of {} (PLATFORM-10)",
                    tenantId, code, row.isEnabled(), target);
                continue;
            }
            if (row == null) {
                row = new TenantFeatureEntity();
                row.setTenantId(tenantId);
                row.setFeatureCode(code);
                row.setEnabled(target);
                toSave.add(row);
                changed.add(code);
                continue;
            }
            if (row.isEnabled() != target) {
                row.setEnabled(target);
                toSave.add(row);
                changed.add(code);
            }
        }

        featureRepository.saveAll(toSave);
        for (String code : changed) {
            invalidateBothKeyShapes(tenantId, code, Boolean.TRUE.equals(defaults.get(code)));
        }
        log.info("[feature-flag] tenant={} reconciled to tier defaults — {} code(s) changed: {}",
            tenantId, changed.size(), changed);
        return List.copyOf(changed);
    }

    /**
     * Invalidate all feature flag entries for a tenant (used on tenant suspension/cancellation).
     */
    @Transactional
    public void invalidateAll(UUID tenantId) {
        featureRepository.findByTenantId(tenantId).forEach(f ->
            invalidateBothKeyShapes(tenantId, f.getFeatureCode(), f.isEnabled())
        );
        log.info("[feature-flag] All Redis cache entries invalidated for tenant={}", tenantId);
    }

    // --- Private helpers ---

    private void invalidateBothKeyShapes(UUID tenantId, String featureCode, boolean enabled) {
        String value = enabled ? "true" : "false";
        // Gateway key shape (03-01 SUMMARY §Redis keys)
        String gatewayKey  = "tenant_features:" + tenantId + ":" + featureCode;
        // Aspect / service key shape (shared-lib RedisFeatureFlagService)
        String serviceKey  = "feature:" + tenantId + ":" + featureCode;

        // SET (not DELETE) the actual new value so the gateway and @RequiresFeature aspect see the change
        // immediately on the next request. DELETE would cause RedisFeatureFlagService to fail-close to "false"
        // on cache miss, silently disabling the feature until TTL expiry (SC6 violation).
        redis.opsForValue().set(gatewayKey, value);
        redis.opsForValue().set(serviceKey, value);
    }
}
