// Branch-scoped TanStack Query key registry. Every server-state key embeds the
// branchId so a branch switch can invalidate cleanly (§P5.2.3, used by 04-02).
// Finance keys include branchId as the second segment so that
// `queryClient.invalidateQueries({ queryKey: ["finance", branchId] })` nukes
// all finance data for a specific branch without touching other branches.
import type { AccountFilters, JeFilters } from "@/lib/models/finance.model";

export const queryKeys = {
  session: {
    current: () => ["session", "current"] as const,
  },
  features: {
    all: (branchId: string) => ["features", branchId] as const,
  },
  finance: {
    accounts: (branchId: string, filters?: AccountFilters) =>
      ["finance", branchId, "accounts", filters] as const,
    account: (branchId: string, code: string) =>
      ["finance", branchId, "accounts", code] as const,
    periods: (branchId: string, fiscalYear?: number) =>
      ["finance", branchId, "periods", fiscalYear] as const,
    journalEntries: (branchId: string, filters?: JeFilters) =>
      ["finance", branchId, "journal-entries", filters] as const,
    journalEntry: (branchId: string, id: string) =>
      ["finance", branchId, "journal-entries", id] as const,
    gl: (branchId: string, periodId: string) =>
      ["finance", branchId, "gl", periodId] as const,
  },
} as const;
