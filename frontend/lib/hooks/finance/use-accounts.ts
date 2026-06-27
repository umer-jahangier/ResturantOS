"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { AccountFilters } from "@/lib/models/finance.model";

export function useAccounts(filters?: AccountFilters) {
  return useQuery({
    queryKey: queryKeys.finance.accounts(filters),
    queryFn: () => FinanceRepository.listAccounts(filters),
  });
}

export function useAccount(code: string) {
  return useQuery({
    queryKey: queryKeys.finance.account(code),
    queryFn: () => FinanceRepository.getAccount(code),
    enabled: !!code,
  });
}

export function useCreateJournalEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: FinanceRepository.createJournalEntry,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "journal-entries"] });
    },
  });
}
