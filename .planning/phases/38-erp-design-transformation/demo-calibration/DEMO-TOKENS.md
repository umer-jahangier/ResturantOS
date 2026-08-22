# DEMO-TOKENS — Complete design language of `Docs/NEXUS_ERP_Demo.html`

Source: `/Users/muhammadumer/Documents/Projects/ResturantOS/Docs/NEXUS_ERP_Demo.html` (1562 lines).
`<style>` block spans **lines 9–517**. `:root` token block is **lines 13–52**. Body markup starts line 519.

Every value below was read out of the file; every usage count below is a literal `grep -o "var(--NAME)" | wc -l`
over the whole file (declaration line excluded from meaning, included in the raw string count only where noted).
Where something is **absent**, the proving command is given.

---

## 1. CSS custom properties — all 39, grouped, with measured usage

Usage counts come from:
`grep -o -- "var(--NAME)" Docs/NEXUS_ERP_Demo.html | wc -l`

### 1a. Backgrounds / surfaces — a 6-step near-black ladder

| Token | Value | Line | `var()` uses | What it is actually used for (line numbers) |
|---|---|---|---|---|
| `--bg` | `#080C12` | 14 | 10 | App ground (`body` 57) **and, inverted, as ink on gold/teal fills**: `.logo-mark` text 94, `.nav-badge.gold` 131, `.avatar-sm` 141, `.btn-primary` 273, `.btn-teal` 277, `.cat-btn.active` 371, `.pay-btn.cash` 416, `.table-chip.active` 426, `.staff-avatar` 457 |
| `--bg-2` | `#0D1320` | 15 | 3 | Chrome only: `.sidebar` 70, `.topbar` 152, `.notif-dot` ring 173 |
| `--bg-3` | `#111827` | 16 | 26 | Recessed/inset wells: table `th` 287, `.tabs` track 304, `.input` 314, `.menu-item-card` 375, `.ticket-header` 390, plus 18 inline report tiles (1057–1305) |
| `--surface` | `#141E2E` | 17 | 11 | Raised card plane: `.card` 201, `.kpi-card` 216, `.pos-right` 362, `.staff-card` 452, `.topbar-btn` 165, `.tab.active` 309, `.cat-btn` 367, `.table-chip` 424, and hover states 113/276/379 |
| `--surface-2` | `#1A2740` | 18 | 5 | Row hover 293, progress track 300, `.qty-btn` 397, `.pay-btn.card` 418, `.pay-btn.hold` 420. **Also hardcoded as the Chart.js tooltip background `#1A2740`** (1509, 1514, 1520, 1525, 1529, 1533, 1537, 1543, 1550) |
| `--surface-3` | `#1E2E48` | 19 | 2 | Highest plane, only 2 uses: `.qty-btn:hover` 398 and `.toast` 501 |

Measured separation between adjacent planes is deliberately tiny — `--bg-2` on `--bg` is **1.06:1**,
`--surface` on `--bg-2` is **1.11:1** (WCAG contrast, computed). The planes are *felt*, not seen.

### 1b. Borders — two hairlines, both sub-1.5:1

| Token | Value | Line | uses | Used for |
|---|---|---|---|---|
| `--border` | `#1F2E45` | 20 | **63** (highest of any token) | The default 1px hairline on every card, table row, topbar, sidebar, input, chip |
| `--border-2` | `#263850` | 21 | 9 | *Hover-only* border lift: 169, 223, 276, 370, 427; plus `.fin-stat-row.total` 444, `.staff-card:hover` 456, scrollbar thumb 493, `.toast` 501 |

Contrast measured: `--border` on `--surface` = **1.22:1**; `--border-2` on `--surface` = **1.41:1**.
`1px solid` appears **68 times** (`grep -o "1px solid" | wc -l`). There is no 2px border anywhere.

### 1c. Accent — primary gold

