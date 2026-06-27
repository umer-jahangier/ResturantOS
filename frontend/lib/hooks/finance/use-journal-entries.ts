"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FinanceRepository } from "@/lib/repositories/finance.repository";
import { queryKeys } from "@/lib/hooks/query-keys";
import type { JeFilters, CreateJeRequest } from "@/lib/models/finance.model";

export function useJournalEntries(filters?: JeFilters) {
  return useQuery({
    queryKey: queryKeys.finance.journalEntries(filters),
    queryFn: () => FinanceRepository.listJournalEntries(filters),
  });
}

export function useJournalEntry(id: string) {
  return useQuery({
    queryKey: queryKeys.finance.journalEntry(id),
    queryFn: () => FinanceRepository.getJournalEntry(id),
    enabled: !!id,
  });
}

export function useCreateJe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (req: CreateJeRequest) => FinanceRepository.createJournalEntry(req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["finance", "journal-entries"] });
    },
  });
}

export function usePostJe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => FinanceRepository.postJournalEntry(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.finance.journalEntry(id) });
      void queryClient.invalidateQueries({ queryKey: ["finance", "journal-entries"] });
    },
  });
}

export function useReverseJe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => FinanceRepository.reverseJournalEntry(id),
    onSuccess: (_data, id) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.finance.journalEntry(id) });
      void queryClient.invalidateQueries({ queryKey: ["finance", "journal-entries"] });
    },
  });
}
