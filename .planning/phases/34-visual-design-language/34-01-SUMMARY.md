---
phase: 34-visual-design-language
plan: 01
subsystem: ui
tags: [react-context, tailwind, radix, portals, backdrop-filter, playwright, design-system]

requires:
  - phase: 20-design-system
    provides: OKLCH token system, elevation tokens (--elev-1..3), the design-tokens.test.ts contrast gate
provides:
  - "ZoneProvider / useZone() / Zone — the three-zone spine from D-34-02, published through a data-zone DOM attribute AND React context"
  - "Zone declarations on all six zone roots (tenant shell, auth, platform console, dashboard, POS, KDS + all three kitchen guard fallbacks)"
  - "Five compositing filters removed — three of which were repainting the POS on every frame"
  - "A two-part containment gate (static import-closure walk + runtime computed-style sweep) proven to fail three different ways"
  - "moduleClosure() / routeEntries() — a tsconfig-path-aware import walker that includes Next.js layout ancestors"
affects: [34-02, 34-03, 34-04, 34-05, 34-06, 34-07, 34-08]

tech-stack:
  added: []
  patterns:
    - "Two-channel zone publication: the cascade reads data-zone, portals read React context"
    - "Portalled overlays stamp their own zone, because Radix mounts on document.body outside every zone subtree"
    - "Static gates match COMMENT-STRIPPED source so documentation cannot trip the check it describes"

key-files:
  created:
    - frontend/components/providers/zone-provider.tsx
    - frontend/__tests__/lib/theme/module-graph.ts
    - frontend/__tests__/lib/theme/zone-containment.test.ts
    - frontend/e2e/journeys/operational-zone-containment.spec.ts
    - frontend/e2e/shots.mjs
  modified:
    - frontend/app/(tenant)/layout.tsx
    - frontend/app/(auth)/layout.tsx
    - frontend/app/(platform)/layout.tsx
    - frontend/app/(tenant)/app/pos/layout.tsx
    - frontend/app/(tenant)/app/dashboard/page.tsx
    - frontend/app/(tenant)/app/kitchen/[stationCode]/page.tsx
    - frontend/components/kds/station-board.tsx
    - frontend/components/shared/top-bar.tsx
    - frontend/components/shared/mobile-bottom-nav.tsx
    - frontend/components/shared/branch-switch-overlay.tsx
    - frontend/components/ui/dialog.tsx
    - frontend/components/pos/order-table-detail-drawer.tsx

key-decisions:
  - "The zone wrapper defaults to `display: contents` so it establishes no block formatting or stacking context — the POS and KDS are full-height flex layouts an extra box would break. Roots that cannot take a wrapper at all use `asChild`."
  - "The back-office shell declares RESTRAINED even though it hosts expressive pages, because TopBar and MobileBottomNav are siblings of the page content and composite over the POS and KDS. Chrome is bound by the poorest zone it can appear over."
  - "The three chrome surfaces resolve to `bg-background` — the same role token the page beneath already uses — so no new contrast pairing is introduced and phase 20's §3.8 table still covers every text-on-chrome measurement."
  - "The two overlays keep the effect as a possibility but lose the hard-coded class; the cascade decides where glass is legal, via a zone-scoped rule 34-02 lands."

patterns-established:
  - "Zone declaration lives at the layout or page that OWNS the surface, never derived from the URL inside a shared component, so the value is greppable where it is decided"
  - "Guard fallbacks declare their own zone — an access-denied kitchen screen is still a kitchen screen on the same wall display"
  - "The platform console's zone sits INSIDE PlatformGuard so an access-denied response is not dressed as the console"
  - "Every gate carries its negative controls in its own docblock, recorded as observed rather than asserted"

requirements-completed: [VDL-02, VDL-03]

