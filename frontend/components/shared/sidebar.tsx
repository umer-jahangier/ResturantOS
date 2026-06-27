"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChefHat, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { PermissionGuard } from "./permission-guard";
import { FeatureGuard } from "./feature-guard";
import { BranchSwitcher } from "./branch-switcher";
import { navGroups, type NavItem, type NavGroup } from "./sidebar-nav-items";
import { useNavGroupVisibility } from "@/lib/hooks/auth/use-nav-visibility";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Permission/feature-conditioned grouped sidebar (DS-05 upgrade). Each item is
// wrapped in FeatureGuard → PermissionGuard to show only if permission is held
// AND feature is enabled. Supports collapse-to-icon mode with tooltips.
interface SidebarProps {
  groups?: NavGroup[];
  mobileOpen?: boolean;
}

interface NavLinkProps {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
}

function NavLink({ item, active, collapsed }: NavLinkProps) {
  const Icon = item.icon;

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            className={cn(
              "flex items-center justify-center rounded-md p-2 text-sm font-medium transition-colors touch-target",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{item.label}</p>
          {item.badge !== undefined && (
            <span className="ml-1 text-xs opacity-75">({item.badge})</span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

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
      <Icon className="size-4 shrink-0" />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

interface GuardedNavItemProps {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
}

function GuardedNavItem({ item, collapsed, pathname }: GuardedNavItemProps) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

  const link = <NavLink item={item} active={active} collapsed={collapsed} />;

  const withFeature = item.feature ? (
    <FeatureGuard feature={item.feature} failOpenOnError>
      {link}
    </FeatureGuard>
  ) : (
    link
  );

  const guarded = item.permission ? (
    <PermissionGuard require={item.permission}>{withFeature}</PermissionGuard>
  ) : (
    withFeature
  );

  return <div>{guarded}</div>;
}

interface NavGroupSectionProps {
  group: NavGroup;
  collapsed: boolean;
  pathname: string;
}

function NavGroupSection({ group, collapsed, pathname }: NavGroupSectionProps) {
  const { hasVisibleItems, isItemVisible } = useNavGroupVisibility(group);

  if (!hasVisibleItems) {
    return null;
  }

  return (
    <div>
      {!collapsed && (
        <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {group.label}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {group.items.map((item) =>
          isItemVisible(item) ? (
            <GuardedNavItem
              key={item.href}
              item={item}
              collapsed={collapsed}
              pathname={pathname}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

export function Sidebar({ groups = navGroups, mobileOpen = false }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          "flex flex-col border-r bg-background transition-all duration-200",
          // Desktop: always visible, collapsible width
          "hidden md:flex",
          collapsed ? "w-16" : "w-64",
          // Mobile: fixed overlay, shown when mobileOpen
          mobileOpen && "fixed inset-y-0 left-0 z-50 flex md:relative md:flex",
        )}
        data-slot="sidebar"
        data-collapsed={collapsed}
      >
        {/* Brand area */}
        <div
          className={cn(
            "flex items-center gap-2 border-b px-3 py-4",
            collapsed && "justify-center px-2",
          )}
        >
          <ChefHat className="size-6 shrink-0 text-primary" />
          {!collapsed && (
            <span className="truncate text-base font-semibold">RestaurantOS</span>
          )}
        </div>

        {/* Branch switcher — US-1.3: only when user has >1 assigned branch */}
        {!collapsed && (
          <div className="border-b px-3 py-3">
            <BranchSwitcher />
          </div>
        )}

        {/* Grouped navigation */}
        <nav
          className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-3"
          aria-label="Primary"
        >
          {groups.map((group) => (
            <NavGroupSection
              key={group.label}
              group={group}
              collapsed={collapsed}
              pathname={pathname}
            />
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="border-t p-2">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "flex w-full items-center justify-center rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground touch-target",
              collapsed && "justify-center",
            )}
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <>
                <ChevronLeft className="size-4" />
                <span className="ml-2 text-xs">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
