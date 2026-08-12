import { get } from "@/lib/api-client/request";
import { apiFleetHealthSchema } from "@/lib/api-client/schemas/ops.schema";
import { adaptFleetHealth } from "@/lib/adapters/ops.adapter";
import type { FleetHealth } from "@/lib/models/ops.model";

/**
 * Layer-2 repository for the operator health surface (S1-09).
 *
 * ```
 * GET /api/v1/ops/health      ops.health.view
 * ```
 *
 * <h3>This one endpoint is served by the GATEWAY, not by a service</h3>
 *
 * Every other repository in this directory proxies through the gateway to a service behind it.
 * This one terminates AT the gateway, and that is the whole design: a health screen hosted inside
 * one of the processes it reports on can only tell the truth while nothing is wrong. The gateway
 * is the single process the browser talks to, so it is the only vantage point from which
 * "pos-service is not answering" is a sentence that can still be delivered.
 *
 * <p>It is also why this read is NOT branch-scoped and takes no parameters. Which services are
 * running is a fact about the deployment, not about a restaurant, and there is no per-branch or
 * per-tenant version of it.
 */
export const OpsRepository = {
  async getFleetHealth(): Promise<FleetHealth> {
    const raw = await get<unknown>("/api/v1/ops/health");
    return adaptFleetHealth(apiFleetHealthSchema.parse(raw));
  },
};
