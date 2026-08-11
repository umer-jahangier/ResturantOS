import type {
  ApiPlatformTenant,
  ApiProvisionResult,
  ApiTenantFeatures,
  ApiTenantUsage,
  ApiTierChange,
} from "@/lib/api-client/schemas/platform.schema";
import type {
  PlatformTenant,
  ProvisionResult,
  TenantFeatures,
  TenantUsage,
  TierChangeResult,
} from "@/lib/models/platform.model";

// Layer-2b adapters: wire shape → domain model. Dates become `Date`, nullability is preserved
// exactly, and nothing is defaulted.

/** ISO string → Date, keeping null as null. A null timestamp is a real state, not a missing one. */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export function adaptPlatformTenant(api: ApiPlatformTenant): PlatformTenant {
  return {
    id: api.id,
    slug: api.slug,
    brandName: api.brandName,
    status: api.status,
    tier: api.tier,
    createdAt: new Date(api.createdAt),
    suspendedAt: toDate(api.suspendedAt),
    cancelledAt: toDate(api.cancelledAt),
    maxBranches: api.maxBranches,
    maxUsers: api.maxUsers,
    storageGb: api.storageGb,
    nlqQuota: api.nlqQuota,
    billingRef: api.billingRef,
    trialEndsAt: toDate(api.trialEndsAt),
    renewsAt: toDate(api.renewsAt),
  };
}

/**
 * Feature states, sorted so an operator's decisions surface first.
 *
 * Overrides ahead of tier defaults, then alphabetically. Twenty codes in provisioning order buries
 * the one row that answers "what did somebody deliberately change here?" — which is the only
 * question this screen exists for. The sort is stable across refetches because the comparator is
 * total, so a toggle does not make rows jump under the pointer.
 */
export function adaptTenantFeatures(api: ApiTenantFeatures): TenantFeatures {
  const states = [...api.featureStates].sort((a, b) => {
    if (a.isOverride !== b.isOverride) return a.isOverride ? -1 : 1;
    return a.code.localeCompare(b.code);
  });
  return { tier: api.tier, states };
}

/**
 * Usage meters, unchanged in substance.
 *
 * `used` stays nullable all the way to the component. There is deliberately no `?? 0` anywhere in
 * this function: that single character is how a screen starts claiming a tenant has zero users
 * when in truth nobody is counting them.
 */
export function adaptTenantUsage(api: ApiTenantUsage): TenantUsage {
  return {
    tenantId: api.tenantId,
    tier: api.tier,
    anyMetered: api.anyMetered,
    meters: api.meters.map((m) => ({
      resource: m.resource,
      unit: m.unit,
      used: m.used,
      limit: m.limit,
      metered: m.metered,
      unavailable: m.unavailable,
      source: m.source,
    })),
  };
}

export function adaptProvisionResult(api: ApiProvisionResult): ProvisionResult {
  return {
    tenantId: api.tenantId,
    slug: api.slug,
    adminEmail: api.adminEmail,
    tempPassword: api.tempPassword,
    loginUrl: api.loginUrl,
  };
}

export function adaptTierChange(api: ApiTierChange): TierChangeResult {
  return {
    tenantId: api.tenantId,
    previousTier: api.previousTier,
    tier: api.tier,
    changedFeatureCodes: api.changedFeatureCodes,
    maxBranches: api.maxBranches,
    maxUsers: api.maxUsers,
    storageGb: api.storageGb,
    nlqQuota: api.nlqQuota,
    forcedOverLimits: api.forcedOverLimits,
  };
}
