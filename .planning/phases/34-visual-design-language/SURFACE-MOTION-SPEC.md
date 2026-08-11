# Surface & Motion — the phase 34 addendum to UI-SPEC

**Extends** `.planning/phases/20-design-system/UI-SPEC.md`. It does not replace any part of it.
Every phase-20 token value, every one of its 53 measured contrast pairings, and both of its
machine-checked gates remain authoritative and unchanged.

**Every number below is derivable from `frontend/app/globals.css` by a test that reads the
shipped stylesheet.** That is the same standard UI-SPEC is held to, and it is the reason this
document is worth trusting: a number in a document is decoration, and nobody notices when it
stops being true. The deriving test is named beside each table.

---

## 1. The three zones (D-34-02)

Richness is zoned. This is the decision that keeps the product fast, and it is the one an
executor under deadline violates — not by adding glass to the POS, but by adding glass to a
shared `Card` the POS imports, or to a shell header rendering above it.

| Zone | Screens | Treatment |
|---|---|---|
| `expressive` | dashboards, reports, SuperAdmin console, onboarding, login, settings | full glass, depth, entrance and hover motion |
| `restrained` | admin CRUD, lists, forms, menu management | subtle elevation, ≤150 ms transitions, no decorative motion |
| `operational` | POS order screen, KDS/BDS board | depth cues only. **No** `backdrop-filter`, **no** entrance animation, **no** parallax |

**Declared through two channels**, because neither covers the other's blind spot: a `data-zone`
DOM attribute the cascade reads, and React context that survives a portal. Radix mounts overlays
on `document.body`, outside every zone subtree, so a rule written against DOM ancestry matches
nothing — present in the stylesheet and absent on the screen.

`useZone()` from `@/components/providers/zone-provider` defaults to `restrained`.

**Zone roots** — declared at the layout or page that owns the surface, never derived from the URL
inside a shared component:

| Root | Zone |
|---|---|
| `app/(tenant)/layout.tsx` | `restrained` |
| `app/(auth)/layout.tsx` | `expressive` |
| `app/(platform)/layout.tsx` (inside `PlatformGuard`) | `expressive` |
| `app/(tenant)/app/dashboard/page.tsx` | `expressive` |
| `app/(tenant)/app/pos/layout.tsx` | `operational` |
| `components/kds/station-board.tsx` + all three kitchen guard fallbacks | `operational` |

The back-office shell is `restrained` **even though it hosts the expressive dashboard**, because
`TopBar` and `MobileBottomNav` are siblings of the page content and composite over the POS and
the KDS. Chrome is bound by the poorest zone it can appear over.

*Derived by* `__tests__/lib/theme/zone-containment.test.ts`.

---

## 2. Glass surfaces (D-34-04)

### 2.1 Authoring rule — solid first, always

The opaque colour is the **base declaration**. Translucency is a positive-`@supports`
enhancement, additionally scoped to `[data-zone="expressive"]`.

```css
.glass-surface { background-color: var(--glass-panel-solid); }   /* ships */

@supports (backdrop-filter: blur(1px)) {
  [data-zone="expressive"] .glass-surface { background-color: var(--glass-panel-fill); … }
}
```

Authored the other way round — fallback inside `@supports not (…)` — the degraded path lives in
a branch nobody renders locally, nobody screenshots and nobody measures. "It degrades gracefully"
then becomes a sentence in a document rather than a property of the product.

*Derived by* `glass-contrast.test.ts#every glass surface class declares its opaque background
OUTSIDE any feature query`.

### 2.2 Tokens

| Token | Light | Dark |
|---|---|---|
| `--glass-panel-solid` | `oklch(0.978 0.004 H)` | `oklch(0.242 0.008 H)` |
| `--glass-panel-fill` | `oklch(0.99 0.003 H / 0.72)` | `oklch(0.26 0.008 H / 0.72)` |
| `--glass-panel-blur` | `12px` | `12px` |
| `--glass-panel-hairline` | `oklch(1 0 H / 0.55)` | `oklch(1 0 H / 0.12)` |
| `--glass-overlay-solid` | `oklch(0.968 0.004 H)` | `oklch(0.276 0.008 H)` |
| `--glass-overlay-fill` | `oklch(0.99 0.003 H / 0.6)` | `oklch(0.3 0.008 H / 0.6)` |
| `--glass-overlay-blur` | `20px` | `20px` |
| `--glass-saturate` | `1.35` | `1.35` |

`H` is `var(--brand-h)`. No glass token is authored at a fixed hue.

Three deliberate choices:

- **The fallback is a designed value, not the fill with its alpha stripped** (0.978 vs 0.99). A
  fallback that is merely a rename has not been designed for the degraded case, and nobody will
  have looked at it. Asserted.
- **Alphas are shared across themes; lightness is not.** Alpha is the "how much glass" knob and
  should mean the same thing in both. A near-white fill at 0.72 over near-black is a light
  rectangle, not glass, so dark sits near `--surface-2`/`--surface-3` instead.
- **The hairline is decorative** under WCAG 2.2 SC 1.4.11 and exempt from the 3:1 floor. It is
  the edge of a surface, not a boundary identifying a component or its state.

### 2.3 Permitted substrates

Contrast over an arbitrary background is not hard to measure — it is **undefined**, and an
undefined figure cannot satisfy D-34-01. Each surface therefore enumerates what it may sit over,
in `lib/theme/glass-surfaces.ts`.

| Surface | Substrates | Foregrounds |
|---|---|---|
| panel | `--background`, `--surface-1`, `--surface-2`, `--surface-3` | `--foreground`, `--foreground-secondary`, `--foreground-tertiary` |
| overlay | `--background`, `--surface-1`, `--surface-2` | `--foreground`, `--foreground-secondary` |

A panel may **not** sit on `--card`: glass on glass composites two near-identical lightnesses and
reads as neither. **No** glass surface may sit over a photographic, user-supplied or gradient
background — there is nowhere to declare one, which is the enforcement.

### 2.4 Measured contrast — both deployment conditions

`backdrop-filter` is unsupported or disabled in real deployments, and that is a *different
colour*, so it is a different measurement.

| Theme | Surface | Foreground | Filter unavailable | Composited (worst substrate) |
|---|---|---|---|---|
| light | panel | `--foreground` | 18.01 | 17.73 |
| light | panel | `--foreground-secondary` | 8.26 | 8.13 |
| light | panel | `--foreground-tertiary` | 5.42 | **5.34** |
| light | overlay | `--foreground` | 17.49 | 18.17 |
| light | overlay | `--foreground-secondary` | 8.02 | 8.34 |
| dark | panel | `--foreground` | 15.64 | 14.31 |
| dark | panel | `--foreground-secondary` | 11.12 | 10.17 |
| dark | panel | `--foreground-tertiary` | 7.11 | 6.50 |
| dark | overlay | `--foreground` | 14.13 | 14.35 |
| dark | overlay | `--foreground-secondary` | 10.04 | 10.20 |

Floor is 4.5:1 (AA) for every row. **The binding constraint is 5.34:1** — light panel,
`--foreground-tertiary`, over `--surface-3`. It has the least headroom, so it is what breaks
first if a fill alpha drops or a surface step darkens.

*Derived by* `__tests__/lib/theme/glass-contrast.test.ts`.

### 2.5 Contrast across the whole brand-hue range

Swept 0–355° at 5° steps, both themes, both conditions. **Worst case across the entire sweep:
5.34:1 at hue 125°** — the same pairing, essentially the same figure, because every glass input
is authored at near-zero chroma so hue rotation barely moves lightness.

**This is a build-time guarantee, not a runtime guard, and the distinction matters.**
`app/api/theme/route.ts` is the only runtime retinting path and it emits exactly thirteen
declarations: `--primary-50 … --primary-950`, `--primary`, `--primary-foreground`. It does not
emit `--brand-h`, nor any neutral, surface or foreground token — so **a tenant cannot move a
single figure in the table above.** Three assertions keep that true; if the route ever emits a
token outside the primary ramp, the appearance screen will need its own contrast guard.

*Derived by* `__tests__/lib/theme/glass-hue-sweep.test.ts`.

---

## 3. Depth (D-34-06)

"3D" means **depth, not literal 3D**: layered shadows, restrained transforms, in-card parallax
and tilt. No WebGL, no scene graph, no 3D model format, no physics runtime.

| Token | Light | Dark |
|---|---|---|
| `--depth-1` | `0 1px 2px /0.05`, `0 4px 12px /0.06` | same geometry, `/0.4`, `/0.44` |
| `--depth-2` | `0 2px 4px /0.06`, `0 12px 28px /0.10` | same geometry, `/0.46`, `/0.5` |
| `--depth-3` | `0 4px 8px /0.08`, `0 28px 60px /0.16` | same geometry, `/0.5`, `/0.62` |
| `--depth-lift-y` | `-3px` | `-3px` |
| `--depth-lift-shadow` | `0 6px 12px /0.08`, `0 20px 44px /0.14` | same geometry, `/0.5`, `/0.56` |
| `--depth-inset` | `inset 0 2px 4px /0.10` | same geometry, `/0.5` |

