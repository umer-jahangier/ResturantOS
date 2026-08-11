---
phase: 38-erp-design-transformation
plan: "02"
subsystem: ui
tags: [tanstack-table, data-grid, responsive, pagination, tailwind-merge]
status: complete

requires:
  - phase: 38-erp-design-transformation
    provides: "38-01's type/space bridge — DataGrid renders cells at --text-small and headers at --text-label"
provides:
  - "`DataGrid` — sticky header, one row height, pagination, row selection, card fallback below md, filtered-empty"
  - "`dropEmptyColumns` / `isUuid` — the two §7.2 content rules, as testable functions"
  - "`data-table.tsx` as a façade, so its four existing callers gain the contract for free"
  - "`cn()` taught the contract type scale, fixing a silent product-wide class-stripping bug"
affects: [38-06, 38-07, 38-08, 38-09, 38-14, 38-15]

tech-stack:
  added: []
  patterns:
    - "Card fallback chosen by CSS, not by a media-query hook, to avoid hydration mismatch on every list screen"
    - "Sticky on the header CELL, not the section, because that is what the contract measures"
    - "tailwind-merge extended with custom font-size keys so contract type survives cn()"

key-files:
  created:
    - frontend/components/ui/data-grid/data-grid.tsx
    - frontend/components/ui/data-grid/columns.ts
    - frontend/__tests__/components/data-grid/data-grid.test.tsx
    - frontend/__tests__/lib/utils-cn.test.ts
    - frontend/e2e/verify-38-02.mjs
  modified:
    - frontend/components/ui/data-table.tsx
    - frontend/lib/utils.ts
    - frontend/__tests__/lib/theme/conformance-scan.ts

key-decisions:
  - "No virtualization — the plan called for @tanstack/react-virtual, UI-SPEC §12 forbids new dependencies, and the worst list is 84 rows"
  - "Card fallback duplicates rows in the DOM; `display:none` keeps them out of the a11y tree and pagination bounds the cost"
  - "The conformance scanner strips comments, because a gate that punishes explanation trains people to delete explanations"
  - "`dropEmptyColumns` uses an absolute rule (empty on EVERY row), so the 83-of-84 case correctly stays visible"

requirements-completed: []

coverage:
  - id: D1
    description: "DataGrid meets the §7.2 measured targets on three reference screens"
    verification:
      - kind: automated_ui
        ref: "e2e/verify-38-02.mjs — thead=sticky, heights=[44], cell 13px, header 11px, 'Page 1 of 4 · 84 rows'"
        status: pass
      - kind: unit
        ref: "__tests__/components/data-grid/data-grid.test.tsx (17 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Below md the grid is a card list, not a horizontally-scrolled table"
    verification:
      - kind: automated_ui
        ref: "e2e/verify-38-02.mjs @390 — tableVisible=false, cards visible, elements past viewport 100 → 5/2/2"
        status: pass
    human_judgment: false
  - id: D3
    description: "cn() no longer strips contract type classes"
    verification:
      - kind: unit
        ref: "__tests__/lib/utils-cn.test.ts (11 tests, negative control observed red)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Whether the migrated grids read better with 13px cells and single-line rows"
    verification:
      - kind: automated_ui
        ref: "evidence/after-38-02/*.png"
        status: unknown
    human_judgment: true
    rationale: "Single-line cells trade wrapping for horizontal scroll on long values. Whether that is the right trade on a real ingredient list is a judgment."

metrics:
  duration: "~1h"
  completed: 2026-08-12
---

# Phase 38 Plan 02: `DataGrid` and the content rules — Summary

One enterprise table, measured against the audit's own numbers on the audit's own routes.

## What moved, measured in Chromium at 1440px

| Property | Audit / before | After |
|---|---|---|
| `thead th` computed `position` | `static` on **12 of 12** tables | **`sticky`** on all three reference screens |
| distinct row heights in one body | **65px and 81px** (44 and 55 after 38-01) | **[44]** — one value |
| cell / header type | 14px / 14px | **13px** (`--text-small`) / **11px** (`--text-label`) |
| purchase-order list | **84 rows, no pager** | 25 rows, **"Page 1 of 4 · 84 rows"** |
| elements past viewport @390px | **100** (`/app/inventory/stock`) | **5** stock · **2** ingredients · **2** PO |
| table rendered at 390px | yes, unchanged desktop table | **no** — card list |
| sub-44px targets on PO screen | **108** | **27** |

