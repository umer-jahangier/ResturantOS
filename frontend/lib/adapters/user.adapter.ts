import type {
  ApiAdminResetResult,
  ApiBranchRoleAssignment,
  ApiBranchRoleWriteResult,
  ApiCreatedUser,
  ApiRoleEntry,
  ApiStationAssignment,
  ApiUserDetail,
  ApiUserSummary,
} from "@/lib/api-client/schemas/user.schema";
import type {
  AssignableRole,
  BranchRoleAssignment,
  BranchRoleWriteResult,
  OneTimePassword,
  TenantUser,
  TenantUserDetail,
  UserStationScope,
} from "@/lib/models/user.model";

/**
 * Wire → domain. The one job here is collapsing `undefined` to `null`: the wire allows a key to be
 * absent OR null for every optional field, and a component that has to test both writes the test
 * wrong eventually. Everything downstream sees exactly one absent value.
 */
export function adaptTenantUser(api: ApiUserSummary): TenantUser {
  return {
    id: api.id,
    email: api.email,
    fullName: api.fullName ?? null,
    locale: api.locale ?? null,
    active: api.active,
    mustChangePassword: api.mustChangePassword,
    totpEnabled: api.totpEnabled,
    lastLoginAt: api.lastLoginAt ?? null,
    createdAt: api.createdAt ?? null,
  };
}

export function adaptBranchRoleAssignment(api: ApiBranchRoleAssignment): BranchRoleAssignment {
  return {
    branchId: api.branchId,
    roleCode: api.roleCode,
    primary: api.primary,
    approvalLimitPaisa: api.approvalLimitPaisa ?? null,
  };
}

export function adaptTenantUserDetail(api: ApiUserDetail): TenantUserDetail {
  return {
    user: adaptTenantUser(api.user),
    assignments: api.assignments.map(adaptBranchRoleAssignment),
  };
}

export function adaptAssignableRole(api: ApiRoleEntry): AssignableRole {
  return {
    code: api.code,
    name: api.name,
    system: api.system,
    permissions: api.permissions,
    assignedUserCount: api.assignedUserCount ?? 0,
  };
}

/**
 * Create and admin-reset return the same secret in two slightly different shapes; both become
 * {@link OneTimePassword} so exactly one component renders a one-time credential and exactly one
 * copy of the "this will not be shown again" wording exists.
 */
export function adaptCreatedUser(api: ApiCreatedUser): OneTimePassword {
  return {
    userId: api.id,
    email: api.email,
    tempPassword: api.tempPassword,
    mustChangePassword: api.mustChangePassword,
    loginable: api.loginable,
    assignedRoleCode: api.assignedRoleCode ?? null,
  };
}

export function adaptAdminResetResult(api: ApiAdminResetResult): OneTimePassword {
  return {
    userId: api.userId,
    email: api.email,
    tempPassword: api.tempPassword,
    mustChangePassword: api.mustChangePassword,
    // A reset never changes whether the account holds a role, so it has nothing to say here.
    loginable: null,
    assignedRoleCode: null,
  };
}

/**
 * The station scope, with the unrestricted state named rather than inferred.
 *
 * <p>A branch whose list came back empty is DROPPED rather than kept as an empty row. 28-01 says
 * an empty list is never produced; if one ever arrives it means "unrestricted at that branch", and
 * keeping it would let a `branches.length` check downstream report a restriction that does not
 * exist.
 */
export function adaptUserStationScope(api: ApiStationAssignment[]): UserStationScope {
  const branches = api
    .filter((a) => a.stationCodes.length > 0)
    .map((a) => ({ branchId: a.branchId, stationCodes: a.stationCodes }));
  return { unrestrictedEverywhere: branches.length === 0, branches };
}

export function adaptBranchRoleWriteResult(api: ApiBranchRoleWriteResult): BranchRoleWriteResult {
  return {
    branchId: api.branchId,
    roleCode: api.roleCode,
    displacedRoleCode: api.displacedRoleCode ?? null,
  };
}
