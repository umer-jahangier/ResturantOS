# Phase 38 — Audit of the existing application

> **This is step 1 of `DESIGN-BRIEF.md`.** Nothing is proposed here. Every claim below names a
> file, a line, a count or a browser measurement, and every measurement says how it was taken.
>
> **Method.** Three sources, in this order of trust:
> 1. **The live product in Chromium** — 20 routes, 3 personas, 2 themes, 4 viewport widths,
>    56 screenshots, plus computed-style probes. Harnesses:
>    `frontend/e2e/audit-38.mjs`, `audit-38-reshoot.mjs`, `audit-38-interactions.mjs`,
>    `audit-38-a11y.mjs`. Raw output: `evidence/audit-probe.json`, `audit-reshoot.json`,
>    `audit-interactions.json`, `audit-a11y.json`.
> 2. **The source tree** — counted with `grep`/`find` over `frontend/app` and
>    `frontend/components` (278 `.tsx` files), commands reproduced inline.
> 3. **Prior phase summaries** — 20, 21, 34, 35, read in full so that nothing already delivered
>    is re-reported as a defect.
>
> **Captured 2026-08-12** against `localhost:3000` / gateway `:8080`, tenant **Floating Terrace**,
> branch **Floating Terrace HQ** (`34cd6f62-…`), real seeded data.

---

## 0. The first thing the audit found was that the audit was wrong

The first pass screenshotted the manager dashboard and got **only** this:

> *Couldn't load today's service. This module is temporarily unavailable. Try again in a moment.* `[Try again]`

That is not the dashboard. It is a transient `503` from the gateway's Eureka round-robin, which
phase 21 documented (`21-01-SUMMARY.md`, "Concurrent-agent churn") and phase 34 catalogued as
vacuous-gate #4 — *"the positive control was anchored to a dashboard that renders an error state
whenever a backing service is down."* `frontend/e2e/journeys/operational-zone-containment.spec.ts:299`
carries a comment naming this exact string.

Six of twenty routes were photographed mid-failure on the first pass (`dashboard`, `tables`,
`orders`, `menu-items`, `finance`, `finance-takings`). Had that pass been written up, this audit
would have reported a product with no dashboard.

**So `audit-38-reshoot.mjs` re-captures each route and retries up to four times until
`document.querySelectorAll('[role="alert"]').length === 0`, and records honestly when a route
cannot be captured clean.** Result:

| | routes |
|---|---|
| captured clean (light + dark) | 8 of 10 re-shot |
| **could not be captured clean at all** | `hr-employees`, `hr-attendance` — 4 attempts each, both themes |

**`hr-service` is genuinely down** — no process listening on `:8088`
(`lsof -nP -iTCP -sTCP:LISTEN` shows 8080–8087, 8089, 8090, 8092, 8093, 8095, 8096), absent from
Eureka, and `GET /api/v1/hr/employees` returns `503` through the gateway on every attempt.

> **Stated limitation, not a finding: the HR screens were not visually audited.** Their defects
> below are from source only. Anything phase 38 plans for HR must be re-checked against a running
> `hr-service`.

A second correction the same discipline produced: the first and second passes disagreed about how
many sidebar items a manager sees, which looked like nav instability. Measured properly — six
consecutive dashboard loads — `counts=19,19,19,19,19,19`, **one distinct composition**. The
navigation is stable; the first reading was taken while the page was degraded. **Not a defect.**

---

## 1. What already exists, and must not be re-planned

Read `34-01`…`34-08`, `SURFACE-MOTION-SPEC.md`, `20-design-system/UI-SPEC.md` and `21-01` before
proposing anything. A second design vocabulary is the largest available own-goal here.

