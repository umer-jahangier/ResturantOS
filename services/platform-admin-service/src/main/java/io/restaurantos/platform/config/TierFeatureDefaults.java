package io.restaurantos.platform.config;

import io.restaurantos.platform.entity.TenantEntity.TierType;
import org.springframework.stereotype.Component;

import java.util.*;

/**
 * Default feature flag matrix per tier (PLATFORM-10 / SC6).
 * Nine primary modules are ON in every tier; higher tiers unlock additional features.
 * SuperAdmin overrides via FeatureFlagAdminService are authoritative over these defaults.
 *
 * <p><b>This set must stay closed over the gateway's route→feature map.</b> A code that
 * {@code RouteFeatureMap} gates a prefix on but that appears in no tier set below can be granted to
 * nobody — provisioning seeds {@code tenant_features} from {@link #defaultsFor(String)} — so every
 * request to that prefix is refused with a clean, confident 403 that is indistinguishable from a
 * tenant who has not bought the module. That has shipped twice (the purchasing phantom flag and the
 * NLQ phantom flag, both named below). {@code FeatureCodeClosureTest} now fails the build on it.
 *
 * <p><b>Write feature codes in comments here only in split form</b> — {@code "FEATURE_" + "X"} —
 * exactly as {@code frontend/lib/features/feature-flags.ts} already does. This file is regex-scraped
 * for {@code /FEATURE_[A-Z_]+/} by {@code frontend/__tests__/lib/nav-feature-flags.test.ts} to build
 * the set of codes the backend knows about, so a code named in prose is silently admitted to that set
 * and stops being detectable as drift. Naming the purchasing phantom flag whole is what would let the
 * very bug that comment describes pass the guard that exists to catch it.
 */
@Component
public class TierFeatureDefaults {

    // All tiers: the eight primary modules + KDS default ON
    private static final Set<String> ALL_TIERS_ON = Set.of(
        "FEATURE_POS",
        "FEATURE_INVENTORY",
        "FEATURE_FINANCE",
        "FEATURE_VENDOR",
        "FEATURE_HR",
        // Payroll is the second half of the ONE module Phase 11 merged, not a separate product. Its
        // endpoints live at /api/v1/hr/payroll-runs and therefore gate on FEATURE_HR today, which is
        // the only reason the orphan FEATURE_PAYROLL mapping has never produced a live 403 — an
        // accident of routing, not a guarantee. Anything other than "on wherever HR is on" would mean
        // that the day /api/v1/payroll/ gets a route, half of an enabled module starts 403ing.
        "FEATURE_PAYROLL",
        "FEATURE_CRM",
        // Loyalty shipped in Phase 9 as part of CRM: accrual, tiers and promotions are served under
        // /api/v1/crm/ and are reachable on every tier today. Placing FEATURE_LOYALTY anywhere but
        // beside FEATURE_CRM would take away, on the day /api/v1/loyalty/ gets a route, a capability
        // STARTER tenants already have — the same split-module trap as payroll, in the other
        // direction.
        "FEATURE_LOYALTY",
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
        // NLQ is a premium/AI feature. RouteFeatureMap gates /api/v1/nlq/ on it and the frontend
        // lists it, but it was never defined in any tier here — so tenant_features was never seeded
        // with it and FeatureFlagGlobalFilter refused every NLQ request as a disabled feature
        // (identical to the "FEATURE_" + "PURCHASING" phantom-flag bug, decision 10-11-A).
        "FEATURE_NLQ",
        // Analytics belongs with the other Phase 12 premium surfaces it is built on:
        // FEATURE_REPORTING_ADVANCED and FEATURE_NLQ are both GROWTH+, and the ClickHouse-backed
        // analytics facts are the same infrastructure. Nothing regresses at this placement —
        // /api/v1/analytics/ has no gateway route, so no tenant reaches it on any tier today.
        "FEATURE_ANALYTICS",
        // Ecommerce is unbuilt: no service, no route, no frontend surface. It is defined here only so
        // the gateway's mapping names a code that exists, and it is placed at the plan's default
        // (GROWTH+) precisely because there is no shipped behaviour to preserve. When the module is
        // actually built, revisit this line deliberately rather than inheriting a default.
        "FEATURE_ECOMMERCE"
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
