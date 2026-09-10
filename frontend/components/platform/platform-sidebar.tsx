"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import { ActiveRail } from "@/components/shared/active-rail";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  isNavItemActive,
  platformNavGroups,
  type PlatformNavItem,
} from "@/components/platform/platform-nav-items";

/**
 * The control plane's navigation rail.
 *
 * <h3>It is the tenant sidebar's language, deliberately and to the class</h3>
 *
 * Same 240px width, same `bg-sidebar` one step off the content ground, same brand-hue seam down
 * the right edge, same UPPERCASE `tracking-eyebrow` group labels at the tertiary tier, same
 * full-bleed slab rows, and the same {@link ActiveRail} — imported, not re-implemented, from
 * `components/shared/active-rail.tsx`. A SuperAdmin is the same person who opens the tenant app;
 * the console being a visibly different piece of software is a cost with no benefit.
 *
 * <p>What distinguishes it is not the furniture. It is the persistent `--warning` rule and the
 * PLATFORM chip in the bar above (UI-SPEC §7.5), which exist so that nobody mistakes a
 * platform-wide action for a tenant-scoped one — a suspend here takes a restaurant offline. That
 * warning is worth more when everything AROUND it is familiar, because it is then the only thing
 * on the screen that is different.
 *
 * <h3>The brand block names the product, not a tenant</h3>
 *
 * The tenant rail draws the signed-in tenant's own initial from `useTenantBrand()`. There is no
 * tenant here — a control-plane token carries a null `tenant_id`, which is the whole reason the
 * gateway maintains `TENANT_OPTIONAL_PATHS` — so the monogram is the product's own and the
 * sub-line says which plane you are on. Showing a restaurant's name in this rail would be the
 * exact confusion the warning rule exists to prevent.
 */

/**
 * One row. A slab, not an inset pill, for the reason the tenant rail records: the rail sits flush
 * at `left: 0` and a rounded inset row has no edge for it to attach to.
 */
function PlatformNavLink({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: PlatformNavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  // GA-053: a nav entry pointing at a route with no page is a real 404 in a console whose whole
  // job is to be trusted. Until the screen lands the row states its own absence and is not an
  // anchor — a screen reader is told it is disabled rather than being offered a broken link.
  if (item.comingSoon) {
    const row = (
      <span
        aria-disabled="true"
        data-slot="platform-nav-item"
        data-coming-soon="true"
        className={cn(
          "relative flex cursor-not-allowed items-center gap-2.5 px-5 py-2 text-small text-foreground-tertiary",
          collapsed && "justify-center px-2",
        )}
      >
        <Icon className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            <span className="shrink-0 rounded-full border border-border px-1.5 text-label tracking-wider uppercase">
              Soon
            </span>
          </>
        )}
      </span>
    );

    return collapsed ? (
      <Tooltip>
        <TooltipTrigger asChild>{row}</TooltipTrigger>
        <TooltipContent side="right">
          <p>{item.label} — not built yet</p>
        </TooltipContent>
      </Tooltip>
    ) : (
      row
    );
  }

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      data-slot="platform-nav-item"
      className={cn(
        // `touch-floor` (globals.css): 44px tall below `lg`, the demo's 34px slab at and above.
        // The rail is `hidden md:flex`, so the widths at which these rows are visible below `lg`
        // are 768–1023 — a tablet, held in a hand.
        "touch-floor relative flex items-center gap-2.5 px-5 py-2 text-small font-normal transition-colors",
        collapsed && "justify-center px-2",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      {active && <ActiveRail />}
      <Icon className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-80")} />
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The product monogram (`NEXUS_ERP_Demo.html:85-99`): 36px square, radius 8, a 135° gold gradient,
 * the display serif at 800, near-black glyph, and its own coloured drop shadow — so the brand
 * reads as an OBJECT rather than a wordmark.
 */
function PlatformBrandMark({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 border-b border-sidebar-border px-5 pt-5 pb-4",
        collapsed && "justify-center px-2",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg",
          "bg-linear-to-br from-primary-400 to-primary-600",
          "font-heading text-h2 font-extrabold text-primary-solid-foreground",
          "shadow-[0_2px_12px_color-mix(in_oklab,var(--primary-400)_30%,transparent)]",
        )}
      >
        R
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-small font-bold tracking-brandmark text-sidebar-foreground uppercase">
            RestaurantOS
          </span>
          {/* The demo demotes the product category to a 10px sub-line so the brand owns the block.
              Ours names the PLANE, which is the one fact a reader of this rail most needs. */}
          <span className="block truncate text-label text-foreground-tertiary">Control plane</span>
        </span>
      )}
    </div>
  );
}

