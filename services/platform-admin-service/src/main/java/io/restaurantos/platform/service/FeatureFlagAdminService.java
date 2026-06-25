package io.restaurantos.platform.service;

import io.restaurantos.platform.entity.TenantFeatureEntity;
import io.restaurantos.platform.repository.TenantFeatureRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

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
        featureRepository.save(feature);

        // Dual-key SET: write both Redis key shapes synchronously (SC6 mandate)
        invalidateBothKeyShapes(tenantId, featureCode, enabled);

        log.info("[feature-flag] tenant={} feature={} enabled={} — Redis invalidated", tenantId, featureCode, enabled);
        return enabled;
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
