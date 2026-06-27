"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DollarSign,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  UtensilsCrossed,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { PermissionGuard } from "./permission-guard";
import { FeatureGuard } from "./feature-guard";

// Mobile bottom navigation bar — only visible below `md` breakpoint (DS-05).
// Shows 5 primary nav icons with active-state highlighting. Each item is wrapped
// in PermissionGuard to match the sidebar guard pattern.
interface BottomNavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  permission?: string;
  feature?: string;
}

const BOTTOM_NAV_ITEMS: BottomNavItem[] = [
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
    label: "Settings",
    href: "/app/settings",
    icon: Settings,
  },
];

interface BottomNavLinkProps {
  item: BottomNavItem;
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

  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex items-center justify-around border-t bg-background/95 backdrop-blur h-16 md:hidden"
      aria-label="Mobile navigation"
    >
      {BOTTOM_NAV_ITEMS.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const link = <BottomNavLink key={item.href} item={item} active={active} />;

        const withFeature = item.feature ? (
          <FeatureGuard key={`${item.href}-feature`} feature={item.feature} failOpenOnError>
            {link}
          </FeatureGuard>
        ) : (
          link
        );

        if (item.permission) {
          return (
            <PermissionGuard key={item.href} require={item.permission}>
              {withFeature}
            </PermissionGuard>
          );
        }

        return withFeature;
      })}
    </nav>
  );
}
