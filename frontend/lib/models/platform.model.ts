// Layer-2 domain models for the SuperAdmin control plane (19c).
//
// camelCase, and the ONLY platform shapes hooks and components are allowed to see. Raw API field
// names never leak past the repository/adapter boundary.

/** Mirrors `TenantEntity.TierType`. CUSTOM exists in the backend enum and is not synthetic. */
export type TenantTier = "STARTER" | "GROWTH" | "ENTERPRISE" | "CUSTOM";

/** Mirrors `TenantEntity.TenantStatus`. */
export type TenantStatus =
  | "PROVISIONING"
  | "ACTIVE"
  | "SUSPENDED"
  | "CANCELLED"
  | "PURGED"
  | "PROVISIONING_FAILED";

/**
 * A tenant as the SuperAdmin sees it.
 *
 * `maxBranches`, `maxUsers`, `storageGb` and `nlqQuota` have been returned by
 * `GET /api/v1/platform/tenants` since Phase 3 and were read by nothing — grepping the frontend
 * for all four returned zero matches (GA-083). They are the entitlement half of every usage
 * question and are surfaced here.
 */
export interface PlatformTenant {
  id: string;
  slug: string;
  brandName: string;
  status: TenantStatus;
  tier: TenantTier;
  createdAt: Date;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  maxBranches: number | null;
  maxUsers: number | null;
  storageGb: number | null;
  nlqQuota: number | null;
  billingRef: string | null;
  trialEndsAt: Date | null;
  renewsAt: Date | null;
}

/**
 * Where a tenant's current value for a feature code came from.
 *
 * This is the distinction `tenant_features.is_override` carries and that the API did not expose
 * until 19c. `enabled` alone cannot answer "will this survive the next tier change?", which is the
 * question a SuperAdmin is actually asking when they look at this screen.
 */
export type FeatureSource =
  /** No override. The tier decides, and a tier change will move it. */
  | "TIER_DEFAULT"
  /** An operator set it; it happens to agree with the tier. Pinned anyway. */
  | "OVERRIDE_MATCHES_TIER"
  /** An operator switched ON something the tier does not include. Survives a downgrade. */
  | "OVERRIDE_GRANT"
  /** An operator switched OFF something the tier does include. Survives an upgrade. */
  | "OVERRIDE_REVOKE"
  /** The tier matrix knows the code; this tenant has no row. Reads as off. */
  | "UNSEEDED";

export interface FeatureState {
  code: string;
  /** What the gateway enforces right now. */
  enabled: boolean;
  /** What the tenant's CURRENT tier would give with the override removed. */
  tierDefault: boolean;
  isOverride: boolean;
  source: FeatureSource;
}

export interface TenantFeatures {
  tier: TenantTier;
  states: FeatureState[];
}

/** True for the three sources that represent a deliberate operator decision. */
export function isOverridden(state: FeatureState): boolean {
  return state.isOverride;
}

/**
 * A one-line explanation of what happens to this code on the next tier change.
 *
 * Deliberately phrased in terms of consequence rather than mechanism — "Survives a tier change" is
 * what the operator needs to know; "is_override = true" is not.
 */
export function featureSourceLabel(state: FeatureState): string {
  switch (state.source) {
    case "TIER_DEFAULT":
      return state.enabled ? "Included in tier" : "Not in tier";
    case "OVERRIDE_GRANT":
      return "Granted above tier";
    case "OVERRIDE_REVOKE":
      return "Revoked despite tier";
    case "OVERRIDE_MATCHES_TIER":
      return "Pinned to current value";
    case "UNSEEDED":
      return "Never provisioned";
  }
}

/**
 * One entitlement dimension.
 *
 * The three states below are NOT interchangeable and the UI must not collapse them:
 *
 * - `metered && used !== null` — really counted. `used: 0` means zero happened.
 * - `!metered` — nothing records this. Render the words, never a number.
 * - `unavailable` — a real meter that could not be read. A failure, not a comforting zero.
 */
export interface UsageMeter {
  resource: string;
  unit: string;
  used: number | null;
  /** The tier ceiling. `-1` means uncapped. Never `Long.MAX_VALUE` (GA-052). */
  limit: number;
  metered: boolean;
  unavailable: boolean;
  /** Plain-language provenance. An operator looking at "Not metered" is owed the reason. */
  source: string;
}

