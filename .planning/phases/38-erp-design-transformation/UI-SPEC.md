---
phase: 38
slug: erp-design-transformation
status: draft
shadcn_initialized: true
preset: "radix-nova (existing — frontend/components.json)"
created: 2026-08-12
extends:
  - .planning/phases/20-design-system/UI-SPEC.md
  - .planning/phases/34-visual-design-language/SURFACE-MOTION-SPEC.md
source_of_truth: .planning/DESIGN-BRIEF.md
audit: .planning/phases/38-erp-design-transformation/38-AUDIT.md
implements_decisions:
  - D-38-01
  - D-38-02
  - D-38-03
  - D-38-04
  - D-38-05
  - D-38-06
  - D-38-07
  - D-38-08
  - D-38-09
  - D-38-10
---

# Phase 38 — UI Design Contract

> **This document extends. It replaces nothing.**
> Phase 20's `UI-SPEC.md` (tokens, 53 measured contrast pairings) and phase 34's
> `SURFACE-MOTION-SPEC.md` (zones, glass, depth, motion) remain authoritative and unchanged.
> Every value there still holds. This document adds the **application-level** contract the brief's
> steps 5–20 need: what each screen family owes, what it may spend, and what proves it.
>
> **A second design vocabulary is a defect, not a feature (D-38-01).** If a treatment you want
> does not exist in phase 20 or 34, the screen is wrong, not the system.

---

## 0. What this contract is calibrated against

Phase 20 §0 named the standard — Linear, Stripe Dashboard, Vercel, Retool: dense, fast,
keyboard-first tools. The brief adds the product comparison — Toast, Lightspeed, Square for
Restaurants, Oracle Hospitality. Both agree on the thing that matters here:

**Chrome recedes; the data is the interface; on a screen an operator hits 200 times a shift,
motion is latency.**

The audit found a product whose *token layer* is excellent and whose *application layer* has
never been held to it: 986 Tailwind type classes against 1 contract class, 37 hand-rolled tables
against 4 uses of the shared one, 62 raw `<select>` against 0 uses of the shared one, 6
status-badge implementations, 6 confirmation implementations, 0 skip links, 22 Tab presses to
reach content. **Phase 38 is not a styling pass. It is the adoption of a system that already
exists, plus the gates that stop it drifting again.**

---

## 1. Design System

| Property | Value |
|----------|-------|
| Tool | **shadcn/ui** — already initialised (`frontend/components.json`) |
| Preset | `"style": "radix-nova"`, `"baseColor": "neutral"`, `"cssVariables": true`, CSS-first |
| Component library | Radix via the unified `radix-ui@1.6.0` |
| Icon library | `lucide-react@1.21.0` |
| Font | Geist Sans / Geist Mono, wired via `next/font/google`, bridged in `globals.css` |
| Styling | Tailwind v4.3.1, CSS-first. **No `tailwind.config.js` exists and none is to be added** |
| Table engine | `@tanstack/react-table@8.21.3` (installed) |
| Charts | inline SVG (phase 21 precedent). **Recharts is not to be added** — see §9.3 |
| Runtime dependencies | **24. This phase adds zero.** `dependency-budget.test.ts` enforces it |

**Architecture constraint — non-negotiable.** The ESLint-enforced 4-layer boundary
(api-client → repositories → adapters/schemas → hooks) covers `components/**` **and** `app/**`
(widened in 20-01). Every component in this document takes **plain props** and receives data from
a Layer-3 hook. No component specified here fetches.

**Money.** BIGINT paisa, rendered only through `components/ui/money-display.tsx`. No second
formatting path, ever, including in a chart tooltip, a CSV export or a print template.

---

## 2. Spacing Scale

The phase-20 scale, unchanged, **now bridged into `@theme` so it is reachable** (D-38-02).

| Token | Value | Usage |
|-------|-------|-------|
| `xs` | 4px | Icon-to-label gap, chip inner padding |
| `sm` | 8px | Compact element spacing, table cell y-padding (compact density) |
| `md` | 16px | Default element spacing, card padding, table cell x-padding |
| `lg` | 24px | Section padding, page gutter (< 1024px) |
| `xl` | 32px | Layout gaps, page gutter (≥ 1024px) |
| `2xl` | 48px | Major section breaks |
| `3xl` | 64px | Page-level spacing, empty-state vertical padding |

**Exceptions — these and no others:**

| Exception | Value | Why |
|---|---|---|
| Control heights | 28 / 32 / 36 / **44** / 56px | Multiples of 4. 44 = WCAG 2.2 SC 2.5.5 target size; 56 = POS tile/action minimum |
| Order ticket panel | **360px** | Today ~300px, measured. Too narrow for a modifier line + quantity stepper + money without truncation |
| Shell bar height | 56px | 8 × 7 |
| Table row heights | **32px compact / 44px comfortable** | Both on the 4-grid; 44 = touch target. Measured today: 65px **and** 81px in the same table |

**Rule: pages do not set their own outer padding.** `PageBody` owns it.
`app/(tenant)/layout.tsx:105` hard-codes `p-4 lg:p-6 pb-20 md:pb-6` on `<main>`; that moves into
`PageBody`, which is what makes a full-bleed page (POS, KDS, floor plan) possible at all.

---

## 3. Typography

The phase-20 roles, unchanged in value, **bridged into `@theme` and adopted** (D-38-02).

