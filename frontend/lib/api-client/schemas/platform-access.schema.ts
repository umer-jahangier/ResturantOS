import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Layer-1 wire schemas for the platform tier's USER and RBAC surfaces:
//
//   GET  /api/v1/platform/users                                  (the fleet fan-out — shape reused
//                                                                 from platform.schema.ts)
//   GET  /api/v1/platform/tenants/{tenantId}/users/{userId}
//   POST /api/v1/platform/tenants/{tenantId}/users/{userId}/{deactivate|reactivate|unlock
//                                                             |revoke-sessions|reset-password}
//   GET  /api/v1/platform/rbac/{permissions|roles|matrix}
//
// Every record below mirrors a Java record that was read before it was written —
// `services/platform-admin-service/.../dto/PlatformUserDtos.java` and
// `.../client/AuthUserDirectoryClient.java`. Nothing here is inferred from a screen's needs.
//
// <h3>Why this is a second file rather than more of `platform.schema.ts`</h3>
//
// The same reason the backend split `PlatformUserDtos` out of `PlatformDtos`: that file is tenant
// lifecycle, subscription and impersonation and is edited by other work, and a shared file
// serialises unrelated plans over where a record happened to live. `platform-overview.schema.ts`
// set the precedent on this side. The two shapes the fleet directory needs — `TenantUserPage` and
// its `DirectoryScan` — are IMPORTED from there rather than restated, because a second copy of a
// contract is a second thing to keep in step with the producer.
//
// <h3>The nullability is the contract, not laxity</h3>
//
// A `.nullable()` in this file is almost always a load-bearing absence. Three of them decide what
// a screen is allowed to say:
//
//   * `activity.lastLoginAt` — null means NEVER SIGNED IN. A real state, and the visible shape of
//     a provisioned account nobody can use. Never a blank date.
//   * `stationScopes` — null means WE COULD NOT FIND OUT; `[]` means UNRESTRICTED. Rendering the
//     first as the second tells an operator a user has access to every station when nobody knows.
//   * `lockedUntil` — null means NOT LOCKED. A state, not a missing value.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Mirrors `PlatformUserDtos.TenantMembership`. */
export const apiTenantMembershipSchema = z.object({
  tenantId: z.string().uuid(),
  slug: z.string().nullable(),
  brandName: z.string().nullable(),
  // Left as free strings rather than pinned to the tenant enums. This is a membership card on a
  // user screen, and a tenant that has grown a new lifecycle state must not blank a user's page
  // through a `.parse()` failure on a field the screen only prints.
  status: z.string().nullable(),
  tier: z.string().nullable(),
});

/**
 * Mirrors `PlatformUserDtos.BranchRoleView`.
 *
 * `branchId` is an id and is deliberately not resolved to a branch name: branches live in
 * `user_db` and the platform service reaches them one call per tenant, so decorating this field
 * would put an extra cross-service call on a detail screen. `approvalLimitPaisa` is BIGINT paisa
 * and null means "no per-assignment limit" — a state, not a zero.
 */
export const apiBranchRoleViewSchema = z.object({
  branchId: z.string().uuid(),
  roleCode: z.string(),
  primary: z.boolean(),
  approvalLimitPaisa: z.number().nullable(),
});

/**
 * Mirrors `PlatformUserDtos.StationScopeView`.
 *
 * `unrestricted` is a FIELD rather than something a client infers from `stationCodes.length`,
 * because a user with no station rows sees EVERY station at their branch — the product's default,
 * encoded as an absent claim key. A screen that read the empty list as "assigned to nothing" would
 * say the opposite of the truth.
 */
export const apiStationScopeViewSchema = z.object({
  branchId: z.string().uuid(),
  stationCodes: z.array(z.string()),
  unrestricted: z.boolean(),
});

/**
 * Mirrors `PlatformUserDtos.UserActivity` — the one activity signal this platform records.
 *
 * Stated as a shape rather than a bare nullable timestamp because the two readings mean different
 * things and a client must not collapse them. `note` is the standing caveat and travels to the
 * screen: attempt-level login history lives in `audit_db.audit_events`, which the platform plane
 * cannot read, so this is current state only and can answer neither "how often" nor "from where".
 */
export const apiUserActivitySchema = z.object({
  lastLoginAt: z.string().nullable(),
  hasEverSignedIn: z.boolean(),
  note: z.string().nullable(),
});

/**
 * Mirrors `PlatformUserDtos.PlatformUserDetail` — everything the platform can honestly say about
 * one person.
 *
 * `loginable` is COMPUTED by the producer (`active && assignments.isNotEmpty()`), and
 * `loginableNote` says why when it is false. An account with no active branch-role assignment
 * looks created and cannot be used — permission resolution fails before a token is minted — which
 * is a defect this product has actually shipped, so the flag is rendered rather than derived on
 * this side from fields that do not carry the tenant's status.
 */
export const apiPlatformUserDetailSchema = z.object({
  tenant: apiTenantMembershipSchema,
  userId: z.string().uuid(),
  email: z.string(),
  fullName: z.string().nullable(),
  locale: z.string().nullable(),
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  totpEnabled: z.boolean(),
  createdAt: z.string(),
  activity: apiUserActivitySchema,
  branchRoles: z.array(apiBranchRoleViewSchema),
  stationScopes: z.array(apiStationScopeViewSchema).nullable(),
  stationScopeNote: z.string().nullable(),
  loginable: z.boolean(),
  loginableNote: z.string().nullable(),
});

