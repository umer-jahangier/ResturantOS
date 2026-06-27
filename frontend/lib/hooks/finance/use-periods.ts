"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";

export function usePeriods(fiscalYear?: number) {
  return useQuery({
    queryKey: queryKeys.finance.periods(fiscalYear),
    queryFn: () => FinanceRepository.listPeriods(fiscalYear),
  });
}

export function useClosePeriod() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, totpCode }: { id: string; totpCode: string }) =>
      FinanceRepository.closePeriod(id, totpCode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "periods"] });
    },
  });
}
