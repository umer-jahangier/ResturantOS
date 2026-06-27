"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import type { JeFilters, CreateJeRequest } from "@/lib/models/finance.model";

export function useJournalEntries(filters?: JeFilters) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.journalEntries(branchId, filters),
    queryFn: () => FinanceRepository.listJournalEntries(filters),
    enabled: isAuthenticated && !!branchId,
  });
}

export function useJournalEntry(id: string) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.finance.journalEntry(branchId, id),
    queryFn: () => FinanceRepository.getJournalEntry(id),
    enabled: isAuthenticated && !!branchId && !!id,
  });
}

export function useCreateJe() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateJeRequest) => FinanceRepository.createJournalEntry(req),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["finance", branchId, "journal-entries"],
      });
    },
  });
}

export function usePostJe() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => FinanceRepository.postJournalEntry(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.finance.journalEntry(branchId, id),
      });
      void queryClient.invalidateQueries({
        queryKey: ["finance", branchId, "journal-entries"],
      });
    },
  });
}

export function useReverseJe() {
  const { branchId } = useCurrentUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => FinanceRepository.reverseJournalEntry(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.finance.journalEntry(branchId, id),
      });
      void queryClient.invalidateQueries({
        queryKey: ["finance", branchId, "journal-entries"],
      });
    },
  });
}
