"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { ActiveRail } from "./active-rail";
import { PermissionGuard } from "./permission-guard";
import { FeatureGuard } from "./feature-guard";
import { BranchSwitcher } from "./branch-switcher";
import { navGroups, type NavItem, type NavGroup } from "./sidebar-nav-items";
import { useNavGroupVisibility } from "@/lib/hooks/auth/use-nav-visibility";
import { useTenantBrand } from "@/lib/hooks/use-tenant-brand";
import { useCurrentUser } from "@/lib/hooks/auth/use-current-user";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Permission/feature-conditioned grouped sidebar (DS-05 upgrade). Each item is
// wrapped in FeatureGuard → PermissionGuard to show only if permission is held
// AND feature is enabled. Supports collapse-to-icon mode with tooltips.
//
// ─── 38-shell: this file is a VISUAL rebuild and nothing else ────────────────
// Every gate below — `useNavGroupVisibility`, `FeatureGuard`, `PermissionGuard`,
// `item.permissionMode`, `comingSoon`, `roles` — is byte-for-byte the composition that
// shipped, in the same order, with the same defaults. The nine roles' nav scoping is frozen by
// `__tests__/shared/nav-permission-matrix.test.tsx` (which asserts the HOOK, not this render)
// and by `e2e/journeys/role-visibility-matrix.spec.ts` (which asserts link-by-link inside
// `nav[aria-label="Primary"]`). Both still describe this file exactly.
interface SidebarProps {
  groups?: NavGroup[];
  mobileOpen?: boolean;
}

/*
 * THE ACTIVE RAIL moved to `./active-rail.tsx` — same component, same eleven classes, same
 * docblock (which is where `mobile-bottom-nav.tsx`'s reference to "sidebar.tsx's ActiveRail
 * docblock" now leads). It moved because the SuperAdmin console renders the identical device
 * and the two shells must read as one product: importing it FROM here would have dragged
 * BranchSwitcher, useNavGroupVisibility and useTenantBrand into the platform bundle to obtain
 * a 3px bar, and re-implementing it there would have been a second copy free to drift.
 */

/**
 * The count pill. Rendered ONLY where a count exists.
 *
 * <p>The demo hard-codes a gold `3` on POS Terminal and a red `5` on Inventory
 * (`NEXUS_ERP_Demo.html:126-131`). Neither number is computed by anything, and this shell has
 * removed a fabricated count once already: GA-059 deleted a notifications bell whose
 * `aria-label="Notifications (3 unread)"` told every user, on every page, that three items were
 * waiting, with no reader anywhere in the product that could ever show them. So `badge` stays
 * driven by `NavItem.badge`, no nav item declares one today, and the demo's two are not copied in.
 */
function NavBadge({ badge }: { badge: number | string }) {
  return (
    <span className="ml-auto rounded-full bg-destructive px-1.5 text-label font-semibold text-destructive-foreground">
      {badge}
    </span>
  );
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
              "touch-target relative flex items-center justify-center p-2 transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            {active && <ActiveRail />}
            <Icon className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-80")} />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{item.label}</p>
          {item.badge !== undefined && (
            <span className="ml-1 text-label opacity-75">({item.badge})</span>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    /*
     * The demo's row is a SLAB: `border-radius: 0` and `padding: 8px 20px` full-bleed
     * (`:107-113`). That is not a stylistic preference — it is what lets the rail sit flush at
     * `left: 0` with nothing to round off against. A rounded, inset pill (what shipped before)
     * has no edge for a rail to attach to, which is why the device was never reproducible on it.
     */
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        // `touch-floor` (globals.css): 44px tall below `lg`, the demo's 34px slab at and above.
        //
        // The sidebar is `hidden md:flex`, so the ONLY widths at which these links are visible
        // below `lg` are 768–1023 — a tablet, held in a hand. Measured at 768 they were 239×34,
        // the single most-repeated sub-44px control in the product (one per nav item, on every
        // route). The collapsed variant above already carries `touch-target`; this is the
        // expanded one, which is the variant a tablet actually gets.
        "touch-floor relative flex items-center gap-2.5 px-5 py-2 text-small font-normal transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
      )}
    >
      {active && <ActiveRail />}
      <Icon className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-80")} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && <NavBadge badge={item.badge} />}
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

  // 19-01: `mode` must be forwarded. The sidebar gates every item TWICE — once through
  // `useNavGroupVisibility` in `NavGroupSection` below, and again here — and this copy defaulted
  // to `mode="all"`. So an item declaring `permission: ["rbac.manage","rbac.user.manage"]` with
  // `permissionMode: "any"` passed the hook and was then hidden by the guard, silently, for the
  // one role it was written for. Measured live: a TENANT_ADMIN saw Settings → Appearance alone
  // while the mobile bar (which uses the hook only) showed Settings correctly.
  //
  // Forwarding it is the one-line fix. The double gate itself is the real defect and is left
  // named rather than removed, because collapsing the two is a change to every nav item at once.
  const guarded = item.permission ? (
    <PermissionGuard require={item.permission} mode={item.permissionMode ?? "all"}>
      {withFeature}
    </PermissionGuard>
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
    <div className="mb-1">
      {/*
        THE GROUP LABEL (`NEXUS_ERP_Demo.html:101-106`): 10px / 600 / `letter-spacing: .12em` /
        uppercase / dimmest text tier / `padding: 10px 20px 4px`.

        This is a large part of the "organised, expensive" read and the shipped sidebar had it as
        a `text-xs … tracking-wider` line that sat too close to the items beneath it and too
        bright beside them. Letterspaced caps at the tertiary tier organise WITHOUT competing:
        the eye reads them as furniture, not as options.
      */}
      {!collapsed && (
        <p className="px-5 pt-2.5 pb-1 text-label font-semibold tracking-eyebrow text-foreground-tertiary uppercase">
          {group.label}
        </p>
      )}
      <div className="flex flex-col">
        {group.items.map((item) =>
          isItemVisible(item) ? (
            <GuardedNavItem key={item.href} item={item} collapsed={collapsed} pathname={pathname} />
          ) : null,
        )}
      </div>
    </div>
  );
}