| Brief § | Delivered by | Evidence |
|---|---|---|
| §4 Design system, semantic tokens, both themes | Phase 20 | 53 measured contrast pairings, `design-tokens.test.ts`; no hex literal in `globals.css`, asserted |
| §5 Glassmorphism, used selectively | 34-02 | 2 weights, solid-first authoring, 20 measured rows across both deployment conditions, binding constraint **5.34:1**; hue-swept 0–355° |
| §8 Radius tokens | Phase 20 | `--radius: 0.5rem` + `calc()` ladder |
| §9 Shadow & depth | 34-02 | 3 two-layer levels + lift + inset, chroma zero, additive to `--elev-*` |
| §31/§32 3D, selective and GPU-friendly | 34-04 | `usePointerTilt` — 1 `getBoundingClientRect` per gesture, ≤2 `setProperty` per frame, **asserted by call-counting**; 3 overlapping exclusions; `dependency-budget.test.ts` forecloses three.js by name |
| §39 Dark mode as designed elevation layers | Phase 20 | `--background`→`--surface-1..3` in both themes, separately authored |
| §41 Reduced motion | 34-03 | decorative motion **removed**, not shortened; feedback survives; gate runs in both directions |
| §58 Animation tokens | 20 + 34-03 | 11 tokens, 240 ms ceiling still binding outside the expressive zone |
| §54 Premium login | 34-07 | glass over a *measured* substrate — 18.01:1 filter-disabled, 17.73:1 composited |
| §56 Print / receipt untouched | Phase 26 + **re-verified today** | see §7 below |
| §24 Skeletons, not spinners | 34-05 + earlier | 34 files import a skeleton; only **8** `animate-spin` occurrences remain, in 8 files |
| §27 Error states never raw | Phase 14b + 34-05 | live wording measured: *"Couldn't load the employee roster. This module is temporarily unavailable. Try again in a moment."* + `[Try again]` |
| §28 Toast system | mounted | `components/providers/app-providers.tsx:28` mounts one `<Toaster richColors position="top-right"/>`; **184 call sites** — 94 `.error`, 93 `.success`, 3 `.info`, 1 `.warning` |

**Correction to a claim this audit nearly made.** A probe for `[data-sonner-toaster]` returned
nothing, which reads as "the toast system is not mounted". It is mounted — Sonner simply does not
render its container until a toast fires. Checked before writing.

---

## 2. The typography contract is written down and almost entirely unused

This is the single largest gap between the design system on paper and the product on screen.

`app/globals.css:542-557` declares the eight type roles from UI-SPEC §3.11 — `--text-display`
30px, `--text-h1` 20, `--text-h2` 16, `--text-body` **15**, `--text-small` 13, `--text-label` 11,
`--text-pos` 17, `--text-kds` 22 — and immediately says, at `globals.css:526-533`, that they are
**deliberately not bridged** into `@theme`, because doing so would silently re-typeset ~700 call
sites. The bridge was to land "with PageHeader/PageBody (UI-SPEC §10.2 step 4)". **Step 4 never
landed.** Phase 21 recorded the same interim: *"type scale via `text-[length:var(--text-*)]` until
§10.2 step 4 bridges `@theme`."*

Measured in the source:

```
grep -rEoh '\btext-(xs|sm|base|lg|xl|2xl|3xl)\b' app components --include='*.tsx' | sort | uniq -c
```

| class | occurrences |
|---|---|
| `text-sm` (14px) | **530** |
| `text-xs` (12px) | **351** |
| `text-2xl` | 38 |
| `text-xl` | 26 |
| `text-lg` | 23 |
| `text-base` | 14 |
| `text-3xl` | 4 |
| **total Tailwind-scale classes** | **986** |
| **total `text-[length:var(--text-*)]` classes** | **1** |

**986 to 1.** 89% of all typographic decisions in the product are `text-sm`/`text-xs` — 14px and
12px — while the contract's body size is 15px.

Confirmed on the live DOM rather than inferred. Aggregating the computed `font-size` of every
leaf text node across all desktop routes, both themes:

| rendered size | text nodes |
|---|---|
| **14px** | **1,901** |
| **12px** | **686** |
| 16px | 136 |
| 12.8px | 103 |
| 10px | 40 |
| 11px | 34 |
| 20px | 28 |
| 13px | 22 |
| **15px** (`--text-body`) | **22** |
| 24px | 14 |
| 18px | 8 |
| 30px | 6 |

**12 distinct font sizes ship. The contract declares 8 roles. `--text-body` renders on 22 nodes
product-wide** — the contract's default body size is one of the rarest sizes in the product.
`12.8px`, `10px` and `18px` are in no contract at all.

