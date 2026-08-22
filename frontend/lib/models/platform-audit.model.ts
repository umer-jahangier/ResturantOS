// Layer-2 domain models for the cross-tenant audit trail, plus the one piece of reasoning this
// screen cannot be built without: telling an empty log apart from an unread one.

/**
 * Which server-side view of the trail is being read.
 *
 * <p>Three endpoints, not one endpoint with a filter — `/events`, `/logins`,
 * `/authority-changes` — because each applies its action filter INSIDE the per-tenant fan-out.
 * Re-deriving "logins" in the browser from a page of `/events` would filter a PAGE rather than the
 * trail: a reader on page 1 would see whichever logins happened to be in those fifty rows and
 * would have no way to know the rest existed.
 *
 * <p>It lives in the model rather than beside the repository because a screen has to name it —
 * the view switcher IS this union — and Layer 4 may not import a repository.
 */
export type AuditView = "events" | "logins" | "authority-changes";

export interface PlatformAuditEvent {
  /** `audit_events.id`, a BIGINT sequence. Null only if a row arrives without one. */
  id: number | null;
  tenantId: string | null;
  /** Null when the tenant registration is gone and the record is not. A state, not a gap. */
  tenantSlug: string | null;
  tenantBrandName: string | null;
  occurredAt: Date;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  branchId: string | null;
  userId: string | null;
  /** The platform administrator behind an impersonated session, if this was one. */
  impersonatedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: string | null;
}

export interface TenantReadFailure {
  tenantId: string;
  tenantSlug: string | null;
  reason: string | null;
}

export interface PlatformAuditPage {
  events: PlatformAuditEvent[];
  /** A LOWER BOUND whenever `totalCountComplete` is false. */
  totalCount: number;
  totalCountComplete: boolean;
  tenantsInScope: number;
  tenantsRead: number;
  tenantsFailed: TenantReadFailure[];
  from: Date;
  to: Date;
  zone: string;
  page: number;
  size: number;
  /** Null when facets were not requested; empty when there genuinely are none. */
  actionsPresent: string[] | null;
  scanTruncated: boolean;
}

export interface CoverageItem {
  subject: string;
  detail: string;
}

export interface AuditCoverage {
  generatedAt: Date;
  captured: CoverageItem[];
  notCaptured: CoverageItem[];
  retention: string;
  immutability: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The verdict — GA-001, on the one screen where it does the most damage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an audit result actually establishes.
 *
 * <h3>The problem this type exists for</h3>
 *
 * The cross-tenant read is a fan-out: one query per tenant, each executed under that tenant's own
 * row-level-security policy. **A row-level-security policy that excludes everything does not
 * error — it returns zero rows and reports success.** `audit_events` is FORCE RLS on every
 * partition; if nothing on the cross-tenant path sets the tenant GUC the read is filtered to
 * nothing, the HTTP call is a 200, `tenantsRead` equals `tenantsInScope`, and `events` is empty.
 *
 * <p>Which is byte-for-byte identical to a platform where genuinely nothing happened.
 *
 * <p>So `events.length === 0` is not a fact about activity, and a screen that renders it as "no
 * events" has converted a possible scoping fault into a reassuring sentence. That is GA-001 — a
 * failure that reads as an empty result — and this is the surface where it costs the most: an
 * operator running a security review on a log that is not being read would conclude nothing
 * happened.
 *
 * <h3>Why an unfiltered empty is treated as suspicious and a filtered one is not</h3>
 *
 * A filter that matches nothing is ordinary and expected; the reader narrowed the question and got
 * an honest "not that". An UNFILTERED read over the server's default ninety-day window, across
 * every tenant on a platform that has tenants, returning not one row of any kind — including the
 * logins that `AuditEventCatalog.ALWAYS_AUDIT_SOURCES` guarantees for every auth-service event —
 * is not consistent with a working trail. It gets said out loud.
 *
 * <p>Note what this deliberately does NOT do: it does not claim the service is broken. It cannot
 * know that. It reports what was and was not established, and hands the operator the check that
 * settles it.
 */
export type AuditVerdict =
  /** Rows came back. Whatever else is true, the trail is being read. */
  | { kind: "rows" }
  /** There are no tenants at all. Not "this tenant has no history" — a different sentence. */
  | { kind: "noTenants" }
  /** A filter narrowed the question and nothing matched. Ordinary. */
  | { kind: "filteredEmpty" }
  /**
   * Nothing was asked to be excluded, every tenant reported a successful read, and not one row
   * came back. Consistent with a quiet platform AND with a trail nobody is actually reading.
   */
  | { kind: "unverified"; tenantsRead: number }
  /**
   * At least one tenant's log could not be read. The page is a partial view and `totalCount` is a
   * lower bound, whatever else is on screen.
   */
  | { kind: "partial"; failures: TenantReadFailure[] };

/**
 * @param filtered whether the caller narrowed the query with anything at all — tenant, actor,
 *        action, resource type, or a date range other than the server's default. The caller owns
 *        this because the page holds the filter state; the response cannot see it.
 */
export function auditVerdict(page: PlatformAuditPage, filtered: boolean): AuditVerdict {
  // Checked FIRST, and before the row check: a page with rows AND a failed tenant is still a
  // partial view, and "some rows arrived" is not evidence about the tenants that did not answer.
  if (page.tenantsFailed.length > 0) {
    return { kind: "partial", failures: page.tenantsFailed };
  }
  if (page.events.length > 0) return { kind: "rows" };
  if (page.tenantsInScope === 0) return { kind: "noTenants" };
  if (filtered) return { kind: "filteredEmpty" };
  return { kind: "unverified", tenantsRead: page.tenantsRead };
}

/**
 * `USER_LOGIN_SUCCEEDED` → `User login succeeded`.
 *
 * <p>An unknown action renders its own code rather than a blank or a guess. The action set is
 * open — it is whatever the publishing services emit — so a lookup table here would silently
 * degrade to empty cells for every event added after this file was written, on the screen where
 * an unexplained blank is least acceptable.
 */
export function auditActionLabel(action: string): string {
  const words = action.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return action;
  const [first, ...rest] = words;
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(" ");
}

/**
 * The actions that change who can do what — the "permission changes" half of a security review.
 *
 * <p>Mirrors `PlatformAuditTrailService.AUTHORITY_ACTIONS` and is used only to LABEL a row as
 * security-relevant in the merged feed. The authority-changes VIEW is served by its own endpoint
 * and is not filtered client-side from this set: re-deriving a server-side filter in the browser
 * is how two views of one question start disagreeing.
 */
const AUTHORITY_ACTIONS = new Set([
  "ROLE_GRANTED",
  "ROLE_REVOKED",
  "USER_CREATED",
  "USER_UPDATED",
  "USER_DEACTIVATED",
  "USER_REACTIVATED",
  "PASSWORD_CHANGED",
  "PASSWORD_RESET_REQUESTED",
  "ADMIN_PASSWORD_RESET",
  "IMPERSONATION_STARTED",
]);

export function isAuthorityAction(action: string): boolean {
  return AUTHORITY_ACTIONS.has(action);
}

export function isFailedLogin(action: string): boolean {
  return action === "USER_LOGIN_FAILED";
}