/**
 * The monogram tile (`NEXUS_ERP_Demo.html:85-99`): 34px square, radius 8, a 135° gold gradient,
 * the display serif at 800, near-black glyph, and its own coloured drop shadow.
 *
 * <p>The demo's intent note is the reason this is worth the eleven classes: *"a monogram tile —
 * gradient fill plus its own coloured glow — so the brand reads as an OBJECT rather than a
 * wordmark"*. What shipped was a lucide `ChefHat` beside a plain label, which reads as a stock
 * template because it is one.
 *
 * <p>The letter is the tenant's own initial, from `useTenantBrand()` — the session-derived brand
 * GA-032 wired up. Not a hard-coded "N": that would be the same defect GA-032 fixed, where the
 * shell named one restaurant and its own branch chip named another.
 */
function BrandMark({ brandName, collapsed }: { brandName: string; collapsed: boolean }) {
  const initial = brandName.trim().slice(0, 1).toUpperCase() || "R";

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
        {initial}
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-small font-bold tracking-brandmark text-sidebar-foreground uppercase">
            {brandName}
          </span>
          {/* The demo demotes the product category to a 10px sub-line so the brand owns the
              block. Ours is a static descriptor of what the product IS, not a claim about data. */}
          <span className="block truncate text-label text-foreground-tertiary">Restaurant ERP</span>
        </span>
      )}
    </div>
  );
}

