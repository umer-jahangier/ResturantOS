---
phase: 34-visual-design-language
plan: 04
subsystem: ui
tags: [react, primitives, compositor, pointer-events, requestAnimationFrame, bundle-budget]

requires:
  - phase: 34-visual-design-language
    provides: "34-01 useZone(); 34-02 glass tokens + manifest; 34-03 motion classes and useReducedMotion()"
provides:
  - "GlassPanel — the composable glass surface primitive"
  - "Reveal / RevealGroup — entrance wrappers that are no-ops when motion cannot run"
  - "Card depth + interactive variants, additive, default rendering unchanged"
  - "usePointerTilt — measure-once, write-once-per-frame, compositor-only tilt"
  - "dependency-budget.test.ts — D-34-05/06 foreclosed by name rather than by convention"
affects: [34-05, 34-06, 34-07, 34-08]

tech-stack:
  added: []
  patterns:
    - "Primitives check their zone in the component as well as in the cascade"
    - "Imperative motion measures once per gesture and writes once per frame, via custom properties only"
    - "Dependency gates name the foreclosed packages, so a rejection is a decision recorded"

key-files:
  created:
    - frontend/components/ui/surface/glass-panel.tsx
    - frontend/components/ui/surface/reveal.tsx
    - frontend/lib/hooks/ui/use-pointer-tilt.ts
    - frontend/__tests__/components/surface/glass-panel.test.tsx
    - frontend/__tests__/components/surface/reveal.test.tsx
    - frontend/__tests__/lib/hooks/use-pointer-tilt.test.ts
    - frontend/__tests__/lib/theme/dependency-budget.test.ts
  modified:
    - frontend/components/ui/card.tsx
    - frontend/app/globals.css

key-decisions:
  - "Card's default rendering is asserted class-by-class to be unchanged. Depth is opt-in per call site, because Card is consumed product-wide and a silent restyle of every card is a screen rebuild."
  - "usePointerTilt writes ONLY --tilt-x/--tilt-y; the stylesheet owns what they mean. The hook never touches a declaration, so the gesture cannot leave the compositor."
  - "Tilt has three overlapping exclusions (coarse pointer, reduced motion, explicitly disabled) rather than one that could be forgotten. A POS tablet satisfies two on its own."
  - "The foreclosed-package list names three.js and friends explicitly, so a future reader sees the option was considered and rejected at ~600kB, not merely never raised."

patterns-established:
  - "Performance properties are asserted by COUNTING calls (getBoundingClientRect per gesture, setProperty per frame), never by reading the source"
  - "A primitive outside its zone renders plainly rather than partially — absence, not degradation"

requirements-completed: [VDL-01, VDL-06]

coverage:
  - id: D1
    description: "Three composable primitives exist and every later screen can compose them instead of authoring surface treatment inline"
    requirement: VDL-01
    verification:
      - kind: unit
        ref: "__tests__/components/surface/glass-panel.test.tsx, reveal.test.tsx — 21 tests"
        status: pass
    human_judgment: false
  - id: D2
    description: "The existing Card's default rendering did not change"
    requirement: VDL-01
    verification:
      - kind: unit
        ref: "__tests__/components/surface/glass-panel.test.tsx#Card — the default rendering MUST NOT change"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tilt measures once per gesture, writes once per frame, and writes transform values only"
    requirement: VDL-06
    verification:
      - kind: unit
        ref: "__tests__/lib/hooks/use-pointer-tilt.test.ts — rect-call and setProperty-call counting"
        status: pass
    human_judgment: false
  - id: D4
    description: "No rendering engine, animation runtime or physics library can enter the bundle"
    requirement: VDL-06
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/dependency-budget.test.ts — 31 tests"
        status: pass
      - kind: manual_procedural
        ref: "negative control: \"three\": \"^0.160.0\" added -> failed both the denylist and the baseline; removed"
        status: pass
    human_judgment: false
  - id: D5
    description: "The tilt gesture feels like depth rather than a toy on a real pointer device"
    verification: []
    human_judgment: true
    rationale: "Frame budget and exclusion logic are measured; whether 4deg reads as subtle depth or as a gimmick is a judgment that needs a hand on a mouse. No screen consumes tilt yet — 34-06 is the first."

duration: 25min
completed: 2026-08-11
status: complete
---

# Phase 34 Plan 04: The Surface and Motion Primitives Summary

**GlassPanel, Reveal/RevealGroup, an additive Card depth variant and a compositor-only pointer tilt — each refusing to enrich itself outside the expressive zone in the component as well as in the cascade, with the whole three-dimensional vocabulary adding zero runtime dependencies and the four-hundred-kilobyte shortcut foreclosed by name.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 3
- **Files created:** 7
- **Files modified:** 2

## Accomplishments

- **The performance properties are asserted by counting, not by reading.** `usePointerTilt` is proven to call `getBoundingClientRect` exactly once across a 50-move burst, and to write at most two properties per animation frame across a 100-move burst. A hook that re-measures per move benchmarks beautifully in isolation and stutters on a real page — only counting makes that visible.
- **Card's default rendering is unchanged, asserted class by class.** Depth is opt-in. Card is consumed product-wide, and a silent restyle of every card is a screen rebuild wearing a design pass's clothes.
- **`Reveal` sets no opacity, no transform, no visibility.** The resting-state contract in component form: strip the class and the children are exactly where they belong.
- **Three overlapping exclusions on tilt** — coarse pointer, reduced motion, explicitly disabled — rather than one that could be forgotten. A POS tablet satisfies two of them on its own.

## Task Commits

All three tasks landed in one commit, `4d86385` (feat), because the tilt CSS in `globals.css` and the resting-state gate refinement it required could not be separated cleanly from the hook that drives them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] The resting-state gate did not cover `.vdl-tilt`**

- **Found during:** Task 2
- **Issue:** `.vdl-tilt` declares a resting `transform` — `perspective(900px) rotateX(var(--tilt-x, 0deg)) …` — which is the *identity* when the hook is inert. The 34-03 gate checked only the classes that existed then, so this one was unchecked; adding it naively would have failed a correct rule.
- **Fix:** The assertion now permits a resting transform whose every `var()` falls back to a no-op, and still rejects a literal offset.
- **Verification:** Inserting `translateY(20px)` fails it; the real rule passes.
- **Committed in:** `4d86385`

---

**Total deviations:** 1 auto-fixed (Rule 2). No scope creep.

## Issues Encountered

None.

## Next Phase Readiness

- 34-06 and 34-07 can compose `GlassPanel`, `Reveal`, `RevealGroup`, `Card depth`, `.vdl-lift` and `usePointerTilt` directly.
- **Nothing consumes these primitives yet**, so the product still looks unchanged to a user at this point in the phase. That changes in 34-06 and 34-07.

## Self-Check: PASSED

All 7 created files exist on disk; commit `4d86385` resolves in git.

---
*Phase: 34-visual-design-language*
*Completed: 2026-08-11*