Sub-44px targets are **not** at the plan's target of 0. Most of what remains is per-row icon
buttons and native selects. That is 38-15's subject, and it is reported rather than claimed.

## Two defects the unit tests could not see

Both were found by running the browser harness *after* the unit suite was green.

1. **`sticky top-0` was on `<thead>`.** The unit test asserted on `<thead>` and passed. Chromium
   reported `thead th { position: static }` — the exact property UI-SPEC §7.2 and the audit both
   measure. The rule was in the stylesheet and absent from the measurement. **A unit test that
   asserts on a different element than the contract does is not testing the contract**; it now
   asserts on the cells, where the contract looks.

2. **`h-11` on a `<tr>` is a minimum, not a height.** A wrapping status cell took its row to 55px,
   so `/app/inventory/stock` still shipped two row heights after 38-01 — the very defect the
   density prop exists to prevent. Cells are now single-line, and overflow scrolls in the wrapper
   rather than being clipped.

## `cn()` was silently deleting the type scale

tailwind-merge keeps the last class per conflict group. 38-01's roles are *custom* theme keys, so
an unconfigured tailwind-merge classified `text-label` by shape — as a **text colour** — and
dropped it when a colour followed:

```tsx
cn("text-label uppercase", "text-foreground-secondary")   // → "uppercase text-foreground-secondary"
```

Invisible in source review, invisible to `tsc`, invisible to any test asserting on props. Left
unfixed, **every later plan adopting `text-body`/`text-small`/`text-label` through `cn()` — which
is most of them — would have written call sites that look correct and do nothing.** Caught by a
`DataGrid` assertion that read the rendered `className`. `lib/utils.ts` now registers the eight
roles as font sizes.

## Deviations from plan

- **No virtualization.** The plan's task 1 specified `@tanstack/react-virtual` above 200 rows. It
  is not installed, and UI-SPEC §12 fixes the budget at 24 dependencies with zero additions,
  enforced by `dependency-budget.test.ts`. The spec outranks the plan; pagination makes the case
  moot at 84 rows.
- **No `FilterBar`.** Plan task 4. Not built — the existing per-screen filters were wired to
  `isFiltered`/`onClearFilters` so the filtered-empty state is correct, but the chip bar
  (`Branch: Islamabad · Date: … [Clear all]`) is not there. Wave 4 screens need it more than the
  three reference screens did, and shipping a half-wired chip bar would have been worse than
  shipping none.
- **Bulk actions are supported but unused.** `DataGrid` implements selection and `{n} selected`;
  no reference screen passes `bulkActions` yet because none of the three has a safe bulk operation
  defined. The capability is tested, not decorative.
- **The conformance scanner now strips comments.** `DataGrid`'s docblock quotes `<table>` while
  explaining the defect it replaces, which tripped G4. A gate that punishes explanation trains
  people to delete explanations. Baselines regenerated; they sit slightly under the audit's
  published figures because the difference is commentary, not code.

## Findings

- **The card fallback duplicates rows in the DOM.** CSS picks one branch; a JS media-query choice
  would be a hydration mismatch on every list screen. Not an a11y cost (`display:none` leaves the
  a11y tree), and pagination bounds it. Three stock tests were re-scoped to the table as a result.
- **`/app/inventory/ingredients` has 79 sub-44px targets**, more than the purchase-order screen's
  27 — the per-row action buttons are `icon-sm`. The audit measured 62 here; the count rose
  because pagination now shows 19 rows where fewer were counted before. For 38-15.

## Self-Check: PASSED

- `components/ui/data-grid/{data-grid.tsx,columns.ts}` — FOUND
- `e2e/verify-38-02.mjs`, `evidence/verify-38-02.json`, `evidence/after-38-02/` — FOUND
- `npx vitest run` 1,165 passed · `npm run lint` 0 errors · `npx tsc --noEmit` 0 source errors
