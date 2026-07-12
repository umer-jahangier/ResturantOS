package io.restaurantos.shared.feature;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.Set;
import java.util.UUID;

/**
 * Redis-backed FeatureFlagService with 300-second TTL per spec §3.5 (LIB-04).
 * Key format: feature:{tenantId}:{featureCode} → "true" | "false"
 *
 * <p>On a cache miss the flag is resolved from {@link TenantFeatureResolver} (platform-admin, which
 * owns the {@code tenant_features} table) and the real answer is cached.
 *
 * <p>This class previously had NO source of truth: a cache miss returned {@code false} AND wrote
 * {@code "false"} into Redis. Since nothing except a SuperAdmin toggle ever wrote {@code "true"},
 * every {@code @RequiresFeature} endpoint returned 403 for a freshly-provisioned tenant even though
 * its {@code tenant_features} rows were correct. A failed lookup is now never cached — "cannot
 * verify" must not be persisted as "disabled".
 */
public class RedisFeatureFlagService implements FeatureFlagService {

    private static final Logger log = LoggerFactory.getLogger(RedisFeatureFlagService.class);

    private final StringRedisTemplate redis;
    private final long cacheTtlSeconds;
    private final TenantFeatureResolver resolver;

    public RedisFeatureFlagService(StringRedisTemplate redis, long cacheTtlSeconds) {
        this(redis, cacheTtlSeconds, null);
    }

    public RedisFeatureFlagService(StringRedisTemplate redis, long cacheTtlSeconds,
                                   TenantFeatureResolver resolver) {
        this.redis = redis;
        this.cacheTtlSeconds = cacheTtlSeconds;
        this.resolver = resolver;
    }

    @Override
    public boolean isEnabled(UUID tenantId, String featureCode) {
        String key = "feature:" + tenantId + ":" + featureCode;
        String cached = redis.opsForValue().get(key);
        if (cached != null) {
            return Boolean.parseBoolean(cached);
        }

        if (resolver == null) {
            // No source of truth wired — fail closed, but do NOT cache the guess.
            log.warn("[feature-flag] no TenantFeatureResolver configured; denying {} for tenant {}",
                    featureCode, tenantId);
            return false;
        }

        try {
            Set<String> enabled = resolver.enabledFeatures(tenantId);
            // One round trip answers every flag for this tenant — cache them all.
            for (String code : enabled) {
                redis.opsForValue().set("feature:" + tenantId + ":" + code, "true",
                        Duration.ofSeconds(cacheTtlSeconds));
            }
            boolean on = enabled.contains(featureCode);
            if (!on) {
                redis.opsForValue().set(key, "false", Duration.ofSeconds(cacheTtlSeconds));
            }
            return on;
        } catch (RuntimeException ex) {
            // Deny this request, but never persist the failure — a transient platform-admin blip
            // would otherwise disable the feature for the whole TTL.
            log.error("[feature-flag] lookup failed for tenant={} feature={} — denying (not cached)",
                    tenantId, featureCode, ex);
            return false;
        }
    }
}
