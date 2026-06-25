"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { PermissionGuard } from "./permission-guard";
import { FeatureGuard } from "./feature-guard";
import { tenantNavItems, type NavItem } from "./sidebar-nav-items";

// Permission/feature-conditioned navigation (FE-05). Each item is wrapped so it
// shows only if its permission is held AND its feature is enabled — composing
// PermissionGuard + FeatureGuard. Active route is highlighted via usePathname.
interface SidebarProps {
  items?: NavItem[];
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar({ items = tenantNavItems }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);

        const link = <NavLink item={item} active={active} />;
        const withFeature = item.feature ? (
          <FeatureGuard feature={item.feature}>{link}</FeatureGuard>
        ) : (
          link
        );
        const guarded = item.permission ? (
          <PermissionGuard require={item.permission}>{withFeature}</PermissionGuard>
        ) : (
          withFeature
        );

        return <div key={item.href}>{guarded}</div>;
      })}
    </nav>
  );
}