| Role | Token | Size / line-height | Weight | Usage |
|------|-------|--------------------|--------|-------|
| Display | `--text-display` | 30 / 36 (1.2) | 600 | Operator numerals only — order total, till count, KPI value |
| Heading | `--text-h1` | 20 / 28 (1.4) | 600 | Page title — **exactly one per page** |
| Subheading | `--text-h2` | 16 / 24 (1.5) | 600 | Card / section title |
| Body | `--text-body` | **15 / 22 (1.47)** | 400 | Default body text |
| Small | `--text-small` | 13 / 18 (1.38) | 400 | Table cells, secondary metadata |
| Label | `--text-label` | 11 / 16 (1.45) | 600 | Column headers, chips — uppercase, `letter-spacing: 0.04em` |
| POS | `--text-pos` | 17 / 24 (1.41) | 500 | POS tile labels — legible at arm's length |
| KDS | `--text-kds` | 22 / 28 (1.27) | 600 | KDS item lines — legible at 2 m |

**Exactly two weights: 400 and 600.** `--text-pos` at 500 is the single declared exception — 600
at 17px reads shouty across a 5-column grid. `font-medium` is today the most-used weight in the
product (317 occurrences) and is specified for one surface; every other use converges to 400 or
600.

**Every number is tabular**, globally in `@layer base`, not per call site.
**Geist Mono is for identifiers only** — order numbers, SKUs, journal refs. Money uses Geist Sans
with tabular numerals; `/app/finance/takings` currently renders money in mono and converges.

### 3.1 The bridge, and why it is one plan and not sixteen

`globals.css:526-533` withheld these from `@theme` on purpose: bridging re-typesets ~700 call
sites at once. That was right when written. The audit measured what it cost — **`--text-body`
renders on 22 nodes product-wide** — and the cost now exceeds the risk.

The bridge lands in **38-01**, together with `PageHeader` / `PageBody`, and carries:

- a mapping from every legacy class to its role (`text-sm` → `--text-small` at 13, **not** 14;
  `text-xs` → `--text-label` at 11 where it is a label, `--text-small` where it is prose);
- **before/after screenshots at all four widths in both themes** for the ten densest screens,
  because a 1px type change across 700 call sites is a visual change whether or not anyone
  intended it;
- a conformance gate (§11.1) that fails on new Tailwind type-scale classes.

**No later plan is permitted to assume call sites migrate themselves.** Each screen plan migrates
its own.

---

## 4. Colour — 60 / 30 / 10

All values are phase-20 role tokens. **No new colour token is introduced by this phase.**

| Role | Token | Share | Usage |
|------|-------|-------|-------|
| **Dominant (60%)** | `--background` → `--surface-1` | page canvas, list bodies, table bodies | Light `--neutral-0`/`-50`; dark `--neutral-1000`/`-950` |
| **Secondary (30%)** | `--surface-2`, `--surface-3`, `--card`, `--border` | sidebar, top bar, card fills, table headers, section chrome | |
| **Accent (10%)** | `--primary` (`--primary-700` light / `--primary-400` dark) | see the reserved list below | |
| **Destructive** | `--destructive` (`--danger-600` / `--danger-400`) | destructive actions and failure states only | |

### 4.1 Accent is reserved for exactly these, and nothing else

1. The **one** primary action per screen region (Charge Now, Send to Kitchen, New Purchase Order, Save).
2. The active navigation indicator, and the active tab underline.
3. The focus ring (`--ring`).
4. Selected state on a POS tile, a table row and a floor-plan table.
5. `--chart-1`, the first data series.
6. Links in body prose.

**Not** on: every button, card borders, icons by default, hover fills, badges that are not
statuses, table headers, section headings, or decoration. An accent that marks everything marks
nothing.

### 4.2 Status colour is never carried by hue alone

Every status carries **icon + text + colour**, three channels. This is already true on the KDS
(21-01's four-channel ageing: border width 2/4/6px, distinct icon *shape*, literal chip text, and
a card **fill** change for late) and it is the standard the rest of the product adopts. The
weakest measured separation in the system is fresh/warn at **ΔE2000 8.3 under protanopia**, on the
most time-critical screen — which is why colour alone is forbidden, not discouraged.

### 4.3 The raw-literal residue converges

180 raw Tailwind palette literals across 22 files, concentrated in
`components/pos/till-session-bar.tsx` (15), `components/finance/TillVariancePanel.tsx` (8),
`components/purchasing/PoStatusBadge.tsx` (6), `components/pos/till-review.tsx` (5). These do not
follow the theme, do not follow `--brand-h`, and were never measured by phase 20's 53 pairings.
`till-session-bar.tsx` renders at the top of the POS and converges in **38-04**.

**Gate:** the no-raw-literal rule becomes machine-checked (§11.1) with a per-file baseline that
only ever decreases.

---

## 5. Zones — which screens get richness, and which get restraint

D-38-04. This is the decision that keeps the product fast, and the one an executor under deadline
violates indirectly — not by putting glass on the POS, but by putting glass on a shared `Card`
the POS imports.

