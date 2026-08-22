import { z } from "zod";

// Layer-1 wire schemas for /api/v1/platform/**. Every repository call `.parse()`s through one of
// these — the throwing variant, always, so schema drift surfaces as a caught error the
// QueryBoundary renders rather than as `undefined` reaching a component.

export const apiTierSchema = z.enum(["STARTER", "GROWTH", "ENTERPRISE", "CUSTOM"]);

export const apiTenantStatusSchema = z.enum([
  "PROVISIONING",
  "ACTIVE",
  "SUSPENDED",
  "CANCELLED",
  "PURGED",
  "PROVISIONING_FAILED",
]);

/**
 * Mirrors `SubscriptionPlanEntity.BillingPeriod`.
 *
 * Deliberately three values and no `WEEKLY` or `CUSTOM`: each one has to be convertible to a period
 * length by `SubscriptionService.nextPeriodEnd`, and a period the code cannot advance is a renewal
 * date that silently never moves.
 */
export const apiBillingPeriodSchema = z.enum(["MONTHLY", "QUARTERLY", "ANNUAL"]);

/**
 * Mirrors `TenantSubscriptionEntity.SubscriptionStatus`.
 *
 * `TRIAL_ENDED` changes NO entitlement — it does not suspend the tenant, gate a feature or lower a
 * ceiling. It is a worklist state produced by the clock, saying "this needs a decision", and it is
 * rendered as one. `CANCELLED` here is a cancelled SUBSCRIPTION, which is not a cancelled TENANT:
 * the restaurant keeps its status, its data and its entitlements.
 */
export const apiSubscriptionStatusSchema = z.enum([
  "TRIALING",
  "ACTIVE",
  "TRIAL_ENDED",
  "CANCELLED",
  "ENDED",
]);

/**
 * Mirrors `PlatformDtos.TenantResponse`.
 *
 * The four entitlement ceilings are `.nullable()` because the columns are nullable, and a null
 * ceiling is a real state the usage screen has to be able to render honestly rather than coerce
 * to 0 — a 0 ceiling would make every meter read "over limit".
 */
export const apiPlatformTenantSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  brandName: z.string(),
  status: apiTenantStatusSchema,
  tier: apiTierSchema,
  createdAt: z.string(),
  suspendedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  maxBranches: z.number().nullable(),
  maxUsers: z.number().nullable(),
  storageGb: z.number().nullable(),
  nlqQuota: z.number().nullable(),
  billingRef: z.string().nullable(),
  trialEndsAt: z.string().nullable(),
  renewsAt: z.string().nullable(),
});

export const apiPlatformTenantsSchema = z.array(apiPlatformTenantSchema);

export const apiFeatureSourceSchema = z.enum([
  "TIER_DEFAULT",
  "OVERRIDE_MATCHES_TIER",
  "OVERRIDE_GRANT",
  "OVERRIDE_REVOKE",
  "UNSEEDED",
]);

export const apiFeatureStateSchema = z.object({
  code: z.string(),
  enabled: z.boolean(),
  tierDefault: z.boolean(),
  isOverride: z.boolean(),
  source: apiFeatureSourceSchema,
});

/**
 * Mirrors `PlatformDtos.TenantFeaturesResponse` (19c).
 *
 * `features` — the legacy `code → boolean` map — is still sent and is deliberately NOT parsed
 * here. It carries strictly less information than `featureStates`, and accepting both would let a
 * component read the poorer one by accident, which is the defect this response shape was widened
 * to remove. Zod strips unknown keys by default, so it simply does not survive the boundary.
 */
export const apiTenantFeaturesSchema = z.object({
  tier: apiTierSchema,
  featureStates: z.array(apiFeatureStateSchema),
});

/**
 * Mirrors `PlatformDtos.UsageMeter`.
 *
 * `used` is `.nullable()` and that nullability is load-bearing: null means "nobody counts this",
 * 0 means "counted, and the answer was none". Defaulting null to 0 anywhere between here and the
 * screen reintroduces exactly the fabrication this endpoint was designed to avoid.
 */
export const apiUsageMeterSchema = z.object({
  resource: z.string(),
  unit: z.string(),
  used: z.number().nullable(),
  limit: z.number(),
  metered: z.boolean(),
  unavailable: z.boolean(),
  source: z.string(),
});

