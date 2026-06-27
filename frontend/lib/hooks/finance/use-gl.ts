"use client";

import { useQuery } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";

export function useGlBalances(periodId: string) {
  return useQuery({
    queryKey: queryKeys.finance.gl(periodId),
    queryFn: () => FinanceRepository.getGlBalances(periodId),
    enabled: !!periodId,
  });
}
