/**
 * Role dashboard presets — the layout as DATA (UI-SPEC §7.3).
 *
 * <h3>The thing this file exists to prevent</h3>
 *
 * Before phase 21 there was one dashboard. Owner, manager, cashier and accountant all got
 * the same four neutral stat cards — closed sales, active orders, menu items, dining tables
 * — chosen because they were the four numbers that happened to be easy to fetch. None of
 * them answers a question anybody actually has. An owner opens a dashboard to ask *is the
 * business healthy?*; a manager opens it to ask *what needs me in the next five minutes?*
 * "Menu items: 78" answers neither, and it answers neither identically for both.
 *
 * §7.3 is explicit that the fix is not the same page with different numbers: **owner and
 * manager get different portlet SETS**, and the sets ship as data rather than as
 * `if (permissions.includes(...))` branches buried in JSX. The difference matters because a
 * branch is invisible — you cannot read a component and see what a cashier will get — while
 * a table can be read, diffed, and asserted over in a test. `dashboard-presets.test.ts`
 * asserts exactly that: that owner and manager differ, and differ in their FIRST row.
 *
 * <h3>Permission is a property of the portlet, not of the reader</h3>
 *
 * Each portlet declares the permission it needs. A portlet the signed-in principal cannot
 * see is **omitted from the layout** — never rendered as an error, never as an empty box,
 * never as a greyed-out tease. §7.3 requires this and it is also the only honest option: a
 * permission error where a number should be tells the reader their business has a problem,
 * when in fact their account does.
 *
 * <h3>`type`, `drillTo` and `row` are LOAD-BEARING as of phase 38, and were not before</h3>
 *
 * The 38 audit found the file's central claim untrue. Nothing branched on `PortletSpec.type`
 * — `grep "\.type ===|switch (p\.type" components/dashboard app __tests__` returned nothing —
 * there was no generic renderer, and all four dashboards hand-wrote their JSX while consulting
 * the preset only for a `Set` of ids. Changing a portlet's `type` here changed nothing on
 * screen. `drillTo` was re-typed as a string literal at every call site, and `row` was read by
 * no one. Three properties a reader would reasonably believe were driving the page were
 * documentation the compiler checked and the runtime ignored — which is worse than absence,
 * because the docblock above argues at length FOR layout-as-data and the file did not deliver it.
 *
 * <p><b>The repair chosen was to build the renderer, not to delete the fields.</b> Deleting them
 * would have made the file honest and left it a permission filter with a page header — and the
 * four hand-written dashboards would still have been four places where a portlet's shape,
 * position and destination are invisible to anyone reading the table. `portlets/portlet-renderer.tsx`
 * now consumes this table: it groups by {@link PortletSpec.row}, derives each row's column count
 * from the row's declared size, dispatches on {@link PortletSpec.type}, and passes
 * {@link PortletSpec.drillTo} and {@link PortletSpec.title} to the portlet. A dashboard supplies
 * only DATA, keyed by portlet id.
 *
 * <p>The binding is enforced at compile time, not by convention: each preset's portlet array is
 * `as const`, so `PortletModels<typeof X_PORTLETS>` (see the renderer) maps every id to exactly
 * the model variant its declared `type` requires. Change `type: "KpiTile"` to `"RankedList"`
 * here and the dashboard supplying that portlet stops compiling. That is the difference between
 * a table that describes the page and a table that is the page.
 *
 * <h3>Four of the nine questions are PROVISIONAL and are stated as assumptions</h3>
 *
 * Nine roles are seeded (see {@link resolveDashboardPreset}). The product owner supplied the
 * question for five of them. For ACCOUNTANT, INVENTORY_MANAGER, FINANCE_VIEWER and WAITER there
 * is no supplied question, and the three dashboards those roles used to land on were wrong in
 * ways the audit measured: INVENTORY_MANAGER and FINANCE_VIEWER fell through to the cashier
 * preset and saw ZERO numbers plus a 72px "Open POS" button for a POS they hold no
 * `pos.order.create` for, and ACCOUNTANT resolved to the owner preset and was asked "Is the
 * business healthy?", which is not an accountant's question.
 *
 * <p>So each of those four carries a question DERIVED FROM THE ROLE'S OWN PERMISSION SET, marked
 * provisional at the preset that owns it. **To change one, edit the `question` string on that
 * preset below and nothing else** — that is the entire point of shipping layout as data, and it
 * is why these four assumptions are recorded here rather than in a summary nobody will re-read.
 */

