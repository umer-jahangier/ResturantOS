import { get, post } from "@/lib/api-client/request";
import { apiTenantUserPageSchema } from "@/lib/api-client/schemas/platform.schema";
import {
  apiAdminPasswordResetSchema,
  apiPlatformPermissionModulesSchema,
  apiPlatformUserDetailSchema,
  apiRolePermissionMatrixSchema,
  apiUserDetailDataSchema,
  apiUserSecurityStateSchema,
} from "@/lib/api-client/schemas/platform-access.schema";
import { adaptTenantUserPage } from "@/lib/adapters/platform.adapter";
import {
  adaptAdminPasswordReset,
  adaptPermissionMatrix,
  adaptPermissionModules,
  adaptPlatformUserDetail,
  adaptUserSecurityState,
} from "@/lib/adapters/platform-access.adapter";
import type { TenantUserPage } from "@/lib/models/platform.model";
import type {
  AdminPasswordReset,
  PermissionMatrix,
  PermissionModule,
  PlatformUserDetail,
  UserSecurityState,
} from "@/lib/models/platform-access.model";

/**
 * Layer-2c repository for the platform tier's people and authorization surfaces.
 *
 * <h3>Every call here is `SUPER_ADMIN`-gated at the API</h3>
 *
 * The route-group guard in `app/(platform)/layout.tsx` exists so a tenant principal is never shown
 * the console; it is not the security boundary. A tenant token reaching any of these receives 403
 * from the gateway regardless of what the browser rendered.
 *
 * <h3>`.parse()`, always the throwing variant</h3>
 *
 * Schema drift has to surface as an error a `QueryBoundary` can render. The non-throwing variant
 * would let a producer-side rename reach a component as `undefined` — which on this console means
 * a user's roles quietly rendering as "none", the shape of an account that cannot log in.
 *
 * <h3>What is deliberately NOT here: `GET /api/v1/platform/rbac/roles`</h3>
 *
 * It exists and it works. It returns each role with its full permission list, its `system` flag
 * and its holder count — and `GET /rbac/matrix` already returns all four of those per row, for the
 * same roles, in the same call the grid needs anyway. Adding a caller would be a second request
 * for data already on screen and a second place for the two to disagree about role order. The
 * screen reads `permissions` (for the module grouping and the descriptions) and `matrix` (for the
 * grid), and that is the whole surface.
 */
