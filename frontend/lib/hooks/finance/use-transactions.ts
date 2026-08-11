"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/hooks/query-keys";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { TransactionRepository } from "@/lib/repositories/transaction.repository";
import type { TransactionFilters } from "@/lib/models/transaction.model";

/** The transaction register (37-08 / 37-11). */
export function useTransactionRegister(filters: TransactionFilters) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.transactions.register(branchId, filters),
    queryFn: () => TransactionRepository.list(filters),
    enabled: isAuthenticated && !!branchId && !!filters.from && !!filters.to,
  });
}

/**
 * The journal entries one order produced (37-04).
 *
 * `enabled` is the load-on-demand switch: the register renders up to 200 rows and an eager fetch
 * per row would be 200 calls to decorate a table nobody has asked a question of yet. The row's
 * expander flips this on.
 */
export function useOrderJournalEntries(orderId: string | null) {
  const { branchId, isAuthenticated } = useCurrentUser();
  return useQuery({
    queryKey: queryKeys.transactions.journalEntries(branchId, orderId ?? ""),
    queryFn: () => TransactionRepository.journalEntriesForOrder(orderId as string),
    enabled: isAuthenticated && !!branchId && !!orderId,
  });
}
