# APP SHELL + TOKEN LAYER AUDIT
### Calibrating `Docs/NEXUS_ERP_Demo.html` against the shipped Next.js app

**Scope:** read-only. No source file was modified; no build or dev server was run.
**Date of measurement:** 2026-08-21, branch `phase-13-access-repair`.
**Method:** every number below was produced by reading the file or by running the repo's own
`colorjs.io` + `wcag-validator` algorithm over the *shipped* `app/globals.css`, parsed with the
same routine `__tests__/lib/theme/css-tokens.ts` uses. Commands that produced each figure are
quoted inline. Where something is absent, the command that proves it is quoted.

---

## 0. Executive summary

| Question | Measured answer |
|---|---|
| Can `--brand-h` be moved to gold without breaking WCAG? | **Yes.** Sweeping the shipped stylesheet at `--brand-h: 69` re-measures 58 gated pairings: **0 floor failures**, **34 drift failures**. The a11y gate survives; the *recorded-number* gate does not. |
| Does a hue change alone produce the demo's gold? | **No.** The chroma column was gamut-clamped for hue 195. At hue 69 the same chromas sit at ~65–78 % of the sRGB boundary, so `--primary-400` renders `#e1aa6a`, not the demo's `#E8A045`. The C column must be re-derived too. |
| Is there a secondary ramp to hold teal? | **Absent.** `:root` declares exactly two `--secondary*` tokens (`--secondary`, `--secondary-foreground`), both aliases of the neutral ramp. A teal secondary is a *new ramp*, not a retint. |
| Do the demo's fonts exist in `next/font/google`? | **Yes, all three** — verified against `next/dist/compiled/@next/font/dist/google/font-data.json`. `DM Mono` is **not** variable (weights `300/400/500` only). |
| Can the demo's dark-only identity ship as-is? | **No.** The demo has **0** `prefers-color-scheme` blocks and **0** light-mode selectors; the app ships a three-state `light → dark → system` cycle plus a permanently-dark KDS scope. |
| Does a fixed gold identity collide with the tenant palette feature? | **Yes, partially** — `/api/theme` overrides 13 `--primary-*` declarations at runtime and can repaint the gold with any tenant hex. It does **not** emit `--brand-h`, so neutrals, glass and KDS stay gold-tinted while the primary goes (say) pink. |

---

## 1. Token inventory

### 1.1 File shape — `frontend/app/globals.css` (1,151 lines)

| Lines | Block | Declarations | Role |
|---|---|---|---|
| 1–4 | `@import "tailwindcss"`, `tw-animate-css`, `@custom-variant dark` | — | Tailwind v4 CSS-first entry. There is **no `tailwind.config.*`** — `ls tailwind.config*` → `no matches found`. `postcss.config.mjs` loads `@tailwindcss/postcss` only. |
| 6–20 | Header docblock | — | States the D-UI-01 contract: *"change `--brand-h` and the primary ramp, the neutral ramp, the sequential ramp, `--chart-1`, the diverging midpoint and every KDS surface all move with it."* |
| 22–263 | `@theme inline` | **164** | The Tailwind bridge. |
| 288–305 | `@theme` (not `inline`) | **16** | The eight type roles + their paired line-heights. |
| 307–640 | `:root` | **188** | Light theme + all hue-parameterised ramps + non-colour scales. |
| 642–736 | `.dark` | **64** | Dark overrides only. |
| 740–751 | `[data-surface="kds"]` | **9** | Permanently-dark KDS scope, theme-independent. |
| 766–768 | `main:has([data-page-body])` | — | Deliberately **unlayered** (see §1.7). |
| 770–842 | `@layer base` | — | Global resets, focus outline, tabular numerals, `.touch-target`. |
| 844–1030 | Glass + motion classes | — | Zone-scoped (`[data-zone="expressive"]`). |
| 1032–1151 | Keyframes, `.skeleton`, reduced-motion | — | |

Size: raw **49,677 B**, comments-stripped **23,721 B** → **+6,347 B** over the `bundle-budget.test.ts`
baseline of 17,374 B, against a ceiling of **12,000 B**. **Headroom: 5,653 B** (comments are stripped
before measurement, so documentation is free; only declarations count).

### 1.2 Colour ramps in `:root`

| Group | Stops | Line range | Hue source | Regenerates from `--brand-h`? |
|---|---|---|---|---|
| `--primary-50…950` | 11 | 318–328 | `var(--brand-h)` | **Yes** |
| `--neutral-0…1000` | 13 | 331–343 | `var(--brand-h)` at C ≤ 0.010 | **Yes** |
| `--success-50…950` | 11 | 348–358 | literal `149.6` | No (by contract) |
| `--warning-50…950` | 11 | 360–370 | literal `86` | No |
| `--danger-50…950` | 11 | 372–382 | literal `27.3` | No |
| `--info-50…950` | 11 | 384–394 | literal `237.3` | No |
| `--chart-1…5` | 5 | 397–401 | `chart-1` = `var(--brand-h)`; 2–5 literal (35, 262, 300, 345) | Partially |
| `--seq-1…5` | 5 | 404–408 | `var(--brand-h)` | **Yes** |
| `--div-neg-2…pos-2` | 5 | 413–417 | 27.3 / 27.3 / `var(--brand-h)` / 237.3 / 237.3 | Midpoint only |
| `--kds-*` | 9 | 740–751 | `var(--brand-h)` on 5 of 9 | Partially |

**53 lines** in `globals.css` contain `var(--brand-h)` (`grep -c "var(--brand-h)" app/globals.css`).
**Zero hex literals** exist in any token block — asserted at `design-tokens.test.ts:307`.

### 1.3 The OKLCH generation approach

Every colour is authored `oklch(L C H)` with H = `var(--brand-h)` or an explicit semantic hue.
The header (lines 15–17) states the derivation: *"All L/C pairs below are gamut-mapped into sRGB
(hold L and H, bisect C until in gamut) and were re-derived from the spec's formulae with the
repo's own colorjs.io before being written here."*

The semantic ramps carry their formula verbatim at lines 346–347:

