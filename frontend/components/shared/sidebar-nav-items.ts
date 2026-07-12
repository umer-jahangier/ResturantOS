import {
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  CalendarDays,
  ChefHat,
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
    // Phase 5+: purchasing permissions not yet in DB catalog — gate by feature only
    label: "Purchasing",
    href: "/app/purchasing",
    icon: Truck,
    feature: "FEATURE_PURCHASING",
  },
  {
    // Phase 5+: HR permissions not yet in DB catalog — gate by feature only
    label: "HR",
    href: "/app/hr",
    icon: Users,
    feature: "FEATURE_HR",
  },
  {
    // Phase 5+: CRM permissions not yet in DB catalog — gate by feature only
    label: "CRM",
    href: "/app/crm",
    icon: Contact,
    feature: "FEATURE_CRM",
  },
  {
    // Phase 5+: reporting permissions not yet in DB catalog — gate by feature only
    label: "Reporting",
    href: "/app/reporting",
    icon: BarChart3,
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
    ],
  },
  {
    label: "Purchasing",
    items: [
      {
        // Phase 5+: purchasing permissions not yet in DB catalog — gate by feature only
        label: "Purchasing",
        href: "/app/purchasing",
        icon: Truck,
        feature: "FEATURE_PURCHASING",
      },
    ],
  },
  {
    label: "People",
    items: [
      {
        // Phase 5+: HR permissions not yet in DB catalog — gate by feature only
        label: "HR",
        href: "/app/hr",
        icon: Users,
        feature: "FEATURE_HR",
      },
      {
        // Phase 5+: CRM permissions not yet in DB catalog — gate by feature only
        label: "CRM",
        href: "/app/crm",
        icon: Contact,
        feature: "FEATURE_CRM",
      },
    ],
  },
  {
    label: "Reporting",
    items: [
      {
        // Phase 5+: reporting permissions not yet in DB catalog — gate by feature only
        label: "Reports",
        href: "/app/reporting",
        icon: BarChart3,
        feature: "FEATURE_REPORTING",
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
        permission: "rbac.manage",
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