Every layer is `oklch(0 0 0 / α)` — **chroma zero**, so depth never tints the surface beneath it.
Two layers per level (wide-soft ambient + tight-dark key) is what separates a designed shadow
from a blur under a box. Dark keeps the geometry and deepens only the alpha, so the two themes
cannot drift into different depth languages one tweak at a time.

**Additive.** Phase 20's four `--elev-*` levels are untouched; components depend on them today.

*Derived by* `glass-contrast.test.ts#D-34-06 · depth is depth, not tint`.

---

## 4. Motion (D-34-01, D-34-03)

### 4.1 The resting-state contract — read this before adding a keyframe

**An animated element's static style IS its finished style.** The keyframe's opening frame
carries the offset; its closing frame carries nothing.

```css
.thing        { opacity: 0 }          /* WRONG — renders a blank screen */
@keyframes in { to { opacity: 1 } }
```

Written that way the element is invisible until a keyframe runs, so a reduced-motion user — for
whom D-34-03 requires *absence*, not speed — sees nothing at all. So does anyone with a
backgrounded tab, a paused compositor, or an animation that simply failed. It reads as a
data-loading bug rather than a motion bug, which is why it survives review.

*Enforced structurally by* `motion-vocabulary.test.ts#the resting-state contract`: no animation
class may set a zero opacity, a hidden visibility, or a non-identity transform as a resting
declaration. A `var()`-driven identity transform (`.vdl-tilt`) is permitted; a literal offset is
not.

### 4.2 Tokens

| Token | Value | Zone |
|---|---|---|
| `--motion-instant` | `0ms` | all (phase 20) |
| `--motion-fast` | `120ms` | all (phase 20) |
| `--motion-base` | `180ms` | all (phase 20) |
| `--motion-slow` | `240ms` | all (phase 20) |
| `--motion-state` | `120ms` | all |
| `--motion-hover` | `140ms` | all |
| `--motion-feedback` | `200ms` | all |
| `--motion-stagger` | `55ms` | expressive |
| `--motion-entrance` | **`420ms`** | **expressive only** |
| `--motion-reveal` | **`620ms`** | **expressive only** |
| `--motion-loading` | `1600ms` | non-operational |

The two bold values exceed §3.12's 240 ms ceiling. That is a **zone-scoped extension, not a
reversal**: the ceiling exists because an operator navigates ~200 times a shift and pays the
duration every time, and nobody navigates a login screen 200 times a shift. The ceiling still
binds on restrained and operational surfaces, asserted.

### 4.3 Classes

| Class | Zone | Effect |
|---|---|---|
| `.vdl-enter` | expressive | fade + 10 px rise |
| `.vdl-enter-scale` | expressive | fade + scale from 0.97 |
| `.vdl-reveal` | expressive | dash-offset reveal |
| `.vdl-stagger > *` | expressive | entrance sequenced by `--vdl-i` × `--motion-stagger` |
| `.vdl-lift` | expressive + restrained | hover lift; **translates only when expressive** |
| `.vdl-tilt` | expressive | pointer tilt, driven by `--tilt-x` / `--tilt-y` |

### 4.4 Reduced motion — absence, not speed

Decorative families are set to `animation: none`, not to a short duration. A two-frame flourish
is still a vestibular trigger and still a paint.

**State transitions survive** at the collapsed duration — a focus ring, a checkbox, a selection.
Those are *feedback*, not decoration, and removing them makes a control feel broken rather than
calm. Phase 20's global 0.01 ms net is retained *below* the explicit removals, covering
third-party and legacy animation.

Imperative motion consults the preference **itself** (`useReducedMotion()`), because no
stylesheet rule can reach a transform written from an event handler, and it re-subscribes so a
user who flips the setting mid-session is honoured without a reload. Its server value is `true`,
so the conservative first paint corrects *toward* motion rather than away from it.

*Derived by* `motion-vocabulary.test.ts` and `e2e/journeys/reduced-motion.spec.ts`, the latter
run in **both** directions — a motion system shipped as dead CSS passes every stillness
assertion ever written.

---

## 5. What the operational zone costs (measured)

| Measurement | Value | Kind |
|---|---|---|
| POS tap-to-cart, real path with an open till | **79–99 ms** (two runs) | observation |
| Compositing filters on the POS terminal | **0** | **gate** |
| Running animations on the POS terminal | **0** | **gate** |
| Geometry transitions in the cart on mutation | **0** | **gate** |
| Containing-block creators on the POS route | **0** | **gate** |

