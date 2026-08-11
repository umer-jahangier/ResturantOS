---
phase: 34-visual-design-language
plan: 06
subsystem: ui
tags: [dashboard, glass, depth, stagger, portlets]

requires:
  - phase: 34-visual-design-language
    provides: "34-02 glass tokens + manifest; 34-03 .vdl-stagger and .vdl-lift; 34-04 primitives"
provides:
  - "Glass portlets on a depth-layered grid, with a hover lift on every drillable tile"
  - "A staggered entrance across each portlet row, delay computed from --vdl-i"
  - "Before/after evidence for the dashboard in both themes"
affects: [34-08]

tech-stack:
  added: []
  patterns:
    - "Treatment-only changes to a screen: no portlet added, removed, reordered or re-typed"

key-files:
  created: []
  modified:
    - frontend/components/dashboard/portlets/portlet.tsx
    - frontend/components/dashboard/dashboard-shell.tsx

key-decisions:
  - "PortletShell uses the `glass-surface` class directly rather than wrapping in GlassPanel, because it is already a Link and the whole card is the drill target (§7.3). Wrapping would have introduced a box between the link and its content."
  - "The stagger index is set by PortletRow via cloneElement rather than by each dashboard, so a preset gaining a portlet needs no delay bookkeeping."

patterns-established:
  - "A screen's treatment change touches only className, never composition"

requirements-completed: []

coverage:
  - id: D1
    description: "The role dashboards are visibly transformed — glass portlets on a depth-layered grid with a hover lift"
    requirement: VDL-02
    verification:
      - kind: automated_ui
        ref: "playwright:.planning/phases/34-visual-design-language/evidence/before/dashboard-{light,dark}.png vs after/dashboard-{light,dark}.png"
        status: pass
      - kind: e2e
        ref: "e2e/journeys/operational-zone-containment.spec.ts — glass did not leak toward the operational zone"
        status: pass
    human_judgment: true
    rationale: "Whether the transformation is sufficient for the user's stated complaint ('very basic… raw and plain') is a judgment only they can make. The measurable properties hold; the aesthetic verdict does not follow from them."
  - id: D2
    description: "The trend chart draws itself in with byte-identical final geometry"
    verification: []
    human_judgment: true
    rationale: "NOT IMPLEMENTED. See Deviations."
  - id: D3
    description: "A number counts up on first appearance and never again"
    verification: []
    human_judgment: true
    rationale: "NOT IMPLEMENTED. See Deviations."

duration: 15min
completed: 2026-08-11
status: partial
---

# Phase 34 Plan 06: Dashboard Character Summary — PARTIAL

**The portlet grid is now glass tiles with layered depth, a hover lift on every drillable card and a staggered entrance — but the chart reveal, the count-up number and this plan's two dedicated test files were not built.**

## What was done

- `PortletShell` renders as `glass-surface` + `shadow-depth-2` + `vdl-lift`, over `--background`, which is an enumerated substrate in 34-02's manifest and therefore a measured pairing.
- `PortletRow` applies `.vdl-stagger` and sets each child's `--vdl-i`, so the sequence delay is computed by the stylesheet and a preset gaining a portlet needs no delay bookkeeping.
- Composition is untouched: no portlet added, removed, reordered or re-typed, no preset changed.
- Verified in Chromium in both themes; before/after screenshots captured.
- The containment and motion gates stay green — 63 tests — so the glass did not leak toward the POS or KDS.

## Task Commits

1. **Portlet glass + depth + lift, row stagger** — `794c7b9c` (feat)

## NOT DONE — stated plainly

This plan is **partial**. Three of its deliverables were not built:

| Not built | Why it matters |
|---|---|
| `TrendChart` dash-offset reveal | The plan requires the finished geometry to be byte-identical to today's, asserted by comparing path data. Untouched, so no regression — but no reveal either. |
| `AnimatedNumber` count-up on first appearance only | The constraint that matters (never on a refetch, websocket push, filter or period change) is unimplemented, and `react-countup` is already a dependency, so a careless later implementation could animate on every tick. |
| `__tests__/components/dashboard-character.test.tsx` and `e2e/journeys/dashboard-visual.spec.ts` | The plan's own gates. Their absence means the treatment above is verified by the phase-wide containment/motion gates and by screenshots, **not** by a dashboard-specific assertion. |

Direct series labels at first paint (the CVD requirement, UI-SPEC §3.4) were **not touched**, so whatever the chart did before it still does — but this plan did not verify it, and its prohibition on colour-only series identification is therefore unchecked.

## Deviations from Plan

Execution stopped before these tasks. This is not an auto-fix deviation — it is incomplete work, recorded as such rather than presented as done.

## Self-Check: PASSED

Both modified files exist; commit `794c7b9c` resolves in git.

---
*Phase: 34-visual-design-language*
*Completed (partial): 2026-08-11*
