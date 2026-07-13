"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { currentPakistanFiscalYear } from "@/lib/utils/pakistan-fiscal-year";

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
  return useMutation({
    mutationFn: ({ id, totpCode }: { id: string; totpCode: string }) =>
      FinanceRepository.closePeriod(id, totpCode),
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
    mutationFn: (req: { fiscalYear: number }) =>
      FinanceRepository.provisionPeriods(req.fiscalYear),
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
