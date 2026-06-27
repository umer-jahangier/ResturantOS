import {
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  Contact,
  LayoutDashboard,
  LineChart,
  Palette,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

// Typed nav config. An item shows only if its `permission` is held AND its
// `feature` is enabled (composed by the Sidebar); an item with neither is always
// shown. Tenant hrefs use the real `/app/*` prefix and platform-admin entries
// use `/platform/*` (matches the 04-01 URL scheme + the proxy.ts matcher).
// Concrete module pages land in later phases — these are links/placeholders.
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  feature?: string;
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
    permission: "pos.order.create",
    feature: "FEATURE_POS",
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
    permission: "purchasing:read",
    feature: "FEATURE_PURCHASING",
  },
  {
    label: "HR",
    href: "/app/hr",
    icon: Users,
    permission: "hr:read",
    feature: "FEATURE_HR",
  },
  {
    label: "CRM",
    href: "/app/crm",
    icon: Contact,
    permission: "crm:read",
    feature: "FEATURE_CRM",
  },
  {
    label: "Reporting",
    href: "/app/reporting",
    icon: BarChart3,
    permission: "reporting:read",
    feature: "FEATURE_REPORTING",
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
        permission: "pos.order.create",
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
    ],
  },
  {
    label: "Purchasing",
    items: [
      {
        label: "Purchasing",
        href: "/app/purchasing",
        icon: Truck,
        permission: "purchasing:read",
        feature: "FEATURE_PURCHASING",
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
      },
      {
        label: "Appearance",
        href: "/settings/appearance",
        icon: Palette,
      },
      {
        label: "Users",
        href: "/app/settings/users",
        icon: Users,
        permission: "users:manage",
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
