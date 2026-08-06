package io.restaurantos.platform.config;

import io.restaurantos.platform.entity.TenantEntity;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import org.springframework.stereotype.Component;

/**
 * The quantitative half of a tier: how many branches, how many users, how much storage, how many
 * natural-language queries a month.
 *
 * <p><b>Why this is a component and not a private method on {@code ProvisioningService}.</b> It was
 * one — a {@code switch} that ran exactly once per tenant, at provisioning, and nowhere else. That
 * was survivable only while a tier was write-once. The moment a tier can be CHANGED there are two
 * callers, and a second copy of this table in {@code TenantSubscriptionService} would be a
 * guaranteed future divergence: the day someone raises GROWTH's branch cap, a provisioned GROWTH
 * tenant and an upgraded-to-GROWTH tenant would get different numbers and nothing would fail.
 *
 * <p>{@link TierFeatureDefaults} is the qualitative half — which feature codes a tier unlocks. The
 * two are deliberately separate classes because they have different shapes (a fixed record of
 * numbers versus a set membership test) and different consumers; they are applied together by
 * {@code TenantSubscriptionService.changeTier}.
 */
@Component
public class TierLimits {

    /**
     * The numbers a tier entitles a tenant to. Every field is a CEILING, never a current count —
     * see {@code TenantSubscriptionService} for the usage comparison a downgrade has to make.
     */
    public record Limits(int maxBranches, int maxUsers, int storageGb, int nlqQuota) {}

    /**
     * The one table. Values are unchanged from {@code ProvisioningService.applyTierLimits} as it
     * stood before 13-14 — this is an extraction, not a re-tariffing, and a diff that changed a
     * number here would silently re-price every existing tenant on their next tier change.
     */
    public Limits forTier(TierType tier) {
        return switch (tier) {
            case STARTER    -> new Limits(1,   10,   5,   1000);
            case GROWTH     -> new Limits(5,   50,   20,  5000);
            case ENTERPRISE -> new Limits(50,  500,  100, 50000);
            case CUSTOM     -> new Limits(999, 9999, 999, 999999);
        };
    }

    /** Stamp the tier's limits onto the tenant row. Does NOT save — the caller owns the transaction. */
    public void applyTo(TenantEntity tenant) {
        Limits limits = forTier(tenant.getTier());
        tenant.setMaxBranches(limits.maxBranches());
        tenant.setMaxUsers(limits.maxUsers());
        tenant.setStorageGb(limits.storageGb());
        tenant.setNlqQuota(limits.nlqQuota());
    }
}