> `L = [.972 .945 .895 .830 .740 base, base−.085, −.170, −.250, −.320, −.400]`
> `C = baseC × [.16 .30 .50 .70 .90 1 .98 .88 .74 .60 .46], then gamut-mapped.`

**Measured — the ramp is clamped to the hue-195 gamut boundary.** Bisecting max in-gamut chroma at
each stop's L:

| Stop | L | C shipped | max C @ hue **195** | max C @ hue **69** | hex @195 | hex @69 |
|---|---|---|---|---|---|---|
| 400 | 0.775 | 0.104 | 0.1322 | 0.1690 | `#57cbca` | `#e1aa6a` |
| 500 | 0.700 | 0.116 | **0.1194** | 0.1526 | `#18b4b5` | `#cd9047` |
| 600 | 0.606 | 0.1034 | **0.1034** | 0.1321 | `#009595` | `#aa7636` |
| 700 | 0.512 | 0.0873 | **0.0874** | 0.1116 | `#007676` | `#875d29` |
| 800 | 0.428 | 0.0730 | **0.0730** | 0.0933 | `#005b5c` | `#69471e` |

At hue 195 stops 600/700/800 sit **exactly on** the sRGB boundary. At hue 69 the identical chromas
use only **65–78 %** of the available boundary. This is the single most consequential finding for
the demo calibration and is expanded in §4.

### 1.4 Non-colour scales in `:root`

| Scale | Line | Values | Bridged into `@theme`? |
|---|---|---|---|
| `--radius` | 479 | `0.5rem` (8px) | Yes — as a `calc()` ladder, `@theme inline` 180–186 (`sm ×0.6`, `md ×0.8`, `lg ×1`, `xl ×1.4`, `2xl ×1.8`, `3xl ×2.2`, `4xl ×2.6`) |
| `--elev-0…3` | 482–485 | 2-layer shadows, chroma 0 | Yes, 189–191 (`--shadow-elev-*`; note **`--elev-0` is NOT bridged**) |
| `--depth-1…3`, `--depth-lift-*`, `--depth-inset` | 542–550 | 2-layer shadows | Yes, 200–204 |
| Glass (10 tokens) | 507–528 | solid / fill / blur / hairline ×2, `--glass-saturate`, `--glass-scrim` | **Partially — see §1.6** |
| Motion (15 tokens) | 552–599 | `instant 0 / fast 120 / base 180 / slow 240 / hover 140 / state 120 / feedback 200 / entrance 420 / reveal 620 / stagger 55 / loading 1600` + 4 easings | **No** — consumed only by `globals.css` rules |
| `--z-base…toast` (9) | 602–610 | `0/10/20/30/40/50/60/70/80` | **No** |
| `--space-xs…3xl` (7) | 617–622 | `4/8/16/24/32/48/64 px` | **No — deliberately, see §1.5** |
| `--text-*-lh` aliases (8) | 632–639 | `var(--text-<role>--line-height)` | N/A — aliases |

### 1.5 What is bridged into `@theme`, and what is withheld — with the reasons quoted

**Bridged (`@theme inline`, 164 declarations, lines 22–263):**
`--color-*` for every role token, every one of the 5 ramps (primary / neutral / success / warning /
danger / info, 13+13+11+11+11+11), `--color-seq-1…5`, `--color-div-*`, `--color-kds-*` (9),
`--color-glass-*-solid` and `--color-glass-*-hairline` (4), `--radius-*` (7), `--shadow-elev-1…3`,
`--shadow-depth-*` (5), `--animate-*` (6), and the three font aliases at lines 26–28.

**Bridged (`@theme`, non-inline, lines 288–305):** the eight type roles and their paired
line-heights. The docblock at 279–284 explains why this one block is not `inline`:

> *"NOT `inline`, deliberately: Tailwind must emit `--text-body` and `--text-body--line-height` as
> real custom properties at `:root`, because `kds-type.ts` and `dashboard-type.ts` read
> `var(--text-body)` directly … Asserted by `__tests__/lib/theme/type-scale.test.ts` against the
> BUILT stylesheet, not against this source — a token that does not survive the build is not a token."*

**Withheld #1 — glass FILL and BLUR (lines 206–211):**

> *"The FILL and BLUR tokens are deliberately NOT bridged. They are only ever consumed by the
> `.glass-*` classes below, inside a feature query and under a zone selector. Exposing
> `bg-glass-panel-fill` as a utility would hand every call site a way to paint a translucent surface
> with no fallback and no zone scoping — which is the whole failure mode D-34-04 and D-34-02 exist
> to prevent, re-introduced through the convenience layer."*

**Withheld #2 — the SPACE scale (lines 220–262).** This is the most important comment in the file:

> *"That shipped `p-md` and `gap-lg` as intended — and silently resized EVERY DIALOG IN THE PRODUCT,
> because in Tailwind v4 the `--spacing-*` namespace is shared by padding/margin/gap AND by the width
> family. `max-w-*`, `w-*` and `min-w-*` resolve a NAMED key from `--spacing-*` in preference to
> `--container-*`. Measured, by compiling this stylesheet:*
> *  `before .max-w-sm { max-width: var(--container-sm) } … 24rem = 384px`*
> *  `after  .max-w-sm { max-width: var(--space-sm)     } …          8px`*
> *… Nothing threw, nothing logged, `tsc` was clean, all 1,127 unit tests passed, and the type-scale
> gate went green. It was found by a person looking at a screen."*

and its generalisation, which governs every proposal in §4:

> *"BRIDGING A TOKEN INTO A TAILWIND NAMESPACE IS A PRODUCT-WIDE CHANGE TO EVERY UTILITY THAT READS
> THAT NAMESPACE, not just the one you had in mind. Check which utility families consume a namespace
> before publishing into it."*

Call sites therefore use Tailwind v4's arbitrary-property shorthand: **40** occurrences of
`p-(--space-*)` / `gap-(--space-*)` etc. across `app/` + `components/`.

**Withheld #3 — the neutral override is a *deliberate* namespace collision (lines 92–94):**