export const apiTenantUsageSchema = z.object({
  tenantId: z.string().uuid(),
  tier: apiTierSchema,
  meters: z.array(apiUsageMeterSchema),
  anyMetered: z.boolean(),
});

/**
 * Mirrors `PlatformDtos.ProvisionResult`.
 *
 * `tempPassword` is nullable on one path only — an idempotent replay after the credential's
 * one-hour retention window. The tenant still exists; the credential is simply gone, and the
 * screen has to say that rather than render an empty box that looks like a bug.
 */
export const apiProvisionResultSchema = z.object({
  tenantId: z.string().uuid(),
  slug: z.string(),
  adminEmail: z.string(),
  tempPassword: z.string().nullable(),
  loginUrl: z.string(),
});

export const apiTierChangeSchema = z.object({
  tenantId: z.string().uuid(),
  previousTier: apiTierSchema,
  tier: apiTierSchema,
  changedFeatureCodes: z.array(z.string()),
  maxBranches: z.number(),
  maxUsers: z.number(),
  storageGb: z.number(),
  nlqQuota: z.number(),
  forcedOverLimits: z.boolean(),
});

/**
 * Mirrors `PlatformDtos.ImpersonationStatus`.
 *
 * `UNKNOWN` is a real backend value, not a client-side fallback: `expires_at` is nullable, and a
 * row with no expiry has no knowable session lifetime. It is parsed rather than coerced so the
 * screen can say so in words instead of picking one of the other two at random.
 */
export const apiImpersonationStatusSchema = z.enum(["ACTIVE", "EXPIRED", "UNKNOWN"]);

/**
 * Mirrors `PlatformDtos.ImpersonationRecord`.
 *
 * <b>There is no `token` field and no `endedAt` field, and both absences are deliberate.</b> The
 * issued JWT is never persisted, so the schema cannot leak one. `ended_at` is a column with no
 * writer anywhere in the product — always NULL — so it is not sent and the screen never renders an
 * "Ended: —" that would look like an observation about the session rather than about the product.
 *
 * `tenantSlug`, `tenantBrandName` and `adminEmail` are nullable because the referenced row can be
 * gone (a PURGED tenant, a deleted platform account) while the immutable impersonation record
 * remains. `targetUserId` has no name at all: tenant users live in a database platform_db cannot
 * reach.
 */
export const apiImpersonationRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  tenantSlug: z.string().nullable(),
  tenantBrandName: z.string().nullable(),
  adminUserId: z.string().uuid(),
  adminEmail: z.string().nullable(),
  targetUserId: z.string().uuid(),
  startedAt: z.string(),
  expiresAt: z.string().nullable(),
  status: apiImpersonationStatusSchema,
  reason: z.string().nullable(),
});

export const apiImpersonationRecordsSchema = z.array(apiImpersonationRecordSchema);

export type ApiImpersonationRecord = z.infer<typeof apiImpersonationRecordSchema>;
export type ApiPlatformTenant = z.infer<typeof apiPlatformTenantSchema>;
export type ApiTenantFeatures = z.infer<typeof apiTenantFeaturesSchema>;
export type ApiTenantUsage = z.infer<typeof apiTenantUsageSchema>;
export type ApiProvisionResult = z.infer<typeof apiProvisionResultSchema>;
export type ApiTierChange = z.infer<typeof apiTierChangeSchema>;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The tenant-management surfaces added by the SuperAdmin plan: a tenant's users, its subscription
// and plan limits, its subscription history, and the operator-audit trail.
//
// Every one of these mirrors a Java record that was read before it was written — the contracts
// live in `services/platform-admin-service/.../dto/{PlatformUserDtos,SubscriptionDtos}.java` and
// each carries a docblock explaining which of its fields are load-bearing absences. The schemas
// below preserve those absences rather than smoothing them: a `.nullable()` here is almost always
// a deliberate "we could not find out", which is a different answer from zero and must survive the
// boundary intact.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors `PlatformUserDtos.PlatformUserRow`.
 *
 * `lastLoginAt` null means **never signed in** — the shape of a provisioned-but-unusable account,
 * and the single most useful thing this row says. It is not a missing value and the screen must
 * not render it as a blank date.
 *
 * There is deliberately no `lockedUntil`: the upstream summary does not carry it, and a `false`
 * invented for "locked" on every row would be a fabricated column.
 */
