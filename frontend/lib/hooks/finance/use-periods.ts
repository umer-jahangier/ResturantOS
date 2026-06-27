"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

export function usePeriods(fiscalYear?: number) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.periods(branchId, fiscalYear),
    queryFn: () => FinanceRepository.listPeriods(fiscalYear),
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
    },
  });
}
