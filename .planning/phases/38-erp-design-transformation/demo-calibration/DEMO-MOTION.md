# DEMO-MOTION.md — Motion, Chart and Interaction contract extracted from `NEXUS_ERP_Demo.html`

**Source measured:** `/Users/muhammadumer/Documents/Projects/ResturantOS/Docs/NEXUS_ERP_Demo.html` (1562 lines).
CSS block = lines 9–517 (`<style>`…`</style>`, verified by grep). Markup = 518–1352. Script block = 1353–1560 (`</script>` at 1560).
Every value below is quoted from the file at the cited line. Nothing here is inferred.

**Method:** read-only. No source file was modified, no server started, no build run.

---

## Part 1 — Motion

### 1.1 The demo's entire motion token set (lines 46–48)

```css
--t-fast:  150ms ease;
--t-med:   250ms ease;
--t-slow:  400ms ease;
```

Three tokens. **All three use the bare CSS keyword `ease`** (= `cubic-bezier(0.25, 0.1, 0.25, 1)`).
There is not one custom `cubic-bezier()` anywhere in the file — verified:

```
$ grep -c "cubic-bezier" Docs/NEXUS_ERP_Demo.html
0
```

`--t-slow: 400ms` is **declared but never consumed** — verified:

```
$ grep -c "var(--t-slow)" Docs/NEXUS_ERP_Demo.html
0
```

So the demo's real motion vocabulary is two durations: **150 ms for state feedback, 250 ms for
layout/entrance**, plus two hand-written durations that bypass the tokens entirely
(`0.8s` progress fill, `0.3s` toast).

> **Calibration note vs. our system.** `frontend/app/globals.css:553-599` already defines a
> *richer* ladder than the demo (`--motion-fast: 120ms`, `--motion-base: 180ms`,
> `--motion-slow: 240ms`, `--motion-hover: 140ms`, `--motion-entrance: 420ms`,
> `--motion-reveal: 620ms`) with real eased curves
> (`--motion-ease: cubic-bezier(0.2, 0, 0.38, 1)`,
> `--motion-entrance-ease: cubic-bezier(0.16, 1, 0.3, 1)`,
> `--motion-reveal-ease: cubic-bezier(0.33, 1, 0.68, 1)`).
> The demo is **not** the more sophisticated artefact here. Do not regress our curves to `ease`.
> The demo's contribution is the *feel* — near-invisible 150 ms hover feedback and a 250 ms
> page-level fade — not the timing function.

### 1.2 Keyframe animations — there are exactly two

```
$ grep -c "@keyframes" Docs/NEXUS_ERP_Demo.html
2
```

**(a) `pulse` — the live dot** (lines 181–182)

```css
.live-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
@keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
```

| Property   | Value |
|---|---|
| Duration   | `2s` |
| Iteration  | `infinite` |
| Easing     | implicit `ease` (none declared) |
| Animated   | `opacity` 1 → 0.5 → 1 **and** `transform: scale()` 1 → 0.8 → 1 |
| Direction  | shrinks and dims at the midpoint — a *breath*, not a radar ping. No box-shadow ring, no pseudo-element halo. |

Sits inside `.live-pill` (lines 174–180): `background: var(--green-soft)`,
`border: 1px solid rgba(74,222,128,0.2)`, `border-radius: 20px`, `font-size: 11px`,
`letter-spacing: 0.05em`, `color: var(--green)`, `gap: 5px`.
Both `opacity` and `transform` are compositor-only properties — this animation never triggers
layout or paint. Keep that property choice.

**(b) `fadeIn` — screen switching** (lines 189–191)

```css
.screen { display: none; animation: fadeIn 0.25s ease; }
.screen.active { display: block; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
```

| Property   | Value |
|---|---|
| Duration   | `0.25s` (= `--t-med`, written out longhand) |
| Easing     | `ease` |
| Animated   | `opacity` 0 → 1, `transform: translateY(6px → 0)` |
| Fill       | none (`both` is **not** set) |

**6 px** is the whole travel distance. This is the single most calibration-relevant number in
the motion section: the demo's page entrance is a *hint* of upward movement, not a slide.
Compare `globals.css:938` `@keyframes vdlEnter` and the `--motion-entrance: 420ms` used at
`globals.css:970` — our entrance is nearly **2× longer** than the demo's.

Note the CSS bug the demo ships: `animation` is on `.screen`, not `.screen.active`, and
`.screen` is `display: none`. The animation therefore runs against a hidden element and re-runs
only because `display` flips — it works by accident of the browser restarting the animation on
display change. **Do not copy this construction**; attach the entrance to the *active* state.

### 1.3 Complete transition inventory (every `transition:` in the file)

| Line | Selector | Declaration | Duration/easing | Property actually animated on hover |
|---|---|---|---|---|
| 73 | `.sidebar` | `transition: width var(--t-med)` | 250 ms ease | `width` (nothing ever changes it — collapse is unimplemented) |
| 111 | `.nav-item` | `transition: all var(--t-fast)` | 150 ms ease | `color`, `background` |
| 167 | `.topbar-btn` | `transition: all var(--t-fast)` | 150 ms ease | `color`, `border-color` |
| 221 | `.kpi-card` | `transition: all var(--t-fast)` | 150 ms ease | `border-color`, `transform`, `box-shadow` |
| 271 | `.btn` | `transition: all var(--t-fast)` | 150 ms ease | `background`, `box-shadow`, `color`, `border-color` |
| 301 | `.progress-fill` | `transition: width 0.8s ease` | **800 ms ease** | `width` |
| 307 | `.tab` | `transition: all var(--t-fast)` | 150 ms ease | `color` (+ `background`/`box-shadow` on `.active`) |
| 316 | `.input` | `transition: border-color var(--t-fast)` | 150 ms ease | `border-color` on `:focus` |
| 368 | `.cat-btn` | `transition: all var(--t-fast)` | 150 ms ease | `color`, `border-color` |
| 376 | `.menu-item-card` | `transition: all var(--t-fast)` | 150 ms ease | `border-color`, `background`, `transform` |
| 397 | `.qty-btn` | `transition: all var(--t-fast)` | 150 ms ease | `background`, `color` |
| 414 | `.pay-btn` | `transition: all var(--t-fast)` | 150 ms ease | `background`, `box-shadow`, `border-color`, `color` |
| 424 | `.table-chip` | `transition: all var(--t-fast)` | 150 ms ease | `border-color`, `color` |
| 454 | `.staff-card` | `transition: all var(--t-fast)` | 150 ms ease | `border-color`, `transform` |
| 507 | `.toast` | `transition: all 0.3s ease` | **300 ms ease** | `transform: translateY(100px → 0)`, `opacity: 0 → 1` |
| 1213–1267 (×12) | inline report tiles | `style="…;transition:all 0.15s"` | 150 ms (implicit `ease`) | `border-color` via `onmouseover`/`onmouseout` JS |

