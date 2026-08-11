# Phase 27 — Visual Design Language · CONTEXT

**Depends on:** 20 (design system foundation, landed — tokens shipped in `globals.css`)

## Why

The user's verdict: *"the current UI is very basic, and doesn't feel good but a very raw and plain
UI, add some glass morphism, 3d animations and effects. All the pages should feel lively."*

Phase 20 delivered a correct, accessible token system. It is **flat**. Correctness without
character reads as unfinished, and this is a product restaurant owners will pay for.

## Locked decisions

**D-27-01 — Depth and motion are added ON TOP of phase 20's tokens, never around them.**
The OKLCH ramps, the CVD-verified chart colours, the WCAG-measured contrast pairings and the
machine-checked contrast test all stay authoritative. A glass surface that drops text below 4.5:1
is a regression, not a style. Every new surface treatment carries its own measured contrast
figure, and phase 20's contrast test is extended to cover them rather than exempted.

**D-27-02 — Richness is zoned. This is the decision that keeps the product fast.**
Three zones, and the executor must not blur them:

| Zone | Screens | Treatment |
|---|---|---|
| **Expressive** | Dashboards, reports, SuperAdmin console, onboarding, login, settings | Full glass, depth, entrance and hover motion, animated data reveals |
| **Restrained** | Admin CRUD, lists, forms, menu management | Subtle elevation, fast transitions (≤150ms), no decorative motion |
| **Operational** | **POS order screen, KDS/BDS board** | Depth cues only where they aid hierarchy. NO backdrop-blur, NO entrance animation, NO parallax |

A cashier must complete an order in under 10 seconds during a rush, and a KDS is read at two
metres across a hot kitchen. `backdrop-filter` forces a repaint of everything beneath it, and on
a cheap Android tablet — which is what most restaurants actually use — that is measurable
jank on the two screens where jank costs money. Making those screens beautiful in a way that
makes them slower would be a failure dressed as a success.

**D-27-03 — Motion respects `prefers-reduced-motion`, always.**
Every animation has a reduced-motion path that is not merely "shorter" but *absent* where the
motion is decorative. This is not optional politeness: vestibular disorders are common, and a
POS is used for eight-hour shifts.

**D-27-04 — Glass must degrade.** `backdrop-filter` is unsupported or disabled in real
deployments. Every glass surface needs a solid fallback that still meets contrast — verified with
the property disabled, not assumed.

**D-27-05 — No animation library is added without justification.** CSS transitions and
`@keyframes` cover most of this. If a library is genuinely needed for orchestration, it goes
behind the same blocking human checkpoint phase 26 used for its one npm dependency. Bundle size
is a real cost on a tablet over restaurant wifi.

**D-27-06 — "3D" means depth, not literal 3D.** Layered shadows, subtle transforms on hover,
parallax within a card, tilt on interactive tiles. **No WebGL, no Three.js, no 3D model
rendering** — that is a different product and a different performance budget.

## Scope

**In:** surface treatments (glass, elevation, borders), motion vocabulary (entrance, hover, state
transition, loading, success/error), the empty/loading/error states phase 14b built now given
character, chart reveal animation, and a documented set of primitives other phases compose.

**Out:** rebuilding screens (that is 21 and 33), page layout changes, any change to the POS order
flow or KDS ageing encoding.

## Definition of done

1. A documented motion + surface vocabulary in the design system, with every value tokenised.
2. Dashboards, login, onboarding and the SuperAdmin console visibly transformed — screenshots
   before/after.
3. **Measured**: POS order screen and KDS board show no regression in interaction latency, and
   carry no `backdrop-filter`. Asserted by a test, not by inspection.
4. Every glass surface meets contrast **with `backdrop-filter` disabled**.
5. `prefers-reduced-motion` honoured everywhere, asserted.
6. Phase 20's contrast test and permission-matrix test still green.
