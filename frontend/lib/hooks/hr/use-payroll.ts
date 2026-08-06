"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HrRepository } from "@/lib/repositories/hr.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { ApiError } from "@/lib/api-client/errors";
import type { LabourCostByBranch, PayrollRun, Payslip } from "@/lib/models/hr.model";

// Layer-3 payroll hooks (HR-03). Every state transition (create/calculate/approve/pay)
// invalidates the whole `["hr", branchId, "payroll-runs"]` prefix rather than a single
// run: a transition rewrites the run's status AND its totals, and the payslip rows hang
// off the same prefix, so the expanded detail must refresh alongside the list.

export function usePayrollRuns() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<PayrollRun[], ApiError>({
    queryKey: queryKeys.hr.payrollRuns(branchId),
    queryFn: () => HrRepository.listRuns(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function usePayrollRun(id: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<PayrollRun, ApiError>({
    queryKey: queryKeys.hr.payrollRun(branchId, id),
    queryFn: () => HrRepository.getRun(id),
    enabled: isAuthenticated && !!branchId && !!id,
  });
}

/** Payslips for one run. `enabled` is false until a run is expanded, so nothing is fetched up front. */
export function usePayslips(runId: string | null) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery<Payslip[], ApiError>({
    queryKey: queryKeys.hr.payslips(branchId, runId ?? ""),
    queryFn: () => HrRepository.listPayslips(runId ?? ""),
    enabled: isAuthenticated && !!branchId && !!runId,
  });
}

/**
 * Labour cost for the branch a run belongs to. `targetBranchId` is the RUN's branch,
 * which is not necessarily the viewer's active branch — hence its own key segment.
 */
export function useLabourCost(
  targetBranchId: string | null,
  month: number | null,
  year: number | null,
) {
  const { branchId, isAuthenticated } = useCurrentUser();
  const enabled =
    isAuthenticated && !!branchId && !!targetBranchId && month != null && year != null;
  return useQuery<LabourCostByBranch, ApiError>({
    queryKey: queryKeys.hr.labourCost(branchId, targetBranchId ?? "", month ?? 0, year ?? 0),
    queryFn: () => HrRepository.labourCostByBranch(targetBranchId ?? "", month ?? 0, year ?? 0),
    enabled,
  });
}

function usePayrollRunMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<PayrollRun>,
) {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<PayrollRun, ApiError, TVariables>({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns(branchId) });
    },
  });
}

export function useCreatePayrollRun() {
  return usePayrollRunMutation(({ month, year }: { month: number; year: number }) =>
    HrRepository.createRun(month, year),
  );
}

export function useCalculatePayrollRun() {
  return usePayrollRunMutation((id: string) => HrRepository.calculateRun(id));
}

export function useApprovePayrollRun() {
  return usePayrollRunMutation((id: string) => HrRepository.approveRun(id));
}

export function usePayPayrollRun() {
  return usePayrollRunMutation((id: string) => HrRepository.payRun(id));
}
