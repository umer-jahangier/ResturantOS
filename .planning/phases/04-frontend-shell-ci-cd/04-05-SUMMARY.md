---
phase: 04-frontend-shell-ci-cd
plan: 05
subsystem: frontend-design-system
tags: [skeleton-system, framer-motion, page-transition, motion-variants, DS-02, DS-03]
status: complete
completed: "2026-06-26"
duration: "~5 minutes"

dependency-graph:
  requires:
    - 04-04 (globals.css .skeleton shimmer class, framer-motion dep installed)
  provides:
    - Skeleton primitive using .skeleton shimmer class (DS-02) with aria-hidden, role=presentation
    - SidebarSkeleton (brand + branch-switcher + 10 nav-item rows)
    - DashboardSkeleton (4 stat-cards grid + h-64 chart placeholder)
    - DataTableSkeleton (configurable columns/rows, default 5×8)
    - Shared motion variants (fadeSlideUp, slideInRight, scaleIn, staggerContainer)
    - PageTransition wrapper (AnimatePresence + useReducedMotion)
    - Vitest test suite for variants (19 tests, ≥60% coverage)
  affects:
    - 04-06 (data-tables can now use DataTableSkeleton for loading states)
    - 04-07 (Top Bar can use PageTransition; SidebarSkeleton for lazy-load)
    - 04-08 (any new settings panels can use PageTransition and skeletons)

tech-stack:
  added: []
  patterns:
    - .skeleton shimmer class (CSS animation from globals.css) as single skeleton building block
    - framer-motion useReducedMotion() for prefers-reduced-motion compliance
    - Typed Variants objects exported from lib/motion/variants.ts for DS-03 catalogue
    - AnimatePresence mode="wait" for clean page transition exit/enter sequencing

key-files:
  created:
    - frontend/components/ui/skeleton.tsx (replaced)
    - frontend/components/skeletons/sidebar-skeleton.tsx
    - frontend/components/skeletons/dashboard-skeleton.tsx
    - frontend/components/skeletons/data-table-skeleton.tsx
    - frontend/lib/motion/variants.ts
    - frontend/components/shared/page-transition.tsx
    - frontend/__tests__/lib/motion/variants.test.ts
  modified:
    - frontend/tsconfig.json (target ES2017→ES2020 for BigInt literal support)

decisions:
  - id: "04-05-A"
    summary: "Skeleton primitive replaces shadcn animate-pulse with .skeleton shimmer class"
    detail: "shadcn installed a skeleton using animate-pulse + bg-muted. Replaced with .skeleton shimmer class (gradient animation from globals.css 04-04). Added aria-hidden='true' and role='presentation' per DS-02 + WCAG guidance. Props narrowed to className?: string only (DS-02 says no spinners, no data fetching)."
  - id: "04-05-B"
    summary: "tsconfig target ES2017→ES2020 to support BigInt literals in money-display.tsx"
    detail: "Pre-existing untracked file money-display.tsx used 100n BigInt literals which fail under ES2017 target. lib already includes esnext and Next.js transpiles for browsers regardless of tsconfig target. Bumped to ES2020 — minimal risk, no behavior change for Next.js build."
  - id: "04-05-C"
    summary: "PageTransition renders children directly (no wrapper div) when reduced-motion"
    detail: "useReducedMotion() from framer-motion reads prefers-reduced-motion media query. When true, PageTransition returns <>{children}</> — no extra DOM node, no AnimatePresence overhead. This ensures the component never adds layout noise for motion-sensitive users."
  - id: "04-05-D"
    summary: "Variants test placed in __tests__/lib/motion/ per project test structure"
    detail: "vitest.config.ts include pattern is '__tests__/**/*.{test,spec}.{ts,tsx}' — tests must live in the __tests__/ root directory. Plan mentioned lib/motion/__tests__/ which would not be picked up. Placed at frontend/__tests__/lib/motion/variants.test.ts to match the convention."

