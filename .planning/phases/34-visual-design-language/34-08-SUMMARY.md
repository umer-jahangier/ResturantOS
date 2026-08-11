---
phase: 34-visual-design-language
plan: 08
subsystem: ui
tags: [spec, documentation, latency, bundle-budget, playwright]
requires:
  - phase: 34-visual-design-language
    provides: every plan 34-01 through 34-07
provides:
  - "SURFACE-MOTION-SPEC.md — the contract, every value derivable from the shipped stylesheet"
  - "frontend/docs/surface-and-motion.md — the practical guide"
  - "operational-latency.spec.ts — POS tap-to-cart measured, with deterministic gates beside it"
  - "bundle-budget.test.ts — the CSS/JS delta, honestly scoped"
affects: []
tech-stack:
  added: []
  patterns:
    - "A documented value names the test that re-derives it from the shipped stylesheet"
    - "A latency figure is an observation; the gate is a computed-style assertion"
key-files:
  created:
    - .planning/phases/34-visual-design-language/SURFACE-MOTION-SPEC.md
    - frontend/docs/surface-and-motion.md
    - frontend/e2e/journeys/operational-latency.spec.ts
    - frontend/__tests__/lib/theme/bundle-budget.test.ts
  modified: []
key-decisions:
  - "The latency number is never presented as the gate. A wall-clock figure from a dev server on a machine shared with seven agents would fail differently every run."
  - "A true pre-phase BUILT bundle comparison was not taken, and the test says so. It would mean checking out the pre-phase tree and building it, in a working tree shared by eight agents."
patterns-established:
  - "Gates that were found passing vacuously are catalogued in the spec, with what each was actually measuring"
requirements-completed: [VDL-01, VDL-02, VDL-03, VDL-04, VDL-05, VDL-06]
coverage:
  - id: D1
    description: "The vocabulary is documented with every value tokenised and re-derivable from globals.css"
    verification:
      - kind: unit
        ref: "each SPEC table names its deriving test; all named tests green"
        status: pass
    human_judgment: false
  - id: D2
    description: "The POS and KDS are proven to carry no compositing filter and no animation on the real screens"
    verification:
      - kind: e2e
        ref: "e2e/journeys/operational-latency.spec.ts — POS half green"
        status: pass
      - kind: e2e
        ref: "KDS half — green on the REAL board since 2026-08-12; see the correction below"
        status: pass
    human_judgment: false
  - id: D3
    description: "Interaction latency on the POS tap-to-cart path is measured and recorded"
    verification:
      - kind: e2e
        ref: "e2e/journeys/operational-latency.spec.ts — 79ms isolated, 99ms under load"
        status: pass
    human_judgment: false
  - id: D4
    description: "The bundle delta is measured and recorded"
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/bundle-budget.test.ts — +5,821 B CSS, 24,000 B new JS source, 0 dependencies"
        status: pass
    human_judgment: false
duration: 45min
completed: 2026-08-12
status: complete
---

# Phase 34 Plan 08: Close the Phase Summary

**The surface and motion contract written to the same standard as UI-SPEC — every number named beside the test that re-derives it — plus POS tap-to-cart measured at 79–99ms as an observation beside deterministic gates, and a bundle delta of +5,821 B of CSS with zero dependencies added.**

## Accomplishments

- **Reaching the real tap-to-cart path took work.** The menu grid is gated on an open till and no seed provides one, so every earlier attempt in this phase measured a "Your till is closed" empty state. The spec opens a till through the real UI first.
- **Two more vacuous gates found while writing it** — a settle signal waiting on a testid that does not exist (it spent its full timeout and reported a 20-second "latency"), and a cart check scoped to the same missing testid (it queried `null`, returned `[]`, asserted nothing). Both now fail loudly if their anchor cannot be resolved.
- **§7 of the SPEC catalogues all five vacuous gates found across the phase**, with what each was actually measuring. That list is the most useful part of the document.

## CORRECTION — 2026-08-12: the KDS problem was never kitchen-service

This summary originally said the KDS half of the latency spec "did not run — kitchen-service is
`DOWN` in Eureka", and that it "passed earlier in the session". Both statements were true and
both were beside the point.

With kitchen-service healthy, all three of this phase's KDS assertions were re-run and passed.
They were then given a positive anchor — `[data-testid="kds-board"]` must be attached — and
**all three went red**. They had never been on the board. Each navigated with
`page.locator('a[href^="/app/kitchen/"]')` guarded by `.isVisible().catch(() => false)`; the
station tiles are **buttons** driving `router.push`, so the locator matched nothing, the guard
swallowed it, no click happened, and all three ran against the station picker. Every assertion
in them is an assertion of absence, and the picker carries no filter and no animation either.
The service being up or down never changed what they measured.

With the navigation fixed, two of the three failed on a real defect: every ticket fragment
carried `animate-fade-in`, a 0.2 s `fadeIn` on mount, so arriving on a board with twenty open
tickets played twenty animations at once — the same defect 34-03 removed from the board *root*,
still present one level down. Removed in `e04d55fa`.

**The KDS half is now green on the real board**, verified in Chromium as the zaitoon kitchen
persona: board rendered, one ticket fragment, zero running animations, LATE encoding intact
(`evidence/after-34/kds-board.png`).

Catalogued as vacuous gate #7 in SPEC §7, which now also carries #6 and #8 and the through-line
those eight share: **an absence assertion must be preceded by an assertion that the thing it is
looking at is there.**

## Self-Check: PASSED

All four created files exist; the named tests are green, KDS included.

---
*Phase: 34-visual-design-language*