| Token | Value | Line | uses | Used for |
|---|---|---|---|---|
| `--primary` | `#E8A045` | 22 | 38 | Active nav text+rail (115, 122), `.btn-primary` 273, `.input:focus` 318, `.cat-btn.active` 371, menu price 383, ticket price 400, summary total 409, `.table-chip` 425–426, low-stock dot 434, kpi top bleed 227 |
| `--primary-dim` | `#C4822E` | 23 | **1** | Only the `.logo-mark` gradient terminus (92) |
| `--primary-glow` | `rgba(232,160,69,0.15)` | 24 | **0 — DEAD** | `grep -c "var(--primary-glow)"` → 0 |
| `--primary-soft` | `rgba(232,160,69,0.08)` | 25 | 9 | Tinted active/selected fills: `.nav-item.active` 116, `.kpi-icon.gold` 239, `.badge.gold` 261, `.table-chip.occupied` 425, + inline 745, 876, 1021, 1047, 1189 |

Two literal gold values escape the token system: `#F0AE56` (hover-brighten on `.btn-primary` 274 and
`.pay-btn.cash` 417) and `#E8C045` (progress-fill gradient terminus, 1157).

### 1d. Teal (secondary)

| Token | Value | Line | uses | Used for |
|---|---|---|---|---|
| `--teal` | `#2DD4BF` | 26 | 18 | `.btn-teal` 277, `.pay-btn.card:hover` 419, `.fin-stat-row.total .fin-stat-value` 446, `.sidebar::after` gradient 81, `.avatar-sm` gradient 139, kpi bleed 228 |
| `--teal-dim` | `#0D9488` | 27 | **0 — DEAD** as a var; the literal `#0D9488` *is* used in inline avatar gradients (1002, 1290) |
| `--teal-soft` | `rgba(45,212,191,0.08)` | 28 | 2 | `.kpi-icon.teal` 240, `.badge.teal` 263 |

### 1e–1i. Semantic hues — identical 3-part shape per hue

Every hue follows the same contract: **solid → `-soft` at exactly 0.08 alpha → a hand-written 0.2-alpha border**.

| Hue | Solid | Soft | Decl lines | Solid uses | Soft uses | 0.2 border literal |
|---|---|---|---|---|---|---|
| blue | `#60A5FA` | `rgba(96,165,250,0.08)` | 29–30 | 8 | 3 | `rgba(96,165,250,0.2)` — 262 |
| red | `#F87171` | `rgba(248,113,113,0.08)` | 31–32 | 12 | 4 | `rgba(248,113,113,0.2)` — 260 |
| green | `#4ADE80` | `rgba(74,222,128,0.08)` | 33–34 | 27 | 8 | `rgba(74,222,128,0.2)` — 177, 259 |
| purple | `#A78BFA` | `rgba(167,139,250,0.08)` | 35–36 | 10 | 2 | `rgba(167,139,250,0.2)` — *(none; purple has no bordered badge)* |
| gold | `#E8A045` | `rgba(232,160,69,0.08)` | 22–25 | 38 | 9 | `rgba(232,160,69,0.2)` — 261 |
| teal | `#2DD4BF` | `rgba(45,212,191,0.08)` | 26–28 | 18 | 2 | `rgba(45,212,191,0.2)` — 263 |

Each hue drives exactly three component skins: `.kpi-card.X::before` (2px top gradient, 227–232),
`.kpi-icon.X` (36px soft-tinted tile, 239–244), `.badge.X` (pill, 259–263).
There is a 7th, un-tokenised "gray" badge at 264 using `rgba(255,255,255,0.04)`.

Out-of-token loyalty metals, lines 475–477: gold `#D4AF37` @ `rgba(212,175,55,0.15)` bg / `0.3` border;
silver `#B0B4C8` @ `rgba(180,180,200,0.15)` / `0.25`; bronze `#CD7F32` @ `rgba(176,112,60,0.15)` / `0.25`.
Note these use **0.15** fills, not 0.08 — metals are pushed one notch louder than semantic hues.

### 1f. Text tiers — 3 only

| Token | Value | Line | uses | Role | Measured contrast on `--surface` |
|---|---|---|---|---|---|
| `--text` | `#F0F4FF` | 37 | 25 | Primary/emphasis. Blue-tinted white, not `#fff` | **15.21:1** |
| `--text-2` | `#94A3B8` | 38 | 17 | Body/default table cell (290), nav resting (110) | **6.53:1** |
| `--text-3` | `#5A6E8A` | 39 | 18 | Labels, captions, uppercase eyebrows, placeholders (319), scrollbar hover (494) | **3.21:1** |

`--text-3` `#5A6E8A` is also hardcoded as the **Chart.js global tick color** (`Chart.defaults.color='#5A6E8A'`, line 1489)
and repeated inline in 8 chart legend/axis configs.

