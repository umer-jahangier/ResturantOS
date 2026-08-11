---
phase: 38-erp-design-transformation
plan: "03"
subsystem: ui
tags: [confirm-dialog, aria-modal, accessibility, radix, destructive-actions]
status: partial

requires:
  - phase: 38-erp-design-transformation
    provides: "38-01's type scale (ConfirmDialog's error slot renders at --text-small)"
provides:
  - "`ConfirmDialog` — one primitive replacing five bespoke confirmations"
  - "`aria-modal=\"true\"` on every dialog surface, palette included"
  - "`NON_ANSWER_LABELS` — the shared denylist the gate and the component both read"
affects: [38-04, 38-06, 38-07, 38-08, 38-10, 38-15]

tech-stack:
  added: []
  patterns:
    - "Destructive confirmation through one primitive whose confirm button restates the verb"
    - "A server refusal renders inside the confirmation, above the buttons, as role=alert"

key-files:
  created:
    - frontend/components/ui/confirm-dialog.tsx
    - frontend/__tests__/components/ui/confirm-dialog.test.tsx
  modified:
    - frontend/components/ui/dialog.tsx
    - frontend/app/(tenant)/app/stations/page.tsx
    - frontend/app/(tenant)/app/inventory/categories/page.tsx
    - frontend/app/(tenant)/app/inventory/ingredients/page.tsx
    - frontend/app/(tenant)/app/inventory/setup/page.tsx
    - frontend/app/(tenant)/app/purchasing/vendors/[id]/page.tsx

key-decisions:
  - "void-refund-dialog is a workflow FORM, not a confirmation — it keeps its own dialog and moves to 38-04"
  - "ConfirmDestructiveDialog (platform) is a deliberate specialization, not drift — kept"
  - "StatusBadge consolidation deferred rather than rushed: 43 files reference six implementations"

requirements-completed: []

coverage:
  - id: D1
    description: "One ConfirmDialog; five bespoke confirmations gone; confirm labels restate the verb"
    verification:
      - kind: unit
        ref: "__tests__/components/ui/confirm-dialog.test.tsx (17 tests, 3 negative controls observed red)"
        status: pass
      - kind: automated_ui
        ref: "Chromium — archive confirmation: title 'Archive \"Audit Test Olive Oil\"?', button 'Archive ingredient', 384px"
        status: pass
    human_judgment: false
  - id: D2
    description: "aria-modal is set on every dialog surface including the command palette"
    verification:
      - kind: automated_ui
        ref: "Chromium — confirm dialog aria-modal=true, ⌘K palette aria-modal=true"
        status: pass
    human_judgment: false
  - id: D3
    description: "One StatusBadge replacing six"
    verification: []
    human_judgment: true
    rationale: "NOT BUILT. Deferred — see Deviations."
  - id: D4
    description: "Required-field indication (visual marker + aria-required)"
    verification: []
    human_judgment: true
    rationale: "NOT BUILT. Deferred — see Deviations."

metrics:
  duration: "~40m"
  completed: 2026-08-12
---

# Phase 38 Plan 03: One `ConfirmDialog`, and `aria-modal` — Summary

**Partial.** Two of the plan's seven tasks are complete and verified; three are deferred with
their measurements intact. Stated plainly rather than counted as done.

## Done

**One `ConfirmDialog` replacing five.** `grep -rl 'AlertDialog\|ConfirmDialog'` returned **0** —
no primitive — while confirmation was implemented six separate times as a bespoke `Dialog` plus a
local handler. Brief §50 was *behaviourally* satisfied and *structurally* violated; §62 requires
that if one delete confirms, all equivalent deletes confirm, and six independent copies is exactly
how that stops being true.

Migrated: `stations`, `inventory/categories`, `inventory/ingredients`, `inventory/setup`,
`purchasing/vendors/[id]`. The primitive gained an `error` slot so the categories and setup screens
could migrate **without losing their inline server refusal** — "the primitive does not support my
case" is how the seventh bespoke dialog gets written.

**`aria-modal` on every dialog.** Measured `null` on all three dialogs the audit probed. Now set on
the shared `DialogContent`, so the palette inherits it. The negative control is the interesting
part: removing the attribute made the rendered dialog lack it entirely, which **confirms Radix was
never supplying it** and the audit's finding was real rather than a probe artefact.

Verified in Chromium: `aria-modal="true"`, `role="dialog"`, 384px wide, title
`Archive "Audit Test Olive Oil"?`, confirm button `Archive ingredient`. Palette: `aria-modal="true"`.

## A seventh confirmation the audit could not have found

`components/platform/confirm-destructive-dialog.tsx`. The audit grepped for
`AlertDialog|ConfirmDialog`; this is named `ConfirmDestructiveDialog`, so it was invisible to that
command. (Found via the project's code-intelligence index, not by grepping harder.)

It is **kept**, because it is a specialization rather than drift: it requires the operator to type
the tenant's name before suspending a tenant or disabling a module. Its own docblock makes the
argument — those actions are one click from a list of visually similar rows, and "Are you sure?"
confirms the *intent to click*, not the *identity of the target*. Recorded in the audit.

## Deviations from plan — what is NOT done

- **The six `StatusBadge` implementations are untouched.** 43 files reference one of
  `ui/status-badge`, `purchasing/PoStatusBadge`, `pos/payment-status-badge`,
  `pos/sync-status-badge`, `platform/tenant-badges`, `finance/PeriodStatusChip`. Collapsing them
  means unifying status *semantics* across purchasing, POS, platform and finance in one pass. A
  status that silently changes meaning on a finance screen is a worse outcome than six badges, and
  I did not have the budget to do it with per-variant verification. Deferred with the measurements
  intact; two of the six (`PoStatusBadge`, `PeriodStatusChip`) are also raw-palette offenders, so
  38-04's colour convergence and this should probably land together.
- **Required-field indication is not built.** Plan task 4. `requiredMarked: 0` in both audited
  dialogs remains true.
- **`/app/hr/attendance` labelling is not done.** Plan task 6. `hr-service` is up again (port
  8088, health 200), so the re-audit the plan requires is now *possible* — but the neighbouring
  HR files are held by another agent, and the plan itself says to re-audit before executing.
- **`void-refund-dialog.tsx` was not migrated, deliberately.** It is not a confirmation: it is a
  workflow form with a required reason, a FULL/PARTIAL scope selector and a partial-amount field.
  Forcing it through `ConfirmDialog` would have deleted the reason field. It is an `operational`
  POS surface; reassigned to **38-04**.
- **G4 was not extended to count `StatusBadge`/`ConfirmDialog` implementations generically.**
  Instead the confirm-dialog gate asserts the five migrated files import the primitive and declare
  no `<DialogFooter>` of their own, which is the specific regression worth catching. A generic
  "count implementations" regex over six differently-named components would have been a gate that
  matches by luck.

## Self-Check: PASSED

- `components/ui/confirm-dialog.tsx` — FOUND
- `__tests__/components/ui/confirm-dialog.test.tsx` — FOUND, 17 tests
- `npx vitest run` 1,182 passed · `npm run lint` 0 errors · `npx tsc --noEmit` 0 source errors
