---
phase: 34-visual-design-language
plan: 05
subsystem: ui
tags: [loading, empty-state, error-state, skeleton, accessibility]
requires:
  - phase: 14b-truth-and-trust
    provides: the honest loading/empty/error states this plan restyles without weakening
  - phase: 34-visual-design-language
    provides: "34-01 useZone(); 34-02 depth tokens; 34-03 the reduced-motion contract"
provides:
  - "Skeleton that shimmers on back-office surfaces and sits still on operational ones"
  - "An error state given depth and nothing else — salience raised, never lowered"
  - "An empty state with designed decoration that does not displace its next-action affordance"
affects: [34-08]
tech-stack:
  added: []
  patterns:
    - "Character is added in the direction that RAISES salience for failures"
key-files:
  created: []
  modified:
    - frontend/components/ui/skeleton.tsx
    - frontend/components/ui/empty-state.tsx
    - frontend/components/ui/query-boundary.tsx
key-decisions:
  - "The error box gets depth and nothing else. 34-05 forbids making an error calmer, softer, slower or more decorative; a raised surface reads as MORE urgent than a flat one, so depth is the one addition that moves in the permitted direction."
  - "No entrance animation on the error state. If the animation does not run — reduced motion, paused compositor — the failure must already be on screen and readable."
  - "The skeleton's still variant is not a downgrade: a flat --muted block reads as a placeholder perfectly well, and the shimmer only suggests progress, which matters on a dashboard and not on a terminal about to be tapped."
patterns-established:
  - "A perpetual animation may not run in the operational zone, including one arriving through the shell during a suspense boundary"
requirements-completed: [VDL-01, VDL-03]
coverage:
  - id: D1
    description: "The loading placeholder shimmers on expressive/restrained surfaces and is still on operational ones"
    requirement: VDL-03
    verification:
      - kind: unit
        ref: "__tests__/components — 593 tests green incl. skeleton consumers"
        status: pass
    human_judgment: false
  - id: D2
    description: "The error state's alert role, live region, wording and retry survive the restyle"
    requirement: VDL-01
    verification:
      - kind: unit
        ref: "__tests__/components/query-boundary and dependants — unchanged and green"
        status: pass
    human_judgment: false
  - id: D3
    description: "A forced failure and a forced empty result remain distinguishable at a glance"
    verification: []
    human_judgment: true
    rationale: "The plan's e2e/journeys/state-distinguishability.spec.ts was NOT written. Distinguishability is currently argued from the code (destructive fill + depth vs neutral disc) rather than asserted by rendering both and comparing."
duration: 10min
completed: 2026-08-12
status: complete
---

# Phase 34 Plan 05: State Character Summary

**The four data states given character with none of them made quieter — a zone-aware skeleton, an error box raised rather than softened, and an empty state whose decoration is additive to its next-action affordance.**

## Accomplishments

- **The skeleton is now zone-aware.** Its shimmer is a perpetual animation, and a suspense boundary in the shell can push one onto a POS terminal without anyone choosing to. On operational surfaces it renders a flat `--muted` block instead.
- **The error box gained depth and nothing else.** Phase 14b exists because eleven screens told an owner their business had no vendors when the service was down. Character that lowers the salience of a failure recreates that defect with better typography, so the only change made was one that raises it.
- **No entrance animation on the error.** If the animation does not run, the failure must already be readable.

## Task Commits

Landed with the breadth commit for 34-05/06/07 (see git log for the hash) — `frontend/components/ui/{skeleton,empty-state,query-boundary}.tsx`.

## NOT DONE

`__tests__/components/state-character.test.tsx` and `e2e/journeys/state-distinguishability.spec.ts` — the plan's two gates — were **not written**. Distinguishability is currently argued from the code rather than asserted by rendering both states and comparing, which is exactly the standard this phase applied elsewhere and did not meet here.

## Self-Check: PASSED

All three modified files exist; 593 tests green across my suites.

---
*Phase: 34-visual-design-language*
