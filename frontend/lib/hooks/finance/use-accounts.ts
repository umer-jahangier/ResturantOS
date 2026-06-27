"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
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

export function useCreateJournalEntry() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: FinanceRepository.createJournalEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["finance", branchId, "journal-entries"],
      });
    },
  });
}
