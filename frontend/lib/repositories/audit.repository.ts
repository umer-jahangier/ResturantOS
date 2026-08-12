import { get, getPaginated } from "@/lib/api-client/request";
import type { PaginatedResult } from "@/lib/api-client/request";
import {
  apiAuditEventSchema,
  apiAuditFacetsSchema,
} from "@/lib/api-client/schemas/audit.schema";
import { adaptAuditEvent, adaptAuditFacets } from "@/lib/adapters/audit.adapter";
import type { AuditEvent, AuditEventFilters, AuditFacets } from "@/lib/models/audit.model";
import { z } from "zod";

/**
 * Layer-2 repository for the tenant audit log (F4).
 *
 * ```
 * GET /api/v1/audit/events    audit.log.view
 * GET /api/v1/audit/facets    audit.log.view
 * ```
 *
 * <h3>There is no tenant parameter, and there must never be one</h3>
 *
 * <p>audit-service takes the tenant from the signature-verified JWT and declares no tenant
 * parameter at all — that is the whole of the cross-tenant control on the most sensitive read in
 * the product. A repository method that accepted a tenant id would be the first place in the stack
 * that let a client choose whose audit log to read, even if nothing ever passed one.
 *
 * <h3>`zone` is the branch's, and is not optional in practice</h3>
 *
 * <p>The server cuts `from`/`to` at midnight in `zone`, defaulting to UTC. For a branch in
 * Asia/Karachi that default is five hours wrong, so the hook always passes the branch's stored
 * timezone. An unrecognised zone comes back 422 naming the field rather than being silently treated
 * as UTC — a screen that quietly shows the wrong day is the defect this parameter exists to remove,
 * and swallowing the refusal here would reintroduce it.
 */
export const AuditRepository = {
  /** One page of this tenant's audit events, newest first, with a real total. */
  async listEvents(filters: AuditEventFilters = {}): Promise<PaginatedResult<AuditEvent>> {
    const query: Record<string, unknown> = {
      page: filters.page ?? 0,
      size: filters.size ?? 50,
    };
    // Omitted rather than sent empty. An empty `action` would be a filter the server has to decide
    // how to read, and "everything" is already what omitting it means.
    if (filters.action) query.action = filters.action;
    if (filters.resourceType) query.resourceType = filters.resourceType;
    if (filters.from) query.from = filters.from;
    if (filters.to) query.to = filters.to;
    if (filters.zone) query.zone = filters.zone;

    const page = await getPaginated<unknown>("/api/v1/audit/events", query);
    return {
      data: z.array(apiAuditEventSchema).parse(page.data).map(adaptAuditEvent),
      meta: page.meta,
    };
  },

  /** The action names and resource types this tenant actually has, for the filter controls. */
  async getFacets(
    window: Pick<AuditEventFilters, "from" | "to" | "zone"> = {},
  ): Promise<AuditFacets> {
    const query: Record<string, unknown> = {};
    if (window.from) query.from = window.from;
    if (window.to) query.to = window.to;
    if (window.zone) query.zone = window.zone;

    const raw = await get<unknown>("/api/v1/audit/facets", query);
    return adaptAuditFacets(apiAuditFacetsSchema.parse(raw));
  },
};