export const apiTenantUserRowSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string().nullable(),
  tenantBrandName: z.string().nullable(),
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

/** Mirrors `PlatformUserDtos.UnreachableTenant` — named individually, never merely counted. */
export const apiUnreachableTenantSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string().nullable(),
  detail: z.string().nullable(),
});

/**
 * Mirrors `PlatformUserDtos.DirectoryScan` — how the list in front of you was actually obtained.
 *
 * There is no cross-tenant user query in this product: `auth_db.users` is FORCE row-level security
 * and reachable one tenant at a time over HTTP, so a fleet-wide list is N calls with N chances to
 * fail. `totalCount` is `.nullable()` for exactly that reason — when any tenant was unreachable
 * the real total is unknown, and the API withholds it rather than reporting a smaller number that
 * looks complete. `totalCountNote` is the reason, and the screen is required to render it.
 */
export const apiDirectoryScanSchema = z.object({
  tenantsMatched: z.number(),
  tenantsScanned: z.number(),
  unreachable: z.array(apiUnreachableTenantSchema),
  truncated: z.boolean(),
  totalCount: z.number().nullable(),
  totalCountNote: z.string().nullable(),
});

/** Mirrors `PlatformUserDtos.PlatformUserPage` — the rows, and how they were obtained. */
export const apiTenantUserPageSchema = z.object({
  users: z.array(apiTenantUserRowSchema),
  scan: apiDirectoryScanSchema,
});

/** Mirrors `SubscriptionDtos.PlanSummary`. `pricePaisa` is BIGINT paisa, never major units. */
export const apiPlanSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  tier: apiTierSchema,
  pricePaisa: z.number(),
  currency: z.string(),
  billingPeriod: z.string(),
});

/**
 * Mirrors `SubscriptionDtos.SubscriptionDetail`.
 *
 * `renewalOverdue` is derived on the server and is a worklist flag, not a failure: the scheduler
 * deliberately does not roll a renewal period forward, because advancing the date would assert
 * that the tenant paid and this product observes no payments.
 */
export const apiSubscriptionDetailSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  status: z.string(),
  plan: apiPlanSummarySchema.nullable(),
  trialStartAt: z.string().nullable(),
  trialEndAt: z.string().nullable(),
  trialDaysRemaining: z.number().nullable(),
  currentPeriodStartAt: z.string().nullable(),
  currentPeriodEndAt: z.string().nullable(),
  renewalOverdue: z.boolean(),
  pendingPlan: apiPlanSummarySchema.nullable(),
  pendingChangeAt: z.string().nullable(),
  pendingChangeReason: z.string().nullable(),
  cancelAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
});

/**
 * Mirrors `SubscriptionDtos.TenantSubscriptionResponse`.
 *
 * `subscription: null` is a REAL ANSWER, not an error: no tenant in this database has ever had a
 * subscription, because inventing a plan and a start date for an existing tenant would assert a
 * commercial agreement nobody made. The tier is returned beside the absence and is what actually
 * governs entitlement, so the screen says so instead of showing an empty card.
 */
export const apiTenantSubscriptionSchema = z.object({
  tenantId: z.string().uuid(),
  tier: apiTierSchema,
  subscription: apiSubscriptionDetailSchema.nullable(),
  planTierMatchesTenantTier: z.boolean().nullable(),
  note: z.string().nullable(),
});

/** Mirrors `SubscriptionDtos.LimitState`. Four states, and collapsing any two is the defect. */
export const apiLimitStateSchema = z.enum(["WITHIN", "EXCEEDED", "NOT_MEASURABLE", "UNREADABLE"]);

/**
 * Mirrors `SubscriptionDtos.PlanLimitCheck`.
 *
 * `used` is null unless the state is WITHIN or EXCEEDED, and `ceiling` is null when the plan
 * declares no limit — which is a different statement from a ceiling of 0 ("none allowed"). Neither
 * is defaulted anywhere between here and the meter.
 */
