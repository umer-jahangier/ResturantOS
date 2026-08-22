# Phase 38 — Demo-calibration decisions (D-38-11 … D-38-17)

> **Status:** locked, 2026-08-21. Given by the product owner in session, against
> `Docs/NEXUS_ERP_Demo.html` (committed on this branch — it was untracked before).
>
> These decisions **amend** `38-CONTEXT.md` D-38-01 and phase 20's D-UI-01. Where this file and an
> earlier decision disagree, **this file wins and the earlier decision is superseded in place, by
> name.** Nothing here is implied, inferred, or "obviously what was meant" — the failure mode this
> file exists to prevent is a later reader restoring an old value because the reason for changing
> it lived somewhere they did not look.

---

## D-38-11 — The identity is the demo's, re-derived in OKLCH. Never transplanted as hex.

The product owner chose the demo's gold/teal identity **and** chose that it be authored through the
existing OKLCH pipeline rather than pasted. Both halves are binding.

`design-tokens.test.ts:307` asserts no token block contains a hard-coded hex, and the demo is
**100 % hex/rgba** — `grep -c 'oklch(' Docs/NEXUS_ERP_Demo.html` → **0**. So every demo colour is
converted before use. The conversions are recorded in
`demo-calibration/OKLCH-MEASUREMENTS.md` and reproduce with the repo's own `colorjs.io@0.6.1`.

**A hue move alone does not produce gold.** The chroma column in `globals.css:318-328` was
gamut-clamped for hue 195. Re-pointed to hue 69 unchanged, those same chromas use only 65–78 % of
the sRGB boundary and render **`#e1aa6a` — tan, not gold.**

> **Therefore hue and chroma are ONE edit, in one commit.** Anyone who sets `--brand-h: 69`, sees
> tan, and raises chroma in a follow-up has re-recorded the drift gate twice — the second time by a
> person who has already learned to treat those numbers as noise. That is how a ratchet is lost.

---

## D-38-12 — Three independent hue axes. This retires the "one number" claim, deliberately.

**This is the load-bearing decision and it costs us something. Stating the cost.**

`globals.css:9-11` advertises the system's premise: *"change `--brand-h` and the primary ramp, the
neutral ramp, the sequential ramp, `--chart-1`, the diverging midpoint and every KDS surface all
move with it."* `design-tokens.test.ts:274-323` **enforces** it — all 13 `--neutral-*` stops must
contain `var(--brand-h)`.

Measured, the demo does not work that way:

| | demo hue | demo chroma |
|---|---|---|
| accent (gold) | **69** | 0.135 |
| secondary (teal) | **182** | 0.133 |
| surfaces, borders, text tiers | **256–270** (cool blue-black) | **0.028–0.052** |

The warm accent standing on a cool ground is a large part of why the demo reads as expensive. Our
neutrals carry the brand hue at chroma ≤ 0.010. Set `--brand-h: 69` under the current contract and
the surfaces turn **warm brown-grey** — not the demo's blue steel.

**There is no option that keeps both the demo's look and the one-number claim.** Option (a) was
warm neutrals: keeps the contract, loses the tension, does not deliver what was asked for.

**Decision: option (b).** Three axes:

```css
--brand-h:   69;   /* gold  — primary accent            */
--accent-h: 182;   /* teal  — secondary accent (literal) */
--neutral-h: 260;  /* cool blue-black — surfaces, borders, text tiers */
```

Consequences, accepted knowingly:
1. The docblock at `globals.css:9-11` is **rewritten**, not left to lie. The system now regenerates
   from **three** numbers, and the file must say so.
2. The D-UI-01 assertion at `design-tokens.test.ts:274-323` is **edited deliberately**, with this
   decision cited by name in its docblock — so the next reader finds the reason at the assertion.
3. Neutral chroma rises from ≤ 0.010 to ≈ 0.03. The ground is *visibly blue*. That is intended.
4. The secondary ramp uses a **literal** hue — a second brand hue cannot follow the first.
   **It must not be named `teal` in a utility:** `conformance-scan.ts:93-94` counts
   `bg-teal-\d{2,3}` as a raw-palette offender. Name it `secondary`.

---

## D-38-13 — Two demo values are accessibility failures and are NOT adopted.

**Recorded here, with the measured ratios, precisely so nobody later "restores" them by comparing
against the demo and reading our divergence as drift.** It is not drift. It is the fix.

Measured with `colorjs.io`, WCAG 2.1, against the demo's own surfaces:

| Demo pairing | Measured | Verdict |
|---|---|---|
| `--text` on `--bg` | 17.81:1 | AA ✅ |
| `--text-2` on `--bg` | 7.64:1 | AA ✅ |
| gold on `--bg` / on `--surface` | 8.91:1 / 7.61:1 | AA ✅ |
| teal on `--surface` | 8.99:1 | AA ✅ |
| green / blue / red / purple on `--surface` | 9.60 / 6.58 / 6.05 / 6.15 | AA ✅ |
| `--bg` label on a gold button | 8.91:1 | AA ✅ |
| **`--text-3` `#5A6E8A` on `--surface`** | **3.21:1** | **FAILS AA for body text** |
| **1 px `--border` `#1F2E45` on `--bg-2`** | **1.36:1** | **FAILS SC 1.4.11 (3:1 for UI components)** |

The demo's accent set is genuinely accessible — most of it transfers untouched, which is the good
news. Two things do not:

1. **`--text-3`.** The demo uses it for nav-group labels, timestamps and metadata — i.e. real,
   read-for-meaning text at 3.21:1. Our `--foreground-tertiary` is **lifted to L 0.62**, or
   restricted by written contract to incidental copy. It is not set to `#5A6E8A`.
   *(Solved, not estimated: against the lightest dark card `--neutral-900` — the binding case, not
   the deepest background — the minimum L reaching 4.5:1 is **0.6095**. 0.62 carries the margin.
   An earlier draft of this file said "≈ 0.60"; that value measures **4.34:1** and would have
   shipped the very failure this decision exists to prevent.)*
2. **Hairline borders.** 1.36:1 is legal for *decoration*. Where a border is the only thing marking
   an input's boundary it must reach 3:1. **Cards keep the demo's hairline; form controls do not.**
   `design-tokens.test.ts:175-207` already asserts `--border-interactive ≥ 3:1` in both themes and
   `--input === --border-interactive`. Both stay true after the retint.

   Solved values, so the split is concrete rather than aspirational:

   | | value | ratio | role |
   |---|---|---|---|
   | card hairline (dark) | `--neutral-800` on `--neutral-900` | **1.26:1** | decorative — and this is the demo's look reproduced (its own hairline measures 1.22:1) |
   | `--border-interactive` (dark) | L **0.52** | **3.03:1** vs `--neutral-900` | binding: min solved L is 0.5135 |
   | `--border-interactive` (light) | L **0.65** | **3.01:1** vs `--neutral-50` | binding: max solved L is 0.6578 |

   So the demo's hairline aesthetic survives on cards *and* inputs become conformant. The two were
   never in conflict; they were the same token doing two jobs.

**Also inside this decision:** teal(182) sits ΔE2000 **18.68** from `--success-600`(149.6) — the
closest pair in the entire semantic set (for scale, `--success` vs `--info` is 40.86). A teal accent
beside a green success badge is the one pairing a user will misread. The secondary hue is pushed
away from success, **or** the secondary is forbidden from ever carrying state meaning. A ΔE2000
separation assertion is added and watched failing at hue 165 before it is trusted.

---

## D-38-14 — Light and dark both remain first-class. The switch animates.

The demo is **dark-only** — `grep -c 'prefers-color-scheme\|data-theme'` → **0**. We do not follow
it there. Dark becomes the flagship look; light stays fully supported and fully gated. Print,
receipts and the KDS depend on it.

The theme switch gets the reveal the owner asked for. It costs **zero new dependencies**:
`@teispace/next-themes@2.0.3` is already installed and already ships it — verified in
`node_modules/@teispace/next-themes/dist/types-Cm_0mzdd.d.ts:28-51`:

```ts
type TransitionType   = 'fade' | 'circular' | 'none';
type TransitionOrigin = 'cursor' | 'center' | { x: number; y: number };
```

One prop on `components/providers/theme-provider.tsx`:

```ts
transition={{ type: 'circular', duration: 420,
              easing: 'cubic-bezier(0.16,1,0.3,1)', origin: 'center' }}
```

`origin: 'center'` is the owner's "sun popping in the centre of the screen". The fork already
suppresses under `prefers-reduced-motion` **by removal, not shortening**, already reconciles
`disableTransitionOnChange`, and no-ops silently where View Transitions are unsupported.
`theme-toggle.tsx` needs no change. `startViewTransition` appears **0 times** in the codebase today.

**The gate this must pass, and why it is not optional.** `::view-transition-*` pseudo-elements
create their own stacking and containment context while running, and `receipt-print.css:180-187`
depends on `position: fixed`. G6 (containing-block/print safety) and G7 (rendered-PDF check) are
re-run on `app/pos/**` before this ships. A theme animation that prints the sidebar onto a
customer's bill is not a nice touch.

The command palette's "Toggle theme" (`top-bar.tsx:318-330`) passes `origin: 'center'` explicitly —
with `'cursor'`, a keyboard-driven toggle reveals from wherever the user last clicked, which reads
as a glitch.

