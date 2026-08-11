/**
 * Domain models for tenant user administration.
 *
 * <p>Kept in `lib/models/` rather than exported from the repository because the FE-08 layer
 * boundary (eslint `no-restricted-imports`) forbids `components/**` and `app/**` from importing
 * `@/lib/repositories/**` at all — a type-only import is still an import as far as the rule, and
 * the bundler, are concerned.
 */

/** One row of the user list. */
export interface TenantUser {
  id: string;
  email: string;
  /** Null for an account created without one — rendered as the email rather than as a blank. */
  fullName: string | null;
  locale: string | null;
  active: boolean;
  /** True between an admin reset (or creation) and the user redeeming the temporary password. */
  mustChangePassword: boolean;
  totpEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

/**
 * One active branch-role row.
 *
 * `approvalLimitPaisa` is BIGINT paisa and is the attribute the policy engine reads: `vendor.rego`,
 * `finance.rego` and `pos.rego` each compare a request's amount against it, and `null` denies every
 * amount-gated action at any amount. It is **writable** — `POST /api/v1/users/{id}/branch-roles`
 * has accepted it since the column existed, and `BranchRoleAdminService.assign` writes it
 * unconditionally from the request.
 *
 * This comment used to say "display only". That sentence is the reason nobody wired it, the column
 * stayed NULL on every row, and no one in the product could approve a purchase order.
 */
export interface BranchRoleAssignment {
  branchId: string;
  roleCode: string;
  primary: boolean;
  approvalLimitPaisa: number | null;
}

export interface TenantUserDetail {
  user: TenantUser;
  /**
   * Empty means the account holds no role on any branch and therefore CANNOT LOG IN. The list
   * screen shows that as a state in its own right; an empty cell would read as a rendering gap.
   */
  assignments: BranchRoleAssignment[];
}

/** A role the CALLER may assign — `GET /api/v1/roles` is already ceiling-filtered (13-07). */
export interface AssignableRole {
  code: string;
  name: string;
  system: boolean;
  permissions: string[];
}

/**
 * The catalogue plus the ceiling's own report on itself.
 *
 * <p>`withheldCount` comes from the `ROLES_WITHHELD_ABOVE_CEILING` envelope warning. It is a count
 * and never a list of names, because naming the withheld roles republishes exactly what the ceiling
 * withholds (13-07). Surfacing the count is the difference between "there are roles you may not
 * grant" and a picker that silently has fewer entries than the admin next to you sees.
 */
export interface AssignableRoleCatalog {
  roles: AssignableRole[];
  withheldCount: number;
  withheldMessage: string | null;
}

export interface CreateUserPayload {
  email: string;
  fullName?: string;
  locale?: string;
  /**
   * `branchId` and `roleCode` travel together: one without the other is a 400 and creates nothing.
   * Both absent is legal and means "create the account, assign the role later" — the response then
   * says `loginable: false` rather than leaving it to be discovered at that user's first login.
   */
  branchId?: string;
  roleCode?: string;
}

export interface UpdateUserPayload {
  fullName?: string;
  locale?: string;
  active?: boolean;
}

/**
 * A credential that exists exactly once.
 *
 * <p>Returned by create and by admin reset. It is never retrievable again — auth-service keeps only
 * the hash — so the screen that receives it is the last place it exists outside the admin's head.
 */
export interface OneTimePassword {
  userId: string;
  email: string;
  tempPassword: string;
  mustChangePassword: boolean;
  /** Present on create only: false when no branch/role was supplied, i.e. the account cannot log in. */
  loginable: boolean | null;
  assignedRoleCode: string | null;
}

export interface AssignBranchRolePayload {
  branchId: string;
  roleCode: string;
  /**
   * Integer paisa, or `null` for no approval authority.
   *
   * Written unconditionally by the server, which is why it must be sent on EVERY assignment of a
   * role that needs one and never left to carry over: a user demoted from MANAGER to WAITER whose
   * previous limit survived would keep spending authority nobody re-examined.
   */
  approvalLimitPaisa?: number | null;
}

/** The result of a role assignment, including whatever role it replaced on that branch. */
export interface BranchRoleWriteResult {
  branchId: string;
  roleCode: string;
  /** One active role per branch (13-02) — an assignment silently removes another unless shown. */
  displacedRoleCode: string | null;
}
