---
phase: 04-frontend-shell-ci-cd
plan: 07
subsystem: frontend-shell-chrome
tags: [sidebar, top-bar, mobile-nav, breadcrumb, command-palette, theme-toggle, radix-tooltip]
status: complete
completed: "2026-06-26"
duration: "~10 minutes"

dependency-graph:
  requires:
    - 04-04 (ThemeToggle, semantic tokens, keyframes, OKLCH foundation)
    - 04-05 (SidebarSkeleton, PageTransition, motion variants)
    - 04-06 (CommandPalette, StatusBadge, DataTable primitives)
    - 04-08 (/api/theme route, Appearance page, localStorage stub)
  provides:
    - Upgraded collapsible Sidebar: grouped sections, brand area, collapse toggle, badges
    - NavGroup data model: structured nav config with group labels and badge support
    - Tooltip primitive: radix-ui based wrapper for shadcn-style tooltip
    - TopBar: sticky blurred header with breadcrumb, ⌘K search, notifications, ThemeToggle, profile
    - MobileBottomNav: fixed bottom nav (md:hidden) with 5 guarded icons
    - Integrated tenant layout: Suspense skeleton, mobile overlay, DS-06 theme injection
  affects:
    - 05-12 (all module UIs use the upgraded shell chrome)

tech-stack:
  added: []
  patterns:
    - Radix UI Tooltip (from unified radix-ui package) for sidebar icon mode
    - useState collapse pattern for sidebar width (w-64 → w-16)
    - DropdownMenu from shadcn for profile menu in TopBar
    - localStorage read in RSC-compatible TenantThemeInjector (client-only)
    - Suspense with SidebarSkeleton fallback (DS-02 integration)
    - usePathname for breadcrumb generation and active-state in bottom nav

key-files:
  created:
    - frontend/components/ui/tooltip.tsx
    - frontend/components/shared/top-bar.tsx
    - frontend/components/shared/mobile-bottom-nav.tsx
  modified:
    - frontend/components/shared/sidebar-nav-items.ts
    - frontend/components/shared/sidebar.tsx
    - frontend/app/(tenant)/layout.tsx

decisions:
  - id: "04-07-A"
    summary: "Tooltip built from radix-ui unified package, not a separate @radix-ui/react-tooltip"
    detail: "The project uses radix-ui@1.6.0 (the new unified package) which bundles all Radix primitives including Tooltip. No @radix-ui/react-tooltip sub-package is installed separately. Created tooltip.tsx importing from 'radix-ui' directly, maintaining the no-package.json-modification constraint."
  - id: "04-07-B"
    summary: "TenantThemeInjector is a client-side function component, not a Server Component"
    detail: "Reading localStorage is browser-only. Made TenantThemeInjector a function inside the 'use client' layout that checks typeof window before reading. If window is undefined (SSR), returns null — the base globals.css tokens provide defaults with no flash. This avoids a useEffect or separate client component boundary."
  - id: "04-07-C"
    summary: "Layout converted to 'use client' to support mobile sidebar toggle state"
    detail: "The mobileOpen state (for mobile sidebar overlay) requires useState. Rather than lifting it to a separate client wrapper, the layout file itself became 'use client'. This is acceptable because Next.js server components are only needed at the layout boundary for RSC benefits — the tenant layout is already client-gated by proxy.ts authentication."
  - id: "04-07-D"
    summary: "navGroups exports alongside tenantNavItems for backward compat"
    detail: "The upgraded Sidebar defaults to navGroups[] for grouped rendering. The existing tenantNavItems flat array is preserved and still exported so any existing consumer that passed items={tenantNavItems} continues to work. The Sidebar now accepts groups?: NavGroup[] (not items)."

metrics:
  tasks-completed: 2
  tasks-total: 2
  deviations: 1
  commits:
    - "f1d4574 feat(04-07): upgrade Sidebar + nav items structure (DS-05)"
    - "03baba6 feat(04-07): TopBar + MobileBottomNav + tenant layout integration (DS-05/06/07)"
---

# Phase 4 Plan 07: Shell Chrome Upgrade (DS-05) Summary