export type DashboardPresetId =
  | "owner"
  | "manager"
  | "accountant"
  | "inventory"
  | "finance"
  | "cashier"
  | "kitchen"
  | "waiter";

/** The v1 portlet vocabulary (§7.3). Every member is implemented by the renderer. */
export type PortletType =
  | "KpiTile"
  | "TrendChart"
  | "RankedList"
  | "MeterStack"
  | "ExceptionList"
  | "RecordList"
  | "Shortcuts";

export interface PortletSpec {
  /** Stable id — also the test handle, the `data-portlet` attribute, and the model-map key. */
  id: string;
  /**
   * Which portlet component renders this slot. Read by the renderer at runtime AND bound to the
   * supplied model at compile time — see the docblock above. Not decoration.
   */
  type: PortletType;
  title: string;
  /**
   * Required permission. Undefined means "everyone who can reach this route".
   * A portlet whose permission the reader lacks is dropped from the layout entirely.
   *
   * <p><b>Every portlet in every preset now names one.</b> The two `Shortcuts` slots did not,
   * which is how an INVENTORY_MANAGER came to be shown a 72px "Open POS" button: the slot was
   * ungated in the table AND rendered unconditionally in `focused-dashboard.tsx:114-118`,
   * unlike the KPI tiles above it. Both halves are fixed — the gate is here, and the renderer
   * has no path that skips it.
   */
  permission?: string;
  /**
   * Every portlet has a drill target. §7.3: "a KPI you cannot click is a poster, not a
   * dashboard." A portlet with no honest destination does not belong on the page.
   */
  drillTo: string;
  /** Which row it occupies — row 1 is what the role sees first. */
  row: 1 | 2 | 3;
  /**
   * Marks this portlet as the WIDE half of a two-portlet row, which the grid then lays out
   * `2fr 1fr` instead of `1fr 1fr` (`dashboard-shell.tsx`, `RowLayout`) — the split the demo's
   * dashboard uses under its KPI row.
   *
   * <p>DECLARED rather than inferred. The renderer could guess — "a TrendChart is always the wide
   * one" — and it would be wrong on the manager's row, where the wide half is a record table and
   * the narrow half is a meter stack. It is a composition decision, so it lives in the
   * composition table. Only read on a row that declares exactly two portlets.
   */
  lead?: true;
}

export interface DashboardPreset {
  id: DashboardPresetId;
  /** The question this dashboard answers, shown as the page subtitle. */
  question: string;
  /** Time frame, in the reader's words. Owner reads periods; a manager reads *now*. */
  timeFrame: string;
  /**
   * `comfortable` for an owner, `compact` for a manager — §7.3, "a manager scans, an owner
   * reads". This is a real density switch, not a label: it drives the grid gap and padding.
   */
  density: "comfortable" | "compact";
  portlets: readonly PortletSpec[];
}

/**
 * OWNER — "is the business healthy?"
 *
 * First thing seen is money and margin, per §7.3. Note `owner-gross-margin` is present and
 * is expected to render an explicit "not computed yet" rather than a number: reporting's
 * `sales-by-item` returns `cogs_paisa: null` (a Phase-8 deferral the report itself declares
 * in `dataNotes`). A dashboard that quietly renders a null margin as 0% or as 100% is the
 * money-path defect class this project has already paid for once (D-38-16).
 */
const OWNER_PORTLETS = [
  {
    id: "owner-net-sales",
    type: "KpiTile",
    title: "Net sales",
    permission: "reporting.report.view",
    drillTo: "/app/reports",
    row: 1,
  },
  {
    id: "owner-gross-margin",
    type: "KpiTile",
    title: "Gross margin",
    permission: "reporting.report.view",
    drillTo: "/app/reports",
    row: 1,
  },
  {
    id: "owner-covers",
    type: "KpiTile",
    title: "Covers",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "owner-avg-order",
    type: "KpiTile",
    title: "Average order",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "owner-sales-trend",
    type: "TrendChart",
    title: "Sales and order volume",
    permission: "reporting.report.view",
    drillTo: "/app/reports",
    row: 2,
    lead: true,
  },
  {
    id: "owner-top-items",
    type: "RankedList",
    title: "Top items by revenue",
    permission: "reporting.report.view",
    drillTo: "/app/reports",
    row: 2,
  },
  {
    id: "owner-exceptions",
    type: "ExceptionList",
    title: "Needs a decision",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 3,
  },
] as const satisfies readonly PortletSpec[];

