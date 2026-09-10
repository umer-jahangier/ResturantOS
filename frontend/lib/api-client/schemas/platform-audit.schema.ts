import { z } from "zod";

/**
 * Layer-1 wire schemas for the cross-tenant audit and security surface,
 * `GET /api/v1/platform/audit/{events,logins,authority-changes,coverage}`.
 *
 * <h3>Every shape in this file is a READ, and there is no other kind</h3>
 *
 * Not by convention — by construction. `audit_events` is append-only at three independent layers:
 * the `audit_writer` role holds INSERT and SELECT and nothing else, a PostgreSQL trigger raises on
 * UPDATE and DELETE (`011-audit-immutability-trigger.xml`), and audit-service exposes no mutating
 * handler on any path. So there is no create/update/delete shape here and there is no endpoint
 * that would consume one. An audit log a platform administrator can edit is not an audit log.
 *
 * <h3>The field that matters most on this screen: `tenantsRead`</h3>
 *
 * The cross-tenant read is a fan-out — one call per tenant, each executed under that tenant's own
 * row-level-security policy — and **an RLS-filtered read succeeds and returns zero rows.** It does
 * not error. So `events: []` arriving with `tenantsRead === tenantsInScope` is exactly what a
 * healthy quiet platform looks like AND exactly what a scoping fault looks like, and nothing in
 * the HTTP layer separates them.
 *
 * That is the GA-001 defect class — a failure that reads as an empty result — and the parse layer
 * is where it starts being handled: `tenantsInScope`, `tenantsRead`, `tenantsFailed`,
 * `totalCount` and `totalCountComplete` are all parsed and none of them is collapsed into a
 * boolean here. {@link ../../models/platform-audit.model} turns them into a verdict; this file's
 * job is to make sure the evidence survives the wire.
 *
 * <h3>Ids stay ids</h3>
 *
 * `userId` and `impersonatedBy` are UUIDs and are NOT resolved to people. The platform plane holds
 * no tenant token and resolving a name would be one directory call per tenant per page. A name
 * that failed to resolve would have to degrade to an id anyway — and a placeholder that reads like
 * a person, on an accountability screen, is worse than the id it replaced.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Events — mirrors `PlatformAuditViewDtos.PlatformAuditEvent`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One audit row, attributed to a tenant this console can name.
 *
 * <p>`tenantSlug` / `tenantBrandName` are nullable because a row can outlive its tenant
 * registration. That is a real state — "the tenant is gone and the record is not" — and it renders
 * as those words beside the raw id, never as a blank cell that reads as a missing value.
 *
 * <p>`id` is a `number`: `audit_events.id` is a BIGINT sequence, not a UUID. It is well inside
 * `Number.MAX_SAFE_INTEGER` for any plausible volume and JSON gives it to us as a JS number
 * already, so there is nothing to be gained by stringifying it here.
 */
export const apiPlatformAuditEventSchema = z.object({
  id: z.number().nullable(),
  tenantId: z.string().uuid().nullable(),
  tenantSlug: z.string().nullable(),
  tenantBrandName: z.string().nullable(),
  occurredAt: z.string(),
  action: z.string(),
  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),
  branchId: z.string().uuid().nullable(),
  userId: z.string().uuid().nullable(),
  /** The platform administrator behind an impersonated session. The join to the impersonation register. */
  impersonatedBy: z.string().uuid().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Free-form JSON as a string. Rendered verbatim, never parsed into claims. */
  metadata: z.string().nullable(),
});

/** A tenant whose log could not be read on this request. Named, never silently dropped. */
export const apiTenantReadFailureSchema = z.object({
  tenantId: z.string().uuid(),
  tenantSlug: z.string().nullable(),
  reason: z.string().nullable(),
});

/**
 * A page of the cross-tenant trail, carrying the limits of its own construction.
 *
 * <p>`totalCountComplete: false` makes `totalCount` a LOWER BOUND — at least one tenant in scope
 * failed to read. A screen that prints it as a fact has told the reader their trail is smaller
 * than it is, which on an audit surface is the most damaging direction to be wrong in.
 *
 * <p>`actionsPresent` is null when facets were not requested and empty when there genuinely are
 * none. The distinction is kept: a filter dropdown built from an empty list is a dropdown that
 * says "your trail has a hole in it", and one built from a null is a dropdown that was never
 * asked for.
 */
export const apiPlatformAuditPageSchema = z.object({
  events: z.array(apiPlatformAuditEventSchema),
  totalCount: z.number(),
  totalCountComplete: z.boolean(),
  tenantsInScope: z.number(),
  tenantsRead: z.number(),
  tenantsFailed: z.array(apiTenantReadFailureSchema),
  from: z.string(),
  to: z.string(),
  zone: z.string(),
  page: z.number(),
  size: z.number(),
  actionsPresent: z.array(z.string()).nullable(),
  /** The page is deeper than the per-tenant scan budget, so the merge is no longer provably exact. */
  scanTruncated: z.boolean(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Coverage — mirrors `PlatformAuditViewDtos.AuditCoverage`
// ─────────────────────────────────────────────────────────────────────────────

export const apiCoverageItemSchema = z.object({
  subject: z.string(),
  detail: z.string(),
});

/**
 * What this platform's audit trail does and does not cover, from the service itself.
 *
 * <p>An endpoint rather than a paragraph in a wiki, because the gaps are the kind a console will
 * otherwise paper over. The load-bearing one: **SuperAdmin logins to the control plane are not in
 * `audit_events` at all** — `audit_events.tenant_id` is NOT NULL and a platform login has no
 * tenant. A "platform operator activity" tile drawn from this data would be empty for reasons that
 * have nothing to do with how busy the operators were, and would read as a quiet week.
 */
export const apiAuditCoverageSchema = z.object({
  generatedAt: z.string(),
  captured: z.array(apiCoverageItemSchema),
  notCaptured: z.array(apiCoverageItemSchema),
  retention: z.string(),
  immutability: z.string(),
});

export type ApiPlatformAuditEvent = z.infer<typeof apiPlatformAuditEventSchema>;
export type ApiPlatformAuditPage = z.infer<typeof apiPlatformAuditPageSchema>;
export type ApiTenantReadFailure = z.infer<typeof apiTenantReadFailureSchema>;
export type ApiAuditCoverage = z.infer<typeof apiAuditCoverageSchema>;
export type ApiCoverageItem = z.infer<typeof apiCoverageItemSchema>;
