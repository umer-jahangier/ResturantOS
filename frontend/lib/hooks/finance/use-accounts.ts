"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { useDebouncedValue } from "@/lib/hooks/use-debounced-value";
import type { AccountFilters } from "@/lib/models/finance.model";

export function useAccounts(filters?: AccountFilters) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.accounts(branchId, filters),
    queryFn: () => FinanceRepository.listAccounts(filters),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useAccount(code: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.account(branchId, code),
    queryFn: () => FinanceRepository.getAccount(code),
    enabled: isAuthenticated && !!branchId && !!code,
  });
}

export function useAccountSearch(query: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  const debouncedQuery = useDebouncedValue(query.trim(), 300);
  return useQuery({
    queryKey: queryKeys.finance.accountSearch(branchId, debouncedQuery),
    queryFn: () => FinanceRepository.searchAccounts(debouncedQuery),
    enabled: isAuthenticated && !!branchId && debouncedQuery.length >= 1,
  });
}

export function useFinanceSetupStatus() {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.setupStatus(branchId),
    queryFn: () => FinanceRepository.getSetupStatus(),
    enabled: isAuthenticated && !!branchId,
  });
}
