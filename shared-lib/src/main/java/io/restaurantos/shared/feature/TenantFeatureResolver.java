package io.restaurantos.shared.feature;

import java.util.Set;
import java.util.UUID;

/**
 * Source of truth for a tenant's enabled feature codes.
 *
 * <p>{@link RedisFeatureFlagService} uses this to resolve a cache miss. Implementations MUST throw
 * rather than return an empty set when the lookup fails — "we could not check" and "this tenant has
 * no features" are different answers, and conflating them makes every feature-gated endpoint 403.
 */
public interface TenantFeatureResolver {

    /**
     * @return the feature codes enabled for this tenant
     * @throws RuntimeException if the lookup could not be performed
     */
    Set<String> enabledFeatures(UUID tenantId);
}