export interface TenantUsage {
  tenantId: string;
  tier: TenantTier;
  meters: UsageMeter[];
  /** False when NOT ONE dimension is recorded — the console says so once, not four times. */
  anyMetered: boolean;
}

/**
 * `used / limit` as a percentage, or null when there is no honest number to show.
 *
 * Returns null — never 0 — for an unmetered or unreadable meter. A 0% bar is a claim, and the
 * whole point of this screen is to make no claim it cannot support.
 */
export function meterPercent(meter: UsageMeter): number | null {
  if (!meter.metered || meter.unavailable || meter.used === null) return null;
  if (meter.limit <= 0) return null;
  return (meter.used / meter.limit) * 100;
}

/** UI-SPEC §7.5: `--warning` at ≥ 80%, `--danger` at ≥ 100%. */
export type MeterSeverity = "ok" | "warning" | "danger" | "unknown";

export function meterSeverity(meter: UsageMeter): MeterSeverity {
  const pct = meterPercent(meter);
  if (pct === null) return "unknown";
  if (pct >= 100) return "danger";
  if (pct >= 80) return "warning";
  return "ok";
}

/** Human label for a backend resource key. Unknown keys fall back to the raw key, never to "". */
export function meterLabel(resource: string): string {
  const labels: Record<string, string> = {
    branches: "Branches",
    users: "Users",
    storage_gb: "Storage",
    nlq_queries: "NLQ queries",
  };
  return labels[resource] ?? resource;
}

// --- Impersonation audit ---

/**
 * Whether the session's token can still be used.
 *
 * Derived on the SERVER from `expires_at`, never from `ended_at`. That column exists in the schema
 * and has no writer anywhere in the product, so a status computed from it would read "still
 * running" for every impersonation ever performed. The client does not recompute this — a second
 * implementation of the rule is a second chance to get it wrong.
 */
export type ImpersonationStatus = "ACTIVE" | "EXPIRED" | "UNKNOWN";

/**
 * One SuperAdmin impersonation session.
 *
 * Note what is NOT here: the issued token (never persisted) and `endedAt` (no writer, always
 * null). `targetUserId` carries no display name because tenant users live in a database the
 * platform plane cannot reach — the UI must render the id and say what it is, not invent a name.
 */
export interface ImpersonationRecord {
  id: string;
  tenantId: string;
  /** Null when the tenant registration is gone but the immutable record is not. */
  tenantSlug: string | null;
  tenantBrandName: string | null;
  adminUserId: string;
  /** Null when that platform account has since been deleted. The id still names it. */
  adminEmail: string | null;
  targetUserId: string;
  startedAt: Date;
  /** Null is a real state — `expires_at` is nullable, and that is what makes status UNKNOWN. */
  expiresAt: Date | null;
  status: ImpersonationStatus;
  reason: string | null;
}

export interface ImpersonationPage {
  records: ImpersonationRecord[];
  /** Rows matching the filter, not rows on this page. */
  totalCount: number;
  /** Null on the last page — the only end-of-list signal the API gives. */
  nextPage: number | null;
}

/** What the operator should read, per status. Never invents certainty the backend did not have. */
export function impersonationStatusLabel(status: ImpersonationStatus): string {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "EXPIRED":
      return "Expired";
    case "UNKNOWN":
      return "Unknown expiry";
  }
}

// --- Request bodies ---

export interface CreateTenantBody {
  brandName: string;
  adminEmail: string;
  tier: TenantTier;
}

/**
 * The result of provisioning.
 *
 * `tempPassword` is one-time credential material and this response is the only place it will ever
 * appear — notification-service has no source files, so no email is sent (GA-050). The screen must
 * therefore display it once and say plainly that it will not be shown again.
 */
export interface ProvisionResult {
  tenantId: string;
  slug: string;
  adminEmail: string;
  tempPassword: string | null;
  loginUrl: string;
}

export interface UpdateTenantBody {
  brandName?: string;
  billingRef?: string;
  trialEndsAt?: string;
  renewsAt?: string;
}