export const apiPlanLimitCheckSchema = z.object({
  limit: z.string(),
  unit: z.string(),
  used: z.number().nullable(),
  ceiling: z.number().nullable(),
  state: apiLimitStateSchema,
  source: z.string(),
});

/**
 * Mirrors `SubscriptionDtos.SubscriptionLimitReport`.
 *
 * `exceeded: 0` beside `anyMeasurable: false` is a completely different screen from `exceeded: 0`
 * beside `anyMeasurable: true` — the first says nothing we can measure disagrees, the second says
 * the tenant fits. Both fields are required on the screen for that reason.
 */
export const apiSubscriptionLimitReportSchema = z.object({
  tenantId: z.string().uuid(),
  planCode: z.string().nullable(),
  tier: apiTierSchema,
  checks: z.array(apiPlanLimitCheckSchema),
  anyMeasurable: z.boolean(),
  exceeded: z.number(),
});

/**
 * Mirrors `SubscriptionDtos.SubscriptionHistoryRecord`.
 *
 * Plan codes and prices are the values captured AT THE TIME, never resolved on read: a plan can be
 * archived and re-priced afterwards, and a trail that re-resolved them would retroactively rewrite
 * what a tenant was moved onto.
 */
export const apiSubscriptionHistoryRecordSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  subscriptionId: z.string().uuid().nullable(),
  changeType: z.string(),
  fromPlanCode: z.string().nullable(),
  toPlanCode: z.string().nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  fromTier: z.string().nullable(),
  toTier: z.string().nullable(),
  fromPricePaisa: z.number().nullable(),
  toPricePaisa: z.number().nullable(),
  effectiveAt: z.string().nullable(),
  recordedAt: z.string(),
  actorKind: z.string(),
  actorPlatformUserId: z.string().uuid().nullable(),
  actorEmail: z.string().nullable(),
  reason: z.string().nullable(),
  forcedOverLimits: z.boolean(),
  detail: z.string().nullable(),
});

export const apiSubscriptionHistoryRecordsSchema = z.array(apiSubscriptionHistoryRecordSchema);

/**
 * Mirrors `PlatformUserDtos.PlatformAuditRecord` — one platform-operator action.
 *
 * It never carries a credential: the platform password reset hands a temporary password to the
 * operator once and it exists nowhere else, not in a log, not in an event, not in the audit row
 * and not here. `platformUserEmail` is stored at WRITE time (the SuperAdmin credential is rotated,
 * and a trail that re-resolved its own actors would change its own history) while `tenantSlug` is
 * resolved at READ time from a slug the product does not permit renaming.
 */
export const apiOperatorAuditRecordSchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string(),
  platformUserId: z.string().uuid().nullable(),
  platformUserEmail: z.string().nullable(),
  action: z.string().nullable(),
  outcome: z.string().nullable(),
  tenantId: z.string().uuid().nullable(),
  tenantSlug: z.string().nullable(),
  targetUserId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  detail: z.string().nullable(),
});

export const apiOperatorAuditRecordsSchema = z.array(apiOperatorAuditRecordSchema);