### 1g. Fonts

| Token | Value | Line | uses |
|---|---|---|---|
| `--font-display` | `'Fraunces', Georgia, serif` | 40 | 3 |
| `--font-body` | `'Sora', sans-serif` | 41 | 5 |
| `--font-mono` | `'DM Mono', monospace` | 42 | 9 |

Loaded from Google Fonts at line 7:
`Sora:wght@300;400;500;600;700;800` + `DM+Mono:wght@300;400;500` + `Fraunces:ital,wght@0,300;0,600;0,800;1,300`.
The italic Fraunces axis (`1,300`) is requested but **never used** — `grep -n "font-style\|italic"` → no matches.

### 1h. Radii

| Token | Value | Line | uses |
|---|---|---|---|
| `--radius` | `10px` | 43 | **1** (only `.menu-item-card` 375) |
| `--radius-lg` | `16px` | 44 | 4 (`.card` 203, `.kpi-card` 219, `.pos-right` 362, `.staff-card` 452) |
| `--radius-xl` | `22px` | 45 | **0 — DEAD** (`grep -c "var(--radius-xl)"` → 0) |

Most radii are hardcoded (see §3).

### 1i. Transition durations

| Token | Value | Line | uses |
|---|---|---|---|
| `--t-fast` | `150ms ease` | 46 | **12** — the workhorse |
| `--t-med` | `250ms ease` | 47 | **1** (`.sidebar` width, 73) |
| `--t-slow` | `400ms ease` | 48 | **0 — DEAD** |

### 1j. Shadows & glows

| Token | Value | Line | uses |
|---|---|---|---|
| `--shadow` | `0 4px 24px rgba(0,0,0,0.4)` | 49 | **1** (`.kpi-card:hover` 223) |
| `--shadow-lg` | `0 8px 48px rgba(0,0,0,0.6)` | 50 | **1** (`.toast` 505) |
| `--glow-primary` | `0 0 32px rgba(232,160,69,0.2)` | 51 | **0 — DEAD** |

**5 of 39 tokens are dead**: `--primary-glow`, `--teal-dim`, `--radius-xl`, `--t-slow`, `--glow-primary`.
Glows that *do* fire are all written inline (§5).

---

## 2. The type system

### 2a. Root and families

- `html { font-size: 14px }` — **line 56**. Not 16px. Everything downstream inherits a 14px em basis.
- **Zero `rem` units in the file.** `grep -n "rem"` returns only 4 hits, all `classList.remove(` in JS
  (1365, 1366, 1392, 1437). The entire sheet is absolute px.
- `body { font-family: var(--font-body) }` — line 57. Sora is the default for everything, plus explicitly
  re-asserted on `button` (58), `input/select/textarea` (59), `.input` (315), `.pay-btn` (414).

**Display (Fraunces serif) — exactly 3 uses, all "hero numeral or hero word":**
| Selector | Line | Size | Weight |
|---|---|---|---|
| `.logo-mark` | 94 | 16px | **800** |
| `.page-title` | 197 | 26px | 600 |
| `.kpi-value` | 248 | 28px | 600 |

Fraunces never touches body copy. It is reserved for the logo glyph, the one page H1, and the KPI number.

**Mono (DM Mono) — 9 uses, all numerals:**
`.topbar-time` 162 · `.td-mono` 297 · `.font-mono` util 341 · `.menu-item-price` 383 · `.qty-num` 399 ·
`.ticket-price` 400 · `.summary-row .val` 406 · `.fin-stat-value` 443 · `.score-circle` 485.
Every price, quantity, hour count, payroll figure and vendor score is monospaced.

### 2b. Every distinct size, with carrier selector

