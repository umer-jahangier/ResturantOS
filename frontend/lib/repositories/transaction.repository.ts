import { get } from "@/lib/api-client/request";
import {
  adaptLinkedJournalEntry,
  adaptTransactionPage,
} from "@/lib/adapters/transaction.adapter";
import type {
  LinkedJournalEntry,
  TransactionFilters,
  TransactionRegisterPage,
} from "@/lib/models/transaction.model";

export const TransactionRepository = {
  async list(filters: TransactionFilters): Promise<TransactionRegisterPage> {
    const params = new URLSearchParams();
    params.set("from", filters.from);
    params.set("to", filters.to);
    if (filters.branchId) params.set("branchId", filters.branchId);
    if (filters.cashierId) params.set("cashierId", filters.cashierId);
    if (filters.tenderMethod) params.set("tenderMethod", filters.tenderMethod);
    (filters.eventKinds ?? []).forEach((k) => params.append("eventKinds", k));
    params.set("page", String(filters.page ?? 0));
    params.set("size", String(filters.size ?? 50));
    const raw = await get(`/api/v1/pos/transactions?${params.toString()}`);
    return adaptTransactionPage(raw);
  },

  /**
   * The journal entries an order produced (37-04). `resolveSource=true` so each entry carries the
   * human-readable order reference — one lookup serves the whole set, and this is a drill-down on
   * a single row rather than a per-row fan-out on the list.
   */
  async journalEntriesForOrder(orderId: string): Promise<LinkedJournalEntry[]> {
    const raw = await get<unknown[]>(
      `/api/v1/finance/journal-entries/by-source/${orderId}?resolveSource=true`,
    );
    return (raw as unknown[]).map(adaptLinkedJournalEntry);
  },
};
