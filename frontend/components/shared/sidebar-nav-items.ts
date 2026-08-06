import {
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
  Palette,
  Receipt,
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
  permission?: string;
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
    label: "Finance",
    href: "/app/finance/accounts",
    icon: Wallet,
    permission: "finance.journal.view",
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
    label: "Reporting",
    href: "/app/reporting",
    icon: BarChart3,
    feature: "FEATURE_REPORTING_ADVANCED",
    roles: ["OWNER", "TENANT_ADMIN"],
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
    ],
  },
  {
    label: "Finance",
    items: [
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
        label: "General",
        href: "/app/settings",
        icon: Settings,
        comingSoon: true, // /app/settings page not built yet
      },
      {
        // Tenant appearance/branding is an admin-tier configuration surface.
        label: "Appearance",
        href: "/settings/appearance",
        icon: Palette,
        roles: ["OWNER", "TENANT_ADMIN"],
      },
      {
        label: "Users",
        href: "/app/settings/users",
        icon: Users,
        permission: "rbac.manage",
        comingSoon: true, // /app/settings/users page not built yet
      },
    ],
  },
];

export const platformNavItems: NavItem[] = [
  {
    label: "Tenants",
    href: "/platform/tenants",
    icon: Building2,
    permission: "platform:tenant:read",
  },
  {
    label: "Platform Admin",
    href: "/platform/dashboard",
    icon: ShieldCheck,
    permission: "platform:admin",
  },
];
