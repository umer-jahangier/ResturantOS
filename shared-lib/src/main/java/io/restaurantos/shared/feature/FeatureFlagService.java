package io.restaurantos.shared.feature;

import java.util.UUID;

/** Reads tenant feature flags. Default impl is Redis-backed with 300s TTL. */
public interface FeatureFlagService {
    boolean isEnabled(UUID tenantId, String featureCode);
}
