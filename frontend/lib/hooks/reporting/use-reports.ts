"use client";

import { useQuery } from "@tanstack/react-query";
import { ReportingRepository } from "@/lib/repositories/reporting.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { FbrTaxSummaryParams, ReportRunParams } from "@/lib/models/reporting.model";

/** RPT-01: the named-report catalog. Not branch-scoped — every branch sees the same catalog. */
export function useReports() {
  return useQuery({
    queryKey: queryKeys.reporting.reports(),
    queryFn: () => ReportingRepository.listReports(),
  });
}

/** RPT-01: run a named report over a date range, optionally scoped to a branch. */
export function useRunReport(code: string, params: ReportRunParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.reporting.reportRun(params.branchId, code, params.from, params.to),
    queryFn: () => ReportingRepository.runReport(code, params),
    enabled: (options?.enabled ?? true) && Boolean(code) && Boolean(params.from) && Boolean(params.to),
  });
}

/** RPT-01: FBR Tax Summary — output tax vs input tax vs (possibly negative) net payable. */
export function useFbrTaxSummary(params: FbrTaxSummaryParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.reporting.fbrTaxSummary(params.branchId, params.from, params.to),
    queryFn: () => ReportingRepository.fbrTaxSummary(params),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(params.branchId) &&
      Boolean(params.from) &&
      Boolean(params.to),
  });
}

/**
 * RPT-02: the REST snapshot of dashboard tiles — paints the realtime dashboard instantly before
 * `useDashboardSocket` takes over on the SAME cache key (queryKeys.reporting.dashboardTiles).
 */
export function useDashboardTiles(branchId: string) {
  return useQuery({
    queryKey: queryKeys.reporting.dashboardTiles(branchId),
    queryFn: () => ReportingRepository.dashboardTiles(branchId),
    enabled: Boolean(branchId),
  });
}
