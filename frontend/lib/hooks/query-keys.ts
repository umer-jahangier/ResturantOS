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
  // S1-09: fleet health. Deliberately NOT branch-scoped and not tenant-scoped — which services
  // are answering is a fact about the deployment, and there is no per-branch version of it. A
  // branch switch must not invalidate it, because the operator watching a service come back up
  // is watching one thing and must not have it reset underneath them.
  ops: {
    fleetHealth: () => ["ops", "fleet-health"] as const,
  },
  // F4: the tenant audit trail. Deliberately NOT branch-scoped — audit_events is scoped to the
  // TENANT and a single read returns rows from every branch (that is the point: "who granted that
  // role" is not a question about one restaurant). Keying it on branchId would make a branch switch
  // silently show a different, wrong slice of the same log, and would invalidate a screen an
  // administrator is reading for reasons that have nothing to do with which till they are near.
  audit: {
    all: () => ["audit"] as const,
    // Filters are the last segment so the prefix above invalidates every combination at once.
    events: (filters: unknown) => ["audit", "events", filters] as const,
    facets: (window: unknown) => ["audit", "facets", window] as const,
  },
  // 37-11: the transaction register. Branch-scoped like the rest of the money keys, so a branch
  // switch invalidates it cleanly rather than showing the previous branch's takings.
  transactions: {
    all: (branchId: string) => ["transactions", branchId] as const,
    register: (branchId: string, filters: unknown) =>
      ["transactions", branchId, "register", filters] as const,
    journalEntries: (branchId: string, orderId: string) =>
      ["transactions", branchId, "journal-entries", orderId] as const,
  },
  // 37-12: the evening cash-up. Branch-scoped for the same reason as the register above — a
  // branch switch must not leave last branch's takings on screen while the new ones load.
  takings: {
    all: (branchId: string) => ["takings", branchId] as const,
    daily: (branchId: string, date: string) => ["takings", branchId, "daily", date] as const,
  },
  // CRM keys are NOT branch-scoped: a customer and their loyalty balance belong to the tenant,
  // and follow them between branches.
  crm: {
    all: () => ["crm"] as const,
    customerSearch: (q: string) => ["crm", "customers", "search", q] as const,
    customer: (id: string) => ["crm", "customers", id] as const,
    promotions: () => ["crm", "promotions"] as const,
  },
  pos: {
    /**
     * The tenant's sales-tax catalogue (F16). Deliberately NOT branch-keyed: a sales-tax rate is
     * a jurisdiction fact for the tenant, and keying it by branch would refetch the same rows on
     * every branch switch and imply a per-branch answer the server does not have.
     */
    taxClasses: () => ["pos", "tax-classes"] as const,
    /**
     * A branch's service-charge policy (F20). Branch-keyed, unlike the tax catalogue above and
     * for the mirror-image reason: a service charge pays for table service in ONE dining room,
     * so a rooftop with waiters and a takeaway counter in the same tenant must be able to hold
     * different answers.
     */
    serviceCharge: (branchId: string) => ["pos", branchId, "service-charge"] as const,
    menuCategories: (branchId: string) => ["pos", branchId, "menu-categories"] as const,
    menuItems: (branchId: string, categoryId?: string) =>
      ["pos", branchId, "menu-items", categoryId] as const,
    /**
     * The modifier CATALOGUE (S6). Two keys, because they are two different answers.
     *
     * `modifierCatalogue` is the till's read — every ACTIVE group in the tenant, loaded once
     * beside the menu so a tap opens the configure dialog with no network round trip inside it.
     * NOT branch-keyed: a dish's spice levels are a tenant fact, like its tax class and unlike
     * its price, which a branch may override.
     *
     * `modifierGroupsAdmin` is the manage screen's read for ONE dish and includes RETIRED groups
     * and retired options. It is deliberately a separate key rather than a view of the first:
     * sharing one would let a manager's admin response — retired rows and all — be served to the
     * till, offering a cashier an option the restaurant has withdrawn. The same reasoning
     * `tablesAdmin` records one block below.
     */
    modifierCatalogue: () => ["pos", "modifier-catalogue"] as const,
    modifierGroupsAdmin: (menuItemId: string) =>
      ["pos", "modifier-groups", "admin", menuItemId] as const,
    menuCategoriesAdmin: (branchId: string) =>
      ["pos", branchId, "menu-categories", "admin"] as const,
    menuItemsAdmin: (branchId: string, categoryId?: string) =>
      ["pos", branchId, "menu-items", "admin", categoryId] as const,
    tables: (branchId: string) => ["pos", branchId, "tables"] as const,
    // Distinct key, and a PREFIX of `tables` so invalidating the latter refreshes both. The
    // catalogue view returns a strict superset (retired tables included) and is gated on a
    // permission the service-time list is not — sharing one key would let a manager's catalogue
    // response be served to the picker, showing retired tables as selectable.
    tablesAdmin: (branchId: string) => ["pos", branchId, "tables", "admin"] as const,
    tableDetail: (branchId: string, tableId: string) =>
      ["pos", branchId, "tables", tableId, "active-order"] as const,
    orders: (branchId: string, statuses?: string[]) =>
      ["pos", branchId, "orders", statuses] as const,
    // `q` (S0-05) is part of the key: a search is a DIFFERENT server query, not a view of
    // the unsearched one. Sharing a key would serve the last search's rows to the next term.
    // It stays last so the existing prefix-match invalidations (["pos", branchId,
    // "order-summaries"]) keep clearing every variant.
    orderSummaries: (branchId: string, statuses?: string[], q?: string) =>
      ["pos", branchId, "order-summaries", statuses, q ?? null] as const,
    order: (branchId: string, id: string) => ["pos", branchId, "orders", id] as const,
    orderPayments: (branchId: string, orderId: string) =>
      ["pos", branchId, "orders", orderId, "payments"] as const,
    till: (tillId: string) => ["pos", "tills", tillId] as const,
    activeTill: (cashierId: string) => ["pos", "tills", "active", cashierId] as const,
    /** Page/size are trailing segments so a partial match on the prefix invalidates every page. */
    branchTills: (branchId: string, page: number, size: number) =>
      ["pos", "tills", "branch", branchId, page, size] as const,
    branchTillsAll: (branchId: string) => ["pos", "tills", "branch", branchId] as const,
    tillReconciliation: (tillId: string) => ["pos", "till-reconciliation", tillId] as const,
    tillReviewActions: (tillId: string) => ["pos", "tills", tillId, "review-actions"] as const,
  },
  finance: {
    accounts: (branchId: string, filters?: AccountFilters) =>
      ["finance", branchId, "accounts", filters] as const,
    account: (branchId: string, code: string) => ["finance", branchId, "accounts", code] as const,
    periods: (branchId: string, fiscalYear?: number) =>
      ["finance", branchId, "periods", fiscalYear] as const,
    journalEntries: (branchId: string, filters?: JeFilters) =>
      ["finance", branchId, "journal-entries", filters] as const,
    journalEntry: (branchId: string, id: string) =>
      ["finance", branchId, "journal-entries", id] as const,
    gl: (branchId: string, periodId: string) => ["finance", branchId, "gl", periodId] as const,
    accountSearch: (branchId: string, query: string) =>
      ["finance", branchId, "accounts", "search", query] as const,
    openPeriods: (branchId: string) => ["finance", branchId, "periods", "open"] as const,
    setupStatus: (branchId: string) => ["finance", branchId, "setup", "status"] as const,
    expenses: (branchId: string, status?: ExpenseStatus[]) =>
      ["finance", branchId, "expenses", status] as const,
    apAging: (branchId: string, asOf?: string) => ["finance", branchId, "ap-aging", asOf] as const,
    customerAccounts: (branchId: string, page?: number) =>
      ["finance", branchId, "customer-accounts", page] as const,
    customerAccountStatement: (branchId: string, id: string) =>
      ["finance", branchId, "customer-accounts", id, "statement"] as const,
    arAging: (branchId: string, asOf?: string) => ["finance", branchId, "ar-aging", asOf] as const,
  },
  // HR-01..05. Branch-scoped like finance/inventory: the HR endpoints take no branch in
  // the path (the gateway adds the header) but every list they return is the ACTIVE
  // branch's, so a branch switch must not serve the previous branch's roster from cache.
  // `labourCost` additionally carries the branch being reported on, which is the payroll
  // run's branch and not necessarily the viewer's.
  hr: {
    employees: (branchId: string) => ["hr", branchId, "employees"] as const,
    payrollRuns: (branchId: string) => ["hr", branchId, "payroll-runs"] as const,
    payrollRun: (branchId: string, id: string) => ["hr", branchId, "payroll-runs", id] as const,
    /** Nested under the run so approving/paying a run invalidates its payslips too. */
    payslips: (branchId: string, runId: string) =>
      ["hr", branchId, "payroll-runs", runId, "payslips"] as const,
    labourCost: (branchId: string, targetBranchId: string, month: number, year: number) =>
      ["hr", branchId, "labour-cost", targetBranchId, month, year] as const,
    weekGrid: (branchId: string, weekStart: string) =>
      ["hr", branchId, "shifts", "week", weekStart] as const,
    /** Prefix for every week — an assign/move/create invalidates all cached weeks. */
    shifts: (branchId: string) => ["hr", branchId, "shifts"] as const,
    attendancePunches: (branchId: string, employeeId: string, date: string) =>
      ["hr", branchId, "attendance", employeeId, "punches", date] as const,
    attendanceSummary: (branchId: string, employeeId: string, date: string) =>
      ["hr", branchId, "attendance", employeeId, "summary", date] as const,
    attendance: (branchId: string) => ["hr", branchId, "attendance"] as const,
    quarantine: (branchId: string) => ["hr", branchId, "attendance", "quarantine"] as const,
    leaveTypes: (branchId: string) => ["hr", branchId, "leave", "types"] as const,
    leaveBalances: (branchId: string, employeeId: string) =>
      ["hr", branchId, "leave", "balances", employeeId] as const,
    leave: (branchId: string) => ["hr", branchId, "leave"] as const,
    /**
     * HR configuration is TENANT-scoped, not branch-scoped, so these keys deliberately carry no
     * branchId. 35-02 put no `branch_id` on `departments` or `designations`: the list belongs to
     * the tenant, and per-branch copies would make a four-location owner retype it four times and
     * let the copies drift. Keying by branch here would refetch the same rows per branch and, worse,
     * make a department created at one branch invisible at another until its cache expired.
     */
    config: () => ["hr", "config"] as const,
    departments: () => ["hr", "config", "departments"] as const,
    designations: () => ["hr", "config", "designations"] as const,
    taxConfigs: () => ["hr", "config", "tax"] as const,
    taxConfig: (fiscalYear: number) => ["hr", "config", "tax", fiscalYear] as const,
    currentFiscalYear: () => ["hr", "config", "tax", "current"] as const,
  },
  kds: {
    tickets: (branchId: string, stationCode?: string, status?: string) =>
      ["kds", branchId, "tickets", stationCode, status] as const,
    ticketDetail: (branchId: string, ticketId: string) =>
      ["kds", branchId, "tickets", ticketId] as const,
    /** What is on this board from a business day that has already closed (F17). */
    stale: (branchId: string, stationCode?: string) =>
      ["kds", branchId, "stale", stationCode] as const,
    stations: (branchId: string) => ["kds", branchId, "stations"] as const,
  },
  // 08.2: branch-scoped inventory master-data/recipe/stock namespace. Publishes the registry
  // every hook in plans 08.2-12/13 must use; the local `const X_KEY` arrays in
  // use-inventory.ts stay in place until those plans migrate onto this registry.
  inventory: {
    ingredients: (
      branchId: string,
      filters?: { search?: string; categoryId?: string; status?: string },
    ) => ["inventory", branchId, "ingredients", filters] as const,
    ingredient: (branchId: string, id: string) =>
      ["inventory", branchId, "ingredients", id] as const,
    categories: (branchId: string) => ["inventory", branchId, "categories"] as const,
    categoryTree: (branchId: string) => ["inventory", branchId, "categories", "tree"] as const,
    uoms: (branchId: string) => ["inventory", branchId, "uoms"] as const,
    menuItems: (branchId: string) => ["inventory", branchId, "menu-items"] as const,
    recipes: (branchId: string, filters?: { menuItemId?: string }) =>
      ["inventory", branchId, "recipes", filters] as const,
    recipeVersions: (branchId: string, menuItemId: string) =>
      ["inventory", branchId, "recipes", menuItemId, "versions"] as const,
    /** Nested under the "recipes" prefix so authoring a version invalidates the picker too. */
    recipeOptions: (branchId: string) => ["inventory", branchId, "recipes", "options"] as const,
    storageLocations: (branchId: string) => ["inventory", branchId, "storage-locations"] as const,
    coverage: (branchId: string) => ["inventory", branchId, "coverage"] as const,
    stockLevels: (branchId: string, filters?: { ingredientId?: string; categoryId?: string }) =>
      ["inventory", branchId, "stock-levels", filters] as const,
    costPreview: (branchId: string, fingerprint: string) =>
      ["inventory", branchId, "cost-preview", fingerprint] as const,
    glAccounts: (branchId: string, usage: string, q: string) =>
      ["inventory", branchId, "gl-accounts", usage, q] as const,
  },
  // 08.2: branch-scoped purchasing vendor-catalog/PO namespace (parallels `inventory` above).
  purchasing: {
    vendors: (branchId: string, filters?: { search?: string; status?: string }) =>
      ["purchasing", branchId, "vendors", filters] as const,
    vendor: (branchId: string, id: string) => ["purchasing", branchId, "vendors", id] as const,
    vendorItems: (branchId: string, vendorId: string) =>
      ["purchasing", branchId, "vendors", vendorId, "items"] as const,
    vendorItem: (branchId: string, id: string) =>
      ["purchasing", branchId, "vendor-items", id] as const,
    vendorItemPrices: (branchId: string, vendorItemId: string) =>
      ["purchasing", branchId, "vendor-items", vendorItemId, "prices"] as const,
    vendorCategories: (branchId: string) => ["purchasing", branchId, "vendor-categories"] as const,
    orderSuggestions: (branchId: string) => ["purchasing", branchId, "order-suggestions"] as const,
    purchaseOrders: (branchId: string, filters?: { status?: string[] }) =>
      ["purchasing", branchId, "purchase-orders", filters] as const,
    purchaseOrder: (branchId: string, id: string) =>
      ["purchasing", branchId, "purchase-orders", id] as const,
    invoices: (branchId: string, filters?: { status?: string[] }) =>
      ["purchasing", branchId, "invoices", filters] as const,
    spendAnalytics: (branchId: string, from?: string, to?: string) =>
      ["purchasing", branchId, "spend-analytics", from, to] as const,
    scorecard: (branchId: string, vendorId: string) =>
      ["purchasing", branchId, "scorecard", vendorId] as const,
  },
  reporting: {
    reports: () => ["reporting", "reports"] as const,
    reportRun: (branchId: string | null | undefined, code: string, from: string, to: string) =>
      ["reporting", branchId ?? "all", "report-run", code, from, to] as const,
    fbrTaxSummary: (branchId: string, from: string, to: string) =>
      ["reporting", branchId, "fbr-tax-summary", from, to] as const,
    // Also the cache key the dashboard WebSocket hook merges live pushes into (12-08) — the WS
    // and the REST snapshot must agree on ONE key, not two competing states.
    dashboardTiles: (branchId: string) => ["reporting", branchId, "dashboard-tiles"] as const,
  },
} as const;
