"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { TakingsRepository } from "@/lib/repositories/takings.repository";

/**
 * The day's takings, reconciled against what each till counted (37-09 / 37-12).
 *
 * <h3>It does not poll, and that is deliberate</h3>
 *
 * RestaurantOS runs in a datacentre and every branch reaches it over the public internet. A cash-up
 * screen left open on a back-office monitor all evening would, at a 30-second interval, be ~2,900
 * aggregate queries per branch per night for a number that changes when a till closes — a few times
 * a day. The date control and the browser's own reload are the refresh; a stale figure here is
 * corrected by the act of looking again, which is what someone cashing up does anyway.
 *
 * `staleTime` is a minute so tabbing between Takings and Transactions does not re-run the
 * aggregate, while a deliberate revisit still gets fresh figures.
 */
/**
 * Pass `null` (or nothing) for `date` to get the CURRENT TRADING DAY as the server reckons it.
 *
 * The screen used to seed itself with `new Date().toISOString().slice(0,10)`. The trading day is
 * `(now − 4h)`, so from midnight until 04:00 UTC that lands on a day the restaurant has not
 * started yet, and the cash-up screen opened on an empty page while the drawer was full. The date
 * is now a server fact — `data.businessDate` — and the input is seeded from it.
 */
export function useDailyTakings(date: string | null, branchId?: string) {
  const { branchId: currentBranchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.takings.daily(currentBranchId, `${date ?? "current"}:${branchId ?? "all"}`),
    queryFn: () => TakingsRepository.daily(date, branchId),
    enabled: isAuthenticated && !!currentBranchId,
    staleTime: 60_000,
  });
}