---

## D-38-15 — The demo is a POSITIVE reference for four things and a NEGATIVE reference for four others.

Calibration means knowing which is which. Measured across all 1,562 lines:

**Adopt:** its colour/weight/spacing rhythm; its POS layout ideas (full-width `1fr 340px`,
`auto-fill minmax()` tiles, an availability channel on the tile); its back-office grammar (title +
`·`-separated stat subtitle, 4-up KPI row, `2fr 1fr` split, card-header strip with inline search);
its money/identifier formatting (mono identifiers, accent money, accounting parentheses).

**Do NOT calibrate against it for:**

| Dimension | Measured in the demo | Verdict |
|---|---|---|
| **KDS** | 11 screens, **none is a kitchen board** | Anything "from the demo" for the KDS is an **invention** and must be labelled as such in its plan |
| **Responsive** | **one** `@media` rule in 1,562 lines, and it is `prefers-reduced-motion`. Fixed 240 px sidebar, `grid-4` that never collapses, 26–38 px controls | We are strictly ahead. Negative reference |
| **Accessibility** | `0` `aria-*`, `0` `<h1>`, `0` `focus-visible`, `outline:none` on inputs with no replacement, `<div onclick>` for every interactive row | Nothing to adopt |
| **States** | **no loading, empty, error or disabled state anywhere** — all data hardcoded | Contributes nothing |

**And one line of the demo is forbidden outright.** `Docs/NEXUS_ERP_Demo.html:189` puts
`animation: fadeIn 0.25s ease` on `.screen` — which includes `#screen-pos` — with a keyframe
carrying `transform: translateY(6px)`. Copying it is simultaneously (a) a forbidden entrance
animation on the `operational` zone under D-38-04, (b) a running animation against a gate that
measures **0** today, and (c) a `transform` on an ancestor of `.receipt-root`, which prints the
sidebar onto a customer's bill. Six lines of CSS, two gates broken.

---

## D-38-16 — A number we cannot compute is rendered as an absence, never as a figure.

**Seventeen** of the demo's headline numbers have no honest source in this system. The most
beautiful panel in the file — the Menu Margin Ranking — is a *ranking built entirely on a column
that is NULL for every row*.

Named, with the reason:
- **Food Cost % (28.4 %)** — no aggregate food-cost figure exists. Only a per-recipe preview
  (`RecipeCostPreviewService.java:158-167`), null whenever the item has no price.
- **COGS (MTD), Net Income (MTD), Net Margin, and the entire Revenue-vs-COGS chart** — rest on
  `sales_item_facts.cogs_paisa` / `.gross_margin_paisa`, Phase-8-deferred **NULLs**.

This codebase already carries **three** independent guards against exactly this defect class:
`ReportCatalog.java:74-80` (the `countIf(... IS NOT NULL) = 0 → NULL` guard), `ReportTable.tsx:22-34`,
and `owner-dashboard.tsx:52-65`, which hardcodes `value="—"` for gross margin with the reason
stated at `:179`.

**Those affordances are preserved and now gated. They are not restyled away.** A redesign that
paints the demo's P&L card is re-introducing a defect this project has already paid for once.
`KpiTile`'s `unavailableReason` is the sanctioned rendering.

Note also that the demo is not internally consistent and must not be treated as an oracle: its
payroll reads `$22,400` against a P&L labour line of `$12,460`, and its shift coverage sums to 12
against a stated "On Shift Now: 11".

---

## D-38-17 — The ratchet is re-armed before module work, not after.

Phase 38 is restarting on **four RED conformance gates**: G1 type-scale **1,118** vs a cap of 961;
G2 **139** vs 137; G3 **145** vs 142; G4 **44** vs 43. Every one of the 17 offending files was born
*after* the baseline was recorded, during the post-audit S0 repair drive. Nobody ran the gates.

The gates were this phase's central mechanism. Restarting on a defeated ratchet means the mechanism
is already gone. **Re-baselining is wave 0**, each cap re-asserted with its negative control
observed red — not a chore deferred to 38-17.

Owed in the same wave, because both are records that are currently false:
- `ROADMAP.md:1055` cites commit **`0e3fb0f8` for 38-02, which does not exist in this repository**
  (`git rev-parse` → unknown revision). The real commit is **`829f3a56`**.
- `38-04-SUMMARY.md` and `38-05-SUMMARY.md` were never written. Wave 3's only written record is two
  JSON files and three ROADMAP bullets. The ROADMAP also reports 38-02 COMPLETE when `FilterBar`,
  its own task 4, **was never built** (`grep -rn FilterBar frontend` → 0 lines).