| Screen | Zone | What it may spend | Why |
|---|---|---|---|
| Role dashboards | `expressive` | glass portlets, depth-2/3, hover lift, stagger entrance, pointer tilt on drillable tiles | Read a few times a shift, from a desk. Perceived quality lands here. |
| Reports & analytics | `expressive` | glass panels, chart reveal on first mount only | Same. |
| Login, onboarding | `expressive` | glass over a **declared** substrate, entrance | First impression; nobody navigates it 200 times. Already delivered (34-07). |
| SuperAdmin console | `expressive` | glass, depth | Low-frequency, high-trust. |
| Settings | `expressive` | glass section cards, depth-1 | Low-frequency. |
| Back-office lists, forms, CRUD | `restrained` | elevation, ≤150 ms transitions, hover surface change | Read all day, scanned fast. Depth for hierarchy, no decoration. |
| Menu management | `restrained` | elevation, image thumbnails | Frequent editing. |
| **POS terminal** | `operational` | depth cues only. **No `backdrop-filter`. No entrance animation. No parallax. No tilt.** | A cashier completes an order in under ten seconds during a rush, on the cheap Android tablet most restaurants actually use. And `app/pos/**` carries the receipt print path. |
| **KDS / BDS board** | `operational` | same | Read at 2 m across a hot kitchen. A distracting animation on a late ticket is a safety issue, not a taste one. |
| Shell chrome (`TopBar`, `Sidebar`, `MobileBottomNav`) | `restrained` | **even above the expressive dashboard** | They are siblings of page content and composite over the POS and the KDS. Chrome is bound by the poorest zone it can appear over. |

### 5.1 Modals inherit the zone that opened them (D-38-05)

Radix mounts overlays on `document.body`, outside every zone subtree, so a rule written against
DOM ancestry matches nothing — present in the stylesheet, absent on the screen. 34-01 solved this:
the overlay **stamps its own zone** from React context, and 34-02's glass rule keys on that
attribute.

Consequence, and it is a feature: a dialog opened from the dashboard may take overlay glass; a
dialog opened from a purchase-order list may not. Brief §29's "backdrop blur" is therefore
**zone-conditional, not global**. A blanket blur re-creates the compositing defect 34-01 removed.

Measured today: `[data-slot="dialog-overlay"]` under the tenant shell reports
`backdrop-filter: none`. **Correct. Do not "fix" it.**

### 5.2 The print-path rule, stated per route

`transform`, `filter`, `backdrop-filter`, `perspective`, `will-change` and paint/layout `contain`
each make an element the containing block for its `position: fixed` descendants — **at print time
as well as on screen**. `components/print/receipt-print.css:181` lifts the bill out of the app
shell with `position: fixed`, and that route lives under `app/pos/`.

| Route family with a print path | Rule |
|---|---|
| `app/(tenant)/app/pos/**` (receipt, charge) | **0 containing-block creators on any layout ancestor.** Measured today: 0. Re-measured by the gate on every run |
| `app/(tenant)/app/kitchen/**` (kitchen tickets) | same |
| Any screen gaining an export/print view | must add its route to the containment gate in the same commit |

Two further print rules, learned the hard way and not to be relearned:

- `body * { visibility: hidden }` has specificity (0,0,1) and **loses to every Tailwind utility**.
  Written that way it once printed the entire application sidebar onto a customer's bill.
  `receipt-print.css:148-166` carries the corrected form and its history.
- **`size: 80mm auto` is invalid CSS.** `auto` cannot follow a length in the `@page size` grammar;
  Chromium silently drops the whole declaration and prints US Letter.
- **Print output is verified by rendering a real PDF and extracting its text.** Never by reading
  CSS. Two print defects invisible from the DOM and invisible on screen were found only by
  rendering.

---

## 6. Component Inventory

Brief §43 and §67. **Finalize the primitives first, then use them everywhere.** Each row states
what exists today, measured.

### 6.1 Build (Wave 1) — the primitives every later plan consumes

| Component | Today | Contract |
|---|---|---|
| **`PageHeader`** | **does not exist**; 60 files declare their own `<h1>`; 4 screens have none | title (`--text-h1`, exactly one `<h1>`), optional description, meta row, one primary action, overflow menu |
| **`PageBody`** | does not exist; `layout.tsx:105` hard-codes page padding | owns page gutter (`lg` < 1024px, `xl` ≥ 1024px); `fullBleed` opt-out for POS / KDS / floor plan |
| **`DataGrid`** | `ui/data-table.tsx` exists, **4 importers, 37 hand-rolled tables** | §7 |
| **`FilterBar`** | does not exist | chips, removable, "Clear all", persisted per screen. §7.3 |
| **`ConfirmDialog`** | **6 independent implementations, 0 primitives** | §8.2 |
| **`StatusBadge`** (single) | **6 implementations** | icon + text + colour, one semantic map, `--text-label` |
| **`EmptyState`** | exists, 30 importers | §8.1 — heading, cause, next action |
| **`ErrorState`** | exists via `QueryBoundary`, 49 importers | already correct. §8.1 |
| **`Skeleton`** | exists, zone-aware (34-05), 34 importers | already correct |
| **`KpiCard`** | exists as `KpiTile` | §9.1 adds comparison slot |

### 6.2 Adopt (Waves 2–4)

`AppShell`, `Sidebar`, `Topbar`, `Breadcrumb`, `GlassCard` (`GlassPanel`, 34-04), `SearchInput`,
`CommandPalette` (§10), `Modal`, `Drawer`, `Dropdown`, `Tooltip`, `Popover`, `Tabs`, `Button`,
`IconButton`, `Input`, `Select` *(phase 35 owns migration)*, `DatePicker`, `Toast` (mounted),
`ChartCard`, `ProductCard`, `OrderCard`, `TableCard`, `KitchenTicket`, `UserAvatar`, `Pagination`,
`LoadingOverlay`.

**Rule (§43): a pattern implemented twice is a defect.** The conformance gate (§11.1) counts
implementations of `StatusBadge`, `ConfirmDialog`, `PageHeader` and `<table>` and fails on an
increase.

---

## 7. `DataGrid` — the one pattern that serves 30+ screens

The largest structural defect in the product (audit §5) and therefore the highest-leverage plan.

### 7.1 Required capabilities