coverage:
  - id: D1
    description: "Every surface in the product resolves its richness zone through two independent channels (data-zone attribute + React context)"
    requirement: VDL-02
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/zone-containment.test.ts#every zone root declares its zone"
        status: pass
      - kind: e2e
        ref: "e2e/journeys/operational-zone-containment.spec.ts — [data-zone=operational] asserted attached on the live POS route"
        status: pass
    human_judgment: false
  - id: D2
    description: "The five compositing filters are gone; three of them were rendering over the POS terminal"
    requirement: VDL-03
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/zone-containment.test.ts#the backdrop utility family has exactly one legal home"
        status: pass
      - kind: e2e
        ref: "e2e/journeys/operational-zone-containment.spec.ts#the POS terminal / a KDS station board — computed-style sweep returns zero offenders"
        status: pass
    human_judgment: false
  - id: D3
    description: "A portalled overlay carries its zone across the portal boundary, so a zone-scoped CSS rule can reach it"
    requirement: VDL-03
    verification:
      - kind: unit
        ref: "__tests__/lib/theme/zone-containment.test.ts#portalled overlays stamp their zone"
        status: pass
      - kind: e2e
        ref: "negative control 3 — stamp removed, attribute read back null in Chromium; restored, reads 'restrained'"
        status: pass
    human_judgment: false
  - id: D4
    description: "The containment gate has been watched to fail, three different ways, rather than merely being green"
    verification:
      - kind: manual_procedural
        ref: "three negative controls recorded in zone-containment.test.ts docblock; each observed red then restored"
        status: pass
    human_judgment: true
    rationale: "A negative control is only meaningful if a human confirms it was actually observed failing. The record is in the test's docblock but the observation itself cannot be re-derived from a green run."

duration: 65min
completed: 2026-08-11
status: complete
---

# Phase 34 Plan 01: The Zoning Spine Summary

**Three richness zones declared through a DOM attribute and React context, five compositing filters removed (three of which were repainting the POS terminal from the shell chrome above it), and a two-part containment gate — static import-closure walk plus runtime computed-style sweep — proven to fail three different ways.**

## Performance

- **Duration:** ~65 min
- **Tasks:** 3
- **Files created:** 5
- **Files modified:** 12

## Accomplishments

- **The blur on the POS was never on the POS.** `top-bar.tsx` and `mobile-bottom-nav.tsx` are siblings of the page content in the back-office shell, and POS still renders inside that shell — so a sticky header with `backdrop-blur` was forcing a repaint of the terminal beneath it on every frame. A page-only source check would have found nothing. This is the finding that shaped the whole gate.
- **`ZoneProvider` / `useZone()`** publish the zone twice on purpose. Radix portals overlays to `document.body`, outside every zone subtree, so a zone-scoped rule written against DOM ancestry matches nothing — present in the stylesheet, absent on the screen. Context survives the portal; the overlay copies the value onto the portalled node itself.
- **The static gate walks layout ancestors**, not just the page's own imports, and a second test asserts the chrome *is* in the closure so the gate cannot silently stop covering its original case.
- **Three negative controls, each observed red and restored**, including the one that matters most: with the `data-zone` stamp removed, the portalled overlay's attribute reads back `null` in a real Chromium.

## Task Commits

1. **Task 1: Declare the three zones, in the DOM and in React** — `2be9ffa` (feat)
2. **Task 2: Remove the five compositing filters** — `c62ca23` (fix)
3. **Task 3: The containment gate — static closure and runtime computed style** — `792f2de` (test)

## Contract for plans 34-02 … 34-07

These three names are what every later plan writes CSS against:

| Thing | Value |
|---|---|
| Zone attribute | `data-zone`, values `expressive` \| `restrained` \| `operational` |
| Context reader | `useZone(): Zone` from `@/components/providers/zone-provider`, defaults to `restrained` |
| Overlay slot | `data-slot="dialog-overlay"`, on both `components/ui/dialog.tsx` and the POS drawer |