/**
 * The identity block pinned to the bottom (`NEXUS_ERP_Demo.html:133-145`).
 *
 * <h3>What it shows, and why it is not a name</h3>
 *
 * The demo's footer reads *"Ahmed Raza / Super Admin"*. This product cannot name the signed-in
 * operator: `GET /api/v1/auth/me`, `/api/v1/me` and `/api/v1/auth/profile` are all 404, and the
 * access token carries `sub`, `roles`, `permissions` and no email and no display name. The
 * platform audit trail stores `platform_user_email` at WRITE time precisely because there is no
 * read path that would resolve it later.
 *
 * <p>So the block states what IS true and IS useful: the authority this session holds, and — the
 * line that matters on a control plane — that it is scoped to no tenant at all. A reader who has
 * been impersonating into a restaurant needs to be able to tell, at a glance, that they are back
 * out of it.
 */
function PlatformSidebarFooter() {
  return (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary-400 to-secondary-400 text-primary-solid-foreground"
      >
        <ShieldCheck className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small font-semibold text-sidebar-foreground">
          Super Admin
        </span>
        <span className="block truncate text-label text-foreground-tertiary">
          Scoped to no tenant
        </span>
      </span>
    </div>
  );
}

export interface PlatformSidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Below `md` the rail is an overlay the top bar opens. */
  mobileOpen: boolean;
  /** Closes the overlay after a navigation — otherwise the rail covers the page it just opened. */
  onNavigate: () => void;
}

export function PlatformSidebar({
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onNavigate,
}: PlatformSidebarProps) {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={300}>
      {/*
        `<aside>` is a `complementary` LANDMARK and it is NAMED: a screen reader listing this
        document's regions would otherwise read "complementary" with nothing to distinguish it,
        while the `<nav>` inside it is already named "Platform". Naming the outer region is what
        makes the brand block, the identity block and the collapse toggle — none of which are
        navigation, all of which live out here — addressable at all.
      */}
      <aside
        aria-label="Platform sidebar"
        data-slot="platform-sidebar"
        data-collapsed={collapsed}
        className={cn(
          "relative flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
          "hidden md:flex",
          collapsed ? "w-16" : "w-60",
          mobileOpen && "fixed inset-y-0 left-0 z-50 flex md:relative md:flex",
        )}
      >
        {/*
          THE SEAM (`NEXUS_ERP_Demo.html:77-83`, `.sidebar::after`): a 1px vertical gradient down
          the rail's right edge, transparent → gold at 40% → teal at 70% → transparent, at 30%
          opacity. It is the one place in the shell where both brand hues appear together, and it
          costs one absolutely positioned span and zero layout. `position: absolute` establishes a
          containing block for ABSOLUTE descendants only, so it is outside the `receipt-print.css`
          hazard entirely — that rule is about transform/filter/contain/will-change/perspective.
        */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-px opacity-30 bg-[linear-gradient(180deg,transparent,var(--primary)_40%,var(--secondary-400)_70%,transparent)]"
        />

        <PlatformBrandMark collapsed={collapsed} />

        {/* No horizontal padding here: the rows are full-bleed slabs and own their own 20px inset,
            which is what the active rail attaches to. */}
        <nav className="flex flex-1 flex-col overflow-y-auto py-2.5" aria-label="Platform">
          {platformNavGroups.map((group) => (
            <div key={group.label} className="mb-1">
              {/*
                THE GROUP LABEL (`NEXUS_ERP_Demo.html:101-106`): 11px / 600 / 0.12em / uppercase /
                dimmest tier. Letterspaced caps at the tertiary tier organise WITHOUT competing —
                the eye reads them as furniture rather than as options, which is a large part of
                the "organised, expensive" read and identical to the tenant rail's treatment.
              */}
              {!collapsed && (
                <p className="px-5 pt-2.5 pb-1 text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col">
                {group.items.map((item) => (
                  <PlatformNavLink
                    key={item.href}
                    item={item}
                    active={isNavItemActive(pathname, item.href)}
                    collapsed={collapsed}
                    onNavigate={onNavigate}
                  />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {!collapsed && <PlatformSidebarFooter />}

        <div className="border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="touch-target flex w-full items-center justify-center rounded-lg p-2 text-foreground-tertiary transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            {collapsed ? (
              <ChevronRight className="size-4" />
            ) : (
              <>
                <ChevronLeft className="size-4" />
                <span className="ml-2 text-label">Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
