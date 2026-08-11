---
phase: 38-erp-design-transformation
plan: "01"
subsystem: ui
tags: [tailwind-v4, design-tokens, typography, spacing, page-header, conformance-gates, query-boundary]
status: complete

requires:
  - phase: 20-design-system
    provides: the eight type roles and seven space steps, declared but withheld from `@theme`
  - phase: 34-visual-design-language
    provides: richness zones, glass/depth contract, motion vocabulary, `QueryBoundary`
provides:
  - "`--text-*` bridged into `@theme`: eight contract roles reachable as `text-body`, `text-h1`, … each carrying size AND line-height"
  - "`PageHeader` — the one `<h1>`, replacing 63 hand-written page headings"
  - "`PageBody` — the one page-gutter owner, with a `fullBleed` opt-out that finally makes POS/KDS/floor-plan full-bleed possible"
  - "Nine screens migrated to the contract type/radius scale"
  - "Conformance gates G1–G4 with per-file baselines that may only decrease"
  - "`sizing-namespace` gate — catches a token bridge silently redefining width utilities"
  - "Three audit-found functional bugs fixed"
affects: [38-02, 38-03, 38-04, 38-05, 38-06, 38-07, 38-08, 38-09, 38-10, 38-12, 38-13, 38-14, 35-hr-usability]

tech-stack:
  added: []
  patterns:
    - "Token bridging by NEW utility name, so nothing re-typesets until a call site is deliberately migrated"
    - "Spacing consumed as `p-(--space-lg)` rather than a `--spacing-*` theme key, to avoid namespace collision"
    - "`main:has([data-page-body])`, unlayered, so the shell default yields only to a migrated page"
    - "Conformance baselines where a file absent from the baseline must score zero"

key-files:
  created:
    - frontend/components/ui/page-header.tsx
    - frontend/components/ui/page-body.tsx
    - frontend/__tests__/lib/theme/built-css.ts
    - frontend/__tests__/lib/theme/type-scale.test.ts
    - frontend/__tests__/lib/theme/conformance-scan.ts
    - frontend/__tests__/lib/theme/conformance.test.ts
    - frontend/__tests__/lib/theme/conformance-baseline.json
    - frontend/__tests__/lib/theme/sizing-namespace.test.ts
    - frontend/e2e/verify-38-01.mjs
  modified:
    - frontend/app/globals.css
    - frontend/components/dashboard/manager-dashboard.tsx
    - frontend/components/dashboard/portlets/portlet.tsx
    - frontend/components/pos/table-floor-view.tsx

key-decisions:
  - "Bridge by publishing NEW names (`text-body`) rather than redefining `text-sm`, so the 981 legacy call sites keep their current size until their own screen plan migrates them"
  - "Do NOT bridge the space scale into `--spacing-*` — that namespace also drives `max-w-*`/`w-*`/`min-w-*`, and the collision is total"
  - "`PageBody` opt-in via `:has()`, so the 55 unmigrated routes render byte-identically"
  - "`RankedRow.fraction` becomes optional rather than being given a real value — 86'd is a boolean, so no honest bar exists"

requirements-completed: []

coverage:
  - id: D1
    description: "The eight type roles are reachable as utilities carrying size and line-height together"
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/type-scale.test.ts (20 tests, against the BUILT stylesheet)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Width utilities resolve from the container scale, never the spacing scale — no dialog collapses"
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/sizing-namespace.test.ts (8 tests)"
        status: pass
      - kind: automated_ui
        ref: "e2e/verify-38-01.mjs — Add table dialog measured max-width 448px in Chromium"
        status: pass
    human_judgment: false
  - id: D3
    description: "PageHeader/PageBody adopted on nine screens; exactly one <h1>; gutter owned by PageBody"
    verification:
      - kind: automated_ui
        ref: "e2e/verify-38-01.mjs — h1=1 and mainPad=0px on 8 migrated routes, both themes; mainPad=24px on unmigrated"
        status: pass
    human_judgment: false
  - id: D4
    description: "Conformance gates G1–G4 fail on new drift"
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/conformance.test.ts (14 tests, 5 negative controls observed red)"
        status: pass
    human_judgment: false
  - id: D5
    description: "POS Floor View reports a failed read as a failure, not as an absence of tables"
    verification:
      - kind: unit
        ref: "__tests__/pos/table-floor-view.test.tsx — 503 renders role=alert, not the empty state"
        status: pass
    human_judgment: false
  - id: D6
    description: "Visual quality of the nine migrated screens at four widths in both themes"
    verification:
      - kind: automated_ui
        ref: "evidence/after-38-01/*.png — 24 screenshots"
        status: unknown
    human_judgment: true
    rationale: "Type converging from 14px to 13/15px changes line counts on every list screen. Whether the result reads better is a judgment no assertion makes."