Weights are healthier but still off-contract: UI-SPEC §3.11 says **exactly two** (400 and 600,
with 500 as a single POS exception). Measured: `font-medium` **317**, `font-semibold` **159**,
`font-bold` **24**, `font-normal` **8**. `font-medium` (500) is the *most common weight in the
product* and is specified for one surface only.

---

## 3. Radius: the most-used radius in the product is the one that is not in the design system

Rendered radii across all desktop routes: **5 distinct values** — `6.4px` (838 nodes), `4px`
(238), `33554432px` i.e. pill (174), `8px` (79), `11.2px` (62).

The ladder at `globals.css:180-186` is `--radius: 0.5rem` with `sm = ×0.6`, `md = ×0.8`,
`lg = ×1`, `xl = ×1.4` — so 6.4 / 8 / 11.2 are on-system. `4px` is not: it is Tailwind's default
for the bare `rounded` utility, which bypasses the ladder entirely.

```
grep -rEoh '\brounded(-[a-z0-9]+)*\b' app components --include='*.tsx' | sort | uniq -c
```

| class | occurrences |
|---|---|
| **`rounded`** (bare — 4px, off-ladder) | **145** |
| `rounded-lg` | 93 |
| `rounded-md` | 90 |
| `rounded-full` | 58 |
| `rounded-xl` | 29 |
| `rounded-b-xl` / `rounded-t-xl` / `rounded-sm` / `rounded-none` | 8 |

Bare `rounded` is the **most-used radius class in the codebase** and is the only one that does not
resolve through `--radius`. Changing `--radius` today re-rounds 62% of surfaces and leaves 145
call sites behind.

---

## 4. Colour: mostly clean, with one concentrated pocket

Phase 20 and 21 did real work here, and it shows.

```
grep -rE '\b(bg|text|border|ring|from|via|to|fill|stroke|divide)-(gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}'
```

**180 occurrences, 74 distinct classes, in 22 of 278 files.** 92% of files are clean. The residue
is concentrated:

| file | literals |
|---|---|
| `components/pos/till-session-bar.tsx` | **15** |
| `components/finance/TillVariancePanel.tsx` | 8 |
| `components/purchasing/PoStatusBadge.tsx` | 6 |
| `components/pos/till-review.tsx` | 5 |
| `components/purchasing/ThreeWayMatchTable.tsx` | 4 |
| `components/pos/offline-indicator.tsx`, `components/finance/{TransactionRegister,PeriodCloseModal}.tsx` | 3 each |
| 14 further files | 1–2 each |

`till-session-bar.tsx` is the worst offender and it renders **at the top of the POS screen** — the
pale-green band visible in `evidence/shots/pos-desktop-light.png`. It is `bg-emerald-50` /
`text-emerald-*`, so it does not follow the theme, does not follow `--brand-h`, and was not
measured by phase 20's 53 pairings.

---

## 5. Tables — the largest structural defect in the product

### 5.1 Thirty-seven hand-rolled tables; a shared one nobody uses

```
grep -rl '<table' app components --include='*.tsx'   →  37 files
grep -rl 'components/ui/data-table' app components   →   4 files
```

`components/ui/data-table.tsx` exists (181 lines, TanStack-backed, sorting + pagination +
skeleton + `EmptyState`). **Four files import it.** Thirty-three others hand-roll `<table>`:
16 route files under `app/(tenant)/app/**` and 17 components, including all of
`components/finance/{AccountTable,ApAgingTable,ArAgingTable,GeneralLedger,JournalEntryTable,TenderSplit,TillVariancePanel,TransactionLedgerLinks,TransactionRegister}.tsx`.

### 5.2 What that costs, measured on the live DOM

Probed `/app/inventory/stock` (`audit-a11y.json`):

| property | measured | brief requires |
|---|---|---|
| `thead th` computed `position` | **`static`** | §23 sticky headers |
| row heights within one table | **65px and 81px** — two different heights | §19 "avoid huge rows"; UI-SPEC §3.10 says 32 / 44 |
| row-selection checkboxes | **0** | §49 bulk actions |
| pagination control | **none** (`"Showing 1"` text only) | §23 pagination |
| wrapper `overflow-x` | `hidden`, table 1086px in a 1088px wrapper | §23 responsive behaviour |

