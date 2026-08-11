import { apiClient } from "@/lib/api-client/client";
import { del, get, getPaginated, patch, post } from "@/lib/api-client/request";
import type { PaginatedResult } from "@/lib/api-client/request";
import {
  apiAdminResetResultSchema,
  apiAssignableRolesEnvelopeSchema,
  apiAssignBranchRoleRequestSchema,
  apiBranchRoleWriteResultSchema,
  apiCreatedUserSchema,
  apiUserDetailSchema,
  apiUserSummarySchema,
} from "@/lib/api-client/schemas/user.schema";
import {
  adaptAdminResetResult,
  adaptAssignableRole,
  adaptBranchRoleWriteResult,
  adaptCreatedUser,
  adaptTenantUser,
  adaptTenantUserDetail,
} from "@/lib/adapters/user.adapter";
import type {
  AssignBranchRolePayload,
  AssignableRoleCatalog,
  BranchRoleWriteResult,
  CreateUserPayload,
  OneTimePassword,
  TenantUser,
  TenantUserDetail,
  UpdateUserPayload,
} from "@/lib/models/user.model";
import { z } from "zod";

/**
 * Layer-2 repository for tenant user administration (plans 13-07, 13-12, 13-13).
 *
 * <p>Every method here calls an endpoint that was proved live before this screen existed —
 * 56 assertions across two genuinely provisioned tenants for the user API, 48 for the admin reset,
 * 28 for the role catalogue. Nothing in this file is speculative, and nothing works around a
 * missing endpoint: where the platform has no API the UI says so instead (see
 * `settings.repository.ts`).
 *
 * <p><b>The tenant is never a parameter.</b> Scope comes from the signature-verified JWT at the
 * gateway; the request DTOs declare no tenant field so a body carrying one is dropped. A repository
 * method taking a tenant id would be the first place in the stack that lets a client choose.
 */

/** Search is applied server-side; `size` is capped at 200 upstream whatever is asked for. */
export interface UserListParams {
  page?: number;
  size?: number;
  search?: string;
  activeOnly?: boolean;
}