export interface ChangeTierBody {
  tier: TenantTier;
  /** Apply even when the tenant is over the target's limits. Absent reads as false. */
  force?: boolean;
}

export interface TierChangeResult {
  tenantId: string;
  previousTier: TenantTier;
  tier: TenantTier;
  changedFeatureCodes: string[];
  maxBranches: number;
  maxUsers: number;
  storageGb: number;
  nlqQuota: number;
  forcedOverLimits: boolean;
}

// --- A tenant's users (platform-tier read) ---

/**
 * One user of one tenant, as the platform console reads them.
 *
 * `lastLoginAt` null is the state "has never signed in" — a provisioned account nobody has used,
 * which is the visible shape of a tenant that cannot get in. It is never rendered as a blank date.
 */
export interface TenantUserRow {
  tenantId: string;
  tenantSlug: string | null;
  tenantBrandName: string | null;
  userId: string;
  email: string;
  fullName: string | null;
  locale: string | null;
  active: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface UnreachableTenant {
  tenantId: string;
  tenantSlug: string | null;
  detail: string | null;
}

/**
 * How a user list was actually obtained.
 *
 * `totalCount` null means the total is genuinely unknown — a tenant did not answer, or the
 * fan-out cap cut the scan short. `totalCountNote` says which. A screen that filled that null with
 * `users.length` would print a confident number for an incomplete list, which is the one thing
 * this block exists to prevent.
 */
export interface DirectoryScan {
  tenantsMatched: number;
  tenantsScanned: number;
  unreachable: UnreachableTenant[];
  truncated: boolean;
  totalCount: number | null;
  totalCountNote: string | null;
}

export interface TenantUserPage {
  users: TenantUserRow[];
  scan: DirectoryScan;
}

/**
 * What an operator can act on about this account, in one word, without inventing a state.
 *
 * There is deliberately no "locked" reading: the list row does not carry `lockedUntil` and
 * inferring one would be a fabricated column. Lock state lives on the user detail endpoint.
 */
export type TenantUserStanding = "ACTIVE" | "DEACTIVATED" | "NEVER_SIGNED_IN" | "MUST_CHANGE";

export function tenantUserStanding(user: TenantUserRow): TenantUserStanding {
  if (!user.active) return "DEACTIVATED";
  if (user.mustChangePassword) return "MUST_CHANGE";
  if (user.lastLoginAt === null) return "NEVER_SIGNED_IN";
  return "ACTIVE";
}

export function tenantUserStandingLabel(standing: TenantUserStanding): string {
  switch (standing) {
    case "ACTIVE":
      return "Active";
    case "DEACTIVATED":
      return "Deactivated";
    case "NEVER_SIGNED_IN":
      return "Never signed in";
    case "MUST_CHANGE":
      return "Password change due";
  }
}

// --- Subscription, plan and limits ---

export interface PlanSummary {
  id: string;
  code: string;
  name: string;
  tier: TenantTier;
  /** BIGINT paisa. The LIST price of the plan — not an invoice, and not money received. */
  pricePaisa: number;
  currency: string;
  billingPeriod: string;
}

export interface SubscriptionDetail {
  id: string;
  tenantId: string;
  status: string;
  plan: PlanSummary | null;
  trialStartAt: Date | null;
  trialEndAt: Date | null;
  trialDaysRemaining: number | null;
  currentPeriodStartAt: Date | null;
  currentPeriodEndAt: Date | null;
  /** The period end has passed and the subscription is still live. A worklist item, not a fault. */
  renewalOverdue: boolean;
  pendingPlan: PlanSummary | null;
  pendingChangeAt: Date | null;
  pendingChangeReason: string | null;
  cancelAt: Date | null;
  cancelReason: string | null;
  cancelledAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
}

/**
 * A tenant's subscription, or the stated absence of one.
 *
 * `subscription` null is a real answer: the registry is new and nothing was backfilled. The tenant
 * still has a tier and that tier is what governs entitlement, so the screen says which — it does
 * not render an empty subscription card that reads as a loading failure.
 */
export interface TenantSubscription {
  tenantId: string;
  tier: TenantTier;
  subscription: SubscriptionDetail | null;
  /** False when a tier change was applied directly while a subscription named a different tier. */
  planTierMatchesTenantTier: boolean | null;
  note: string | null;
}

/**
 * Whether one ceiling is being respected — and whether we can tell at all.
 *
 * `NOT_MEASURABLE` must never render as a tick and `UNREADABLE` must never render as "fine": the
 * first says nobody counts this, the second says a real meter did not answer on this request.
 */
export type LimitState = "WITHIN" | "EXCEEDED" | "NOT_MEASURABLE" | "UNREADABLE";

export interface PlanLimitCheck {
  limit: string;
  unit: string;
  /** Null unless the state is WITHIN or EXCEEDED. Never 0 as a stand-in for "unknown". */
  used: number | null;
  /** Null when the plan declares no limit — distinct from a ceiling of 0, "none allowed". */
  ceiling: number | null;
  state: LimitState;
  /** Plain-language provenance. An operator looking at "not measurable" is owed the reason. */
  source: string;
}

export interface SubscriptionLimitReport {
  tenantId: string;
  planCode: string | null;
  tier: TenantTier;
  checks: PlanLimitCheck[];
  /** False when NOT ONE ceiling could be checked — one honest banner beats six identical rows. */
  anyMeasurable: boolean;
  /** Ceilings measurably breached. Zero does NOT mean the tenant fits; see `anyMeasurable`. */
  exceeded: number;
}

/** Human label for a backend limit key. Unknown keys fall back to the raw key, never to "". */
export function limitLabel(limit: string): string {
  const labels: Record<string, string> = {
    branches: "Branches",
    users: "Users",
    storage_gb: "Storage",
    nlq_queries: "NLQ queries",
    terminals: "POS terminals",
    orders_per_month: "Orders per month",
  };
  return labels[limit] ?? limit;
}

export function limitStateLabel(state: LimitState): string {
  switch (state) {
    case "WITHIN":
      return "Within plan";
    case "EXCEEDED":
      return "Over plan";
    case "NOT_MEASURABLE":
      return "Not measured";
    case "UNREADABLE":
      return "Could not read";
  }
}

// --- Subscription history ---

/** One immutable transition of a tenant's commercial arrangement. */
export interface SubscriptionHistoryEntry {
  id: string;
  tenantId: string;
  subscriptionId: string | null;
  changeType: string;
  fromPlanCode: string | null;
  toPlanCode: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  fromTier: string | null;
  toTier: string | null;
  fromPricePaisa: number | null;
  toPricePaisa: number | null;
  effectiveAt: Date | null;
  recordedAt: Date;
  /** `PLATFORM_USER` | `SYSTEM` | … — who or what applied it. */
  actorKind: string;
  actorPlatformUserId: string | null;
  actorEmail: string | null;
  reason: string | null;
  forcedOverLimits: boolean;
  detail: string | null;
}

export interface SubscriptionHistoryPage {
  entries: SubscriptionHistoryEntry[];
  totalCount: number;
  nextPage: number | null;
}

// --- Operator audit ---

/**
 * One thing a platform operator did, as the console reads it back.
 *
 * This is the trail that makes every lifecycle action on this console attributable. The reason the
 * API demands on each of those calls is the `reason` field here — which is why an empty one has to
 * be visible as an absence rather than hidden as whitespace.
 */
export interface OperatorAuditRecord {
  id: string;
  occurredAt: Date;
  platformUserId: string | null;
  platformUserEmail: string | null;
  action: string | null;
  outcome: string | null;
  tenantId: string | null;
  tenantSlug: string | null;
  targetUserId: string | null;
  reason: string | null;
  detail: string | null;
}

export interface OperatorAuditPage {
  records: OperatorAuditRecord[];
  totalCount: number;
  nextPage: number | null;
}

/** `TENANT_SUSPENDED` → `Tenant suspended`. Unknown actions render their own code, never "". */
export function operatorActionLabel(action: string | null): string {
  if (!action) return "Unrecorded action";
  const words = action.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return action;
  const [first, ...rest] = words;
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(" ");
}

// --- Request bodies for the lifecycle half ---

/**
 * The admin address the retried provisioning saga creates the tenant's first account from.
 *
 * Required by the API, and required for a reason: the pre-13-10 retry passed the literal string
 * `"(retry)"`, so a retried tenant was provisioned with an unusable administrator.
 */
export interface RetryProvisioningBody {
  adminEmail: string;
}

// --- Plans, the register, and the lifecycle bodies ---

/** Mirrors `SubscriptionPlanEntity.BillingPeriod`. */
export type BillingPeriod = "MONTHLY" | "QUARTERLY" | "ANNUAL";

/** Mirrors `TenantSubscriptionEntity.SubscriptionStatus`. */
export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "TRIAL_ENDED" | "CANCELLED" | "ENDED";

/**
 * One plan in the catalogue.
 *
 * <h3>`pricePaisa` is a LIST PRICE and nothing else</h3>
 *
 * BIGINT paisa, rendered only through `MoneyDisplay`, and never summed into a total. This product
 * has no invoice, no payment, no processor integration and no ledger of platform-side money, so
 * there is no arithmetic that turns a list price into revenue — and a control plane that performed
 * that arithmetic anyway would be presenting a fabrication in the product's own confident voice, on
 * the screen where commercial decisions are made.
 *
 * <h3>Which ceilings can actually be enforced</h3>
 *
 * `maxBranches`, `maxUsers`, `storageGb` and `nlqQuota` are measured against real usage by the
 * limits report. `maxTerminals` and `maxOrdersPerMonth` are DECLARED and unmeasurable from the
 * platform plane — terminals live behind FORCE row-level security in pos_db, monthly orders live in
 * ClickHouse — so the catalogue shows them as what was written down rather than as a ceiling
 * anything is checking.
 */
export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  tier: TenantTier;
  pricePaisa: number;
  currency: string;
  billingPeriod: BillingPeriod;
  /** 0 means the plan offers no trial. A trial cannot be started on such a plan at all. */
  trialDays: number;
  maxBranches: number;
  maxUsers: number;
  storageGb: number;
  nlqQuota: number;
  /** Declared, never measured. See the docblock. */
  maxTerminals: number | null;
  /** Declared, never measured. See the docblock. */
  maxOrdersPerMonth: number | null;
  /** Archived plans stay readable so historical prices survive; they cannot be newly assigned. */
  active: boolean;
  /** Feature codes this plan's TIER grants. Derived from the one feature matrix, not stored here. */
  features: Record<string, boolean>;
  /** How many subscriptions currently name this plan — what makes archiving a considered act. */
  subscriptionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/** One row of the cross-tenant subscription register. */
export interface SubscriptionRegisterRow {
  tenantId: string;
  /** Null when the tenant row could not be resolved. An unnamed subscription is a real state. */
  tenantSlug: string | null;
  tenantBrandName: string | null;
  tenantStatus: TenantStatus | null;
  tier: TenantTier | null;
  planCode: string | null;
  planName: string | null;
  /** BIGINT paisa. Zero when the plan could not be resolved — read it beside `planCode`. */
  pricePaisa: number;
  currency: string | null;
  billingPeriod: BillingPeriod | null;
  status: SubscriptionStatus;
  trialEndAt: Date | null;
  currentPeriodEndAt: Date | null;
  /**
   * The period end has passed and the subscription is still live.
   *
   * **This is a worklist flag, not a payment failure.** Nothing in this product observes a payment,
   * and the scheduler deliberately never rolls a period forward — advancing that date would assert
   * one. It means "an operator should look", and every surface that renders it says so in words.
   */
  renewalOverdue: boolean;
  pendingChangeAt: Date | null;
  pendingPlanCode: string | null;
  cancelAt: Date | null;
}

/**
 * The register, with the one figure that makes it readable.
 *
 * `tenantsWithoutSubscription` is the coverage number. Without it the list is dangerously easy to
 * misread as "the fleet": nothing was backfilled when the registry shipped, so on the day it landed
 * every tenant was missing from it. Rendering the rows alone would imply the missing tenants do not
 * exist.
 */
export interface SubscriptionRegister {
  rows: SubscriptionRegisterRow[];
  totalSubscriptions: number;
  tenantsWithoutSubscription: number;
  /** The backend's plain-language statement that billing is not integrated. Rendered verbatim. */
  revenueNote: string | null;
}

/**
 * Assign a plan, or move a subscription onto a different one.
 *
 * @property effectiveAt omit to apply now; a FUTURE ISO instant schedules it and nothing moves
 *   until the scheduler applies it. A PAST instant is refused rather than treated as "now" —
 *   backdating would put an effective date in the trail that the entitlement never had.
 * @property startTrial only takes effect when the plan declares `trialDays > 0` **and** the
 *   subscription has never had a trial. There is no extend-trial operation in this product.
 * @property force apply the plan even when the tenant measurably exceeds its ceilings. The refusal
 *   is the default and is the useful behaviour.
 * @property reason recorded on the append-only history row. Mandatory — the trail exists to answer
 *   "why", and the API refuses a blank one.
 */
export interface AssignPlanBody {
  planCode: string;
  effectiveAt?: string;
  startTrial?: boolean;
  force?: boolean;
  reason: string;
}

/**
 * Cancel the SUBSCRIPTION.
 *
 * This does not cancel the TENANT: no status change, no feature revocation, no ceiling change.
 * `POST /tenants/{id}/cancel` is the separate operation that takes a restaurant out of service.
 *
 * @property effectiveAt omit to cancel immediately; a future instant schedules it and the
 *   subscription stays live until then — the ordinary "cancel at period end" case.
 */
export interface CancelSubscriptionBody {
  effectiveAt?: string;
  reason: string;
}

/**
 * Record a renewal an operator KNOWS happened.
 *
 * The new period end is required and is not inferred, because this product cannot observe a
 * payment: an operator asserting a renewal must state what they are asserting. Either give
 * `currentPeriodEndAt` outright, or set `deriveFromBillingPeriod` to take it from the plan's period
 * — which makes the derivation explicit rather than implicit.
 */
export interface RenewSubscriptionBody {
  currentPeriodEndAt?: string;
  deriveFromBillingPeriod?: boolean;
  reason: string;
}

/** `MONTHLY` → `Monthly`. The adjective, for a chip; `perPeriodLabel` gives the prepositional form. */
export function billingPeriodLabel(period: BillingPeriod | null): string {
  switch (period) {
    case "MONTHLY":
      return "Monthly";
    case "QUARTERLY":
      return "Quarterly";
    case "ANNUAL":
      return "Annual";
    default:
      return "No billing period";
  }
}

/** `MONTHLY` → `per month`. Rendered beside a list price so the price has a unit. */
export function perPeriodLabel(period: BillingPeriod | null): string {
  switch (period) {
    case "MONTHLY":
      return "per month";
    case "QUARTERLY":
      return "per quarter";
    case "ANNUAL":
      return "per year";
    default:
      return "per period";
  }
}

export function subscriptionStatusLabel(status: SubscriptionStatus): string {
  switch (status) {
    case "TRIALING":
      return "On trial";
    case "ACTIVE":
      return "Active";
    case "TRIAL_ENDED":
      return "Trial ended";
    case "CANCELLED":
      return "Cancelled";
    case "ENDED":
      return "Superseded";
  }
}

/**
 * What a subscription status MEANS for the restaurant — which, in every case, is nothing.
 *
 * A subscription is a commercial record laid beside an entitlement that already existed. The
 * gateway enforces the tenant's TIER; none of these five states gates a feature, lowers a ceiling
 * or stops a till. Saying so on every surface is what stops an operator reading "Trial ended" as
 * "this restaurant has been cut off" and acting on it.
 */
export function subscriptionStatusConsequence(status: SubscriptionStatus): string {
  switch (status) {
    case "TRIALING":
      return "Inside a trial window. Entitlement comes from the tenant's tier and is unaffected.";
    case "ACTIVE":
      return "A live arrangement an operator asserted. Nothing about it is observed automatically.";
    case "TRIAL_ENDED":
      return "The trial window elapsed and nobody has decided yet. No entitlement changed — this is a worklist item, not a cut-off.";
    case "CANCELLED":
      return "The subscription ended. The tenant is untouched: it keeps its status, its data and its entitlements.";
    case "ENDED":
      return "Superseded by a newer subscription for this tenant. Kept so the earlier agreement stays readable.";
  }
}