**One-liner:** Collapsible grouped Sidebar (ChefHat brand, tooltip icons, section badges), sticky TopBar (breadcrumb/⌘K/notifications/ThemeToggle/profile), MobileBottomNav (5 guarded icons, md:hidden), and integrated tenant layout with Suspense skeleton + DS-06 tenant theme injection.

## Objective

Close DS-SHELL-05 (shell chrome upgrade) and integrate DS-06 theme injection + DS-07 ThemeToggle mount into the visible shell. This is the integration plan that ties together tokens (04-04), skeletons (04-05), UI primitives (04-06), and theming (04-08) into the running application shell.

## Tasks Completed

| # | Task | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | Upgrade Sidebar + nav items structure | `f1d4574` | sidebar-nav-items.ts, sidebar.tsx, tooltip.tsx (new) |
| 2 | TopBar + MobileBottomNav + tenant layout | `03baba6` | top-bar.tsx (new), mobile-bottom-nav.tsx (new), layout.tsx |

## What Was Built

### tooltip.tsx (`components/ui/tooltip.tsx`)

Shadcn-style Tooltip wrapper using `radix-ui`'s unified Tooltip primitive:
- `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` exports
- Portal-rendered content with `z-50`, primary background, fade/zoom animation classes
- Used by the Sidebar for collapsed icon-only mode

### sidebar-nav-items.ts (upgraded)

Extended the nav data model:
- New `NavGroup` interface: `{ label: string; items: NavItem[] }`
- Added `badge?: number | string` to `NavItem` for notification counts
- New `navGroups: NavGroup[]` export with 5 groups: Overview, Orders, Menu, Finance, Settings
- Settings group includes: General (`/app/settings`), **Appearance** (`/settings/appearance` — DS-06 link), Users (`/app/settings/users`)
- Legacy `tenantNavItems` flat array preserved for backward compat

### sidebar.tsx (upgraded)

Full DS-05 sidebar chrome:
- **Brand area:** `ChefHat` icon (text-primary) + "RestaurantOS" text, `BranchSwitcher` below in `border-b` section
- **Grouped sections:** Each `NavGroup` renders a section heading (`text-xs font-semibold uppercase tracking-wider text-muted-foreground`) + items below
- **Collapse mode:** `useState(false)` on `collapsed`. Width: `w-64` → `w-16` with `transition-all duration-200`. Group headings and item labels hidden; only icons show in icon-only mode
- **Tooltip on icons:** Collapsed items wrapped in `Tooltip` (side="right") showing label + badge count
- **Badges:** `badge !== undefined` → small `bg-destructive text-destructive-foreground` pill to the right of label (hidden when collapsed)
- **Collapse toggle:** Button at sidebar bottom with `ChevronLeft`/`ChevronRight` icons + "Collapse" label (hidden when collapsed)
- **Mobile support:** `mobileOpen` prop for fixed positioning on mobile (overlay pattern in layout)
- All `FeatureGuard` → `PermissionGuard` → `Link` wrapping **preserved** on every item

### top-bar.tsx (`components/shared/top-bar.tsx`)

Sticky blurred top bar (`sticky top-0 z-30 h-14 bg-background/95 backdrop-blur`):
- **Mobile hamburger:** `Menu` icon button (`md:hidden`) calls `onMobileMenuToggle` prop
- **Breadcrumb:** `usePathname()` → last 3 segments → prettified labels with `ChevronRight` separators. Current segment bold (`text-foreground`), ancestors muted. Hidden below `sm`.
- **⌘K button:** Desktop: ghost pill with `Search` icon + "Search…" + `⌘K` kbd badge. Mobile: icon-only. Both open `CommandPalette`.
- **Notifications:** `Bell` icon + absolute `bg-destructive` 8px dot badge (hardcoded, real system in later phase)
- **ThemeToggle:** `<ThemeToggle />` from 04-04 (DS-07 mount complete)
- **Profile DropdownMenu:** `size-8 rounded-full bg-primary text-primary-foreground` avatar with user initial from `useCurrentUser().userId`. Items: Profile → `/settings/profile`, Settings → `/app/settings`, separator, Log out (calls `useLogout().mutate()`)
- **CommandPalette:** Rendered at bottom with 3 nav commands (Dashboard, Settings, Appearance) + Theme group. `open`/`onOpenChange` managed locally.

### mobile-bottom-nav.tsx (`components/shared/mobile-bottom-nav.tsx`)

