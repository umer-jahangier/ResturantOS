import type {
  ApiAdminPasswordReset,
  ApiPlatformPermissionModule,
  ApiPlatformUserDetail,
  ApiRolePermissionMatrix,
  ApiUserSecurityState,
} from "@/lib/api-client/schemas/platform-access.schema";
import type {
  AdminPasswordReset,
  PermissionMatrix,
  PermissionModule,
  PlatformUserDetail,
  UserSecurityState,
} from "@/lib/models/platform-access.model";

// Layer-2b: wire shape → domain model. Dates become `Date`; every null survives as null.
//
// There is deliberately no defaulting anywhere in this file. `stationScopes ?? []` would be one
// character and would turn "we could not read this user's station assignments" into "this user is
// unrestricted at every branch" — the exact collapse the producer shaped two separate fields to
// prevent.

/** ISO string → Date, keeping null as null. A null timestamp is a real state, not a gap. */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export function adaptPlatformUserDetail(api: ApiPlatformUserDetail): PlatformUserDetail {
  return {
    tenant: {
      tenantId: api.tenant.tenantId,
      slug: api.tenant.slug,
      brandName: api.tenant.brandName,
      status: api.tenant.status,
      tier: api.tenant.tier,
    },
    userId: api.userId,
    email: api.email,
    fullName: api.fullName,
    locale: api.locale,
    active: api.active,
    mustChangePassword: api.mustChangePassword,
    totpEnabled: api.totpEnabled,
    createdAt: new Date(api.createdAt),
    activity: {
      lastLoginAt: toDate(api.activity.lastLoginAt),
      hasEverSignedIn: api.activity.hasEverSignedIn,
      note: api.activity.note,
    },
    branchRoles: api.branchRoles.map((role) => ({
      branchId: role.branchId,
      roleCode: role.roleCode,
      primary: role.primary,
      approvalLimitPaisa: role.approvalLimitPaisa,
    })),
    // Null stays null. See the file header.
    stationScopes:
      api.stationScopes === null
        ? null
        : api.stationScopes.map((scope) => ({
            branchId: scope.branchId,
            stationCodes: scope.stationCodes,
            unrestricted: scope.unrestricted,
          })),
    stationScopeNote: api.stationScopeNote,
    loginable: api.loginable,
    loginableNote: api.loginableNote,
  };
}

export function adaptUserSecurityState(api: ApiUserSecurityState): UserSecurityState {
  return {
    userId: api.userId,
    email: api.email,
    active: api.active,
    lockedUntil: toDate(api.lockedUntil),
    failedLoginCount: api.failedLoginCount,
    sessionsRevoked: api.sessionsRevoked,
  };
}

export function adaptAdminPasswordReset(api: ApiAdminPasswordReset): AdminPasswordReset {
  return {
    userId: api.userId,
    email: api.email,
    tempPassword: api.tempPassword,
    mustChangePassword: api.mustChangePassword,
  };
}

/**
 * The permission vocabulary, module order preserved.
 *
 * The order is the database's and it is NOT re-sorted here. The matrix's column order comes from
 * the same source, so a client that alphabetised one of the two would produce a legend that
 * disagrees with the grid beside it — and nothing would say so.
 */
export function adaptPermissionModules(api: ApiPlatformPermissionModule[]): PermissionModule[] {
  return api.map((mod) => ({
    module: mod.module,
    permissions: mod.permissions.map((p) => ({
      code: p.code,
      module: p.module,
      description: p.description,
    })),
  }));
}

export function adaptPermissionMatrix(api: ApiRolePermissionMatrix): PermissionMatrix {
  return {
    tenantId: api.tenantId,
    scope: api.scope,
    permissionCodes: api.permissionCodes,
    rows: api.rows.map((row) => ({
      roleCode: row.roleCode,
      roleName: row.roleName,
      system: row.system,
      grantedPermissionCodes: row.grantedPermissionCodes,
      assignedUserCount: row.assignedUserCount,
    })),
    readOnlyReason: api.readOnlyReason,
  };
}
