import { z } from "zod";

/**
 * Layer-1 wire shapes for the tenant audit log — `GET /api/v1/audit/events` and
 * `GET /api/v1/audit/facets` (audit-service `AuditQueryController`).
 *
 * <h3>`action` and `resourceType` are plain strings, never `z.enum`</h3>
 *
 * <p>`resourceType` is DERIVED server-side from the leading noun of the event type
 * (`AuditIngestionService.resolveResourceType`: `ORDER_VOIDED` → `ORDER`), and the set of event
 * types grows every time a service starts publishing one. An enum here would mean that the first
 * new auditable event in the platform turns this screen into a parse failure — i.e. the log that
 * exists to record what happened would stop rendering because something new happened. The screen
 * treats both as opaque labels and gets its filter vocabulary from `/facets`, which reads the
 * tenant's actual rows.
 *
 * <h3>`afterState` and `metadata` are strings, and stay strings here</h3>
 *
 * <p>They are `jsonb` columns serialised as text. Parsing belongs in the adapter, where a malformed
 * or truncated payload can degrade to "no detail recorded" for that one row. Declaring them as
 * objects would make one bad row a failed parse for the whole page — an audit log dropping 49 good
 * rows because the 50th has an unusual payload is exactly the failure this product keeps shipping.
 */
export const apiAuditEventSchema = z.object({
  id: z.number(),
  /** ISO-8601 instant, always UTC on the wire. Rendered in the branch zone. */
  occurredAt: z.string(),
  action: z.string(),
  resourceType: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  branchId: z.string().nullable().optional(),
  /** The account that acted. Under impersonation, the account acted AS. */
  userId: z.string().nullable().optional(),
  /** Resolved at read time from auth-service; null when it could not be resolved. */
  userName: z.string().nullable().optional(),
  impersonatedBy: z.string().nullable().optional(),
  impersonatedByName: z.string().nullable().optional(),
  afterState: z.string().nullable().optional(),
  metadata: z.string().nullable().optional(),
});

export type ApiAuditEvent = z.infer<typeof apiAuditEventSchema>;

/** `GET /api/v1/audit/facets` — the filter vocabulary this tenant's own rows contain. */
export const apiAuditFacetsSchema = z.object({
  actions: z.array(z.string()).nullable().optional(),
  resourceTypes: z.array(z.string()).nullable().optional(),
});

export type ApiAuditFacets = z.infer<typeof apiAuditFacetsSchema>;
