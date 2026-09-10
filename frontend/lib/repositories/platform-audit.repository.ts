import { get } from "@/lib/api-client/request";
import {
  apiAuditCoverageSchema,
  apiPlatformAuditPageSchema,
} from "@/lib/api-client/schemas/platform-audit.schema";
import { adaptAuditCoverage, adaptPlatformAuditPage } from "@/lib/adapters/platform-audit.adapter";
import type {
  AuditCoverage,
  AuditView,
  PlatformAuditPage,
} from "@/lib/models/platform-audit.model";

export interface AuditQuery {
  view: AuditView;
  tenantId?: string;
  actorId?: string;
  /** Repeatable. Only meaningful on the `events` view. */
  action?: string[];
  resourceType?: string;
  /** `logins` only. */
  failedOnly?: boolean;
  /** `YYYY-MM-DD`, cut in `zone`. */
  from?: string;
  to?: string;
  zone: string;
  page: number;
  size?: number;
}

/**
 * Layer-2c repository for the platform audit surface. **Every method is a GET.**
 *
 * <p>That is not a convention this file is choosing to follow — it is the only thing the backend
 * offers. `audit_events` is append-only at the role grant, at a database trigger, and at the
 * service's routing table, so there is no mutating endpoint to wrap. A repository is where a
 * "just add a delete" would go, and there is nowhere for it to go.
 *
 * <h3>Why the three views are three calls and not one call with a filter</h3>
 *
 * They are three endpoints on the backend — `/events`, `/logins`, `/authority-changes` — and each
 * applies its action filter server-side, inside the per-tenant fan-out. Re-deriving "logins" in
 * the browser from a page of `/events` would filter a PAGE rather than the trail: a reader on
 * page 1 of all events would see whichever logins happened to be in those fifty rows and would
 * have no way to know the rest existed.
 */
export const PlatformAuditRepository = {
  async search(query: AuditQuery): Promise<PlatformAuditPage> {
    const raw = await get(`/api/v1/platform/audit/${query.view}`, {
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.action && query.action.length > 0 ? { action: query.action } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.view === "logins" && query.failedOnly ? { failedOnly: true } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      zone: query.zone,
      page: query.page,
      size: query.size ?? 50,
      // Facets are asked for on the `events` view only, and only because the action set is open:
      // the filter control offers exactly the actions that occur in this window and scope, so it
      // can never offer a value that cannot return rows. On an audit screen an option that
      // matches nothing reads as "your trail has a hole in it".
      //
      // The other two views have a server-fixed action set, so a facet list there would just
      // restate a constant back at the client.
      ...(query.view === "events" ? { includeFacets: true } : {}),
    });
    return adaptPlatformAuditPage(apiPlatformAuditPageSchema.parse(raw));
  },

  /**
   * `GET /api/v1/platform/audit/coverage` — the trail's own boundaries, from the service.
   *
   * <p>Read on every visit to the audit screen and rendered beside the grid rather than tucked
   * behind a link. The gaps it names are the kind a console papers over by omission: SuperAdmin
   * logins to the control plane are not in `audit_events` at all, so a "platform operator
   * activity" panel built from this data would be permanently empty and would read as a quiet
   * week.
   */
  async getCoverage(): Promise<AuditCoverage> {
    const raw = await get("/api/v1/platform/audit/coverage");
    return adaptAuditCoverage(apiAuditCoverageSchema.parse(raw));
  },
};
