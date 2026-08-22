# Phase 38 — TRUE STATE

**Compiled** 2026-08-21 · branch `phase-13-access-repair` (HEAD `cb7a9a74`) · read-only.
**Sources** every file in `.planning/phases/38-erp-design-transformation/` (UI-SPEC 718 lines,
38-AUDIT 698 lines, 38-CONTEXT 138 lines, 17 PLANs, 3 SUMMARYs, `evidence/` incl. all six JSON
probes), `.planning/ROADMAP.md` §Phase 38 (lines 1016–1078), `.planning/STATE.md`,
`.planning/audits/PRODUCT-GAP-REGISTER.md`, and `git log`.

## 0. Method, and the one thing that could not be measured

Every source count below was re-run today with the **audit's own commands**, from
`/Users/muhammadumer/Documents/Projects/ResturantOS/frontend`, over `app/` + `components/`,
`--include='*.tsx'`. Where the audit's number came from a **live browser probe**, it is marked
`NOT RE-MEASURED` — this task forbids starting a dev server, and the audit's own §0 lesson applies:
an instrument that cannot observe the failure mode is not evidence about it. Three figures fall in
that class: *22 Tab presses to `<main>`*, *sub-44px target counts*, and *rendered font-size
histograms*. They can only be recovered by re-running `frontend/e2e/audit-38-a11y.mjs` and
`audit-38.mjs` (both still on disk) against a live stack.

