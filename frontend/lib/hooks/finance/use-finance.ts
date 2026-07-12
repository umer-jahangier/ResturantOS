"use client";

// FIN-05 (10-14): expense create/approve/reject + AP aging. Separate file from
// use-accounts/use-gl/use-journal-entries/use-periods per the plan's explicit
// file list — those files are untouched by this plan.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { CreateExpenseInput, Expense, ExpenseStatus } from "@/lib/models/finance.model";
// Type-only import — permitted from a lib/hooks/** file (ESLint layer-boundary
// rule only blocks components/**); pins TError to ApiError so components can
// branch on error.code (e.g. EXPENSE_APPROVAL_LIMIT_EXCEEDED) via TanStack's
// mutation-error type inference without importing api-client themselves.
import type { ApiError } from "@/lib/api-client/errors";

function invalidateExpenses(qc: ReturnType<typeof useQueryClient>, branchId: string) {
  void qc.invalidateQueries({ queryKey: ["finance", branchId, "expenses"] });
}

/** Branch-scoped expense list, optionally narrowed by status. Default consumer is an approver's inbox. */
export function useExpenses(status?: ExpenseStatus[]) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.expenses(branchId, status),
    queryFn: () => FinanceRepository.listExpenses(branchId, status),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useCreateExpense() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<Expense, ApiError, CreateExpenseInput>({
    mutationFn: (input) => FinanceRepository.createExpense(input),
    onSuccess: () => invalidateExpenses(queryClient, branchId),
  });
}

/**
 * PENDING_APPROVAL -> APPROVED, gated by OPA's approval-limit rule (10-05/10-07). A 403 here
 * carries `EXPENSE_APPROVAL_LIMIT_EXCEEDED` — components branch on `error.code`, never a
 * generic failure message, since the whole point of FIN-05 is that the limit is visible.
 */
export function useApproveExpense(id: string) {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<Expense, ApiError, void>({
    mutationFn: () => FinanceRepository.approveExpense(id),
    onSuccess: () => invalidateExpenses(queryClient, branchId),
  });
}

/** PENDING_APPROVAL -> REJECTED. `reason` is mandatory client- and server-side. */
export function useRejectExpense(id: string) {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation<Expense, ApiError, string>({
    mutationFn: (reason) => FinanceRepository.rejectExpense(id, reason),
    onSuccess: () => invalidateExpenses(queryClient, branchId),
  });
}

/** First frontend consumer of GET /api/v1/finance/ap/aging. */
export function useApAging(asOf?: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.apAging(branchId, asOf),
    queryFn: () => FinanceRepository.getApAging(branchId, asOf),
    enabled: isAuthenticated && !!branchId,
  });
}
