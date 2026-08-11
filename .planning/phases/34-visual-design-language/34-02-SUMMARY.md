---
phase: 34-visual-design-language
plan: 02
subsystem: ui
tags: [oklch, wcag, colorjs, backdrop-filter, tailwind4, design-tokens, contrast]

requires:
  - phase: 20-design-system
    provides: OKLCH ramps, role tokens, --elev-* levels, wcag-validator.ts, design-tokens.test.ts (53 pairings)
  - phase: 34-visual-design-language
    provides: "34-01's data-zone attribute and dialog-overlay data-slot, which the glass rules are keyed on"
provides:
  - "compositeOver() / wcagContrastOverGlass() — source-over compositing in the validator, so a translucent surface is measurable as it renders"
  - "Two glass weights (panel, overlay), authored solid-first: opaque base, translucency as a positive-feature-query enhancement scoped to the expressive zone"
  - "A depth token family — three two-layer levels, a hover lift pair, an inset — chroma zero, additive to --elev-*"
  - "glass-surfaces.ts — the substrate manifest that makes D-34-04 checkable rather than aspirational"
  - "The dialog overlay glass rule, keyed on the element's OWN data-zone so it survives the portal"
  - "A 20-row contrast table measured under both deployment conditions, in both themes"
affects: [34-03, 34-04, 34-05, 34-06, 34-07, 34-08]

tech-stack:
  added: []
  patterns:
    - "Solid-first glass authoring: the opaque fallback is the BASE declaration, translucency is the enhancement"
    - "Substrate manifests: a glass surface enumerates what it may sit over, so its contrast is finite and measurable"
    - "Compositing arithmetic in sRGB, not OKLCH — a compositor blends in the space it paints in"

key-files:
  created:
    - frontend/lib/theme/glass-surfaces.ts
    - frontend/__tests__/lib/theme/composite.test.ts
    - frontend/__tests__/lib/theme/glass-contrast.test.ts
  modified:
    - frontend/lib/theme/wcag-validator.ts
    - frontend/app/globals.css
    - frontend/__tests__/lib/theme/zone-containment.test.ts

key-decisions:
  - "Compositing is done in sRGB, deliberately against the grain of this repo's OKLCH colour work. OKLCH is right for choosing a ramp and wrong for blending: 50% white over black is 0.5 per channel, not the ~0.735 a perceptual blend gives. Both the correct value and the absence of the perceptual one are asserted."
  - "The opaque fallback is a designed value (0.978) rather than the fill at alpha 1 (0.99), and a test asserts they differ — a fallback that is merely a rename has not been looked at."
  - "Dark theme glass sits near --surface-2/--surface-3 lightnesses, not near white. Alphas are shared across themes because alpha is the 'how much glass' knob and should mean the same thing in both; it is the lightness that changes."
  - "The fill and blur tokens are deliberately NOT bridged into @theme. Exposing bg-glass-panel-fill as a utility would hand every call site a translucent surface with no fallback and no zone scoping — the exact failure D-34-04 and D-34-02 exist to prevent, re-introduced through the convenience layer."
  - "A glass panel may not sit on --card. Glass on glass composites two near-identical lightnesses and reads as neither."

patterns-established:
  - "Every glass pairing is measured twice — once with the compositing filter unavailable, once as composited — because those are two real deployment conditions producing two different colours"
  - "The binding constraint of a table is named in its docblock (here 5.34:1) so the reader knows what breaks first"
  - "Structural assertions accompany numeric ones: exhaustiveness, substrate opacity, fallback-is-not-a-rename, base-declared-outside-feature-query"

requirements-completed: [VDL-01, VDL-04]

coverage:
  - id: D1
    description: "The repo's validator can measure a translucent fill composited over a substrate, on the same scale as phase 20's opaque measurements"
    requirement: VDL-01
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/composite.test.ts — 10 tests incl. an independently-derived 50% reference and a 6-alpha reference sweep"
        status: pass
    human_judgment: false
  - id: D2
    description: "Glass and depth exist as brand-hue-parameterised tokens whose degraded rendering is the stylesheet's default state"
    requirement: VDL-04
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/glass-contrast.test.ts#every glass surface class declares its opaque background OUTSIDE any feature query"
        status: pass
      - kind: unit
        ref: "__tests__/lib/theme/design-tokens.test.ts — phase 20's 53 pairings, no-hex and regenerates-from-brand-h cases all still green"
        status: pass
      - kind: other
        ref: "npm run build — production build clean"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every glass surface meets WCAG AA with backdrop-filter DISABLED, and as composited, in both themes"
    requirement: VDL-04
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/glass-contrast.test.ts — 20 measured rows (10 pairings x 2 conditions), all clearing 4.5:1"
        status: pass
    human_judgment: false
  - id: D4
    description: "The glass guarantee cannot silently decay — an undeclared glass token, a translucent substrate, or a collapsed fallback each fail"
    requirement: VDL-04
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/glass-contrast.test.ts#structural properties the numbers cannot express"
        status: pass
      - kind: manual_procedural
        ref: "two negative controls observed: alpha 0.72->0.70 fires the drift gate on two rows; deleting the base background fires the BASE-rule assertion"
        status: pass
    human_judgment: false
  - id: D5
    description: "Glass looks like glass — and reads correctly — in both light and dark on a real screen"
    verification: []
    human_judgment: true
    rationale: "Contrast ratios prove legibility, not that the surface reads as designed rather than as fog. Nothing consumes .glass-surface until 34-04/06/07, so there is no rendered surface to judge yet; this is deferred to those plans' visual evidence."

duration: 40min
completed: 2026-08-11
status: complete
---

# Phase 34 Plan 02: Glass and Depth Tokens Summary