Sorting · filtering · search · pagination · **sticky header** · row selection · bulk actions ·
column visibility · density toggle · empty / loading / error states · **responsive card fallback**
· keyboard row navigation with `scrollIntoView({ block: "nearest" })` on focus move.

### 7.2 Measured targets

| Property | Today (live) | Contract |
|---|---|---|
| `thead th` position | `static` on **12 of 12** tables | `sticky`, `top: 0`, `--z-sticky` |
| row height | **65px and 81px in one table** | **32px compact / 44px comfortable**, one value per table |
| row selection | 0 checkboxes anywhere | checkbox column when `bulkActions` is passed; **selected count always shown** |
| pagination | absent; 84 rows in one list | page size 25/50/100, `Page N of M`, or virtualised above 200 rows |
| mobile (390px) | 100 elements past the viewport on `/app/inventory/stock` | **card list below `md`** — primary line, secondary line, trailing value, row menu. Never a horizontally-scrolled desktop table |
| identifier columns | truncated UUIDs (`ca6ed037…`) | a **human identifier** — PO number, order number, SKU. If none exists, the column is not shown |
| empty columns | "Expected date" is em-dash × 84 | a column with no data on any row is not rendered |

### 7.2.1 Bridging a token into a Tailwind namespace is a product-wide change

**Added 2026-08-12, after 38-01 collapsed every dialog in the product to a 24px sliver.**

38-01 published the seven usage steps into Tailwind's `--spacing-*` namespace so `p-md` and
`gap-lg` would exist. In Tailwind v4 that namespace is **also** the one the width family
consults for a *named* key — and it takes precedence over `--container-*`. Measured by
compiling the shipped stylesheet:

| utility | before | after |
|---|---|---|
| `.max-w-sm` | `var(--container-sm)` — 24rem = **384px** | `var(--space-sm)` — **8px** |
| `.max-w-lg` | `var(--container-lg)` — 32rem = **512px** | `var(--space-lg)` — **24px** |

`components/ui/dialog.tsx` sizes its panel `sm:max-w-sm`, and **53 call sites** override it with
`max-w-md` / `max-w-lg` / `max-w-2xl`. Every dialog in the product — including screens no design
plan had touched — became unreadable.

**What makes this a spec item rather than a bug report:** `tsc` was clean, ESLint was clean, all
1,127 unit tests passed, and 38-01's own type-scale gate went green. jsdom does not apply the
stylesheet, so a `render()` + `getComputedStyle` test would also have passed. It was found by a
person looking at a screen. The collision is **total** — the contract's step names
(`xs sm md lg xl 2xl 3xl`) are exactly the container scale's keys — and re-declaring
`--container-sm` alongside was measured and does **not** help.

**The rule.** Before publishing into a Tailwind theme namespace, establish *every* utility family
that reads it. `--spacing-*` is read by padding, margin, gap **and** width/height/max-width/
min-width. The contract's steps therefore stay plain custom properties, consumed at call sites as
`p-(--space-lg)` / `gap-(--space-md)`, which compiles to `padding: var(--space-lg)` and can never
collide because it never enters a namespace.

**Gate:** `__tests__/lib/theme/sizing-namespace.test.ts` resolves each width utility through the
built stylesheet to a pixel value and fails below a dialog-sized floor; it also asserts
`--spacing-{step}` is undefined, so the failure names the cause rather than a symptom. Negative
control: reinstating the bridge produced 6 failures, the first reading *"max-w-sm resolves to 8px
— a width utility resolved from the spacing namespace"*. A second control shrank `--container-sm`
to `2rem` to prove the gate tracks the emitted value rather than asserting a constant.

### 7.2.2 A class present in the source is not evidence it is present in the DOM

**The general rule, and it is the most transferable thing phase 38 found.**

> **Any utility that composes class names can also delete them. Reading a class in the source is
> therefore not evidence that it reaches the element.** The only evidence is the rendered
> `className`, or the computed style.

The instance: `cn()` is `twMerge(clsx(...))`, and tailwind-merge resolves conflicts by classifying
each class into a group and keeping the last one per group. It knows Tailwind's stock font sizes
and it knows colour utilities — but 38-01's eight roles are **custom** theme keys, so an
unconfigured tailwind-merge classified `text-label` *by shape* as a text **colour** and dropped it:

```tsx
cn("text-label uppercase", "text-foreground-secondary")
// → "uppercase text-foreground-secondary"     the font size is simply gone
```

Nothing errored. `tsc` was clean. ESLint was clean. Every prop-based test passed, because the
props were correct — it is the *composition* that lost the class. Source review passes too: both
classes are right there on the line.

**Why this mattered more than the one component it was found in.** Adopting the contract type
scale is the through-line of waves 3–5, and most adoption goes through `cn()`. Unfixed, every
later plan would have produced call sites that look correct, review correct, test correct, and
render at whatever size they inherited — and the `--text-body`-on-22-nodes measurement the phase
exists to fix would have quietly reproduced itself under new names.

**Gates.** `__tests__/lib/utils-cn.test.ts`, and it is deliberately hard to remove by accident:

1. Each of the eight roles is asserted to survive `cn(role, colour)` — the runtime behaviour.
2. `lib/utils.ts` is asserted to contain `extendTailwindMerge`, so the one-line revert to bare
   `twMerge` fails loudly with a message naming the consequence rather than looking like a
   simplification during a cleanup.
3. **`TYPE_ROLES` is asserted to equal exactly the set of `--text-<role>` keys declared in
   `globals.css`.** A ninth role added to `@theme` without registering it here would reproduce the
   bug for that role alone, on whichever screen adopted it first. Observed red by adding
   `--text-caption`.

