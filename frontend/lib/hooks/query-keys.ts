// Branch-scoped TanStack Query key registry. Every server-state key embeds the
// branchId so a branch switch can invalidate cleanly (§P5.2.3, used by 04-02).
import type { AccountFilters, JeFilters } from "@/lib/models/finance.model";

export const queryKeys = {
  session: {
    current: () => ["session", "current"] as const,
  },
  features: {
    all: (branchId: string) => ["features", branchId] as const,
  },
  finance: {
    accounts: (filters?: AccountFilters) => ["finance", "accounts", filters] as const,
    account: (code: string) => ["finance", "accounts", code] as const,
    periods: (fiscalYear?: number) => ["finance", "periods", fiscalYear] as const,
    journalEntries: (filters?: JeFilters) => ["finance", "journal-entries", filters] as const,
    journalEntry: (id: string) => ["finance", "journal-entries", id] as const,
    gl: (periodId: string) => ["finance", "gl", periodId] as const,
  },
} as const;