The glass rule 34-02 lands must be selector-rooted at `[data-zone="expressive"]` — the static gate rejects any compositing-filter rule that is not, and that check was confirmed to discriminate (the same rule, scoped, passes).

## Decisions Made

- **`display: contents` for the zone wrapper.** The POS terminal and KDS board are full-height flex layouts; a default-styled div breaks them. Roots that cannot take any wrapper (`station-board.tsx`, the kitchen guard fallbacks) use `asChild` and stamp the attribute on their own element.
- **The back-office shell is restrained, deliberately, even though it hosts the expressive dashboard.** Recorded in the layout itself, because it looks like a mistake until you know the chrome renders over the POS.
- **Chrome resolves to `bg-background`, not a new opaque token.** That is the same role token the page beneath already resolves, so phase 20's §3.8 table still covers every text-on-chrome pairing without a new measurement.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The runtime spec's persona and preconditions did not match the seeded reality**

- **Found during:** Task 3
- **Issue:** The plan's runtime half assumed the POS menu grid would render for a seeded persona. It does not: *every* POS persona lands on "Your till is closed" until a till session is opened, so the sweep would have run against an empty-state screen and passed for the wrong reason. Waiting on `menu-grid` also made a compositing gate depend on till seed state.
- **Fix:** Precondition changed to the terminal's tab bar (renders regardless of till state, still proves the terminal mounted). Persona switched to WAITER. A `[data-zone="operational"]` attachment assertion added ahead of the sweep so an unrendered screen cannot pass trivially.
- **Verification:** Spec green against the live stack; the zone assertion passes, confirming the spine works at runtime.
- **Committed in:** `792f2de`

**2. [Rule 3 — Blocking] The portal half could not use the surface the plan named**

- **Found during:** Task 3
- **Issue:** The plan specifies the POS order-detail drawer for the portal test. It is unreachable in the current seed — Floor View renders zero table cards for any POS persona, and "Open Till" is an inline panel, not a dialog.
- **Fix:** Used the ⌘K command palette, which is a genuine Radix portal reachable unconditionally on the POS route. Assertions adjusted to what that actually proves: the stamp survives the portal, and the value is not `expressive`.
- **Impact, stated rather than glossed:** this is **weaker** than the plan asked for. The specific regressed surface (the POS drawer overlay) is covered by the static gate only. Recorded in the spec's own comments.
- **Committed in:** `792f2de`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking). No scope creep; both are the test adapting to seeded reality rather than the implementation changing.

## Issues Encountered

- **`pos-service` flapped throughout task 3.** Another executor agent is adding `PrintJobService`/`PrintJobController` to `pos-service` and rebuilding it repeatedly. The journeys observability guard correctly fails any test that sees a 503, so the runtime spec failed several runs for reasons entirely unrelated to this plan. It passes when run in isolation against a settled service. **The guard was deliberately NOT loosened** — a 503 tolerance added for this would have been a permanent hole for everyone.
- **Two `tsc` errors and one lint error appeared mid-run from another agent's files** (`lib/adapters/shared.ts`, `__tests__/lib/money-display-authority.test.ts`, both modified at 22:10–22:11). Out of scope; logged to `deferred-items.md`. No phase-34 file has a type or lint error.
- **`e2e/tables-and-menu-images.spec.ts:53` has a pre-existing `e2e:typecheck` error** (last touched in phase 19b, unmodified here). Logged, not fixed.

## Next Phase Readiness

- 34-02 can land the first `[data-zone="expressive"]` glass rule immediately; the gate is written to pass on an empty set so there is no false dependency.
- The runtime spec's positive control (`the dashboard resolves a compositing filter somewhere`) currently **skips loudly** with an explicit message. It must start passing once 34-02 lands, and that is the check that proves the containment gate is not merely passing because the product has no glass anywhere.

---
*Phase: 34-visual-design-language*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 5 created files exist on disk; all 3 task commits resolve in git.