Fixed bottom nav bar (`fixed bottom-0 inset-x-0 z-40 h-16 md:hidden bg-background/95 backdrop-blur border-t`):
- 5 items: Dashboard (`LayoutDashboard`), Orders (`ShoppingCart`, `order:create`), Menu (`UtensilsCrossed`, `inventory:read`), Finance (`DollarSign`, `finance:read`), Settings (`Settings`)
- Active item: `text-primary` via `usePathname()` prefix check; inactive: `text-muted-foreground`
- Each guarded item wrapped in `PermissionGuard` — unguarded items (Dashboard, Settings) always visible
- `.touch-target` class on every link (44px WCAG 2.5.5 tap size)
- Icon + small label text in `flex-col` layout

### app/(tenant)/layout.tsx (integrated)

Full tenant shell integration:
- `'use client'` for `useState(mobileOpen)`
- `TenantThemeInjector`: reads `localStorage.tenant-theme-settings.brandColor`, injects `<link rel="stylesheet" href="/api/theme?brandColor=..." />` (DS-06 integration). Returns `null` if not set or on SSR.
- `<Suspense fallback={<SidebarSkeleton />}>` wrapping Sidebar (DS-02 integration)
- Mobile overlay backdrop (`fixed inset-0 z-40 bg-black/40 md:hidden`) on `mobileOpen`
- `<main className="... pb-20 md:pb-6">` — clears MobileBottomNav on mobile screens
- All existing auth guards, `BranchSwitcher`, proxy.ts behavior unchanged

## Deviations from Plan

### Auto-fixed Issues

**[Rule 3 - Blocking] Created tooltip.tsx from radix-ui unified package**

- **Found during:** Task 1
- **Issue:** Plan required `<Tooltip>` from shadcn/ui but `components/ui/tooltip.tsx` didn't exist. No `@radix-ui/react-tooltip` sub-package is installed; `radix-ui` unified package bundles it.
- **Fix:** Created `components/ui/tooltip.tsx` importing from `radix-ui` directly (the new unified package API). Provides `TooltipProvider`, `Tooltip`, `TooltipTrigger`, `TooltipContent` matching shadcn style.
- **Files modified:** `frontend/components/ui/tooltip.tsx`
- **Commit:** `f1d4574`

## Verification Results

```
✓ pnpm exec tsc --noEmit — 0 source errors (only pre-existing .next/types/ conflicts)
✓ pnpm run lint — 0 errors (1 pre-existing warning: data-table.tsx React Compiler)
✓ pnpm run build — passes (Next.js 16 + Turbopack)
✓ grep -q "PermissionGuard" sidebar.tsx — PASS
✓ grep -q "FeatureGuard" sidebar.tsx — PASS
✓ grep -q "NavGroup" sidebar-nav-items.ts — PASS
✓ grep -q "Appearance" sidebar-nav-items.ts — PASS
✓ grep -q "collapsed" sidebar.tsx — PASS
✓ grep -q "TopBar" (tenant)/layout.tsx — PASS
✓ grep -q "MobileBottomNav" (tenant)/layout.tsx — PASS
✓ grep -q "SidebarSkeleton" (tenant)/layout.tsx — PASS
✓ grep -q "CommandPalette" top-bar.tsx — PASS
✓ grep -q "ThemeToggle" top-bar.tsx — PASS
✓ grep -q "PermissionGuard" mobile-bottom-nav.tsx — PASS
✓ grep -q "api/theme" (tenant)/layout.tsx — PASS
```

## DS Gap Closure Status

| DS Gap | Status |
|--------|--------|
| DS-05 Shell chrome upgrade | **CLOSED** — collapsible sidebar, top bar, mobile bottom nav |
| DS-06 Theme injection in layout | **CLOSED** — TenantThemeInjector + /api/theme link in head |
| DS-07 ThemeToggle mounted | **CLOSED** — ThemeToggle in TopBar right action area |

## Next Phase Readiness

All module UIs (phases 5–12) now have:
- A professional shell chrome to host their pages
- Collapsed sidebar with icon tooltips for max content area
- ⌘K command palette ready for module-specific navigation shortcuts
- Mobile bottom nav with permission-gated icons
- Dynamic tenant brand colour applied at layout level