**Source-over compositing added to the WCAG validator so a translucent surface can be measured as it renders; two glass weights and a three-level depth family authored solid-first and brand-hue-parameterised; a substrate manifest that makes "glass must degrade" checkable; and a 20-row contrast table measured under both deployment conditions in both themes, every row clearing AA.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3 (task 1 TDD: RED → GREEN)
- **Files created:** 3
- **Files modified:** 3

## Accomplishments

- **A translucent fill has no contrast ratio.** `oklch(1 0 195 / 0.72)` is not a colour anybody sees, so D-34-01's "every new surface carries a measured figure" could not be satisfied until the validator could composite. `compositeOver()` folds fill and substrate into the opaque colour a browser paints, and the result goes through the *same* contrast function that measured phase 20's 53 pairings — one scale, not two.
- **The arithmetic is in sRGB, against the grain of the rest of this repo's colour work,** and that is the point. A compositor blends in the space it paints in, not perceptually. 50% white over black is 0.5 per channel; a perceptual blend gives ~0.735. The test asserts both the correct value *and* the absence of the wrong one, so a future "consistency" fix cannot quietly move every glass figure.
- **Solid-first authoring.** The opaque colour is the base declaration; translucency is a positive-`@supports` enhancement, additionally scoped to `[data-zone="expressive"]`. The usual way "it degrades gracefully" breaks is a fallback inside `@supports not (…)` — a branch nobody renders locally, screenshots, or measures.
- **Twenty measured rows, all clearing AA.** The binding constraint is `--foreground-tertiary` on the light panel over `--surface-3` at **5.34:1**, named in the test's docblock because it has the least headroom and is what breaks first.

## Task Commits

1. **Task 1 (RED): the compositing behaviours** — `c7e5719` (test) — 9 failed, 1 passed
2. **Task 1 (GREEN): compositeOver + wcagContrastOverGlass** — `bf8b4e6` (feat)
3. **Task 2: the glass and depth token layer + manifest** — `a4d619a` (feat)
4. **Task 3: the two-condition contrast table** — `5b696c3` (test)

## Measured figures (recorded for 34-08's spec)

| Theme | Surface | Foreground | Filter disabled | Composited (worst case) |
|---|---|---|---|---|
| light | panel | `--foreground` | 18.01 | 17.73 (over `--surface-3`) |
| light | panel | `--foreground-secondary` | 8.26 | 8.13 |
| light | panel | `--foreground-tertiary` | 5.42 | **5.34** ← binding |
| light | overlay | `--foreground` | 17.49 | 18.17 |
| light | overlay | `--foreground-secondary` | 8.02 | 8.34 |
| dark | panel | `--foreground` | 15.64 | 14.31 |
| dark | panel | `--foreground-secondary` | 11.12 | 10.17 |
| dark | panel | `--foreground-tertiary` | 7.11 | 6.50 |
| dark | overlay | `--foreground` | 14.13 | 14.35 |
| dark | overlay | `--foreground-secondary` | 10.04 | 10.20 |

Floor is 4.5:1 (AA) for every row.

## Decisions Made

See `key-decisions` in the frontmatter. The two most consequential:

- **Fill and blur tokens are not bridged into `@theme`.** A `bg-glass-panel-fill` utility would let any call site paint a translucent surface with no fallback and no zone scoping — reintroducing through the convenience layer the exact failure this plan is built to prevent.
- **A glass panel may not sit on `--card`.** Glass on glass composites two near-identical lightnesses and reads as neither. Enforced by the substrate list, not by a note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The 34-01 scoping gate false-positived on its own enabling condition**

- **Found during:** Task 2, on writing the first real glass rule
- **Issue:** `@supports (backdrop-filter: blur(1px))` contains the literal text `backdrop-filter:`, but it is a feature *query* — it paints nothing. The gate read it as a declaration, walked back past the wrong brace, and extracted garbage as the "selector", so a correctly-scoped stylesheet failed.
- **Fix:** At-rule preludes are blanked (offsets preserved) before scanning.
- **Verification:** Both original negative controls re-run and still fire — including the harder case of an unscoped rule hidden *inside* an `@supports` block, which confirms the blanking did not loosen the gate.
- **Committed in:** `a4d619a`

**2. [Rule 1 — Bug] `compositeOver` mistyped colorjs.io channels**

- **Found during:** Task 2 verification
- **Issue:** Channels typed `number | undefined`; they are `number | null` (colorjs.io represents CSS Color 4 `none` as null).
- **Fix:** Widened the type and documented why 0 is the correct treatment for a missing component.
- **Verification:** `npm run build` clean.
- **Notable:** `npx tsc --noEmit` did **not** surface this in the scoped check I had been running — `next build` did. Worth remembering: the build typechecks more of the tree.
- **Committed in:** `a4d619a`

---

**Total deviations:** 2 auto-fixed (both Rule 1 — bugs, one in this phase's own gate). No scope creep.

## Issues Encountered

None beyond the two auto-fixes. Phase 20's `design-tokens.test.ts` reproduces all 53 pairings unchanged, and its no-hex and regenerates-from-`--brand-h` cases both still hold for the new tokens.

## Next Phase Readiness

- `.glass-surface` and `.glass-surface-overlay` exist and are measured, but **nothing consumes them yet** — that is 34-04 (primitives) and 34-06/07 (screens). The dialog overlay rule is live now on any expressive-zone dialog.
- 34-01's runtime positive control (`the dashboard resolves a compositing filter somewhere`) should now be able to pass once a dashboard surface actually uses a glass class. It is still skipping until then, which is correct.

---
*Phase: 34-visual-design-language*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 3 created files exist on disk; all 4 task commits resolve in git.
