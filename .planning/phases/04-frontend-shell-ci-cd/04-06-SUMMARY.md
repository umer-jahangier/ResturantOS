---
phase: 04-frontend-shell-ci-cd
plan: 06
subsystem: frontend-design-system
tags: [cmdk, react-countup, tanstack-table, bigint, currency, data-table, command-palette]
status: complete
completed: "2026-06-26"
duration: "~5 minutes"

dependency-graph:
  requires:
    - 04-04 (semantic tokens, keyframes, gap-closure deps installed)
    - 04-05 (DataTableSkeleton, Skeleton primitive, motion variants)
  provides:
    - CommandPalette: cmdk-based ⌘K/Ctrl+K dialog with search, groups, scaleIn animation
    - AnimatedNumber: react-countup with scroll-spy + tabular-nums
    - StatusBadge: semantic token pills for 6 status variants
    - MoneyDisplay: BigInt paisa→PKR via Intl.NumberFormat (§18 Rule 2 enforced)
    - DataTable: generic TanStack table with sorting, pagination, loading skeleton, empty state
    - EmptyState: icon + title + description + optional CTA
  affects:
    - 04-07 (CommandPalette mounts in Top Bar)
    - 05-12 (all module UIs use DataTable, MoneyDisplay, StatusBadge, EmptyState)

tech-stack:
  added: []
  patterns:
    - cmdk Command primitive wrapped in Dialog for keyboard-accessible palette
    - BigInt integer arithmetic for paisa→rupees (no floating-point division)
    - TanStack Table v8 useReactTable generic pattern with SortingState
    - LucideIcon prop type for icon injection in EmptyState

key-files:
  created:
    - frontend/components/ui/command-palette.tsx
    - frontend/components/ui/animated-number.tsx
    - frontend/components/ui/status-badge.tsx
    - frontend/components/ui/money-display.tsx
    - frontend/components/ui/data-table.tsx
    - frontend/components/ui/empty-state.tsx
  modified: []

decisions:
  - id: "04-06-A"
    summary: "BigInt(100) instead of 100n literal for ES2017 compat"
    detail: "tsconfig.json target was ES2017 at time of writing; BigInt literal syntax (100n) requires ES2020+. Used BigInt(100) function call which is compatible with both. Note: 04-05 later bumped target to ES2020 so the literal form would also work, but the function form is equally valid and more defensive."
  - id: "04-06-B"
    summary: "React Compiler warning on useReactTable is expected and benign"
    detail: "TanStack Table v8 useReactTable() returns functions that cannot be safely memoized by React Compiler. This produces a 'Compilation Skipped' warning but not an error. The table still renders correctly; memoization is simply skipped for this component. This is a known TanStack Table v8 + React Compiler compatibility note."
  - id: "04-06-C"
    summary: "CommandPalette uses existing Dialog component, not a custom portal"
    detail: "The plan allowed using existing shadcn Dialog or a simple portal overlay. Wrapping cmdk's Command inside the project's Dialog/DialogContent gives consistent overlay blur, keyboard trap, and animation (scaleIn) for free, and removes a custom portal implementation."

metrics:
  tasks-completed: 2
  tasks-total: 2
  deviations: 1
  commits:
    - "08a3d6a feat(04-06): CommandPalette, AnimatedNumber, StatusBadge"
    - "dbbbbe9 feat(04-06): MoneyDisplay, DataTable, EmptyState + DataTableSkeleton"
---

# Phase 4 Plan 06: UI Primitives (DS-04) Summary

**One-liner:** 6 typed shell-level UI primitives — cmdk CommandPalette, react-countup AnimatedNumber, semantic StatusBadge, BigInt MoneyDisplay, TanStack DataTable with skeleton/empty state, and icon-first EmptyState.

## Objective

Close DS-SHELL-04 (missing global components / UI primitives) by building the 6 core generic components consumed by the Top Bar shell chrome (04-07) and all future module UIs (phases 5–12).