Two counting instruments exist and disagree slightly, on purpose:
- **plain `grep`** — what the audit used;
- **the gate scanner** `frontend/__tests__/lib/theme/conformance-scan.ts`, which strips comments
  first (38-02 changed it, because `DataGrid`'s docblock quotes `<table>` and tripped G4).
Both are reported. The difference is commentary, not code.

---

## 1. Plan-by-plan status, 38-01 … 38-17

All phase-38 work is nine commits, **all ancestors of HEAD**, all made on **2026-08-12 between
01:11 and 02:42 PKT** — a 91-minute window.

| Plan | Wave | Title | Status | Commit evidence | What is actually missing |
|---|---|---|---|---|---|
| **38-01** | 1 | type/space bridge, `PageHeader`, `PageBody` | **EXECUTED** | `0cdcb523` *feat(38-01)* (48 files, +2396/−301) · `db569554` *docs(38-01)* · SUMMARY `status: complete` | 9 screens migrated, not the planned 10 (`/app/hr/attendance` and 3 POS routes deferred). `/app/finance/periods` migration is committed but **never visually verified** — no reachable persona |
| **38-02** | 2 | `DataGrid` + `FilterBar` | **PARTIAL** (ROADMAP says COMPLETE) | `829f3a56` *feat(38-02)* (22 files, +1316/−223) · SUMMARY `status: complete` | **`FilterBar` was never built** (plan task 4, stated in the SUMMARY's own Deviations). No virtualization. Bulk actions supported but wired to zero screens. ⚠️ ROADMAP:1055 cites commit **`0e3fb0f8`, which does not exist in this repository** (`git rev-parse` → *unknown revision*); the real commit is `829f3a56` |
| **38-03** | 2 | one `StatusBadge`, one `ConfirmDialog`, form contract | **PARTIAL** | `d95cd934` *feat(38-03)* · `214a9bcc` *docs* · SUMMARY `status: partial` — 2 of 7 tasks done | **`StatusBadge` consolidation not started** (6 implementations untouched). Required-field indication not built. `/app/hr/attendance` labelling not done. `void-refund-dialog` reassigned to 38-04 |
| **38-04** | 3 | POS terminal / operator shell | **PARTIAL** | `38a61be2` *feat(38-04,38-05)* · `verify-38-wave3-{before,after}.json` · 9 screenshots in `evidence/wave3-after/` · **no SUMMARY written** | **The operator shell (task 1) — the plan's headline — not built.** Cart measured **256px** vs the contracted 360px (`verify-38-wave3-after.json` → `pos.1440.cartWidth: 256`). No product-card image/availability/quick-add. No 390px bottom sheet. Delivered: `h1Count` 0→1 at all four widths, sub-44px targets 0 at 390px / 3 at desktop (all three are *sidebar* links — i.e. the chrome the unbuilt shell would remove), till-session-bar 15 raw literals → 0 |
| **38-05** | 3 | KDS counters, viewport, honest age | **PARTIAL** | same commit `38a61be2` · same JSON · 5 KDS screenshots · **no SUMMARY written** | **Bounded elapsed time not done** — `Oldest 113h 52m` still renders. Board viewport ownership, station-index density, `PageHeader` on the index: none. Delivered: collisions 4/4/2/2 → **0**, overflowing labels 8/6/4/2 → **0** at 390/768/1024/1440 in both themes |
| **38-06** | 3 | orders & tables, floor view | **NOT STARTED** | — | The defect it was to diagnose (Floor View "No tables configured") was found and fixed inside 38-01 instead |
| **38-07** | 4 | inventory, menu, purchasing onto the grid | **NOT STARTED** | — | — |
| **38-08** | 4 | customers, staff, finance | **NOT STARTED** | — | — |
| **38-09** | 4 | dashboards, reports | **NOT STARTED** (one item done early) | — | The `fraction: 1` "bar that always reads 100%" and the one-boundary-over-four-queries defect were **both fixed in 38-01**, out of order |
| **38-10** | 4 | settings & auth | **NOT STARTED** | — | Still blocked on a TOTP-capable persona |
| **38-11** | 4 | command palette | **NOT STARTED** | — | `components/ui/command-palette.tsx` untouched |
| **38-12** | 5 | loading/empty/error/success | **NOT STARTED** | — | — |
| **38-13** | 5 | micro-interactions, depth | **NOT STARTED** | — | — |
| **38-14** | 5 | responsive | **NOT STARTED** | — | — |
| **38-15** | 5 | accessibility (the 22-Tab journey) | **NOT STARTED** | — | Skip links still **0**, measured today |
| **38-16** | 5 | performance | **NOT STARTED** | — | — |
| **38-17** | 6 | consistency audit + regression | **NOT STARTED** | — | — |

**Score: 1 executed, 4 partial, 12 not started.** Of 17 plans, **3 of 6 waves were never entered.**

### 1.1 Resolving "wave3 evidence but no SUMMARY"

`evidence/verify-38-wave3-before.json` (534 lines) and `verify-38-wave3-after.json` (210 lines),
plus `wave3-before/` and `wave3-after/` (9 PNGs each), were committed by **`38a61be2`** —
*"feat(38-04,38-05): KDS counters stop colliding, POS touch targets reach zero at 390px"*.

**Wave 3 covered exactly two of its three plans, partially:**
- the harness is `frontend/e2e/verify-38-wave3.mjs`, and it probes **only `pos` and `kds`** — the
  after-JSON has exactly two top-level keys;
- **38-06 (orders and tables) was never touched**, which is why the ROADMAP line for it reads
  `NOT STARTED`;
- **no 38-04-SUMMARY.md or 38-05-SUMMARY.md was ever written.** The only written record of what
  wave 3 delivered is the ROADMAP bullet rewritten by `5ce912f8` (ROADMAP.md:1059–1061) and the
  raw JSON. That is a documentation gap, not a work gap — the JSON and screenshots are real and
  detailed — but it means the phase's own SUMMARY series stops at 03 while its evidence stops at 05.

`5ce912f8` — *"docs(38): the third instance of 'the measurement is not the contract', and wave-3
progress"* — is the **last phase-38 commit in the repository.** It touched only `ROADMAP.md`
(+6/−3) and `UI-SPEC.md` (+7). Nothing has been committed to phase 38 in the **9 days since.**

---

## 2. The ten locked decisions, quoted, versus the demo-calibrated direction

The proposed direction, as given: **gold/teal OKLCH re-derivation · Fraunces / Sora / DM Mono type
stack · dark-first-but-light-supported · View-Transitions theme switch.**

Measured against the demo file first, so the direction is described accurately rather than assumed:

| Demo property | Measured in `Docs/NEXUS_ERP_Demo.html` |
|---|---|
| colour authoring | **hex + rgba only. `grep -c 'oklch('` → 0.** There is no OKLCH in the demo; the re-derivation is a *proposal about* the demo, not a property of it |
| primary | `--primary: #E8A045` = `oklch(0.760 0.1353 69.3)` — gold, hue **69°** |
| secondary accent | `--teal: #2DD4BF` = `oklch(0.785 0.1325 181.9)` — hue **182°** |
| further accents | `--blue #60A5FA` (255°), `--red #F87171` (22°), `--green #4ADE80` (152°), `--purple #A78BFA` (293°) — **six** accent families |
| type stack | `--font-display: 'Fraunces', Georgia, serif` · `--font-body: 'Sora'` · `--font-mono: 'DM Mono'` (line 40–42), loaded from `https://fonts.googleapis.com` (line 7) |
| radius | 10 / 16 / 22px (`--radius`, `-lg`, `-xl`) |
| theme | **single dark theme.** `grep -c 'prefers-color-scheme\|data-theme'` → 0. No light mode exists in the demo |
| view transitions | **absent.** `grep -c 'startViewTransition'` → 0 |
| other externals | `https://cdnjs.cloudflare.com/.../Chart.js/4.4.1` |

And against the codebase: `frontend/app/globals.css:313` declares **`--brand-h: 195`** (cyan), with
129 `oklch()` declarations and 443 custom properties across 1,151 lines; `app/layout.tsx:2` loads
**Geist / Geist Mono** via `next/font/google`; a theme toggle exists
(`components/ui/theme-toggle.tsx`, `@teispace/next-themes`) and **no** `startViewTransition` call
exists anywhere under `app/`, `components/`, `lib/`.

### D-38-01 — "This phase extends the phase-20/34 vocabulary. It does not start a second one."

> *"Every token, zone, glass weight, depth level and motion class already exists and is measured.
> Phase 38 adds **no** new colour token, **no** new glass weight, **no** new depth level and **no**
> new motion duration. Where a screen needs a treatment that does not exist, the answer is that the
> screen is wrong, not that the system is short. The one exception is stated in D-38-02, and it is
> a bridge, not a new value."*

**CONFLICT — direct, and this is the load-bearing one.**
- A **gold/teal re-derivation is a new colour vocabulary**, not a bridge. Re-pointing `--brand-h`
  from 195 to ~69 regenerates the eleven `--primary-*` steps (`globals.css:318-328`) — but a
  *second* teal accent at 182° cannot come from `--brand-h` at all; it is a new hue axis and
  therefore new tokens. `globals.css:9-11` states the system's own premise: *"Every colour in this
  file is authored as `oklch(L C var(--brand-h))` … change `--brand-h` and the system regenerates
  from ONE number."* Two brand hues breaks that premise.
- Phase 20's **53 measured contrast pairings** and phase 34's **20 glass rows** (binding constraint
  5.34:1, hue-swept 0–355°) are measurements *of specific token values*. Changing the values
  invalidates the measurements. UI-SPEC §11 says *"no new pairing ships unmeasured"*.
- `__tests__/lib/theme/design-tokens.test.ts:307` asserts **no token block contains a hard-coded
  hex** — so the demo's 17 hex values cannot be transplanted; they must be re-derived to OKLCH
  first (the conversions above are supplied for that).
- The demo's **six accent families** collide with UI-SPEC §4.1's reserved-accent list, which
  permits accent on exactly six *situations* and forbids it as decoration.
- **Not a conflict:** the demo's radius ladder (10/16/22px) is close to the existing
  `--radius: 0.5rem` ×0.6/0.8/1/1.4 ladder and can be expressed as a change to one number.

**Verdict: D-38-01 must be explicitly amended or superseded before any re-derivation begins.**
Doing it quietly is precisely the failure D-38-01 was written to prevent.

### D-38-02 — "The type and space scales get bridged, and that is the first plan."

> *"`globals.css:526-533` declares the eight type roles and seven space steps and then deliberately
> withholds them from `@theme` … The audit measured the consequence: **986 Tailwind type-scale
> classes against 1 contract-token class**, and `--text-body` rendering on 22 nodes product-wide.
> That trade was correct when it was made and has now expired … The bridge lands first, behind
> `PageHeader` / `PageBody`, with a conformance gate. Nothing downstream is planned on the
> assumption that call sites migrate themselves."*

**PARTIAL CONFLICT — on the family, not on the scale.**
- The **type bridge is done and is not in the way.** `globals.css:288` opens a real `@theme` block
  (deliberately *not* `inline`) publishing `--text-display: 30px` … `--text-body: 15px` with paired
  `--*--line-height`. Swapping Geist→Sora/Fraunces/DM Mono changes `--font-sans` /
  `--font-heading` / `--font-mono` (globals.css:26-28) and **touches none of the eight size roles**.
  So D-38-02 does not forbid the type *stack* change.
- **But it does bind three things the new direction must respect:**
  1. **`Fraunces` is a display serif.** UI-SPEC §3 permits **exactly two weights (400/600)** with
     `--text-pos` at 500 as the single declared exception, and reserves *"Geist Mono for
     identifiers only"*. A serif display face implies a *ninth* role (or a re-purposing of
     `--text-display`/`--text-h1`) — and `__tests__/lib/utils-cn.test.ts` asserts **`TYPE_ROLES`
     equals exactly the set of `--text-<role>` keys in `globals.css`**, so a ninth role added
     without registering it there reproduces the `cn()` class-stripping bug for that role alone.
  2. **The space scale is NOT bridged and must stay unbridged.** `globals.css:220-254` carries the
     record: publishing the seven steps into `--spacing-*` redefined `max-w-*` product-wide and
     collapsed **every dialog to a 24px sliver** (`.max-w-sm` 384px → 8px). Any re-derivation that
     reaches for the demo's spacing must consume steps as `p-(--space-lg)`, never as a theme key.
     `__tests__/lib/theme/sizing-namespace.test.ts` enforces this.
  3. **Three new webfonts must not become three network dependencies.** UI-SPEC §12 fixes the
     runtime budget at **24 dependencies, zero additions** (verified today: `package.json` has
     exactly 24), and `dependency-budget.test.ts` enforces it. `next/font/google` self-hosts and
     adds no dependency — the demo's `<link href="fonts.googleapis.com">` would add a third-party
     origin, and its `Chart.js` CDN tag would violate UI-SPEC §9.3's *"Recharts is not to be
     added… charts stay inline SVG"* in spirit and §12 in letter.

### D-38-03 — "Sequence by operational value, not by the brief's numbering."

> *"Foundations first because everything compounds on them; then POS and KDS; then back office;
> then cross-cutting quality."*

**NO CONFLICT — but it is the decision the new direction is most likely to break by accident.** A
demo-calibrated overhaul naturally starts where the demo looks best (dashboard, reports). D-38-03
says the dashboard is where the product loses *nothing* by being plain.

### D-38-04 — "Richness is zoned, and the zoning is already law."

> *"| `operational` | POS terminal, KDS/BDS board | depth cues only. No `backdrop-filter`, no
> entrance animation, no parallax, no tilt | … An executor under deadline does not violate this by
> putting glass on the POS; they violate it by putting glass on a shared `Card` the POS imports, or
> on shell chrome that renders above it."*

**CONFLICT — with the demo's shadows and glow, not with its colours.** The demo declares
`--glow-primary: 0 0 32px rgba(232,160,69,0.2)` and `--shadow-lg: 0 8px 48px rgba(0,0,0,0.6)` and
uses them globally. Phase 34 declares **3 two-layer depth levels + lift + inset, chroma zero**. A
chromatic gold glow is a new depth treatment (D-38-01) *and* would reach the operational zone if
applied to a shared surface. Measured today and still true: `verify-38-wave3-after.json` reports
`containingBlockCreators: 0` and `animations: 0` on POS at all four widths and on KDS at all five
capture modes.

### D-38-05 — "Modal backdrop blur is not a phase-38 deliverable."

> *"Measured today, `[data-slot="dialog-overlay"]` reports `backdrop-filter: none` under the tenant
> shell. **That is the system working, not a gap.** … Adding blur globally re-creates the defect
> 34-01 removed."*

**NO CONFLICT.** The demo has no modal blur to import. Keep the zone-keyed rule.

### D-38-06 — "Role-aware UX means the workflow, not the button list."

> *"That means the landing surface, the default density, the primary action and the information
> ordering differ per role — not that a manager sees eleven sidebar rows and a cashier sees three."*

**NO CONFLICT.** Orthogonal to visual calibration. Untouched by any executed plan.

### D-38-07 — "Every visual gate is watched failing before it is trusted."

> *"Every gate this phase adds carries its negative control **recorded as observed** in its own
> docblock: break it on purpose, watch it go red, restore it. An assertion nobody has watched fail
> is not evidence."*

**NO CONFLICT — and it is the decision the phase honoured best.** 38-01's SUMMARY records **12
negative controls observed red**; 38-02 records 1; 38-03 records 3; 38-05 produced the phase's
sharpest lesson (UI-SPEC §7.2.2: the station-counter check reported *0 collisions* against code
photographed rendering `PREPARINGREADY`, because labels overflow their boxes and the *boxes* never
overlap). **Any re-derivation inherits this obligation for every contrast pairing it changes.**

### D-38-08 — "Real data, and no facade over missing backends."

> *"Floating Terrace, branch F-7, real orders, real takings, a real `Rs 36,730.95` till variance, a
> real `-2987 KG` of chicken. Specs and screenshots use them. Where a brief item needs backend work
> that does not exist … the spec says so and the phase does not build a shell that displays
> nothing."*

**CONFLICT — soft but real.** `Docs/NEXUS_ERP_Demo.html` is 1,562 lines of self-contained mock: it
ships a Chart.js CDN tag and invented figures. UI-SPEC §13 lists **eight brief items that are
backend-blocked** (KPI comparison, floor plan, order facets, inventory columns, persisted
personalisation, notification centre, activity timeline, settings). A demo that renders all of them
beautifully is not evidence any of them can be rendered from real data. **Calibrate the visual
vocabulary from the demo; do not calibrate the feature list from it.**

### D-38-09 — "The appendix constraints are preserved, and re-proved per route with a print path."

> *"`transform` / `filter` / `backdrop-filter` on leaf surfaces only, never layout ancestors.
> `position: fixed` survives on the receipt path. Print output verified by rendering a real PDF and
> extracting its text, never by reading CSS. `@page size` never `<length> auto`. … Measured today
> and to be kept true: **0 containing-block creators and 0 running animations on the POS route.**"*

**CONFLICT RISK — the highest-cost one to get wrong.** The demo's `--glow-*` / `--shadow-*` are
harmless; a **View-Transitions theme switch is not automatically harmless**. `::view-transition-*`
pseudo-elements create their own stacking/containment context during the transition, and
`app/pos/**` carries the receipt print path (`components/print/receipt-print.css:181` uses
`position: fixed`). Gate G6 exists for exactly this. There is **no `startViewTransition` anywhere
in the codebase today** — verified by grep over `app/`, `components/`, `lib/` — so this is
greenfield and must arrive with G6 re-run and a rendered-PDF check (G7), not a CSS read.

### D-38-10 — "Nothing here changes behaviour."

> *"Presentation and interaction only. No endpoint, calculation, permission, validation rule, route
> or workflow changes. Where a screen is wrong because its data is wrong, the audit records it and
> the phase does not paper over it."*

**CONFLICT — already breached, by the executed work itself, defensibly.** 38-01 fixed three
*functional* bugs (`fraction: 1`, the four-query `QueryBoundary`, and the Floor View's unread
`isError`). Each was recorded and justified. The direction does not add new pressure here, but the
decision as written no longer describes the phase as executed and should be restated.

### Summary of decision conflicts

| Decision | Verdict |
|---|---|
| D-38-01 no new colour token | **DIRECT CONFLICT — must be amended before work starts** |
| D-38-02 type/space bridge | **PARTIAL — font family free; 9th role, `--spacing-*`, and font delivery are bound** |
| D-38-03 sequence by operational value | no conflict; at risk of accidental breach |
| D-38-04 zoned richness | **CONFLICT on chromatic glow / large shadows reaching shared surfaces** |
| D-38-05 no global modal blur | no conflict |
| D-38-06 role-aware workflow | no conflict |
| D-38-07 watched-failing gates | no conflict; obligation inherited for every re-measured pairing |
| D-38-08 real data, no facade | **SOFT CONFLICT — the demo is a mock; 8 items stay backend-blocked** |
| D-38-09 print/containment constraints | **CONFLICT RISK — View Transitions must clear G6 + G7** |
| D-38-10 no behaviour change | **already breached by 38-01, defensibly; restate it** |

---

## 3. Every measured metric in 38-AUDIT.md, re-measured today

Audit column = `38-AUDIT.md` §13 as written 2026-08-12. Today column = same command, 2026-08-21.

### 3.1 Source counts (re-measurable, and re-measured)

| Metric | Audit 2026-08-12 | Peak pre-38-01 | After waves 1–2 (audit §10.1a) | **Today 2026-08-21** | Direction |
|---|---|---|---|---|---|
| **Tailwind type-scale classes** | **986** | 1,037 | 974 | **1,124** (gate scanner: **1,118**) | ▲ **+138 vs audit, +150 vs post-wave-2** |
| ├ `text-sm` | 530 | — | — | **591** | ▲ +61 |
| ├ `text-xs` | 351 | — | — | **424** | ▲ +73 |
| ├ `text-2xl` | 38 | — | — | 37 | ▼ −1 |
| ├ `text-xl` | 26 | — | — | 28 | ▲ +2 |
| ├ `text-lg` | 23 | — | — | 24 | ▲ +1 |
| ├ `text-base` | 14 | — | — | 16 | ▲ +2 |
| └ `text-3xl` | 4 | — | — | 4 | = |
| **contract `text-[length:var(--text-*)]`** | **1** | 1 | 1 | **1** | = |
| **bridged role utilities** (`text-body`/`-h1`/`-h2`/`-small`/`-label`/`-display`/`-pos`/`-kds`) | did not exist | — | — | **179** (small 86 · label 47 · body 25 · h1 8 · pos 6 · h2 6 · kds 1) | ▲ new |
| **hand-rolled `<table>` files** | **37** | 39 | 38 | **41** (gate: 44 occurrences in 38 files) | ▲ +4 |
| `ui/data-table` importers | 4 | — | — | **2** | ▼ (2 moved to DataGrid) |
| `ui/data-grid` importers | did not exist | — | — | **5** | ▲ new |
| **raw `<select>` elements** | **62** in **34** files | — | — | **69** in **37** files | ▲ +7 / +3 files |
| files importing shared `Select` | 0 | — | — | **0** | = (phase 35's, still unexecuted) |
| **status-badge implementations** | **6** | — | — | **6** — all six files still on disk | = (38-03 deferred) |
| **confirmation implementations** | 6 bespoke, **0 primitives** (`grep -rl 'AlertDialog\|ConfirmDialog'` → 0) | — | — | **1 primitive** (`components/ui/confirm-dialog.tsx`) + **8 files** now match that grep; `ConfirmDestructiveDialog` is a 7th, deliberately kept | ▼ improved |
| **skip links** | **0** | — | — | **0** (`grep -rn 'Skip to content\|skip-to-content\|skipToContent'` → 0) | = |
| **files declaring their own `<h1>`** | **60** | 63 | — | **67** | ▲ +7 |
| `PageHeader` importers | 0 (component absent) | — | — | **11** | ▲ new |
| `PageBody` importers | 0 (component absent) | — | — | **10** (9 routes + the component) | ▲ new |
| **bare `rounded`** (off-ladder 4px) | **145** | 149 | 141 | **144** (gate: 139) | ▲ +3 vs post-wave-2 |
| `rounded-lg` / `-md` / `-full` / `-xl` | 93 / 90 / 58 / 29 | — | — | **159 / 150 / 71 / 34** | ▲ (codebase grew) |
| **raw palette literals** | **180** / 74 distinct / 22 files | — | — | **152** / 71 / 22 (gate: 145) | ▼ −28 |
| ├ `pos/till-session-bar.tsx` | **15** (worst) | — | — | **0** | ▼ fixed by 38-04 |
| ├ `finance/TillVariancePanel.tsx` | 8 | — | — | **8** | = |
| ├ `purchasing/PoStatusBadge.tsx` | 6 | — | — | **6** | = |
| └ `pos/till-review.tsx` | 5 | — | — | **5** | = |
| **`animate-spin` occurrences** | **8** in 8 files | — | — | **11** in 11 files | ▲ +3 |
| routes (`page.tsx`) | **65** | — | — | **82** | ▲ **+17** |
| layouts | 9 | — | — | 10 | ▲ +1 |
| `.tsx` under `app/`+`components/` | **278** | — | — | **338** | ▲ **+60** |
| runtime dependencies | **24** | — | — | **24** | = |
| `framer-motion` orphaned | yes, `^12.41.0` | — | — | **still `^12.41.0`** | = |

### 3.2 Live-browser figures — NOT RE-MEASURED

| Metric | Audit | Status today |
|---|---|---|
| **Tab presses to reach `<main>`** | **22** (`evidence/audit-a11y.json` → `tabsToReachMain: {tabs: 22, reached: "A :: Vendors"}`) | **NOT RE-MEASURED** — needs `e2e/audit-38-a11y.mjs` against a live stack. Skip links are still 0 in source, so there is no reason to expect improvement |
| `thead th` computed `position` | `static` on **12 of 12** tables | **partially superseded**: `verify-38-02.json` recorded `sticky` on 3 reference screens. The other ~38 tables unverified |
| row heights in one table | **65px and 81px** | 3 reference screens now `[44]`; rest unverified |
| **sub-44px targets, worst screen** | **108** (`/app/purchasing/purchase-orders`) | 38-02 reported →27; 38-02's SUMMARY then reported **79** on `/app/inventory/ingredients`. **NOT RE-MEASURED** |
| rendered font sizes | **12 distinct**; `--text-body` on **22** nodes; 14px on 1,901; 12px on 686 | **NOT RE-MEASURED** — and with type-scale classes at 1,124 there is no basis to assume it improved |
| containing-block creators on POS | **0** ✓ | **0** ✓ per `verify-38-wave3-after.json` at 390/768/1024/1440 |
| animations on POS | **0** ✓ | **0** ✓ same source |
| routes with horizontal page scroll | **0** ✓ | `pageScroll: false` on POS at all four widths; other routes unverified |
| dialog overlay `backdrop-filter` | `none` ✓ | unverified since 38-03 |

### 3.3 The finding that matters most: **all four conformance gates are RED today**

The gates were the phase's central argument — *"the number can no longer rise: a file absent from
the baseline must score zero"* (audit §10.1a). Reproducing `conformance-scan.ts` exactly
(same two trees, same regexes, same comment-stripping, same `compare()` rules) against
`__tests__/lib/theme/conformance-baseline.json` — **338 files scanned**:

| Gate | Baseline total | Cap asserted in `conformance.test.ts` | Current | New offenders (files absent from baseline) | Regressions | Verdict |
|---|---|---|---|---|---|---|
| **G1 type-scale** | 961 | `≤ 961` (line 97) | **1,118** | **17 files, 117 classes** | 9 files, +49 | **RED** |
| **G2 bare `rounded`** | 137 | `≤ 137` (line 109) | **139** | 5 files, 9 | 0 | **RED** |
| **G3 raw palette** | 142 | (no total cap) | **145** | 2 files, 4 | 0 | **RED** |
| **G4 hand-rolled `<table>`** | 43 | `≤ 43` (line 104) | **44** | 1 file, 1 | 0 | **RED** |

Largest new offenders (born off-contract, which the scanner's docblock says is *"exactly how the
986 accumulated in the first place"*):

```
components/pos/discount-panel.tsx          25 type-scale classes
components/audit/audit-log.tsx             17   (+2 raw palette)
components/menu/ModifierManagerDialog.tsx  11   (+5 bare rounded)
components/pos/modifier-dialog.tsx         10
components/menu/station-routing-board.tsx   8   (+1 rounded, +2 palette)
components/settings/service-charge-form.tsx 8
components/platform/impersonation-log.tsx   7   (+1 hand-rolled <table>)
```

Largest regressions inside already-baselined files:

```
components/pos/charge-summary.tsx      35 → 60
components/pos/order-management.tsx    16 → 24
components/pos/till-review.tsx         32 → 39
components/pos/void-refund-dialog.tsx  22 → 25
```

**Read this correctly.** These files are the S0/S1 functional repairs listed in §4 — modifiers,
discounts, void/refund, station routing, service charge, the audit log. **The gate did its job and
was not consulted.** Every one of the 17 new offenders is a file that did not exist when the
baseline was recorded. The ratchet holds only if someone runs it.

---

## 4. Why phase 38 stalled on 2026-08-12

The evidence is unambiguous and it is not abandonment — it is displacement by a higher-severity
finding, made the same night.

**The timeline, from `git log --date=iso`:**

| Time (PKT, 2026-08-12) | Commit | What |
|---|---|---|
| 01:11 | `fdfd5d79` | audit + UI-SPEC + 17 plans committed |
| 01:51 | `0cdcb523` | 38-01 executed |
| 01:53 | `db569554` | 38-01 summary |
| 02:08 | `829f3a56` | 38-02 executed |
| 02:15 | `d95cd934` | 38-03 executed (partial) |
| 02:17 | `214a9bcc` | wave-2 summaries |
| 02:21–02:23 | `5b239806`, `f8ec6cb0` | audit corrections |
| 02:41 | `38a61be2` | 38-04 + 38-05 executed (partial) |
| **02:42** | **`5ce912f8`** | **last phase-38 commit — ROADMAP marks wave 3 PARTIAL** |
| **04:50** | **`5629188c`** | **`docs(audit): the product gap register — 15 domains driven, verdict 2.5/10`** (+589 lines) |
| 05:23 → 05:53 | `35276637` … `9709604d` | **~20 S0/S1 functional fixes in 30 minutes** |

**The cause, in the gap register's own words** (`.planning/audits/PRODUCT-GAP-REGISTER.md`, §1):

> *"No. This cannot be sold to a restaurant today, and the 3/10 is generous — the honest number is
> 2.5/10. … Can my cashier take the order the guest actually placed? No — there are no modifiers,
> no half/full variants, no discounts, no open-price key, no delivery, and the till silently shows
> only about 20 menu items no matter how many you create. Can I trust the money? No — a manager can
> void a fully-paid order at HTTP 200 with the cash still recorded against it and no reversal …
> That is a shrinkage mechanism, not a bug list. … A restaurant that installed this on Friday would
> be closed by Saturday lunch."*

Two hours and eight minutes after the last design commit, a 15-domain browser-driven audit
concluded the product could not take an order or account for cash. Everything after it is S0 repair
work — the commit subjects tell the story on their own: *"Send to Kitchen failed in silence"*,
*"a voided order existed on no screen in the product"*, *"the day's cash was missing from the day's
takings screen"*, *"the till sold the first 20 items of any longer menu and said nothing"*.

**Three corroborating pieces of state:**

1. **`.planning/STATE.md` still reads `current_phase: 35`**, `last_activity_desc:` a phase-35 line.
   Phase 38 was **never registered as the current phase**, so no bookkeeping mechanism was ever
   watching it. (The file's own process note warns this has happened before.)
2. **`.planning/FLEET-LOG.md` contains zero mentions of phase 38** — `grep -i "38-0\|design
   transformation\|DESIGN-BRIEF"` returns nothing.
3. **The ROADMAP cites a commit hash for 38-02 that does not exist** (`0e3fb0f8`, ROADMAP.md:1055 —
   `git rev-parse` → *"unknown revision"*; the real one is `829f3a56`). Consistent with the record
   being written from a sibling worktree whose commits were rewritten and never reconciled — this
   repo carries **30+ `worktree-wf_*` / `claude/*` branches**.

**And then the repository moved on entirely.** After 2026-08-13 the next commit is 2026-08-21
`599ddce2` *"feat(deploy): k3s on the VPS, two environments, and a pipeline that proves itself"*,
followed by nine deploy/CORS/login/ClickHouse fixes. Phase 38 has been dormant for **9 days**, and
the 60 new `.tsx` files and 17 new routes added during the S0 repair drive are what pushed the
type-scale count from 974 back to 1,124.

**The stall is therefore over-determined:** (a) a 2.5/10 functional verdict outranked a design
phase, correctly, per D-38-03's own logic that *"a restaurant loses money when the POS and the KDS
are wrong"*; (b) no state file was tracking the phase, so nothing surfaced it again; (c) the
conformance gates that were supposed to hold the line while the phase waited were never run.

---

## 5. What a demo-calibrated restart must resolve first

1. **Amend or supersede D-38-01 in writing.** A gold/teal two-hue palette is a second colour
   vocabulary. Decide it explicitly; do not let it arrive as a plan detail.
2. **Re-baseline the four gates, or fix the 17 new offenders.** The gates are RED. Restarting on top
   of a red ratchet means the phase's central mechanism is already defeated.
3. **Write the missing 38-04 and 38-05 SUMMARYs**, or accept that the only record of wave 3 is two
   JSON files and three ROADMAP bullets.
4. **Re-run the four audit harnesses** (`e2e/audit-38.mjs`, `-reshoot`, `-interactions`, `-a11y`)
   against the current build. The audit's browser figures are 9 days and 60 files stale, and three
   of the phase's headline numbers exist only there.
5. **Fix `ROADMAP.md:1055`** — it cites a nonexistent commit for the phase's second-largest plan.
6. **Decide the View-Transitions question against G6/G7 before writing it**, not after: `app/pos/**`
   carries the receipt print path and the invariant is currently 0/0.

---

*Compiled read-only. No source file under `frontend/`, `services/` or `gateway/` was modified.*