const OWNER_PRESET: DashboardPreset = {
  id: "owner",
  question: "Is the business healthy?",
  timeFrame: "Last 30 days vs the 30 before",
  density: "comfortable",
  portlets: OWNER_PORTLETS,
};

/**
 * MANAGER — "what needs me in the next five minutes?"
 *
 * Today, live. First thing seen is open orders and tickets past their station's threshold —
 * deliberately NOT net sales, which a manager can do nothing about between now and the end
 * of service. Every row-1 tile is an actionable count.
 */
const MANAGER_PORTLETS = [
  {
    id: "manager-open-orders",
    type: "KpiTile",
    title: "Open orders",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "manager-late-tickets",
    type: "KpiTile",
    title: "Late tickets",
    permission: "pos.kds.view",
    drillTo: "/app/kitchen",
    row: 1,
  },
  {
    id: "manager-till-variance",
    type: "KpiTile",
    title: "Till variance today",
    permission: "pos.till.review",
    drillTo: "/app/pos/tills",
    row: 1,
  },
  {
    id: "manager-tables-occupied",
    type: "KpiTile",
    title: "Tables occupied",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "manager-live-orders",
    type: "RecordList",
    title: "Live orders",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 2,
    lead: true,
  },
  {
    id: "manager-station-load",
    type: "MeterStack",
    title: "Station load",
    permission: "pos.kds.view",
    drillTo: "/app/kitchen",
    row: 2,
  },
  {
    id: "manager-exceptions",
    type: "ExceptionList",
    title: "Act now",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 3,
    lead: true,
  },
  {
    id: "manager-86d",
    type: "RankedList",
    title: "86'd items",
    permission: "pos.menu.view",
    drillTo: "/app/menu/items",
    row: 3,
  },
] as const satisfies readonly PortletSpec[];

const MANAGER_PRESET: DashboardPreset = {
  id: "manager",
  question: "What needs me in the next five minutes?",
  timeFrame: "Today, live",
  density: "compact",
  portlets: MANAGER_PORTLETS,
};

/**
 * ACCOUNTANT — **PROVISIONAL QUESTION.** "What needs posting or reconciling?"
 *
 * <p>Not supplied by the product owner. Derived from the role's 26 granted permissions
 * (`030-create-roles-permissions.xml`, topped up by 044/045/046/057): an ACCOUNTANT holds
 * `finance.journal.view/post/reverse`, `finance.period.open/close`, `finance.ar.view/manage`,
 * `vendor.invoice.book/override` and `vendor.payment.create`. Every one of those is an
 * unfinished-work verb, and none of them is "is the business healthy?" — which is the question
 * this role was being asked until phase 38, because it fell through the role match and was
 * caught by `permissions.includes("reporting.report.view")`. To change the question, edit the
 * string below.
 *
 * <p>`accountant-net-income` is on this page ON PURPOSE and renders a stated absence. An
 * accountant's dashboard is the one place a P&L figure genuinely belongs, and this system cannot
 * assemble one: `sales_item_facts.cogs_paisa` is a Phase-8-deferred NULL for every row and
 * finance-service has no statement endpoint at all (`grep -rli "income-statement|profit"
 * services/*&#47;src/main/java` → 0 files). D-38-16 makes that an absence with a reason rather
 * than a number, and putting the tile here is how the gap stays visible instead of being quietly
 * dropped from the layout.
 */
