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
  Clock,
  Contact,
  LayoutDashboard,
  LineChart,
  MonitorSmartphone,
  MonitorSpeaker,
  Palette,
  Printer,
  Receipt,
  Route,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Truck,
  Users,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { FeatureFlag } from "@/lib/features/feature-flags";

// Typed nav config. An item shows only if its `permission` is held AND its
// `feature` is enabled (composed by the Sidebar); an item with neither is always
// shown. Tenant hrefs use the real `/app/*` prefix and platform-admin entries
// use `/platform/*` (matches the 04-01 URL scheme + the proxy.ts matcher).
// Concrete module pages land in later phases — these are links/placeholders.
// `feature` is typed as `FeatureFlag` (not `string`) so a flag the backend
// does not grant is a COMPILE error, not a silently-invisible nav item.
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string | string[];
  /**
   * How a multi-code `permission` is combined. Defaults to `"all"`, which is what every
   * single-code entry has always meant.
   *
   * <p>Added by 19-01 because the two administration surfaces need `"any"`: the backend gates
   * `/api/v1/users` on `hasAnyAuthority('rbac.manage','rbac.user.manage')` and branch writes on
   * `hasAnyAuthority('rbac.manage','branch.manage')`. OWNER holds `rbac.manage`; TENANT_ADMIN
   * deliberately does NOT (13-02 split the authority so a tenant admin cannot mint an OWNER) and
   * holds the narrower codes instead. A nav item requiring both would hide Users from the exact
   * role the screen exists for — measured: a TENANT_ADMIN's token carries `rbac.user.manage` and
   * `rbac.role.manage` and not `rbac.manage`.
   */
  permissionMode?: "all" | "any";
  feature?: FeatureFlag;
  // Role gate for items with no permission in the DB catalog yet (HR/CRM/Reporting
  // placeholders). When set, the item shows only if the user holds one of these
  // roles — otherwise a feature-only item leaks to every role (e.g. kitchen staff).
  roles?: string[];
  // The target route is not built yet (renders a 404). Hidden from the sidebar until
  // the page ships — flip to false / remove once the module exists. Keeps the nav
  // free of dead links without losing the planned-module config.
  comingSoon?: boolean;
  badge?: number | string;
}

// NavGroup groups items under a labelled section heading in the sidebar.
export interface NavGroup {
  label: string;
  items: NavItem[];
}