**The 99 ms is not the gate**, and must not be quoted as one. It is a wall-clock figure from
developer hardware, a dev server and a machine shared with seven other agents; it would fail
differently on every machine. The gates are the deterministic computed-style assertions, which
fail identically everywhere.

The containing-block gate exists because `transform`, `filter`, `backdrop-filter`, `perspective`,
`will-change` and paint/layout `contain` each make an element the containing block for its
`position: fixed` descendants — **at print time as well as on screen**. Phase 26's receipt lifts
the bill out of the app shell with `position: fixed`, and that route lives under `app/pos/`.
Glass morphism is precisely the technique that would break it.

*Derived by* `e2e/journeys/operational-latency.spec.ts` and
`e2e/journeys/operational-zone-containment.spec.ts`.

---

## 6. What phase 34 cost the bundle

| | before | after | delta |
|---|---|---|---|
| `globals.css`, comments stripped | 17,374 B | 23,195 B | **+5,821 B** |
| new JS modules (6 files, source) | 0 | 24,000 B | **+24,000 B** source |
| dependencies | 24 | 24 | **0** |

46% of `globals.css` is comment and none of it ships.

**Against those additions, one removal:** 34-03 took `PageTransition` out of the tenant shell,
orphaning `framer-motion` entirely. It remains in `package.json` but is reachable from no route,
so it no longer ships — a saving that comfortably exceeds every addition above. Removing the
package is a build-surface change left to a follow-up; `dependency-budget.test.ts` will fail if
it is removed without updating the baseline in the same commit, deliberately.

**Not measured, and not pretended otherwise:** a true pre-phase *built* bundle comparison. That
would mean checking out the pre-phase tree and building it, and this repository is one working
tree shared by eight agents.

*Derived by* `__tests__/lib/theme/bundle-budget.test.ts` and
`__tests__/lib/theme/dependency-budget.test.ts`.

---

## 7. Gate inventory

| Gate | File | Status |
|---|---|---|
| Zone containment (static) | `__tests__/lib/theme/zone-containment.test.ts` | green |
| Zone containment (runtime) | `e2e/journeys/operational-zone-containment.spec.ts` | green |
| Containing-block / print safety | same file | green |
| Compositing arithmetic | `__tests__/lib/theme/composite.test.ts` | green |
| Glass contrast, both conditions | `__tests__/lib/theme/glass-contrast.test.ts` | green |
| Glass contrast, all hues | `__tests__/lib/theme/glass-hue-sweep.test.ts` | green |
| Motion vocabulary (static) | `__tests__/lib/motion/motion-vocabulary.test.ts` | green |
| Reduced motion, both directions | `e2e/journeys/reduced-motion.spec.ts` | green |
| Dependency budget | `__tests__/lib/theme/dependency-budget.test.ts` | green |
| Bundle budget | `__tests__/lib/theme/bundle-budget.test.ts` | green |
| Operational latency | `e2e/journeys/operational-latency.spec.ts` | green — POS **and** KDS, the latter on the real board for the first time (see §7 item 7) |
| State distinguishability (GA-001, restyled) | `e2e/journeys/state-distinguishability.spec.ts` | green |
| State character (salience, zone, precedence) | `__tests__/components/state-character.test.tsx` | green |
| Dashboard character (composition, chart, count-up) | `__tests__/components/dashboard-character.test.tsx` | green |
| Expressive surfaces, filter forced off | `e2e/journeys/expressive-surfaces-visual.spec.ts` | green |
| **Phase 20 contrast (53 pairings)** | `__tests__/lib/theme/design-tokens.test.ts` | green, unchanged |
| **Phase 20 permission matrix** | `__tests__/shared/nav-permission-matrix.test.tsx` | green, unchanged |

### Gates that were found passing vacuously

Recorded because the pattern matters more than any individual fix. Each was caught by running a
negative control rather than by trusting green:

1. **Reduced-motion absence** matched `animation: none` within 400 characters of a class name and
   picked it up from a *neighbouring* rule. Editing the block to `animation-duration: 1ms` — the
   exact defect — did not fail it.
2. **`test.use({ reducedMotion })`** is not typed on this suite's extended fixture and had no
   runtime effect. The "reduce" pass ran with **no preference set** while still reporting
   `reduce` in its name.
3. **The evidence harness** wrote `localStorage` after navigation to switch themes; the provider
   had already read it, so every "dark" screenshot was byte-identical to its light counterpart.
4. **The positive control** was anchored to a dashboard that renders an error state whenever a
   backing service is down — so it skipped, silently, while the run reported green.
