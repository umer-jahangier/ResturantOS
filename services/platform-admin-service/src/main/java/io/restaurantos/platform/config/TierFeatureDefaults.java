package io.restaurantos.platform.config;

import io.restaurantos.platform.entity.TenantEntity.TierType;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Default feature flag matrix per tier (PLATFORM-10 / SC6).
 * Seven primary modules are ON in every tier; higher tiers unlock additional features.
 * SuperAdmin overrides via FeatureFlagAdminService are authoritative over these defaults.
 */
@Component
public class TierFeatureDefaults {

    // All tiers: six primary modules + KDS default ON
    private static final Set<String> ALL_TIERS_ON = Set.of(
        "FEATURE_POS",
        "FEATURE_INVENTORY",
        "FEATURE_FINANCE",
        "FEATURE_VENDOR",
        "FEATURE_HR",
        "FEATURE_CRM",
        "FEATURE_KDS"
    );

    // Features available from GROWTH tier and above
    private static final Set<String> GROWTH_AND_ABOVE = Set.of(
        "FEATURE_MULTI_BRANCH",
        "FEATURE_REPORTING_ADVANCED",
        "FEATURE_WHATSAPP_NOTIFICATIONS",
        "FEATURE_CUSTOM_ROLES",
        "FEATURE_AUDIT_EXPORT",
        "FEATURE_LOT_TRACKING",
        // NLQ is a premium/AI feature. RouteFeatureMap gates /api/v1/nlq/ on FEATURE_NLQ and the
        // frontend lists it, but it was never defined in any tier here — so tenant_features was
        // never seeded with it and FeatureFlagGlobalFilter 403'd FEATURE_DISABLED on every NLQ
        // request (identical to the FEATURE_PURCHASING phantom-flag bug, decision 10-11-A).
        "FEATURE_NLQ"
    );

    // Features available from ENTERPRISE tier and above
    private static final Set<String> ENTERPRISE_AND_ABOVE = Set.of(
        "FEATURE_WHITE_LABEL_DOMAIN",
        "FEATURE_CONSOLIDATED_REPORTING"
    );

    // All known feature codes across the platform
    private static final Set<String> ALL_KNOWN_FEATURES;
    static {
        Set<String> all = new LinkedHashSet<>();
        all.addAll(ALL_TIERS_ON);
        all.addAll(GROWTH_AND_ABOVE);
        all.addAll(ENTERPRISE_AND_ABOVE);
        ALL_KNOWN_FEATURES = Collections.unmodifiableSet(all);
    }

    /**
     * Returns the complete feature flag map for the given tier.
     * Keys are feature codes; values are the default enabled state.
     * Used to seed tenant_features at provisioning time.
     */
    public Map<String, Boolean> defaultsFor(String tier) {
        TierType tierType = TierType.valueOf(tier);
        Map<String, Boolean> defaults = new LinkedHashMap<>();
        for (String code : ALL_KNOWN_FEATURES) {
            defaults.put(code, isEnabledByDefault(code, tierType));
        }
        return defaults;
    }

    private boolean isEnabledByDefault(String featureCode, TierType tier) {
        if (ALL_TIERS_ON.contains(featureCode)) {
            return true;
        }
        if (GROWTH_AND_ABOVE.contains(featureCode)) {
            return tier == TierType.GROWTH || tier == TierType.ENTERPRISE || tier == TierType.CUSTOM;
        }
        if (ENTERPRISE_AND_ABOVE.contains(featureCode)) {
            return tier == TierType.ENTERPRISE || tier == TierType.CUSTOM;
        }
        return false;
    }

    public Set<String> allFeatureCodes() {
        return ALL_KNOWN_FEATURES;
    }
}