/**
 * Mirrors `AuthUserDirectoryClient.UserSecurityData` — what `unlock` and `revoke-sessions` answer.
 *
 * `sessionsRevoked: 0` honestly means the user held no live refresh session. It is a measured
 * zero, not a failed call, and the endpoint returns a body rather than `204` for exactly that
 * reason — so the screen reports the number it was given instead of asserting success.
 */
export const apiUserSecurityStateSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  active: z.boolean(),
  lockedUntil: z.string().nullable(),
  failedLoginCount: z.number(),
  sessionsRevoked: z.number(),
});

/** One active branch-role assignment as `deactivate`/`reactivate` echo it back. */
export const apiUserAssignmentSchema = z.object({
  branchId: z.string().uuid(),
  roleCode: z.string(),
  primary: z.boolean(),
  approvalLimitPaisa: z.number().nullable(),
});

/**
 * Mirrors `AuthUserDirectoryClient.UserDetailData` — the answer to `deactivate` and `reactivate`.
 *
 * The assignments ride along rather than being a second call because a user with none cannot log
 * in at all: an empty list here is the visible form of an unusable account.
 */
export const apiUserDetailDataSchema = z.object({
  user: z.object({
    id: z.string().uuid(),
    email: z.string(),
    fullName: z.string().nullable(),
    locale: z.string().nullable(),
    active: z.boolean(),
    mustChangePassword: z.boolean(),
    totpEnabled: z.boolean(),
    lastLoginAt: z.string().nullable(),
    createdAt: z.string(),
  }),
  assignments: z.array(apiUserAssignmentSchema),
});

/**
 * Mirrors `AuthInternalClient.AdminResetData` — the temporary password, returned exactly once.
 *
 * There is no email path in this product: notification-service has no source files, so the
 * operator IS the delivery channel. The credential is never written to the audit row, never
 * logged, and is not recoverable from any endpoint after this response — `tempPassword` is
 * nullable because the producer's own contract permits its absence, and a screen that assumed a
 * string would render `undefined` as a password.
 */
export const apiAdminPasswordResetSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  tempPassword: z.string().nullable(),
  mustChangePassword: z.boolean().nullable(),
});

// ─── RBAC, read-only ─────────────────────────────────────────────────────────────────────────

/** Mirrors `PlatformUserDtos.PlatformPermission`. */
export const apiPlatformPermissionSchema = z.object({
  code: z.string(),
  module: z.string(),
  description: z.string().nullable(),
});

/** Mirrors `PlatformUserDtos.PlatformPermissionModule` — one module and the codes it owns. */
export const apiPlatformPermissionModuleSchema = z.object({
  module: z.string(),
  permissions: z.array(apiPlatformPermissionSchema),
});

export const apiPlatformPermissionModulesSchema = z.array(apiPlatformPermissionModuleSchema);

/**
 * Mirrors `PlatformUserDtos.MatrixRow`.
 *
 * Grants are a SET of codes, not a positional boolean array, so adding a permission cannot
 * silently shift every role's grants by one column in a client that cached the header. The screen
 * therefore builds its own `Set` per row and never indexes by position.
 */
export const apiMatrixRowSchema = z.object({
  roleCode: z.string(),
  roleName: z.string().nullable(),
  system: z.boolean(),
  grantedPermissionCodes: z.array(z.string()),
  assignedUserCount: z.number(),
});

/**
 * Mirrors `PlatformUserDtos.RolePermissionMatrix`.
 *
 * `readOnlyReason` is `.nullable()` only because the wire permits it; the producer sets it on
 * every response. It is not an error field. Composing a role IS granting authority, the tenant
 * tier bounds that with the role ceiling — an assigner may only grant permissions they already
 * hold — and a platform operator holds no `user_branch_roles`, so there is no ceiling to bound
 * them. The screen renders the sentence as a posture, which is what it is.
 *
 * `permissionCodes` are the columns in module-major order — the same order the catalogue returns
 * them in, which is the database's, so the grid cannot disagree with the legend beside it. Every
 * permission that exists is a column, not only the granted ones, because the question a matrix is
 * usually opened for is "what can NOBODY do?".
 */
export const apiRolePermissionMatrixSchema = z.object({
  tenantId: z.string().uuid().nullable(),
  scope: z.string(),
  permissionCodes: z.array(z.string()),
  rows: z.array(apiMatrixRowSchema),
  readOnlyReason: z.string().nullable(),
});

export type ApiPlatformUserDetail = z.infer<typeof apiPlatformUserDetailSchema>;
export type ApiUserSecurityState = z.infer<typeof apiUserSecurityStateSchema>;
export type ApiUserDetailData = z.infer<typeof apiUserDetailDataSchema>;
export type ApiAdminPasswordReset = z.infer<typeof apiAdminPasswordResetSchema>;
export type ApiPlatformPermissionModule = z.infer<typeof apiPlatformPermissionModuleSchema>;
export type ApiRolePermissionMatrix = z.infer<typeof apiRolePermissionMatrixSchema>;
