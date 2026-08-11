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
    verification:
      - kind: unit
        ref: "__tests__/components/state-character.test.tsx — 25 tests; error surface at 4-7x the empty state's chroma in both themes, six negative controls observed"
        status: pass
      - kind: e2e
        ref: "e2e/journeys/state-distinguishability.spec.ts — 89,911 differing pixels failure vs empty, in both preference states; axe clean with the filter forced off"
        status: pass
    human_judgment: false
duration: 10min + 55min (gates, second session)
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

## The two gates — written in a second session (2026-08-12)

Both plan artifacts now exist. Distinguishability is asserted by rendering both states and
comparing, not argued from the source.

**`__tests__/components/state-character.test.tsx` — 25 tests.** The salience assertion is a
*measurement*, and it reads its tokens off the rendered element rather than assuming them. The
first draft hard-coded `--destructive` at 0.15 because that is what the notice uses today —
which would have survived the exact restyle the gate exists to catch. Measured: the error
surface composites to **4–7× the chroma** of the empty state's disc (0.0308 vs 0.0040 light,
0.0274 vs 0.0070 dark), its luminance separation from the page is never the lesser of the two,
and `text-destructive` on it clears AA in both themes.

The toast root is stamped `data-zone`, and it resolves **`restrained`**, deliberately. Sonner's
`ToasterProps` forwards no arbitrary DOM attributes, so a `display: contents` wrapper carries
it — no box, no stacking context, and no containing block, because a transform there would
capture both sonner's `position: fixed` and phase 26's printed receipt. One root-mounted
toaster renders over the POS and the KDS as readily as over a dashboard, and SPEC §1's rule is
that chrome is bound by the poorest zone it can appear over.

**`e2e/journeys/state-distinguishability.spec.ts` — 9 tests.** Measured: **89,911 differing
pixels** between the forced failure and the forced empty result, identical in both preference
states; **178,384** between a failed dashboard boundary and one whose queries were answered.
Accessibility clean at every severity on both states with the compositing filter forced off,
and the injection is asserted to have taken effect.

### Negative controls, each OBSERVED red then restored

| # | Control | Result |
|---|---|---|
| 1 | error surface swapped for the empty state's neutral | 4 failed |
| 2 | `role="alert"` removed | 4 failed |
| 3 | skeleton zone branch inverted | 3 failed |
| 4 | reduced-motion `.skeleton` shortened, not removed | 1 failed |
| 5 | toaster `data-zone` wrapper removed | 2 failed, `ANCHOR NOT FOUND` |
| 6 | precedence inverted (empty before error) | 4 failed |
| 7 | error converged onto the empty state (e2e) | TEXT channel failed |
| 8 | same, text/role suppressed to reach the pixels | **passed at the old floor** — see below |

### The gate found a defect in itself

Control 8 is the one worth recording. With the error notice rewritten to render the empty
state's surface, disc and wording — total convergence — the two captures still differed by
**2,920 pixels**, because the empty state carries a description line the converged error did
not. Against the 2,000 floor I had reasoned my way to, that **passed**. The floor is now
calibrated from two measured populations (89,911 genuine, 2,920 converged) at 20,000, and the
empty-vs-populated pair carries its own lower floor of 5,000 against a measured 12,652 —
reusing 20,000 there failed correct code, which is the opposite error and just as fatal.
Catalogued as vacuous gate #6 in SPEC §7.

Three further near-misses are recorded at the code and in SPEC §7: a bare `[]` fulfilment that
produced the empty state for the wrong reason, an unscoped `[role="alert"]` query that counted
an alert from the app shell, and a fixture UUID Zod 4 rejects on its variant nibble.

## Task Commits

1. **The states restyled** — landed with the breadth commit `eb1d5bd8`.
2. **The unit gate + toast zone** — `b1c70ecc` (test)
3. **The runtime gate** — `40782a5a` (test)

## Self-Check: PASSED

All modified and created files exist; the three commits resolve in git; 25 + 9 tests green.

---
*Phase: 34-visual-design-language*