**Corollaries for the rest of the phase.** The same reasoning retires two assumptions:

- A gate that asserts on **props** is not testing what renders. Assert on rendered output.
- A gate that asserts on a **different element** than the contract names is not testing the
  contract. 38-02 shipped `sticky` on `<thead>`; the unit test asserted on `<thead>` and passed
  while Chromium reported `thead th { position: static }` — the exact property §7.2 measures.
- A gate that measures a **different quantity** than the defect is not testing the defect. 38-05's
  first station-counter check compared element bounding boxes and reported **0 collisions at every
  width in both themes** — against the code the audit had photographed rendering `PREPARINGREADY`.
  The labels overflow 26px cells and paint across their neighbours; the *boxes* never overlap.
  Re-measured on painted extent (`left + scrollWidth`) it reported 4 collisions at 1024px. **The
  only way to find this out is to run the check against known-bad code and watch it go red** —
  which is why D-38-07 requires the negative control be *observed*, not merely written.

### 7.3 `FilterBar`

Brief §48. Chips, discoverable, individually removable, `Clear all`, persisted per screen.
Worked example, and the copy contract:

```
Branch: Islamabad · Date: Aug 1–12 · Status: Completed        [Clear all]
```

The purchase-order screen's lone native `<select>` labelled "All statuses" is the current state of
the art and the thing this replaces.

### 7.4 Bulk actions

Brief §49. `{n} selected` is always visible when `n > 0`. Destructive bulk actions route through
`ConfirmDialog` and name the count: *"Archive 12 ingredients?"* — never *"Are you sure?"*

---

## 8. States

### 8.1 The four data states

| State | Contract |
|---|---|
| **Loading** | Contextual skeleton matching final dimensions. Shimmer on expressive/restrained, **still on operational** (34-05). Never a page-blanking spinner. 8 `animate-spin` occurrences remain and converge to skeletons |
| **Empty** | Heading + **why it is empty** + next action. `EmptyState` exists; the POS cart's *"Add items to start an order — Tap a menu item to build the cart; nothing is saved until Send to Kitchen or Charge"* is the standard |
| **Error** | **Never raw.** Cause in plain words + `[Try again]` + entered data preserved. Already correct: *"Couldn't load the employee roster. This module is temporarily unavailable. Try again in a moment."* **Character may only be added in the direction that RAISES salience** (34-05): depth yes, softening no, entrance animation no |
| **Success** | Localised. `Saving… → Saved`. Toast for out-of-context results, inline for in-context ones. Never freeze the interface |

### 8.1.1 Error boundaries are per-portlet, not per-page

`components/dashboard/manager-dashboard.tsx:167` wraps four queries and the entire first KPI row
in **one** `QueryBoundary`. One failing service replaces four tiles with one error box — which is
exactly what the audit's first screenshot captured.

**Contract: a `QueryBoundary` wraps the smallest region whose content is genuinely unavailable.**
A tile whose own query succeeded renders. A tile whose query failed shows an inline unavailable
state with its reason — the `unavailableReason` pattern already used correctly by the till-variance
tile (*"No till has been counted yet today"*) is the model.

### 8.2 `ConfirmDialog` and undo

Brief §50, §51. One primitive replacing six implementations.

| | Contract |
|---|---|
| Confirm | Only genuinely destructive or irreversible actions: delete, void payment, cancel order, close period, archive with dependants |
| Never confirm | Save, toggle availability, filter, sort, navigate |
| Copy | Names the object and the consequence: *"Void payment of Rs 5,046.00 for ORD-20260811-0017? This posts a reversing entry to the ledger."* |
| Confirm button | Restates the verb — `Void payment`, not `OK` |
| **Prefer undo** | Where the action is safely reversible: *"Product archived."* `[Undo]` — a toast with an action, not a dialog |

### 8.3 Copywriting Contract

| Element | Copy |
|---------|------|
| Primary CTA — POS | **`Charge Now`** / **`Send to Kitchen`** (existing, keep) |
| Primary CTA — list screens | `New {object}` — `New Purchase Order`, `New Journal Entry`, `Add table` |
| Primary CTA — forms | `Save {object}` / `Create {object}`. Loading: `Saving…` → `Saved` |
| Empty state heading | Names what is absent: `No purchase orders yet` |
| Empty state body | Cause + next action: `Purchase orders you raise with a vendor appear here. Create one to start tracking what you've ordered.` |
| Empty state CTA | `New Purchase Order` |
| Filtered-empty (distinct) | `No purchase orders match these filters.` `[Clear all]` — **never the same copy as truly-empty** |
| Error state | `Couldn't load {the thing}. {Plain cause}.` `[Try again]` |
| Permission denied | `You do not have permission to view this page.` `[Back to dashboard]` (existing, keep) |
| Unavailable figure | `Not known` + **why**, never `0` or `—` alone (existing on `/app/finance/takings`, and the product standard) |
| Destructive — void | `Void payment of {amount} for {order}? This posts a reversing entry to the ledger.` → `Void payment` |
| Destructive — archive | `Archive {name}? It stays on past records and stops appearing in new ones.` → `Archive {object}` |
| Destructive — cancel order | `Cancel {orderNo}? Items already sent to the kitchen stay on the board.` → `Cancel order` |
| Undo | `{Object} archived.` `[Undo]` |

**Rule:** an empty state that says `No data` is a contract violation. So is an error that shows a
status code.

---

## 9. Screens

### 9.1 Dashboard — `expressive`