## Tasks Completed

| # | Task | Commit | Files Changed |
|---|------|--------|---------------|
| 1 | CommandPalette + AnimatedNumber + StatusBadge | `08a3d6a` | command-palette.tsx, animated-number.tsx, status-badge.tsx |
| 2 | MoneyDisplay + DataTable + EmptyState | `dbbbbe9` | money-display.tsx, data-table.tsx, empty-state.tsx |

## What Was Built

### CommandPalette (`components/ui/command-palette.tsx`)

`<CommandPalette open onOpenChange>` — wraps `cmdk`'s `Command` inside the project's `Dialog`/`DialogContent`. Features:
- Global `⌘K` / `Ctrl+K` keydown listener via `useEffect` (cleanup on unmount)
- Search input with `placeholder="Type a command or search…"`
- `<Command.Empty>` renders "No results found." when filter is empty
- `scaleIn` CSS animation class on the dialog content (from 04-04 keyframes)
- `aria-label="Command palette"` + visually-hidden `DialogTitle` for screen readers
- Re-exports: `CommandItem`, `CommandGroup`, `CommandSeparator` for consumer convenience

### AnimatedNumber (`components/ui/animated-number.tsx`)

`<AnimatedNumber value prefix suffix decimals duration>` — wraps `react-countup`'s `CountUp`:
- `useEasing`, `enableScrollSpy`, `scrollSpyOnce` for scroll-triggered reveal
- Defaults: `decimals=0`, `duration=1.5s`
- Wrapped in `<span className="tabular-nums">` for consistent column alignment

### StatusBadge (`components/ui/status-badge.tsx`)

`<StatusBadge status label className>` — renders a semantic pill for:
- `active` / `success` → `bg-success/15 text-success border-success/30`
- `error` → `bg-destructive/15 text-destructive border-destructive/30`
- `warning` → `bg-warning/15 text-warning border-warning/30`
- `pending` → `bg-info/15 text-info border-info/30`
- `inactive` → `bg-muted text-muted-foreground border-border`
- Auto-capitalizes status string if no `label` provided

### MoneyDisplay (`components/ui/money-display.tsx`)

Server-compatible (no `'use client'`). `<MoneyDisplay paisa currency className>`:
- Accepts `paisa: number | bigint` — enforces the integer-only contract (§18 Rule 2)
- Integer division: `rupeesWhole = BigInt(paisa) / BigInt(100)` (no floats)
- `Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR' })` for locale-correct formatting
- `tabular-nums font-medium` for consistent table alignment

### DataTable (`components/ui/data-table.tsx`)

Generic `DataTable<TData>` using `@tanstack/react-table` v8:
- Props: `columns: ColumnDef<TData, unknown>[]`, `data: TData[]`, `isLoading?`, `emptyMessage?`, `pageSize?` (default 10)
- When `isLoading` → renders `<DataTableSkeleton columns={columns.length} />` (from 04-05)
- When `data.length === 0` → renders `<EmptyState title={emptyMessage ?? "No data"} />`
- Sorting: click-to-sort column headers with `ChevronUp` / `ChevronDown` / `ChevronsUpDown` indicators
- Pagination: prev/next buttons + "Showing X–Y of N" row count
- Re-exports `ColumnDef` from `@tanstack/react-table` for consumer convenience

### EmptyState (`components/ui/empty-state.tsx`)

`<EmptyState icon title description action className>`:
- Default icon: `Inbox` from lucide-react (overridable with any `LucideIcon`)
- Centered layout: `flex-col items-center gap-3 py-12 text-center`
- Optional `action: { label, onClick }` renders a `Button` with `variant="outline"`
- `'use client'` directive added because the `action.onClick` prop requires client-side interactivity

## Deviations from Plan

### Auto-fixed Issues

**[Rule 3 - Blocking] DataTableSkeleton pre-created for DataTable dependency**

