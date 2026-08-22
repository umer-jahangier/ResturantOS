import {
  Activity,
  Armchair,
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ChefHat,
  ClipboardList,
  Clock,
  ConciergeBell,
  Contact,
  FileText,
  HandCoins,
  Handshake,
  KeyRound,
  LayoutDashboard,
  LineChart,
  MonitorSmartphone,
  MonitorSpeaker,
  Palette,
  Percent,
  Plus,
  Printer,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Store,
  SunMoon,
  Truck,
  UserRound,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";

import type { NavItem } from "@/components/shared/sidebar-nav-items";

/**
 * Everything the command palette can reach, and the gate each destination actually enforces.
 *
 * <h3>Why this list is longer than the sidebar</h3>
 *
 * The sidebar carries 35 entries. `find app -name page.tsx` finds **82 routes**. The difference is
 * not decoration: `/app/finance/transactions` (the order register), `/app/finance/ar-aging`,
 * `/app/inventory/stock`, `/app/hr/payroll`, `/app/purchasing/invoices`, `/app/reports/fbr` and
 * `/app/kitchen/expo` are all real, built, permission-guarded screens that appear in NO sidebar
 * group — they are reachable only by first landing on a module and then finding its tab strip.
 * Phase 20 §0 calls the palette *"the primary navigator"* and the thing that makes the two-tier
 * nav survivable: *"if you can't find it, you type it."* A palette that could only offer what the
 * sidebar already shows would make that sentence false.
 *
 * Every `href` below was checked against the route tree; none is `comingSoon`, and the two entries
 * `sidebar-nav-items.ts` marks that way (`/app/reporting`, `/platform/tenants`) are deliberately
 * absent. Offering a 404 from the search box is the failure GA-053 and GA-091 already cost this
 * product twice.
 *
 * <h3>Where each gate comes from — and the one place they disagree</h3>
 *
 * "A palette that offers a route the user will be denied is worse than one that omits it", so the
 * gate on a command is the gate its DESTINATION enforces, read off the route rather than invented:
 *
 *   · href present in `sidebar-nav-items.ts` → that entry's gate, verbatim. Those are frozen by
 *     `nav-permission-matrix.test.tsx` and are not re-litigated here.
 *   · href not in the sidebar → the guard on its own `page.tsx`, or the module `layout.tsx` that
 *     wraps it (finance, HR, inventory and purchasing each guard at the layout).
 *
 * The finance rows restate `FINANCE_TABS` from `app/(tenant)/app/finance/layout.tsx` rather than
 * importing it — a `lib/` module reaching into a route file drags a client layout, `Link` and
 * `usePathname` into every page that mounts the top bar. `command-palette-registry.test.tsx`
 * asserts the two lists agree, so the copy cannot drift silently.
 *
 * **The one disagreement, stated rather than smoothed over:** the sidebar offers POS on
 * `pos.order.view`, while `app/(tenant)/app/pos/page.tsx` guards itself on `pos.order.update`. A
 * principal holding view but not update is offered POS by the sidebar today and refused by the
 * page. This registry mirrors the SIDEBAR, because changing it here would silently diverge from
 * the frozen matrix and hide a real bug in the one place someone might otherwise notice it. It is
 * reported as a finding, not patched from inside a search box.
 */
export type CommandCategory =
  | "Recent"
  | "Quick actions"
  | "Orders"
  | "Vendors"
  | "Pages"
  | "Settings";

/**
 * A palette entry.
 *
 * Structurally a {@link NavItem}, which is the whole point: `useNavGroupVisibility` — the hook the
 * sidebar and the mobile bar filter with, whose output `nav-permission-matrix.test.tsx` freezes —
 * takes `NavItem`s, so the palette gets the identical four-gate composition (`permission`,
 * `permissionMode`, `feature`, `roles`, plus `comingSoon`) for free instead of a fifth
 * reimplementation of it.
 */
export interface CommandDescriptor extends NavItem {
  /** Stable across sessions — it is the key recents are stored under. Never derive it from a label. */
  id: string;
  category: CommandCategory;
  /** Second line. Says what the destination is for when the label alone is a noun. */
  description?: string;
  /** Audited synonyms, not a heuristic: `gl` → General Ledger, `kds` → Kitchen Display. */
  keywords?: string[];
  /**
   * A non-navigating effect. `href` is still required by `NavItem` and is ignored for these; the
   * palette dispatches on `effect` first.
   */
  effect?: "toggle-theme";
}

/** The ledger permission — `FINANCE_TABS`' `LEDGER`. */
const LEDGER = "finance.journal.view";

/** `FINANCE_TABS`' `TAKINGS`: the three codes `DailyTakingsController` gates on. */
const TAKINGS = [LEDGER, "pos.order.view.all", "pos.till.review"];

const POS_FEATURE = "FEATURE_POS" as const;
const KDS_FEATURE = "FEATURE_KDS" as const;
const INVENTORY_FEATURE = "FEATURE_INVENTORY" as const;
const FINANCE_FEATURE = "FEATURE_FINANCE" as const;
const VENDOR_FEATURE = "FEATURE_VENDOR" as const;
const HR_FEATURE = "FEATURE_HR" as const;
const CRM_FEATURE = "FEATURE_CRM" as const;
const NLQ_FEATURE = "FEATURE_NLQ" as const;

/** Every route the palette can offer, in the order it offers them. */
export const PAGE_COMMANDS: CommandDescriptor[] = [
  // ── Overview ───────────────────────────────────────────────────────────────────────────────
  {
    id: "page.dashboard",
    label: "Dashboard",
    href: "/app/dashboard",
    icon: LayoutDashboard,
    category: "Pages",
    keywords: ["home", "overview", "today"],
  },
  {
    id: "page.dashboard.realtime",
    label: "Realtime Dashboard",
    href: "/app/dashboard/realtime",
    icon: LineChart,
    category: "Pages",
    permission: "reporting.dashboard.view",
    keywords: ["live", "kpi"],
  },

  // ── Service ────────────────────────────────────────────────────────────────────────────────
  {
    id: "page.pos",
    label: "POS Terminal",
    href: "/app/pos",
    icon: ShoppingCart,
    category: "Pages",
    permission: "pos.order.view",
    feature: POS_FEATURE,
    description: "Ring an order, the floor view, and Order Management",
    keywords: ["orders", "order management", "checkout", "cart", "sell", "till", "floor"],
  },
  {
    id: "page.kitchen",
    label: "Kitchen Display",
    href: "/app/kitchen",
    icon: ChefHat,
    category: "Pages",
    permission: "pos.kds.view",
    feature: KDS_FEATURE,
    keywords: ["kds", "board", "tickets"],
  },
  {
    id: "page.kitchen.expo",
    label: "Expo",
    href: "/app/kitchen/expo",
    icon: ConciergeBell,
    category: "Pages",
    permission: "pos.kds.view",
    feature: KDS_FEATURE,
    description: "The pass — every station's tickets on one board",
    keywords: ["pass", "expeditor", "expediter"],
  },
  {
    id: "page.pos.tills",
    label: "Till Review",
    href: "/app/pos/tills",
    icon: Banknote,
    category: "Pages",
    permission: "pos.till.review",
    feature: POS_FEATURE,
    keywords: ["cash up", "drawer", "variance"],
  },

  // ── Menu ───────────────────────────────────────────────────────────────────────────────────
  {
    id: "page.menu.items",
    label: "Menu Items",
    href: "/app/menu/items",
    icon: UtensilsCrossed,
    category: "Pages",
    permission: "pos.menu.manage",
    feature: POS_FEATURE,
    keywords: ["dishes", "products", "catalogue", "catalog"],
  },
  {
    id: "page.menu.routing",
    label: "Station Routing",
    href: "/app/menu/routing",
    icon: Route,
    category: "Pages",
    permission: "pos.menu.manage",
    feature: POS_FEATURE,
    description: "Which station makes each dish",
  },
  {
    id: "page.stations",
    label: "Stations",
    href: "/app/stations",
    icon: MonitorSpeaker,
    category: "Pages",
    permission: "pos.menu.manage",
    feature: POS_FEATURE,
  },
  {
    id: "page.tables",
    label: "Tables",
    href: "/app/tables",
    icon: Armchair,
    category: "Pages",
    permission: "pos.tables.admin",
    feature: POS_FEATURE,
    keywords: ["floor", "seating", "covers"],
  },
  {
    id: "page.terminals",
    label: "POS Terminals",
    href: "/app/terminals",
    icon: MonitorSmartphone,
    category: "Pages",
    permission: "pos.terminals.admin",
    feature: POS_FEATURE,
  },

  // ── Inventory ──────────────────────────────────────────────────────────────────────────────
  {
    id: "page.inventory",
    label: "Inventory",
    href: "/app/inventory",
    icon: Boxes,
    category: "Pages",
    permission: "inventory.item.view",
    feature: INVENTORY_FEATURE,
    keywords: ["stock"],
  },
  {
    id: "page.inventory.ingredients",
    label: "Ingredients",
    href: "/app/inventory/ingredients",
    icon: Boxes,
    category: "Pages",
    permission: "inventory.item.view",
    feature: INVENTORY_FEATURE,
    keywords: ["products", "items", "sku"],
  },
  {
    id: "page.inventory.categories",
    label: "Inventory Categories",
    href: "/app/inventory/categories",
    icon: Boxes,
    category: "Pages",
    permission: "inventory.item.view",
    feature: INVENTORY_FEATURE,
  },
  {
    id: "page.inventory.recipes",
    label: "Recipes",
    href: "/app/inventory/recipes",
    icon: ClipboardList,
    category: "Pages",
    permission: "inventory.item.view",
    feature: INVENTORY_FEATURE,
    keywords: ["plate cost", "bom"],
  },
  {
    id: "page.inventory.coverage",
    label: "Recipe Coverage",
    href: "/app/inventory/coverage",
    icon: ClipboardList,
    category: "Pages",
    permission: "inventory.item.view",
    feature: INVENTORY_FEATURE,
    description: "Which menu items still have no recipe",
  },
  {
    id: "page.inventory.stock",
    label: "Stock Levels",
    href: "/app/inventory/stock",
    icon: Boxes,
    category: "Pages",
    permission: "inventory.item.view",
    feature: INVENTORY_FEATURE,
    keywords: ["on hand", "count", "wastage"],
  },
  {
    id: "page.inventory.setup",
    label: "Inventory Setup",
    href: "/app/inventory/setup",
    icon: Settings,
    category: "Pages",
    permission: "inventory.item.view",
    feature: INVENTORY_FEATURE,
    keywords: ["uom", "units", "storage locations"],
  },

  // ── Finance — mirrors FINANCE_TABS, asserted equal by test ──────────────────────────────────
  {
    id: "page.finance.takings",
    label: "Takings",
    href: "/app/finance/takings",
    icon: Wallet,
    category: "Pages",
    permission: TAKINGS,
    permissionMode: "any",
    feature: FINANCE_FEATURE,
    description: "The evening cash-up",
    keywords: ["daily", "cash up", "revenue"],
  },
  {
    id: "page.finance.transactions",
    label: "Transactions",
    href: "/app/finance/transactions",
    icon: Receipt,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["register", "order register"],
  },
  {
    id: "page.finance.accounts",
    label: "Accounts",
    href: "/app/finance/accounts",
    icon: Wallet,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["chart of accounts", "coa"],
  },
  {
    id: "page.finance.journal-entries",
    label: "Journal Entries",
    href: "/app/finance/journal-entries",
    icon: BookOpen,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["je", "postings"],
  },
  {
    id: "page.finance.gl",
    label: "General Ledger",
    href: "/app/finance/gl",
    icon: LineChart,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["gl", "ledger"],
  },
  {
    id: "page.finance.periods",
    label: "Periods",
    href: "/app/finance/periods",
    icon: CalendarDays,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["month end", "close", "open period"],
  },
  {
    id: "page.finance.expenses",
    label: "Expenses",
    href: "/app/finance/expenses",
    icon: Receipt,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
  },
  {
    id: "page.finance.ap-aging",
    label: "AP Aging",
    href: "/app/finance/ap-aging",
    icon: Clock,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["ap", "payables", "owed"],
  },
  {
    id: "page.finance.house-accounts",
    label: "House Accounts",
    href: "/app/finance/house-accounts",
    icon: Contact,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["ar", "tabs", "credit"],
  },
  {
    id: "page.finance.ar-aging",
    label: "AR Aging",
    href: "/app/finance/ar-aging",
    icon: Clock,
    category: "Pages",
    permission: LEDGER,
    feature: FINANCE_FEATURE,
    keywords: ["ar", "receivables"],
  },
  {
    id: "page.finance.guide",
    label: "Finance Guide",
    href: "/app/finance/guide",
    icon: BookOpen,
    category: "Pages",
    permission: TAKINGS,
    permissionMode: "any",
    feature: FINANCE_FEATURE,
    description: "What each finance screen is for",
    keywords: ["help", "explain"],
  },

  // ── Purchasing ─────────────────────────────────────────────────────────────────────────────
  {
    id: "page.purchasing",
    label: "Purchasing",
    href: "/app/purchasing",
    icon: Truck,
    category: "Pages",
    permission: "vendor.view",
    feature: VENDOR_FEATURE,
  },
  {
    id: "page.purchasing.vendors",
    label: "Vendors",
    href: "/app/purchasing/vendors",
    icon: Store,
    category: "Pages",
    permission: "vendor.view",
    feature: VENDOR_FEATURE,
    keywords: ["suppliers"],
  },
  {
    id: "page.purchasing.order-suggestions",
    label: "Suggested Orders",
    href: "/app/purchasing/order-suggestions",
    icon: Sparkles,
    category: "Pages",
    permission: "vendor.view",
    feature: VENDOR_FEATURE,
    keywords: ["reorder", "low stock"],
  },
  {
    id: "page.purchasing.purchase-orders",
    label: "Purchase Orders",
    href: "/app/purchasing/purchase-orders",
    icon: FileText,
    category: "Pages",
    permission: "vendor.view",
    feature: VENDOR_FEATURE,
    keywords: ["po", "orders"],
  },
  {
    id: "page.purchasing.invoices",
    label: "Vendor Invoices",
    href: "/app/purchasing/invoices",
    icon: Receipt,
    category: "Pages",
    permission: "vendor.view",
    feature: VENDOR_FEATURE,
    keywords: ["bills", "ap"],
  },
  {
    id: "page.purchasing.payments",
    label: "Vendor Payments",
    href: "/app/purchasing/payments",
    icon: HandCoins,
    category: "Pages",
    permission: "vendor.view",
    feature: VENDOR_FEATURE,
  },
  {
    id: "page.purchasing.analytics",
    label: "Purchasing Analytics",
    href: "/app/purchasing/analytics",
    icon: BarChart3,
    category: "Pages",
    permission: "vendor.view",
    feature: VENDOR_FEATURE,
    keywords: ["spend"],
  },

  // ── People ─────────────────────────────────────────────────────────────────────────────────
  {
    id: "page.hr",
    label: "HR",
    href: "/app/hr",
    icon: Users,
    category: "Pages",
    feature: HR_FEATURE,
    roles: ["OWNER", "TENANT_ADMIN"],
    keywords: ["people", "staff"],
  },
  {
    id: "page.hr.employees",
    label: "Employees",
    href: "/app/hr/employees",
    icon: Users,
    category: "Pages",
    permission: "hr.employee.view",
    feature: HR_FEATURE,
    keywords: ["staff", "people", "roster"],
  },
  {
    id: "page.hr.payroll",
    label: "Payroll",
    href: "/app/hr/payroll",
    icon: Banknote,
    category: "Pages",
    permission: "hr.employee.view",
    feature: HR_FEATURE,
    keywords: ["salary", "wages", "payslip"],
  },
  {
    id: "page.hr.schedule",
    label: "Schedule",
    href: "/app/hr/schedule",
    icon: CalendarDays,
    category: "Pages",
    permission: "hr.employee.view",
    feature: HR_FEATURE,
    keywords: ["shifts", "rota", "roster"],
  },
  {
    id: "page.hr.attendance",
    label: "Attendance & Leave",
    href: "/app/hr/attendance",
    icon: Clock,
    category: "Pages",
    permission: "hr.employee.view",
    feature: HR_FEATURE,
    keywords: ["clock in", "leave", "absence"],
  },
  {
    id: "page.hr.settings",
    label: "HR Settings",
    href: "/app/hr/settings",
    icon: Settings,
    category: "Pages",
    permission: "hr.config.view",
    feature: HR_FEATURE,
    keywords: ["departments", "designations", "job titles"],
  },
  {
    id: "page.crm",
    label: "Customers",
    href: "/app/crm",
    icon: Contact,
    category: "Pages",
    permission: "crm.customer.view",
    feature: CRM_FEATURE,
    keywords: ["guests", "loyalty", "crm"],
  },

  // ── Reporting ──────────────────────────────────────────────────────────────────────────────
  {
    id: "page.reports",
    label: "Reports",
    href: "/app/reports",
    icon: BarChart3,
    category: "Pages",
    permission: "reporting.report.view",
  },
  {
    id: "page.reports.fbr",
    label: "FBR Tax Summary",
    href: "/app/reports/fbr",
    icon: BarChart3,
    category: "Pages",
    permission: "reporting.report.fbr",
    keywords: ["tax", "fbr", "return"],
  },
  {
    id: "page.nlq",
    label: "Ask (NLQ)",
    href: "/app/nlq",
    icon: Sparkles,
    category: "Pages",
    permission: "nlq.query.run",
    feature: NLQ_FEATURE,
    keywords: ["ask", "question", "natural language"],
  },

  // ── Settings ───────────────────────────────────────────────────────────────────────────────
  {
    id: "settings.general",
    label: "Settings",
    href: "/app/settings",
    icon: Settings,
    category: "Settings",
    permission: ["rbac.manage", "branch.manage"],
    permissionMode: "any",
    keywords: ["general", "branch details"],
  },
  {
    id: "settings.branches",
    label: "Branches",
    href: "/app/branches",
    icon: Building2,
    category: "Settings",
    permission: ["rbac.manage", "branch.manage"],
    permissionMode: "any",
    keywords: ["locations", "sites", "outlets"],
  },
  {
    id: "settings.appearance",
    label: "Appearance",
    href: "/settings/appearance",
    icon: Palette,
    category: "Settings",
    roles: ["OWNER", "TENANT_ADMIN"],
    keywords: ["branding", "logo", "colour", "color"],
  },
  {
    id: "settings.users",
    label: "Users",
    href: "/app/users",
    icon: Users,
    category: "Settings",
    permission: ["rbac.manage", "rbac.user.manage"],
    permissionMode: "any",
    keywords: ["accounts", "logins", "invite"],
  },
  {
    id: "settings.roles",
    label: "Roles",
    href: "/app/roles",
    icon: ShieldCheck,
    category: "Settings",
    permission: ["rbac.manage", "rbac.user.manage", "rbac.role.manage"],
    permissionMode: "any",
    keywords: ["permissions", "rbac", "access"],
  },
  {
    id: "settings.audit",
    label: "Audit log",
    href: "/app/settings/audit",
    icon: ScrollText,
    category: "Settings",
    permission: "audit.log.view",
    keywords: ["history", "security", "who did what"],
  },
  {
    id: "settings.health",
    label: "Service health",
    href: "/app/settings/health",
    icon: Activity,
    category: "Settings",
    permission: "ops.health.view",
    keywords: ["status", "uptime", "outage", "down"],
  },
  {
    id: "settings.printers",
    label: "Printers",
    href: "/app/settings/printers",
    icon: Printer,
    category: "Settings",
    permission: ["pos.printers.admin", "branch.manage"],
    permissionMode: "any",
    feature: POS_FEATURE,
    keywords: ["print", "receipt printer", "kot"],
  },
  {
    id: "settings.tax",
    label: "Sales Tax",
    href: "/app/settings/tax",
    icon: Percent,
    category: "Settings",
    permission: "pos.tax.manage",
    feature: POS_FEATURE,
    keywords: ["gst", "vat", "tax rate"],
  },
  {
    id: "settings.service-charge",
    label: "Service Charge",
    href: "/app/settings/service-charge",
    icon: HandCoins,
    category: "Settings",
    permission: "pos.menu.view",
    feature: POS_FEATURE,
    keywords: ["gratuity", "tip"],
  },
  {
    id: "settings.ai",
    label: "AI",
    href: "/app/settings/ai",
    icon: KeyRound,
    category: "Settings",
    permission: "nlq.settings.manage",
    feature: NLQ_FEATURE,
    keywords: ["api key", "provider", "model"],
  },
  {
    id: "settings.profile",
    label: "Your profile",
    href: "/app/profile",
    icon: UserRound,
    category: "Settings",
    keywords: ["me", "my account", "password"],
  },

  // ── Platform console ───────────────────────────────────────────────────────────────────────
  {
    id: "platform.dashboard",
    label: "Platform Admin",
    href: "/platform/dashboard",
    icon: ShieldCheck,
    category: "Settings",
    permission: "platform:admin",
  },
  {
    id: "platform.impersonations",
    label: "Impersonations",
    href: "/platform/impersonations",
    icon: Handshake,
    category: "Settings",
    permission: "platform:admin",
    keywords: ["support access", "audit"],
  },
];

/**
 * The verbs. UI-SPEC §10 names three; `Toggle theme` is the fourth because it already existed in
 * the palette and removing a working control to add a registry would be a regression.
 *
 * `New order` and `Open till` both land on `/app/pos` — the terminal has no deep link for either
 * (`app/(tenant)/app/pos/page.tsx` holds its tab in `useState`, so there is no addressable
 * "new order" URL to send anyone to). They are still worth offering: each is gated on the code for
 * the ACT rather than for the page, so a till-less cashier is not offered "Open till", and the
 * label states plainly which errand the destination is for.
 */
export const ACTION_COMMANDS: CommandDescriptor[] = [
  {
    id: "action.new-order",
    label: "New order",
    href: "/app/pos",
    icon: Plus,
    category: "Quick actions",
    permission: "pos.order.create",
    feature: POS_FEATURE,
    description: "Open the POS terminal",
    keywords: ["ring", "sell", "check", "bill"],
  },
  {
    id: "action.open-till",
    label: "Open till",
    href: "/app/pos",
    icon: Banknote,
    category: "Quick actions",
    permission: "pos.till.open",
    feature: POS_FEATURE,
    description: "Start a till session on the POS",
    keywords: ["drawer", "float", "shift"],
  },
  {
    id: "action.new-purchase-order",
    label: "New purchase order",
    href: "/app/purchasing/purchase-orders",
    icon: Truck,
    category: "Quick actions",
    permission: "vendor.po.create",
    feature: VENDOR_FEATURE,
    description: "Raise a PO with a vendor",
    keywords: ["po", "reorder", "buy"],
  },
  {
    id: "action.toggle-theme",
    label: "Toggle theme",
    href: "#",
    icon: SunMoon,
    category: "Quick actions",
    effect: "toggle-theme",
    description: "Light → dark → system",
    keywords: ["dark mode", "light mode", "appearance"],
  },
];

/**
 * The fields a query is matched against.
 *
 * The href is included, minus its `app` segment: `/app/finance/gl` contributes `finance` and `gl`,
 * so a user who knows the URL can type it, while `app` — which every tenant route carries — does
 * not turn into a term that matches all sixty of them.
 */
export function commandSearchFields(command: CommandDescriptor): string[] {
  const hrefWords = command.href
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== "app" && segment !== "#");
  return [command.label, ...(command.keywords ?? []), ...hrefWords];
}
