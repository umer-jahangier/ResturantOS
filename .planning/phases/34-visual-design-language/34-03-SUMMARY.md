---
phase: 34-visual-design-language
plan: 03
subsystem: ui
tags: [motion, prefers-reduced-motion, css-keyframes, accessibility, playwright, framer-motion]

requires:
  - phase: 20-design-system
    provides: the four motion durations, the single easing curve, the 240ms ceiling, the global reduced-motion net
  - phase: 34-visual-design-language
    provides: "34-01's data-zone attribute; 34-02's depth tokens and the zone-scoping pattern"
provides:
  - "A five-family motion vocabulary (entrance, hover, state, loading, feedback) with every duration and easing tokenised"
  - "The resting-state contract, enforced structurally rather than by convention"
  - "Reduced motion that removes decorative animation outright rather than shortening it"
  - "use-reduced-motion.ts — the preference reader for imperative motion, which no stylesheet can reach"
  - "Retirement of the global page transition that animated the POS and KDS on every navigation"
  - "A two-direction runtime gate: absent under reduced motion, demonstrably present without it"
affects: [34-04, 34-05, 34-06, 34-07, 34-08]

tech-stack:
  added: []
  patterns:
    - "Resting-state contract: an animated element's static style IS its finished style; the keyframe declares only `from`"
    - "Reduced motion means ABSENCE for decorative families and survival for feedback ones"
    - "Motion gates run in both directions — a system that does nothing passes every stillness test"

key-files:
  created:
    - frontend/lib/hooks/ui/use-reduced-motion.ts
    - frontend/__tests__/lib/motion/motion-vocabulary.test.ts
    - frontend/e2e/journeys/reduced-motion.spec.ts
  modified:
    - frontend/app/globals.css
    - frontend/app/(tenant)/layout.tsx

key-decisions:
  - "The entrance (420ms) and reveal (620ms) durations exceed §3.12's 240ms ceiling and are scoped to the expressive zone. Recorded at the tokens as a zone-scoped EXTENSION, not a reversal: the ceiling exists because an operator navigates ~200 times a shift, and nobody navigates a login screen 200 times a shift."
  - "useReducedMotion's SERVER value is true. The conservative first paint corrects toward motion rather than away from it; the opposite default flashes a decorative animation at exactly the user who asked not to see one, and that asymmetry is the whole argument."
  - "State transitions (focus ring, checkbox, selection) deliberately survive reduced motion at the instant duration. They are feedback, not decoration, and removing them makes a control feel broken rather than calm."
  - "PageTransition/PageTransitionMotion/variants.ts are left on disk but orphaned rather than deleted. Deleting them is a shell change beyond this phase; leaving them WIRED was the actual defect."

patterns-established:
  - "Every decorative keyframe declares only `from` — asserted, so an animation can always be deleted safely"
  - "Reduced-motion assertions check VISIBILITY as well as stillness, because a blank screen is perfectly still"
  - "Imperative motion consults the preference itself; a media query cannot reach a transform written from an event handler"

requirements-completed: [VDL-01, VDL-03, VDL-05]

coverage:
  - id: D1
    description: "A named motion vocabulary exists, tokenised, with the 240ms ceiling still binding outside the expressive zone"
    requirement: VDL-01
    verification:
      - kind: unit
        ref: "__tests__/lib/motion/motion-vocabulary.test.ts#the 240ms ceiling still binds outside the expressive zone"
        status: pass
    human_judgment: false
  - id: D2
    description: "Under reduced motion, decorative animation is absent and animated elements remain VISIBLE"
    requirement: VDL-03
    verification:
      - kind: e2e
        ref: "e2e/journeys/reduced-motion.spec.ts#animated elements are VISIBLE and still — not merely still"
        status: pass
      - kind: e2e
        ref: "e2e/journeys/reduced-motion.spec.ts#the expressive dashboard is visually identical half a second apart"
        status: pass
      - kind: unit
        ref: "__tests__/lib/motion/motion-vocabulary.test.ts#reduced motion removes decorative animation, it does not shorten it"
        status: pass
    human_judgment: false
  - id: D3
    description: "Without the preference, the motion system demonstrably runs — it is not dead CSS"
    requirement: VDL-05
    verification:
      - kind: e2e
        ref: "e2e/journeys/reduced-motion.spec.ts#the entrance animation is live on an expressive surface (vdlEnter @ 0.42s)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The 350ms navigation entrance no longer plays on the POS terminal or the KDS board"
    requirement: VDL-03
    verification:
      - kind: unit
        ref: "__tests__/lib/motion/motion-vocabulary.test.ts#the orphaned page-transition island is referenced by nothing"
        status: pass
      - kind: e2e
        ref: "e2e/journeys/reduced-motion.spec.ts#a KDS station board still does not animate, even without the preference"
        status: pass
    human_judgment: false
  - id: D5
    description: "The motion vocabulary reads as designed on a real screen rather than merely resolving correct values"
    verification: []
    human_judgment: true
    rationale: "No surface has adopted .vdl-enter / .vdl-stagger yet — 34-04 and 34-06 do that. Until then the vocabulary is proven correct but not proven tasteful; the visual judgment belongs with those plans' evidence."