metrics:
  tasks-completed: 2
  tasks-total: 2
  deviations: 2
  commits:
    - "e98794a feat(04-05): skeleton primitive + per-view skeletons (DS-02)"
    - "ee04b13 feat(04-05): PageTransition + shared motion variants + tests (DS-03)"
---

# Phase 4 Plan 05: Skeleton System + Motion Variants Summary

**One-liner:** Shimmer-based Skeleton primitive (DS-02) + 3 per-view skeletons + 4 typed framer-motion Variants + AnimatePresence PageTransition respecting prefers-reduced-motion (DS-03); 19 Vitest tests green.

## Objective

Close DS-SHELL-02 (skeleton-first loading system) and DS-SHELL-03 (motion/micro-interactions layer). Build the composable `Skeleton` primitive that uses the `.skeleton` shimmer class from 04-04. Build 3 per-view skeletons approximating real layout shapes. Add a `PageTransition` wrapper with framer-motion and export reusable motion variants for the micro-interactions catalogue.

## Tasks Completed

| # | Task | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | Skeleton primitive + 3 per-view skeletons | `e98794a` | skeleton.tsx (replaced), sidebar-skeleton.tsx, dashboard-skeleton.tsx, data-table-skeleton.tsx, tsconfig.json |
| 2 | PageTransition + shared motion variants + tests | `ee04b13` | lib/motion/variants.ts, components/shared/page-transition.tsx, __tests__/lib/motion/variants.test.ts |

## What Was Built

### components/ui/skeleton.tsx (replaced)

Replaced the shadcn default (`animate-pulse rounded-md bg-muted`) with the DS-02-compliant implementation:
- `className={cn("skeleton rounded-md", className)}` — uses the `.skeleton` shimmer class from globals.css
- `aria-hidden="true"` + `role="presentation"` — invisible to screen readers per WCAG
- Props narrowed to `className?: string` — pure layout primitive, no data fetching, no spinners

### components/skeletons/sidebar-skeleton.tsx

Server component (no `'use client'`) composing `<Skeleton>` blocks to approximate sidebar.tsx layout:
- Brand placeholder: `h-8 w-32`
- Branch-switcher placeholder: `h-9 w-full`
- 10 nav-item rows: icon slot `h-5 w-5` + varying text `h-4 w-24..w-36`
- Matches `sidebar.tsx` `px-3 py-2 gap-2` spacing

### components/skeletons/dashboard-skeleton.tsx

Server component approximating a typical dashboard view:
- `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` — 4 stat-card skeletons, each `h-24`
- Each card: label placeholder `h-4 w-24` + number placeholder `h-7 w-16`
- Large chart placeholder: `h-64 w-full` below the stat-card grid

### components/skeletons/data-table-skeleton.tsx

Server component with configurable dimensions:
- Props: `columns?: number` (default 5), `rows?: number` (default 8)
- Header row: `bg-muted/40` background, 5 cells with varying widths
- 8 body rows with matching cell widths, `last:border-0` tail trim

### lib/motion/variants.ts

Exports 4 typed `framer-motion` `Variants` objects — no `any`, all `const`:

| Export | Purpose | Timing |
|--------|---------|--------|
| `fadeSlideUp` | Page content reveal, card entrance | 350ms animate / 200ms exit |
| `slideInRight` | Panel/drawer entrance | 300ms animate / 150ms exit |
| `scaleIn` | Modal/popover entrance | 150ms animate / 100ms exit |
| `staggerContainer` | Parent for staggered children | 50ms stagger |

Ease curve `[0.25, 0.1, 0.25, 1]` (Material-style cubic bezier) on `fadeSlideUp.animate`.

### components/shared/page-transition.tsx

Client component using `AnimatePresence mode="wait"`:
- `useReducedMotion()` from framer-motion — returns `true` if `prefers-reduced-motion: reduce`
- Reduced-motion path: returns `<>{children}</>` with zero DOM overhead
- Normal path: wraps in `<AnimatePresence><motion.div variants={fadeSlideUp}>` 
- `mode="wait"` ensures exit animation completes before enter starts
- No `<AnimatePresence>` around layout children — consumer controls placement inside a client boundary

