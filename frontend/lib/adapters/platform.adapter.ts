import type { PageMeta } from "@/lib/api-client/types";
import type {
  ApiImpersonationRecord,
  ApiOperatorAuditRecord,
  ApiPlatformTenant,
  ApiProvisionResult,
  ApiSubscriptionHistoryRecord,
  ApiSubscriptionLimitReport,
  ApiSubscriptionPlan,
  ApiSubscriptionRegister,
  ApiTenantFeatures,
  ApiTenantSubscription,
  ApiTenantUsage,
  ApiTenantUserPage,
  ApiTierChange,
} from "@/lib/api-client/schemas/platform.schema";
import type {
  ImpersonationPage,
  ImpersonationRecord,
  OperatorAuditPage,
  OperatorAuditRecord,
  PlanSummary,
  PlatformTenant,
  ProvisionResult,
  SubscriptionDetail,
  SubscriptionHistoryEntry,
  SubscriptionHistoryPage,
  SubscriptionLimitReport,
  SubscriptionPlan,
  SubscriptionRegister,
  TenantFeatures,
  TenantSubscription,
  TenantUsage,
  TenantUserPage,
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

/**
 * One tenant's users, plus the provenance block that says how completely they were read.
 *
 * The scan is copied through untouched. In particular `totalCount` stays null when the API
 * withheld it: substituting `users.length` here would turn "we could not read every tenant" into a
 * confident number one layer below the only place that knows better.
 */
export function adaptTenantUserPage(api: ApiTenantUserPage): TenantUserPage {
  return {
    users: api.users.map((u) => ({
      tenantId: u.tenantId,
      tenantSlug: u.tenantSlug,
      tenantBrandName: u.tenantBrandName,
      userId: u.userId,
      email: u.email,
      fullName: u.fullName,
      locale: u.locale,
      active: u.active,
      mustChangePassword: u.mustChangePassword,
      totpEnabled: u.totpEnabled,
      lastLoginAt: toDate(u.lastLoginAt),
      createdAt: new Date(u.createdAt),
    })),
    scan: {
      tenantsMatched: api.scan.tenantsMatched,
      tenantsScanned: api.scan.tenantsScanned,
      unreachable: api.scan.unreachable.map((t) => ({
        tenantId: t.tenantId,
        tenantSlug: t.tenantSlug,
        detail: t.detail,
      })),
      truncated: api.scan.truncated,
      totalCount: api.scan.totalCount,
      totalCountNote: api.scan.totalCountNote,
    },
  };
}

function adaptPlanSummary(
  api: NonNullable<ApiTenantSubscription["subscription"]>["plan"],
): PlanSummary | null {
  return api === null
    ? null
    : {
        id: api.id,
        code: api.code,
        name: api.name,
        tier: api.tier,
        pricePaisa: api.pricePaisa,
        currency: api.currency,
        billingPeriod: api.billingPeriod,
      };
}

/**
 * A tenant's subscription, or the absence of one.
 *
 * `subscription: null` survives as null. There is no synthesised "free plan" object here and there
 * must not be: no tenant in this database has ever had a subscription, and manufacturing one would
 * assert a commercial agreement nobody made — the exact fabrication the backend's own docblock
 * refuses to perform on the write side.
 */
export function adaptTenantSubscription(api: ApiTenantSubscription): TenantSubscription {
  const s = api.subscription;
  const detail: SubscriptionDetail | null =
    s === null
      ? null
      : {
          id: s.id,
          tenantId: s.tenantId,
          status: s.status,
          plan: adaptPlanSummary(s.plan),
          trialStartAt: toDate(s.trialStartAt),
          trialEndAt: toDate(s.trialEndAt),
          trialDaysRemaining: s.trialDaysRemaining,
          currentPeriodStartAt: toDate(s.currentPeriodStartAt),
          currentPeriodEndAt: toDate(s.currentPeriodEndAt),
          renewalOverdue: s.renewalOverdue,
          pendingPlan: adaptPlanSummary(s.pendingPlan),
          pendingChangeAt: toDate(s.pendingChangeAt),
          pendingChangeReason: s.pendingChangeReason,
          cancelAt: toDate(s.cancelAt),
          cancelReason: s.cancelReason,
          cancelledAt: toDate(s.cancelledAt),
          startedAt: toDate(s.startedAt),
          endedAt: toDate(s.endedAt),
        };

  return {
    tenantId: api.tenantId,
    tier: api.tier,
    subscription: detail,
    planTierMatchesTenantTier: api.planTierMatchesTenantTier,
    note: api.note,
  };
}

/**
 * The limit report, unchanged in substance.
 *
 * As with `adaptTenantUsage`, there is deliberately no `?? 0` in this function. `used` and
 * `ceiling` stay nullable all the way to the meter, which is what lets the meter render a stated
 * absence instead of a full bar against a zero ceiling.
 */
export function adaptSubscriptionLimits(api: ApiSubscriptionLimitReport): SubscriptionLimitReport {
  return {
    tenantId: api.tenantId,
    planCode: api.planCode,
    tier: api.tier,
    anyMeasurable: api.anyMeasurable,
    exceeded: api.exceeded,
    checks: api.checks.map((c) => ({
      limit: c.limit,
      unit: c.unit,
      used: c.used,
      ceiling: c.ceiling,
      state: c.state,
      source: c.source,
    })),
  };
}

function adaptSubscriptionHistoryRecord(
  api: ApiSubscriptionHistoryRecord,
): SubscriptionHistoryEntry {
  return {
    id: api.id,
    tenantId: api.tenantId,
    subscriptionId: api.subscriptionId,
    changeType: api.changeType,
    fromPlanCode: api.fromPlanCode,
    toPlanCode: api.toPlanCode,
    fromStatus: api.fromStatus,
    toStatus: api.toStatus,
    fromTier: api.fromTier,
    toTier: api.toTier,
    fromPricePaisa: api.fromPricePaisa,
    toPricePaisa: api.toPricePaisa,
    effectiveAt: toDate(api.effectiveAt),
    recordedAt: new Date(api.recordedAt),
    actorKind: api.actorKind,
    actorPlatformUserId: api.actorPlatformUserId,
    actorEmail: api.actorEmail,
    reason: api.reason,
    forcedOverLimits: api.forcedOverLimits,
    detail: api.detail,
  };
}

export function adaptSubscriptionHistoryPage(
  api: ApiSubscriptionHistoryRecord[],
  meta: PageMeta,
): SubscriptionHistoryPage {
  return {
    entries: api.map(adaptSubscriptionHistoryRecord),
    totalCount: meta.totalCount,
    nextPage: meta.page.nextCursor === null ? null : Number(meta.page.nextCursor),
  };
}

function adaptOperatorAuditRecord(api: ApiOperatorAuditRecord): OperatorAuditRecord {
  return {
    id: api.id,
    occurredAt: new Date(api.occurredAt),
    platformUserId: api.platformUserId,
    platformUserEmail: api.platformUserEmail,
    action: api.action,
    outcome: api.outcome,
    tenantId: api.tenantId,
    tenantSlug: api.tenantSlug,
    targetUserId: api.targetUserId,
    reason: api.reason,
    detail: api.detail,
  };
}

/** A page of operator actions, with the same "nextCursor carries the page number" convention. */
export function adaptOperatorAuditPage(
  api: ApiOperatorAuditRecord[],
  meta: PageMeta,
): OperatorAuditPage {
  return {
    records: api.map(adaptOperatorAuditRecord),
    totalCount: meta.totalCount,
    nextPage: meta.page.nextCursor === null ? null : Number(meta.page.nextCursor),
  };
}

/**
 * One catalogue plan.
 *
 * No `?? 0` anywhere, deliberately. `maxTerminals` and `maxOrdersPerMonth` stay nullable all the
 * way to the screen: null means the plan declares no ceiling for that dimension, which is a
 * different statement from a ceiling of 0 ("none allowed") and a very different one from the
 * NOT_MEASURABLE verdict the limits report gives both of them regardless.
 */
export function adaptSubscriptionPlan(api: ApiSubscriptionPlan): SubscriptionPlan {
  return {
    id: api.id,
    code: api.code,
    name: api.name,
    description: api.description,
    tier: api.tier,
    pricePaisa: api.pricePaisa,
    currency: api.currency,
    billingPeriod: api.billingPeriod,
    trialDays: api.trialDays,
    maxBranches: api.maxBranches,
    maxUsers: api.maxUsers,
    storageGb: api.storageGb,
    nlqQuota: api.nlqQuota,
    maxTerminals: api.maxTerminals,
    maxOrdersPerMonth: api.maxOrdersPerMonth,
    active: api.active,
    features: api.features,
    subscriptionCount: api.subscriptionCount,
    createdAt: new Date(api.createdAt),
    updatedAt: new Date(api.updatedAt),
  };
}

/**
 * The cross-tenant register.
 *
 * `tenantsWithoutSubscription` and `revenueNote` travel through untouched. Both are the response
 * telling the screen what it is NOT looking at — the tenants missing from the list, and the money
 * this product cannot compute — and an adapter that dropped either would leave the console with the
 * rows alone, which read as the whole fleet and as a commercial picture. They are neither.
 */
export function adaptSubscriptionRegister(api: ApiSubscriptionRegister): SubscriptionRegister {
  return {
    rows: api.subscriptions.map((row) => ({
      tenantId: row.tenantId,
      tenantSlug: row.tenantSlug,
      tenantBrandName: row.tenantBrandName,
      tenantStatus: row.tenantStatus,
      tier: row.tier,
      planCode: row.planCode,
      planName: row.planName,
      pricePaisa: row.pricePaisa,
      currency: row.currency,
      billingPeriod: row.billingPeriod,
      status: row.status,
      trialEndAt: toDate(row.trialEndAt),
      currentPeriodEndAt: toDate(row.currentPeriodEndAt),
      renewalOverdue: row.renewalOverdue,
      pendingChangeAt: toDate(row.pendingChangeAt),
      pendingPlanCode: row.pendingPlanCode,
      cancelAt: toDate(row.cancelAt),
    })),
    totalSubscriptions: api.totalSubscriptions,
    tenantsWithoutSubscription: api.tenantsWithoutSubscription,
    revenueNote: api.revenueNote,
  };
}