Keep: 34-06's glass portlets, depth grid, hover lift, row stagger. Keep every portlet, its order
and its type — 34-06's rule that *"a screen's treatment change touches only className, never
composition"* stops applying now, but composition changes must be deliberate.

| Requirement | Contract |
|---|---|
| KPI card (§13) | icon · value (`--text-display`) · **comparison** · **% change** · **trend direction** · **sparkline** · hover lift |
| **Comparison data** | **Blocked on backend.** `/dashboard/{branchId}/tiles` returns current values only. The comparison slot is built and renders `Not compared yet` with a reason until `reporting-service` supplies period-over-period figures. **Do not fabricate a delta** (§68) |
| `fraction: 1` | **Delete.** `manager-dashboard.tsx:122` gives every 86'd item a full-width bar via `portlet.tsx:268`. A bar that is always 100% encodes nothing. Either bind a real fraction or render no bar |
| Elapsed time | `station-picker.tsx:83` renders `113h 52m`. Above 24h, render an **absolute date** and drop the urgency treatment — a four-day-old ticket is not "ACT NOW" |
| Error granularity | §8.1.1 |
| Role variance | §9.7 |
| Personalisation (§45) | show/hide and reorder in-session; **persistence is blocked on a per-user preference store** and is not built as a facade |

### 9.2 POS — `operational` — the screen where being wrong costs money

**Speed > decoration.** Brief §15, §16.

| Requirement | Contract |
|---|---|
| Layout | LEFT categories + search + tile grid · RIGHT order panel at **360px** (today ~300px) |
| Shell | The back-office sidebar, breadcrumb and global search do not belong on a terminal. **Reclaim the horizontal space**: collapse chrome to a 56px operator strip on the POS route |
| Product card | name · price · **image where available** · availability · quick-add. Tile min 56px, `--text-pos` |
| Touch | Every interactive target **≥ 44 × 44px**. Every hover behaviour has a touch equivalent (§16) |
| Feedback | tile press → ≤120 ms scale/highlight at `--motion-state`. **Cart mutation animates nothing** — `--motion-instant` (gate: 0 geometry transitions in the cart on mutation) |
| Forbidden | `backdrop-filter`, entrance animation, parallax, tilt, page transition, perpetual animation including a shimmer arriving through a shell suspense boundary |
| Colour | `till-session-bar.tsx`'s 15 raw emerald literals converge to `--success-*` role tokens |
| Responsive | **390px is currently broken** — the cart overlays and slices the grid. Below `md`, order panel becomes a bottom sheet with a persistent total bar; grid goes full-width |
| Heading | `h1Count` is 0 today; must be 1 |
| Print | 0 containing-block creators on the route. **Gate, re-measured every run** |

**Latency.** Phase 34 measured tap-to-cart at **79–99 ms** on a real path with an open till. That
figure is an *observation on shared developer hardware and is never the gate*. The gates are the
deterministic computed-style assertions: 0 filters, 0 animations, 0 geometry transitions, 0
containing-block creators.

### 9.3 KDS / BDS — `operational` — read at two metres

Keep 21-01's four-channel ageing verbatim: border width 2/4/6px · icon **shape** (`Clock` /
`AlertTriangle` / filled `Flame`) · literal chip text (`mm:ss` / `+DUE` / `+LATE`) · **card fill
change** for late. Keep `getAgingTreatment`'s fraction logic, which scales with each station's own
`escalationThresholdSeconds`.

| Requirement | Contract |
|---|---|
| **Station chip collision** | `PREPARING` and `READY` overlap into `PREPARINGREADY` at 1440px on both cards in both themes. Re-lay-out the four counters so labels cannot collide at any width |
| Columns (§18) | NEW · PREPARING · READY · COMPLETED |
| Ticket | order number · table · elapsed · priority · items **one per line** at `--text-kds` · modifiers **bold beneath their own item** · notes in a distinct block · server |
| Elapsed | as §9.1 — above 24h show a date, not `113h 52m` |
| Board chrome | The dark board currently floats inside light shell chrome. The board owns its viewport: full-bleed via `PageBody`, station header only |
| Motion | State changes update in place. **No entrance animation, no attention-seeking loop.** Critical alerts are obvious by fill and border, not by movement |
| Density | Column count adapts to viewport; a ticket never truncates an item name |

### 9.4 Orders & tables

| Requirement | Contract |
|---|---|
| Order list | `DataGrid` + `FilterBar`. **Order number, never a truncated UUID.** Status and payment-status badges, contextual row actions, expandable detail |
| Row height | 44px comfortable / 32px compact. Not 65–81px |
| Filters (§19) | status · payment status · order type · date range now. **Server, customer and branch facets are blocked on query parameters the orders endpoint does not accept** |
| **Floor view** | **Blocked, and blocked on a defect, not a design gap.** The POS Floor View renders *"No tables configured"* while `/app/tables` lists five tables for the same branch. Diagnose before designing |
| Floor plan (§17) | Eight states, elapsed time, server, current order and transfer/merge/split **require occupancy, seat-time and server-assignment data that `pos-service` does not expose**. The spec declares the visual vocabulary; the phase builds only what real data supports |
| `/app/tables` | Stays the admin CRUD surface, on `DataGrid`, with the shared `StatusBadge` |

### 9.5 Inventory · Menu · Purchasing — `restrained`