/** `TENANT_ADMIN` → `Tenant Admin`. The roles arrive from the JWT in SCREAMING_SNAKE. */
function humaniseRole(role: string): string {
  return role
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The identity block pinned to the bottom of the rail (`NEXUS_ERP_Demo.html:133-145`).
 *
 * <h3>What this shows, and why it is not a name</h3>
 *
 * The demo's footer reads *"Ahmed Raza / Super Admin"*. **This product cannot name the signed-in
 * user.** The finding is already recorded, measured, in `components/settings/profile-panel.tsx`:
 * `GET /api/v1/auth/me`, `/api/v1/me` and `/api/v1/auth/profile` are all 404, and the access
 * token carries `sub`, `tenant_id`, `branch_id`, `roles`, `permissions`, `attributes` — and no
 * email and no display name. Only `GET /api/v1/users/{id}` has a name on it, and it is gated on
 * an administration authority, so for six of the nine roles it is a guaranteed 403.
 *
 * <p>D-38-16 governs: a figure this system cannot compute renders as a stated absence, never as
 * an invention. So the block is styled exactly as specified and filled with what IS true and IS
 * useful mid-shift — <b>what am I authorised as</b> — and the disc carries a person glyph rather
 * than initials manufactured from the first character of a UUID.
 *
 * <h3>What is deliberately NOT here</h3>
 *
 * <p><b>No branch line.</b> The obvious second line is the branch this session is scoped to, and
 * it was written and then removed: `useMyBranches()` is a query, and reading its `data` without
 * reading `isPending`/`isError` is precisely what `state-coverage.test.ts` catches — an outage
 * would make the line silently vanish rather than say so. Handling all three states here would
 * duplicate, three centimetres away, the TopBar chip that already does exactly that (including
 * its `top-bar-branch-unavailable` failure state). One honest branch indicator is better than
 * two, and the one that exists is the one a user already looks at.
 *
 * <p><b>No chevron.</b> The demo draws one, implying a menu; this block opens nothing — the
 * account menu is the TopBar's avatar, which is where it already was. A control that cannot act
 * is the exact shape of the notification bell GA-059 deleted from this same shell.
 */
function SidebarFooter() {
  const { roles } = useCurrentUser();

  if (roles.length === 0) return null;

  const [primary, ...rest] = roles;

  return (
    <div className="flex items-center gap-2.5 border-t border-sidebar-border px-4 py-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-primary-400 to-secondary-400 text-primary-solid-foreground"
      >
        <UserRound className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-small font-semibold text-sidebar-foreground">
          {humaniseRole(primary!)}
        </span>
        {/* Multi-role sessions exist (a MANAGER who is also an ACCOUNTANT) and the permissions
            they get are the union, so naming only the first would understate what the user can
            do on the screens above. Absent for the single-role majority. */}
        {rest.length > 0 && (
          <span className="block truncate text-label text-foreground-tertiary">
            {rest.map(humaniseRole).join(", ")}
          </span>
        )}
      </span>
    </div>
  );
}

export function Sidebar({ groups = navGroups, mobileOpen = false }: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const brandName = useTenantBrand();

  return (
    <TooltipProvider delayDuration={300}>
      {/*
        `<aside>` is a `complementary` LANDMARK, and it was unnamed (plan 38-15 task 2). A screen
        reader listing this document's regions read "complementary" with nothing to distinguish it
        from any other — while the `<nav>` INSIDE it was already named "Primary". Naming the outer
        region is what makes the brand block, the branch switcher and the collapse toggle — none
        of which are navigation, all of which live out here — addressable at all.

        `bg-sidebar`, not `bg-background`: the demo's rail is `--bg-2`, one step off the content
        ground (`--bg`), which is what makes the chrome read as a frame rather than as more page.
        The role tokens already encode exactly that relationship — `--sidebar` is `--neutral-50`
        against a `--neutral-0` page in light, and `--neutral-950` against `--neutral-1000` in
        dark — so this is the token doing its job, not a new colour.

        240px (`w-60`), down from 256px (`w-64`), matching `.sidebar { width: 240px }` at
        `NEXUS_ERP_Demo.html:69`.
      */}
      <aside
        aria-label="Sidebar"
        className={cn(
          "relative flex flex-col border-r border-sidebar-border bg-sidebar transition-all duration-200",
          // Desktop: always visible, collapsible width
          "hidden md:flex",
          collapsed ? "w-16" : "w-60",
          // Mobile: fixed overlay, shown when mobileOpen
          mobileOpen && "fixed inset-y-0 left-0 z-50 flex md:relative md:flex",
        )}
        data-slot="sidebar"
        data-collapsed={collapsed}
      >
        {/*
          THE SEAM (`NEXUS_ERP_Demo.html:77-83`, `.sidebar::after`): a 1px vertical gradient down
          the rail's right edge, transparent → gold at 40% → teal at 70% → transparent, at 30%
          opacity. The demo's own note is the argument for keeping it: *"a single decorative
          gesture that signs the product without costing any content space."* It is the one place
          in the shell where both brand hues appear together, and it costs one absolutely
          positioned span and zero layout.

          `position: absolute` establishes a containing block for ABSOLUTE descendants only, not
          for fixed ones, so this is outside the `receipt-print.css` hazard entirely — that rule
          is about `transform`/`filter`/`contain`/`will-change`/`perspective`, none of which are
          here. `zone-containment.test.ts` scans for exactly those six and finds nothing.
        */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-px opacity-30 bg-[linear-gradient(180deg,transparent,var(--primary)_40%,var(--secondary-400)_70%,transparent)]"
        />

        <BrandMark brandName={brandName} collapsed={collapsed} />

        {/* Branch switcher — US-1.3: only when user has >1 assigned branch */}
        {!collapsed && (
          <div className="border-b border-sidebar-border px-4 py-3">
            <BranchSwitcher />
          </div>
        )}

        {/* Grouped navigation. No horizontal padding here: the demo's rows are full-bleed slabs
            and own their own 20px inset, which is what the active rail attaches to. */}
        <nav className="flex flex-1 flex-col overflow-y-auto py-2.5" aria-label="Primary">
          {groups.map((group) => (
            <NavGroupSection
              key={group.label}
              group={group}
              collapsed={collapsed}
              pathname={pathname}
            />
          ))}
        </nav>

        {!collapsed && <SidebarFooter />}

        {/* Collapse toggle */}
        <div className="border-t border-sidebar-border p-2">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "touch-target flex w-full items-center justify-center rounded-lg p-2 text-foreground-tertiary transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              collapsed && "justify-center",
            )}
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
