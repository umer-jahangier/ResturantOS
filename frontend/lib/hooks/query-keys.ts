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
  // 08.2: branch-scoped inventory master-data/recipe/stock namespace. Publishes the registry
  // every hook in plans 08.2-12/13 must use; the local `const X_KEY` arrays in
  // use-inventory.ts stay in place until those plans migrate onto this registry.
  inventory: {
    ingredients: (branchId: string, filters?: { search?: string; categoryId?: string; status?: string }) =>
      ["inventory", branchId, "ingredients", filters] as const,
    ingredient: (branchId: string, id: string) => ["inventory", branchId, "ingredients", id] as const,
    categories: (branchId: string) => ["inventory", branchId, "categories"] as const,
    categoryTree: (branchId: string) => ["inventory", branchId, "categories", "tree"] as const,
    uoms: (branchId: string) => ["inventory", branchId, "uoms"] as const,
    menuItems: (branchId: string) => ["inventory", branchId, "menu-items"] as const,
    recipes: (branchId: string, filters?: { menuItemId?: string }) =>
      ["inventory", branchId, "recipes", filters] as const,
    recipeVersions: (branchId: string, menuItemId: string) =>
      ["inventory", branchId, "recipes", menuItemId, "versions"] as const,
    coverage: (branchId: string) => ["inventory", branchId, "coverage"] as const,
    stockLevels: (branchId: string, filters?: { ingredientId?: string; categoryId?: string }) =>
      ["inventory", branchId, "stock-levels", filters] as const,
    costPreview: (branchId: string, fingerprint: string) =>
      ["inventory", branchId, "cost-preview", fingerprint] as const,
  },
  // 08.2: branch-scoped purchasing vendor-catalog/PO namespace (parallels `inventory` above).
  purchasing: {
    vendors: (branchId: string, filters?: { search?: string; status?: string }) =>
      ["purchasing", branchId, "vendors", filters] as const,
    vendor: (branchId: string, id: string) => ["purchasing", branchId, "vendors", id] as const,
    vendorItems: (branchId: string, vendorId: string) =>
      ["purchasing", branchId, "vendors", vendorId, "items"] as const,
    vendorItem: (branchId: string, id: string) => ["purchasing", branchId, "vendor-items", id] as const,
    vendorItemPrices: (branchId: string, vendorItemId: string) =>
      ["purchasing", branchId, "vendor-items", vendorItemId, "prices"] as const,
    vendorCategories: (branchId: string) => ["purchasing", branchId, "vendor-categories"] as const,
    purchaseOrders: (branchId: string, filters?: { status?: string[] }) =>
      ["purchasing", branchId, "purchase-orders", filters] as const,
    purchaseOrder: (branchId: string, id: string) => ["purchasing", branchId, "purchase-orders", id] as const,
    invoices: (branchId: string, filters?: { status?: string[] }) =>
      ["purchasing", branchId, "invoices", filters] as const,
    spendAnalytics: (branchId: string, from?: string, to?: string) =>
      ["purchasing", branchId, "spend-analytics", from, to] as const,
    scorecard: (branchId: string, vendorId: string) =>
      ["purchasing", branchId, "scorecard", vendorId] as const,
  },
} as const;
