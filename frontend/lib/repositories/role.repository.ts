import { z } from "zod";

import { del, get, post, put } from "@/lib/api-client/request";
import {
  apiPermissionModuleSchema,
  apiRoleWriteRequestSchema,
} from "@/lib/api-client/schemas/role.schema";
import { apiRoleEntrySchema } from "@/lib/api-client/schemas/user.schema";
import { adaptPermissionModule } from "@/lib/adapters/role.adapter";
import { adaptAssignableRole } from "@/lib/adapters/user.adapter";
import type { PermissionModule, RoleWritePayload } from "@/lib/models/role.model";
import type { AssignableRole } from "@/lib/models/user.model";

/**
 * Layer-2 repository for the ROLE BUILDER (S3).
 *
 * <p>The catalogue READ that this screen lists from is `UserRepository.listAssignableRoles()` and
 * stays there: one endpoint, one client, shared with the assign dialog so the two screens cannot
 * come to disagree about what a role grants or which roles this caller may touch. What lives here
 * is the vocabulary read and the three writes, none of which existed before this plan.
 *
 * <p><b>Every one of these was driven live against the running stack before this screen was
 * written</b> — `POST /api/v1/roles` answered 201 with a derived `PROBE_ROLE` code, `DELETE`
 * answered 204. Nothing here is speculative and nothing works around a missing endpoint.
 *
 * <p><b>The tenant is never a parameter</b>, and neither is the role code on a create. Scope comes
 * from the signature-verified JWT at the gateway, and the code is derived server-side from the
 * name. A repository method taking either would be the first place in the stack that lets a client
 * choose one.
 */
export const RoleRepository = {
  /**
   * `GET /api/v1/permissions` — the platform's whole authorization vocabulary, grouped by module.
   *
   * <p>Gated on the same administration authority as the role list, and deliberately NOT
   * ceiling-filtered: a permission code is vocabulary, not authority, and no endpoint in the system
   * accepts one from a caller. Hiding codes here would leave the builder unable to EXPLAIN a role
   * it is already allowed to show.
   */
  async listPermissions(): Promise<PermissionModule[]> {
    const raw = await get<unknown[]>("/api/v1/permissions");
    return z.array(apiPermissionModuleSchema).parse(raw ?? []).map(adaptPermissionModule);
  },

  /**
   * `POST /api/v1/roles` — compose a new role. 201 with the role as it was written.
   *
   * <p>Refused 403 `ROLE_CEILING_EXCEEDED` if the ticked set contains anything the caller does not
   * hold themselves. That is not a client-side rule the UI could enforce instead: the server
   * recomputes the caller's permissions from the database rather than trusting the token, so the
   * form's job is to render the refusal, never to pre-empt it.
   */
  async create(payload: RoleWritePayload): Promise<AssignableRole> {
    const body = apiRoleWriteRequestSchema.parse(payload);
    const raw = await post<typeof body, unknown>("/api/v1/roles", body);
    return adaptAssignableRole(apiRoleEntrySchema.parse(raw));
  },

  /**
   * `PUT /api/v1/roles/{code}` — REPLACE what the role is called and what it grants.
   *
   * <p>The permission array is the whole truth about the role afterwards, not a delta. A checkbox
   * list sent as add/remove pairs would need the client to hold a correct picture of the current
   * set, and one stale read would remove the wrong permission from everybody holding the role.
   */
  async update(roleCode: string, payload: RoleWritePayload): Promise<AssignableRole> {
    const body = apiRoleWriteRequestSchema.parse(payload);
    const raw = await put<typeof body, unknown>(
      `/api/v1/roles/${encodeURIComponent(roleCode)}`,
      body,
    );
    return adaptAssignableRole(apiRoleEntrySchema.parse(raw));
  },

  /**
   * `DELETE /api/v1/roles/{code}` — 204, or 409 `ROLE_IN_USE` while anybody still holds it.
   *
   * <p>The refusal is the point: deleting a role out from under its holders leaves them able to log
   * in holding nothing, which looks to them like a product with every screen missing rather than
   * like a lockout.
   */
  async remove(roleCode: string): Promise<void> {
    await del(`/api/v1/roles/${encodeURIComponent(roleCode)}`);
  },
};