export const UserRepository = {
  /**
   * `GET /api/v1/users` — one page of THIS tenant's users.
   *
   * <p>The cursor fields carry the page NUMBER as a string (13-12 §4), so `meta.page.nextCursor`
   * being null is the only reliable "last page" signal; `totalCount` is the honest total even when
   * the requested size was capped.
   */
  async list(params: UserListParams = {}): Promise<PaginatedResult<TenantUser>> {
    const query: Record<string, unknown> = {
      page: params.page ?? 0,
      size: params.size ?? 50,
    };
    // Omitted rather than sent empty: an empty `search` is a filter the backend would have to
    // decide how to interpret, and "everything" is what omitting it already means.
    if (params.search) query.search = params.search;
    if (params.activeOnly) query.activeOnly = true;

    const page = await getPaginated<unknown>("/api/v1/users", query);
    return {
      data: z.array(apiUserSummarySchema).parse(page.data).map(adaptTenantUser),
      meta: page.meta,
    };
  },

  /** `GET /api/v1/users/{id}` — profile PLUS active assignments. 404 across tenants. */
  async get(userId: string): Promise<TenantUserDetail> {
    const raw = await get<unknown>(`/api/v1/users/${userId}`);
    return adaptTenantUserDetail(apiUserDetailSchema.parse(raw));
  },

  /**
   * `POST /api/v1/users` → 201 with a one-time temporary password.
   *
   * <p>`branchId` and `roleCode` travel together or not at all; sending one alone is a 400 that
   * creates nothing. The form enforces the same pairing so the refusal is never the way a user
   * finds out.
   */
  async create(payload: CreateUserPayload): Promise<OneTimePassword> {
    const body: Record<string, unknown> = { email: payload.email };
    if (payload.fullName) body.fullName = payload.fullName;
    if (payload.locale) body.locale = payload.locale;
    if (payload.branchId && payload.roleCode) {
      body.branchId = payload.branchId;
      body.roleCode = payload.roleCode;
    }
    const raw = await post<unknown, unknown>("/api/v1/users", body);
    return adaptCreatedUser(apiCreatedUserSchema.parse(raw));
  },

  /**
   * `PATCH /api/v1/users/{id}` — patch semantics: an omitted field is left alone.
   *
   * <p>`active` is deliberately sent only when the caller passed it. The backend types it as a
   * boxed `Boolean` for the same reason: a primitive would default to `false` and every profile
   * edit would quietly deactivate the user.
   */
  async update(userId: string, payload: UpdateUserPayload): Promise<TenantUserDetail> {
    const body: Record<string, unknown> = {};
    if (payload.fullName !== undefined) body.fullName = payload.fullName;
    if (payload.locale !== undefined) body.locale = payload.locale;
    if (payload.active !== undefined) body.active = payload.active;
    const raw = await patch<unknown, unknown>(`/api/v1/users/${userId}`, body);
    return adaptTenantUserDetail(apiUserDetailSchema.parse(raw));
  },

  /** `POST /api/v1/users/{id}/deactivate` — flag off AND every active session revoked. */
  async deactivate(userId: string): Promise<TenantUserDetail> {
    const raw = await post<undefined, unknown>(`/api/v1/users/${userId}/deactivate`);
    return adaptTenantUserDetail(apiUserDetailSchema.parse(raw));
  },

  async reactivate(userId: string): Promise<TenantUserDetail> {
    const raw = await post<undefined, unknown>(`/api/v1/users/${userId}/reactivate`);
    return adaptTenantUserDetail(apiUserDetailSchema.parse(raw));
  },

  /**
   * `POST /api/v1/users/{id}/reset-password` — the ONLY working way to set another user's password.
   *
   * <p>Self-service email reset ships disabled (13-09, D-31: there is no notification consumer, so
   * no mail can be sent), which is why this exists and why the temporary password comes back in the
   * response to be handed over out of band.
   *
   * <p>`reason` is mandatory at the API — blank is a 400 — and it lands in the audit event, so it
   * is a required field on the form rather than an optional note.
   */
  async resetPassword(userId: string, reason: string): Promise<OneTimePassword> {
    const raw = await post<{ reason: string }, unknown>(`/api/v1/users/${userId}/reset-password`, {
      reason,
    });
    return adaptAdminResetResult(apiAdminResetResultSchema.parse(raw));
  },

  /**
   * `POST /api/v1/users/{id}/branch-roles` — gated on `rbac.role.manage`, NOT the user-admin code.
   *
   * <p>The split is 13-02's and it is load-bearing: gating role assignment on the user-administration
   * code would mean anyone able to edit a user could grant themselves OWNER. A role above the
   * caller's own ceiling is refused with 403 `ROLE_CEILING_EXCEEDED` and writes nothing.
   *
   * <p>`approvalLimitPaisa` travels on this call and on no other. There is deliberately no second
   * endpoint for "just change the limit": the server writes the limit from this request
   * unconditionally, and the ceiling check that protects the operation lives on this path. A second
   * write path for the same field is how two paths drift.
   *
   * <p>The request is validated on the way OUT as well as the response on the way in — an integer
   * paisa value is the one thing that must not be allowed to become a float in transit.
   */
  async assignBranchRole(
    userId: string,
    payload: AssignBranchRolePayload,
  ): Promise<BranchRoleWriteResult> {
    const body = apiAssignBranchRoleRequestSchema.parse(payload);
    const raw = await post<typeof body, unknown>(`/api/v1/users/${userId}/branch-roles`, body);
    return adaptBranchRoleWriteResult(apiBranchRoleWriteResultSchema.parse(raw));
  },

  async removeBranchRole(userId: string): Promise<void> {
    await del(`/api/v1/users/${userId}/branch-roles`);
  },

  /**
   * `GET /api/v1/roles` (auth-service) — the roles this caller may assign, plus the ceiling's own
   * report on what it withheld.
   *
   * <p>Read through `apiClient` directly rather than the `get()` helper because the helper returns
   * only `.data.data` and the whole point of this call is that the ENVELOPE carries the
   * `ROLES_WITHHELD_ABOVE_CEILING` warning. Dropping it would leave a picker that is quietly shorter
   * for one admin than for another with no way to say why.
   */
  async listAssignableRoles(): Promise<AssignableRoleCatalog> {
    const response = await apiClient.get<unknown>("/api/v1/roles");
    const envelope = apiAssignableRolesEnvelopeSchema.parse(response.data);
    const withheld = (envelope.warnings ?? []).find(
      (w) => w.code === "ROLES_WITHHELD_ABOVE_CEILING",
    );
    // The message reports a COUNT and never names the roles — see the schema note. Parsing the
    // count out of it keeps the UI from re-deriving one, which it could only get wrong.
    const match = withheld?.message.match(/(\d+)/);
    return {
      roles: envelope.data.map(adaptAssignableRole),
      withheldCount: match ? Number(match[1]) : withheld ? 1 : 0,
      withheldMessage: withheld?.message ?? null,
    };
  },
};
