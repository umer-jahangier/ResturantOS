# Builder brief — RestaurantOS portfolio mockups

You are producing **fake-but-believable product screenshots** of a real multi-tenant
restaurant ERP, for the owner's portfolio gallery. They must look like a shipped
product, not a marketing page and not a wireframe.

## Hard rules

1. **Read `src/01-ai-control-tower.html` first.** It is the reference screen. Match its
   density, tone, and markup idiom. Reuse its classes; do not invent a parallel style.
2. Every screen is `src/NN-name.html` and starts from this skeleton:
   ```html
   <!doctype html><html lang="en"><head><meta charset="utf-8">
   <title>…</title><link rel="stylesheet" href="./base.css">
   <style>/* screen-local layout only */</style></head><body>
   <div id="screen"> …your content… </div>
   <script src="./shell.js"></script>
   <script>shell('<navkey>', ['Bayleaf Group','Clifton, Karachi','<Page>'], '<optional right-side topbar html>');</script>
   </body></html>
   ```
   `shell()` injects the sidebar + topbar and moves `#screen`'s contents into `.content`.
   Valid nav keys: `dashboard pos kds inventory purchasing insights forecast menu nlq
   finance crm hr reports`.
3. **The frame is exactly 1600×1000.** `.content` is a fixed 946px-tall flex column with
   18px padding and 14px gap → **910px of usable height, 1332px usable width**.
   Nothing may exceed it. Grid/flex children need `min-height:0` (and `minmax(0,1fr)`
   for fr rows) or they refuse to shrink — this is the #1 bug in this project.
4. **You must iterate until the guard is clean.** Run `node capture.mjs NN` from
   `portfolio-mockups/`. It prints `✓ file.png` only when nothing overflows or escapes
   the frame. A `!` line lists offenders by name. Do not stop at `!`.
5. **Then actually look at your PNG** with the Read tool (`out/NN-name.png`) and fix what
   reads badly: clipped table columns, colliding labels, dead whitespace, cramped rows,
   text overlapping chart marks. Re-render and re-read until it looks like a real product.
   Budget at least two review passes.

## Design tokens (defined in base.css — use the vars, never raw hex)

Surfaces `--bg #101216` · `--card` · `--elev` · `--hover` · `--sunken`
Ink `--fg` `--fg-mut` `--fg-dim` · Brand `--gold #f0b429` (AI signal only)
Status `--pos` green · `--neg` red · `--warn` · `--info`

**Chart series — fixed order, never cycled, never recoloured by rank:**
`--s1 #c98500` gold · `--s2 #199e70` aqua · `--s3 #3987e5` blue · `--s4 #d55181` magenta ·
`--s5 #9085e9` violet. This order is CVD-validated for *adjacent* pairs.
**Scatter / bubble / heat-cell charts may use only the first three** (all-pairs safe).
Sequential ramp (low→high): `--r1 #7d5306` `--r2` `--r3` `--r4` `--r5 #f0c05f`.

## Chart rules (non-negotiable — these were validated, don't relitigate)

- **Never a dual y-axis.** Two measures of different scale → two charts or index them.
- 2px lines, ≥8px markers, 4px rounded bar ends, 2px surface gap between stacked segments.
- Recessive grid (`.gridline`) and axes (`.axisline`); axis text uses `.axis`.
- ≥2 series ⇒ a `.legend` is always present; ≤4 series may also be direct-labelled.
  A single series needs no legend — the title names it.
- Never a number on every point; label selectively.
- **Include one visible `.tip` tooltip per chart screen** — it proves the hover layer
  exists. Position it so it does not cover the line it describes.
- Status colours are reserved for state; never reuse them as "series 4".
- Text stays in ink tokens; a coloured swatch beside it carries identity.

## Content rules

- Tenant is **Bayleaf Group**, branch **Clifton, Karachi**. Currency **PKR** (`Rs 1,598,400`).
  Date **Fri 22 Jul 2026**, clock around **21:41 PKT**. Staff names are Pakistani.
- Menu items are real Pakistani restaurant fare: Chicken Malai Boti, Beef Nihari,
  Mutton Karahi, Chicken Biryani, Seekh Kebab, Zinger Burger, Chapli Kebab, Haleem.
- **Numbers must survive arithmetic.** Percentages match their bars; totals equal their
  parts; a variance equals actual − theoretical. Reviewers do check.
- **AI output is always specific, quantified, and traceable** — a rupee impact, a
  confidence meter (`.conf`), and a "why" (the evidence it used). Never vague
  ("optimise your menu!"). This is the whole point of the gallery.
- Real engineering vocabulary from the system: `ORDER_CLOSED`, FEFO depletion,
  moving-average cost (MAC), balanced double-entry journal entries, 3-way match,
  RLS tenant isolation, OPA policy, outbox, idempotent consumers, Liquibase.
- No lorem ipsum. No placeholder rectangles. No "Chart goes here".
