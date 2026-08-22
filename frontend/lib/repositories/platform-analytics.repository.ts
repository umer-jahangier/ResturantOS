import { get } from "@/lib/api-client/request";
import {
  apiTenantGrowthSchema,
  apiUsageRollupSchema,
} from "@/lib/api-client/schemas/platform-analytics.schema";
import { adaptTenantGrowth, adaptUsageRollup } from "@/lib/adapters/platform-analytics.adapter";
import type {
  SeriesInterval,
  TenantGrowth,
  UsageRollup,
} from "@/lib/models/platform-analytics.model";

/**
 * Layer-2c repository for the two analytics reads the overview does not make.
 *
 * <p>Both are `SUPER_ADMIN`-gated GETs and both `.parse()` through the throwing Zod variant, so
 * schema drift surfaces as an error a `QueryBoundary` renders. On this screen that matters more
 * than usual: a `safeParse` fallback would hand a chart `undefined` points, and an empty chart is
 * exactly the shape a "we measured nothing" chart has.
 */
export const PlatformAnalyticsRepository = {
  /**
   * `GET /api/v1/platform/analytics/tenant-growth`
   *
   * <p>Three sparse series — created, suspended, cancelled — each carrying the first and last
   * instant its metric has any observation, and each with its own coverage caveat in words.
   *
   * <h3>Why the ZONE is sent and the window is not</h3>
   *
   * The zone is the caller's because the day boundary is a real decision: cutting a business day
   * at UTC for a platform whose branches run on `Asia/Karachi` moves every boundary five hours
   * and sweeps five hours of the previous day into each bucket. That exact defect has been fixed
   * twice in this repository already. The frontend pins `Asia/Karachi` for every stamp it renders
   * (`lib/format/locale.ts`), so sending anything else here would put the buckets in one zone and
   * their labels in another.
   *
   * <p>`from` / `to` are deliberately NOT sent by default. The server's ninety-day window comes
   * back on the response as `windowFrom` / `windowTo` and the screen captions itself from those,
   * so a client-side "last 90 days" label cannot drift from the cut it describes.
   *
   * @param zone an IANA id. An unrecognised one is a 422 naming the field — never a silent fall
   *        back to UTC, because a silent fall back is indistinguishable from the bug.
   */
  async getTenantGrowth(params: {
    interval: SeriesInterval;
    zone: string;
    from?: string;
    to?: string;
  }): Promise<TenantGrowth> {
    const raw = await get("/api/v1/platform/analytics/tenant-growth", {
      interval: params.interval,
      zone: params.zone,
      ...(params.from ? { from: params.from } : {}),
      ...(params.to ? { to: params.to } : {}),
    });
    return adaptTenantGrowth(apiTenantGrowthSchema.parse(raw));
  },

  /**
   * `GET /api/v1/platform/analytics/usage?scope=`
   *
   * <p>The per-tenant usage meters rolled up platform-wide, each reporting how many tenants it
   * actually covers alongside its total.
   *
   * <p>**This is an expensive read and the hook's cache settings say so.** Two of the four
   * dimensions are one internal HTTP call per tenant each — there is no cross-tenant branch or
   * user count in this product — so the cost scales with the fleet. `scope` defaults to `ACTIVE`
   * server-side for the same reason: a cancelled tenant's branch count is not fleet capacity.
   */
  async getUsageRollup(scope: string): Promise<UsageRollup> {
    const raw = await get("/api/v1/platform/analytics/usage", { scope });
    return adaptUsageRollup(apiUsageRollupSchema.parse(raw));
  },
};
