"use client";

import { useQuery } from "@tanstack/react-query";

import { PlatformOverviewRepository } from "@/lib/repositories/platform-overview.repository";
import type {
  AnalyticsOverview,
  DirectorySummary,
  SubscriptionRegister,
  SystemHealth,
} from "@/lib/models/platform-overview.model";

/**
 * Layer-3 hooks for the platform overview.
 *
 * <h3>Query keys are not branch-scoped, and cannot be</h3>
 *
 * `lib/hooks/query-keys.ts` embeds a `branchId` in every key so a branch switch invalidates
 * cleanly. A platform session has neither a branch nor a tenant — both claims are null on a
 * control-plane token, which is why the gateway maintains `TENANT_OPTIONAL_PATHS`. Threading a
 * `""` through that registry to satisfy its shape would put a lie in the one structure the
 * codebase uses to reason about scope. So these keys extend `platformKeys` in
 * `use-platform-tenants.ts` by convention (`["platform", …]`) and are declared beside their
 * consumers.
 *
 * <h3>`retry: false`, everywhere here</h3>
 *
 * A 403 on `/api/v1/platform/**` means the principal is not a SuperAdmin. That is an answer, not
 * a transient failure, and retrying it three times only delays an honest error behind a spinner
 * that implies something is still loading.
 */
export const platformOverviewKeys = {
  analytics: () => ["platform", "analytics", "overview"] as const,
  systemHealth: () => ["platform", "system", "health"] as const,
  subscriptions: () => ["platform", "subscriptions", "register"] as const,
  directorySummary: () => ["platform", "users", "summary"] as const,
};

/**
 * Tenant population, lifecycle counts, entitlement dates — and the itemised list of what this
 * platform cannot compute.
 *
 * <p>One database query behind it, so it is cheap enough to keep fresh. `staleTime` is a minute
 * because tenant counts move with operator actions, not with traffic.
 */
export function usePlatformAnalyticsOverview() {
  return useQuery<AnalyticsOverview>({
    queryKey: platformOverviewKeys.analytics(),
    queryFn: () => PlatformOverviewRepository.getAnalyticsOverview(),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * The fleet's health, probed live on every request.
 *
 * <p>`staleTime: 0`. A status page served from a cache is a status page reporting the past, and
 * the moment it matters is the moment the past is wrong — the backend refuses to cache it for
 * exactly this reason and a client-side cache would put the behaviour straight back.
 *
 * <p>`refetchInterval` is deliberately NOT set. This surface is one card on a landing page, not a
 * wall board; a poll here would probe every actuator in the fleet on a timer for a reader who has
 * walked away. The card offers a refresh instead, which is the same information on demand.
 */
export function usePlatformSystemHealth() {
  return useQuery<SystemHealth>({
    queryKey: platformOverviewKeys.systemHealth(),
    queryFn: () => PlatformOverviewRepository.getSystemHealth(),
    staleTime: 0,
    retry: false,
  });
}

/** Plan mix, trials, renewals and cancellations across every tenant. */
export function usePlatformSubscriptionRegister() {
  return useQuery<SubscriptionRegister>({
    queryKey: platformOverviewKeys.subscriptions(),
    queryFn: () => PlatformOverviewRepository.getSubscriptionRegister(),
    staleTime: 60_000,
    retry: false,
  });
}

/**
 * Fleet headcount and active headcount, each with the scan that produced it.
 *
 * <p><b>This is the most expensive read on the page and the settings say so.</b> Each of its two
 * requests fans out one internal HTTP call per tenant — there is no cross-tenant user query in
 * this product — so a five-minute `staleTime` and no refocus refetch are not tuning, they are the
 * difference between a landing page and a load generator. The figures move when accounts are
 * created or deactivated, which is not a per-minute event.
 */
export function usePlatformDirectorySummary() {
  return useQuery<DirectorySummary>({
    queryKey: platformOverviewKeys.directorySummary(),
    queryFn: () => PlatformOverviewRepository.getDirectorySummary(),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