| px | ≈em @14px root | Weight(s) seen | Carrier selectors (line) |
|---|---|---|---|
| **10** | 0.714 | 400 / 600 | `.logo-sub` 99 (400) · `.nav-group-label` 104 (600) · `.nav-badge` 127 (600) · `.user-role-sm` 145 · `.alert-time` 355 · `.menu-item-avail` 384 |
| **11** | 0.786 | 500 / 600 / 700 | `.avatar-sm` 141 (700) · `.live-pill` 179 (600) · `.kpi-label` 247 (500) · `.kpi-change` 249 (600) · `.badge` 257 (600) · `.data-table th` 286 (600) · `.text-xs` 333 · `.ticket-meta` 392 · `.staff-role` 459 · `.loyalty-tier` 473 (700) |
| **12** | 0.857 | 500 / 600 / 700 | `.user-name-sm` 144 (600) · `.topbar-time` 162 (mono) · `.page-subtitle` 198 · `.card-title` 207 (600) · `.btn-sm` 279 (600) · `.tab` 306 (600) · `.text-sm` 332 · `.alert-text` 353 · `.cat-btn` 366 (600) · `.menu-item-name` 382 (600) · `.ticket-item-name` 395 (500) · `.ticket-price` 400 (600, mono) · `.summary-row` 404 · `.table-chip` 424 (700) |
| **13** | 0.929 | 400 / 500 / 600 / 700 | `.logo-text` 98 (700) · `.nav-item` 110 (**400**) · `.topbar-breadcrumb` 157 · `.btn` 270 (600) · `.data-table td` 290 · `.input` 315 · `.menu-item-price` 383 (700, mono) · `.ticket-title` 391 (700) · `.qty-num` 399 (700, mono) · `.pay-btn` 413 (700) · `.fin-stat-label` 442 · `.staff-name` 458 (600) · `.score-circle` 485 (700, mono) · `.toast` 504 |
| **14** | 1.000 | 700 | `html` root 56 · `.qty-btn` 397 · `.fin-stat-value` 443 (700, mono) · `.fin-stat-row.total .fin-stat-label` 445 (600) · `.staff-avatar` 457 (700) |
| **15** | 1.071 | 700 | `.summary-row.total` 407 |
| **16** | 1.143 | 800 | `.logo-mark` 94 (display) |
| **18** | 1.286 | 700 | `.fin-stat-row.total .fin-stat-value` 446 (mono, teal) |
| **24** | 1.714 | — | `.menu-item-emoji` 381 (line-height 1) |
| **26** | 1.857 | 600 | `.page-title` 197 (display, line-height 1) |
| **28** | 2.000 | 600 | `.kpi-value` 248 (display, line-height 1) |

**Implied scale — two disjoint bands.** There is no ratio. There is a **linear +1px micro-band
10→11→12→13→14→15** carrying 90% of the UI (all 55 `font-size` declarations in the style block resolve to
10/11/12/13/14/15/16/18/24/26/28; counts: 13px×14, 12px×14, 11px×10, 10px×6, 14px×5, one each of 15/16/18/24/26/28),
and a **display band at 26–28px** used exactly twice. Nothing lives between 18px and 24px.
Body default is **13px — one full step *below* the 14px root.** That single decision is the density.

### 2c. Weights

Measured distribution in the style block: `600`×20, `700`×12, `400`×3, `500`×3, `800`×1.
- **600 is the default emphasis** — labels, buttons, badges, tabs, card titles.
- **700** is reserved for numerals and terminal totals (`.qty-num`, `.ticket-title`, `.pay-btn`, `.fin-stat-value`, `.summary-row.total`, `.table-chip`, `.score-circle`, all avatars).
- **400 appears only 3 times**, and one is critical: `.nav-item` resting state is 400 (line 110) — the nav is
  *quiet* until active.
- **800** exists once, on the 34px logo mark (94).

### 2d. Letter-spacing — 4 values, 7 sites (only on small/uppercase text)

| Value | Line | Selector |
|---|---|---|
| `0.12em` | 104 | `.nav-group-label` (10px, uppercase — the widest tracking in the file) |
| `0.08em` | 98 | `.logo-text` (13px/700) |
| `0.08em` | 207 | `.card-title` (12px, uppercase) |
| `0.07em` | 286 | `.data-table th` (11px, uppercase) |
| `0.05em` | 99 | `.logo-sub` (10px) |
| `0.05em` | 179 | `.live-pill` (11px) |
| `0.05em` | 247 | `.kpi-label` (11px) |

Rule: **tracking scales inversely with size, and only below 13px.** Nothing 13px or larger is tracked.
`text-transform: uppercase` appears **exactly 3 times** — 105, 207, 286 — and every one of them is paired
with a letter-spacing and `--text-3`/`--text-2`. Uppercase is never used without tracking.

### 2e. Line-height — declared only 4 times