> *"Overrides Tailwind's stock `neutral` palette on purpose: ours carries the brand hue at
> imperceptible chroma so surfaces harmonise. Zero call sites use the stock scale today
> (`grep -c '-neutral-[0-9]'` = 0), so nothing shifts."*

Re-verified today: `grep -rEo '\b(bg|text|border|from|to|via|ring|fill|stroke)-neutral-[0-9]+' app components lib | wc -l` → **0**. The claim still holds.

**Withheld #4 — motion and z-index.** Neither `--motion-*` nor `--z-*` is bridged. No comment
explains this; measured by absence (`grep -n -- "--spacing-\|--z-\|--motion-" app/globals.css`
returns no `@theme` hits). They are consumed only by rules in this file.

> ⚠️ **Documentation drift found.** `globals.css:612–615` says the space steps *"are bridged into
> `@theme` by NAME (`--spacing-md: var(--space-md)`, see the bridge block below), so there is
> exactly one place a value lives."* **That bridge block does not exist** — `grep -n -- "--spacing-"
> app/globals.css` returns only lines 220–247 (the comment explaining why it must not) and 614.
> A second copy of the same stale claim sits in `type-scale.test.ts:36` ("*Removed `--spacing-md`
> from the `@theme inline` block → OBSERVED RED: 'p-md' not generated*"), while that file's own
> `CANDIDATES` list at lines 65–68 correctly uses `p-(--space-*)`. Two comments assert a bridge the
> code deliberately refuses. Harmless today; a booby trap for the next person who reads 612 and
> "restores" the bridge.

### 1.6 The `--brand-h` mechanism

- Declared **once**, `globals.css:313` → `--brand-h: 195;`.
- Asserted single-declaration at `design-tokens.test.ts:284–287`: `expect(rawToken("--brand-h")).toBe("195")`, plus `tokenNames("dark")` and `tokenNames("kds")` must **not** contain it.
- It is a **build-time** knob. `glass-hue-sweep.test.ts:11–34` states this explicitly and proves it by reading the runtime path:

> *"`app/api/theme/route.ts` is the only runtime path that can retint the product, and it emits
> exactly thirteen declarations: `--primary-50 … --primary-950`, `--primary` and
> `--primary-foreground`. It does **not** emit `--brand-h` … Verified by reading the route rather
> than assumed."*

Confirmed by reading `app/api/theme/route.ts:39–57`: 13 `:root` declarations + 2 `.dark` declarations. Nothing else.

### 1.7 Two cascade decisions the shell depends on

- **`main:has([data-page-body]) { padding: 0 }` is unlayered** (766–768). The comment records that inside `@layer base` it had no effect because `<main>` carries `p-4 lg:p-6` from `@layer utilities`, and *"a later cascade layer beats an earlier one REGARDLESS OF SPECIFICITY"* — measured at 1440px as *"`main` padding 24px plus `PageBody` padding 24px, a 48px inset nobody designed."*
- **Focus is an outline, never a ring** (800–822), and the spec's stated reason is *corrected* in the comment: outlines **are** clipped by `overflow:hidden` in Chromium 1228. The two surviving measured reasons are forced-colors mode (box-shadow dropped entirely) and `ring-offset-2 ring-offset-background` punching an opaque `rgb(255 255 255)` band through a `--primary-50` selected row.

---

## 2. The gate: `__tests__/lib/theme/design-tokens.test.ts` (376 lines)

### 2.1 What it asserts

It reads the **shipped** `app/globals.css` via `__tests__/lib/theme/css-tokens.ts` (which brace-matches
`:root`, `.dark`, `[data-surface="kds"]`, strips comments, and resolves `var()` chains to a literal
`oklch(...)`), then re-measures through `lib/theme/wcag-validator.ts`.

| # | Describe block | Line | Assertion |
|---|---|---|---|
| 1 | §3.8 light | 158 | 21 rows × 2 assertions |
| 2 | §3.8 dark | 162 | 20 rows × 2 |
| 3 | §3.8 POS | 166 | 6 rows × 2 |
| 4 | §3.7/§3.8 KDS | 170 | 6 rows × 2 |
| 5 | §3.2 borders | 175 | `--border-interactive` ≥ 3:1 both themes; `--input === --border-interactive`; `--border` ≈ 1.23 light / 1.49 dark (recorded, `toBeCloseTo(…, 1)`) |
| 6 | §5.1 selected row | 209 | `--selected-foreground` on `--selected` ≥ 7:1 both themes; `--selected-border` on `--selected` ≥ 3:1; the naive `--foreground` on `--primary-50` in dark must stay `< 1.1` |
| 7 | §3.4 charts | 245 | all five ≥ 3:1; **min** must equal 3.11 (light) / 3.27 (dark) within 0.02 |
| 8 | §3.5 sequential | 259 | 5 label pairings ≥ 4.5:1 and equal to recorded value within 0.02 |
| 9 | **D-UI-01** | 274 | `--brand-h` is `"195"`; 30 named tokens must contain `var(--brand-h)`; 5 KDS tokens likewise; dark `--chart-1` yes / `--chart-2…5` **must not**; **no hex literal in any token block** |
| 10 | §3.9 role wiring | 324 | 18 light + 14 dark role→stop identities; 44 role tokens must exist in **both** `:root` and `.dark`; 5 solid fills ≥ 4.5:1 against their own foreground in both themes |

**The two assertions per §3.8 row** (lines 148–156) are the crux:

```
1. expect(ratio).toBeGreaterThanOrEqual(FLOOR[level])   // the a11y gate
2. expect(Math.abs(ratio - expected)).toBeLessThanOrEqual(0.02)   // the DRIFT gate
```

The docblock is explicit that assertion 2 *"fails on any token edit at all, including one that
happens to stay above the floor, so the document and the stylesheet cannot silently diverge."*

### 2.2 What breaks if the brand hue becomes gold

I re-ran the exact 58 gated pairings (21 light + 20 dark + 6 POS + 6 KDS + 5 sequential) against the
shipped stylesheet with `--brand-h` forced to 69, using the repo's own luminance algorithm.

```
════ brand-h=195   rows=58   DRIFT=0    FLOOR-FAIL=0
════ brand-h=69    rows=58   DRIFT=34   FLOOR-FAIL=0
```

**Zero floor failures. Thirty-four drift failures.** Accessibility survives a pure hue move to gold;
the recorded numbers do not. Drift by block:

| Block | Rows | Drifted at hue 69 |
|---|---|---|
| §3.8 light (`:41`) | 21 | **11** |
| §3.8 dark (`:78`) | 20 | **9** |
| §3.8 POS (`:120`) | 6 | **5** |
| §3.8 KDS (`:135`) | 6 | **4** |
| §3.5 sequential (`:259`) | 5 | **5** |

The largest single movements (these are the rows that will read as "the design changed", not as
rounding):

| Pairing | 195 | 69 | Δ |
|---|---|---|---|
| `--neutral-1000` on `--primary-400` (dark solid button) | 10.27 | **9.69** | −0.58 |
| `--primary-300` link on dark surface-0 | 13.01 | **12.47** | −0.54 |
| white on `--primary-700` (light solid button) | 5.46 | **5.81** | +0.35 |
| `--primary-800` on `--primary-50` (subtle button) | 7.39 | **7.74** | +0.35 |
| white on `--seq-5` | 5.27 | **5.61** | +0.34 |
| `--primary-950` on `--seq-4` | 4.94 | **4.70** | −0.24 |
| focus ring `--primary-600` on white | 3.67 | **3.93** | +0.26 |
| selected-tile border `--primary-600` on `--primary-50` | 3.44 | **3.67** | +0.23 |

Two rows to watch because they sit closest to their floor after the move:
`--primary-950` on `--seq-4` = **4.70** vs an AA floor of 4.5 (margin 0.20), and
`--neutral-600` on `--neutral-1000` = **3.46** vs an SC 1.4.11 floor of 3 (margin 0.46).

**Charts are unaffected.** The min-ratio assertion at `:254` reads the *minimum* across all five
series, and that minimum is `--chart-4` (light, 3.11) and `--chart-5` (dark, 3.27) — neither is
hue-parameterised. Measured at hue 69: light `[3.72, 5.09, 6.24, 3.11, 8.65]` min **3.11**;
dark `[7.35, 5.49, 4.55, 13.74, 3.27]` min **3.27**. Both still equal the recorded value. ✅

**Glass is unaffected and already proven.** `glass-hue-sweep.test.ts` sweeps all 360° at 5° steps in
both themes and both `backdrop-filter` conditions and asserts the worst case ≥ 4.5:1. Hue 69 is
inside that sweep. No glass change is needed for a gold rebrand. ✅

### 2.3 What must be updated in the test if we go gold

| Location | Change |
|---|---|
| `design-tokens.test.ts:284` | `expect(rawToken("--brand-h")).toBe("195")` → the new hue string |
| `design-tokens.test.ts:41–146` | Re-record **29** of the 53 §3.8 ratios |
| `design-tokens.test.ts:259–270` | Re-record all **5** sequential-ramp ratios |
| `design-tokens.test.ts:249–251` | No change (verified: chart mins hold) |
| `design-tokens.test.ts:275–283` | Add the new `--secondary-*` stops to `HUE_PARAMETERISED` **only if** they are authored against `--brand-h`. A teal secondary is a *second* hue and must therefore be excluded, exactly as `--chart-2…5` are excluded at `:302–305`. |
| `design-tokens.test.ts:325–344` / `345–359` | Add `--secondary` / `--secondary-foreground` role→stop rows and their dark counterparts |
| `design-tokens.test.ts:307–316` | **Do not** introduce a hex anywhere in a token block; this gate fails on `/#[0-9a-fA-F]{3,8}\b/` |
| `UI-SPEC §3.8` | Same 34 numbers, in the document the test mirrors |

