"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DollarSign, LayoutDashboard, Palette, ShoppingCart, UtensilsCrossed } from "lucide-react";

import { cn } from "@/lib/utils";
import type { NavItem } from "./sidebar-nav-items";
import { useNavGroupVisibility } from "@/lib/hooks/auth/use-nav-visibility";

// Mobile bottom navigation bar — only visible below `md` breakpoint (DS-05).
// Shows up to 5 primary nav icons with active-state highlighting.
//
// 20-01: visibility now runs through `useNavGroupVisibility`, the same guard the sidebar
// uses, instead of a hand-wired PermissionGuard/FeatureGuard pair. Same semantics for
// permission and feature (feature fails open on error, hides while pending), plus the two
// this bar never honoured: `roles` and — the reason for the change — `comingSoon`.
//
// The dead link this fixes: the fifth tab pointed at `/app/settings`, which has no
// `page.tsx` and never has. `sidebar-nav-items.ts:334` has marked it `comingSoon: true`
// since it was added; the mobile bar never got the memo, so a phone user tapping Settings
// got a 404 (UI-SPEC §4.2 "Dead links must be fixed, not carried over"). The only settings
// surface that actually exists is `/settings/appearance`, so that is where the tab goes —
// role-gated exactly as its sidebar twin is (`sidebar-nav-items.ts:336-342`).
const BOTTOM_NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/app/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Orders",
    href: "/app/pos",
    icon: ShoppingCart,
    permission: "pos.order.create",
    feature: "FEATURE_POS",
  },
  {
    label: "Menu",
    href: "/app/inventory",
    icon: UtensilsCrossed,
    permission: "inventory.item.view",
    feature: "FEATURE_INVENTORY",
  },
  {
    label: "Finance",
    href: "/app/finance/accounts",
    icon: DollarSign,
    permission: "finance.journal.view",
    feature: "FEATURE_FINANCE",
  },
  {
    label: "Appearance",
    href: "/settings/appearance",
    icon: Palette,
    roles: ["OWNER", "TENANT_ADMIN"],
  },
];

const BOTTOM_NAV_GROUP = { label: "Mobile navigation", items: BOTTOM_NAV_ITEMS };

interface BottomNavLinkProps {
  item: NavItem;
  active: boolean;
}

function BottomNavLink({ item, active }: BottomNavLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={cn(
        "touch-target flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" />
      <span>{item.label}</span>
    </Link>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const { isItemVisible } = useNavGroupVisibility(BOTTOM_NAV_GROUP, {
    failOpenOnFeatureError: true,
  });

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex items-center justify-around border-t bg-background/95 backdrop-blur h-16 md:hidden"
      aria-label="Mobile navigation"
    >
      {BOTTOM_NAV_ITEMS.filter(isItemVisible).map((item) => (
        <BottomNavLink
          key={item.href}
          item={item}
          active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
        />
      ))}
    </nav>
  );
}
