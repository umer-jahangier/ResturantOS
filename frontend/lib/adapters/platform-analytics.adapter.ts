import type {
  ApiHonestSeries,
  ApiMeterRollup,
  ApiSeriesPoint,
  ApiTenantGrowth,
  ApiUsageRollup,
} from "@/lib/api-client/schemas/platform-analytics.schema";
import type {
  HonestSeries,
  MeterRollup,
  SeriesPoint,
  TenantGrowth,
  UsageRollup,
} from "@/lib/models/platform-analytics.model";

// Layer-2b adapters: wire shape → domain model. ISO strings become `Date`; nullability is carried
// through exactly. There is no `??` in this file, and that is the whole specification of it — a
// coalesce here would be a fabricated measurement, and `platform-overview.adapter.ts` makes the
// same commitment for the same reason.

function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function adaptPoint(api: ApiSeriesPoint): SeriesPoint {
  return {
    bucketStart: new Date(api.bucketStart),
    bucketLabel: api.bucketLabel,
    count: api.count,
    cumulative: api.cumulative,
  };
}

/**
 * The series, unpadded.
 *
 * <p>`points` is mapped one-for-one and is deliberately NOT densified against the window. The
 * temptation is real — a dense array is easier to draw and easier to zip with a label axis — and
 * yielding to it would put a measured zero in every period where the platform had nothing to
 * measure. The chart component is written to consume a sparse series precisely so this adapter
 * never has to make that trade.
 *
 * <p>The points are re-sorted rather than trusted. The backend sorts ascending and there is no
 * known path that does not, but a polyline built from out-of-order points draws a line that
 * doubles back on itself — a rendering artefact indistinguishable, at a glance, from real
 * volatility. Sorting a list that is already sorted costs nothing; the failure it prevents is
 * silent.
 */
function adaptSeries(api: ApiHonestSeries): HonestSeries {
  return {
    metric: api.metric,
    interval: api.interval,
    zone: api.zone,
    windowFrom: new Date(api.windowFrom),
    windowTo: new Date(api.windowTo),
    observedFrom: toDate(api.observedFrom),
    observedTo: toDate(api.observedTo),
    baselineBeforeWindow: api.baselineBeforeWindow,
    points: api.points
      .map(adaptPoint)
      .sort((a, b) => a.bucketStart.getTime() - b.bucketStart.getTime()),
    backFilled: api.backFilled,
    coverage: api.coverage,
  };
}

export function adaptTenantGrowth(api: ApiTenantGrowth): TenantGrowth {
  return {
    generatedAt: new Date(api.generatedAt),
    created: adaptSeries(api.created),
    suspended: adaptSeries(api.suspended),
    cancelled: adaptSeries(api.cancelled),
  };
}

function adaptMeterRollup(api: ApiMeterRollup): MeterRollup {
  return {
    resource: api.resource,
    unit: api.unit,
    // `total` stays null when it is null. The one line in this file most likely to be "fixed" by
    // a later reader into `api.total ?? 0`, which would render an unread fleet as an idle one.
    total: api.total,
    limitTotal: api.limitTotal,
    tenantsCounted: api.tenantsCounted,
    tenantsNotMetered: api.tenantsNotMetered,
    tenantsUnreadable: api.tenantsUnreadable,
    complete: api.complete,
    source: api.source,
  };
}

export function adaptUsageRollup(api: ApiUsageRollup): UsageRollup {
  return {
    generatedAt: new Date(api.generatedAt),
    scope: api.scope,
    tenantsInScope: api.tenantsInScope,
    scopeTruncated: api.scopeTruncated,
    meters: api.meters.map(adaptMeterRollup),
    anyMetered: api.anyMetered,
  };
}
