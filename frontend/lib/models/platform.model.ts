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