const ACCOUNTANT_PORTLETS = [
  {
    id: "accountant-unposted-journals",
    type: "KpiTile",
    title: "Unposted journal entries",
    permission: "finance.journal.view",
    drillTo: "/app/finance/journal-entries",
    row: 1,
  },
  {
    id: "accountant-payables-outstanding",
    type: "KpiTile",
    title: "Payables outstanding",
    permission: "finance.journal.view",
    drillTo: "/app/finance/ap-aging",
    row: 1,
  },
  {
    id: "accountant-receivables-outstanding",
    type: "KpiTile",
    title: "Receivables outstanding",
    permission: "finance.ar.view",
    drillTo: "/app/finance/ar-aging",
    row: 1,
  },
  {
    id: "accountant-net-income",
    type: "KpiTile",
    title: "Net income, month to date",
    permission: "finance.journal.view",
    drillTo: "/app/finance/gl",
    row: 1,
  },
  {
    id: "accountant-payables-ageing",
    type: "RankedList",
    title: "Payables by age",
    permission: "finance.journal.view",
    drillTo: "/app/finance/ap-aging",
    row: 2,
  },
  {
    id: "accountant-unposted-list",
    type: "RecordList",
    title: "Waiting to be posted",
    permission: "finance.journal.view",
    drillTo: "/app/finance/journal-entries",
    row: 2,
  },
  {
    id: "accountant-exceptions",
    type: "ExceptionList",
    title: "Needs a decision",
    permission: "finance.journal.view",
    drillTo: "/app/finance/journal-entries",
    row: 3,
    lead: true,
  },
  {
    id: "accountant-invoices",
    type: "RecordList",
    title: "Vendor invoices to settle",
    permission: "vendor.invoice.book",
    drillTo: "/app/purchasing/invoices",
    row: 3,
  },
] as const satisfies readonly PortletSpec[];

const ACCOUNTANT_PRESET: DashboardPreset = {
  id: "accountant",
  question: "What needs posting or reconciling?",
  timeFrame: "Open periods, as they stand now",
  density: "comfortable",
  portlets: ACCOUNTANT_PORTLETS,
};

/**
 * INVENTORY_MANAGER — **PROVISIONAL QUESTION.** "What am I about to run out of?"
 *
 * <p>Not supplied by the product owner. Derived from the role's 7 granted permissions:
 * `inventory.item.view/manage`, `vendor.view`, `vendor.po.create`, `vendor.grn.receive`,
 * `file.view/upload`. That set describes exactly one job — keep the shelf stocked and the
 * deliveries coming — and it contains no reporting, no POS and no finance permission, which is
 * why this role saw NOTHING at all before phase 38: it fell through to the cashier preset,
 * whose every KPI tile was filtered out, leaving a page titled "Where is my till, and what is
 * still open?" and an ungated 72px "Open POS" button for a POS it holds no `pos.order.create`
 * for. To change the question, edit the string below.
 *
 * <p>Every figure here is counted from `GET /api/v1/inventory/stock` (whose `belowReorderPoint`
 * and `nonPositive` flags are computed server-side, so the tile and the stock screen's row wash
 * cannot drift) or from the branch's purchase-order list. Nothing on this page is derived from
 * a cost column: `Food Cost %` and the whole COGS family are D-38-16 absences and are simply not
 * on an inventory manager's page, because they are not questions this role can act on.
 */
const INVENTORY_PORTLETS = [
  {
    id: "inventory-below-reorder",
    type: "KpiTile",
    title: "Below reorder point",
    permission: "inventory.item.view",
    drillTo: "/app/inventory/stock",
    row: 1,
  },
  {
    id: "inventory-out-of-stock",
    type: "KpiTile",
    title: "Out of stock",
    permission: "inventory.item.view",
    drillTo: "/app/inventory/stock",
    row: 1,
  },
  {
    id: "inventory-stock-value",
    type: "KpiTile",
    title: "Stock on hand",
    permission: "inventory.item.view",
    drillTo: "/app/inventory/stock",
    row: 1,
  },
  {
    id: "inventory-incoming",
    type: "KpiTile",
    title: "Deliveries outstanding",
    permission: "vendor.view",
    drillTo: "/app/purchasing/purchase-orders",
    row: 1,
  },
  {
    id: "inventory-shortfalls",
    type: "RankedList",
    title: "Closest to running out",
    permission: "inventory.item.view",
    drillTo: "/app/inventory/stock",
    row: 2,
  },
  {
    id: "inventory-open-orders",
    type: "RecordList",
    title: "Purchase orders in flight",
    permission: "vendor.view",
    drillTo: "/app/purchasing/purchase-orders",
    row: 2,
  },
  {
    id: "inventory-exceptions",
    type: "ExceptionList",
    title: "Needs a decision",
    permission: "inventory.item.view",
    drillTo: "/app/inventory/stock",
    row: 3,
  },
] as const satisfies readonly PortletSpec[];

