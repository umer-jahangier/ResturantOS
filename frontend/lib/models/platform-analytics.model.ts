// Layer-2 domain models for platform growth and usage. camelCase, `Date` rather than ISO strings,
// and every absence preserved — there is no `??` in the adapter that produces these.

/**
 * One observed bucket. There is no such thing as an unobserved one in this list.
 *
 * @see HonestSeries — the absence of a bucket is the load-bearing property of the whole type.
 */
export interface SeriesPoint {
  bucketStart: Date;
  /** The server's own label, cut in the server's zone: `2026-08-14`, `2026-W33`, `2026-08`. */
  bucketLabel: string;
  count: number;
  /** Null where a running total would be a fiction — see `HonestSeries.coverage`. */
  cumulative: number | null;
}

export type SeriesInterval = "DAY" | "WEEK" | "MONTH";

/**
 * A time series that refuses to invent its own past.
 *
 * <h3>What `points` is, and what it is not</h3>
 *
 * It is every bucket in which something was observed, ascending. It is NOT a dense line from
 * `windowFrom` to `windowTo`. The backend builds it by walking the observations rather than by
 * walking the calendar, so a bucket exists if and only if something happened in it — and this
 * model carries that through untouched.
 *
 * <p>A renderer must therefore plot the points it is given and must not pad the gaps. Padding is
 * not a cosmetic choice: a zero asserts "we measured this period and nothing happened", and before
 * {@link observedFrom} that assertion is false — the platform had no tenants at all, so there was
 * nothing to measure. Two different facts rendered as the same glyph, on a chart with axes, which
 * is a lie with a scale on it.
 *
 * <h3>`observedFrom` / `observedTo` are the honest x-domain</h3>
 *
 * They are the first and last instant this metric has ANY observation, across ALL time — not the
 * window. `observedFrom` is null when the metric has never been observed at all, which is a
 * complete and honest answer and is not the same as a series of zeroes.
 */
export interface HonestSeries {
  /** `tenants_created`, `tenants_suspended`, `tenants_cancelled`. */
  metric: string;
  interval: SeriesInterval;
  /** The IANA zone the buckets were cut in. Echoed so a caption cannot drift from the cut. */
  zone: string;
  windowFrom: Date;
  windowTo: Date;
  observedFrom: Date | null;
  observedTo: Date | null;
  /** Events before the window — where a cumulative line legitimately starts. Null where none. */
  baselineBeforeWindow: number | null;
  points: SeriesPoint[];
  /** Always false. Kept so a consumer can assert rather than assume. */
  backFilled: boolean;
  /** What this series does and does not prove, in the backend's words, for the screen to print. */
  coverage: string;
}

export interface TenantGrowth {
  generatedAt: Date;
  created: HonestSeries;
  suspended: HonestSeries;
  cancelled: HonestSeries;
}

/** Every point in a series, across all series — the shared y-domain a comparable chart needs. */
export function seriesPeak(series: HonestSeries[]): number {
  let peak = 0;
  for (const s of series) {
    for (const point of s.points) {
      if (point.count > peak) peak = point.count;
    }
  }
  return peak;
}

/** True when no series in the set has a single observation. Not "the values were zero". */
export function hasNoObservations(series: HonestSeries[]): boolean {
  return series.every((s) => s.points.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage roll-up
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One usage dimension summed across tenants, with the coverage of that sum beside it.
 *
 * <p>`total` is null when NOT ONE tenant could be counted. It is never zero-filled: a zero here
 * would claim the fleet is running no branches, and the difference between "none" and "we could
 * not find out" is the entire reason the per-tenant meter answers three ways.
 *
 * <p>`complete` is `tenantsCounted === tenantsInScope`. A "1,240 branches" figure computed from
 * nine of fourteen tenants is a different fact from the same figure computed from fourteen, and
 * that difference is what an operator would act on.
 */
export interface MeterRollup {
  resource: string;
  unit: string;
  total: number | null;
  /** Summed tier ceilings across the scope. Always known — it is stamped on the tenant row. */
  limitTotal: number;
  tenantsCounted: number;
  tenantsNotMetered: number;
  tenantsUnreadable: number;
  complete: boolean;
  source: string;
}

export interface UsageRollup {
  generatedAt: Date;
  /** A `TenantStatus` name, or `ALL`. */
  scope: string;
  tenantsInScope: number;
  /** The fan-out cap bit. A truncated total that does not say so is a fabricated total. */
  scopeTruncated: boolean;
  meters: MeterRollup[];
  anyMetered: boolean;
}

/**
 * Why a roll-up cannot be shown as a figure, or `null` when it can.
 *
 * <p>Returned as a SENTENCE rather than as a boolean because it is handed straight to
 * `Meter`'s `unavailableReason`, whose union refuses a value and a reason together. That is the
 * guard: a caller cannot render a number for a dimension this function has ruled out, because the
 * two shapes do not compile at the same time.
 *
 * <p>The `limitTotal <= 0` branch matters more than it looks. `Meter` requires a denominator, and
 * a tier with no ceiling recorded sums to zero — a meter drawn against zero either divides by zero
 * or renders a full bar, and a full bar means "at capacity", which is the opposite of what an
 * absent ceiling means.
 */
export function meterUnavailableReason(meter: MeterRollup): string | null {
  if (meter.total === null) {
    if (meter.tenantsUnreadable > 0) {
      return `Not one of the ${meter.tenantsUnreadable} tenants asked answered for this dimension on this request.`;
    }
    return meter.source;
  }
  if (meter.limitTotal <= 0) {
    return `Counted ${meter.total} ${meter.unit}, but no tier ceiling is recorded across this scope, so there is nothing to measure it against.`;
  }
  return null;
}