---

## 3. The three theme modules

### 3.1 `lib/theme/wcag-validator.ts` (119 lines)

- `wcagContrastCheck(fg, bg)` — WCAG 2.1 relative luminance via `colorjs.io` → sRGB, per-channel clamped to `[0,1]`, ratio rounded to 2 dp. This is the *only* contrast algorithm in the repo.
- `compositeOver(fill, substrate)` — source-over alpha compositing, **in sRGB, not OKLCH**, with the reason recorded at lines 53–60: *"a compositor blends in the space it paints in, not perceptually. Interpolating alpha in OKLCH … 50% white over black would come out around 0.735 per channel instead of 0.5."* Throws if the substrate is translucent (lines 72–78).
- `wcagContrastOverGlass(fg, fill, substrate)` — the composite + check, same return shape.
- `validateTenantColours(primaryHex, fgHex)` — a `≥4.5` boolean for Settings → Appearance. **Measured: it is imported by nothing.** (`grep -rn "validateTenantColours" app components lib` → only its own definition.) The appearance form uses `palette.contrastValid` from `generatePalette` instead.

### 3.2 `lib/theme/palette-generator.ts` (90 lines)

Pure function `generatePalette(primaryHex) → { primary: 11 stops, foreground, background, contrastValid }`.

**This is a different algorithm from the one `globals.css` uses.** It is proportional, not gamut-mapped:

```
50:  L=0.97       C=baseC×0.1      500: L=baseL       C=baseC
100: L=0.93       C=baseC×0.2      600: L=baseL×0.85  C=baseC
200: L=0.87       C=baseC×0.4      700: L=baseL×0.70  C=baseC×0.9
300: L=0.78       C=baseC×0.6      800: L=baseL×0.55  C=baseC×0.8
400: L=0.68       C=baseC×0.8      900: L=baseL×0.40  C=baseC×0.7
                                   950: L=baseL×0.25  C=baseC×0.6
```

Chroma is only `clamp(c, 0, 0.4)` — **no sRGB gamut mapping**. Lightness for 500–950 is a *multiple of
the input's* L, so a light input hex produces a ramp with no dark end. Foreground is picked white-or-black
by AA against stop 500 (lines 70–80). This is the second, weaker colour system in the codebase, and it is
the one a tenant's chosen colour flows through.

