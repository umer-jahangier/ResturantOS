"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DollarSign, LayoutDashboard, Settings, ShoppingCart, UtensilsCrossed } from "lucide-react";

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
// The dead link 20-01 fixed: the fifth tab pointed at `/app/settings`, which had no
// `page.tsx`. `sidebar-nav-items.ts` had marked it `comingSoon: true` since it was added;
// the mobile bar never got the memo, so a phone user tapping Settings got a 404 (UI-SPEC
// §4.2 "Dead links must be fixed, not carried over"). 20-01 pointed the tab at
// `/settings/appearance`, the only settings surface that then existed.
//
// 19-01: `/app/settings` is now a real page and is the hub Appearance sits inside, so the tab
// points back at it — this time at a route that exists, gated on the permissions the page's own
// guard checks rather than on a role list that would drift from it.
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
    label: "Settings",
    href: "/app/settings",
    icon: Settings,
    permission: ["rbac.manage", "branch.manage"],
    permissionMode: "any",
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
        "touch-target relative flex flex-1 flex-col items-center justify-center gap-0.5 text-label font-medium transition-colors",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      {/*
        The sidebar's active rail, rotated to the axis this bar has.

        `sidebar.tsx`'s `ActiveRail` docblock carries the full reasoning (and the reconciliation
        with D-38-13); the short version is that the demo marks the current module on four
        channels at once — hue, tint, a 3px glowing rail and icon opacity — and a phone user was
        getting one of them. The rail is at the TOP here because that is the edge this bar has:
        the bottom edge is the device bezel and a 3px bar drawn on it is a bar nobody sees.

        `w-8` rather than full width: at 1/5 of a 390px viewport a full-bleed rail is a 78px
        block that reads as a selected tab background, not as a marker.
      */}
      {active && (
        <span
          aria-hidden="true"
          data-slot="nav-active-rail"
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 mx-auto h-[3px] w-8 rounded-b-[3px] bg-primary",
            "shadow-[0_0_8px_color-mix(in_oklab,var(--primary-400)_55%,transparent)]",
            "dark:shadow-[0_0_8px_var(--primary)]",
          )}
        />
      )}
      {/*
        THE FOURTH CHANNEL — the ~8% tint the demo puts behind an active nav row
        (`.nav-item.active { background: var(--primary-soft) }`, `NEXUS_ERP_Demo.html:116`).

        The demo marks the current module on four channels at once — hue, tint, the glowing rail,
        and icon opacity — and this bar was firing three. The tint is the one that does the work
        at a glance on a phone, because it is the only one with AREA: a 3px rail and a colour
        swap are both hairline-scale signals on a 78px-wide tab, and a thumb covers half the bar.

        It is a chip behind the GLYPH rather than a fill behind the whole tab, for the reason the
        rail is `w-8` and not full-bleed: at one fifth of a 390px viewport a full-bleed tint is a
        78px block that reads as a selected-tab background — iOS/Android segmented-control
        vocabulary, not this product's. The padding is unconditional so the row's geometry does
        not shift when the tint arrives; only the fill changes.

        A tint, so it correctly keeps `--primary` (D-38-18) — never `bg-primary-solid`, which
        would put a gold slab under a gold glyph.
      */}
      <span
        aria-hidden="true"
        className={cn(
          "flex items-center justify-center rounded-lg px-3 py-0.5",
          active && "bg-primary/10",
        )}
      >
        <Icon className={cn("size-5", active ? "opacity-100" : "opacity-80")} />
      </span>
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
    /*
     * Opaque, not translucent-plus-blur (D-34-02) — same reasoning as TopBar, and it
     * matters more here. This bar is `fixed` at the bottom of the viewport on exactly
     * the device class the operational zone is optimised for, so its compositing filter
     * was repainting a strip of the POS terminal on every frame of every scroll.
     *
     * `bg-sidebar`, changed from `bg-background` (38-shell), for the reason spelled out at
     * length in `top-bar.tsx`: the three pieces of chrome — rail, header, bottom bar — are ONE
     * surface in the demo (`--bg-2`), one step off the content ground, and painting two of them
     * as chrome and the third as page is worse than painting none of them. `--sidebar` is a
     * declared role token, not a new colour, and its foreground pairings are the ones measured
     * in `top-bar.tsx`'s docblock. Separation is still the top border plus elev-2 (this bar sits
     * above content rather than below it, so it takes the higher level), never translucency.
     */
    <nav
      className="fixed bottom-0 inset-x-0 z-40 flex h-16 items-center justify-around border-t border-sidebar-border bg-sidebar shadow-elev-2 md:hidden"
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