Across all 12 rendered tables in the sweep: **sticky headers = 0**.

`/app/purchasing/purchase-orders` renders **84 rows in one ungated list** with no sticky header
and no pager — scroll past row 12 and the column meanings are gone.

### 5.3 What the purchase-order table actually shows

From `evidence/shots/purchasing-po-desktop-light.png`:

- The **PO number column renders truncated UUIDs** — `ca6ed037…`, `9958faba…`, `d43693ce…`. A
  purchase-order list in which no purchase order can be identified.
- The **"Expected date" column is em-dashes for all 84 rows.** The column earns nothing.
- Filtering is a **single native `<select>`** labelled "All statuses". No search, no date range,
  no vendor facet, no filter chips (§19, §48).
- No row selection, no bulk actions, no column visibility (§23, §49).

### 5.4 Tables on mobile

`evidence/shots/inventory-stock-mobile-light.png` at 390px: the desktop table is dropped in
unchanged. The "On hand" column is sliced mid-value — `90 EACI`, `213.5 K`, `-2987 K`. The probe
counted **100 elements extending past the viewport** at 390px and **42** at 1024px on this route.
Brief §57: *"Do not force desktop tables onto mobile."* It is forced.

*(The negative stock — `-2987 KG` of Chicken, total stock value `-Rs 2,116,690.70` — is real
seeded data, presented with no explanation, no alert and no "why". Whether the figure is right is
an inventory question; that the UI states it flatly is a design question.)*

---

## 6. Controls: one shared component, thirty-four screens that ignore it

Phase 35 (D-35-01, D-35-04) built `components/ui/select.tsx` — 127 lines, deliberately a native
`<select>` wrapper, with an in-file docblock explaining that *"`components/ui/` had no
`select.tsx` at all, so every screen wrote its own `<select>` with a copy of the same class
string… Thirty screens, thirty chances to drift."*

Measured today:

| | count |
|---|---|
| raw `<select>` elements outside `components/ui/select.tsx` | **62**, across **34 files** |
| product files importing the shared `Select` | **0** |
| files importing anything from it | **1** — `components/ui/combobox.tsx` imports `selectClass` |

Worst: `components/inventory/IngredientFormDialog.tsx` (12), `RecipeFormDialog.tsx` (4),
`app/(tenant)/app/hr/attendance/page.tsx` (4), `components/kds/station-board.tsx` (3).

**The component exists and the migration never happened.** Phase 35 plans `35-06`…`35-14` are
written and unexecuted. *This belongs to phase 35's scope, not phase 38's* — see §11.

### 6.1 Six status-badge implementations

`components/ui/status-badge.tsx`, `components/purchasing/PoStatusBadge.tsx`,
`components/pos/payment-status-badge.tsx`, `components/pos/sync-status-badge.tsx`,
`components/platform/tenant-badges.tsx`, `components/finance/PeriodStatusChip.tsx`. 43 files
reference one of them. Brief §43 lists one `StatusBadge`; §62 requires that *"the same semantic
system applies throughout."*

### 6.2 No PageHeader, sixty page headers

`grep -rlE '<h1' app components` → **60 files**. There is no `PageHeader` component
(`components/ui/page-header.tsx` and `components/shared/page-header.tsx` both absent), and UI-SPEC
§3.10's rule that *"pages do not set their own outer padding — `PageBody` owns it"* cannot hold,
because `app/(tenant)/layout.tsx:105` still hard-codes `p-4 lg:p-6 pb-20 md:pb-6` on `<main>`.

And the h1 discipline it was meant to enforce is already broken: **`/app/pos`, `/app/pos/tills`,
`/app/pos` (order management) and `/app/hr/attendance` render `h1Count = 0`** in both themes.
Four screens with no page heading at all.

### 6.3 Confirmation: six implementations, no primitive

```
grep -rl 'AlertDialog\|ConfirmDialog' app components  →  0
```

