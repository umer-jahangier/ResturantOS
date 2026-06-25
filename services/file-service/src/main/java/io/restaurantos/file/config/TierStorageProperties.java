package io.restaurantos.file.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Configuration;

import java.util.HashMap;
import java.util.Map;

/**
 * Binds restaurantos.tier-storage.* properties into a Map&lt;tier, limitBytes&gt;.
 * Used by QuotaService to determine a tenant's storage limit from their tier.
 * Keys are normalized to lowercase by Spring Boot property binding.
 */
@Configuration
@ConfigurationProperties(prefix = "restaurantos.tier-storage")
public class TierStorageProperties {

    /** Tier name (lowercase) → storage limit in bytes. */
    private Map<String, Long> limits = new HashMap<>(Map.of(
            "starter",    10_737_418_240L,
            "growth",     53_687_091_200L,
            "enterprise", 536_870_912_000L,
            "custom",     107_374_182_400L
    ));

    public Map<String, Long> getLimits() { return limits; }
    public void setLimits(Map<String, Long> limits) { this.limits = limits; }

    public long getLimitForTier(String tier) {
        String key = (tier == null) ? "starter" : tier.toLowerCase();
        return limits.getOrDefault(key, limits.getOrDefault("starter", 10_737_418_240L));
    }
}
