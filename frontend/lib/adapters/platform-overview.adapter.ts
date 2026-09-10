import type {
  ApiAnalyticsOverview,
  ApiDirectoryScan,
  ApiPlatformFigure,
  ApiPlatformUserPage,
  ApiSubscriptionRegister,
  ApiSubscriptionRegisterRow,
  ApiSystemHealth,
} from "@/lib/api-client/schemas/platform-overview.schema";
import type {
  AnalyticsOverview,
  DirectoryScan,
  PlatformFigure,
  SubscriptionRegister,
  SubscriptionRegisterRow,
  SystemHealth,
} from "@/lib/models/platform-overview.model";

// Layer-2b adapters for the platform overview: wire shape → domain model.
//
// ISO strings become `Date`. Nullability is preserved EXACTLY. Nothing is defaulted, coalesced or
// rounded up — every `??` in this file would be a fabricated figure, so there are none.

/** ISO string → Date, keeping null as null. A null timestamp is a real state, not a missing one. */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

/**
 * The three-state figure, flattened to one discriminator the UI can switch on.
 *
 * <p>`unreadable` is checked FIRST. The backend sets `measured: false` alongside
 * `unreadable: true` (an unreadable figure was not, in fact, measured), so testing `measured`
 * first would collapse "the source did not answer" into "nothing computes this" — which reads to
 * an operator as a permanent product limitation rather than as a live outage they can chase.
 */
export function adaptPlatformFigure(api: ApiPlatformFigure): PlatformFigure {
  return {
    name: api.name,
    value: api.value,
    state: api.unreadable ? "unreadable" : api.measured ? "measured" : "notMeasured",
    source: api.source,
  };
}

export function adaptAnalyticsOverview(api: ApiAnalyticsOverview): AnalyticsOverview {
  return {
    generatedAt: new Date(api.generatedAt),
    windowFrom: new Date(api.windowFrom),
    windowTo: new Date(api.windowTo),
    tenants: {
      total: api.tenants.total,
      byStatus: api.tenants.byStatus,
      byTier: api.tenants.byTier,
      byStatusAndTier: api.tenants.byStatusAndTier,
      active: api.tenants.active,
      inactive: api.tenants.inactive,
    },
    lifecycle: api.lifecycle.map(adaptPlatformFigure),
    entitlement: api.entitlement.map(adaptPlatformFigure),
    operations: api.operations.map(adaptPlatformFigure),
    unavailableMetrics: api.unavailableMetrics.map(adaptPlatformFigure),
  };
}

/**
 * Services in worst-first order, and that ordering is the feature.
 *
 * <p>A status page sorted by service id makes an operator read fourteen green rows to find the red
 * one, during the minute the page exists for. Sorting by severity puts what is broken at the top;
 * ties fall back to the id so the list is stable between polls and a row does not swap places
 * under the pointer while everything is healthy.
 */
const STATE_SEVERITY: Record<SystemHealth["overall"], number> = {
  DOWN: 0,
  UNREACHABLE: 1,
  UNKNOWN: 2,
  UP: 3,
};

export function adaptSystemHealth(api: ApiSystemHealth): SystemHealth {
  const services = [...api.services].sort(
    (a, b) =>
      STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state] || a.serviceId.localeCompare(b.serviceId),
  );

  return {
    checkedAt: new Date(api.checkedAt),
    overall: api.overall,
    registry: api.registry,
    services,
    infrastructure: api.infrastructure,
    migrations: api.migrations,
    notCollected: api.notCollected,
  };
}

function adaptSubscriptionRow(api: ApiSubscriptionRegisterRow): SubscriptionRegisterRow {
  return {
    tenantId: api.tenantId,
    tenantSlug: api.tenantSlug,
    tenantBrandName: api.tenantBrandName,
    tenantStatus: api.tenantStatus,
    tier: api.tier,
    planCode: api.planCode,
    planName: api.planName,
    pricePaisa: api.pricePaisa,
    currency: api.currency,
    billingPeriod: api.billingPeriod,
    status: api.status,
    trialEndAt: toDate(api.trialEndAt),
    currentPeriodEndAt: toDate(api.currentPeriodEndAt),
    renewalOverdue: api.renewalOverdue,
    pendingChangeAt: toDate(api.pendingChangeAt),
    pendingPlanCode: api.pendingPlanCode,
    cancelAt: toDate(api.cancelAt),
  };
}

export function adaptSubscriptionRegister(api: ApiSubscriptionRegister): SubscriptionRegister {
  return {
    rows: api.subscriptions.map(adaptSubscriptionRow),
    totalSubscriptions: api.totalSubscriptions,
    tenantsWithoutSubscription: api.tenantsWithoutSubscription,
    revenueNote: api.revenueNote,
  };
}

/**
 * The scan block, renamed but never softened.
 *
 * <p>`totalCount` → `total` and `totalCountNote` → `totalNote` is the only change. In particular
 * the null is carried through untouched: the backend withholds the total precisely when it cannot
 * be known, and an adapter that filled it in from `users.length` or from `tenantsScanned` would
 * undo the one guarantee the endpoint was designed to give.
 */
export function adaptDirectoryScan(api: ApiDirectoryScan): DirectoryScan {
  return {
    tenantsMatched: api.tenantsMatched,
    tenantsScanned: api.tenantsScanned,
    unreachable: api.unreachable,
    truncated: api.truncated,
    total: api.totalCount,
    totalNote: api.totalCountNote,
  };
}

/** The overview reads only the scan block; the rows belong to the directory screen. */
export function adaptDirectoryScanFromPage(api: ApiPlatformUserPage): DirectoryScan {
  return adaptDirectoryScan(api.scan);
}
