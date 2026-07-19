import {
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
  Truck,
  Users,
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
    // Phase 5+: CRM permissions not yet in DB catalog — admin/owner only until built.
    label: "CRM",
    href: "/app/crm",
    icon: Contact,
    feature: "FEATURE_CRM",
    roles: ["OWNER", "TENANT_ADMIN"],
  },
  {
    // Phase 5+: reporting permissions not yet in DB catalog — admin/owner only until built.
    label: "Reporting",
    href: "/app/reporting",
    icon: BarChart3,
    feature: "FEATURE_REPORTING_ADVANCED",
    roles: ["OWNER", "TENANT_ADMIN"],
  },
];

// ─── Grouped nav (used by upgraded Sidebar for DS-05 shell chrome) ─────────────
export const navGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/app/dashboard", icon: LayoutDashboard },
    ],
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
        comingSoon: true, // /app/hr page not built yet (Phase 5+)
      },
      {
        // Phase 5+: CRM permissions not yet in DB catalog — admin/owner only until built.
        label: "CRM",
        href: "/app/crm",
        icon: Contact,
        feature: "FEATURE_CRM",
        roles: ["OWNER", "TENANT_ADMIN"],
        comingSoon: true, // /app/crm page not built yet (Phase 5+)
      },
    ],
  },
  {
    label: "Reporting",
    items: [
      {
        // Phase 5+: reporting permissions not yet in DB catalog — admin/owner only until built.
        label: "Reports",
        href: "/app/reporting",
        icon: BarChart3,
        feature: "FEATURE_REPORTING_ADVANCED",
        roles: ["OWNER", "TENANT_ADMIN"],
        comingSoon: true, // /app/reporting page not built yet (Phase 5+)
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