metrics:
  duration: "~2h"
  completed: 2026-08-12
---

# Phase 38 Plan 01: The type and space bridge, `PageHeader` and `PageBody` — Summary

Made the phase-20 type scale **reachable** after eight phases of being declared and ignored, gave
every page one heading component and one padding owner, and fixed three functional bugs the audit
found. Also shipped, and then caught and fixed, a token-bridge defect that collapsed every dialog
in the product.

## What moved

| Measure | Audit (2026-08-12) | Start of 38-01 | After 38-01 |
|---|---|---|---|
| Tailwind type-scale classes | 986 | **1,037** | **981** |
| contract type-token classes | 1 | 1 | 8 roles reachable as utilities |
| bare `rounded` (off-ladder 4px) | 145 | **149** | **141** |
| files hand-rolling `<table>` | 37 | 39 | 39 *(38-02 owns this)* |
| raw palette literals | 180 | 180 | 180 *(38-04 owns this)* |
| `<h1>` on migrated routes | drifted 20/24px, 4 screens at 0 | — | **exactly 1, at `--text-h1`, on 9 screens** |

The middle column is the finding that justifies the gates: **re-running the audit's own commands
days later returned higher numbers than the audit.** Nobody added that drift deliberately; the
product simply had no mechanism that noticed.

## The defect this plan shipped, and how it was caught

The first cut published the seven usage steps into Tailwind's `--spacing-*` namespace, which is
also the namespace `max-w-*`, `w-*` and `min-w-*` consult for a *named* key — in preference to
`--container-*`:

```
before   .max-w-sm { max-width: var(--container-sm) }   24rem = 384px
after    .max-w-sm { max-width: var(--space-sm)     }            8px
after    .max-w-lg { max-width: var(--space-lg)     }           24px
```

`dialog.tsx` sizes its panel `sm:max-w-sm` and 53 call sites override with `max-w-md`/`lg`/`2xl`,
so **every dialog in the product became a sliver** — including screens no design plan had touched.

`tsc` was clean. ESLint was clean. All 1,127 unit tests passed. This plan's own new type-scale
gate went green. jsdom does not apply the stylesheet, so a `render()` + `getComputedStyle` test
would have passed too. **It was found by a person opening a dialog**, reported through the
coordinator by the phase-35 agent.

Re-declaring `--container-sm` alongside was measured and does **not** help — `--spacing-*` wins,
and the collision is total because the contract's step names *are* the container scale's keys. The
steps therefore stay plain custom properties, consumed as `p-(--space-lg)`.

Recorded in **UI-SPEC §7.2.1** and **audit §10.1e**, and gated by `sizing-namespace.test.ts`,
which resolves each width utility through the built stylesheet to a pixel value.

A second, quieter defect surfaced in the same browser pass: `main:has([data-page-body])` was
written inside `@layer base`, where it lost to `<main>`'s own `p-4 lg:p-6` utilities *regardless
of specificity*, because a later cascade layer always wins. Migrated pages rendered with both
gutters (24 + 24px). Now unlayered, and verified at `mainPad=0px`.

## The three functional bugs

1. **The bar that always read 100%.** `manager-dashboard.tsx:122` gave every 86'd item
   `fraction: 1`, and `portlet.tsx:268` drew `width: fraction × 100%`. `RankedRow.fraction` is now
   optional and no fraction means no bar — "this item is 86'd" is a boolean, so there is no honest
   bar to draw. The sibling `stationLoad`, four lines away, keeps its real `count / max`.

2. **One `QueryBoundary` over four queries.** Any one service failing replaced all four KPI tiles
   *and the two rows below them* with a single error box — which is exactly what the audit's first
   screenshot captured. Now one boundary per portlet, each naming only the queries its region
   reads. Two boundaries deliberately keep an array (`late tickets` needs stations for their own
   thresholds; `Act now` must not report "nothing needs you" from a partial read).