`transition: all` is used **13 times**; only three declarations name a property
(`width`, `border-color`, and the toast's `all`). Copying `transition: all` into our codebase
would animate token swaps during a theme change and is the direct cause of the
"everything smears on theme toggle" class of bug — see Part 3.

### 1.4 Hover / active state changes, verbatim

```css
.nav-item:hover        { color: var(--text); background: var(--surface); }                       /* 113 */
.topbar-btn:hover      { color: var(--text); border-color: var(--border-2); }                    /* 169 */
.kpi-card:hover        { border-color: var(--border-2); transform: translateY(-1px);
                         box-shadow: var(--shadow); }                                            /* 223 */
.btn-primary:hover     { background: #F0AE56; box-shadow: 0 0 20px rgba(232,160,69,0.3); }       /* 274 */
.btn-ghost:hover       { color: var(--text); border-color: var(--border-2);
                         background: var(--surface); }                                           /* 276 */
.btn-teal:hover        { background: #38E2CD; }                                                  /* 278 */
.data-table tr:hover td{ background: var(--surface-2); }                                         /* 293 */
.tab:hover:not(.active){ color: var(--text-2); }                                                 /* 310 */
.input:focus           { border-color: var(--primary); }                                         /* 317 */
.cat-btn:hover         { color: var(--text); border-color: var(--border-2); }                    /* 370 */
.menu-item-card:hover  { border-color: var(--primary); background: var(--surface);
                         transform: translateY(-1px); }                                          /* 379 */
.menu-item-card:active { transform: translateY(0); }                                             /* 380 */
.qty-btn:hover         { background: var(--surface-3); color: var(--text); }                     /* 398 */
.pay-btn.cash:hover    { background: #F0AE56; box-shadow: 0 0 16px rgba(232,160,69,0.3); }       /* 417 */
.pay-btn.card:hover    { border-color: var(--teal); color: var(--teal); }                        /* 419 */
.table-chip:hover:not(.active) { border-color: var(--border-2); color: var(--text); }            /* 427 */
.staff-card:hover      { border-color: var(--border-2); transform: translateY(-1px); }           /* 456 */
::-webkit-scrollbar-thumb:hover { background: var(--text-3); }                                   /* 494 */
```

**The four rules that define the demo's hover feel:**

1. **Lift is exactly `translateY(-1px)`.** Three places (`.kpi-card`, `.menu-item-card`,
   `.staff-card`) and never any other value. One pixel. No `scale()` anywhere on hover — verified,
   the only `scale()` in the file is inside `@keyframes pulse`.
   Our `globals.css:1001` `[data-zone="expressive"] .vdl-lift:hover` should be compared against
   this; 1 px is the demo's ceiling.
2. **Border-colour is the primary hover signal**, not background. 11 of 18 rules move a border.
   The demo escalates in three steps: `--border` (#1F2E45) → `--border-2` (#263850) for neutral
   hover → the accent colour (`--primary` / `--teal`) for *actionable* hover.
   `.menu-item-card:hover` and `.pay-btn.card:hover` are the only two that jump straight to accent.
3. **Glow, not elevation, marks the primary action.** `.btn-primary:hover` and
   `.pay-btn.cash:hover` add `box-shadow: 0 0 20px / 0 0 16px rgba(232,160,69,0.3)` — a spread-0
   coloured halo, no offset. This is distinct from `.kpi-card:hover`'s
   `--shadow: 0 4px 24px rgba(0,0,0,0.4)` (an offset black drop shadow). Two different depth
   languages for two different intents.
4. **`:active` cancels the lift** (`.menu-item-card:active { transform: translateY(0) }`, line 380).
   The card presses back down. This is the only `:active` rule in the file, and it is on the POS
   menu tile — the one control a user hits hundreds of times a shift.

### 1.5 Interaction behaviour (JS, lines 1353–1560)

Handler census (measured):

```
$ grep -o 'onclick="[a-zA-Z]*(' Docs/NEXUS_ERP_Demo.html | sort | uniq -c | sort -rn
  25 onclick="showToast(
  14 onclick="showScreen(
   5 onclick="filterMenu(
   2 onclick="changeQty(
   1 onclick="processPayment(
   1 onclick="addToCart(
$ grep -c 'onmouseover' Docs/NEXUS_ERP_Demo.html
12
```

**Screen switching — `showScreen(id)` (1364–1375).** Removes `.active` from every `.screen` and
every `.nav-item`, adds it to `#screen-<id>`, re-derives the active nav item by *string-matching
the `onclick` attribute* (`n.getAttribute('onclick').includes("'"+id+"'")`), then writes
`screenNames[id]` into `#topbar-current`. The only visual motion is the CSS `fadeIn` (§1.2b).
There is **no** outgoing animation, no cross-fade, no scroll restoration, no history entry.
Behaviour to reproduce: **the breadcrumb text changes in the same frame the content fades in.**

**Tab switching — there is none.** The `.tab` / `.tab.active` classes exist at lines 306–310 and
appear in markup at 683–686, 940, 1143, but **no JavaScript ever moves the `active` class between
tabs**. Verified: `grep -c "classList.*tab" Docs/NEXUS_ERP_Demo.html` → the only `classList`
manipulations in the file are in `showScreen` (`.screen`, `.nav-item`), `filterMenu` (`.cat-btn`)
and `showToast` (`.toast`). Week/Month/Year, All/Income/Expense and This Month/Quarter/Year are
**static decoration**. The `.tab.active` *appearance* is real and worth copying
(`background: var(--surface); color: var(--text); box-shadow: 0 1px 4px rgba(0,0,0,0.3)` on a
`--bg-3` track with `padding: 4px` and `border-radius: 10px` — an inset segmented control);
the *behaviour* is absent and must be designed, not extracted.

**Category filter — `filterMenu(cat, el)` (1435–1440).** The one working "tab-like" control.
Clears `.active` from all `.cat-btn`, sets it on the clicked element, re-renders the grid via
`innerHTML`. Active state = `background: var(--primary); color: var(--bg); border-color: var(--primary)`
(line 371) — a *filled pill*, unlike the tab's *raised chip*. Because the grid is replaced with
`innerHTML`, **no enter animation plays on the new tiles** — items appear instantly.

**Toast — `showToast(msg)` (1387–1394).** Single reused DOM node (`#toast`, line 1348).
Sets text, adds `.show`, `clearTimeout` on a module-level `toastTimer`, then
`setTimeout(() => t.classList.remove('show'), 2800)`.
So: **enter 300 ms, hold 2800 ms, exit 300 ms**, and a second toast within the window *replaces
the text in place* rather than stacking. Transform is `translateY(100px) → translateY(0)` with
`opacity 0 → 1`, anchored `bottom: 24px; right: 24px`.
(Our app uses `sonner` top-right — `frontend/components/providers/app-providers.tsx:27` documents
why. The 2800 ms dwell is the transferable number.)

**Cart mutation (1442–1478).** `addToCart` / `changeQty` re-render the whole ticket with
`innerHTML` and fire a toast. **No count-up, no flash, no row-insert animation** — the numbers
snap. `renderTicket` recomputes `disc = sub * 0.10`, `tax = (sub - disc) * 0.15`,
`total = sub - disc + tax` on every keystroke of interaction.

**Clock (1377–1385).** `setInterval(updateClock, 1000)` writing `toLocaleTimeString` into
`#clock`. A once-per-second text mutation in the topbar with no transition.

**Progress bars.** `.progress-fill` (line 301) carries `transition: width 0.8s ease` and is used
13 times, but **every width is a hard-coded inline `style`** — nothing in the JS ever changes one.
The 800 ms fill animation therefore **never runs in the demo.** It is an intent, not a behaviour:
if we animate a progress bar on mount, 800 ms `ease` on `width` is the recorded intent.

**Dead CSS worth knowing about:** `.sparkline` / `.spark-bar` (lines 515–516) —
`grep -c 'class="sparkline"'` → **0**. Defined, never used.

### 1.6 `prefers-reduced-motion` handling

The demo has exactly one rule, at **line 53**, placed immediately after `:root`:

```css
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
```

That is the whole of it. Assessment against what we already ship:

- It collapses durations to 0.01 ms. It does **not** set `animation-iteration-count: 1`, so the
  infinite `pulse` on `.live-dot` keeps looping — at 0.01 ms per cycle. That is a **100 kHz opacity
  and scale flicker on a permanently visible element**, which is materially worse for a
  vestibular- or photosensitivity-affected user than the original 2 s breath.
- It does not touch `scroll-behavior`, so `html { scroll-behavior: smooth }` (line 55) survives.
- It removes nothing outright; every decorative flourish still executes, just instantly.

**Our `globals.css:1094-1150` is strictly better and must not be replaced by the demo's rule.**
It (a) sets `animation: none` outright on the `vdl-*` decorative families rather than shortening
them, (b) sets `animation-iteration-count: 1` in the global net at line 1146 — which is precisely
the bug above, (c) kills `.skeleton`'s perpetual shimmer and substitutes a flat `--muted` fill,
(d) strips the hover `transform` while *keeping* the `box-shadow` because that conveys the same
affordance without moving anything, and (e) deliberately preserves state-feedback transitions at
the collapsed duration, with the reasoning recorded in the comment.

**Carry across from the demo:** nothing. **Carry across from our file:** the pattern of naming the
decorative families explicitly *above* the global safety net.
If the live-dot pulse ships, it needs an explicit `animation: none` in that block — the global net
alone is the flicker bug.

### 1.7 Motion that is absent from the demo (measured, so we do not go looking for it)

| Thing | Proof of absence |
|---|---|
| Any custom easing curve | `grep -c "cubic-bezier"` → 0 |
| Any `scale()` on hover/active | only occurrence of `scale(` is inside `@keyframes pulse` (line 182) |
| Any `@media (prefers-contrast)` | `grep -c "prefers-contrast"` → 0 |
| Any theme toggle / light mode | `grep -ni "theme"` over the file → 0 hits. **The demo is dark-only.** Every colour in Part 1 and Part 2 is a dark-theme value with no light counterpart. |
| Stagger / sequenced entrance | no `animation-delay` anywhere |
| Skeleton / shimmer loading state | no `skeleton`, no `shimmer` class |
| Modal / drawer / popover motion | no such component exists in the demo |
| Route-level transition | `showScreen` swaps `display`; no View Transitions, no history |

---

## Part 2 — Charts

### 2.0 THE BINDING CONSTRAINT — read this before the tables

**The demo loads Chart.js 4.4.1 from a CDN (line 8). We cannot.**

```
$ grep -n "chart\|recharts" frontend/package.json
(no output — neither package is a dependency)
```

`frontend/__tests__/lib/theme/dependency-budget.test.ts` asserts, under D-34-05:

> `it("no package was added to dependencies")` — the current `Object.keys(pkg.dependencies)` is
> diffed against a hard-coded `BASELINE_DEPENDENCIES` array (lines 36–61 of that file).
> `chart.js` and `recharts` are not in that array, so **adding either fails the suite by name.**

Precision matters here: `chart.js` and `recharts` are *not* in that test's `FORECLOSED` denylist
(that list names `three`, `gsap`, `lottie-web`, etc.). The block comes from the **baseline
assertion**, which forecloses *any* addition, not from a named prohibition. The escape hatch the
test itself documents is "add it to `BASELINE_DEPENDENCIES` with a comment saying which plan
approved it" — i.e. a deliberate, recorded human decision, not a drive-by install.

**Phase 21 precedent** (`.planning/phases/21-screen-rebuilds/21-01-SUMMARY.md:20, 130-138`):

> `added: [] # no new dependencies — the trend chart is inline SVG, not Recharts`
> "**No Recharts.** It is not currently a dependency… adding ~400kB of transitive
> state-management machinery to draw two polylines is not a trade this screen needs to make."

The working implementation of that precedent is
`frontend/components/dashboard/portlets/trend-chart.tsx` — inline SVG, `viewBox="0 0 640 200"`,
`aria-hidden` picture over a visually-hidden `<table>`, direct end-of-line labels **instead of a
swatch legend**, and dash patterns as a second non-colour channel.

**Therefore every subsection below is written as: "what an inline-SVG implementation must match."**
Where the Chart.js contract conflicts with our accessibility contract, the conflict is flagged —
it is not a defect in this document, it is a decision the phase has to make.

### 2.1 Chart.js globals (lines 1489–1496)

```js
Chart.defaults.color        = '#5A6E8A';          // == --text-3
Chart.defaults.font.family  = "'Sora', sans-serif";
Chart.defaults.font.size    = 11;

function gradientFrom(ctx, c1, c2){
  const g = ctx.createLinearGradient(0, 0, 0, 300);   // vertical, 0 → 300px, NOT chart-relative
  g.addColorStop(0, c1); g.addColorStop(1, c2); return g;
}
```

**Inline-SVG contract:**
- All chart text — ticks, legend, axis titles — is `#5A6E8A` (`--text-3`), the *dimmest* of three
  text tiers. Chart chrome never competes with the data.
- All chart text is 11 px Sora (10 px where a per-chart override says so). In our system that is
  `--text-2xs`/`--text-xs`; use the existing `T_LABEL`/`T_SMALL` constants that
  `trend-chart.tsx:4` already imports from `@/components/dashboard/dashboard-type`.
- Bar and area gradients are **vertical**, top → bottom, over a **fixed 300 px span** regardless of
  the canvas height. Since the tallest chart is 220 px, every gradient in the demo is effectively
  *truncated* — the bottom stop is never fully reached. In SVG use
  `<linearGradient x1="0" y1="0" x2="0" y2="1">` with `gradientUnits="objectBoundingBox"`, and
  accept the visual difference, or replicate exactly with `gradientUnits="userSpaceOnUse"`
  `y1="0" y2="300"`.

### 2.2 The shared visual contract (identical across all nine charts)

| Element | Value | Inline-SVG equivalent |
|---|---|---|
| Grid lines | `rgba(255,255,255,0.04)` | `<line stroke="rgba(255,255,255,0.04)" stroke-width="1">`. **4 % white.** Essentially subliminal. Do not substitute `--border`. |
| Grid suppression | `grid:{display:false}` on the *category* axis of 4 charts | omit those lines entirely |
| Tick / legend / title colour | `#5A6E8A` | `fill="var(--text-3)"` equivalent |
| Font | Sora 11 px (10 px on 4 charts) | as above |
| Tooltip background | `#1A2740` (= `--surface-2`) | our tooltip surface token |
| Tooltip border | `1px solid #263850` (= `--border-2`) | ditto |
| Legend swatch | `boxWidth: 10` (or `8` on the compact charts) | **see §2.4 — we do not ship swatch legends** |
| Axis borders | never configured → Chart.js default border drawn in `Chart.defaults.color` | draw the axis line at `--text-3` or omit |
| Currency formatting | `'$' + v.toLocaleString()` on money axes, `'$' + v` on small-magnitude axes | same rule: thousands separators above 1 000, bare below |
| Responsive | `responsive: true, maintainAspectRatio: false` on **all nine** | SVG with `preserveAspectRatio="none"` on the plot, or re-layout at breakpoints |
| Height | set by the wrapper, never the chart: `<div class="chart-container" style="height:NNNpx">` | fixed-height container, `viewBox` scales into it |

### 2.3 The nine charts, in full

Canvas heights come from the markup wrapper (`.chart-container`, line 511).

---

#### 1. `revenueChart` — Revenue vs Budget, week (script 1500–1512; canvas line 689, height **200 px**)

Type: `bar` **with a `line` dataset layered over it** (mixed chart).

```js
labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']

// dataset 0 — bars
{ label:'Revenue', data:[3820,4240,3980,4680,5120,6240,5840],
  backgroundColor: gradientFrom(ctx,'rgba(232,160,69,0.8)','rgba(232,160,69,0.3)'),
  borderRadius: 6, order: 2 }

// dataset 1 — the budget line, drawn ON TOP (lower `order` = drawn later/above)
{ label:'Budget', data:[4000,4000,4000,4000,5000,5500,5500], type:'line',
  borderColor:'rgba(45,212,191,0.6)', borderWidth:2, pointRadius:0,
  fill:false, tension:0.4, order:1 }

options: {
  responsive:true, maintainAspectRatio:false,
  plugins:{
    legend:{ display:true, labels:{ color:'#5A6E8A', font:{size:11}, boxWidth:10 } },
    tooltip:{ backgroundColor:'#1A2740', borderColor:'#263850', borderWidth:1,
              callbacks:{ label: ctx => '$' + ctx.raw.toLocaleString() } }
  },
  scales:{
    x:{ grid:{ color:'rgba(255,255,255,0.04)' } },
    y:{ grid:{ color:'rgba(255,255,255,0.04)' },
        ticks:{ callback: v => '$' + v.toLocaleString() } }
  }
}
```

**Inline-SVG must match:** amber bars with a **top-to-bottom alpha fade 0.8 → 0.3** (the fill gets
*lighter toward the baseline* — the opposite of the usual "solid bottom" instinct);
**`borderRadius: 6` = rounded top corners only** (Chart.js rounds the far end of the bar, not all
four corners — in SVG this is a path with two rounded top corners, not `<rect rx="6">`);
a 2 px teal reference line at 60 % alpha with **no point markers** and **`tension: 0.4`**
(Chart.js cubic monotone-ish smoothing — in SVG, a Catmull-Rom/cardinal spline, *not* a polyline);
the line renders **above** the bars.

---

#### 2. `categoryChart` — Sales by category donut (script 1513–1515; canvas line 771, height **160 px**)

```js
type:'doughnut'
labels:['Mains','Beverages','Starters','Desserts']
datasets:[{ data:[42,24,18,16],
            backgroundColor:['#E8A045','#2DD4BF','#60A5FA','#A78BFA'],
            borderWidth:0, hoverOffset:4 }]
options:{ responsive:true, maintainAspectRatio:false, cutout:'72%',
          plugins:{ legend:{ display:false },
                    tooltip:{ backgroundColor:'#1A2740', borderColor:'#263850', borderWidth:1 } } }
```

**Inline-SVG must match:** **`cutout: '72%'`** — a very thin ring; the arc band is only 14 % of the
radius each side. `borderWidth: 0` — **no separator strokes between segments**, adjacent hues meet
directly. `hoverOffset: 4` — the hovered segment translates 4 px radially outward along its own
mid-angle. Legend is **off**; the numbers live in adjacent markup, which is exactly the
direct-labelling posture `trend-chart.tsx` already argues for.
Implement as `<circle>` with `stroke-dasharray`/`stroke-dashoffset` (thin ring = stroke, not
`<path>` arcs), `stroke-width` = 28 % of diameter.

---

#### 3. `forecastChart` — Demand forecast, 2 series (script 1517–1523; canvas line 875, height **150 px**)

```js
type:'line'
labels:['Today','Tue','Wed','Thu','Fri','Sat','Sun']
{ label:'Chicken (kg)', data:[8.2,7.8,9.1,10.4,9.8,12.2,11.6],
  borderColor:'#E8A045', backgroundColor:'rgba(232,160,69,0.1)',
  fill:true, tension:0.4, borderWidth:2, pointRadius:3 }
{ label:'Salmon (kg)',  data:[3.2,4.1,4.4,3.8,5.2,6.8,6.2],
  borderColor:'#2DD4BF', backgroundColor:'rgba(45,212,191,0.08)',
  fill:true, tension:0.4, borderWidth:2, pointRadius:3 }
options: legend labels 10 px / boxWidth 8; tooltip as shared;
         x and y grid both 'rgba(255,255,255,0.04)'
```

**Inline-SVG must match:** two **flat-alpha area fills** (0.10 and 0.08 — note they differ; the
amber is deliberately 25 % denser), **not** gradients. 2 px stroke, 3 px radius dots on **every**
point. `tension: 0.4` smoothing. Areas overlap with no blend mode, so the lower series shows
through the upper.

---

#### 4. `wasteChart` — Daily wastage (script 1524–1526; canvas line 883, height **120 px**)

```js
type:'bar'
labels:['Mon'..'Sun']
{ label:'Waste $', data:[42,38,54,28,22,18,12],
  backgroundColor:'rgba(248,113,113,0.7)', borderRadius:4 }
options:{ plugins:{ legend:{display:false},
                    tooltip:{…, callbacks:{ label: ctx => '$' + ctx.raw } } },
          scales:{ x:{ grid:{ display:false } },
                   y:{ grid:{ color:'rgba(255,255,255,0.04)' },
                       ticks:{ callback: v => '$' + v } } } }
```

**Inline-SVG must match:** **flat** red at 0.7 alpha (no gradient — the gradient is reserved for
the *positive* metrics), `borderRadius: 4`, **x-axis grid removed entirely**, `$` without thousands
separators (values are two-digit).

---

#### 5. `labourChart` — Labour % vs budget (script 1528–1530; canvas line 1013, height **140 px**)

```js
type:'line'
labels:['W10','W11','W12','W13','W14','W15']
{ label:'Labour %', data:[21.4,20.8,19.6,18.9,18.4,18.2],
  borderColor:'#A78BFA', backgroundColor:'rgba(167,139,250,0.1)',
  fill:true, tension:0.4, borderWidth:2, pointRadius:3 }
{ label:'Budget %',  data:[20,20,20,20,20,20],
  borderColor:'rgba(255,255,255,0.2)', borderDash:[4,4],
  borderWidth:1.5, pointRadius:0, fill:false }
options:{ …, scales:{ x:{ grid:{display:false} },
                      y:{ grid:{color:'rgba(255,255,255,0.04)'}, min:16, max:24 } } }
```

**Inline-SVG must match:** the **reference-line idiom** — `borderDash: [4,4]`, `borderWidth: 1.5`,
`rgba(255,255,255,0.2)`, no points, no fill. That is the demo's standard for "a threshold, not a
series", and it is the same non-colour channel `trend-chart.tsx` already uses for CVD safety.
**Hard-clamped y-axis `min: 16, max: 24`** — the only chart in the demo that does not auto-scale.
It exists to make an 18.2 % vs 20 % gap legible; an SVG implementation must accept an explicit
domain override, not always compute `max` from the data (contrast
`trend-chart.tsx:78` `const max = Math.max(1, ...allValues)`).

---

#### 6. `vendorChart` — Vendor spend (script 1532–1534; canvas line 1076, height **140 px**)

```js
type:'bar', indexAxis:'y'                                  // HORIZONTAL bars
labels:['Ocean\nFresh','Green\nGardens','Prime\nDairy','Grain\nMasters','SpiceRoute']
{ label:'Monthly $', data:[3240,1840,1220,880,460],
  backgroundColor:['#E8A045','#2DD4BF','#60A5FA','#A78BFA','#F87171'],  // per-bar colour
  borderRadius:5 }
options:{ plugins:{ legend:{display:false}, tooltip:{…, label: ctx=>'$'+ctx.raw.toLocaleString() } },
          scales:{ x:{ grid:{color:'rgba(255,255,255,0.04)'}, ticks:{ callback:v=>'$'+v } },
                   y:{ grid:{ display:false } } } }
```

**Inline-SVG must match:** horizontal bars, `borderRadius: 5` on the **right** end only, **one
colour per category** cycling the full five-hue palette in fixed order
(amber → teal → blue → purple → red), value-axis grid on, category-axis grid off.
Note the `\n` in labels — Chart.js renders a literal two-line tick label. In SVG that is
`<tspan dy>`, and it must be handled explicitly or long vendor names will overflow the gutter.

> **Contract conflict to resolve:** colouring five bars five different hues carries **no
> information** — the category is already on the axis. Our UI-SPEC §3.4 position (quoted in
> `trend-chart.tsx:36-47`) is that a five-colour categorical palette is not CVD-safe by colour
> alone. Here that is harmless (colour is redundant, not load-bearing), but replicating it means
> shipping a rainbow. Recommend: single-hue bars with the top bar accented, or a sequential ramp.

---

#### 7. `loyaltyChart` — Loyalty tiers donut (script 1536–1538; canvas line 1115, height **160 px**)

```js
type:'doughnut'
labels:['Gold (184)','Silver (528)','Bronze (1130)']
datasets:[{ data:[10,29,61], backgroundColor:['#D4AF37','#B0B4C8','#CD7F32'],
            borderWidth:0, hoverOffset:4 }]
options:{ cutout:'68%',
          plugins:{ legend:{ position:'bottom',
                             labels:{ color:'#5A6E8A', font:{size:10}, boxWidth:10 } },
                    tooltip:{ …, callbacks:{ label: ctx => ctx.label + ' — ' + ctx.raw + '%' } } } }
```

**Inline-SVG must match:** `cutout: '68%'` (a touch thicker than the category donut — the two
donuts are *not* the same ring weight). The **only chart with a visible legend at
`position: 'bottom'`**. Metal palette is hard-coded outside the token set —
`#D4AF37` / `#B0B4C8` / `#CD7F32`, matching `.tier-gold` / `.tier-silver` / `.tier-bronze`
(CSS lines 483–485). **The count is baked into the label string** (`'Gold (184)'`) while the datum
is a percentage — the tooltip prints `label — raw%`, so the reader gets both absolute and relative
from one string. Reproduce that: an SVG donut legend row should read `Gold (184) · 10%`.

---

#### 8. `revCOGSChart` — Revenue vs COGS, 14 days (script 1540–1546; canvas line 1151, height **220 px** — the largest)

```js
type:'line'
labels:['1'..'14']
{ label:'Revenue', data:[4820,5240,3980,4680,5120,6240,5840,5420,4980,5640,6120,6840,5960,4218],
  borderColor:'#2DD4BF', backgroundColor:'rgba(45,212,191,0.08)',
  fill:true, tension:0.4, borderWidth:2, pointRadius:2 }
{ label:'COGS',    data:[1370,1490,1130,1330,1455,1773,1659,1540,1415,1602,1740,1945,1692,1198],
  borderColor:'#F87171', backgroundColor:'rgba(248,113,113,0.06)',
  fill:true, tension:0.4, borderWidth:2, pointRadius:2 }
options:{ plugins:{ legend:{ labels:{ color:'#5A6E8A', font:{size:11}, boxWidth:10 } },
                    tooltip:{ …, label: ctx=>'$'+ctx.raw.toLocaleString() } },
          scales:{ x:{ grid:{color:'rgba(255,255,255,0.04)'},
                       title:{ display:true, text:'April (Day)', color:'#5A6E8A' } },
                   y:{ grid:{color:'rgba(255,255,255,0.04)'},
                       ticks:{ callback:v=>'$'+v.toLocaleString() } } } }
```

**Inline-SVG must match:** `pointRadius` drops to **2** at 14 points (vs 3 at 6–7 points) — the dot
size scales *down* as density rises. Fill alphas drop to 0.08 / 0.06 for the same reason. The only
chart with an **axis title** (`'April (Day)'`, `#5A6E8A`). Two series on one shared scale, revenue
~3.5× COGS — a single y-axis, **never a dual axis** (the same argument as `trend-chart.tsx:74-76`).

---

#### 9. `hourlyChart` — Revenue by hour (script 1547–1552; canvas line 1167, height **160 px**)

```js
type:'bar'
labels:['10','11','12','13','14','15','16','17','18','19','20','21']
{ label:'Revenue', data:[120,240,580,640,420,280,320,480,820,960,840,560],
  backgroundColor: gradientFrom(ctx,'rgba(232,160,69,0.8)','rgba(232,160,69,0.2)'),
  borderRadius:4 }
options:{ plugins:{ legend:{display:false}, tooltip:{…, label: ctx=>'$'+ctx.raw } },
          scales:{ x:{ grid:{display:false}, title:{display:true, text:'Hour', color:'#5A6E8A'} },
                   y:{ grid:{color:'rgba(255,255,255,0.04)'}, ticks:{ callback:v=>'$'+v } } } }
```

**Inline-SVG must match:** same amber gradient as `revenueChart` but fading to **0.2** instead of
0.3 (12 bars vs 7 → thinner bars → more fade), `borderRadius: 4` (vs 6 on the wider bars —
**corner radius tracks bar width**), x grid off, `'Hour'` axis title.

### 2.4 Where the demo's chart contract must be overridden, not copied

| Demo does | We must do | Authority |
|---|---|---|
| Chart.js via CDN `<script>` (line 8) | inline SVG | `dependency-budget.test.ts` "no package was added to dependencies"; phase 21 `added: []` |
| Swatch legends (`boxWidth: 10/8`) on 4 charts | direct end-of-line labels + dash patterns | `trend-chart.tsx:36-52` — "a legend that says ▪ Net sales ▪ Orders … is a chart ~8% of men cannot read at all" |
| Canvas — invisible to assistive tech | `aria-hidden` SVG over a visually-hidden `<table>` of every point | `trend-chart.tsx:62-66` |
| Colour as the only series channel | colour **+** dash pattern (`dash?: string` on `TrendSeries`) | `trend-chart.tsx:14-18`, UI-SPEC §3.4 |
| Hard-coded hex (`#E8A045`, `#2DD4BF`, `#60A5FA`, `#A78BFA`, `#F87171`) | `--chart-1`..`--chart-5` (`globals.css:397-401` light, `685-689` dark) | our tokens are OKLCH and theme-aware; the demo's are dark-only |
| Dark-only palette | every chart colour, grid line and tooltip needs a light-theme value | the demo has **no** light theme — `grep -ni "theme"` → 0 hits |
| Hover tooltip only | keyboard-reachable data | our a11y contract |

`rgba(255,255,255,0.04)` grid lines in particular **cannot** be ported literally: on our light
background they are invisible. Express as a token that resolves to ~4 % of the foreground in each
theme.

---

## Part 3 — Theme-switch animation (circular reveal / wipe)

### 3.0 Headline: the capability is already installed. No new dependency, no custom code.

`frontend/package.json:27` → `"@teispace/next-themes": "^2.0.3"` — a **fork** of `next-themes`,
and it ships View Transitions support built in. Measured in the installed dist:

`…/@teispace/next-themes/dist/use-theme-effect-7ftP60lS.d.ts:155-160`

> ```
> /**
>  * Animate theme changes with the View Transitions API. Pass `true` for the
>  * default fade, `'circular'` for a cursor-origin circular reveal, or a
>  * config object for fine-grained control. Gracefully no-ops in browsers
>  * that do not support View Transitions.
>  */
> transition?: TransitionConfig;
> ```

`…/dist/types-Cm_0mzdd.d.ts:28-56`:

```ts
type TransitionType   = 'fade' | 'circular' | 'none';
type TransitionOrigin = 'cursor' | 'center' | { x: number; y: number };
interface TransitionOptions {
  type?: TransitionType;      // default 'fade'
  duration?: number;          // default 250 (ms)
  easing?: string;            // default 'ease'
  origin?: TransitionOrigin;  // default 'cursor'
  css?: string;               // overrides the built-in type CSS
}
type TransitionConfig = boolean | TransitionType | TransitionOptions;
interface SetThemeOptions { transition?: TransitionConfig; }   // per-call override
```

**This is precisely the "sun popping in the centre" the product owner asked for**, and it is one
prop. The custom `document.startViewTransition` implementation documented in §3.2 below is the
fallback plan if we ever leave this fork — it is *not* what we should write now.

### 3.1 What the fork actually emits (decompiled from `dist/chunk-RQE5PXXM.js`)

The circular CSS it injects (`function We(origin, duration, easing)`):

```css
::view-transition-old(root) { animation: none; z-index: 1; mix-blend-mode: normal; }
::view-transition-new(root) {
  animation: teispace-theme-reveal ${duration}ms ${easing} both;
  z-index: 2;
  mix-blend-mode: normal;
}
@keyframes teispace-theme-reveal {
  from { clip-path: circle(0 at ${x}px ${y}px); }
  to   { clip-path: circle(150vmax at ${x}px ${y}px); }
}
```

The fade variant (`function Je`):

```css
::view-transition-old(root),
::view-transition-new(root) { animation-duration: ${duration}ms; animation-timing-function: ${easing}; }
```

The driver (`function ue`):

```js
if (typeof document.startViewTransition !== 'function') { applyTheme(); return; }   // ← fallback
const style = document.createElement('style');
style.setAttribute('data-teispace-vt', '');
style.appendChild(document.createTextNode(css));
document.head.appendChild(style);
const vt = document.startViewTransition(() => { applyTheme(); });
vt?.finished?.then(cleanup, cleanup) ?? setTimeout(cleanup, duration + 50);
```

Verified behaviours, each of which we would otherwise have had to build:

1. **Cursor origin is captured globally.** On provider mount the fork registers
   `document.addEventListener('pointerdown', e => { origin = {x: e.clientX, y: e.clientY} },
   { capture: true, passive: true })` (`function Ke`/`Vt`, invoked from the provider's
   `useEffect` in `dist/client.js`). The circle therefore originates **at the toggle button the
   user just pressed**, with **zero changes to `theme-toggle.tsx`** — no ref, no
   `getBoundingClientRect()`, no coordinate plumbing.
2. **`prefers-reduced-motion` is honoured by default.** `function de(config, respectReducedMotion)`
   returns `null` — i.e. the theme applies instantly with no view transition at all — when
   `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
   `respectReducedMotion` defaults to `true`
   (`use-theme-effect-7ftP60lS.d.ts:122`: *"If true, `disableTransitionOnChange` is a no-op when
   user prefers reduced motion. Default: `true`"*), and the same flag gates the view transition.
   This is **removal, not shortening** — exactly the posture `globals.css:1094-1106` argues for.
3. **No conflict with our existing `disableTransitionOnChange`.** In `function D(state, inVT)`, the
   transition-killing stylesheet is injected only when `!inVT && disableTransitionOnChange`. When a
   view transition is running, `inVT` is `true`, so the `*{transition:none!important}` sheet is
   **skipped**. The two features are already reconciled inside the library.
4. **`150vmax`** is the end radius — large enough that a circle originating in any corner still
   covers the viewport.
5. Non-supporting browsers: `applyTheme()` runs directly. Instant swap, no error, no flash of a
   half-drawn circle.

### 3.2 View Transitions API — browser support as of 2026, and the hand-rolled version

Support (verified via web search, August 2026):

| Browser | Same-document `document.startViewTransition()` | Cross-document (`@view-transition`) |
|---|---|---|
| Chrome / Edge / Opera | **111+** — shipped | 126+ desktop & Android |
| Safari | **18+** — shipped | 18.2+ macOS & iOS |
| Firefox | **133+** — shipped | still behind a flag; treat as progressive enhancement |

**Same-document is what a theme toggle needs**, and it is available in all three engines. This is
the deciding fact: the effect is no longer a Chrome-only flourish. Firefox's remaining gap is
cross-document (MPA) transitions, which a theme toggle does not use.

The hand-rolled equivalent, for the record (what we would write if we dropped the fork):

```css
/* globals.css — the browser's default cross-fade must be cancelled, or it
   fights the clip-path and you get a double-image. */
::view-transition-old(root),
::view-transition-new(root) { animation: none; mix-blend-mode: normal; }
::view-transition-old(root) { z-index: 1; }
::view-transition-new(root) { z-index: 2; }

::view-transition-new(root) {
  animation: theme-reveal var(--motion-reveal, 620ms) var(--motion-reveal-ease) both;
}
@keyframes theme-reveal {
  from { clip-path: circle(0      at var(--theme-x, 50%) var(--theme-y, 50%)); }
  to   { clip-path: circle(150vmax at var(--theme-x, 50%) var(--theme-y, 50%)); }
}
```

```ts
function toggleThemeWithReveal(next: Theme, event: React.MouseEvent<HTMLButtonElement>) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const supported = typeof document.startViewTransition === 'function';

  if (reduced || !supported) { setTheme(next); return; }        // ← both fallbacks, same path

  const rect = event.currentTarget.getBoundingClientRect();
  document.documentElement.style.setProperty('--theme-x', `${rect.left + rect.width / 2}px`);
  document.documentElement.style.setProperty('--theme-y', `${rect.top + rect.height / 2}px`);

  document.startViewTransition(() => { flushSync(() => setTheme(next)); });
}
```

Three details that bite if hand-rolled and that the fork already handles:
- `startViewTransition`'s callback must apply the DOM change **synchronously**; with React state
  that means `flushSync`, or the snapshot is taken before the class lands and nothing animates.
- The default UA cross-fade on `::view-transition-old/new(root)` must be explicitly cancelled.
- **`position: fixed` elements** (our `TopBar`, the mobile bottom nav) are captured into the root
  snapshot and will appear frozen for the duration. At 250–620 ms nobody notices; at >1 s it reads
  as a hang. Keep the duration short.

**Top-to-bottom wipe variant** (the product owner's alternative), same machinery:

```css
@keyframes theme-wipe {
  from { clip-path: inset(0 0 100% 0); }
  to   { clip-path: inset(0 0 0    0); }
}
```
Via the fork this needs no keyframe of ours at all — pass
`transition={{ type: 'circular', css: '<the above>' }}`, since `css` overrides the built-in type.

### 3.3 Exactly where this attaches in our codebase

Files inspected:

| File | Relevant content | Change needed |
|---|---|---|
| `frontend/components/providers/theme-provider.tsx` | wraps `NextThemesProvider` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`, then `{...props}` | **This is the attach point.** Add `transition="circular"` (or the options object) as a prop on `NextThemesProvider`. One line. |
| `frontend/components/providers/app-providers.tsx:20` | `<ThemeProvider>` is the outermost provider, wrapping Intl → Query → Session | no change (or pass the config here if we want it caller-controlled) |
| `frontend/components/ui/theme-toggle.tsx:64-68` | `handleClick()` → `setTheme(nextThemeInCycle(theme))`; the button carries `transition-colors hover:bg-accent` | **no change required** — the fork's global capture-phase `pointerdown` listener already has the click coordinates. Only touch this if we want a per-call override: `setTheme(next, { transition: 'circular' })`. |
| `frontend/components/shared/top-bar.tsx:251` | `<ThemeToggle />` — the only mount point in the app shell | no change |
| `frontend/components/shared/top-bar.tsx:318-330` | command palette "Toggle theme" calls the **same** `setTheme(nextThemeInCycle(theme))` (GA-092 fixed it to agree with the button) | **Watch this.** With `origin: 'cursor'`, a palette toggle originates the circle wherever the user last pressed — which may be the ⌘K trigger, or nowhere if they used the keyboard. If we want the palette path to reveal from centre, pass `setTheme(next, { transition: { type: 'circular', origin: 'center' } })` there. Two controls with the same name must move the theme the same way; that principle (documented at `theme-toggle.tsx:10-17`) now extends to *how it looks*. |
| `frontend/lib/theme/` | `glass-surfaces.ts`, `palette-generator.ts`, `wcag-validator.ts` | **Nothing here is involved.** This directory is the token/contrast layer — the glass-surface manifest, the OKLCH scale generator, the WCAG checker. It contains no runtime theme-switching code. Verified: `grep -rn "startViewTransition\|view-transition" frontend/app frontend/components frontend/lib` → **0 hits**. The feature is currently absent from the codebase entirely. |
| `frontend/app/globals.css:1094-1150` | the `prefers-reduced-motion` block | **No change strictly required** — the fork suppresses the transition before any CSS is injected. But add an explicit note there, otherwise a future reader sees a motion feature with no entry in the block that is supposed to enumerate all of them. |

**Recommended concrete change (one file, one prop):**

```tsx
// frontend/components/providers/theme-provider.tsx
<NextThemesProvider
  attribute="class"
  defaultTheme="system"
  enableSystem
  disableTransitionOnChange
  transition={{ type: 'circular', duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', origin: 'cursor' }}
  {...props}
>
```

`420 ms` / `cubic-bezier(0.16, 1, 0.3, 1)` are `--motion-entrance` and `--motion-entrance-ease`
from `globals.css:576-577` — reusing our own ladder rather than the library's `250ms ease`
default. (The prop takes a literal string, not `var()`, since it is injected into a detached
stylesheet; keep the two in sync by comment.)

### 3.4 Risks to check during implementation

1. **`disableTransitionOnChange` + `transition` together.** Verified compatible in the dist
   (§3.1.3), but assert it: if the `*{transition:none}` sheet ever *did* land during the view
   transition, the reveal would still animate (it is an animation, not a transition) while
   everything inside froze — a subtle, easy-to-miss wrongness.
2. **Keyboard activation has no pointer coordinates.** `origin: 'cursor'` falls back to the last
   recorded `pointerdown`, or viewport centre if there has never been one. A keyboard-only user
   tabbing to the toggle and pressing Enter gets a circle from wherever they last clicked. If that
   matters, pass explicit `{x, y}` derived from the button's `getBoundingClientRect()`.
3. **`system` is in the cycle.** `nextThemeInCycle` is light → dark → **system**
   (`theme-toggle.tsx:20-23`). Switching *to* `system` when the OS already matches the current
   resolved theme produces a full circular reveal with **no visible colour change** — an
   animation that appears to do nothing. Consider skipping the transition when
   `resolvedTheme` is unchanged.
4. **Charts must survive the snapshot.** Inline SVG is part of the root snapshot and reveals
   cleanly. Any `<canvas>` would too — but this is another argument for SVG: SVG re-paints from
   tokens on the new side of the reveal automatically; a canvas needs an explicit redraw.
5. **Reduced-motion test coverage.** `reduced-motion.spec.ts` is referenced at
   `globals.css:1102-1106` and asserts resting state, not just stillness. A theme reveal needs the
   equivalent assertion: with reduced motion on, the class flips and the paint is instant.

---

## The five things to carry forward

1. **Hover = 150 ms, entrance = 250 ms, lift = exactly `translateY(-1px)`, border-colour is the
   signal.** That is the demo's entire motion language, and it is smaller than ours already is.
2. **The demo's `prefers-reduced-motion` rule is worse than ours** — it leaves the infinite
   `.live-dot` pulse looping at 0.01 ms. Ours (`globals.css:1094-1150`) removes decorative
   families outright. Do not port line 53.
3. **Every chart number in Part 2 is a dark-only value.** The demo has no light theme at all
   (`grep -ni "theme"` → 0 hits). `rgba(255,255,255,0.04)` grid lines have to become a token.
4. **Chart.js is not available to us** (`dependency-budget.test.ts` baseline assertion), and the
   inline-SVG replacement already exists and already argues its own case:
   `frontend/components/dashboard/portlets/trend-chart.tsx`. Copy the *visual* contract
   (72 %/68 % donut cutouts, top-fading gradients, `tension: 0.4`, `[4,4]` reference dashes,
   radius-tracks-bar-width) and **reject** the swatch legends.
5. **The circular theme reveal needs no new code and no new dependency.**
   `@teispace/next-themes@2.0.3` already implements `transition="circular"` with cursor origin,
   `clip-path: circle(0 → 150vmax)`, automatic `prefers-reduced-motion` suppression, and a silent
   no-op on unsupported browsers. It attaches at
   `frontend/components/providers/theme-provider.tsx` as one prop.
   The feature is currently absent — `grep -rn "startViewTransition\|view-transition"` over
   `frontend/app`, `frontend/components`, `frontend/lib` returns **0 hits**.