// ─── Flat list (kept for backward compat — existing consumers) ────────────────
export const tenantNavItems: NavItem[] = [
  { label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
  {
    label: "POS",
    href: "/app/pos",
    icon: ShoppingCart,
    permission: "pos.order.view",
    feature: "FEATURE_POS",
  },
  {
    label: "Kitchen Display",
    href: "/app/kitchen",
    icon: ChefHat,
    permission: "pos.kds.view",
    feature: "FEATURE_KDS",
  },
  {
    label: "Inventory",
    href: "/app/inventory",
    icon: Boxes,
    permission: "inventory.item.view",
    feature: "FEATURE_INVENTORY",
  },
  {
    // 37-12: lands on Takings, not the chart of accounts — the evening cash-up is what this
    // module is opened for (D-37-02). `any` mirrors the three codes `DailyTakingsController`
    // gates on, so the BRANCH MANAGER who actually counts the drawer can reach it; the ledger
    // tabs behind it keep needing `finance.journal.view` (see the finance layout's inner guard).
    // Checked against live tokens: a cashier holds `pos.till.open`/`close` but NOT
    // `pos.till.review`, so this does not put branch revenue in front of the till operator.
    label: "Finance",
    href: "/app/finance/takings",
    icon: Wallet,
    permission: ["finance.journal.view", "pos.order.view.all", "pos.till.review"],
    permissionMode: "any",
    feature: "FEATURE_FINANCE",
  },
  {
    label: "Purchasing",
    href: "/app/purchasing",
    icon: Truck,
    permission: "vendor.view",
    feature: "FEATURE_VENDOR",
  },
  {
    // Phase 5+: HR permissions not yet in DB catalog — admin/owner only until built.
    label: "HR",
    href: "/app/hr",
    icon: Users,
    feature: "FEATURE_HR",
    roles: ["OWNER", "TENANT_ADMIN"],
  },
  {
    label: "Customers",
    href: "/app/crm",
    icon: Contact,
    permission: "crm.customer.view",
    feature: "FEATURE_CRM",
  },
  {
    // Phase 5+: reporting permissions not yet in DB catalog — admin/owner only until built.
    //
    // GA-091: `/app/reporting` 404s, and this — the FLAT list — declared it without
    // `comingSoon`, while the grouped list at `:300` (the one the sidebar actually renders)
    // marks it correctly. The same route, guarded in one list and unguarded in the other, is
    // exactly the drift that made GA-053 live; whichever list gets wired next inherits the bug.
    // The two are now consistent.
    label: "Reporting",
    href: "/app/reporting",
    icon: BarChart3,
    feature: "FEATURE_REPORTING_ADVANCED",
    roles: ["OWNER", "TENANT_ADMIN"],
    comingSoon: true, // /app/reporting page not built yet — mirrors navGroups (GA-091)
  },
  {
    // 12-08: named reports + FBR Tax Summary. Deliberately NO `feature` — 12-01 left
    // `/api/v1/reporting/` out of RouteFeatureMap on purpose (basic reports are core, not
    // FEATURE_REPORTING_ADVANCED-gated; attaching that flag here would hide the nav item for
    // STARTER tenants fully entitled to use it). Gated on the reporting.report.view permission.
    label: "Reports",
    href: "/app/reports",
    icon: BarChart3,
    permission: "reporting.report.view",
  },
  {
    // 12-08: realtime KPI dashboard (12-06's WebSocket). No `feature` for the same reason above.
    label: "Realtime Dashboard",
    href: "/app/dashboard/realtime",
    icon: LineChart,
    permission: "reporting.dashboard.view",
  },
  {
    // 12-09: natural-language query. Gated on BOTH FEATURE_NLQ (GROWTH+, real per 12-01's
    // TierFeatureDefaults fix) and the nlq.query.run permission the backend @PreAuthorizes.
    label: "Ask (NLQ)",
    href: "/app/nlq",
    icon: Sparkles,
    permission: "nlq.query.run",
    feature: "FEATURE_NLQ",
  },
];

// ─── Grouped nav (used by upgraded Sidebar for DS-05 shell chrome) ─────────────
export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Orders",
    items: [
      {
        label: "POS",
        href: "/app/pos",
        icon: ShoppingCart,
        permission: "pos.order.view",
        feature: "FEATURE_POS",
      },
      {
        label: "Kitchen Display",
        href: "/app/kitchen",
        icon: ChefHat,
        permission: "pos.kds.view",
        feature: "FEATURE_KDS",
      },
      {
        // Manager/owner till review — approve, flag, or annotate a cashier's closed till.
        // Gated on the same permission the review endpoints enforce, so cashiers never see it.
        label: "Till Review",
        href: "/app/pos/tills",
        icon: Banknote,
        permission: "pos.till.review",
        feature: "FEATURE_POS",
      },
    ],
  },
  {
    label: "Menu",
    items: [
      {
        label: "Inventory",
        href: "/app/inventory",
        icon: Boxes,
        permission: "inventory.item.view",
        feature: "FEATURE_INVENTORY",
      },
      {
        // Menu item/category self-serve creation — sits under the same "Menu" group as
        // Inventory (where recipes are written for these items), even though pos-service owns
        // the data. gated on pos.menu.manage: only OWNER/TENANT_ADMIN/MANAGER can edit the menu.
        label: "Menu Items",
        href: "/app/menu/items",
        icon: UtensilsCrossed,
        permission: "pos.menu.manage",
        feature: "FEATURE_POS",
      },
      {
        // 19b: the dining-table catalogue. Gated on `pos.tables.admin` — the NEW catalogue
        // permission, deliberately NOT the existing `pos.tables.manage`, which WAITER holds so
        // a waiter can seat a table. Using the latter here would put a floor-plan editor in
        // every waiter's sidebar. Sits under "Menu" alongside Menu Items because both are the
        // same job: what this restaurant offers and where it seats people.
        label: "Tables",
        href: "/app/tables",
        icon: Armchair,
        permission: "pos.tables.admin",
        feature: "FEATURE_POS",
      },
      {
        // 28-06: the station catalogue. `/api/v1/pos/stations` has had full CRUD since phase 3
        // and had ZERO frontend callers until this screen, so creating a station required curl —
        // exactly what D-28-05 refuses. Gated on `pos.menu.manage`, which is what the create,
        // update and deactivate endpoints @PreAuthorize; the list itself needs only
        // `pos.menu.view`, but a nav entry to a screen whose every action 403s is worse than no
        // entry. Sits under "Menu" beside Tables: both answer "what does this restaurant have".
        label: "Stations",
        href: "/app/stations",
        icon: MonitorSpeaker,
        permission: "pos.menu.manage",
        feature: "FEATURE_POS",
      },
      {
        // S1-01: where each dish is MADE. Stations could be created (above) and menu items could
        // be created (Menu Items) and there was no screen anywhere that joined the two — so every
        // item resolved to no station, a mixed check produced one DEFAULT ticket, and the bar
        // never received a drink. The two write endpoints have existed since 28-05 with zero
        // callers; this entry is the first way into them.
        //
        // Sits directly under Stations because it is the second half of that job, and is gated on
        // the same `pos.menu.manage` both writes @PreAuthorize — a nav entry to a screen whose
        // every control 403s is worse than no entry.
        label: "Station Routing",
        href: "/app/menu/routing",
        icon: Route,
        permission: "pos.menu.manage",
        feature: "FEATURE_POS",
      },
      {
        // 28-09: the POS terminal catalogue — a named till profile with a menu scope and the
        // stations it fires to (D-28-03). Registered here, by plan 28-06, in the SAME edit as
        // Stations: phase 19b had two agents editing this shared file in one wave and had to
        // reconcile it by hand. A nav entry pointing at a route that lands a wave later is the
        // cheaper of the two trades.
        label: "POS Terminals",
        href: "/app/terminals",
        icon: MonitorSmartphone,
        permission: "pos.terminals.admin",
        feature: "FEATURE_POS",
      },
      {
        // S1-06: which PRINTERS this branch has, and which machine drives them. Phase 26 built the
        // renderer, the agent, the queue, the credential, the dispatch and all four frontend layers
        // of the registry and never built the page — so /app/settings/printers was a 404 for all
        // four personas, no nav entry mentioned printing, and every bill was a browser print
        // dialog.
        //
        // Sits beside Stations and POS Terminals because it is the same kind of decision: what
        // equipment this branch has. Gated on `pos.printers.admin` (auth changelog 088), the same
        // holder set as `pos.tables.admin` and `pos.terminals.admin` — a nav entry to a screen
        // whose every control 403s is worse than no entry, which is why the endpoints behind it
        // accept that code too rather than only `branch.manage`.
        label: "Printers",
        href: "/app/settings/printers",
        icon: Printer,
        permission: ["pos.printers.admin", "branch.manage"],
        permissionMode: "any",
        feature: "FEATURE_POS",
      },
    ],
  },
  {
    label: "Finance",
    items: [
      {
        // 37-13: the explanation of this module, gated as widely as Takings. The person most
        // likely to need it is the one who has seen the least of the module.
        label: "Guide",
        href: "/app/finance/guide",
        icon: BookOpen,
        permission: ["finance.journal.view", "pos.order.view.all", "pos.till.review"],
        permissionMode: "any",
        feature: "FEATURE_FINANCE",
      },
      {
        // 37-12. Leads the group for the same reason it leads the tab bar.
        label: "Takings",
        href: "/app/finance/takings",
        icon: Wallet,
        permission: ["finance.journal.view", "pos.order.view.all", "pos.till.review"],
        permissionMode: "any",
        feature: "FEATURE_FINANCE",
      },
      {
        label: "Accounts",
        href: "/app/finance/accounts",
        icon: Wallet,
        permission: "finance.journal.view",
        feature: "FEATURE_FINANCE",
      },
      {
        label: "Journal Entries",
        href: "/app/finance/journal-entries",
        icon: BookOpen,
        permission: "finance.journal.view",
        feature: "FEATURE_FINANCE",
      },
      {
        label: "General Ledger",
        href: "/app/finance/gl",
        icon: LineChart,
        permission: "finance.journal.view",
        feature: "FEATURE_FINANCE",
      },
      {
        label: "Periods",
        href: "/app/finance/periods",
        icon: CalendarDays,
        permission: "finance.journal.view",
        feature: "FEATURE_FINANCE",
      },
      {
        // FIN-05 (10-14): expense create/approve/reject inbox.
        label: "Expenses",
        href: "/app/finance/expenses",
        icon: Receipt,
        permission: "finance.journal.view",
        feature: "FEATURE_FINANCE",
      },
      {
        // FIN-05 (10-14): first frontend consumer of GET /api/v1/finance/ap/aging.
        label: "AP Aging",
        href: "/app/finance/ap-aging",
        icon: Clock,
        permission: "finance.journal.view",
        feature: "FEATURE_FINANCE",
      },
    ],
  },
  {
    label: "Purchasing",
    items: [
      {
        label: "Purchasing",
        href: "/app/purchasing",
        icon: Truck,
        permission: "vendor.view",
        feature: "FEATURE_VENDOR",
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        // Phase 5+: HR permissions not yet in DB catalog — admin/owner only until built.
        label: "HR",
        href: "/app/hr",
        icon: Users,
        feature: "FEATURE_HR",
        roles: ["OWNER", "TENANT_ADMIN"],
      },
      {
        // Gated on the real permission now that changeset 047 seeds crm.* — the roles[] fallback
        // existed only because the codes were missing from the catalog entirely.
        label: "Customers",
        href: "/app/crm",
        icon: Contact,
        permission: "crm.customer.view",
        feature: "FEATURE_CRM",
      },
    ],
  },
  {
    label: "Reporting",
    items: [
      {
        // Phase 5+: reporting permissions not yet in DB catalog — admin/owner only until built.
        // Labelled "Reporting", not "Reports": phase 12 shipped a REAL /app/reports page in this
        // same group, and two items both reading "Reports" (one of them a dead link) is the kind
        // of nav that gets bug-reported. This one stays comingSoon — /app/reporting still has no
        // page, only /app/reports and /app/nlq exist.
        label: "Reporting",
        href: "/app/reporting",
        icon: BarChart3,
        feature: "FEATURE_REPORTING_ADVANCED",
        roles: ["OWNER", "TENANT_ADMIN"],
        comingSoon: true, // /app/reporting page not built yet (Phase 5+)
      },
      {
        // 12-08: named reports + FBR Tax Summary. Deliberately NO `feature` — see the flat-list
        // entry above for why (basic reports are core, not gated at the gateway).
        label: "Reports",
        href: "/app/reports",
        icon: BarChart3,
        permission: "reporting.report.view",
      },
      {
        // 12-08: realtime KPI dashboard.
        label: "Realtime Dashboard",
        href: "/app/dashboard/realtime",
        icon: LineChart,
        permission: "reporting.dashboard.view",
      },
      {
        // 12-09: natural-language query (FEATURE_NLQ, GROWTH+; permission nlq.query.run).
        label: "Ask (NLQ)",
        href: "/app/nlq",
        icon: Sparkles,
        permission: "nlq.query.run",
        feature: "FEATURE_NLQ",
      },
    ],
  },
  {
    label: "Settings",
    items: [
      {
        // 19-01: the page now exists (`app/(tenant)/app/settings/page.tsx`), so `comingSoon` is
        // gone. It is gated rather than open because the branch details it edits are written
        // through `PUT /api/v1/branches/{id}`, whose own gate is
        // `hasAnyAuthority('rbac.manage','branch.manage')` — an ungated entry would offer every
        // cashier a settings page whose only control 403s.
        label: "General",
        href: "/app/settings",
        icon: Settings,
        permission: ["rbac.manage", "branch.manage"],
        permissionMode: "any",
      },
      {
        // Tenant appearance/branding is an admin-tier configuration surface.
        label: "Appearance",
        href: "/settings/appearance",
        icon: Palette,
        roles: ["OWNER", "TENANT_ADMIN"],
      },
      {
        // 19-01: GA-003. The page is `app/(tenant)/app/users/page.tsx`, so the href moves off the
        // never-built `/app/settings/users` and `comingSoon` is gone.
        //
        // The gate was `rbac.manage` ALONE, which would have hidden this screen from TENANT_ADMIN —
        // the role it exists for. 13-02 split user/branch administration off `rbac.manage`
        // precisely so a tenant admin does not hold it, and the backend gates `/api/v1/users` on
        // `hasAnyAuthority('rbac.manage','rbac.user.manage')`. The nav now matches the endpoint.
        label: "Users",
        href: "/app/users",
        icon: Users,
        permission: ["rbac.manage", "rbac.user.manage"],
        permissionMode: "any",
      },
      {
        // F4: who did what, and when. audit_events held 3,457 rows for the working tenant, the
        // permission was seeded, the endpoint answered 200 and the gateway routed it — and there
        // was no page and no nav entry anywhere matching audit, log, activity, history or
        // security. The 2026-08-12 walkthrough's own words: "nobody in the building can read the
        // audit log."
        //
        // Gated on `audit.log.view` — the SAME code `AuditQueryController` @PreAuthorizes, not a
        // broader one. A nav entry to a screen whose read 403s is worse than no entry, and a
        // broader gate here would offer it to a MANAGER, who deliberately does not hold it: a
        // manager can void an order, and a manager who can also read the void log is a manager who
        // can see whether anyone is looking.
        //
        // Sits beside Users and Service health because it is read by the same two roles, on the
        // same errand — checking on the business rather than running a shift.
        label: "Audit log",
        href: "/app/settings/audit",
        icon: ScrollText,
        permission: "audit.log.view",
      },
      {
        // S1-09: is the software running. There was no health route anywhere under
        // `app/(tenant)/app/` — crm, dashboard, finance, hr, inventory, kitchen, menu, nlq, pos,
        // profile, purchasing, reports, settings, stations, tables, terminals, users, and nothing
        // that could answer it — so when six services were down the register's manager got a
        // generic 503 on the till, the kitchen board, the customer file and payroll at once and had
        // no way to learn why. The only recourse was to telephone someone who could run `ps`.
        //
        // Gated on `ops.health.view` (auth changelog 089), granted to OWNER and TENANT_ADMIN: the
        // two people who make that phone call, and the two /app/settings already admits. A cashier
        // is deliberately not offered it — the till now tells them in plain language that the
        // ordering service is unreachable and what still works, which is what the person at the
        // till actually needs; a fleet inventory is not.
        label: "Service health",
        href: "/app/settings/health",
        icon: Activity,
        permission: "ops.health.view",
      },
    ],
  },
];

export const platformNavItems: NavItem[] = [
  {
    // GA-053: this was the product's only UNGUARDED dead link — `/platform/tenants` has no
    // `page.tsx` and returns a bare "404: This page could not be found." Five of the nine audits
    // reported it independently. Every other unbuilt route in this file is correctly marked
    // (`:300`, `:334`, `:348`); this one was simply missed, and the miss is what made it live.
    //
    // The entry is kept rather than deleted because Phase 21 builds this screen and the ordering
    // here is the console's intended shape. `comingSoon` is the honest state until then: not
    // "this does not exist", but "this is not built yet, so do not offer it".
    label: "Tenants",
    href: "/platform/tenants",
    icon: Building2,
    permission: "platform:tenant:read",
    comingSoon: true, // /platform/tenants page not built yet (Phase 21)
  },
  {
    label: "Platform Admin",
    href: "/platform/dashboard",
    icon: ShieldCheck,
    permission: "platform:admin",
  },
];
