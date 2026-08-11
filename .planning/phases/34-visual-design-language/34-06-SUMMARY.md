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
    verification:
      - kind: unit
        ref: "__tests__/components/dashboard-character.test.tsx — polyline points asserted against a baseline rendered from `git show HEAD:...trend-chart.tsx`; only the mask animates; labels outside it"
        status: pass
    human_judgment: false
  - id: D3
    description: "A number counts up on first appearance and never again"
    verification:
      - kind: unit
        ref: "__tests__/components/dashboard-character.test.tsx — mount-keyed; a value change renders instantly; never under reduced motion"
        status: pass
    human_judgment: false
  - id: D4
    description: "The dashboard is captured with its preconditions asserted, in both themes and both filter conditions"
    verification:
      - kind: e2e
        ref: "e2e/journeys/expressive-surfaces-visual.spec.ts — theme read back, anchor + forbidden condition, entrance quiesced, filter-off injection asserted, axe clean"
        status: pass
      - kind: automated_ui
        ref: "e2e/shots-owner.mjs -> evidence/after-34/owner-dashboard-{light,dark}.png (Floating Terrace, which has trading data)"
        status: pass
    human_judgment: true
    rationale: "Whether the transformation satisfies the user's original complaint is their call. The measurable properties hold."

duration: 15min + 40min (second session)
completed: 2026-08-12
status: complete
---

# Phase 34 Plan 06: Dashboard Character Summary

**The portlet grid is now glass tiles with layered depth, a hover lift on every drillable card and a staggered entrance — but the chart reveal, the count-up number and this plan's two dedicated test files were not built.**

## What was done

- `PortletShell` renders as `glass-surface` + `shadow-depth-2` + `vdl-lift`, over `--background`, which is an enumerated substrate in 34-02's manifest and therefore a measured pairing.
- `PortletRow` applies `.vdl-stagger` and sets each child's `--vdl-i`, so the sequence delay is computed by the stylesheet and a preset gaining a portlet needs no delay bookkeeping.
- Composition is untouched: no portlet added, removed, reordered or re-typed, no preset changed.
- Verified in Chromium in both themes; before/after screenshots captured.
- The containment and motion gates stay green — 63 tests — so the glass did not leak toward the POS or KDS.

## Task Commits

1. **Portlet glass + depth + lift, row stagger** — `794c7b9c` (feat)

## Completed in a second session (2026-08-12)

### The chart reveal is a mask, and it had to be

The obvious implementation — set `stroke-dasharray` to the path length and animate
`stroke-dashoffset` on the series strokes — **could not be used here**, and the reason is the
plan's own §3.4 constraint. `stroke-dasharray` is already load-bearing on those strokes: UI-SPEC
§3.4 measured the minimum series separation at ~17 under deuteranopia and ~16 under protanopia,
concluded no five-colour categorical palette is safe by colour alone, and made the dash
*pattern* a mandatory redundant channel. Overwriting it with a reveal length would have traded a
CVD contract for an animation — one property, two meanings, and the accessibility one loses.

So the dash offset animates on a `<mask>`, and the drawing under it is untouched. The polyline
`points` are asserted **byte-identical** against a baseline rendered from
`git show HEAD:…/trend-chart.tsx` — a baseline recomputed from the component's own formulae
would pass whatever the component did.

The series labels moved **out** of the masked group. A label inside the mask is absent for the
whole animation and absent permanently if the animation never runs, leaving the chart identified
by colour alone — the state §3.4 forbids.

### Count-up fires on mount and never again

It was keyed to `end`, which `react-countup` re-animates on every change, so every websocket
push and every refetch would have restarted it. The component now freezes the value it mounted
with; every later value renders instantly. Under reduced motion it never animates at all, first
appearance included — imperative motion driven by a timer, so no stylesheet rule can reach it.
`useState`, not `useRef`, for the frozen value: it is read during render, and a ref read during
render is a lint error precisely because it is not a reactive read.

### The gates

`__tests__/components/dashboard-character.test.tsx` — 22 tests, preset equivalence written
first. Six negative controls, each **observed red** then restored: a portlet appended to the
owner preset; `y()` rescaled by 0.9; labels moved inside the mask; count-up re-keyed to the live
value; the reduced-motion branch ignored; `.vdl-stagger` removed from `PortletRow`.

`e2e/journeys/expressive-surfaces-visual.spec.ts` covers this plan's task 3 together with
34-07's — one gate for all the expressive surfaces rather than two overlapping ones.

### Evidence pairs — which are genuine pairs

`evidence/before/dashboard-{light,dark}.png` vs `evidence/after/dashboard-{light,dark}.png` are
a genuine before-and-after pair for the **manager** dashboard, captured either side of the glass
change in the first session.

`evidence/after-34/owner-dashboard-{light,dark}.png` are **after-only**. There is no before shot
of the owner dashboard with a drawn chart, because the harness that would have taken one signed
in as the manager, whose preset contains no chart. Stated rather than presented as a pair.

## Task Commits

1. **Portlet glass + depth + lift, row stagger** — `794c7b9c` (feat)
2. **Chart reveal, mount-keyed count-up, the gate** — `86eb820d` (feat)
3. **The expressive-surfaces runtime gate** — `56fe3bbd` (test)

## Self-Check: PASSED

All modified and created files exist; the three commits resolve in git; 22 tests green.

---
*Phase: 34-visual-design-language*
*Completed (partial): 2026-08-11*