`1` on `.page-title` (197), `.kpi-value` (248), `.menu-item-emoji` (381); `1.3` on `.menu-item-name` (382).
Everything else runs on browser default. The two display numerals are deliberately crushed to `line-height: 1`.

---

## 3. Spacing / radius / elevation rhythm

### 3a. Spacing — measured recurrence

`gap` values (style block): `6px`×8, `10px`×7, `16px`×6, `4px`×4, `8px`×3, `12px`×3, `5px`×1, `3px`×1, `2px`×1.
`padding` values: 22 distinct declarations, dominated by `10px 0`×4, `6px 14px`×2, `3px 10px`×2, `20px`×2,
`16px`×2, `12px 16px`×2, `12px`×2.
`margin-top/bottom`: `4px`×4, `12px`×2, `6px`, `16px`×2, `24px`×2.

**Implied step scale (2px base):**
`2 · 3 · 4 · 5 · 6 · 8 · 10 · 11 · 12 · 14 · 16 · 20 · 24`

Three tiers are legible:
- **Micro (2–6px):** icon/dot/badge internals, `gap: 4/6`.
- **Component (8–14px):** control padding (`8px 16px` btn 270, `6px 14px` tab 306, `11px 14px` td 290),
  `gap: 10`.
- **Container (16–24px):** `.card` padding 20px (204), `.card-sm` 16px (206), `.content-area` padding 24px (184),
  all grid gaps 16px (209–212), `.page-header` margin-bottom 24px (196).

Odd values (`5px`, `7px`, `11px`, `3px`) are intentional optical corrections, not sloppiness — e.g. table `th`
is `10px 14px` but `td` is `11px 14px` (287 vs 290), giving rows 1px more breathing than the header.

Fixed layout constants: sidebar `240px` (69), topbar `56px` (151), POS ticket rail `340px` (360),
content padding `24px` (184).

### 3b. Radius scale

Hardcoded in the style block: `8px`×7, `20px`×4, `3px`×3, `10px`×3, `7px`×2, `2px`×2, `6px`×1, `5px`×1,
plus `50%`×13 and `--radius-lg: 16px`×4.
In the body markup, inline `border-radius:8px` appears **24 more times**.

**Implied scale:** `2 (spark/scrollbar) · 3 (progress) · 5 (qty-btn) · 6 (btn-sm) · 7 (tab) · 8 (DEFAULT control) ·
10 (--radius, tabs track, toast) · 16 (--radius-lg, cards) · 20 (pill) · 50% (avatar/dot)`.

The load-bearing pair is **8px for every control** and **16px for every card**. The nesting is always
outer-16 / inner-8 — a card at 16px never contains anything rounder than 8px. `.tabs` at 10px containing
`.tab` at 7px (304/306) is the same relationship at smaller scale (Δ3px inner offset).

### 3c. Elevation ladder

Only **two** drop shadows exist in the whole system and each fires once:
1. `--shadow: 0 4px 24px rgba(0,0,0,0.4)` → `.kpi-card:hover` (223), paired with `translateY(-1px)`.
2. `--shadow-lg: 0 8px 48px rgba(0,0,0,0.6)` → `.toast` (505), the only truly floating element.

A third, much tighter one: `.tab.active { box-shadow: 0 1px 4px rgba(0,0,0,0.3) }` (309) — the segmented-control
"lifted pill" trick.

**Elevation is otherwise expressed as background-plane + hairline, not shadow.** Depth ladder:
`--bg` (page) → `--bg-2` (chrome) → `--bg-3` (inset wells) → `--surface` (cards) → `--surface-2` (hover/track)
→ `--surface-3` (toast, top). Hover on a card changes **border color only** (`--border` → `--border-2`) plus a
1px lift — 223, 456.

---

## 4. Motion

### 4a. Tokens & every transition