There is no shared confirmation component. Destructive confirmation is nonetheless implemented —
six separate times, each as a bespoke `Dialog` plus a local handler:
`app/(tenant)/app/stations/page.tsx:192`, `app/(tenant)/app/purchasing/vendors/[id]/page.tsx:413`,
`app/(tenant)/app/inventory/setup/page.tsx:345`,
`app/(tenant)/app/inventory/ingredients/page.tsx:335`,
`app/(tenant)/app/inventory/categories/page.tsx:257`, and
`components/pos/void-refund-dialog.tsx:143`.

Brief §50 is *behaviourally* satisfied and *structurally* violated — §43 names `ConfirmDialog`,
§62 requires that if one delete confirms, all equivalent deletes confirm. Six independent copies
is how that stops being true.

### 6.4 Forms

Probed the two dialogs that could be opened (`audit-interactions.json`):

| | New Purchase Order | Add table |
|---|---|---|
| size | 768 × 464 | 448 × 371 |
| inputs | 6 | 3 |
| inputs with no label | **0** | **0** |
| placeholder-as-label | **0** | **0** |
| **labels marked required** | **0** | **0** |
| focus moved into the dialog | yes | yes |
| `aria-modal` | **`null`** | **`null`** |

Labelling is good — brief §22's "never rely on placeholder text as labels" is **already honoured**
in both dialogs. **Required indicators are entirely absent** (§22). `aria-modal` is unset on every
dialog including the command palette.

The one screen that fails labelling outright is `/app/hr/attendance`: **6 inputs with no label,
no `aria-label` and no `aria-labelledby`** (3 `select-one`, a `date`, 2 more), plus **3 interactive
controls with no accessible name**. It is also one of the four `h1Count = 0` screens. *(Source-side
only — `hr-service` was down, so the screen renders its error state.)*

---

## 7. The operational zone: still clean, verified today rather than assumed

The appendix constraints are the ones most expensive to get wrong, so they were re-measured on the
live POS route rather than carried forward from phase 34's summary.

`audit-38-a11y.mjs` walks every element under `body` on `/app/pos` and reads computed
`transform`, `filter`, `backdrop-filter`, `perspective`, `contain` and `will-change`:

| measurement | result |
|---|---|
| **containing-block creators on the POS route** | **0** |
| **running animations on the POS route** | **0** |
| dialog overlay `backdrop-filter` under the tenant shell | `none` |

The print path is intact and its history is documented in place:
`components/print/receipt-print.css:181` uses `position: fixed`; lines 148–166 carry the record of
the `visibility: hidden` specificity defect that *"printed the entire application sidebar onto a
customer's bill"*, now written with `!important` and a companion rule. The stylesheet is imported
by `components/print/receipt-view.tsx:10` only — **route-scoped, not global**. No `@media print`
block exists in `globals.css`.

> **This is a property phase 38 must preserve, not improve.** The overlay reporting
> `backdrop-filter: none` is the zoning system working: 34-02's glass rule is keyed on the
> element's own `data-zone`, and the tenant shell is `restrained`. "Add backdrop blur to all
> modals" (§29) would be a regression, not a feature. See UI-SPEC §4.

---

## 8. Screen-by-screen, from the screenshots

### 8.1 Dashboard — `evidence/shots/dashboard-desktop-{light,dark}.png`

The strongest back-office screen. 34-06's glass portlets, depth grid and hover lift are live; the
KPI row, live orders, station load, "act now" and 86'd items all render real data.

Defects:

- **No comparison, no percentage change, no trend indicator, no sparkline on any KPI tile.**
  Brief §13 requires all five, with the worked example `Revenue · Rs. 248,500 · +12.4% vs
  yesterday`. Tiles render value + caption only ("OPEN ORDERS / 14 / 14 orders in view").
- **A decorative bar chart that encodes nothing.** `components/dashboard/manager-dashboard.tsx:122`
  sets `fraction: 1` for **every** 86'd item; `components/dashboard/portlets/portlet.tsx:268`
  renders `width: fraction × 100%`. So all three 86'd rows draw a full-width teal bar, always.
  The sibling `stationLoad` at line 112 computes `count / max` correctly — so the same portlet
  renders one meaningful bar chart and one meaningless one, four lines apart. Brief §47: *"every
  chart answers a business question"*; §64: *"do not make dashboards decorative instead of useful."*