const INVENTORY_PRESET: DashboardPreset = {
  id: "inventory",
  question: "What am I about to run out of?",
  timeFrame: "Stock as it stands now",
  density: "compact",
  portlets: INVENTORY_PORTLETS,
};

/**
 * FINANCE_VIEWER — **PROVISIONAL QUESTION.** "What still needs reconciling?"
 *
 * <p>Not supplied by the product owner. Derived from the role's FOUR granted permissions —
 * `finance.coa.view`, `finance.journal.view`, `finance.journal.post`, `hr.payroll.view` — which
 * is the narrowest grant set of any seeded role and the reason this role, like
 * INVENTORY_MANAGER, previously landed on a cashier dashboard with no numbers on it at all.
 * To change the question, edit the string below.
 *
 * <p>The role can POST a journal entry but cannot reverse one, cannot open or close a period,
 * and holds no `reporting.report.view` — so there is no sales figure, no margin and no revenue
 * trend on this page, and there could not honestly be one. What it can see is the ledger's
 * unfinished work, which is what every tile here counts.
 */
const FINANCE_PORTLETS = [
  {
    id: "finance-unposted-journals",
    type: "KpiTile",
    title: "Unposted journal entries",
    permission: "finance.journal.view",
    drillTo: "/app/finance/journal-entries",
    row: 1,
  },
  {
    id: "finance-unbalanced-journals",
    type: "KpiTile",
    title: "Entries that do not balance",
    permission: "finance.journal.view",
    drillTo: "/app/finance/journal-entries",
    row: 1,
  },
  {
    id: "finance-open-periods",
    type: "KpiTile",
    title: "Periods still open",
    permission: "finance.journal.view",
    drillTo: "/app/finance/periods",
    row: 1,
  },
  {
    id: "finance-payroll-unpaid",
    type: "KpiTile",
    title: "Payroll runs not yet paid",
    permission: "hr.payroll.view",
    drillTo: "/app/hr/payroll",
    row: 1,
  },
  {
    id: "finance-unposted-list",
    type: "RecordList",
    title: "Waiting to be posted",
    permission: "finance.journal.view",
    drillTo: "/app/finance/journal-entries",
    row: 2,
  },
  {
    id: "finance-period-list",
    type: "RecordList",
    title: "Open periods",
    permission: "finance.journal.view",
    drillTo: "/app/finance/periods",
    row: 2,
  },
  {
    id: "finance-exceptions",
    type: "ExceptionList",
    title: "Needs a decision",
    permission: "finance.journal.view",
    drillTo: "/app/finance/periods",
    row: 3,
  },
] as const satisfies readonly PortletSpec[];

const FINANCE_PRESET: DashboardPreset = {
  id: "finance",
  question: "What still needs reconciling?",
  timeFrame: "The ledger, as it stands now",
  density: "comfortable",
  portlets: FINANCE_PORTLETS,
};

/**
 * CASHIER — §7.3: "A cashier landing on an analytics dashboard is a bug."
 * Till state, own open orders, and one 72px `Open POS`. Nothing else.
 */
const CASHIER_PORTLETS = [
  {
    id: "cashier-till",
    type: "KpiTile",
    title: "My till",
    permission: "pos.till.open",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "cashier-open-orders",
    type: "KpiTile",
    title: "My open orders",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "cashier-shortcuts",
    type: "Shortcuts",
    title: "",
    // The gate that was missing. `pos.order.create` and not `pos.order.view`: the button opens
    // the till-side POS to TAKE an order, so viewing orders is not enough to make it honest.
    permission: "pos.order.create",
    drillTo: "/app/pos",
    row: 2,
  },
] as const satisfies readonly PortletSpec[];

const CASHIER_PRESET: DashboardPreset = {
  id: "cashier",
  question: "Where is my till, and what is still open?",
  timeFrame: "This shift",
  density: "compact",
  portlets: CASHIER_PORTLETS,
};