5. **The latency settle signal and cart check** waited on a `cart-lines` testid that does not
   exist: one spent its full timeout and reported a 20-second "latency", the other queried
   `null`, returned `[]` and asserted nothing.

6. **The pixel floor in `state-distinguishability.spec.ts`** — mine, found by its own negative
   control. The floor was set at 2,000 pixels by reasoning rather than by measurement. The
   control rewrote the error notice with the empty state's surface, disc and wording, retry
   suppressed and alert removed — total convergence, the exact defect the gate exists to catch
   — and the two renderings still differed by **2,920 pixels**, because the empty state carries
   a description line the converged error did not. It passed. The floor is now calibrated from
   two measured populations: 89,911 genuine against 2,920 converged, so 20,000 sits between
   them with 4.5× and 6.8× of margin. The empty-vs-populated pair needed its own lower floor
   (5,000 against a measured 12,652) because reusing 20,000 there failed **correct** code —
   the opposite error, and just as fatal, since a gate that fails on correct code gets deleted.

7. **All three KDS gates were on the wrong screen.** `operational-latency`,
   `operational-zone-containment` and `reduced-motion` each navigated to a station board with
   `page.locator('a[href^="/app/kitchen/"]')`, guarded by `.isVisible().catch(() => false)`.
   The station tiles are **buttons** driving `router.push`; there is no anchor with that href
   anywhere. So the locator matched nothing, the guard swallowed it, no click happened, and all
   three ran against the **station picker**. Every assertion in them is an assertion of
   absence, and the picker carries no filter and no animation either — so all three passed, for
   the life of the phase, including the run that "confirmed" the KDS half after kitchen-service
   came back up. Whether the service was up or down never changed what they measured.

   Found by adding a positive anchor: each now fails with `ANCHOR NOT FOUND` unless
   `[data-testid="kds-board"]` is attached. With the anchor in and the navigation fixed, two of
   the three went **red on a healthy service**, and the failure was real: every ticket fragment
   carried `animate-fade-in`, a 0.2 s `fadeIn` on mount, so arriving on a board with twenty open
   tickets played twenty animations at once. That is the same defect 34-03 removed from the
   board *root*, still present one level down in `kds-item-column.tsx`, on the screen D-34-02
   exists to keep still. Removed; the `motion-safe:` collapse transition beside it stays,
   because it is feedback for a bump the cook just performed rather than decoration on arrival.

8. **The evidence harness signed in as a persona who could not reach the screen.**
   `e2e/shots.mjs` uses `manager@terrace.local`, who does not hold `rbac.manage`, so every
   settings screenshot this phase has on file is a picture of an **Access-denied page**, filed
   as evidence that the settings restyle landed. The same harness cannot reach the owner
   dashboard's chart at all, because the manager preset does not contain one. "Access denied"
   renders perfectly well, and a harness with no *forbidden* condition files it happily.
   `e2e/shots-owner.mjs` signs in as the OWNER (TOTP and all) and declares two conditions per
   route: something that must be present, and a pattern whose presence means the shot would be
   a lie. Run that way it found `/settings/appearance` untreated and its warning notice at
   **1.21:1** in dark.

### Three near-misses of the same family, recorded because the shape repeats

Not gates in their own right, but each would have made one meaningless:

- A route fulfilment returning a bare `[]` instead of this API's `{ data: [] }` envelope
  produced the empty state **for the wrong reason** — `response.data.data` was `undefined` and
  the page's `data ?? []` made a zero-length list of it. The spec would have reported "the empty
  state renders" against a payload the product never receives.
- A `[role="alert"]` query scoped to the whole page counted an alert the app shell renders
  outside the content region, so the empty state "announced a failure". Scoped to `<main>`.
- A fixture UUID of `1111…-1111-1111-…`. Zod 4 enforces the RFC 9562 version and variant
  nibbles, so the row was rejected and the "populated" state rendered a parse failure.

Every gate in this phase now carries its negative controls in its own docblock, recorded as
*observed* rather than asserted.

**The through-line, after eight of these.** Every one is an assertion of ABSENCE with no
positive anchor: no filter, no animation, no difference, no violation. A screen that never
rendered satisfies all of them, and so does a screen that is not the one under test. The rule
this phase has earned: *an absence assertion must be preceded by an assertion that the thing it
is looking at is there* — and where the anchor is a testid, its absence must fail loudly with
`ANCHOR NOT FOUND` rather than resolve to `null` and quietly agree.

---

*Phase 34 — Visual Design Language. Written 2026-08-12.*
