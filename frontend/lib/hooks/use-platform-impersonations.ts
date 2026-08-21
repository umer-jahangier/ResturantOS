"use client";

import { useQuery } from "@tanstack/react-query";

import { PlatformRepository } from "@/lib/repositories/platform.repository";
import type { ImpersonationPage } from "@/lib/models/platform.model";

/**
 * Layer-3 hooks for the impersonation audit (the SuperAdmin read path).
 *
 * <h3>Keys live here, not in the shared registry</h3>
 *
 * Same reason as `use-platform-tenants.ts`: the shared registry embeds a `branchId` in every key,
 * and a platform session has no branch and no tenant. Threading a `""` through it to satisfy its
 * shape would be a lie in the one place the codebase uses to reason about scope.
 *
 * <h3>Why these are not cached for long</h3>
 *
 * An impersonation session's status is time-derived (ACTIVE until `expires_at` passes), so a page
 * left open silently ages into being wrong. A 30-second `staleTime` keeps an idle console honest
 * without polling: the operator's next interaction refetches. Nothing here recomputes the status
 * client-side to "fix" a stale page — that would replace one wrong answer with a different one.
 */
export const impersonationKeys = {
  all: () => ["platform", "impersonations"] as const,
  forTenant: (tenantId: string, page: number) =>
    ["platform", "tenants", tenantId, "impersonations", page] as const,
  search: (
    adminUserId: string | undefined,
    from: string | undefined,
    to: string | undefined,
    page: number,
  ) => ["platform", "impersonations", { adminUserId, from, to, page }] as const,
};

const STALE_MS = 30_000;

/**
 * One tenant's impersonation history.
 *
 * `retry: false` for the same reason the tenant hooks use it, plus one specific to this endpoint:
 * an unknown tenant is a 404, and retrying a 404 three times only delays an honest "no such
 * tenant" behind a spinner that implies something is still loading.
 */
export function useTenantImpersonations(tenantId: string, page = 0) {
  return useQuery<ImpersonationPage>({
    queryKey: impersonationKeys.forTenant(tenantId, page),
    queryFn: () => PlatformRepository.listTenantImpersonations(tenantId, page),
    enabled: Boolean(tenantId),
    staleTime: STALE_MS,
    retry: false,
  });
}

/** Impersonations across every tenant, optionally narrowed to one acting administrator. */
export function usePlatformImpersonations(
  params: {
    adminUserId?: string;
    from?: string;
    to?: string;
    page?: number;
  } = {},
) {
  const page = params.page ?? 0;
  return useQuery<ImpersonationPage>({
    queryKey: impersonationKeys.search(params.adminUserId, params.from, params.to, page),
    queryFn: () =>
      PlatformRepository.listImpersonations({
        adminUserId: params.adminUserId,
        from: params.from,
        to: params.to,
        page,
      }),
    staleTime: STALE_MS,
    retry: false,
  });
}
