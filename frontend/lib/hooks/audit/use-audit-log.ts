"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { AuditRepository } from "@/lib/repositories/audit.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useBranchSettings } from "@/lib/hooks/use-tenant-settings";
import type { AuditEventFilters } from "@/lib/models/audit.model";

/**
 * The zone the audit screen cuts its days in, and renders its timestamps in.
 *
 * <p>Read from the BRANCH record (`GET /api/v1/branches/{id}`, open to any authenticated user), not
 * from the browser. PROJECT.md's rule is that business dates are cut on the branch timezone, and the
 * Takings screen is the standing example of what happens when they are not: every sale in the five
 * hours after 04:00 local landed on the previous day and the screen showed a zero it did not mean.
 *
 * <p>`null` while the branch is still loading, or if it has no timezone stored. The screen must then
 * say which zone it IS using rather than silently using the viewer's — a timestamp with no stated
 * zone is the same lie in a smaller font.
 */
export function useBranchTimeZone(): { zone: string | null; isLoading: boolean } {
  const { branchId } = useCurrentUser();
  const branch = useBranchSettings(branchId || null);
  return {
    zone: branch.data?.timezone?.trim() || null,
    isLoading: branch.isPending && Boolean(branchId),
  };
}

/**
 * One page of the tenant's audit trail.
 *
 * <p>`placeholderData: keepPreviousData` so pressing Next does not blank the table back to a
 * skeleton and lose the reader's place. The pager shows the page it is fetching; the rows update
 * underneath it.
 *
 * <p>`retry: false` for the same reason the health screen sets it: a 403 on this endpoint is a
 * refusal, not a blip, and three silent retries before showing it turns "you may not read this"
 * into several seconds of a spinner. `QueryBoundary` renders the refusal with its own copy.
 *
 * <p>`enabled` is false until the branch zone is known. Firing the query first would read the day
 * boundary in UTC and then re-read it — showing the reader one set of rows and then a different set
 * with no explanation, which on an audit log is worse than a moment of loading.
 */
export function useAuditEvents(filters: AuditEventFilters, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.audit.events(filters),
    queryFn: () => AuditRepository.listEvents(filters),
    enabled: options?.enabled ?? true,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/**
 * The filter vocabulary this tenant's rows actually contain.
 *
 * <p>Deliberately keyed on the date window only, not on the selected action or resource type: the
 * options must not narrow as you pick one, or choosing "ORDER_VOIDED" would leave that as the only
 * option in the list and there would be no way back.
 */
export function useAuditFacets(
  window: Pick<AuditEventFilters, "from" | "to" | "zone">,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: queryKeys.audit.facets(window),
    queryFn: () => AuditRepository.getFacets(window),
    enabled: options?.enabled ?? true,
    retry: false,
    staleTime: 60_000,
  });
}