### 3.3 `lib/theme/glass-surfaces.ts` (122 lines)

A manifest, not styling: two surfaces (`panel`, `overlay`), each declaring an **exhaustive** substrate
list so the composite is measurable. The argument, quoted from lines 7–22:

> *"Contrast over an ARBITRARY background is not merely hard to measure — it is undefined, and an
> undefined figure cannot satisfy D-34-01. … What this forecloses: glass over a photograph, a
> user-supplied image, or a gradient mesh. Those have no bounded substrate … The prohibition is
> enforced by the fact that there is nowhere to declare them here — not by a code-review note."*

`DECLARED_GLASS_TOKENS` (102–107) and the stylesheet's `--glass-*` declarations must be mutually
exhaustive — a glass token added without a substrate set fails the build.

**Direct relevance to the demo:** the demo uses **21** `linear-gradient(...)` and **2** `glow` shadows,
including `background: linear-gradient(135deg, var(--primary), var(--teal))` on the logo mark and avatar.
Any glass surface placed over a gradient is unrepresentable in this manifest by design.

---

## 4. Change list — re-deriving the demo's gold/teal identity in OKLCH

### 4.0 The demo's palette, measured in OKLCH

`node` + `colorjs.io` over every `:root` hex in `Docs/NEXUS_ERP_Demo.html:14–41`:

| Demo token | Hex | OKLCH |
|---|---|---|
| `--primary` (gold) | `#E8A045` | `oklch(0.7600 0.1353 **69.29**)` |
| `--primary-dim` | `#C4822E` | `oklch(0.6602 0.1258 68.30)` |
| `--teal` | `#2DD4BF` | `oklch(0.7845 0.1325 **181.91**)` |
| `--teal-dim` | `#0D9488` | `oklch(0.6002 0.1038 184.70)` |
| `--green` | `#4ADE80` | `oklch(0.8003 0.1821 151.71)` |
| `--red` | `#F87171` | `oklch(0.7106 0.1661 22.22)` |
| `--blue` | `#60A5FA` | `oklch(0.7137 0.1434 254.62)` |
| `--purple` | `#A78BFA` | `oklch(0.7090 0.1592 293.54)` |
| `--bg` | `#080C12` | `oklch(0.1530 0.0146 257.65)` |
| `--surface` | `#141E2E` | `oklch(0.2338 0.0343 259.55)` |
| `--border` | `#1F2E45` | `oklch(0.2994 0.0467 258.71)` |
| `--text` | `#F0F4FF` | `oklch(0.9673 0.0153 269.99)` |
| `--text-2` | `#94A3B8` | `oklch(0.7107 0.0351 256.79)` |
| `--text-3` | `#5A6E8A` | `oklch(0.5329 0.0503 256.84)` |

**The demo's neutrals do not follow its brand.** They sit at hue **256–270 (blue)** with chroma
**0.0146–0.0503**, while the brand is hue 69. The app's neutrals are `var(--brand-h)` at C ≤ 0.010.
Reproducing the demo's blue-steel surfaces under a gold brand is a **direct violation of D-UI-01** as
the test encodes it (`design-tokens.test.ts:275–290` requires all 13 `--neutral-*` to contain
`var(--brand-h)`). This is the single largest structural conflict between the demo and the token layer.

### 4.1 Ordered change list

| # | File : line | Change | Consequence measured |
|---|---|---|---|
| **1** | `frontend/app/globals.css:313` | `--brand-h: 195` → `--brand-h: 69` (or `85`, see risk R2) | 34 of 58 gated ratios drift; **0** drop below floor |
| **2** | `frontend/app/globals.css:318–328` | Re-derive the **chroma** column at the new hue, gamut-mapped as the header docblock prescribes. Target `--primary-400` ≈ `oklch(0.775 0.150 69)` so it lands near `#E8A045`. Leaving C at 195's clamp yields `#e1aa6a` — a muddy tan, ~78 % of available chroma | Without this, "gold" ships desaturated. All downstream ratios move again → re-record after, not before |
| **3** | `frontend/app/globals.css:434, 658` | `--secondary` / dark `--secondary` currently alias `--neutral-100` / `--neutral-800`. **Only 4 `bg-secondary` + 4 `text-secondary` call sites exist**, so repointing them at a teal ramp is a low-blast-radius change — but it *does* change what "secondary" means product-wide | 8 call sites |
| **4** | `frontend/app/globals.css:~330` (new block) | Add `--secondary-50…950`, 11 stops, hue **182**, gamut-mapped. Author with a **literal** hue, not `var(--brand-h)` — a second brand hue cannot follow the first | +11 declarations ≈ 530 B, well inside the 5,653 B headroom |
| **5** | `frontend/app/globals.css:57–58` + new block in `@theme inline` | Bridge `--color-secondary-50…950`. **Do NOT name it `teal`** — `conformance-scan.ts:93–94` (`RAW_PALETTE`, gate G3) matches `\b(bg|text|border|ring|from|via|to|fill|stroke)-teal-\d{2,3}\b`, so `bg-teal-500` would be counted as a raw-palette offender against `conformance-baseline.json` even though it resolves through the contract | +11 declarations ≈ 550 B |
| **6** | `frontend/app/globals.css:642–698` | Add the dark-mode `--secondary` / `--secondary-foreground` pairing. `design-tokens.test.ts:361–405` requires every role token to be declared in **both** `:root` and `.dark` | Fails loudly if skipped |
| **7** | `frontend/app/globals.css:397` | `--chart-1: oklch(0.62 0.1057 var(--brand-h))` — at hue 69 this collides with `--chart-2` (hue 35): pairwise ΔE2000 falls **26.89 → 20.20**, and chart-1 vs chart-2 becomes the worst pair. Consider retargeting `--chart-1` to the teal secondary instead | Not currently gated; the min-ratio assertion still passes |
| **8** | `__tests__/lib/theme/design-tokens.test.ts:284` | `"195"` → the new hue | Hard string equality |
| **9** | `__tests__/lib/theme/design-tokens.test.ts:41–146, 259–270` | Re-record 34 ratios | Drift gate |
| **10** | `__tests__/lib/theme/design-tokens.test.ts:325–359` | Add `--secondary` role→stop rows, light + dark | New role must be gated like the others |
| **11** | `frontend/app/layout.tsx:2, 6–14, 30` | Fonts — see §4.2 | 3 CSS vars, 1 `className` |
| **12** | `frontend/app/globals.css:26–28` | `--font-heading: var(--font-sans)` → `var(--font-fraunces)`. **8 call sites** already use `font-heading` (`card.tsx:64`, `dialog.tsx:156`, `login-form.tsx:410`, `charge-summary.tsx:451`, `discount-panel.tsx:302`, `void-refund-dialog.tsx:227`, `order-table-detail-drawer.tsx:182`) and would pick up the display face for free | 8 files re-typeset, no code change |
| **13** | `frontend/app/globals.css:479` | Demo uses `--radius: 10px`; app uses `0.5rem` (8px). The comment at 478 records the reason for 8: *"10px eats corner pixels in a 32px row"*. **Recommend: do not change.** The whole 7-step radius ladder is a `calc()` multiple of this one value | 7 derived utilities move |
| **14** | `frontend/app/globals.css:288–305` | Demo runs `html { font-size: 14px }` with sizes 10/11/12/13/26/28px. The app's contract is 11/13/15/16/20/30px with **419** contract-class uses already migrated. **Recommend: keep the contract, not the demo's px values** | 419 call sites |