| Where | Line | Property | Duration / easing |
|---|---|---|---|
| `--t-fast` | 46 | token | `150ms ease` |
| `--t-med` | 47 | token | `250ms ease` |
| `--t-slow` | 48 | token | `400ms ease` — **never used** |
| `.sidebar` | 73 | `width` | `var(--t-med)` — the only 250ms in the file |
| `.nav-item` | 111 | `all` | 150ms |
| `.topbar-btn` | 167 | `all` | 150ms |
| `.kpi-card` | 221 | `all` | 150ms |
| `.btn` | 271 | `all` | 150ms |
| `.tab` | 307 | `all` | 150ms |
| `.input` | 316 | **`border-color` only** | 150ms |
| `.cat-btn` | 368 | `all` | 150ms |
| `.menu-item-card` | 376 | `all` | 150ms |
| `.qty-btn` | 397 | `all` | 150ms |
| `.pay-btn` | 414 | `all` | 150ms |
| `.table-chip` | 424 | `all` | 150ms |
| `.staff-card` | 454 | `all` | 150ms |
| `.progress-fill` | 301 | `width` | `0.8s ease` — deliberately slow, data filling in |
| `.toast` | 507 | `all` | `0.3s ease` |
| inline report tiles | 1213–1267 (12×) | `all` | `0.15s` (hand-written `--t-fast`) |

**Every easing in the file is the CSS keyword `ease`.** No cubic-bezier, no spring, no custom curve —
`grep "cubic-bezier"` → no matches.

### 4b. Animations

| Name | Line | Definition | Applied to |
|---|---|---|---|
| `pulse` | 182 | `0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.5;transform:scale(.8)}` | `.live-dot`, `2s infinite` (181) |
| `fadeIn` | 191 | `opacity 0→1` + `translateY(6px)→0` | `.screen`, `0.25s ease` (189) |

Two animations only. Screen transitions are a **6px rise + fade over 250ms** — short travel, no slide.

### 4c. Transform vocabulary

`translateY(-1px)` on hover — `.kpi-card` 223, `.menu-item-card` 379, `.staff-card` 456.
`.menu-item-card:active { transform: translateY(0) }` (380) — press returns it to rest. The entire hover-lift
system is **one pixel**.

### 4d. Reduced motion — line 53

```css
@media (prefers-reduced-motion: reduce) { *, *::before, *::after {
  animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }
```
Global, covers pseudo-elements, uses `!important`. Note it does **not** reset `animation-iteration-count`,
so `.live-dot`'s infinite pulse still loops (at 0.01ms) — a real, small defect worth fixing when we port it.

---

## 5. Elevation & decoration devices

### 5a. The sidebar gradient edge — lines 77–83
```css
.sidebar::after { position:absolute; top:0; right:0; bottom:0; width:1px;
  background: linear-gradient(180deg, transparent, var(--primary) 40%, var(--teal) 70%, transparent);
  opacity: 0.3; }
```
A **1px-wide, full-height vertical gradient** that fades in from transparent, passes through gold at 40%,
into teal at 70%, and back out — held at 30% opacity, *on top of* the ordinary `border-right: 1px solid
var(--border)` (71). Two stacked hairlines: one structural, one chromatic.

### 5b. The active-nav rail — lines 118–123
```css
.nav-item.active::before { position:absolute; left:0; top:4px; bottom:4px;
  width:3px; border-radius:0 3px 3px 0;
  background: var(--primary); box-shadow: 0 0 8px var(--primary); }
```
3px wide, inset 4px from top and bottom (so it is shorter than the row), rounded on the outer edge only,
and **glowing at full token opacity with an 8px blur**. The row itself simultaneously gets
`background: var(--primary-soft)` (8% gold) and `color: var(--primary)` (116/115), and its SVG goes
`opacity: .8 → 1` (124/125). Four coordinated changes for one state.

### 5c. The KPI top-bleed — lines 224–232
```css
.kpi-card::before { position:absolute; top:0; left:0; right:0; height:2px; }
.kpi-card.gold::before { background: linear-gradient(90deg, var(--primary), transparent); }
```
A 2px bar across the card top that **fades to nothing by the right edge** (`overflow:hidden` on 220 clips it
to the 16px radius). Six hue variants, 227–232.

### 5d. Every glow in the file (`grep -n "box-shadow"` → 10 hits)

| Line | Selector | Glow |
|---|---|---|
| 95 | `.logo-mark` | `0 2px 12px rgba(232,160,69,0.3)` — gold cast under the logo tile |
| 122 | `.nav-item.active::before` | `0 0 8px var(--primary)` |
| 274 | `.btn-primary:hover` | `0 0 20px rgba(232,160,69,0.3)` |
| 417 | `.pay-btn.cash:hover` | `0 0 16px rgba(232,160,69,0.3)` |
| 433 | `.stock-status.ok` | `0 0 6px rgba(74,222,128,0.4)` |
| 434 | `.stock-status.low` | `0 0 6px rgba(232,160,69,0.4)` |
| 435 | `.stock-status.critical` | `0 0 6px rgba(248,113,113,0.4)` |
| 309 | `.tab.active` | `0 1px 4px rgba(0,0,0,0.3)` (drop, not glow) |
| 223 / 505 | kpi hover / toast | `--shadow` / `--shadow-lg` |

