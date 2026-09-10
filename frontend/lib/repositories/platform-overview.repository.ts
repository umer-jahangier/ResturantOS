import { get } from "@/lib/api-client/request";
import {
  apiAnalyticsOverviewSchema,
  apiPlatformUserPageSchema,
  apiSubscriptionRegisterSchema,
  apiSystemHealthSchema,
} from "@/lib/api-client/schemas/platform-overview.schema";
import {
  adaptAnalyticsOverview,
  adaptDirectoryScanFromPage,
  adaptSubscriptionRegister,
  adaptSystemHealth,
} from "@/lib/adapters/platform-overview.adapter";
import type {
  AnalyticsOverview,
  DirectorySummary,
  SubscriptionRegister,
  SystemHealth,
} from "@/lib/models/platform-overview.model";

/**
 * Layer-2c repository for the four reads behind the platform overview.
 *
 * <p>All four are `SUPER_ADMIN`-gated GETs. Every one `.parse()`s through the throwing Zod
 * variant, so schema drift surfaces as an error a `QueryBoundary` renders rather than as
 * `undefined` reaching a tile — which, on this screen, would render as a blank where a number
 * belongs and be indistinguishable from a deliberate absence.
 */
export const PlatformOverviewRepository = {
  /**
   * `GET /api/v1/platform/analytics/overview`
   *
   * <p>Tenant population by status and tier, the lifecycle counts, the operator-entered
   * entitlement dates, impersonation volume — and `unavailableMetrics`, the itemised list of what
   * this platform cannot compute. That list is read and rendered, not discarded: it is how the
   * console states the absence of billing deliberately instead of leaving a hole.
   *
   * <p>No `from`/`to` is sent, so the server's default 90-day window applies and echoes back on
   * the response. The overview labels the window from `windowFrom`/`windowTo` rather than
   * restating a literal here — a client-side "last 90 days" caption that drifts from the server's
   * actual cut is a caption that lies about the number beside it.
   */
  async getAnalyticsOverview(): Promise<AnalyticsOverview> {
    const raw = await get("/api/v1/platform/analytics/overview");
    return adaptAnalyticsOverview(apiAnalyticsOverviewSchema.parse(raw));
  },

  /**
   * `GET /api/v1/platform/system/health`
   *
   * <p>Always 200 when the caller is entitled, including when the fleet is on fire — the failures
   * are IN the document. So an HTTP error from this call means the console could not reach the
   * control plane at all, which is a different and larger fact than "a service is down", and the
   * screen renders it through the query's failure state rather than as an unhealthy tile.
   */
  async getSystemHealth(): Promise<SystemHealth> {
    const raw = await get("/api/v1/platform/system/health");
    return adaptSystemHealth(apiSystemHealthSchema.parse(raw));
  },

  /**
   * `GET /api/v1/platform/subscriptions`
   *
   * <p>The honest commercial surface: plan mix, trials ending, renewals overdue, cancellations
   * booked. `size` is high for the same reason `listTenants` uses 200 — the fleet is in the tens,
   * and an overview that summarised the first 50 subscriptions while calling them "all" would be
   * the fabrication this whole screen is built against.
   *
   * <p>There is no revenue total here and there is no endpoint that computes one. The response's
   * own `revenueNote` says so in words and the screen prints it.
   */
  async getSubscriptionRegister(size = 200): Promise<SubscriptionRegister> {
    const raw = await get("/api/v1/platform/subscriptions", { page: 0, size });
    return adaptSubscriptionRegister(apiSubscriptionRegisterSchema.parse(raw));
  },

  /**
   * `GET /api/v1/platform/users` — TWICE, and the cost is stated because it is real.
   *
   * <h3>Why two calls and not one</h3>
   *
   * There is no cross-tenant user query in this product. `auth_db.users` is FORCE row-level
   * security on `app.current_tenant_id`, `platform_db` holds no grant in `auth_db` and has no FDW
   * or dblink, so the directory endpoint fans out one internal HTTP call per tenant. A headcount
   * and an active-headcount are therefore two independent fan-outs; there is no filter that
   * returns both, and no aggregate endpoint that returns either.
   *
   * <h3>Why `size: 1`</h3>
   *
   * The overview needs the `scan` block and nothing else. The rows belong to the directory screen.
   * `size: 1` does not reduce the fan-out — the per-tenant calls happen regardless — but it keeps
   * the payload to one row instead of fifty, twice.
   *
   * <h3>Why the two scans are returned separately</h3>
   *
   * A tenant can answer one request and time out on the other. Merging the scans into a single
   * "complete" flag would be wrong in one direction with no way to say which, so the caller gets
   * both and `inactiveUsers()` refuses to subtract unless both are complete and cover the same
   * number of tenants.
   */
  async getDirectorySummary(): Promise<DirectorySummary> {
    const [all, active] = await Promise.all([
      get("/api/v1/platform/users", { page: 0, size: 1 }),
      get("/api/v1/platform/users", { page: 0, size: 1, status: "ACTIVE" }),
    ]);
    return {
      all: adaptDirectoryScanFromPage(apiPlatformUserPageSchema.parse(all)),
      active: adaptDirectoryScanFromPage(apiPlatformUserPageSchema.parse(active)),
    };
  },
};
