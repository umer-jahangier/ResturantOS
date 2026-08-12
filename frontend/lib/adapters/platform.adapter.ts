import type { PageMeta } from "@/lib/api-client/types";
import type {
  ApiImpersonationRecord,
  ApiPlatformTenant,
  ApiProvisionResult,
  ApiTenantFeatures,
  ApiTenantUsage,
  ApiTierChange,
} from "@/lib/api-client/schemas/platform.schema";
import type {
  ImpersonationPage,
  ImpersonationRecord,
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

/**
 * One impersonation record.
 *
 * `status` is copied, never recomputed. The rule is "ACTIVE while `expires_at` is in the future",
 * and a browser evaluating it against its own clock would disagree with the server on any machine
 * whose time is off — on the one screen where "was this session still live?" is the question being
 * asked. Every nullable field stays nullable; nothing is defaulted to a string.
 */
export function adaptImpersonationRecord(api: ApiImpersonationRecord): ImpersonationRecord {
  return {
    id: api.id,
    tenantId: api.tenantId,
    tenantSlug: api.tenantSlug,
    tenantBrandName: api.tenantBrandName,
    adminUserId: api.adminUserId,
    adminEmail: api.adminEmail,
    targetUserId: api.targetUserId,
    startedAt: new Date(api.startedAt),
    expiresAt: toDate(api.expiresAt),
    status: api.status,
    reason: api.reason,
  };
}

/**
 * A page of records plus the two facts a pager needs.
 *
 * `nextPage` comes from `meta.page.nextCursor`, which the backend sets to null on the last page.
 * Deriving "is there more?" from `records.length === size` instead would be wrong on a full final
 * page, and the resulting phantom next page is indistinguishable from a broken filter.
 */
export function adaptImpersonationPage(
  api: ApiImpersonationRecord[],
  meta: PageMeta,
): ImpersonationPage {
  return {
    records: api.map(adaptImpersonationRecord),
    totalCount: meta.totalCount,
    nextPage: meta.page.nextCursor === null ? null : Number(meta.page.nextCursor),
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