Glow blur radius scales with element size: 6px on an 8px status dot, 8px on a 3px rail, 12px on a 34px logo,
16–20px on buttons. Glow alpha is **0.3–0.4**, never higher.

### 5e. Gradients — all 20 (`grep -n "gradient("`)

- Sidebar edge, 180deg (81)
- `.logo-mark` 135deg gold→gold-dim (92)
- `.avatar-sm` 135deg **gold→teal** (139) — the brand's two accents in one 30px circle
- KPI bleeds, 90deg hue→transparent (227–232)
- Inline staff/user avatars, 135deg light→dark of each hue (1001–1005, 1290–1292)
- Inline progress fills, 90deg **hue→adjacent hue** (1156–1159): green→teal, gold→`#E8C045`, teal→blue, purple→blue
- Chart.js canvas gradients via `gradientFrom()` (1495), used at 1506 and 1550: gold `0.8 → 0.3/0.2` alpha ramp

Every decorative gradient is either **135deg (square tiles/circles)** or **90/180deg (bars/edges)**. No radials.

### 5f. `backdrop-filter` — **ABSENT**

`grep -n "backdrop-filter" Docs/NEXUS_ERP_Demo.html` → no matches. There is **no glassmorphism** in this demo.
The premium feel is achieved entirely with opaque planes + hairlines + tiny glows. Worth stating explicitly
because it's the most common wrong instinct when someone is told to "make it look expensive".

### 5g. Other surface details

- **Sub-hairline dividers:** `rgba(255,255,255,0.03)` on `.data-table td` (291), `rgba(255,255,255,0.04)` on
  `.alert-item` (349) and `.fin-stat-row` (440) — *even fainter than `--border`*, so list rows separate without
  the table looking gridded. `rgba(255,255,255,0.04)` also serves as the Chart.js grid-line color (1509, 1520, 1525, 1529, 1533, 1543, 1550).
- **Dashed divider:** `.ticket-divider` `1px dashed var(--border)` at `opacity: 0.5` (402) — a receipt-tear cue in the POS ticket.
- **Scrollbar:** 4px wide, transparent track, `--border-2` thumb at 2px radius, `--text-3` on hover (491–494).
- **Notification dot:** 6px red circle with a **1px `--bg-2` ring** (170–174) so it reads as a cutout, not a sticker.
- `.badge.gray` uses `rgba(255,255,255,0.04)` + `--border` (264) — a neutral that isn't a token.
- Dead CSS: `.sparkline` / `.spark-bar` (515–516) are defined and **never used** —
  `awk 'NR>517' | grep -c "sparkline\|spark-bar"` → 0.

### 5h. Chart styling (lines 1489–1550) — matches the CSS system

`Chart.defaults.color = '#5A6E8A'` (= `--text-3`), `Chart.defaults.font.family = "'Sora', sans-serif"`,
`Chart.defaults.font.size = 11` (1489–1491). Tooltips: bg `#1A2740` (= `--surface-2`), border `#263850`
(= `--border-2`), `borderWidth: 1`. Line series: `borderWidth: 2`, `tension: 0.4`, `pointRadius: 2–3`.
Bars carry `borderRadius: 4–6`. Doughnuts use `cutout: '68%'`/`'72%'` and `borderWidth: 0`.
Chart type ramp = same six hues in the same order: `['#E8A045','#2DD4BF','#60A5FA','#A78BFA']` (1514, 1533).

---

## 6. What makes this demo look expensive — the 7 devices to reproduce

**1. Hairline borders at 1.2:1 contrast, used 68 times.** `--border: #1F2E45` on `--surface: #141E2E` measures
**1.22:1**. Every card, row, chip and input is outlined at a contrast so low the border is felt as an edge
rather than seen as a line — and the *hover* border `--border-2` at **1.41:1** is the entire hover affordance
(169, 223, 276, 370, 427, 456). Cheap UIs use one visible border; this uses two invisible ones. `1px` only —
there is no 2px border anywhere in the file.