/**
 * KITCHEN — two permissions, one destination. A KDS principal holds `pos.kds.view` and
 * `pos.kds.update` and nothing else, so every analytics portlet would be filtered out
 * anyway; sending them straight to the board is the honest version of that same outcome.
 */
const KITCHEN_PORTLETS = [
  {
    id: "kitchen-late-tickets",
    type: "KpiTile",
    title: "Late tickets",
    permission: "pos.kds.view",
    drillTo: "/app/kitchen",
    row: 1,
  },
  {
    id: "kitchen-open-tickets",
    type: "KpiTile",
    title: "Tickets on the board",
    permission: "pos.kds.view",
    drillTo: "/app/kitchen",
    row: 1,
  },
  {
    id: "kitchen-shortcuts",
    type: "Shortcuts",
    title: "",
    permission: "pos.kds.view",
    drillTo: "/app/kitchen",
    row: 2,
  },
] as const satisfies readonly PortletSpec[];

const KITCHEN_PRESET: DashboardPreset = {
  id: "kitchen",
  question: "What is on the pass?",
  timeFrame: "Live",
  density: "compact",
  portlets: KITCHEN_PORTLETS,
};

/**
 * WAITER — **PROVISIONAL QUESTION.** "What are my tables doing?"
 *
 * <p>Not supplied by the product owner. Derived from the role's 7 granted permissions
 * (`055-waiter-role-and-tenant-admin-authority.xml:96-104`): `pos.tables.manage`,
 * `pos.order.create/update/view/send_to_kds`, `pos.menu.view`, `pos.kds.view`. A waiter seats,
 * takes, fires and runs — and holds no `pos.till.open`, which is why the cashier preset it used
 * to resolve to dropped its first tile and asked it "Where is my till?" about a till it can
 * never open. To change the question, edit the string below.
 *
 * <p>**One honest limitation, stated because the question says "my".** `GET /api/v1/pos/orders`
 * carries `cashierId`/`cashierName` but the list is BRANCH-scoped and has no server-side
 * "mine" filter, and an order created by a waiter is not guaranteed to carry that waiter as its
 * cashier once a till operator settles it. So these portlets are titled for the SERVICE
 * ("Open checks", "Tables seated") rather than for the person, and no tile claims to be filtered
 * to the reader. Narrowing the question to one waiter's own tables needs a server-side filter
 * that does not exist; inventing it in the browser would be a figure this system does not know.
 */
const WAITER_PORTLETS = [
  {
    id: "waiter-tables-occupied",
    type: "KpiTile",
    title: "Tables seated",
    permission: "pos.tables.manage",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "waiter-open-checks",
    type: "KpiTile",
    title: "Open checks",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "waiter-ready-to-run",
    type: "KpiTile",
    title: "Ready to run",
    permission: "pos.kds.view",
    drillTo: "/app/kitchen/expo",
    row: 1,
  },
  {
    id: "waiter-longest-open",
    type: "KpiTile",
    title: "Longest check open",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 1,
  },
  {
    id: "waiter-checks",
    type: "RecordList",
    title: "Open checks by table",
    permission: "pos.order.view",
    drillTo: "/app/pos",
    row: 2,
    lead: true,
  },
  {
    id: "waiter-pass",
    type: "MeterStack",
    title: "On the pass, by station",
    permission: "pos.kds.view",
    drillTo: "/app/kitchen/expo",
    row: 2,
  },
  {
    id: "waiter-shortcuts",
    type: "Shortcuts",
    title: "",
    permission: "pos.order.create",
    drillTo: "/app/pos",
    row: 3,
  },
] as const satisfies readonly PortletSpec[];

const WAITER_PRESET: DashboardPreset = {
  id: "waiter",
  question: "What are my tables doing?",
  timeFrame: "This service, live",
  density: "compact",
  portlets: WAITER_PORTLETS,
};

export const DASHBOARD_PRESETS: Record<DashboardPresetId, DashboardPreset> = {
  owner: OWNER_PRESET,
  manager: MANAGER_PRESET,
  accountant: ACCOUNTANT_PRESET,
  inventory: INVENTORY_PRESET,
  finance: FINANCE_PRESET,
  cashier: CASHIER_PRESET,
  kitchen: KITCHEN_PRESET,
  waiter: WAITER_PRESET,
};

