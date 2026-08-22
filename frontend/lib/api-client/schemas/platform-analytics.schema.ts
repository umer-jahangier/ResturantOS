import { z } from "zod";

/**
 * Layer-1 wire schemas for the two platform-analytics reads the OVERVIEW does not make:
 * `GET /platform/analytics/tenant-growth` and `GET /platform/analytics/usage`.
 *
 * <h3>Why this is a third platform schema file rather than a widening of the other two</h3>
 *
 * `platform.schema.ts` is the tenant-lifecycle plane. `platform-overview.schema.ts` holds the four
 * reads behind `/platform/dashboard` — including `analytics/overview` and `system/health`, which
 * the analytics and system SCREENS re-read through the same hooks rather than re-declaring here.
 * These two shapes are the only ones the overview never asks for, so they land beside their own
 * consumers instead of growing a file two other workstreams edit.
 *
 * <h3>The rule this file exists to keep on the wire</h3>
 *
 * **A bucket with no observation is ABSENT, and it must stay absent all the way to the axis.**
 * `PlatformAnalyticsDtos.HonestSeries` says it in the backend's own words: back-filling a missing
 * bucket with zero asserts "we measured this period and nothing happened", and for these columns
 * that assertion is frequently false — the platform did not exist yet, or the column is written by
 * a lifecycle transition that publishes no event and keeps only its most recent value. A zero and
 * "we did not measure" are different facts, and a chart cannot tell them apart once they are the
 * same number.
 *
 * So there is no `.default(0)`, no `.catch()`, and no array padding anywhere below. The one place
 * a densifying default would be tempting — {@link apiSeriesPointSchema}'s `cumulative` — is
 * `.nullable()`, because the backend returns null for the two series where a running total is
 * meaningless (`suspended_at` and `cancelled_at` overwrite themselves, so summing them counts
 * nothing).
 *
 * <h3>And there is no money here</h3>
 *
 * Not omitted — absent from the source. `platform_db` holds no invoice, payment, price or
 * processor reference; `tenants.billing_ref` is a free-text VARCHAR with no foreign key. The
 * usage roll-up measures BRANCHES, USERS, STORAGE and NLQ QUERIES against tier ceilings, all of
 * which are real, and none of which is a currency.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tenant growth — mirrors `PlatformAnalyticsDtos.TenantGrowthResponse`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One bucket of a series. `count` is always >= 1 — the backend does not emit empty buckets.
 *
 * @see apiHonestSeriesSchema for why an absent bucket may never become a zero on the way to a
 *      chart.
 */
export const apiSeriesPointSchema = z.object({
  bucketStart: z.string(),
  /** `2026-08-14`, `2026-W33` or `2026-08`, cut by the server in the zone it echoes back. */
  bucketLabel: z.string(),
  count: z.number(),
  /** Null for a series whose column overwrites itself, where a running total would be a fiction. */
  cumulative: z.number().nullable(),
});

/**
 * A time series that carries the limits of its own construction.
 *
 * <p>`observedFrom` / `observedTo` are the first and last instant this metric has ANY observation
 * across all time — NOT the window bounds. They exist so a chart cannot imply the metric was zero
 * before the platform had a single tenant: a line that starts at the window edge asserts a
 * measurement at the window edge, and these two fields are what let a renderer say "the record
 * begins here" instead.
 *
 * <p>`backFilled` is always false today and is parsed anyway. It is in the contract so a consumer
 * can ASSERT on it rather than assume it, and so a future backend change that starts densifying
 * has to announce itself on the wire instead of quietly changing what a flat line means.
 */
export const apiHonestSeriesSchema = z.object({
  metric: z.string(),
  interval: z.enum(["DAY", "WEEK", "MONTH"]),
  zone: z.string(),
  windowFrom: z.string(),
  windowTo: z.string(),
  observedFrom: z.string().nullable(),
  observedTo: z.string().nullable(),
  baselineBeforeWindow: z.number().nullable(),
  points: z.array(apiSeriesPointSchema),
  backFilled: z.boolean(),
  /** What the series does and does not prove, in words the screen renders beside it. */
  coverage: z.string(),
});

export const apiTenantGrowthSchema = z.object({
  generatedAt: z.string(),
  created: apiHonestSeriesSchema,
  suspended: apiHonestSeriesSchema,
  cancelled: apiHonestSeriesSchema,
});

// ─────────────────────────────────────────────────────────────────────────────
// Usage roll-up — mirrors `PlatformAnalyticsDtos.UsageRollupResponse`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One usage dimension summed across tenants, with the coverage of the sum attached.
 *
 * <p>`total` is `.nullable()` and must stay that way: it is null when NOT ONE tenant could be
 * counted, and `?? 0` between here and a meter would render "0 of 240 branches" for a fleet that
 * is actually serving traffic. The per-tenant endpoint answers three ways per dimension —
 * counted, not-metered, unreadable — so a roll-up cannot be a single number. It is a number plus
 * how many tenants it actually covers, and `complete` is the one flag that says whether those two
 * agree.
 */
export const apiMeterRollupSchema = z.object({
  /** `branches`, `users`, `storage_gb`, `nlq_queries`. */
  resource: z.string(),
  unit: z.string(),
  total: z.number().nullable(),
  /** Summed tier ceilings. Always computable — the limit is stamped on the tenant row. */
  limitTotal: z.number(),
  tenantsCounted: z.number(),
  tenantsNotMetered: z.number(),
  tenantsUnreadable: z.number(),
  complete: z.boolean(),
  source: z.string(),
});

/**
 * `scopeTruncated` is not decoration. The roll-up fans out one internal HTTP call per tenant per
 * dimension and caps the fan-out; a truncated total that does not say so is a fabricated total.
 */
export const apiUsageRollupSchema = z.object({
  generatedAt: z.string(),
  scope: z.string(),
  tenantsInScope: z.number(),
  scopeTruncated: z.boolean(),
  meters: z.array(apiMeterRollupSchema),
  /** False when not one dimension is recorded for any tenant — one honest banner, not five rows. */
  anyMetered: z.boolean(),
});

export type ApiSeriesPoint = z.infer<typeof apiSeriesPointSchema>;
export type ApiHonestSeries = z.infer<typeof apiHonestSeriesSchema>;
export type ApiTenantGrowth = z.infer<typeof apiTenantGrowthSchema>;
export type ApiMeterRollup = z.infer<typeof apiMeterRollupSchema>;
export type ApiUsageRollup = z.infer<typeof apiUsageRollupSchema>;