- **One error boundary over four queries.** `manager-dashboard.tsx:167` wraps the entire first
  portlet row in a single `<QueryBoundary query={[ordersQuery, ticketsQuery, stationsQuery,
  tablesQuery]}>`. Any one of the four failing replaces all four KPI tiles with one error box —
  which is precisely what §0's screenshot shows. Brief §25: *"do not freeze the entire interface;
  prefer localized loading states."*
- **Elapsed times of `114:01:07`.** The "ACT NOW" list reports four tickets *"late at DEFAULT"*
  with 114 hours on the board, from 2026-08-07. `components/kds/station-picker.tsx:83` formats
  them and `:270` renders `Oldest 113h 52m` on the station index. Stale tickets are presented as
  urgent, actionable work, indistinguishable from a ticket that is genuinely two minutes late.
- No date range, no branch filter, no widget show/hide (§45, §48).

### 8.2 POS — `evidence/shots/pos-{desktop,laptop,tablet,mobile}-light.png`

Desktop is workable: category chips, search, 4-column tile grid, cart with order-type toggle,
table select, Send to Kitchen / Save as Draft / Charge Now. The empty cart state is genuinely good
— *"Add items to start an order — Tap a menu item to build the cart; nothing is saved until Send
to Kitchen or Charge."*

Defects:

- **POS renders inside the back-office shell** — full sidebar, breadcrumb `App › POS`, global
  search, branch pill, avatar. UI-SPEC §4.1 specified a separate operator shell (Shell B) as *"the
  single biggest structural change"*; it was never built. Brief §15's recommended three-column
  operator layout is competing with 255px of back-office chrome at every width.
- **At 390px the POS is unusable.** The cart panel overlays the menu grid: category chips render
  as `Sta…`, `Ma…`, `Dri…`, and menu tiles are sliced vertically down the middle. The till bar
  wraps mid-value (`Float: Rs` / `5,000.00`). This is not a shrunk desktop layout, it is a broken
  one. §16, §38, §57.
- **Product cards carry name and price only.** No image, no availability, no category, no
  modifiers, no quick-add (§15).
- Cart panel measures ~300px against UI-SPEC §3.10's declared 360px, *"too narrow for a modifier
  line plus quantity stepper plus money without truncation."*
- `h1Count = 0`.

**Verified good:** 0 compositing filters, 0 animations, 0 containing-block creators (§7 above).

### 8.3 Kitchen — `evidence/shots/kitchen-index-desktop-light.png`

- **The station-count chips collide.** "PREPARING" and "READY" overlap into `PREPARINGREADY` at
  1440px, on both station cards, in both themes. A layout defect on a kitchen screen, at the
  widest viewport tested.
- **A dark board floating in light chrome.** The `[data-surface="kds"]` board begins at x=280 with
  the light sidebar and light top bar around it — the exact condition UI-SPEC §4.1 said should be
  removed structurally by a separate `(kitchen)` route group rather than patched.
- Two station cards occupy the top 300px of a 900px viewport; the rest is empty.
- `Oldest 113h 52m` (see §8.1).

### 8.4 Orders & tables

- **`/app/tables` is a grouped CRUD list, not a floor plan.** Garden / Rooftop / Other tables, each
  row `name · seats · Available · ⋯`. Brief §17 asks for an interactive floor plan with capacity,
  current order, elapsed time, server, occupancy and eight states, plus transfer / merge / split.
- **The POS Floor View says "No tables configured"** while `/app/tables` lists five tables (G1, T3,
  T1, T2, H1) for the same branch, and the dashboard reports "0 / 5 tables occupied".
  `evidence/shots/pos-floor-view-desktop-light.png`. **Two surfaces disagree about whether the
  restaurant has tables.** This is a functional defect the audit surfaced; it needs diagnosis
  before any floor-plan design work is planned on top of it.

### 8.5 Finance — `evidence/shots/finance-takings-desktop-dark.png`