### 4.2 Fonts — how Geist is wired and what swaps in

Current wiring, `frontend/app/layout.tsx`:

```
:2   import { Geist, Geist_Mono } from "next/font/google";
:6   const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
:11  const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
:30  className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
```

consumed at `globals.css:26–28`:
```
--font-sans:    var(--font-geist-sans);
--font-mono:    var(--font-geist-mono);
--font-heading: var(--font-sans);
```
and applied globally by `@layer base { html { @apply font-sans } }` at `globals.css:796–798`.

**Availability verified** against `node_modules/next/dist/compiled/@next/font/dist/google/font-data.json`:

| Family | Present | Weights | Variable | Extra axes |
|---|---|---|---|---|
| `Fraunces` | ✅ | 100–900 + variable | yes | `SOFT`, `WONK`, `opsz`, `wght` |
| `Sora` | ✅ | 100–800 + variable | yes | `wght` |
| `DM Mono` | ✅ | **300, 400, 500 only** | **no** | — |
| `Geist` / `Geist Mono` | ✅ | 100–900 + variable | yes | `wght` |

**The exact swap** (3 edits, no call-site changes):

```ts
// app/layout.tsx:2
import { Fraunces, Sora, DM_Mono } from "next/font/google";

const sora     = Sora({ variable: "--font-sora", subsets: ["latin"] });
const fraunces = Fraunces({ variable: "--font-fraunces", subsets: ["latin"] });
const dmMono   = DM_Mono({ variable: "--font-dm-mono", subsets: ["latin"],
                           weight: ["300","400","500"] });   // ← REQUIRED: not variable
// :30
className={`${sora.variable} ${fraunces.variable} ${dmMono.variable} h-full antialiased`}
```
```css
/* globals.css:26–28 */
--font-sans:    var(--font-sora);
--font-mono:    var(--font-dm-mono);
--font-heading: var(--font-fraunces);
```

Blast radius: `font-sans` is applied to `html` globally, so **every** text node changes face.
`font-mono` has **92** class uses; `font-heading` has **8**. Omitting `weight` on `DM_Mono` is a
**build-time error**, not a silent fallback — Next requires an explicit weight for non-variable fonts.

### 4.3 The tenant-palette interaction — a fixed gold identity vs per-tenant brand

The full path, read end to end:

1. `app/(tenant)/settings/appearance/page.tsx` → `components/settings/appearance-form.tsx`.
2. The form offers 8 hex presets (`appearance-form.tsx:11–20`) — **Ocean Blue, Emerald, Amber, Coral Red, Violet, Pink, Cyan, Lime** — plus a free hex field. Gold `#E8A045` is not among them; `Amber #f59e0b` is nearest.
3. On save it writes `localStorage["tenant-theme-settings"]` and **nothing else** (`:211`).
4. `app/(tenant)/layout.tsx:25–51` reads that key in a `useEffect` and injects `<link rel="stylesheet" href="/api/theme?brandColor=…">`.
5. `app/api/theme/route.ts:39–57` returns 13 `:root` `--primary-*` declarations + 2 `.dark` declarations, generated by the **proportional, non-gamut-mapped** `generatePalette`.

**Four consequences for a demo-fixed gold identity:**

- **(a) A tenant can repaint the gold and nothing else.** `--brand-h` is not emitted, so `--neutral-*`, `--seq-*`, `--div-mid`, `--kds-*` and every `--glass-*` stay at the build-time hue. A tenant picking Violet gets violet buttons on gold-tinted neutrals and gold heatmaps. This is already true today (teal buttons / teal-tinted neutrals) but is *invisible* at hue 195 because the neutral chroma is ≤ 0.010; it becomes visible the moment the primary and the neutrals disagree by 120°+.
- **(b) The override does not touch a teal secondary.** A gold+teal identity therefore degrades to *tenant-colour* + teal, which may be exactly right — or may be a clash nobody chose. Nothing validates the pair.
- **(c) The two generators disagree.** `route.ts` maps `--primary` ← `palette.primary[500]` and dark `--primary` ← `palette.primary[400]`, whereas `globals.css:432/656` maps `--primary` ← `--primary-700` (light) / `--primary-400` (dark). **A tenant override silently lightens the light-theme primary by two stops.** No test covers this.
- **(d) It is per-browser, not per-tenant.** The form's own notice says so (`appearance-form.tsx:245–249`): *"There is no API to store a restaurant's branding yet, so this is not attached to your account: colleagues, and you on another device, will see the default colours."* Verified upstream in `page.tsx:22–25`: `PUT /api/v1/tenants/:id/theme`, `/api/v1/tenant-profile`, `/api/v1/tenants/{id}/settings` and `/api/v1/settings` all answered 404 through the real gateway.