3. **"No tables configured" vs five tables.** Diagnosed against the live gateway before changing
   anything: `GET /api/v1/pos/tables?branchId=34cd6f62-…` returns **5 active tables** (9 with
   `includeInactive`). The backend and `/app/tables` were both right. This component destructured
   `{ data: tables = [], isLoading }` and never read `isError` — GA-001 bug shape 2, which
   `query-boundary.tsx`'s own docblock names. A second path reaches the same false message with no
   error at all: `useTables` is `enabled: !!branchId`, and in TanStack v5 a *disabled* query
   reports `isPending: true` but `isLoading: false`, so the guard fell through during session
   bootstrap. Now behind `QueryBoundary`.

## Gates, and the negative controls observed

Every gate was watched failing before it was trusted (D-38-07).

| Gate | Negative control | Observed |
|---|---|---|
| type-scale | `--text-body` → 14px | RED: expected 15px, received 14px |
| type-scale | deleted `--text-body--line-height` | RED — **and the size assertion still passed**, which is why they are asserted separately |
| type-scale | moved `@theme` block back to `:root` (pre-38-01 state) | RED ×9: "text-display is not a utility" while `builtVar` still passed — the exact false green a source-parsing test gives |
| type-scale | removed `--spacing-md` | RED: `p-md` not generated |
| G1 | added `text-2xl` to a migrated file | RED: new offender |
| G2 | added bare `rounded` to `page-header.tsx` | RED |
| G3 | added `bg-emerald-500` to `page-body.tsx` | RED |
| G4 | added a second `<table>` | RED |
| baseline inflation | raised a per-file allowance to 5 | per-file check PASSED; **total check caught it** at 986 > 981 |
| sizing-namespace | reinstated the `--spacing-*` bridge | RED ×6: "max-w-sm resolves to 8px" |
| sizing-namespace | `--container-sm` → `2rem` | RED — proves the gate tracks the emitted value, not a constant |
| floor view | reverted to `isError` unread | RED: "Unable to find role=alert" |

## Deviations from plan

**[Rule 2 — missing critical functionality] The spacing bridge was reworked mid-plan.** The plan
said "bridge `--text-*` and `--space-*` into `@theme`". Doing so for `--space-*` is what broke
every dialog. The plan's instruction is followed for type and deliberately *not* for space; the
reason is recorded in `globals.css`, UI-SPEC §7.2.1 and the audit.

**[Rule 1 — bug] `main:has()` moved out of `@layer base`.** Not in the plan; found by measuring.

**Nine screens migrated, not ten.** The plan asked for ten "including the four that render no
`<h1>`". Three of those four are POS routes (`/app/pos`, `/app/pos/tills`, POS order management)
whose shell is **38-04's** actual deliverable, and the fourth is `/app/hr/attendance`, whose
neighbouring files are held by another agent. Migrating them here would have collided with both.
Migrated instead: stock, ingredients, setup, purchase-orders, vendors, order-suggestions, tables,
periods, reports.

## Findings for later plans

- **`/app/finance/periods` renders "Access denied" for a branch manager.** The migration is
  committed but was **never visually verified** — the persona cannot reach the screen. Same class
  of limitation as the audit's settings gap. Whoever owns finance should re-verify under a
  TOTP-capable persona.
- **The purchase-order API has no PO-number field at all.** Keys are `branchId`, `closeReason`,
  `closedAt`, `expectedDeliveryDate`, `id`, `lines`, `notes`, `requesterId`, `requiredTiers`,
  `status`, `submittedAt`, `tiersApproved`, `totalPaisa`, `vendorId`. The truncated UUID is not a
  display choice — there is nothing human to render. Belongs in audit §12, not §5.3.
- **`expectedDeliveryDate` is populated on 1 of 84 rows, not 0 of 84** as the audit stated.
- **`/app/inventory/stock` still renders 109 nodes at 14px** after migration, because the shared
  `DataTable` sets `text-sm` on the `<table>` and every cell inherits it. The page's own classes
  converged; the component's did not. **38-02 owns this**, and it is the single highest-leverage
  remaining type change.
- **Content still overflows containers at narrow widths**: 146 elements past the viewport at
  390px on `/app/inventory/stock` (audit measured 100; the harnesses count slightly differently).
  Page-level horizontal scroll remains 0 at every width. **38-02's card fallback owns this.**

## Self-Check: PASSED

- `frontend/components/ui/page-header.tsx`, `page-body.tsx` — FOUND
- `frontend/__tests__/lib/theme/{type-scale,conformance,sizing-namespace}.test.ts` — FOUND
- Commit `0cdcb523` — FOUND
- `npm run lint` 0 errors · `npx tsc --noEmit` 0 source errors · `npx vitest run` 1,136 passed