- **Found during:** Task 2
- **Issue:** `DataTableSkeleton` required by `DataTable` did not exist when task began; 04-05 had not yet been executed and the `skeletons/` directory was absent.
- **Fix:** Created `frontend/components/skeletons/data-table-skeleton.tsx` with configurable `columns`/`rows` props. Subsequently, 04-05 was executed and committed its own version — the 04-05 version is the authoritative one (compatible with `DataTable`'s import).
- **Files modified:** `frontend/components/skeletons/data-table-skeleton.tsx`
- **Commit:** `dbbbbe9`

## Integration Notes for Downstream Consumers

| Component | Import | Key Props |
|-----------|--------|-----------|
| `CommandPalette` | `@/components/ui/command-palette` | `open`, `onOpenChange`, `children` (use `CommandGroup`/`CommandItem`) |
| `CommandItem` | `@/components/ui/command-palette` | Standard cmdk Item props |
| `CommandGroup` | `@/components/ui/command-palette` | `heading` for group label |
| `AnimatedNumber` | `@/components/ui/animated-number` | `value`, `prefix`, `suffix`, `decimals`, `duration` |
| `StatusBadge` | `@/components/ui/status-badge` | `status: StatusVariant`, `label?` |
| `MoneyDisplay` | `@/components/ui/money-display` | `paisa: number \| bigint`, `currency?` |
| `DataTable` | `@/components/ui/data-table` | `columns: ColumnDef<T>[]`, `data: T[]`, `isLoading?` |
| `ColumnDef` | `@/components/ui/data-table` | Re-exported from `@tanstack/react-table` |
| `EmptyState` | `@/components/ui/empty-state` | `icon?`, `title`, `description?`, `action?` |

**04-07 Top Bar:** Mount `<CommandPalette>` with `open`/`onOpenChange` state; add command items for navigation shortcuts.

**Module UIs (05–12):** Use `DataTable<YourType>` with `columns` defined as `ColumnDef<YourType, unknown>[]`; `MoneyDisplay` accepts raw paisa integers from server actions.

## Verification Results

```
✓ pnpm exec tsc --noEmit — 0 errors (from frontend/)
✓ pnpm run lint — 0 errors introduced (pre-existing error in appearance-form.tsx from 04-08; warning on data-table.tsx is React Compiler compat note)
✓ pnpm run build — passes (Next.js 16 + Turbopack)
✓ grep -q "cmdk" frontend/components/ui/command-palette.tsx — PASS
✓ grep -q "CountUp" frontend/components/ui/animated-number.tsx — PASS
✓ grep -q "BigInt" frontend/components/ui/money-display.tsx — PASS
✓ grep -q "useReactTable" frontend/components/ui/data-table.tsx — PASS
✓ grep -q "EmptyState" frontend/components/ui/empty-state.tsx — PASS
✓ CommandPalette: ⌘K/Ctrl+K trigger, search input, grouped results dialog
✓ AnimatedNumber: scroll-spy countup with tabular-nums
✓ StatusBadge: 6 semantic token variants, auto-capitalize
✓ MoneyDisplay: BigInt integer math, no floating-point, Intl formatting
✓ DataTable: sort headers, pagination, isLoading→skeleton, empty→EmptyState
✓ EmptyState: icon + title + description + optional CTA
✓ Zero `any` across all 6 components
```

## Next Phase Readiness

Plan 04-07 (Top Bar + shell chrome) can now:
- Mount `<CommandPalette>` in the top bar with navigation command items
- Use `<AnimatedNumber>` in KPI stat widgets
- Use `<StatusBadge>` for branch/tenant status indicators

All module UIs (phases 5–12) can now:
- Use `<DataTable<T>>` with `isLoading` → skeleton pattern
- Use `<MoneyDisplay paisa={...} />` with server-provided integer paisa values
- Use `<EmptyState>` for zero-results states in lists and tables
- Use `<StatusBadge>` for order/inventory/employee status pills