| Requirement | Contract |
|---|---|
| All lists | `DataGrid` + `FilterBar` + card fallback below `md` |
| Low stock | icon + text + colour, never colour alone. Visually obvious without being alarming on every row |
| Negative on-hand | `-2987 KG` renders today with no explanation. Negative on-hand gets a **stated reason** or an inline `Why?`; it is never presented as an ordinary quantity |
| Menu availability toggle | immediate optimistic visual feedback + toast; failure reverts and says why |
| Product cards | image where available, name, price, category, availability |
| Purchase orders | human PO number; drop the all-em-dash column; paginate the 84-row list; sticky header |

### 9.6 Customers · Staff · Finance — `restrained`

| Requirement | Contract |
|---|---|
| Lists | `DataGrid` |
| Finance tables | `AccountTable`, `GeneralLedger`, `JournalEntryTable`, `ApAgingTable`, `ArAgingTable`, `TransactionRegister`, `TillVariancePanel` migrate to `DataGrid`. **Money through `MoneyDisplay` only**; negatives keep parentheses so the sign survives greyscale and dichromacy |
| `/app/finance/takings` | **The reference screen.** Its honesty pattern — `Not known` with a stated reason, refusal to sum variances — is the product standard. Change only its money font (mono → tabular Geist Sans) |
| HR | **Not visually audited — `hr-service` is down.** `/app/hr/attendance` has **6 unlabelled inputs, 3 unnamed controls and no `<h1>`** from source. Re-audit against a running service before executing |

### 9.7 Role-aware UX (§46, D-38-06)

Not "hide buttons". The interface is *designed around each role's workflow*.

| Role | Lands on | Default density | Primary action | Ordering |
|---|---|---|---|---|
| **OWNER** | Dashboard — revenue, profit, branch comparison | comfortable | period/branch selector | strategic first; operational exceptions below |
| **MANAGER** | Dashboard — *"What needs me in the next five minutes?"* (existing, and right) | comfortable | resolve the top exception | exceptions first: late tickets, open tills, variances |
| **CASHIER** | **POS terminal**, not a dashboard | touch | `Charge Now` | cart above all else; back office is a link, not a home |
| **KITCHEN** | **KDS board** at their station | wall | bump ticket | oldest/most urgent first; nothing else on screen |
| **INVENTORY MANAGER** | Stock levels with low-stock filter pre-applied | compact | `Count` / `Receipt` | shortages first |

Landing route, default density, pre-applied filters and primary action are **role properties**,
declared as data beside the existing permission matrix — which is frozen by
`nav-permission-matrix.test.tsx` and is not touched.

### 9.8 Settings & auth — `expressive`

Login is **done** (34-07): glass over a measured substrate, 18.01:1 filter-disabled / 17.73:1
composited. Do not redo it.

Settings (§55) groups into General · Restaurant · Branches · Users · Roles · Permissions · Taxes ·
Payments · Printers · Kitchen · Notifications · Integrations · Security · Appearance. **Never one
enormous page.**

> **Stated limitation:** settings **could not be audited**. A manager gets "Access denied", and
> the roles that reach it require TOTP this session cannot satisfy. The settings plan begins with
> an audit under a TOTP-capable persona; its scope is provisional until then.

---

## 10. Command palette (§12)

`components/ui/command-palette.tsx` is **87 lines**. Typing `ord` returns one result — *Dashboard*
— under one category, *Navigation*, by subsequence match. Phase 20 §0 calls the palette *"the
primary navigator"*. It cannot currently find anything.

| Requirement | Contract |
|---|---|
| Scope | orders · customers · products · menu items · tables · employees · vendors · pages · settings |
| Categories | grouped, labelled, keyboard-navigable |
| Matching | prefix and word-boundary. **Subsequence matching is removed** — it is why `ord` matched `Dashboard` |
| Recents | last 5 selections, per user |
| Quick actions | `New order`, `Open till`, `New purchase order` — permission-filtered through the existing hooks |
| Shortcut | `⌘K` / `Ctrl+K` (works today) |
| Data | Layer-3 hooks only. **The palette does not fetch** |
| Empty | `Nothing matches "{query}".` + the categories searched |

---

## 11. Accessibility & interaction

| Requirement | Today (measured) | Contract |
|---|---|---|
| **Skip link** | **0** | `Skip to content` as the first focusable element on every page, visible on focus |
| **Tabs to reach `<main>`** | **22** | **≤ 2** via the skip link |
| Focus indicator | `outline: 2px solid` ✓ | keep — phase 20's outline fix survives Windows High Contrast where `ring` did not |
| Focus scrolled into view | ✓ | keep — `scrollIntoView({ block: "nearest" })` on grid focus move, because outlines **are** clipped by `overflow: hidden` |
| `<h1>` per page | 4 screens at 0 | **exactly 1**, owned by `PageHeader` |
| Target size | 108 sub-44px controls on one screen | **≥ 44 × 44px** for every operational control; back-office rows may use 32px with a 44px hit area |
| Input labelling | 6 unlabelled on `/app/hr/attendance` | every input labelled. **Placeholder is never the label** — already true in both audited dialogs |
| Required fields | **0 marked** in both audited dialogs | required marked visually **and** via `aria-required` |
| `aria-modal` | **unset** on all three dialogs probed | set on every dialog |
| Status by colour alone | not found ✓ | keep: icon + text + colour |
| Reduced motion | ✓ decorative motion **removed**, not shortened; feedback survives | keep. Imperative motion consults `useReducedMotion()`, because no stylesheet reaches a transform written from an event handler |
| Contrast | 53 pairings + 20 glass rows, all AA; binding constraint **5.34:1** | no new pairing ships unmeasured |