/**
 * The portlet-id unions, one per preset.
 *
 * <p>These are what make `PortletSpec.type` load-bearing at compile time: a dashboard declares
 * `PortletModels<typeof OWNER_PORTLETS>` and the compiler then requires a model for EVERY id in
 * the table, of exactly the variant that id's `type` names. Adding a portlet to a preset without
 * supplying its data is a type error rather than a blank space on a screen nobody re-opened.
 */
export type OwnerPortlets = typeof OWNER_PORTLETS;
export type ManagerPortlets = typeof MANAGER_PORTLETS;
export type AccountantPortlets = typeof ACCOUNTANT_PORTLETS;
export type InventoryPortlets = typeof INVENTORY_PORTLETS;
export type FinancePortlets = typeof FINANCE_PORTLETS;
export type CashierPortlets = typeof CASHIER_PORTLETS;
export type KitchenPortlets = typeof KITCHEN_PORTLETS;
export type WaiterPortlets = typeof WAITER_PORTLETS;

/**
 * Which preset a principal gets.
 *
 * Resolved from ROLE first and permission second, deliberately. A role is the closest thing
 * the system has to a statement of intent — "this person manages a branch" — whereas a
 * permission set is a consequence, and two people with the same permissions can still want
 * different first screens. Permissions then decide which portlets inside the preset survive.
 *
 * <h3>The nine role codes below are the nine the seed actually mints</h3>
 *
 * Audited against `services/auth-service/src/main/resources/db/changelog/v1.0.0/`:
 * OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT, INVENTORY_MANAGER, CASHIER, FINANCE_VIEWER
 * (`030-create-roles-permissions.xml:120-127`), KITCHEN_STAFF
 * (`042-kds-permissions-kitchen-role.xml:23-27`) and WAITER
 * (`055-waiter-role-and-tenant-admin-authority.xml:90-95`).
 *
 * <p>`SUPER_ADMIN`, `BRANCH_MANAGER` and `KITCHEN` were matched here until phase 38 and are
 * **removed**: `grep -rn "INSERT INTO roles" --include="*.sql" .` returns nothing and no
 * changelog inserts any of the three. SuperAdmin is a platform-plane principal with no `roles`
 * row at all (`components/platform/platform-guard.tsx`, `lib/hooks/use-platform-session.ts:16`)
 * and never reaches this function; the other two are misspellings of MANAGER and KITCHEN_STAFF.
 * Three branches that could never be taken read to the next author as three roles that exist,
 * which is how ACCOUNTANT came to be handled by a fallback while an imaginary BRANCH_MANAGER
 * had a line of its own.
 *
 * <h3>Registry Safety</h3>
 *
 * An unknown role never throws and never blanks the page. It falls through to the most
 * conservative preset the principal's permissions can support, cheapest capability first.
 */
export function resolveDashboardPreset(
  roles: readonly string[],
  permissions: readonly string[],
): DashboardPresetId {
  const has = (role: string) => roles.some((r) => r.toUpperCase() === role);

  if (has("OWNER") || has("TENANT_ADMIN")) return "owner";
  if (has("MANAGER")) return "manager";
  if (has("ACCOUNTANT")) return "accountant";
  if (has("INVENTORY_MANAGER")) return "inventory";
  if (has("FINANCE_VIEWER")) return "finance";
  if (has("KITCHEN_STAFF")) return "kitchen";
  if (has("WAITER")) return "waiter";
  if (has("CASHIER")) return "cashier";

  // Unknown role. Infer from what they can actually reach, cheapest capability first.
  if (permissions.includes("reporting.report.view")) return "owner";
  if (permissions.includes("pos.till.review")) return "manager";
  if (permissions.includes("finance.journal.view")) return "finance";
  if (permissions.includes("inventory.item.view")) return "inventory";
  if (permissions.includes("pos.kds.view") && !permissions.includes("pos.order.view")) {
    return "kitchen";
  }
  return "cashier";
}

/** The portlets this principal may actually see, in row order. */
export function visiblePortlets(
  preset: DashboardPreset,
  permissions: readonly string[],
): PortletSpec[] {
  return preset.portlets.filter((p) => !p.permission || permissions.includes(p.permission));
}