**2. Tinted-soft fills at exactly 8% alpha, one per hue.** `--primary-soft`, `--teal-soft`, `--blue-soft`,
`--red-soft`, `--green-soft`, `--purple-soft` are all `rgba(hue, 0.08)` (24–36), and each pairs with a
hand-written `rgba(hue, 0.2)` border on badges (259–263). Selected nav (116), KPI icon tiles (239–244), status
badges and occupied tables (425) all get *color without saturation*. The 0.08/0.2 pair is the single most
repeated ratio in the sheet (8 uses of `0.08`, 12 of `0.2`).

**3. The 3px glowing active-nav rail, inset 4px.** Lines 118–123: `width:3px`, `top:4px; bottom:4px`,
`border-radius: 0 3px 3px 0`, `box-shadow: 0 0 8px var(--primary)`. The inset — the rail being *shorter* than
its row — plus the outer-only rounding plus the glow is three decisions where a cheap implementation makes
zero. It fires simultaneously with the 8% background tint, the gold text, and the icon opacity going .8→1.

**4. Monospaced numerals everywhere money or count appears.** DM Mono is applied at 9 sites (162, 297, 341,
383, 399, 400, 406, 443, 485) covering every price, quantity, hour, payroll figure and vendor score. Columns
of figures align on the digit. This is the single highest-leverage, lowest-effort device on the list — it is
what makes the tables read as a financial product rather than a CRUD app.

**5. A serif display face used exactly 3 times.** Fraunces appears on `.logo-mark` (94, 16px/800),
`.page-title` (197, 26px/600) and `.kpi-value` (248, 28px/600) — and nowhere else. Both large uses run
`line-height: 1`. The restraint is the effect: one serif numeral at 28px on a page of 13px Sora reads as
editorial. Using the serif for anything more would collapse it.

**6. 14px root with 13px body — a whole step of density.** `html { font-size: 14px }` (56) with the working
body/table/button size at 13px (110, 270, 290, 315), labels at 11px and eyebrows at 10px. There is no ratio
scale; there is a linear +1px band from 10 to 15 that carries 90% of the interface, then an empty gap from
18px to 24px, then the display pair. More information per screen at smaller type = enterprise-grade.

**7. Micro-motion: 150ms `ease` and a 1px lift.** One duration token does 12 of the 18 transitions (46);
hover lift is `translateY(-1px)` (223, 379, 456); screen change is a 6px rise over 250ms (189–191). Nothing
travels far and nothing takes long. Paired with the fact that hover changes *border color*, not background,
the whole UI feels responsive without ever feeling animated.

**Bonus device (cheap to copy, high payoff):** the sidebar's 1px gold→teal vertical gradient at 30% opacity
(77–83), stacked on top of the ordinary border. It is the only place the two brand accents meet as a
continuous surface, and it is 6 lines of CSS.

**And the anti-device:** there is **no `backdrop-filter`, no blur, no glass, no radial gradient, and no
custom easing curve** in the entire file (proven by `grep -n "backdrop-filter"` and `grep "cubic-bezier"`
returning nothing). Do not add them while porting.

---

## 7. Porting notes for the Tailwind v4 / OKLCH target

- 5 tokens are dead in the demo and should not be ported as-is: `--primary-glow`, `--teal-dim`,
  `--radius-xl`, `--t-slow`, `--glow-primary` (all `var()` count = 0).
- `--bg` doubles as **ink on accent fills** (9 of its 10 uses, lines 94–457). Any OKLCH port needs a
  `--color-on-accent` alias or the gold buttons will get white text.
- The 0.08 / 0.2 / 0.04 / 0.03 alpha ladder is load-bearing and appears 13+12+8+1 times; in OKLCH these
  become `oklch(from var(--primary) l c h / 0.08)` style relative colors.
- Everything is px on a 14px root and there are zero `rem` in the file. A rem-based port must divide by 14,
  not 16, or every size shifts up ~14%.
- Two hardcoded gold escapes to fold back into tokens: `#F0AE56` (hover-brighten, 274/417) and `#E8C045` (1157).
- The reduced-motion block (53) does not stop `.live-dot`'s infinite pulse; add `animation-iteration-count: 1`.