### __tests__/lib/motion/variants.test.ts

19 pure TypeScript unit tests (no DOM, no rendering):
- 7 tests for `fadeSlideUp` — keys, opacity values, y offsets, exit direction
- 3 tests for `slideInRight` — keys, animate opacity/x, initial x direction
- 3 tests for `scaleIn` — keys, animate opacity/scale, initial scale < 1
- 2 tests for `staggerContainer` — animate key, staggerChildren type + value
- 4 tests confirming all 4 exports are `Variants` objects (TypeScript assignability)

Coverage of `lib/motion/variants.ts`: 100% lines (pure object declarations, all branches exercised by type-check + value assertions).

## Deviations from Plan

### Auto-fixed Issues

**[Rule 1 - Bug] tsconfig target ES2017→ES2020 for BigInt literal support**

- **Found during:** Task 1 (`tsc --noEmit`)
- **Issue:** Pre-existing untracked file `components/ui/money-display.tsx` used `100n` BigInt literals which TypeScript rejects under `"target": "ES2017"`.
- **Fix:** Bumped tsconfig target to `"ES2020"`. The `lib` array already includes `esnext` and Next.js transpiles for target browsers independently of tsconfig target. Zero behavior change for the build.
- **Files modified:** `frontend/tsconfig.json`
- **Commit:** `e98794a`

**[Rule 3 - Blocking] Test file placed in __tests__/lib/motion/ not lib/motion/__tests__/**

- **Found during:** Task 2 (plan specified `lib/motion/__tests__/variants.test.ts`)
- **Issue:** `vitest.config.ts` include pattern is `__tests__/**/*.{test,spec}.{ts,tsx}` — files outside `__tests__/` are not discovered.
- **Fix:** Placed test at `frontend/__tests__/lib/motion/variants.test.ts` matching the existing project convention (`__tests__/lib/session.repository.test.ts`, etc.).
- **Files modified:** Test created at correct path
- **Commit:** `ee04b13`

## Verification Results

```
✓ pnpm --dir frontend exec tsc --noEmit — 0 errors
✓ pnpm --dir frontend run lint — 0 errors (1 pre-existing warning in data-table.tsx)
✓ pnpm --dir frontend run build — passes (Next 16 + Turbopack)
✓ pnpm --dir frontend test:run — 58 tests passed (7 test files)
✓ grep -q "aria-hidden" frontend/components/ui/skeleton.tsx — PASS
✓ grep -q "Skeleton" frontend/components/skeletons/sidebar-skeleton.tsx — PASS
✓ grep -q "DashboardSkeleton" frontend/components/skeletons/dashboard-skeleton.tsx — PASS
✓ grep -q "DataTableSkeleton" frontend/components/skeletons/data-table-skeleton.tsx — PASS
✓ grep -q "useReducedMotion" frontend/components/shared/page-transition.tsx — PASS
✓ grep -q "AnimatePresence" frontend/components/shared/page-transition.tsx — PASS
✓ grep -q "fadeSlideUp" frontend/lib/motion/variants.ts — PASS
✓ grep -q "slideInRight" frontend/lib/motion/variants.ts — PASS
✓ grep -q "scaleIn" frontend/lib/motion/variants.ts — PASS
✓ grep -q "staggerContainer" frontend/lib/motion/variants.ts — PASS
✓ variants.ts coverage — 100% (pure object declarations, all assertions in test)
```

## Next Phase Readiness

Plan 04-06 (data-tables) can now:
- Use `<DataTableSkeleton columns={6} rows={10} />` during loading
- Use `<Skeleton className="h-4 w-X" />` for inline skeleton cells

Plan 04-07 (Top Bar + Command Palette) can now:
- Wrap page content in `<PageTransition>` for fade+slide entrance
- Use `slideInRight` / `scaleIn` variants for panel/modal animations
- Mount `<SidebarSkeleton />` during sidebar hydration

Plan 04-08 (tenant theming) can now:
- Use `scaleIn` variant for settings panel entrance
- Apply `staggerContainer` + `fadeSlideUp` for settings section reveals