**The best screen in the product**, and the standard the rest should be held to. Honest
*"Not known"* states with stated reasons (*"Comps are not recorded separately from discounts"*),
a per-till breakdown that refuses to sum variances (*"two drawers out by opposite amounts is two
problems, and one total of zero would hide both"*), and a prominent *"Cash variance for the day:
not known — This is NOT a zero variance."* This is phase 14b/37 working exactly as intended.

One inconsistency: money renders in **monospace** here (`Rs 11,650.00`), whereas UI-SPEC §3.11
reserves Geist Mono for identifiers and makes every number tabular via `@layer base`. Minor, but
it is a second money-rendering appearance.

### 8.6 Settings — `evidence/shots/settings-desktop-light.png`

`/app/settings` renders **"Access denied"** for a branch manager, and the sidebar offers no
Settings entry for that role, so the page is unreachable by clicking. Brief §55's settings
architecture (General / Restaurant / Branches / Users / Roles / Permissions / Taxes / Payments /
Printers / Kitchen / Notifications / Integrations / Security / Appearance) **could not be audited**
— the roles that can reach it (`admin`, `owner`) require TOTP, which this session cannot satisfy.
**Stated limitation.**

### 8.7 Command palette — `evidence/shots/command-palette-query-desktop-light.png`

`components/ui/command-palette.tsx` is **87 lines**. `⌘K` opens a 384 × 250 dialog. Typing `ord`
returns **one** result — *"Dashboard"*, under a single category *"Navigation"* (a subsequence
match: d-a-s-h-b-**o**-a-**r**-**d**).

Brief §12 requires searching orders, customers, products, menu items, tables, employees,
suppliers, pages and settings, with categorised results, recent searches and quick actions. The
palette searches navigation labels and nothing else. UI-SPEC §0 calls the palette *"the primary
navigator"* and the thing that *"makes the two-tier nav survivable — if you can't find it, you
type it."* It cannot currently find anything.

---

## 9. Accessibility, measured

| check | result | brief § |
|---|---|---|
| **skip link** | **0** on every route (`a[href^='#']` count = 0) | §40 |
| **Tab presses to reach `<main>`** | **22** — first 21 stops are the branch switcher and sidebar links; #22 lands on the "Vendors" tab | §40 |
| focus indicator | `outline: 2px solid` on every stop — **phase 20's outline fix works** | §40 |
| focus scrolled into view | `inView: true` on every stop measured | UI-SPEC §9.1 |
| **`h1` count ≠ 1** | 4 screens at 0: `pos`, `pos-tills`, `orders`, `hr-attendance` | §40 semantic HTML |
| **interactive targets < 44px** | `purchasing-po` **108**, `purchasing-vendors` **63**, `inventory-ingredients` **62**, `hr-attendance` **31**, `inventory-stock` **30** | §16, §40 |
| inputs with no accessible name | 6, all on `/app/hr/attendance` | §22, §40 |
| `aria-modal` on dialogs | **unset** on all three probed | §40 accessible dialogs |
| horizontal page scroll | **0 routes at any of 390 / 768 / 1024 / 1440** | §38 |
| status conveyed by colour alone | **not found** — KDS carries 4 redundant channels (21-01); `StatusBadge` carries text | §40 |

The 22-tab figure is the one to act on. It is paid on **every page load**, by every keyboard user,
on all 65 routes.

---

## 10. Performance and dependencies

24 runtime dependencies. `dependency-budget.test.ts` (34-04, 31 tests) forecloses three.js and
friends **by name**, with a recorded negative control (`"three": "^0.160.0"` added → failed both
the denylist and the baseline → removed).

One live item: **`framer-motion@^12.41.0` is orphaned.** 34-03 removed `PageTransition` from the
tenant shell, so nothing reachable imports it, but it remains in `package.json`.
`components/shared/page-transition.tsx` and `page-transition-motion.tsx` are still on disk and
referenced by nothing — 34-03 recorded that *"leaving them WIRED was the actual defect"* and left
deletion to a follow-up.

One real bug, seen in the console on both themes:

```
TypeError: Failed to execute 'measure' on 'Performance':
'​FinancePage' cannot have a negative time stamp.
```

on `/app/finance`. Note the mark name begins with a **zero-width space** (`U+200B`) before
`FinancePage`.

---

## 11. What is out of phase 38's scope

| Item | Owner | Why |
|---|---|---|
| Migrating 62 raw `<select>` to the shared `Select`; live field validation; server error→field mapping | **Phase 35** (D-35-01…05, plans `35-06`…`35-14`, written and unexecuted) | Phase 35 exists precisely for this. Phase 38 owns only the *visual* form contract and the conformance gate that would catch the drift. |
| Negative stock (`-2987 KG`), `-Rs 2,116,690.70` valuation | Inventory correctness | A data/domain question, not a design one. |
| `Performance.measure` TypeError on `/app/finance` | Bug fix | Recorded here; not a design task. |
| POS Floor View vs `/app/tables` disagreement | Needs diagnosis first | Cannot design a floor plan over a surface that reports zero tables. |

---

## 12. Brief items that cannot be satisfied without backend work

Stated plainly rather than planned as a facade.

| Brief § | Blocked on | Evidence |
|---|---|---|
| **§13** KPI comparison, % change, trend, sparkline | period-over-period aggregates from `reporting-service`. `/dashboard/{branchId}/tiles` returns current values only. | tiles render value + caption; no comparison field exists to bind |
| **§17** Floor plan with 8 states, elapsed time, server, occupancy, transfer/merge/split | table occupancy, server assignment and seat-time in `pos-service`; and the Floor View↔Tables disagreement | `/app/tables` exposes name, seats, area, active only |
| **§19** Filter by server, customer, order type, date range | query parameters on the orders endpoint | only a status `<select>` exists |
| **§20** Expiry, wastage, reorder threshold, valuation columns | inventory fields not populated | "Expected date" is em-dash on all 84 PO rows |
| **§45** Dashboard personalisation that persists | per-user preference storage | `presets.ts` is static, `shown` is in-memory |
| **§52** Notification centre with categories, unread, severity | `notification-service` — **not registered in Eureka, no listener on its port**, no UI surface | §0 port scan |
| **§53** Activity timeline (order created → paid → kitchen → prepared → completed) | an entity-scoped event feed from `audit-service` | no such endpoint consumed today |
| **§55** Settings architecture | auditable only with TOTP; unknown how much exists | manager gets "Access denied" |

---

## 13. Summary of counts

| | |
|---|---|
| routes (`page.tsx`) | 65 |
| layouts | 9 |
| `.tsx` under `app/` + `components/` | 278 |
| **Tailwind type-scale classes vs contract type-token classes** | **986 : 1** |
| **distinct font sizes rendered** | **12** (contract declares 8 roles) |
| **`--text-body` (15px) text nodes product-wide** | **22** |
| bare `rounded` (off-ladder 4px) call sites | **145** |
| raw palette literals / distinct / files | **180 / 74 / 22 of 278** |
| **hand-rolled `<table>` files vs shared DataTable importers** | **37 : 4** |
| sticky table headers, live | **0 of 12** |
| row-selection checkboxes, live | **0** |
| **raw `<select>` elements / files vs shared `Select` importers** | **62 / 34 : 0** |
| status-badge implementations | **6** |
| files declaring their own `<h1>` (no `PageHeader` exists) | **60** |
| screens with `h1Count = 0` | **4** |
| confirmation-dialog implementations / shared primitives | **6 / 0** |
| **skip links** | **0** |
| **Tab presses to reach main content** | **22** |
| sub-44px interactive targets, worst screen | **108** (`/app/purchasing/purchase-orders`) |
| toast call sites | 184 (94 error / 93 success / 3 info / 1 warning) |
| `animate-spin` occurrences | 8 |
| **containing-block creators on POS** | **0** ✓ |
| **animations on POS** | **0** ✓ |
| routes with horizontal page scroll (390–1440) | **0** ✓ |
| runtime dependencies | 24, with a denylist gate |
| screenshots captured | 56 |
| **routes that could not be captured clean** | **2** (`hr-employees`, `hr-attendance` — `hr-service` down) |

---

*Phase 38 — ERP Design Transformation. Audit written 2026-08-12 against the live stack.*