duration: 35min
completed: 2026-08-11
status: complete
---

# Phase 34 Plan 03: The Motion Vocabulary Summary

**Five motion families tokenised under a resting-state contract that makes the invisible-screen defect unrepresentable; reduced motion that removes decorative animation outright rather than shortening it; the 350ms navigation entrance that was playing on the KDS board and POS terminal retired; and a runtime gate that measures both directions — absent under the preference, demonstrably present without it.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3
- **Files created:** 3
- **Files modified:** 2

## Accomplishments

- **The KDS board was playing a 350ms fade-and-slide on every navigation.** The tenant layout wrapped every route in `PageTransition`, and both the POS terminal and the KDS station board render inside that layout. Same root cause as the compositing filters in 34-01: a shell cannot know which zone it is wrapping, so motion applied there is applied to the two screens that must never have any. `§3.12` had already ruled "there is no page-transition animation".
- **The resting-state contract has a banner comment because the wrong authoring is the intuitive one.** `.thing { opacity: 0 }` plus a keyframe that reveals it renders a blank screen for any reduced-motion user — and it reads as a data-loading bug, which is why it survives review. Classes here set no resting declaration at all; keyframes declare only `from`.
- **Verified in Chromium, both directions.** With `reduce` emulated, `.vdl-enter` resolves `animation-name: none`, `opacity: 1`, `transform: none` — visible *and* still. Without it, `vdlEnter` at `0.42s`.
- **framer-motion is now reachable from no route.** The three files form a closed orphaned island; nothing under `app/` or `components/` imports them, asserted.

## Task Commits

1. **Task 1: the motion vocabulary + reduced-motion reader** — `455e894` (feat)
2. **Task 2: retire the navigation entrance animation** — `c2aaa1e` (fix)
3. **Task 3: the two-direction gate** — `3b2730f` (test)

## Contract for plans 34-04 … 34-07

| Class | Zone | What it does |
|---|---|---|
| `.vdl-enter` | expressive only | fade + 10px rise, `--motion-entrance` (420ms) |
| `.vdl-enter-scale` | expressive only | fade + scale from 0.97 |
| `.vdl-reveal` | expressive only | dash-offset reveal, `--motion-reveal` (620ms) |
| `.vdl-stagger > *` | expressive only | entrance sequenced by `--vdl-i` × `--motion-stagger` (55ms) |
| `.vdl-lift` | expressive + restrained | hover lift; translates only when expressive |

`useReducedMotion()` from `@/lib/hooks/ui/use-reduced-motion` is **mandatory** for any imperative motion — the static gate fails a module that writes a transform without it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The reduced-motion absence assertion was passing vacuously**

- **Found during:** Task 3 negative controls
- **Issue:** The assertion matched `animation: none` within 400 characters of the class name, and picked it up from a *different* rule (`.skeleton`). Editing the block to `animation-duration: 1ms` — the exact defect it exists to catch — did **not** fail it.
- **Fix:** The reduced-motion block is now parsed into rules, and each class is checked against the rule that actually owns it.
- **Verification:** Control re-run; it now fails on four classes. Recorded in the test's own docblock.
- **Committed in:** `3b2730f`

**2. [Rule 1 — Bug] `test.use({ reducedMotion })` silently did nothing**

- **Found during:** Task 3, first runtime run
- **Issue:** It is not typed on this suite's extended fixture (which builds its own contexts from persona storage state), so it type-errored *and* had no runtime effect. The "reduce" pass ran with no preference set while still reporting `reduce` in its test name — a gate lying about which condition it measured.
- **Fix:** Per-page `page.emulateMedia({ reducedMotion })`, with the reasoning recorded in the spec.
- **Committed in:** `3b2730f`

**3. [Rule 3 — Blocking] A waiter is correctly refused `/api/v1/pos/tills`**

- **Found during:** Task 3
- **Issue:** The observability guard failed the POS stillness test on a 403 that is correct authorization behaviour.
- **Fix:** Declared with `obs.expect403(url, reason)` — the sanctioned mechanism — rather than loosening the guard for every spec.
- **Committed in:** `3b2730f`

---

**Total deviations:** 3 auto-fixed (2 Rule 1 bugs in this phase's own gates, 1 Rule 3). No scope creep.

## Issues Encountered

- **The gateway went down mid-run** (ECONNREFUSED on :8080) while another agent restarted it; waited 20s and re-ran, all green.
- **`npm run build` could not be run to completion cleanly** because another agent was mid-edit in `components/users/*` and `lib/repositories/user.repository.ts` — the reported type error changed between two consecutive runs and named files this phase does not touch. My own files were verified clean by a scoped `tsc` filter and by 428 passing unit tests. Logged in `deferred-items.md`.

## Next Phase Readiness

- 34-04 can compose `.vdl-enter` / `.vdl-stagger` / `.vdl-lift` and `useReducedMotion()` directly; the static gate will enforce the hook on any imperative motion it adds.
- **framer-motion is still in `package.json`.** Removing it is a build-surface change and belongs with 34-08's bundle measurement, as the plan directs. Consumer count: 3, all orphaned.

---
*Phase: 34-visual-design-language*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 3 created files exist on disk; all 3 task commits resolve in git.