**Recommendation:** ship gold as the build-time `--brand-h` default and treat the tenant override as
what it measurably is — a local, primary-only tint. If the gold is meant to be a *product* identity
rather than a *default*, the honest move is to remove the injector (`layout.tsx:25–51`) or restrict the
presets, not to hope nobody uses it. Either way, fix (c) first: `route.ts` should emit
`--primary: ${palette.primary[700]}` to match the stylesheet's own role wiring.

---

## 5. The shell — what it is today vs what the demo shows

### 5.1 Structure

| Concern | App | Demo | Delta |
|---|---|---|---|
| Sidebar width | `w-64` (256px) / `w-16` (64px) collapsed — `sidebar.tsx:166` | `240px`, fixed | −16px; **demo has no collapse** (`grep -n "collapsed" Docs/NEXUS_ERP_Demo.html` → no matches) |
| Sidebar surface | `bg-background` + `border-r` — `sidebar.tsx:163` | `--bg-2` (one step *lighter* than page) + gradient hairline `::after` blending primary→teal at 0.3 opacity | Demo differentiates the rail from the canvas; the app does not |
| Top bar height | `h-14` (56px) — `top-bar.tsx:184` | `56px` — demo `:151` | **identical** |
| Top bar surface | `bg-background` + `shadow-elev-1`, opaque **on purpose** | `--bg-2` | Compatible |
| Nav groups | **10** — Overview, Orders, Menu, Finance, Purchasing, People, Reporting, Settings, Tenants, Platform Admin (`sidebar-nav-items.ts`, `navGroups`) | **6** (`grep -c "nav-group-label"` → 6) | App has 4 more sections to place |
| Brand mark | `<ChefHat className="size-6 text-primary">` + tenant name — `sidebar.tsx:180–181` | 34×34 rounded square, `linear-gradient(135deg, primary, primary-dim)`, Fraunces 800 | Demo has a real logo mark |
| Active nav item | `bg-muted text-foreground` — `sidebar.tsx:45` | `color: primary`, `background: primary-soft`, plus a 3px left bar with `box-shadow: 0 0 8px primary` | Demo uses brand accent + glow; app uses neutral fill |
| Mobile bottom nav | 5 items, `fixed bottom-0 h-16 bg-background shadow-elev-2 md:hidden` | absent | Demo is desktop-only |
| Command palette | ⌘K, present (`top-bar.tsx:303–333`) | absent | |
| Theme toggle | 3-state cycle, present | absent | |

### 5.2 The two comments that constrain any shell restyle

`top-bar.tsx:170–183` and `mobile-bottom-nav.tsx:96–105` both refuse translucency, for a measured reason:

> *"This header is a sibling of the page content, so it renders ABOVE the POS terminal and the KDS
> board on every one of those routes — a compositing filter here is a compositing filter on the
> operational zone, forcing a repaint of the screen beneath it on the cheap Android tablet a
> restaurant actually buys. The chrome cannot be richer than the poorest zone it can appear over."*

and `(tenant)/layout.tsx:67–80` sets `ZoneProvider zone="restrained"` for the whole shell on the same
grounds. `__tests__/lib/theme/zone-containment.test.ts` fails on any rule declaring a compositing
filter whose selector is not rooted at `[data-zone="expressive"]`.

**Zone map, measured:**

| Route group | Zone | File : line |
|---|---|---|
| `(tenant)` shell | `restrained` | `app/(tenant)/layout.tsx:81` |
| `(tenant)/app/pos` | `operational` | `app/(tenant)/app/pos/layout.tsx:44` |
| `(tenant)/settings/appearance` | `expressive` | `app/(tenant)/settings/appearance/page.tsx:47` |
| `(platform)` | `expressive` | `app/(platform)/layout.tsx:41` |
| `(auth)` | `expressive` | `app/(auth)/layout.tsx:31` |
| KDS | dark scope, `[data-surface="kds"]` | `globals.css:740` |

The remaining nested layouts (`inventory`, `finance`, `hr`, `purchasing`, `hr/settings`) declare no
zone — they inherit `restrained` and render a `mb-4 flex gap-4 border-b` tab strip.

The demo, by contrast, uses **0** `backdrop-filter` and **21** `linear-gradient` — its richness is
carried by gradients and glows, both of which are cheap to composite and **not** covered by the
zone-containment gate. That is a genuine opportunity: the demo's visual language is largely
importable into `restrained` and even `operational` surfaces without violating D-34-02.

---

## 6. Risks, ranked

### R1 — CRITICAL · The demo's neutrals contradict D-UI-01, and the gate enforces D-UI-01
The demo's surfaces are blue-steel (hue 256–270, C up to 0.0503); the app's neutrals are
`var(--brand-h)` at C ≤ 0.010, and `design-tokens.test.ts:289–291` requires all 13 to contain
`var(--brand-h)`. Reproducing the demo's look means either (a) raising the neutral chroma at the gold
hue — which makes every surface visibly tan, not blue; (b) authoring the neutrals against a *second*
literal hue and deleting them from `HUE_PARAMETERISED`, which retires the one-number claim the whole
file is built around; or (c) accepting warm-grey surfaces and losing the demo's cool contrast against
the gold. **There is no option that keeps both the demo's look and the current contract.** Decide this
before any token is edited — it determines whether this is a retint or a rewrite.

### R2 — HIGH · A pure hue swap does not produce gold, and the fix moves every number twice
The chroma column is clamped to the hue-195 gamut boundary (§1.3). At hue 69 the same values are 22–35 %
short of the boundary and render `#e1aa6a`/`#cd9047` — tan, not gold. Re-deriving C is mandatory, and it
re-moves every ratio a *second* time after the hue move already moved 34 of them. **Sequence the work as
one edit: hue + chroma together, then measure once, then record once.** Two rounds of number-recording
is how a drift gate gets loosened "temporarily".
Secondary consideration: hue **85** keeps the chart-series separation intact (worst pair ΔE2000 stays
26.89, vs **20.20** at hue 69 where `--chart-1` collides with `--chart-2` at hue 35). Hue 69 is the demo's
exact gold; hue 85 is the safer system hue. This is a real trade, not a rounding choice.

