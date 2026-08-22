// ─────────────────────────────────────────────────────────────────────────────────────────────
// Layer-2a domain models for the platform tier's user and access surfaces.
//
// Wire strings become `Date`s here and nothing else changes. In particular no null is filled in:
// every one of them in this file is an answer, and the three that decide what a screen may say are
// named on their fields.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The tenant a user belongs to, as much of it as a user screen needs. */
export interface TenantMembership {
  tenantId: string;
  slug: string | null;
  brandName: string | null;
  /**
   * Not decoration. A perfectly healthy-looking user of a SUSPENDED tenant cannot log in, and a
   * screen that shows the account as active without saying so sends an operator hunting for a
   * fault in the account.
   */
  status: string | null;
  tier: string | null;
}

/** One active branch-role assignment. `approvalLimitPaisa` null means no per-assignment limit. */
export interface BranchRoleAssignment {
  branchId: string;
  roleCode: string;
  primary: boolean;
  approvalLimitPaisa: number | null;
}

/**
 * The stations a user works at one branch.
 *
 * `unrestricted` comes from the API and is not inferred from `stationCodes.length` here — a user
 * with no station rows sees every station at their branch, which is the product's default.
 */
export interface StationScope {
  branchId: string;
  stationCodes: string[];
  unrestricted: boolean;
}

/**
 * What this platform records about a person's activity, which is one timestamp.
 *
 * `lastLoginAt` null and `hasEverSignedIn` false are the SAME fact stated twice on purpose: the
 * boolean is what a screen branches on, so that "never signed in" is reached by a named state
 * rather than by a falsy date. `note` is the standing caveat — attempt-level history lives in
 * `audit_db.audit_events`, which the platform plane cannot read — and it is rendered, because an
 * operator reading a single timestamp is owed the reason there is only one.
 */
export interface UserActivity {
  lastLoginAt: Date | null;
  hasEverSignedIn: boolean;
  note: string | null;
}

/**
 * Everything the platform can honestly say about one user.
 *
 * `stationScopes` null and `[]` are different answers: null is "we did not find out" (with
 * `stationScopeNote` saying why), `[]` is "no branch restricts this person to particular
 * stations". Collapsing them tells an operator a user has full station access when nobody knows.
 */
export interface PlatformUserDetail {
  tenant: TenantMembership;
  userId: string;
  email: string;
  fullName: string | null;
  locale: string | null;
  active: boolean;
  mustChangePassword: boolean;
  totpEnabled: boolean;
  createdAt: Date;
  activity: UserActivity;
  branchRoles: BranchRoleAssignment[];
  stationScopes: StationScope[] | null;
  stationScopeNote: string | null;
  /** Computed by the API: `active && branchRoles.isNotEmpty()`, then read against tenant status. */
  loginable: boolean;
  /** Why `loginable` is false, in the API's words. Null when the account can be used. */
  loginableNote: string | null;
}

/**
 * The answer to `unlock` and `revoke-sessions`.
 *
 * `lockedUntil` null means NOT LOCKED — a state, not a blank date. `sessionsRevoked: 0` means the
 * user held no live refresh session; it is a measured zero and the screen reports it as one rather
 * than announcing a success it cannot see.
 */
export interface UserSecurityState {
  userId: string;
  email: string;
  active: boolean;
  lockedUntil: Date | null;
  failedLoginCount: number;
  sessionsRevoked: number;
}

/**
 * The temporary password, which exists in exactly one place: this response.
 *
 * It is not in the audit row, not in a log, not recoverable from any endpoint, and there is no
 * email path in this product to carry it. The operator IS the delivery channel, and the screen has
 * to say so beside it.
 */
export interface AdminPasswordReset {
  userId: string;
  email: string;
  tempPassword: string | null;
  mustChangePassword: boolean | null;
}

/** The five platform-tier actions on one person. Every one takes a mandatory reason. */
export type UserLifecycleAction =
  | "deactivate"
  | "reactivate"
  | "unlock"
  | "revoke-sessions"
  | "reset-password";

// ─── RBAC, read-only ─────────────────────────────────────────────────────────────────────────

export interface PermissionEntry {
  code: string;
  module: string;
  description: string | null;
}

export interface PermissionModule {
  module: string;
  permissions: PermissionEntry[];
}

export interface PermissionMatrixRow {
  roleCode: string;
  roleName: string | null;
  /** A platform-defined role (`tenant_id IS NULL`): global, and editable by nobody at any tier. */
  system: boolean;
  grantedPermissionCodes: string[];
  /** Distinct holders in the named tenant. 0 in the GLOBAL view — holders are a per-tenant fact. */
  assignedUserCount: number;
}

export interface PermissionMatrix {
  tenantId: string | null;
  /** `GLOBAL` when no tenant was named, `TENANT` otherwise. "9 roles" means different things. */
  scope: string;
  permissionCodes: string[];
  rows: PermissionMatrixRow[];
  /**
   * Why the platform tier cannot edit any of this — a deliberate posture, not a failure. The
   * screen renders the sentence the API sends rather than a local paraphrase, so that a change of
   * policy on the server changes what the console says without a frontend release.
   */
  readOnlyReason: string | null;
}

/**
 * `pos` → `Point of sale`. An unknown module renders its own humanised code, never a blank
 * heading: the permission vocabulary is seeded by Liquibase and grows, and a screen that fell to
 * `""` on the next changeset would silently lose a whole group of rows.
 */
const MODULE_LABELS: Record<string, string> = {
  pos: "Point of sale",
  crm: "Customers & promotions",
  finance: "Finance",
  hr: "People & payroll",
  inventory: "Inventory",
  nlq: "Ask a question",
  rbac: "Roles & access",
  reporting: "Reporting",
  vendor: "Purchasing",
};

export function permissionModuleLabel(module: string): string {
  const known = MODULE_LABELS[module.toLowerCase()];
  if (known) return known;
  const words = module.replace(/[_.-]+/g, " ").trim();
  return words.length === 0 ? module : words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * `pos.order.void.any` → `order · void · any`. The module prefix is dropped because the group
 * heading above the row already carries it, and repeating it 79 times is 79 lines of noise in the
 * one column a reader scans.
 *
 * <p>The full code is still rendered beside it in mono — it is what a support conversation and a
 * `403` both name, and abbreviating it out of existence would make this screen unable to answer
 * the question it is most often opened for.
 */
export function permissionLeafLabel(code: string): string {
  const parts = code.split(".");
  return parts.length <= 1 ? code : parts.slice(1).join(" · ");
}

/** `TENANT_ADMIN` → `Tenant admin`, for a role the API returned without a display name. */
export function roleCodeLabel(code: string): string {
  const words = code.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) return code;
  const [first, ...rest] = words;
  return [first!.charAt(0).toUpperCase() + first!.slice(1), ...rest].join(" ");
}
