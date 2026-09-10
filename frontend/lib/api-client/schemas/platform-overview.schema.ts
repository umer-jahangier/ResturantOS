import { z } from "zod";

import { apiTenantStatusSchema, apiTierSchema } from "./platform.schema";

/**
 * Layer-1 wire schemas for the four reads behind the platform OVERVIEW (`/platform/dashboard`).
 *
 * <h3>Why this is a separate file from `platform.schema.ts`</h3>
 *
 * That file is the tenant-lifecycle plane — provisioning, features, usage, impersonation — and it
 * is edited by the tenant screens. These four endpoints (`analytics/overview`, `system/health`,
 * `subscriptions`, `users`) landed together with the console rebuild and are read by the overview
 * and by the screens that own each domain. Splitting them keeps two unrelated workstreams off one
 * file, which is the same argument `PlatformUserDtos` makes for not living inside `PlatformDtos`.
 *
 * <h3>The one rule every shape here is built to</h3>
 *
 * **A figure the platform cannot compute arrives as a stated absence, and must never be coerced
 * to a number on the way to a screen.** The backend went to considerable trouble to make that
 * expressible on the wire — {@link apiPlatformFigureSchema}'s measured/unreadable trichotomy,
 * {@link apiDirectoryScanSchema}'s withheld `totalCount`, `HealthState.UNKNOWN` being distinct
 * from `DOWN` — and every one of those distinctions dies the moment a schema writes
 * `.nullable().default(0)`. There is no `.default()` anywhere in this file, deliberately.
 *
 * <h3>What is NOT here, and will not be</h3>
 *
 * No revenue, MRR, ARR, ARPU, churn value, invoice or payment field. Not because they were
 * forgotten — because `PlatformAnalyticsService` returns them as `notMeasured` figures inside
 * `unavailableMetrics`, which IS the contract: this product integrates no billing, and
 * `tenants.billing_ref` is free text with no foreign key. {@link apiPlatformFigureSchema} parses
 * that list so the console can render the absence deliberately.
 */

// ─────────────────────────────────────────────────────────────────────────────
// The honest scalar — mirrors `PlatformAnalyticsDtos.PlatformFigure`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One platform figure in one of three states.
 *
 * `value` is `.nullable()` and stays that way through the adapter and the model. `measured: true`
 * with `value: 0` means "counted, and the answer was none"; `measured: false` means nothing in
 * this product computes it; `unreadable: true` means a real source did not answer on this
 * request. A screen that renders all three as `0` has told three different lies with one glyph.
 */
export const apiPlatformFigureSchema = z.object({
  name: z.string(),
  value: z.number().nullable(),
  measured: z.boolean(),
  unreadable: z.boolean(),
  source: z.string(),
});

/** One cell of the status × tier cross-tab. Only occurring combinations are emitted. */
export const apiStatusTierCellSchema = z.object({
  status: z.string(),
  tier: z.string(),
  count: z.number(),
});

/**
 * Mirrors `PlatformAnalyticsDtos.TenantPopulation`.
 *
 * `byStatus` and `byTier` are densified server-side against the compiled enums, so every declared
 * status and tier is present with a real zero. That densification is legitimate where a time
 * bucket's would not be: the status set is closed, so "no tenant is currently PURGED" is something
 * the table can actually establish. They are still parsed as open records rather than as a fixed
 * object — a status added to the backend enum must widen the map, not fail the page.
 */
export const apiTenantPopulationSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  byTier: z.record(z.string(), z.number()),
  byStatusAndTier: z.array(apiStatusTierCellSchema),
  active: z.number(),
  inactive: z.number(),
});

/** Mirrors `PlatformAnalyticsDtos.AnalyticsOverviewResponse`. */
export const apiAnalyticsOverviewSchema = z.object({
  generatedAt: z.string(),
  windowFrom: z.string(),
  windowTo: z.string(),
  tenants: apiTenantPopulationSchema,
  lifecycle: z.array(apiPlatformFigureSchema),
  entitlement: z.array(apiPlatformFigureSchema),
  operations: z.array(apiPlatformFigureSchema),
  unavailableMetrics: z.array(apiPlatformFigureSchema),
});

// ─────────────────────────────────────────────────────────────────────────────
// System health — mirrors `SystemHealthDtos`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `UNREACHABLE` and `UNKNOWN` are separate members and neither may ever be folded into `DOWN`.
 *
 * DOWN is a self-report: the process answered and said it was unhealthy. UNREACHABLE means
 * nothing answered, which is equally consistent with a network partition or with this service
 * being the isolated one. UNKNOWN means there was nothing to probe. At 3am those call for
 * different actions, which is the entire reason the backend spends four members on it.
 */
export const apiHealthStateSchema = z.enum(["UP", "DOWN", "UNREACHABLE", "UNKNOWN"]);

export const apiInstanceHealthSchema = z.object({
  instanceId: z.string(),
  uri: z.string(),
  state: apiHealthStateSchema,
  detail: z.string().nullable(),
  responseTimeMs: z.number().nullable(),
});

export const apiServiceHealthSchema = z.object({
  serviceId: z.string(),
  state: apiHealthStateSchema,
  instancesRegistered: z.number(),
  instancesUp: z.number(),
  instancesDown: z.number(),
  instancesUnreachable: z.number(),
  instances: z.array(apiInstanceHealthSchema),
  detail: z.string().nullable(),
});