export const PlatformAccessRepository = {
  /**
   * The FLEET directory — every user across every tenant.
   *
   * <h3>This is N calls, and the response says so</h3>
   *
   * There is no cross-tenant user query anywhere in this product. `auth_db.users` is FORCE
   * row-level security on `app.current_tenant_id`, `platform_db` holds zero grants in `auth_db`
   * and has neither `postgres_fdw` nor `dblink`, and the only door — `GET /internal/auth/users` —
   * requires an `X-Tenant-Id` and returns ONE tenant's page. So this endpoint fans out one HTTP
   * call per tenant, capped at 100, and its `scan` block reports how many it made, which tenants
   * it could not read, and whether the cap cut it short.
   *
   * <p>When any tenant is unreachable the API WITHHOLDS the total rather than reporting a smaller
   * one. The adapter copies that null through untouched and the screen renders it as a stated
   * absence. Substituting `users.length` anywhere on this path would turn "we could not read four
   * restaurants" into a confident number — the one thing the whole shape exists to refuse.
   *
   * <p>Prefer `PlatformRepository.listTenantUsers` whenever the tenant is known: it is one call
   * and cannot be partially wrong in the way a fan-out can. This method is for the genuine
   * fleet-wide question — "find the user with this email, I do not know their tenant".
   */
  async listFleetUsers(
    params: {
      tenantId?: string;
      tenantStatus?: string;
      status?: string;
      roleCode?: string;
      search?: string;
      page?: number;
      size?: number;
    } = {},
  ): Promise<TenantUserPage> {
    const raw = await get("/api/v1/platform/users", {
      ...(params.tenantId ? { tenantId: params.tenantId } : {}),
      ...(params.tenantStatus ? { tenantStatus: params.tenantStatus } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.roleCode ? { roleCode: params.roleCode } : {}),
      ...(params.search ? { search: params.search } : {}),
      page: params.page ?? 0,
      size: params.size ?? 50,
    });
    return adaptTenantUserPage(apiTenantUserPageSchema.parse(raw));
  },

  /**
   * One user: profile, membership, roles, station scopes, and whether the account can be used.
   *
   * An unknown tenant or user is a 404 and is left to surface as one. "This person has no roles"
   * and "there is no such person" are opposite answers.
   */
  async getUser(tenantId: string, userId: string): Promise<PlatformUserDetail> {
    const raw = await get(`/api/v1/platform/tenants/${tenantId}/users/${userId}`);
    return adaptPlatformUserDetail(apiPlatformUserDetailSchema.parse(raw));
  },

  /**
   * The durable lock: flag off, every live REFRESH session revoked, row and assignments untouched.
   *
   * Already-issued ACCESS tokens survive until they expire — they are stateless and there is no
   * revocation list. A console must not call this "access removed"; the residual window is the
   * access-token TTL, and the dialog says so.
   *
   * <p>The response is parsed rather than discarded: a repository that ignored the body would
   * silently accept a producer-side shape change on a mutation that decides whether a real person
   * can work tomorrow.
   */
  async deactivate(tenantId: string, userId: string, reason: string): Promise<void> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/users/${userId}/deactivate`, {
      reason,
    });
    apiUserDetailDataSchema.parse(raw);
  },

  /**
   * Flag on. Sessions are deliberately NOT restored — revocation is not reversible and should not
   * be, because the sessions revoked at deactivation may have been on a device the person no
   * longer has. They sign in again, which is when the platform re-establishes who holds the
   * account.
   */
  async reactivate(tenantId: string, userId: string, reason: string): Promise<void> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/users/${userId}/reactivate`, {
      reason,
    });
    apiUserDetailDataSchema.parse(raw);
  },

  /**
   * Clears the brute-force lockout counter and timestamp.
   *
   * NOT the same operation as reactivating, and they are separate endpoints so an operator cannot
   * confuse them: `locked_until` is a fifteen-minute cooldown that expires by itself, `is_active`
   * is the durable lock. `lockedUntil: null` in the answer means "not locked".
   */
  async unlock(tenantId: string, userId: string, reason: string): Promise<UserSecurityState> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/users/${userId}/unlock`, {
      reason,
    });
    return adaptUserSecurityState(apiUserSecurityStateSchema.parse(raw));
  },

  /**
   * Sign the user out everywhere; the account itself is untouched.
   *
   * `sessionsRevoked` counts REFRESH sessions. Zero means they held none — a measured zero, which
   * is why the endpoint answers with a body instead of `204`, and which the screen reports rather
   * than replacing with a claim of success.
   */
  async revokeSessions(
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<UserSecurityState> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/users/${userId}/revoke-sessions`, {
      reason,
    });
    return adaptUserSecurityState(apiUserSecurityStateSchema.parse(raw));
  },

  /**
   * Mint a temporary password and return it ONCE.
   *
   * The escape hatch for a tenant that has locked itself out of its own highest role, which nobody
   * inside that tenant can fix — the role ceiling correctly refuses a lesser role resetting a
   * greater one.
   *
   * <p>The credential is in this response and nowhere else: not in the audit row, not in a log,
   * and not behind any endpoint that could hand it over a second time. There is no email path in
   * this product, so the operator is the delivery channel. A repeat call is harmless and honest —
   * it mints a NEW password and writes a second audit row, which is what actually happened.
   */
  async resetPassword(
    tenantId: string,
    userId: string,
    reason: string,
  ): Promise<AdminPasswordReset> {
    const raw = await post(`/api/v1/platform/tenants/${tenantId}/users/${userId}/reset-password`, {
      reason,
    });
    return adaptAdminPasswordReset(apiAdminPasswordResetSchema.parse(raw));
  },

  /**
   * The permission vocabulary, grouped by module.
   *
   * Takes no tenant and must not grow one: `permissions` is global, non-RLS and identical for
   * every tenant. The count is whatever the database declares — deliberately not asserted against
   * a constant anywhere, because a hardcoded total is right on the day it is written and wrong
   * after the next changeset.
   */
  async listPermissionModules(): Promise<PermissionModule[]> {
    const raw = await get("/api/v1/platform/rbac/permissions");
    return adaptPermissionModules(apiPlatformPermissionModulesSchema.parse(raw));
  },

  /**
   * The role × permission grid.
   *
   * `tenantId` omitted means the GLOBAL catalogue — the system roles every tenant inherits, with
   * holder counts of 0 because holders are a per-tenant fact. Named, it adds that tenant's own
   * custom roles and populates the counts. An unknown id is 404, never a silent fallback to the
   * global answer: that would be right for SOME tenant and not the one asked about.
   */
  async getPermissionMatrix(tenantId?: string): Promise<PermissionMatrix> {
    const raw = await get("/api/v1/platform/rbac/matrix", tenantId ? { tenantId } : undefined);
    return adaptPermissionMatrix(apiRolePermissionMatrixSchema.parse(raw));
  },
};
