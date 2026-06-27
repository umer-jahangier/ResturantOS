"use client";

import { useQuery } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";

export function useGlBalances(periodId: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.gl(branchId, periodId),
    queryFn: () => FinanceRepository.getGlBalances(periodId),
    enabled: isAuthenticated && !!branchId && !!periodId,
  });
}
