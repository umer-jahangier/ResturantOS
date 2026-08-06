"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { currentPakistanFiscalYear } from "@/lib/utils/pakistan-fiscal-year";
import type { ApiError } from "@/lib/errors";
import type { AccountingPeriod } from "@/lib/models/finance.model";

export function usePeriods(fiscalYear?: number) {
  const { branchId, isAuthenticated } = useCurrentUser();
  const fy = fiscalYear ?? currentPakistanFiscalYear();
  return useQuery({
    queryKey: queryKeys.finance.periods(branchId, fy),
    queryFn: () => FinanceRepository.listPeriods(fy),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useOpenPeriods() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.openPeriods(branchId),
    queryFn: () => FinanceRepository.listOpenPeriods(),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useClosePeriod() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  // Typed error, because the caller branches on it: a period close that comes back
  // TOTP_REQUIRED is a step-up prompt, not a failure.
  return useMutation<AccountingPeriod, ApiError, string>({
    mutationFn: (id: string) => FinanceRepository.closePeriod(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["finance", branchId, "periods"],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.finance.openPeriods(branchId),
      });
    },
  });
}

export function useProvisionPeriods() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: { fiscalYear: number }) => FinanceRepository.provisionPeriods(req.fiscalYear),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["finance", branchId, "periods"],
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.finance.openPeriods(branchId),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.finance.setupStatus(branchId),
      });
    },
  });
}
