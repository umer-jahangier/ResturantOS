// Branch-scoped TanStack Query key registry. Every server-state key embeds the
// branchId so a branch switch can invalidate cleanly (§P5.2.3, used by 04-02).
// Finance keys include branchId as the second segment so that
// `queryClient.invalidateQueries({ queryKey: ["finance", branchId] })` nukes
// all finance data for a specific branch without touching other branches.
import type { AccountFilters, ExpenseStatus, JeFilters } from "@/lib/models/finance.model";

export const queryKeys = {
  session: {
    current: () => ["session", "current"] as const,
  },
  features: {
    all: (branchId: string) => ["features", branchId] as const,
  },
  branches: {
    mine: () => ["branches", "mine"] as const,
  },
  pos: {
    menuCategories: (branchId: string) => ["pos", branchId, "menu-categories"] as const,
    menuItems: (branchId: string, categoryId?: string) =>
      ["pos", branchId, "menu-items", categoryId] as const,
    tables: (branchId: string) => ["pos", branchId, "tables"] as const,
    tableDetail: (branchId: string, tableId: string) =>
      ["pos", branchId, "tables", tableId, "active-order"] as const,
    orders: (branchId: string, statuses?: string[]) =>
      ["pos", branchId, "orders", statuses] as const,
    orderSummaries: (branchId: string, statuses?: string[]) =>
      ["pos", branchId, "order-summaries", statuses] as const,
    order: (branchId: string, id: string) => ["pos", branchId, "orders", id] as const,
    orderPayments: (branchId: string, orderId: string) =>
      ["pos", branchId, "orders", orderId, "payments"] as const,
    till: (tillId: string) => ["pos", "tills", tillId] as const,
    activeTill: (cashierId: string) => ["pos", "tills", "active", cashierId] as const,
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
    accountSearch: (branchId: string, query: string) =>
      ["finance", branchId, "accounts", "search", query] as const,
    openPeriods: (branchId: string) =>
      ["finance", branchId, "periods", "open"] as const,
    setupStatus: (branchId: string) =>
      ["finance", branchId, "setup", "status"] as const,
    expenses: (branchId: string, status?: ExpenseStatus[]) =>
      ["finance", branchId, "expenses", status] as const,
    apAging: (branchId: string, asOf?: string) =>
      ["finance", branchId, "ap-aging", asOf] as const,
    customerAccounts: (branchId: string, page?: number) =>
      ["finance", branchId, "customer-accounts", page] as const,
    customerAccountStatement: (branchId: string, id: string) =>
      ["finance", branchId, "customer-accounts", id, "statement"] as const,
    arAging: (branchId: string, asOf?: string) =>
      ["finance", branchId, "ar-aging", asOf] as const,
  },
  kds: {
    tickets: (branchId: string, stationCode?: string, status?: string) =>
      ["kds", branchId, "tickets", stationCode, status] as const,
    ticketDetail: (branchId: string, ticketId: string) =>
      ["kds", branchId, "tickets", ticketId] as const,
    stations: (branchId: string) => ["kds", branchId, "stations"] as const,
  },
} as const;
