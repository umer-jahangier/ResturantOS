import type { TenantStatus, TenantTier } from "./platform.model";

// Layer-2 domain models for the platform OVERVIEW. camelCase, `Date` rather than ISO strings, and
// every absence preserved as `null` — nothing here is defaulted on the way through.

/**
 * One platform figure, in exactly one of three states.
 *
 * <p>Kept as a discriminated-by-flags record rather than flattened to `number | null`, because the
 * two nulls are different answers and a screen must be able to tell them apart:
 *
 * <ul>
 *   <li>`measured` — really computed. `value: 0` means zero and means it.</li>
 *   <li>`notMeasured` — nothing in this product computes this. `source` says why, and the screen
 *       renders that sentence instead of a figure.</li>
 *   <li>`unreadable` — a real figure whose source did not answer on this request. Neither zero
 *       nor reassuring.</li>
 * </ul>
 */
export type PlatformFigureState = "measured" | "notMeasured" | "unreadable";

export interface PlatformFigure {
  /** The backend's stable snake_case key, e.g. `tenants_provisioning_failed`. */
  name: string;
  /** Non-null only when `state === "measured"`. */
  value: number | null;
  state: PlatformFigureState;
  /** Plain-language provenance. An operator owed a number is owed where it came from. */
  source: string;
}

/** One cell of the status × tier cross-tab. Only occurring combinations exist. */
export interface StatusTierCell {
  status: string;
  tier: string;
  count: number;
}

export interface TenantPopulation {
  total: number;
  /** Densified server-side against the compiled enum, so every declared status is present. */
  byStatus: Record<string, number>;
  byTier: Record<string, number>;
  byStatusAndTier: StatusTierCell[];
  active: number;
  inactive: number;
}

export interface AnalyticsOverview {
  generatedAt: Date;
  windowFrom: Date;
  windowTo: Date;
  tenants: TenantPopulation;
  lifecycle: PlatformFigure[];
  entitlement: PlatformFigure[];
  operations: PlatformFigure[];
  /**
   * Metrics a control plane would normally show and this product genuinely cannot — MRR, ARR,
   * ARPU, churn value, failed payments, cross-tenant sales. Every one arrives as `notMeasured`
   * with the reason attached. They are surfaced on the screen as a named absence rather than
   * omitted, so the next author does not read the gap as an oversight and "fix" it with a
   * plausible number.
   */
  unavailableMetrics: PlatformFigure[];
}

// ─────────────────────────────────────────────────────────────────────────────
// System health
// ─────────────────────────────────────────────────────────────────────────────

/** `UNREACHABLE` (nothing answered) is never the same as `DOWN` (it answered, unhappily). */
export type HealthState = "UP" | "DOWN" | "UNREACHABLE" | "UNKNOWN";

export interface InstanceHealth {
  instanceId: string;
  /** The actuator URI actually probed, so an operator can repeat the check by hand. */
  uri: string;
  state: HealthState;
  detail: string | null;
  responseTimeMs: number | null;
}

export interface ServiceHealth {
  serviceId: string;
  state: HealthState;
  instancesRegistered: number;
  instancesUp: number;
  instancesDown: number;
  instancesUnreachable: number;
  instances: InstanceHealth[];
  detail: string | null;
}

export interface ComponentHealth {
  name: string;
  /** DATABASE, CACHE, BROKER, REGISTRY. */
  kind: string;
  state: HealthState;
  detail: string | null;
}

export interface MigrationState {
  name: string;
  state: HealthState;
  /** How the state was established — load-bearing where a precondition is inferred, not observed. */
  basis: string;
  detail: string | null;
}

export interface UncollectedMetric {
  name: string;
  reason: string;
}

export interface SystemHealth {
  checkedAt: Date;
  /** Never green out of ignorance: anything indeterminate makes this `UNKNOWN`. */
  overall: HealthState;
  registry: ComponentHealth;
  services: ServiceHealth[];
  infrastructure: ComponentHealth[];
  migrations: MigrationState[];
  notCollected: UncollectedMetric[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Subscriptions
// ─────────────────────────────────────────────────────────────────────────────

export type SubscriptionStatus = "TRIALING" | "ACTIVE" | "TRIAL_ENDED" | "CANCELLED" | "ENDED";
export type BillingPeriod = "MONTHLY" | "QUARTERLY" | "ANNUAL";

export interface SubscriptionRegisterRow {
  tenantId: string;
  tenantSlug: string;
  tenantBrandName: string;
  tenantStatus: TenantStatus;
  tier: TenantTier;
  planCode: string;
  planName: string;
  /** BIGINT paisa. What the plan is SOLD at — never money received, which this product never sees. */
  pricePaisa: number;
  currency: string;
  billingPeriod: BillingPeriod;
  status: SubscriptionStatus;
  trialEndAt: Date | null;
  currentPeriodEndAt: Date | null;
  /** Derived by the backend: the period has elapsed and the subscription is still live. */
  renewalOverdue: boolean;
  pendingChangeAt: Date | null;
  pendingPlanCode: string | null;
  cancelAt: Date | null;
}

export interface SubscriptionRegister {
  rows: SubscriptionRegisterRow[];
  totalSubscriptions: number;
  /** The coverage number. Without it the register reads as the whole fleet, and it is not. */
  tenantsWithoutSubscription: number;
  /** The absence of billing, stated by the backend in words, for the screen to render verbatim. */
  revenueNote: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant user directory
// ─────────────────────────────────────────────────────────────────────────────

export interface UnreachableTenant {
  tenantId: string;
  tenantSlug: string;
  detail: string | null;
}

/**
 * How a cross-tenant scan was actually obtained.
 *
 * `total` is `null` whenever the answer is not knowable — any unreachable tenant, or a truncated
 * fan-out. `totalNote` then carries the reason. A screen must render the absence and name the
 * tenants in `unreachable`; printing `tenantsScanned` alone would look complete.
 */
export interface DirectoryScan {
  tenantsMatched: number;
  tenantsScanned: number;
  unreachable: UnreachableTenant[];
  truncated: boolean;
  total: number | null;
  totalNote: string | null;
}

/** True only when every tenant in scope answered and nothing was cut short. */
export function isScanComplete(scan: DirectoryScan): boolean {
  return scan.total !== null && !scan.truncated && scan.unreachable.length === 0;
}

/**
 * The two headcounts the overview shows, each with its OWN scan.
 *
 * <p>They are two independent fan-outs — one unfiltered, one `status=ACTIVE` — because there is no
 * cross-tenant user query to ask both of at once. Keeping the scans apart rather than merging them
 * is deliberate: a tenant can be unreachable on one request and answer on the other, and a single
 * merged "complete" flag would then be wrong in one direction without saying which.
 */
export interface DirectorySummary {
  all: DirectoryScan;
  active: DirectoryScan;
}

/**
 * Inactive users, or `null` when it is not knowable.
 *
 * <p>A subtraction is only as sound as both of its operands. If either scan withheld its total —
 * or covered a different set of tenants from the other — the difference is not "how many accounts
 * are switched off", it is noise, and it would be the most confidently-rendered wrong number on
 * the page. `null` here is the honest answer and the tile states why.
 */
export function inactiveUsers(summary: DirectorySummary): number | null {
  const { all, active } = summary;
  if (all.total === null || active.total === null) return null;
  if (!isScanComplete(all) || !isScanComplete(active)) return null;
  if (all.tenantsScanned !== active.tenantsScanned) return null;
  return Math.max(0, all.total - active.total);
}