export const apiComponentHealthSchema = z.object({
  name: z.string(),
  kind: z.string(),
  state: apiHealthStateSchema,
  detail: z.string().nullable(),
});

export const apiMigrationStateSchema = z.object({
  name: z.string(),
  state: apiHealthStateSchema,
  basis: z.string(),
  detail: z.string().nullable(),
});

/**
 * A metric an operator would expect on a status page and which this platform does not collect.
 *
 * Parsed rather than dropped for the reason the backend sends it: an omitted tile reads as an
 * oversight and invites the next author to add it with fabricated data. "Queue depth is not
 * collected — no RabbitMQ management client exists in any service" is a status page telling the
 * truth about its own limits.
 */
export const apiUncollectedMetricSchema = z.object({
  name: z.string(),
  reason: z.string(),
});

export const apiSystemHealthSchema = z.object({
  checkedAt: z.string(),
  overall: apiHealthStateSchema,
  registry: apiComponentHealthSchema,
  services: z.array(apiServiceHealthSchema),
  infrastructure: z.array(apiComponentHealthSchema),
  migrations: z.array(apiMigrationStateSchema),
  notCollected: z.array(apiUncollectedMetricSchema),
});

// ─────────────────────────────────────────────────────────────────────────────
// Subscription register — mirrors `SubscriptionDtos.SubscriptionRegisterResponse`
// ─────────────────────────────────────────────────────────────────────────────

/** Mirrors `TenantSubscriptionEntity.SubscriptionStatus`. */
export const apiSubscriptionStatusSchema = z.enum([
  "TRIALING",
  "ACTIVE",
  "TRIAL_ENDED",
  "CANCELLED",
  "ENDED",
]);

export const apiBillingPeriodSchema = z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]);

/**
 * One row of the cross-tenant register.
 *
 * `pricePaisa` is BIGINT paisa and is what the plan is **sold at** — not money received. This
 * product observes no payment anywhere, so the figure may only ever be rendered beside a plan and
 * never summed into anything that reads as revenue. See `SubscriptionRegisterResponse.revenueNote`,
 * which the backend sends in words for exactly this reason.
 */
export const apiSubscriptionRegisterRowSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  tenantBrandName: z.string(),
  tenantStatus: apiTenantStatusSchema,
  tier: apiTierSchema,
  planCode: z.string(),
  planName: z.string(),
  pricePaisa: z.number(),
  currency: z.string(),
  billingPeriod: apiBillingPeriodSchema,
  status: apiSubscriptionStatusSchema,
  trialEndAt: z.string().nullable(),
  currentPeriodEndAt: z.string().nullable(),
  renewalOverdue: z.boolean(),
  pendingChangeAt: z.string().nullable(),
  pendingPlanCode: z.string().nullable(),
  cancelAt: z.string().nullable(),
});

/**
 * `tenantsWithoutSubscription` is the coverage number and it is not optional to render.
 *
 * Without it the register reads as "the fleet" while silently omitting every tenant that has no
 * subscription record — which, until an operator assigns plans, is all of them.
 */
export const apiSubscriptionRegisterSchema = z.object({
  subscriptions: z.array(apiSubscriptionRegisterRowSchema),
  totalSubscriptions: z.number(),
  tenantsWithoutSubscription: z.number(),
  revenueNote: z.string(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant user directory — mirrors `PlatformUserDtos.PlatformUserPage`
// ─────────────────────────────────────────────────────────────────────────────

/** A tenant the directory could not read, named rather than counted. */
export const apiUnreachableTenantSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  detail: z.string().nullable(),
});

/**
 * The provenance of a cross-tenant scan.
 *
 * There is no cross-tenant user query in this product: `auth_db.users` is FORCE row-level security
 * and `platform_db` holds no grant in it, so a fleet-wide list is one HTTP call per tenant with one
 * chance to fail per tenant. `totalCount` is `null` whenever any tenant was unreachable or the
 * fan-out cap bit, and `totalCountNote` says which. **Parsing `totalCount` as nullable is the whole
 * point** — a `?? 0` between here and the screen turns "we could not find out" into "there are
 * none", which is the exact fabrication the shape exists to refuse.
 */
export const apiDirectoryScanSchema = z.object({
  tenantsMatched: z.number(),
  tenantsScanned: z.number(),
  unreachable: z.array(apiUnreachableTenantSchema),
  truncated: z.boolean(),
  totalCount: z.number().nullable(),
  totalCountNote: z.string().nullable(),
});

export const apiPlatformUserRowSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string(),
  tenantBrandName: z.string(),
  userId: z.string().uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  locale: z.string().nullable(),
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  totpEnabled: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export const apiPlatformUserPageSchema = z.object({
  users: z.array(apiPlatformUserRowSchema),
  scan: apiDirectoryScanSchema,
});

export type ApiPlatformFigure = z.infer<typeof apiPlatformFigureSchema>;
export type ApiAnalyticsOverview = z.infer<typeof apiAnalyticsOverviewSchema>;
export type ApiSystemHealth = z.infer<typeof apiSystemHealthSchema>;
export type ApiSubscriptionRegister = z.infer<typeof apiSubscriptionRegisterSchema>;
export type ApiSubscriptionRegisterRow = z.infer<typeof apiSubscriptionRegisterRowSchema>;
export type ApiPlatformUserPage = z.infer<typeof apiPlatformUserPageSchema>;
export type ApiDirectoryScan = z.infer<typeof apiDirectoryScanSchema>;