**Responsive breakpoints.** One coherent set: 390 (mobile) · 768 (tablet) · 1024 (laptop) ·
1440 (desktop) · 1920+ . Verified today: **0 routes produce horizontal page scroll at any width.**
That property is kept. What is *not* kept is content clipped inside containers — 100 elements past
the viewport on `/app/inventory/stock` at 390px, and the POS cart slicing the menu grid.

### 11.1 The conformance gates

Every gate below is **watched failing before it is trusted** (D-38-07), with the negative control
recorded *as observed* in the gate's own docblock.

| # | Gate | Fails when | Negative control to run |
|---|---|---|---|
| G1 | Type-scale conformance | a new `text-{xs..3xl}` class appears above the per-file baseline | add `text-2xl` to a migrated file |
| G2 | Radius conformance | bare `rounded` appears above baseline | add `rounded` to a migrated file |
| G3 | Raw-literal conformance | a `bg-*/text-*/border-*-{50..950}` palette literal appears above baseline | add `bg-emerald-500` |
| G4 | Pattern-duplication | `<table>`, `StatusBadge`, `ConfirmDialog` or `<h1>` implementation counts increase | add a second `<table>` |
| G5 | Zone containment (static + runtime) | glass/filter reaches a non-expressive surface | add `backdrop-blur` to a shared `Card` |
| G6 | **Containing-block / print safety** | any containing-block creator on `app/pos/**` or `app/kitchen/**` | add `transform: translateZ(0)` to the POS layout |
| G7 | **Print output** | rendered PDF text contains sidebar/nav strings, or page size ≠ 80mm roll | reinstate `body * { visibility: hidden }` without `!important` |
| G8 | Motion vocabulary | a duration > 240 ms outside `expressive`; a decorative keyframe with a non-identity resting state | set `.vdl-enter` resting `opacity: 0` |
| G9 | Reduced motion, **both directions** | motion present under the preference, **or absent without it** | disable the entrance entirely and watch the positive half fail |
| G10 | Operational latency invariants | filters ≠ 0, animations ≠ 0, cart geometry transitions ≠ 0 on POS | add a `transition: height` to a cart line |
| G11 | Contrast | any new pairing below 4.5:1, or a glass fill drift | move a fill alpha 0.72 → 0.70 and watch two rows fail |
| G12 | Accessibility invariants | skip link absent · `h1 ≠ 1` · an unlabelled input · an operational target < 44px | delete the skip link |
| G13 | Dependency & bundle budget | a new runtime dependency, or CSS/JS above baseline | add `"three": "^0.160.0"` |

**Gate hygiene, from phase 34's five vacuous gates.** A gate must not be anchored to a surface
that renders an error when a backing service is down (that is how the positive control silently
*skipped* for weeks). A gate must not match a class name within N characters of a rule (it picks
up the neighbour). A gate must not wait on a `testid` that does not exist (it spends its timeout
and reports the timeout as a measurement). A theme-switching harness must **assert the theme took
effect**. Every gate here anchors on an element it also asserts is attached.

---

## 12. Registry Safety

| Registry | Blocks used | Safety gate |
|----------|-------------|-------------|
| shadcn official | existing `radix-nova` preset components only | not required |
| **third-party** | **none** | **not applicable — no third-party registry is declared, and adding one requires `npx shadcn view` review before it enters this contract** |

**Dependency budget: 24 runtime dependencies. This phase adds zero.**
`dependency-budget.test.ts` forecloses three.js and friends by name — the option was considered
and rejected at ~600kB, not merely never raised. Charts stay inline SVG (phase 21's precedent);
Recharts is not added for a sparkline.

---

## 13. What this phase does not build

Stated so no plan quietly builds a facade over it. Full evidence in `38-AUDIT.md` §12.

| Brief § | Not built | Blocked on |
|---|---|---|
| §13 | KPI comparison / % change / sparkline **data** | period-over-period aggregates from `reporting-service` |
| §17 | Floor plan with 8 states, elapsed time, server, transfer/merge/split | occupancy, seat-time, server assignment in `pos-service` — **and** the Floor View ↔ Tables disagreement |
| §19 | Server / customer / branch order facets | query parameters the orders endpoint does not accept |
| §20 | Expiry, wastage, valuation columns | inventory fields not populated |
| §45 | Personalisation that **persists** | per-user preference storage |
| §52 | Notification centre | `notification-service` is not registered and has no listener |
| §53 | Activity timeline | an entity-scoped event feed from `audit-service` |
| §55 | Settings architecture, scoped | not auditable without TOTP; scope provisional |
| — | `<select>` migration, live validation, server-error→field mapping | **Phase 35** owns it (D-35-01…05) |

---

## 14. Checker Sign-Off

- [ ] Dimension 1 Copywriting: §8.3 — CTA, empty, filtered-empty, error, unavailable, 3 destructive confirmations, undo
- [ ] Dimension 2 Visuals: §5 zones per screen, §6 inventory, §7 DataGrid, §9 screens
- [ ] Dimension 3 Color: §4 — 60/30/10 with an explicit accent reserved-for list; no new token
- [ ] Dimension 4 Typography: §3 — 8 roles, 2 weights, bridge plan, measured baseline
- [ ] Dimension 5 Spacing: §2 — 8-point scale with 4 declared exceptions
- [ ] Dimension 6 Registry Safety: §12 — no third-party registry; zero new dependencies

**Approval:** pending

---

*Phase 38 — ERP Design Transformation. Written 2026-08-12 against `.planning/DESIGN-BRIEF.md`,
`38-AUDIT.md`, phase 20 `UI-SPEC.md` and phase 34 `SURFACE-MOTION-SPEC.md`.*