export type ApiTenantUserPage = z.infer<typeof apiTenantUserPageSchema>;
export type ApiTenantSubscription = z.infer<typeof apiTenantSubscriptionSchema>;
export type ApiSubscriptionLimitReport = z.infer<typeof apiSubscriptionLimitReportSchema>;
export type ApiSubscriptionHistoryRecord = z.infer<typeof apiSubscriptionHistoryRecordSchema>;
export type ApiOperatorAuditRecord = z.infer<typeof apiOperatorAuditRecordSchema>;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Plans and the cross-tenant subscription register.
//
// Mirrors `SubscriptionDtos.{PlanResponse, SubscriptionRegisterRow, SubscriptionRegisterResponse}`,
// read before they were written. Two things about these shapes are load-bearing and are preserved
// rather than smoothed:
//
//   1. **`pricePaisa` is BIGINT paisa and is a LIST PRICE.** It is what a plan is SOLD at. It is
//      never summed, never annualised and never described as revenue — this product contains no
//      invoice entity, no payment entity, no processor client and no webhook, so there is nothing
//      anywhere that could turn a list price into money received.
//   2. **Almost every string on a register row is nullable**, because the row is assembled from a
//      LEFT-ish join in `SubscriptionService.register`: a subscription whose tenant row or plan row
//      could not be resolved still appears, with nulls where the name would be. Defaulting those to
//      `""` here would render an unresolvable subscription as an unnamed one, which is the state
//      that most needs to be visible on a control plane.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors `SubscriptionDtos.PlanResponse`.
 *
 * `features` is DERIVED from the plan's tier through `TierFeatureDefaults` rather than stored on
 * the plan — there is one feature matrix in this product and a second copy would be wrong from the
 * first time a code changed tier. So a plan's feature list is a statement about its TIER, and the
 * catalogue says so rather than implying the plan carries its own entitlements.
 *
 * `maxTerminals` and `maxOrdersPerMonth` are `.nullable()` and are **declared ceilings the platform
 * plane cannot measure**: `pos_terminals` is behind FORCE row-level security in pos_db with no
 * internal count endpoint, and monthly order volume lives in ClickHouse, which this service has no
 * driver for. They are returned so an operator can see what was written down; the limits report
 * marks both NOT_MEASURABLE rather than compliant, and the catalogue must not render them as
 * enforced.
 */
export const apiSubscriptionPlanSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tier: apiTierSchema,
  pricePaisa: z.number(),
  currency: z.string(),
  billingPeriod: apiBillingPeriodSchema,
  trialDays: z.number(),
  maxBranches: z.number(),
  maxUsers: z.number(),
  storageGb: z.number(),
  nlqQuota: z.number(),
  maxTerminals: z.number().nullable(),
  maxOrdersPerMonth: z.number().nullable(),
  active: z.boolean(),
  features: z.record(z.string(), z.boolean()),
  subscriptionCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const apiSubscriptionPlansSchema = z.array(apiSubscriptionPlanSchema);

/**
 * Mirrors `SubscriptionDtos.SubscriptionRegisterRow`.
 *
 * `renewalOverdue` is derived server-side from an elapsed period and means **"an operator should
 * look"** — never "the tenant did not pay". The scheduler deliberately does not roll a renewal
 * period forward, because advancing that date would assert a payment that nothing in this product
 * observes, and the backend's own sweep test pins that behaviour.
 */
export const apiSubscriptionRegisterRowSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string().nullable(),
  tenantBrandName: z.string().nullable(),
  tenantStatus: apiTenantStatusSchema.nullable(),
  tier: apiTierSchema.nullable(),
  planCode: z.string().nullable(),
  planName: z.string().nullable(),
  pricePaisa: z.number(),
  currency: z.string().nullable(),
  billingPeriod: apiBillingPeriodSchema.nullable(),
  status: apiSubscriptionStatusSchema,
  trialEndAt: z.string().nullable(),
  currentPeriodEndAt: z.string().nullable(),
  renewalOverdue: z.boolean(),
  pendingChangeAt: z.string().nullable(),
  pendingPlanCode: z.string().nullable(),
  cancelAt: z.string().nullable(),
});

/**
 * Mirrors `SubscriptionDtos.SubscriptionRegisterResponse`.
 *
 * `tenantsWithoutSubscription` rides in the body and is **required on the screen**. Without it the
 * list reads as "the fleet" while silently omitting every tenant that has no subscription — which,
 * until an operator assigns plans, is all of them.
 *
 * `revenueNote` is the backend's one plain-language statement that billing is not integrated. It is
 * rendered verbatim rather than paraphrased: it exists precisely so a screen can show the absence
 * instead of inventing an MRR tile to fill the space.
 */
export const apiSubscriptionRegisterSchema = z.object({
  subscriptions: z.array(apiSubscriptionRegisterRowSchema),
  totalSubscriptions: z.number(),
  tenantsWithoutSubscription: z.number(),
  revenueNote: z.string().nullable(),
});

export type ApiSubscriptionPlan = z.infer<typeof apiSubscriptionPlanSchema>;
export type ApiSubscriptionRegisterRow = z.infer<typeof apiSubscriptionRegisterRowSchema>;
export type ApiSubscriptionRegister = z.infer<typeof apiSubscriptionRegisterSchema>;
