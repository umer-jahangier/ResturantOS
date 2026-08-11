"use client";

import { useQuery } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import { platformKeys } from "@/lib/hooks/use-platform-tenants";
import type { TenantUsage } from "@/lib/models/platform.model";

/**
 * Usage against entitlement for one tenant (19c).
 *
 * `GET /api/v1/platform/tenants/{id}/usage` did not exist before this phase — it, and the three
 * other paths a console might reach for (`/usage-summary`, `/entitlements`, `/limits`), all
 * answered **404** with a valid SUPER_ADMIN token.
 *
 * <h3>What this returns today, honestly</h3>
 *
 * One real meter and three that report themselves as unmetered. `usage_records` holds 0 rows with
 * 0 producers and the NLQ counter has 0 keys; only the branch count is genuinely obtainable, via
 * the same user-service call the tier-downgrade check already trusts.
 *
 * The consuming component must render "Not metered" for those three rather than `0`. That is not a
 * placeholder to be filled in later with a nicer-looking number — a usage dashboard showing four
 * fabricated zeroes is worse than no dashboard, because capacity and billing decisions get made on
 * it. The honest empty state IS the feature.
 *
 * `staleTime` is short because these numbers move with tenant activity, and `retry: false` for the
 * same reason as the tenant list: a 403 is an answer, not a transient failure.
 */
export function useTenantUsage(tenantId: string) {
  return useQuery<TenantUsage>({
    queryKey: platformKeys.usage(tenantId),
    queryFn: () => PlatformRepository.getUsage(tenantId),
    enabled: Boolean(tenantId),
    staleTime: 30_000,
    retry: false,
  });
}
