package io.restaurantos.gateway.support;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Maps request path prefixes to required {@code FEATURE_*} codes (Appendix C).
 *
 * <p>Data-driven: add new path→feature mappings here as new services are added.
 * The order of the map matters — first match wins.
 *
 * <h3>Redis key shape for feature flags (populated by platform-admin-service):</h3>
 * <pre>
 *   tenant_features:{tenantId}:{featureCode}  →  "true" | "false"
 * </pre>
 *
 * <h3>Quota-bearing routes:</h3>
 * <p>Routes that consume a quota (currently NLQ) are identified by
 * {@link #isQuotaBearing(String)} and checked via:
 * <pre>
 *   nlq_quota:{tenantId}:monthly_count  →  integer string
 * </pre>
 */
@Component
public class RouteFeatureMap {

    private static final Map<String, String> PREFIX_TO_FEATURE = new LinkedHashMap<>();

    static {
        // Phase 3 routes (auth/user/platform-admin have no feature gate — always accessible
        // for ACTIVE tenants). Feature-flagged routes appear in later phases.
        PREFIX_TO_FEATURE.put("/api/v1/finance/",    "FEATURE_FINANCE");
        PREFIX_TO_FEATURE.put("/api/v1/purchasing/", "FEATURE_VENDOR");
        PREFIX_TO_FEATURE.put("/api/v1/hr/",         "FEATURE_HR");
        PREFIX_TO_FEATURE.put("/api/v1/crm/",        "FEATURE_CRM");
        PREFIX_TO_FEATURE.put("/api/v1/nlq/",        "FEATURE_NLQ");
        PREFIX_TO_FEATURE.put("/api/v1/payroll/",    "FEATURE_PAYROLL");
        PREFIX_TO_FEATURE.put("/api/v1/analytics/",  "FEATURE_ANALYTICS");
        PREFIX_TO_FEATURE.put("/api/v1/loyalty/",    "FEATURE_LOYALTY");
        PREFIX_TO_FEATURE.put("/api/v1/kds/",        "FEATURE_KDS");
        PREFIX_TO_FEATURE.put("/api/v1/kitchen/",    "FEATURE_KDS");
        PREFIX_TO_FEATURE.put("/api/v1/ecommerce/",  "FEATURE_ECOMMERCE");
        PREFIX_TO_FEATURE.put("/api/v1/inventory/",  "FEATURE_INVENTORY");
    }

    /**
     * Returns the required feature code for the given path, or empty if the path
     * has no feature gate (core routes accessible to all ACTIVE tenants).
     */
    public Optional<String> featureFor(String path) {
        return PREFIX_TO_FEATURE.entrySet().stream()
                .filter(entry -> path.startsWith(entry.getKey()))
                .map(Map.Entry::getValue)
                .findFirst();
    }

    /**
     * Returns {@code true} for routes that consume a per-tenant quota.
     * Currently only NLQ has a quota; the counter is owned by the NLQ service
     * and the gateway reads-only to enforce the limit (seam documented in SUMMARY).
     */
    public boolean isQuotaBearing(String path) {
        return path.startsWith("/api/v1/nlq/");
    }
}
