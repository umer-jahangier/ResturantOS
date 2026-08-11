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
 */

export type DashboardPresetId = "owner" | "manager" | "cashier" | "kitchen";

/** The v1 portlet vocabulary (§7.3). */
export type PortletType =
  | "KpiTile"
  | "TrendChart"
  | "RankedList"
  | "ExceptionList"
  | "RecordList"
  | "Shortcuts";

export interface PortletSpec {
  /** Stable id — also the test handle and the `data-portlet` attribute. */
  id: string;
  type: PortletType;
  title: string;
  /**
   * Required permission. Undefined means "everyone who can reach this route".
   * A portlet whose permission the reader lacks is dropped from the layout entirely.
   */
  permission?: string;
  /**
   * Every portlet has a drill target. §7.3: "a KPI you cannot click is a poster, not a
   * dashboard." A portlet with no honest destination does not belong on the page.
   */
  drillTo: string;
  /** Which row it occupies — row 1 is what the role sees first. */
  row: 1 | 2 | 3;
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
  portlets: PortletSpec[];
}

/**
 * OWNER — "is the business healthy?"
 *
 * First thing seen is money and margin, per §7.3. Note `owner-gross-margin` is present and
 * is expected to render an explicit "not computed yet" rather than a number: reporting's
 * `sales-by-item` returns `cogs_paisa: null` (a Phase-8 deferral the report itself declares
 * in `dataNotes`). A dashboard that quietly renders a null margin as 0% or as 100% is the
 * money-path defect class this project has already paid for once.
 */
const OWNER_PRESET: DashboardPreset = {
  id: "owner",
  question: "Is the business healthy?",
  timeFrame: "Last 30 days vs the 30 before",
  density: "comfortable",
  portlets: [
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
      drillTo: "/app/pos/orders",
      row: 1,
    },
    {
      id: "owner-avg-order",
      type: "KpiTile",
      title: "Average order",
      permission: "pos.order.view",
      drillTo: "/app/pos/orders",
      row: 1,
    },
    {
      id: "owner-sales-trend",
      type: "TrendChart",
      title: "Sales and order volume",
      permission: "reporting.report.view",
      drillTo: "/app/reports",
      row: 2,
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
      drillTo: "/app/pos/orders",
      row: 3,
    },
  ],
};

/**
 * MANAGER — "what needs me in the next five minutes?"
 *
 * Today, live. First thing seen is open orders and tickets past their station's threshold —
 * deliberately NOT net sales, which a manager can do nothing about between now and the end
 * of service. Every row-1 tile is an actionable count.
 */
const MANAGER_PRESET: DashboardPreset = {
  id: "manager",
  question: "What needs me in the next five minutes?",
  timeFrame: "Today, live",
  density: "compact",
  portlets: [
    {
      id: "manager-open-orders",
      type: "KpiTile",
      title: "Open orders",
      permission: "pos.order.view",
      drillTo: "/app/pos/orders",
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
      drillTo: "/app/pos/orders",
      row: 2,
    },
    {
      id: "manager-station-load",
      type: "RankedList",
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
      drillTo: "/app/pos/orders",
      row: 3,
    },
    {
      id: "manager-86d",
      type: "RankedList",
      title: "86'd items",
      permission: "pos.menu.view",
      drillTo: "/app/menu",
      row: 3,
    },
  ],
};

/**
 * CASHIER — §7.3: "A cashier landing on an analytics dashboard is a bug."
 * Till state, own open orders, and one 72px `Open POS`. Nothing else.
 */
const CASHIER_PRESET: DashboardPreset = {
  id: "cashier",
  question: "Where is my till, and what is still open?",
  timeFrame: "This shift",
  density: "compact",
  portlets: [
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
      drillTo: "/app/pos/orders",
      row: 1,
    },
    { id: "cashier-shortcuts", type: "Shortcuts", title: "", drillTo: "/app/pos", row: 2 },
  ],
};

/**
 * KITCHEN — two permissions, one destination. A KDS principal holds `pos.kds.view` and
 * `pos.kds.update` and nothing else, so every analytics portlet would be filtered out
 * anyway; sending them straight to the board is the honest version of that same outcome.
 */
const KITCHEN_PRESET: DashboardPreset = {
  id: "kitchen",
  question: "What is on the pass?",
  timeFrame: "Live",
  density: "compact",
  portlets: [
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
    { id: "kitchen-shortcuts", type: "Shortcuts", title: "", drillTo: "/app/kitchen", row: 2 },
  ],
};

export const DASHBOARD_PRESETS: Record<DashboardPresetId, DashboardPreset> = {
  owner: OWNER_PRESET,
  manager: MANAGER_PRESET,
  cashier: CASHIER_PRESET,
  kitchen: KITCHEN_PRESET,
};

/**
 * Which preset a principal gets.
 *
 * Resolved from ROLE first and permission second, deliberately. A role is the closest thing
 * the system has to a statement of intent — "this person manages a branch" — whereas a
 * permission set is a consequence, and two people with the same permissions can still want
 * different first screens. Permissions then decide which portlets inside the preset survive.
 *
 * Registry Safety: an unknown role never throws and never blanks the page. It falls through
 * to the most conservative preset the principal's permissions can support.
 */
export function resolveDashboardPreset(
  roles: readonly string[],
  permissions: readonly string[],
): DashboardPresetId {
  const has = (role: string) => roles.some((r) => r.toUpperCase() === role);

  if (has("OWNER") || has("TENANT_ADMIN") || has("SUPER_ADMIN")) return "owner";
  if (has("MANAGER") || has("BRANCH_MANAGER")) return "manager";
  if (has("KITCHEN_STAFF") || has("KITCHEN")) return "kitchen";
  if (has("CASHIER") || has("WAITER")) return "cashier";

  // Unknown role. Infer from what they can actually reach, cheapest capability first.
  if (permissions.includes("reporting.report.view")) return "owner";
  if (permissions.includes("pos.till.review")) return "manager";
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
