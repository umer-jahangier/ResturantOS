"use client";

import { useQuery } from "@tanstack/react-query";

import { DEFAULT_TIME_ZONE } from "@/lib/format/locale";
import { PlatformAnalyticsRepository } from "@/lib/repositories/platform-analytics.repository";
import type {
  SeriesInterval,
  TenantGrowth,
  UsageRollup,
} from "@/lib/models/platform-analytics.model";

/**
 * Layer-3 hooks for platform growth and usage.
 *
 * <h3>Keys are not branch-scoped, and cannot be</h3>
 *
 * Same reasoning as `use-platform-tenants.ts` and `use-platform-overview.ts`: the shared registry
 * in `query-keys.ts` embeds a `branchId` in every key, and a platform token carries neither a
 * branch nor a tenant. Threading a `""` through that registry to satisfy its shape would put a lie
 * in the one structure this codebase uses to reason about scope.
 *
 * <h3>`retry: false`, here as everywhere on this plane</h3>
 *
 * A 403 on `/api/v1/platform/**` means the principal is not a SuperAdmin. That is an answer, not a
 * transient failure, and retrying it three times only delays an honest error behind a spinner that
 * implies something is still loading.
 *
 * <h3>What is deliberately NOT here</h3>
 *
 * `usePlatformAnalyticsOverview` and `usePlatformSystemHealth` already exist in
 * `use-platform-overview.ts` and the analytics and system SCREENS consume those, unchanged. Two
 * hooks reading one endpoint would give the console two caches of one truth and two moments at
 * which they could disagree.
 */

/**
 * The zone every bucket in this console is cut in.
 *
 * <p>Pinned to the same constant every stamp on every screen is rendered in, and that agreement is
 * the point rather than a tidiness preference. A chart whose buckets are cut at UTC while its
 * labels are printed in `Asia/Karachi` puts the boundary five hours away from where the axis says
 * it is — which is the Takings defect, and the `AuditQueryController` defect, both already fixed
 * once in this repository. Sending the zone explicitly also means an unrecognised value comes back
 * as a 422 naming the field instead of silently falling back to UTC.
 */
const CUT_ZONE = DEFAULT_TIME_ZONE;

export const platformAnalyticsKeys = {
  growth: (interval: SeriesInterval, from: string | undefined, to: string | undefined) =>
    ["platform", "analytics", "growth", { interval, from, to, zone: CUT_ZONE }] as const,
  usage: (scope: string) => ["platform", "analytics", "usage", scope] as const,
};

/**
 * Tenant growth, suspensions and cancellations as three sparse series.
 *
 * <p>One indexed read per series behind it, so a minute of `staleTime` is generous — these move
 * with operator actions, not with traffic.
 */
export function usePlatformTenantGrowth(params: {
  interval: SeriesInterval;
  from?: string;
  to?: string;
}) {
  return useQuery<TenantGrowth>({
    queryKey: platformAnalyticsKeys.growth(params.interval, params.from, params.to),
    queryFn: () =>
      PlatformAnalyticsRepository.getTenantGrowth({
        interval: params.interval,
        zone: CUT_ZONE,
        from: params.from,
        to: params.to,
      }),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Usage measured against entitlement, rolled up across a scope of tenants.
 *
 * <p><b>This is the most expensive read on the analytics screen and the settings say so.</b> Two
 * of its four dimensions are one internal HTTP call per tenant each — there is no cross-tenant
 * branch count and no cross-tenant user count in this product — so the cost scales with the fleet
 * and a refocus refetch would re-probe every tenant because somebody switched back to the tab.
 * Five minutes, and no refocus. Branch and account counts are not per-minute facts.
 */
export function usePlatformUsageRollup(scope: string) {
  return useQuery<UsageRollup>({
    queryKey: platformAnalyticsKeys.usage(scope),
    queryFn: () => PlatformAnalyticsRepository.getUsageRollup(scope),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
