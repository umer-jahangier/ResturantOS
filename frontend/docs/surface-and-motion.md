# Surface & motion — how to use it

Practical guide for anyone building a screen. The full contract, with every measured figure and
the reasoning behind each decision, is
`.planning/phases/34-visual-design-language/SURFACE-MOTION-SPEC.md`.

## The one thing to get right: which zone am I in?

```tsx
import { useZone } from "@/components/providers/zone-provider";
const zone = useZone(); // "expressive" | "restrained" | "operational"
```

| Zone | Where | What you get |
|---|---|---|
| `expressive` | dashboards, reports, SuperAdmin console, login, settings | glass, depth, entrance + hover motion |
| `restrained` | admin CRUD, lists, forms, menu management | subtle elevation, fast transitions, no decorative motion |
| `operational` | POS order screen, KDS/BDS board | depth cues only — no blur, no entrance, no parallax |

You rarely set this. It is declared once per zone root (a layout, or a page that owns a screen).
If you are adding a new top-level screen, declare it there — **never derive it from the URL
inside a shared component**, so the value stays greppable where it is decided.

## Surfaces

```tsx
import { GlassPanel } from "@/components/ui/surface/glass-panel";

<GlassPanel depth={2} interactive>…</GlassPanel>
<GlassPanel weight="overlay" depth={3}>…</GlassPanel>
```

Or, on the existing `Card`:

```tsx
<Card depth={2} interactive>…</Card>   // depth is OPT-IN; omit it and Card is unchanged
```

**Rules that are enforced, not advisory:**

- A glass surface may only sit over `--background` or `--surface-1/2/3`. Not over `--card` (glass
  on glass reads as neither), and **never** over a photo, a gradient or any user-supplied image —
  contrast over an unbounded background is undefined, not merely hard to measure.
- If you need a new substrate, add it to `lib/theme/glass-surfaces.ts`. The contrast test will
  then measure it. If you skip that step the test fails, which is the point.
- Never write `backdrop-blur` or `backdrop-filter` at a call site. It has exactly one legal home
  — a zone-scoped rule in `globals.css` — and a repo-wide test enforces that.

## Motion

```tsx
import { Reveal, RevealGroup } from "@/components/ui/surface/reveal";

<RevealGroup>            {/* sequences children automatically */}
  <Card>…</Card>
  <Card>…</Card>
</RevealGroup>

<Reveal index={2}>…</Reveal>   {/* or place one yourself */}
```

Or the classes directly: `.vdl-enter`, `.vdl-enter-scale`, `.vdl-reveal`, `.vdl-stagger`,
`.vdl-lift`, `.vdl-tilt`.

### The rule that matters most

**The element's resting style must already be its finished style.** Put the offset in the
keyframe's opening frame, never on the class.

```css
/* WRONG — this renders a blank screen for a reduced-motion user */
.thing        { opacity: 0 }
@keyframes in { to { opacity: 1 } }

/* RIGHT — delete the animation and the element is still correct */
.thing        { animation: in 420ms both }
@keyframes in { from { opacity: 0; transform: translate3d(0,10px,0) } }
```

If you get this wrong, the content is simply gone for anyone with reduced motion, a backgrounded
tab, or a paused compositor — and it looks like a data-loading bug, not a motion bug, which is
why it survives review. A test rejects a hidden resting state, so you will find out immediately.

### Reduced motion

Handled for you in CSS: decorative animation is **removed**, not shortened. You only need to
think about it for **imperative** motion, which no stylesheet can reach:

```tsx
import { useReducedMotion } from "@/lib/hooks/ui/use-reduced-motion";

const prefersReducedMotion = useReducedMotion();
```

A test fails any module that writes a transform from JavaScript without importing this.

### Pointer tilt

```tsx
import { usePointerTilt } from "@/lib/hooks/ui/use-pointer-tilt";

const { ref, handlers, active } = usePointerTilt({ maxDeg: 4, enabled: zone === "expressive" });
<div ref={ref} {...handlers} className="vdl-tilt">…</div>
```

It refuses to engage on a coarse pointer, under reduced motion, or when disabled. Do not
reimplement it: it measures the element once per gesture and writes once per frame, and both
properties are asserted by counting calls. Reading `getBoundingClientRect()` per pointer-move
forces a synchronous layout on every frame — it benchmarks fine in isolation and stutters on a
real page.

## Things that will fail the build

| Doing this | Fails |
|---|---|
| `backdrop-blur-*` anywhere in `app/` or `components/` | `zone-containment.test.ts` |
| a `backdrop-filter` rule not rooted at `[data-zone="expressive"]` | `zone-containment.test.ts` |
| `opacity: 0` / `visibility: hidden` / a literal offset transform as a resting style | `motion-vocabulary.test.ts` |
| a duration over 240 ms outside the expressive zone | `motion-vocabulary.test.ts` |
| a new glass token without declared substrates | `glass-contrast.test.ts` |
| adding any dependency, especially `three` / `gsap` / `@react-spring/web` | `dependency-budget.test.ts` |
| importing `framer-motion` | `dependency-budget.test.ts` |
| a transform / filter / `will-change` on a POS **layout ancestor** | `operational-zone-containment.spec.ts` |

That last one is not stylistic. Those properties make an element the containing block for
`position: fixed` descendants — **including at print time** — and the receipt lifts itself out of
the app shell with `position: fixed`. Keep depth on leaf surfaces, not on wrappers.

## If you are touching the POS or the KDS

Don't add surface treatment. A cashier completes an order in under ten seconds during a rush and
a KDS is read at two metres across a hot kitchen; `backdrop-filter` forces a repaint of
everything beneath it, and on the cheap Android tablet most restaurants actually use that is
measurable jank on the two screens where jank costs money.

Depth cues that aid hierarchy are fine. Anything decorative is not.