### R3 — HIGH · A teal secondary is a new ramp with a new gate surface, and its nearest neighbour is `--success`
Measured: teal at `oklch(0.60 0.1038 182)` vs `--success-600` at `oklch(0.515 0.1421 149.6)` →
**ΔE2000 = 18.68**, the closest pair in the whole semantic set (`--success` vs `--info` = 40.86,
`--info` vs gold primary = 47.20). A teal accent sitting beside a green success badge is the one pairing
a user will misread. Either push the secondary toward 190–195 (away from success, toward the current
brand) or accept that teal must never carry state meaning.
Also: **do not name the bridged utility `teal`.** `conformance-scan.ts:93–94` counts
`bg|text|border|ring|from|via|to|fill|stroke-teal-\d{2,3}` as a raw-palette offender against
`conformance-baseline.json`, exactly as it already would for the deliberately-overridden `neutral` scale.

### R4 — HIGH · The tenant override and the stylesheet map `--primary` to different stops
`route.ts:40` emits `--primary: palette.primary[500]`; `globals.css:432` declares
`--primary: var(--primary-700)`. A tenant who saves *any* colour silently lightens the light-theme
primary by two stops, through a generator that does no sRGB gamut mapping at all
(`palette-generator.ts:60–64` clamps chroma to 0.4 and nothing else). Nothing tests this path.
With a gold default the discrepancy becomes visible, because gold at stop 500 vs stop 700 differ far
more in apparent lightness than teal at the same stops.

### R5 — MEDIUM · Bridging anything new into a Tailwind namespace
The file already carries a first-hand account of what this costs (§1.5, lines 220–262): a
`--spacing-*` bridge collapsed every dialog in the product to 24px while `tsc`, ESLint and 1,127 unit
tests stayed green. Any new bridge — a `--color-secondary-*` ramp, a `--font-*` alias, a radius —
must be checked against **every** utility family that reads that namespace before it is published,
and `sizing-namespace.test.ts` is the pattern to copy: compile the stylesheet and resolve the emitted
value, do not assert against source.

### R6 — MEDIUM · The demo is dark-only; the app is tri-state and has a permanently-dark scope
`grep -c "prefers-color-scheme" Docs/NEXUS_ERP_Demo.html` → **0**; light-mode selectors → **0**.
The app ships `light → dark → system` (`theme-toggle.tsx:9`, `theme-provider.tsx` with
`defaultTheme="system" enableSystem`), 64 `.dark` overrides, and a KDS scope that is dark regardless
of preference. Every demo value must be re-derived for light, and the two rows that are *hardest*
in light are the ones the demo never had to solve: gold-on-white for links and solid buttons.
Measured at hue 69: `--primary-700` on white = **5.81:1** (AA ✅, AAA ✗) and
`--primary-600` focus ring on white = **3.93:1** (SC 1.4.11 ✅). Both pass — but with less margin than
a designer eyeing the demo would assume.

### R7 — MEDIUM · Type scale and radius divergence would undo migrated work
The demo runs `html { font-size: 14px }` with sizes 10/11/12/13/26/28px and `--radius: 10px`.
The app's contract is 11/13/15/16/20/30px with **419** contract-class uses already migrated
(`grep -rEo '\btext-(display|h1|h2|body|small|label|pos|kds)\b' app components | wc -l`), and its
radius comment records why 10 was rejected: *"10 eats corner pixels in a 32px row."* Adopting the
demo's numbers re-typesets 419 migrated call sites and moves all 7 derived radii. **Take the demo's
colour, weight and spacing rhythm; leave the type and radius ladders alone.**

### R8 — LOW · Two comments assert a `--spacing-*` bridge the code deliberately refuses
`globals.css:614` and `type-scale.test.ts:36` both describe the space steps as bridged into `@theme`.
`grep -n -- "--spacing-" app/globals.css` proves no such block exists. Inert today, but it is exactly
the kind of comment that convinces the next reader to "restore" the bug the file spends 43 lines
warning about. Worth a one-line correction while the file is open.

### R9 — LOW · Chart-2 vs chart-3 are already indistinguishable in greyscale
Measured, independent of any change proposed here: greyscale ΔL between `--chart-2` and `--chart-3`
is **0.0021** at every brand hue tested (195, 69, 85). The §3.4 gate only checks contrast against the
page, not inter-series separation, so this passes today and will keep passing. Not caused by the
gold move — recorded so it is not later attributed to it.

---

## 7. Files read (all absolute)

```
/Users/muhammadumer/Documents/Projects/ResturantOS/Docs/NEXUS_ERP_Demo.html
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/globals.css
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/layout.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/(tenant)/layout.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/(platform)/layout.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/(auth)/layout.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/(tenant)/app/{pos,inventory,finance,hr,purchasing,hr/settings}/layout.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/(tenant)/settings/appearance/page.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/app/api/theme/route.ts
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/components/shared/{sidebar.tsx,top-bar.tsx,mobile-bottom-nav.tsx,sidebar-nav-items.ts}
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/components/settings/appearance-form.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/components/platform/platform-shell.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/components/providers/{zone-provider.tsx,theme-provider.tsx}
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/components/ui/theme-toggle.tsx
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/lib/theme/{palette-generator.ts,wcag-validator.ts,glass-surfaces.ts}
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/lib/hooks/use-tenant-brand.ts
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/__tests__/lib/theme/{design-tokens.test.ts,css-tokens.ts,glass-hue-sweep.test.ts,type-scale.test.ts,sizing-namespace.test.ts,bundle-budget.test.ts,conformance.test.ts,conformance-scan.ts,conformance-baseline.json}
/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/{package.json,postcss.config.mjs}
```

No file under `frontend/`, `services/` or `gateway/` was modified. No `git stash` was run. No build or
dev server was started. Measurement scripts were written to the session scratchpad only.
