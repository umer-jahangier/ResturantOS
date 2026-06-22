package io.restaurantos.shared.feature;

import org.springframework.data.redis.core.StringRedisTemplate;

import java.time.Duration;
import java.util.UUID;

/**
 * Redis-backed FeatureFlagService with 300-second TTL per spec §3.5 (LIB-04).
 * Key format: feature:{tenantId}:{featureCode} → "true" | "false"
 */
public class RedisFeatureFlagService implements FeatureFlagService {

    private final StringRedisTemplate redis;
    private final long cacheTtlSeconds;

    public RedisFeatureFlagService(StringRedisTemplate redis, long cacheTtlSeconds) {
        this.redis = redis;
        this.cacheTtlSeconds = cacheTtlSeconds;
    }

    @Override
    public boolean isEnabled(UUID tenantId, String featureCode) {
        String key = "feature:" + tenantId + ":" + featureCode;
        String cached = redis.opsForValue().get(key);
        if (cached != null) return Boolean.parseBoolean(cached);
        // Default: feature disabled unless explicitly enabled (fail-closed).
        redis.opsForValue().set(key, "false", Duration.ofSeconds(cacheTtlSeconds));
        return false;
    }
}
