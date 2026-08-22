# APP-POS-KDS-AUDIT — the operational surfaces, measured

Read-only audit. Every claim below carries a `file:line`, a grep count, or a value read out of a
committed evidence JSON. Where something is absent, the command that proved it is quoted.
Nothing was edited, no server was started, no build was run.

Branch at time of audit: `phase-13-access-repair`. Working tree of `frontend/components/{pos,kds}`
and `frontend/app/(tenant)/app/{pos,kitchen}` is **clean** (`git status --porcelain` on those paths
returned no rows), so every file read is the committed state.

---

## 1. Inventory — what the operational surfaces actually consist of

`find frontend/components/{pos,kds,ops,stations,terminals,print} -type f` → 53 files, 15,669 lines.

| Area | Files | Largest |
|---|---|---|
| `components/pos/` | 23 | `charge-summary.tsx` 1111 · `order-management.tsx` 997 · `order-panel.tsx` 833 · `till-review.tsx` 832 · `pos-terminal.tsx` 650 |
| `components/kds/` | 13 | `station-board.tsx` 872 · `expo-board.tsx` 655 · `kds-clear-stale.tsx` 459 · `station-picker.tsx` 351 |
| `components/print/` | 4 + 3 tests | `receipt-document.tsx` 263 · `receipt-view.tsx` 252 · `receipt-print.css` 206 |
| `components/stations/` | 3 | `station-form-dialog.tsx` 222 |
| `components/terminals/` | 4 | `terminal-form-dialog.tsx` 259 |
| `components/ops/` | 2 | `fleet-health-list.tsx` 139 |

Routes (`find frontend/app/(tenant)/app/{pos,kitchen,tables,stations,terminals} -type f`) — 14 files:

```
pos/layout.tsx · pos/page.tsx · pos/tills/page.tsx
pos/orders/[orderId]/charge/page.tsx · pos/orders/[orderId]/receipt/page.tsx
kitchen/page.tsx · kitchen/expo/page.tsx
kitchen/[stationCode]/page.tsx · [stationCode]/cleared/page.tsx · [stationCode]/orders/[ticketId]/page.tsx
tables/page.tsx · tables/TableFormDialog.tsx · stations/page.tsx · terminals/page.tsx
```

`components/ops/fleet-health-list.tsx` is **not an operational-zone surface** — its only importer is
`app/(tenant)/app/settings/health/page.tsx` (`grep -rn 'fleet-health-list'`). It is a `restrained`
back-office screen and is out of the POS/KDS zone question, though its file header already documents
the print-path constraint (`fleet-health-list.tsx:31-36`).

---

## 2. The POS terminal — current layout and component structure

### 2.1 Route composition

`app/(tenant)/layout.tsx:83-107` is the shell every POS route renders inside:

```
<div class="flex h-screen overflow-hidden">
  <Sidebar/>                      ← components/shared/sidebar.tsx:161, <aside class="… w-64">  = 256px
  <div class="flex flex-1 flex-col overflow-hidden">
    <TopBar/>                     ← breadcrumb, ⌘K, notifications, theme, profile
    <main class="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 md:pb-6">   ← 16/24px gutter
```

`app/(tenant)/app/pos/layout.tsx` adds **only** `ZoneProvider zone="operational"` +
`<OfflineIndicator/>` + `<SyncStatusBadge/>` (lines 44-48). It does **not** collapse the shell.
There is no operator strip, no `PageBody fullBleed`, no route group that escapes the sidebar.

`app/(tenant)/app/pos/page.tsx` composition, top to bottom:

| y-order | Element | Source |
|---|---|---|
| 1 | `<h1 class="sr-only">Point of sale</h1>` | `pos/page.tsx:104` |
| 2 | `TillSessionBar` | `:108` |
| 3 | Tab bar — *POS Terminal · Floor View · Order Management* + `PosConnectionBadge` | `:111-128` |
| 4 | View body (`flex-1 overflow-hidden`) | `:131` |

Three views behind a `useState<PosView>` — no URL state (`pos/page.tsx:26`). The terminal is
remounted on binding change via `key={terminalBinding.orderId ?? tableId ?? "unbound"}` (`:165`),
which is what resets the cart between parties.

Two guard branches precede the terminal: `tillUnavailable` → `QueryErrorNotice` (`:140-151`) and
`tillClosed` → the "Your till is closed" panel (`:152-162`). The `!tillQuery.isError` clause at
`:65` is what separates "no till" from "no answer".

### 2.2 `pos-terminal.tsx` — the two-column body

`pos-terminal.tsx:456-527`:

```
<div class="flex h-full flex-col gap-0 overflow-hidden">              ← :458
  {sendFailure && <SendFailureBanner/>}                                 :459
  <div class="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden lg:flex-row">   :487
    <div class="min-h-0 flex-1 overflow-hidden border-b lg:border-b-0 lg:border-r">  ← MenuGrid  :489
    <div class="flex max-h-[32vh] w-full min-h-0 shrink-0 flex-col overflow-hidden
                lg:max-h-none lg:w-80">                                 ← CustomerPicker + OrderPanel  :498
```

- **Cart column = `lg:w-80` = 20rem = 320px** (`pos-terminal.tsx:498`). UI-SPEC §9.2 and 38-04 task 2
  require **360px**. Short by 40px.
- Breakpoint is `lg` (1024px), not `md`, with the reasoning recorded inline (`:481-486`): at 768px
  two columns leave the grid 159px.
- Below `lg` the order panel is a **stacked block capped at `max-h-[32vh]`**, not a bottom sheet and
  not a persistent total bar.
- The comment at `:456-457` and `:485-486` states the no-transform/filter rule explicitly and ties it
  to the receipt print path. That discipline is real and visible in the code.

### 2.3 Category filtering and the menu grid — `menu-grid.tsx`

| Concern | Implementation |
|---|---|
| Search | `menu-grid.tsx:136-143`, `h-11` input, 150ms debounce (`:51`), client-side filter over the loaded category (`:89-91`) |
| Scope switch (admin preview) | `MenuScopeSwitch` above the rail, `:162-172`; narrows **both** pills and items (`:79-87`) |
| Category rail | `:186-216` — `flex overflow-x-auto lg:flex-wrap`; one scrolling row on phone, wrapped on a till. `All` pill at `:187`, server categories at `:201`. Every pill `min-h-11` (`:190`, `:206`) |
| Item count | `:265-271`, `"N items"` / `"X of Y items match"` |
| Grid | `:308` — `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-1` |
| Tile | `:319-325` — `min-h-[100px] min-w-[100px] … rounded-xl border … active:scale-95` |
| Image | `:334-341` — `MenuItemImage variant="cover" aspect-[4/3]`, gated on `showImages = filteredItems.some(i => !!i.imageUrl)` (`:110`) — a **whole-set** decision, not per item |
| Name / price | `:348` `font-medium text-sm line-clamp-2`; `:349-352` `MoneyDisplay … text-sm font-mono` |
| Quick-add badges | `:355-372` — qty pill and remove `×`, both `min-h-[22px] min-w-[22px]` |
| Error before empty | `:275-294` — `QueryErrorNotice` checked before `filteredItems.length === 0` |

**Against the 38-04 task-3 product-card contract:** name renders at `text-sm` (14px), **not**
`--text-pos` (17px). Price renders at `text-sm text-muted-foreground`, not a price role. **There is
no availability channel on the tile at all** — `grep -n 'available\|outOfStock\|avail' menu-grid.tsx`
returns nothing. Image ✅, quick-add ✅, min tile 100px ✅ (contract asks 56px).

### 2.4 Cart / order flow — `cart-reducer.ts` + `order-panel.tsx`

`cart-reducer.ts` (278 lines) is a pure module: `addLine`, `incrementLine`, `decrementLine`,
`removeLine`, `clearCart`, `cartLineKey(menuItemId, modifierIds, notes)`, plus money derivations
(`cartTotalPaisa`, `cartTaxPaisa`, `cartServiceChargePaisa`). Cart state is lifted into
`pos-terminal.tsx`, so it survives category switches and `MenuGrid` remounts (`menu-grid.tsx:27-32`).

Flow, as coded in `pos-terminal.tsx`:

```
tile tap → handleItemSelect
   ├─ item has modifier groups → ModifierDialog (mounted at terminal level, :510-530,
   │                             so it survives a category switch) → commitItem
   └─ no groups                → addLine directly
cart (client-only, never persisted per keystroke)
   ├─ Send to Kitchen  → persistCart() then fireToKitchen()      (:340-393)
   ├─ Charge Now       → persistCart() then router.push(.../charge)  (:400-421)
   └─ Save as Draft    → persistCart(), clear cart, reset type/table (:428-455)
```

Failure handling is two-outcome by design: `SendFailure { orderPersisted, orderNo, reason }`
(`pos-terminal.tsx:39-…`) drives a **persistent** `role="alert"` banner (`:620-660`) — *"Order X was
NOT sent to the kitchen"* vs *"Not sent — nothing was saved"*. This is the strongest error UX on any
surface in this audit and must not be flattened by a redesign.

`order-panel.tsx` structure (`:190-320` cart mode, `:438-540` persisted-order mode):

| Row | Line | Size |
|---|---|---|
| Header — `OrderTypeToggle` + `TableSelectCombobox` | `:192` | toggle buttons `min-h-11` (`order-type-toggle.tsx:37`) |
| Line list `flex-1 min-h-0 overflow-y-auto divide-y` | `:200` | |
| Qty − / + | `:354`, `:365` | **`min-w-[32px] min-h-[32px]`** |
| Remove × | `:385` | **`min-w-[32px] min-h-[32px]`** |
| Totals block (subtotal / discount / tax / service charge / total) | `:226-278` | `text-sm`, total `text-base` |
| Send to Kitchen | `:288` | `w-full py-3 … active:scale-[0.98] transition-all` |
| Save as Draft / Charge Now | `:298`, `:308` | `flex-1 h-12` |

### 2.5 Table selection — two different mechanisms

1. **In-cart picker** — `table-select-combobox.tsx`. Custom (not radix): trigger `h-11 w-full`
   (`:93`), popover `absolute z-20` (`:102`), search `h-8` (`:114`), `<ul role="listbox">`
   (`:117`) with options at `px-2 py-1.5` (`:122`, `:171`) → **~30px option rows, sub-44px**.
2. **Floor View** — `table-floor-view.tsx`. `grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3
   p-4` (`:131`), tile `touch-target min-h-[80px] rounded-xl border-2 … active:scale-95` (`:177`).
   `.touch-target` is `min-height:44px; min-width:44px` (`app/globals.css:838-841`). An `AVAILABLE`
   tap starts a new order bound to that table; `OCCUPIED`/`NEEDS_BUSSING` opens
   `OrderTableDetailDrawer` (`pos/page.tsx:170-185`, `table-floor-view.tsx:93-99`).

`app/(tenant)/app/tables/page.tsx` is the **admin** table catalogue and is already migrated — it is
one of only ten files in the product that import `PageBody`/`PageHeader` (`:13-14`, `:115-116`).

---

## 3. The print path, and exactly why it constrains styling

`components/print/receipt-print.css` — 206 lines, imported by `receipt-view.tsx:18`. The route is
`app/(tenant)/app/pos/orders/[orderId]/receipt/page.tsx`, i.e. **inside `app/pos/`**, so it inherits
`pos/layout.tsx`'s operational zone and every ancestor of the app shell.

Three mechanisms, all load-bearing:

1. **`@page { size: 80mm 297mm; margin: 0 }`** (`:39-42`). The header at `:15-38` records the measured
   Chromium behaviour: `size: 80mm auto` is *invalid CSS*, is dropped whole, and produced a
   **215.90 × 279.40mm US Letter** PDF; `size: 80mm` produced an **80.09 × 80.09mm square**. This is
   why the gate must read the PDF MediaBox, not the rule text.
2. **`body * { visibility: hidden !important }`** (`:152-154`) then `.receipt-root, .receipt-root * {
   visibility: visible !important }` (`:156-159`). The `!important` is documented at `:146-151` as
   load-bearing: `body *` is specificity (0,0,1) and lost to any utility class, and the first version
   of this file printed `"OVERVIEW" / "Dashboard" / "POS"` above the bill in `pdftotext` output.
3. **`.receipt-root { position: fixed; top:0; left:0 }`** (`:180-187`), so the bill anchors to the page
   box instead of to the shell's layout.

**The constraint, stated exactly.** `transform`, `filter`, `backdrop-filter`, `perspective`,
`will-change` and paint/layout `contain` each make an element the containing block for its
`position: fixed` descendants — *at print time as well as on screen*. Any one of them on any ancestor
of `.receipt-root` re-parents the bill back into the app shell and reintroduces both original
defects: sidebar text on the bill, and a clipped right-hand column (which means a **clipped total**).
The CSS says this itself at `:174-178`.

Consequences that bind any redesign:

- No glass, no blur, no lift/tilt, no scale, no `will-change`, no `contain: paint` anywhere on
  `(tenant)/layout.tsx`, `pos/layout.tsx`, `pos-terminal.tsx`, or any shared component the POS
  imports — **including a shared `Card`**. `components/ui/card.tsx:11` confirms glass is opt-in per
  call site rather than baked in, and `globals.css:877-907` gates every `.glass-surface` /
  `[data-slot="dialog-overlay"]` blur behind `[data-zone="expressive"]`. That cascade gate is what
  currently protects the print path.
- A tile photo may not use an overlaid caption, because a legible overlay needs a scrim, and a scrim
  is a `filter`/`backdrop-filter` on the tile. `menu-grid.tsx:327-333` records this decision and
  stacks photo-above-text instead.
- The current measured state is clean: **0 containing-block creators, 0 running animations on
  `/app/pos` at 390 / 768 / 1024 / 1440** — `evidence/verify-38-wave3-after.json`, key
  `pos.<width>.containingBlockCreators` / `.animations`, all `0`, `offenders: []`.

---

## 4. Touch-target sizes actually used

Declared sizes, by grep, not by inference:

| Size | Where | Count |
|---|---|---|
| `min-h-11` (44px) | `menu-grid.tsx` ×2 (category pills), `till-session-bar.tsx` ×4, `order-type-toggle.tsx` ×1, `modifier-dialog.tsx` ×1, `kds-clear-stale.tsx` ×6 | 14 |
| `touch-target` (44×44 via `globals.css:838`) | `table-floor-view.tsx:177` | 1 |
| `min-h-[100px]` | menu tile `menu-grid.tsx:320` | 1 |
| `h-12` (48px) | `order-panel.tsx:298,308` (Draft / Charge Now), `charge-summary.tsx:703` | 3 |
| **`min-h-[32px]`** | `order-panel.tsx:354,365,385` (qty −, qty +, remove), `pos-terminal.tsx:644`, `menu-grid.tsx:149` | 5 |
| **`min-h-[22px]`** | `menu-grid.tsx:359,367` (qty badge, remove-from-cart ×) | 2 |
| **`min-h-8`** (32px) | `menu-scope-switch.tsx:125,140` | 2 |
| **`h-9`** (36px) | `order-management.tsx:657`, `charge-summary.tsx:941,957,966` | 4 |
| **`px-2 py-1 text-xs`** (≈24-26px tall) | `order-table-detail-drawer.tsx:331,342,352,366,373,447,454,535`; `void-refund-dialog.tsx:401,450` | 10 |
| **`px-2 py-1.5 text-sm`** (≈30px) | `table-select-combobox.tsx:122,171` (every table option) | 2 |

Live measurement (`evidence/verify-38-wave3-after.json`, `pos.<w>.touch.count`):

| Viewport | sub-44 controls | Who |
|---|---|---|
| 390 | **0** | — |
| 768 / 1024 / 1440 | **3** each | `<a>Dashboard`, `<a>POS`, `<a>Customers` — 239 × **36**px — the back-office sidebar links |

**Read that measurement with its caveat.** `TOUCH_TARGETS` in `e2e/verify-38-wave3.mjs:69-80` skips
zero-size and `visibility:hidden` elements. The 32px qty steppers, the 22px cart badges and the 30px
table-picker options **only exist when a cart has lines or a popover is open**, and the probe drove an
empty cart with no popover. The `0` at 390px is therefore *"0 among the controls that were on screen"*,
not *"0 sub-44px controls in the POS"*. Ten sub-44px classes above are unmeasured by this run.

---

## 5. The KDS board — layout and structure

### 5.1 Routes and shell

`kitchen/page.tsx` → `StationPicker`. `kitchen/[stationCode]/page.tsx` → `StationBoard`. Both wrap
all fallbacks in `ZoneProvider zone="operational"` individually (`[stationCode]/page.tsx:33,47,59`) —
a permission-denied kitchen screen is still a kitchen screen.

Neither route imports `PageBody` or `PageHeader`
(`grep -rn 'PageBody\|PageHeader' app/(tenant)/app/kitchen` → no rows). The board therefore renders
inside `<main class="p-4 lg:p-6">`. **Measured:** `evidence/verify-38-wave3-after.json`,
`kds.<w>.fit.boardLeft` = `16` @390, **`272` @768, `280` @1024, `280` @1440 (light and dark)**. The
dark board still starts 280px in, with light sidebar and light top bar around it.

`boardHeightRatio` = `1` at every width — the board does fill the viewport height, but by
`min-h-screen` (`station-board.tsx:661`), i.e. by fighting the shell rather than by owning it.

### 5.2 `station-board.tsx` (872 lines)

```
<KdsClockProvider>                                       :644
  <ZoneProvider zone="operational" asChild>              :655
    <div data-surface="kds" data-zone="operational" data-testid="kds-board"
         class="flex min-h-screen flex-col gap-3 bg-kds-surface p-3 text-kds-text">   :658-661
      <header class="flex min-h-12 shrink-0 flex-wrap …">   :682   ← 48px, wraps rather than overflows
        h1 station name · "N tickets" · "N items" · StationSwitcher (native <select>)
        page indicator · Ready-column toggle · All stations · KdsClearStale · Live/Polling
      {bumpError && role="alert"}                          :780
      <div data-testid="kds-board-scroll"
           class="min-h-0 flex-1 overflow-y-auto grid grid-cols-1 gap-3
                  sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">   :814-817
        KdsItemColumn × visibleColumns
      <footer> key map: ↑↓ move · 1–9 0 jump · Enter open · F bump · R recall · V ready column
```

`data-surface="kds"` (permanently dark, ignores theme) and `data-zone="operational"` (no compositing
filter, no decorative motion) are deliberately distinct and documented at `:650-654`.

Board mechanics worth preserving verbatim:

- `sortKdsTickets` (`:39-47`) — `receivedAt` DESC, tie-broken by id, a pure function of immutable
  fields, so a card never moves when an item's status changes.
- `PAGE_SIZE = KDS_JUMP_KEYS.length` (`:74`) — page size is *defined as* the number of bump-bar jump
  keys, making an unnumbered (unreachable) card structurally impossible.
- `interleaveColumns` (`:95-105`) — page 1 holds the head of every queue. The recorded defect it
  fixed: `p1 NEW 16 / STARTED 0 / PREPARING 0 / READY 0`.
- Column header counts read the whole queue, not the page slice (`:836-845`).

### 5.3 Columns, ticket card, ageing

`KDS_COLUMN_ORDER = ["NEW","STARTED","PREPARING","READY"]` (`kds-item-column.tsx:18`);
labels New / Started / Preparing / Ready (`:20-25`). UI-SPEC §9.3 and 38-05 task 4 ask for
**NEW · PREPARING · READY · COMPLETED**. The board has `STARTED` where the spec has `COMPLETED`.

`kds-aging.ts` implements the four-channel encoding (header `:14-22`): left border 2/4/6px · icon
shape `Clock`/`AlertTriangle`/filled `Flame` · literal chip text · `--kds-late-fill` body fill for
late. `KDS_WARN_FRACTION = 0.66`, `KDS_LATE_FRACTION = 1` (`:65-66`), scaled by each station's own
`escalationThresholdSeconds` (`DEFAULT_ESCALATION_THRESHOLD_SECONDS = 900`, `:59`). **Out of scope for
any redesign — 38-05 says keep it byte-identical.**

### 5.4 Station picker counters

`station-picker.tsx:319` —
`grid grid-cols-[repeat(auto-fit,minmax(4.75rem,1fr))] gap-1.5`, with the derivation of 4.75rem
(= 76px = `PREPARING`'s 63px painted width + 12px cell padding) recorded at `:300-310`.

---

## 6. Compared with the demo's POS screen (`Docs/NEXUS_ERP_Demo.html`)

Demo markup `:783-833`; demo CSS `:359-427`; demo JS `:1420-1485`.

| Concern | Demo | RestaurantOS | Verdict |
|---|---|---|---|
| Shell | Its own 56px topbar + 220px rail, POS renders full-width inside | Full back-office sidebar `w-64` = 256px + TopBar + 16/24px `<main>` gutter | Demo is **right**; app has the audit's structural defect |
| Layout | `.pos-layout { grid-template-columns: 1fr 340px; height: calc(100vh - 56px - 48px) }` `:360` | `flex … lg:flex-row`, cart `lg:w-80` = **320px** | Demo 340 · spec 360 · app 320 |
| Responsive | **None.** No `@media` anywhere near `.pos-layout`; 1fr + 340px at every width | `lg:flex-row` two-col ≥1024, stacked + `max-h-[32vh]` below | App is **ahead**; the demo has nothing to copy here |
| Category rail | `.menu-cats { flex; flex-wrap: wrap }` `:364`; `.cat-btn { padding: 6px 14px; font-size: 12px }` `:365-369` → **~26px tall** | `min-h-11` pills, `overflow-x-auto` on phone / wrap on till | App is **correct**; demo pill fails SC 2.5.5 |
| Tile grid | `repeat(auto-fill, minmax(130px, 1fr))` `:373` | `grid-cols-2 sm:3 lg:4` fixed-count | Demo's `auto-fill/minmax` is the better rule — worth adopting |
| Tile content | emoji · name 12px · price 13px mono · **availability dot + word** (`ok`/`low`/`out`) `:381-387`, `:1424-1430` | image (when any item has one) · name `text-sm` · price · **no availability** | Availability channel is the one real gap the demo exposes |
| Tile press | `:hover { transform: translateY(-1px) }` `:379`; `:active { transform: translateY(0) }` `:380` | `active:scale-95` (`menu-grid.tsx:320`) | Demo's is **hover-only** — no touch equivalent |
| Order ticket | header · scrolling items · dashed divider · summary · actions `:390-420` | header · scrolling lines · totals · actions | Same shape; app additionally shows tax, service charge and a revision log |
| Qty stepper | `.qty-btn { width: 22px; height: 22px }` `:397` | 32×32 (`order-panel.tsx:354`) | Both fail 44px; **demo is worse** |
| Table selection | `.table-chip { width: 38px; height: 38px }` `:424`, seven static chips in the page header `:791` | `TableSelectCombobox` (h-11 trigger, 30px options) + a real Floor View grid with 4 states | Demo is a decorative strip over 7 hard-coded tables; **not a model** |
| Pay actions | `.pay-btn { padding: 10px; font-size: 13px }` `:412-415`, `Charge $ / Card / Hold` | Send to Kitchen / Save as Draft / Charge Now, `h-12` | Comparable |
| Cart mutation | `renderTicket()` re-writes `innerHTML` of the whole list `:1456` | React reconciliation, `--motion-instant` intent | Demo's approach is fine visually, wrong architecturally |
| Print | **absent** — `grep -n '@media print\|@page' NEXUS_ERP_Demo.html` → no rows | 206-line hardened stylesheet | The demo has never had to survive a print path |
| KDS | **absent** — `grep -n 'id="screen-'` lists 11 screens, none of them kitchen | 13-file KDS + expo | **There is no demo KDS to calibrate against.** Anything proposed for the KDS "from the demo" is an invention |

---

## 7. Plan-by-plan status

### 38-04 — The POS terminal

| # | Task | Status | Evidence |
|---|---|---|---|
| 1 | Operator chrome — 56px strip, no sidebar/breadcrumb/search, `PageBody fullBleed` | **UNTOUCHED** | `pos/layout.tsx:44-48` adds only `ZoneProvider` + two badges. `grep -rn 'PageBody\|PageHeader' app/(tenant)/app/pos` → no rows. Sidebar still `<aside class="… w-64">` = 256px (`sidebar.tsx:161-166`). Live: `kds.768.fit.boardLeft = 272` and three sidebar `<a>` elements are the only sub-44px controls left at 768+ — the shell is demonstrably still on the route |
| 2 | Cart panel to 360px | **UNTOUCHED** | `pos-terminal.tsx:498` is `lg:w-80` = 320px. **And it has never been measured:** `POS_SHAPE` in `verify-38-wave3.mjs:169` selects `'[data-testid="pos-cart"], [data-testid="order-panel"], aside'`; neither testid exists anywhere in `frontend/` (`grep -rn 'data-testid="pos-cart"\|data-testid="order-panel"'` → only the probe files themselves), so it matched the **sidebar** `<aside>`. The recorded `cartWidth: 256` is `w-64`, and the `0` at 390px is the sidebar's `hidden md:flex`. The cart-width evidence is void |
| 3 | Product-card contract — name `--text-pos` 17/24 w500 · price · image · availability · quick-add · min 56px | **PARTLY** | image ✅ `menu-grid.tsx:334-341`; quick-add ✅ `:355-372`; tile ≥56px ✅ `min-h-[100px]` `:320`; name ❌ `text-sm` (14px) not `text-pos` (17px, `globals.css:301-302`), weight `font-medium` (500) ✅ `:348`; availability ❌ absent — `grep -n 'avail' menu-grid.tsx` → no rows |
| 4 | Every target ≥44×44; every hover has a touch equivalent | **PARTLY** | Sub-44 count is 0@390 / 3@768-1440 (`verify-38-wave3-after.json`) — but see §4: the probe ran an empty cart, so the 32px steppers (`order-panel.tsx:354,365,385`), 22px badges (`menu-grid.tsx:359,367`) and 30px table options (`table-select-combobox.tsx:122,171`) were never on screen. The 3 remaining at desktop are sidebar links, which task 1 was meant to delete |
| 5 | 390px: bottom sheet + persistent total bar, full-width grid | **PARTLY** | Stacked layout + `max-h-[32vh]` cap exists (`pos-terminal.tsx:498`), and the rail scrolls instead of wrapping (`menu-grid.tsx:186`). But it is a stacked block, not a **bottom sheet**, and there is no **persistent total bar** — the totals live inside the scrolling panel (`order-panel.tsx:226`). `ellipsisLabels: 1` at every width in the after-run, i.e. one label still truncates |
| 6 | `till-session-bar.tsx` 15 emerald literals → `--success-*`, both themes | **DONE** | `grep -oE '(bg\|text\|border\|ring)-(emerald\|green\|amber\|…)-[0-9]{2,3}' till-session-bar.tsx \| wc -l` → **0**. Now `bg-success/15` + `text-success` (`:264-265`), `bg-success text-success-foreground` on solid fills (`:200,245`). Commit `38a61be2` records why `text-success-foreground` on a 10% tint was rejected: `--success-foreground` is white in light mode |
| 7 | `PageHeader` so `h1Count === 1` | **PARTLY — done differently, and deliberately** | `h1Count = 1` at all four widths (`verify-38-wave3-after.json`). But it is `<h1 class="sr-only">Point of sale</h1>` (`pos/page.tsx:104`), not `PageHeader`, with the reasoning at `:92-103`: a visible 20px title costs vertical space on a full-bleed operational surface. The *outcome* is met; the *component* is not adopted |
| 8 | Tile press ≤120ms at `--motion-state`; cart mutation animates nothing | **PARTLY** | Press feedback exists as `active:scale-95` (`menu-grid.tsx:320`) but the element's transition is `transition-colors`, so the scale is instantaneous, not 120ms. `grep -rn 'motion-state\|motion-instant' components/pos components/kds` → **no rows**: neither token is referenced by any POS or KDS file. Cart mutation animating nothing is true by construction, but unasserted |

**Gates:** containing-block creators 0 ✅ and running animations 0 ✅ at all four widths
(`verify-38-wave3-after.json`). `e2e/journeys/operational-latency.spec.ts`,
`operational-zone-containment.spec.ts` and `pos-receipt-print.spec.ts` all exist and are all
**modified in the working tree** (`git status --porcelain frontend/e2e` → ` M` on each), so their
committed state is not what the plan describes. `frontend/e2e/journeys/receipt-print.spec.ts` — the
filename the plan names — **does not exist**; the file is `pos-receipt-print.spec.ts`.

### 38-05 — The Kitchen Display System

| # | Task | Status | Evidence |
|---|---|---|---|
| 1 | Re-lay-out the four counters so labels cannot collide | **DONE** | `station-picker.tsx:319` `grid-cols-[repeat(auto-fit,minmax(4.75rem,1fr))]`. Before/after in `evidence/verify-38-wave3-{before,after}.json`: `overflowingLabels` 8→0 @768, 6→0 @1024, 4→0 @1440 light and dark; `collisions` 4→0, 4→0, 2→0, 2→0. The measurement method was corrected mid-plan from box extent to **painted extent** (`left + scrollWidth`) — commit `38a61be2` records that the box comparison reported 0 collisions against the very defect the audit photographed |
| 2 | Board owns its viewport — `PageBody fullBleed`, 48px station header, drop `min-h-screen` | **PARTLY** | 48px header ✅ `station-board.tsx:682` `min-h-12 flex-wrap` (wrapping rather than `h-12`, with the painted-overlap measurements at 390/768 recorded at `:664-681`). `PageBody fullBleed` ❌ — not imported by any kitchen route. `min-h-screen` ❌ — still present at `station-board.tsx:661`, `station-picker.tsx:93,113,127`, `kitchen/page.tsx:22,33,42`, `[stationCode]/page.tsx:37,51,63`. Live proof it still fights the shell: `fit.boardLeft` = 272/280/280 |
| 3 | Bounded elapsed formatting — >24h renders an absolute date, drops urgency; shared `lib/format/elapsed.ts` | **UNTOUCHED** | `find frontend -name 'elapsed*'` → **no results**; `ls frontend/lib/format/` → directory does not exist. `station-picker.tsx:40-47` `formatAge` still has no upper bound (`${hours}h ${rem}m` for any hour count) and is rendered at `:288`. `kds-aging.ts:150-158` `formatAge` likewise runs to `${hours}:mm:ss` unbounded, rendered on the ticket face at `kds-ticket-card.tsx:167`. `formatAgeLong` (`kds-aging.ts:137-148`) does reach `5d 3h`, but is used only in the F17 clear-stale copy — **not** on the picker tile or the ticket. The `Oldest 113h 52m` defect is live |
| 4 | Columns NEW · PREPARING · READY · COMPLETED | **UNTOUCHED** | `kds-item-column.tsx:18` — `["NEW","STARTED","PREPARING","READY"]`. `STARTED` where the spec has `COMPLETED`. Responsive count adapts (`station-board.tsx:816`: 1/2/3/4 at sm/xl/2xl) ✅ |
| 5 | Station index density — cards sized to content, board fills height | **NOT VERIFIED** | `boardHeightRatio: 1` in the after-run, but that probe anchors `[data-surface="kds"]`, which carries `min-h-screen` and therefore reports `1` unconditionally. The measurement cannot distinguish a full board from an empty one. `fit.itemFontSizes: []` at every width — **no ticket was on the board during the run**, so the "≥22px item line" legibility check has never executed |
| 6 | 2 raw palette literals out of `kds-item-column` / `kds-ticket-card` → `--kds-*` | **DONE** | Grep hits in those two files are **comment text only** (`kds-item-column.tsx:134-135`, `kds-ticket-card.tsx:82-83`, describing what was removed). Zero live literals. Product-wide the same commit moved 174 → 142 |
| 7 | `PageHeader` on the station index | **UNTOUCHED** | `station-picker.tsx` has no `PageHeader` import; the page's only `h1`-role element is the `T_H1`-classed loading text at `:113` |

**Gates:** containing-block creators 0 ✅ and animations 0 ✅ at 390/768/1024/1440 both themes.
`frontend/e2e/journeys/kds-board.spec.ts` — the new spec the plan names — **does not exist**
(`ls frontend/e2e/journeys/` lists 19 files, none of them `kds-board.spec.ts`). The KDS work was
verified by the one-shot script `frontend/e2e/verify-38-wave3.mjs`, not by a committed journey spec.

### What actually landed, and when

`git log --oneline -- frontend/components/kds/station-picker.tsx` →
**`38a61be2 feat(38-04,38-05): KDS counters stop colliding, POS touch targets reach zero at 390px`**
(2026-08-12). `git show --stat 38a61be2` touched 8 source files: `pos/page.tsx`,
`customer-picker.tsx`, `station-picker.tsx`, `menu-grid.tsx`, `order-type-toggle.tsx`,
`table-select-combobox.tsx`, `till-session-bar.tsx`, plus the conformance baseline and the verify
script. **`pos-terminal.tsx`, `order-panel.tsx`, `station-board.tsx`, `kds-item-column.tsx`,
`kds-ticket-card.tsx`, `pos/layout.tsx` and every kitchen route were not touched.** There are no
`38-04-SUMMARY.md` / `38-05-SUMMARY.md` files (waves 1-2 have theirs), so wave 3 is unclosed.

---

## 8. Zone hard-flag — what must NOT leak from the demo

Phase 38 zones both screens `operational` (UI-SPEC §5 table, `:214-215`): **depth cues only. No
`backdrop-filter`. No entrance animation. No parallax. No tilt.** For the POS the additional reason
is the print path; for the KDS it is a cook reading at two metres.

### 8.1 In the demo, and forbidden here

| Demo | Line | Why it must not reach POS or KDS |
|---|---|---|
| `.screen { animation: fadeIn 0.25s ease }` and `@keyframes fadeIn { from { opacity:0; transform: translateY(6px) } }` | `:189`, `:191` | **The single most dangerous line in the file.** `.screen` is on `#screen-pos` itself (`:783`), so every POS view change is an entrance animation *with a transform*. On this codebase that is simultaneously (a) a forbidden entrance animation, (b) a running animation on a "0 animations" gate, and (c) a `transform` on an ancestor of `.receipt-root` — which prints the application onto a customer's bill. Copying this breaks the print gate and the containment gate together |
| `.live-dot { animation: pulse 2s infinite }` + `@keyframes pulse { …transform: scale(0.8) }` | `:181-182` | A perpetual animation with a transform. Explicitly named in 38-04's prohibition list. On a wall-mounted KDS it is a permanent repaint and a permanent distraction; on the POS it is a permanent containing-block creator |
| `.menu-item-card:hover { transform: translateY(-1px) }` | `:379` | Two faults. It is a **hover-only** affordance on a touch screen — brief §16 and 38-04 task 4 require a touch equivalent, and a tablet has no hover. And it is a transform on a tile inside the POS layout |
| `.kpi-card:hover { transform: translateY(-1px); box-shadow: var(--shadow) }` | `:223` | The dashboard's lift. `globals.css:995-1029` already restricts `.vdl-lift` to `restrained`/`expressive`; the KPI card belongs to the dashboard zone and has no business on a terminal |
| `.pay-btn.cash:hover { box-shadow: 0 0 16px rgba(232,160,69,0.3) }` | `:417` | A glow on the **Charge** button. A `box-shadow` is not a containing-block creator, so it is legal — but it is decoration on the one control where a mis-tap costs money, and it is hover-only |
| `.staff-card:hover { transform: translateY(-1px) }` | `:456` | Same class of hover-lift; would arrive on the POS through any shared card |
| `.toast { transform: translateY(100px) }` / `.toast.show { transform: translateY(0) }` | `:506-509` | A transform on a **fixed** element. Harmless where it is, but the pattern must not be generalised into the POS shell |
| `showToast(item.name + ' added to order')` on every tap | `:1440` | A toast per cart line. During a rush a cashier taps 15 items and gets 15 toasts covering the cart. 38-04 task 8 says the cart mutation animates **nothing** |
| `.qty-btn { 22×22 }`, `.cat-btn { padding: 6px 14px }`, `.table-chip { 38×38 }` | `:397`, `:365`, `:424` | All below 44×44. The app's `min-h-11` pills are already better; copying the demo's chrome would be a regression against SC 2.5.5 |
| Emoji as product imagery (`.menu-item-emoji`, `:381`, `:1425`) | `:1425` | The app renders the real `imageUrl` (`menu-grid.tsx:334-341`) and 38-04 explicitly forbids generating placeholder food photography. A 🍕 in place of a dish photo is a placeholder with extra steps |
| KPI card row, `Chart.js` canvases, gradient fills, AI-recommendation panel | `:836-880`, `:1490+` | Dashboard vocabulary. A canvas chart on a KDS board is 30fps of repaint on a screen read at two metres; on a POS it is horizontal space taken from the tile grid, against brief §65 (functionality above polish) |

**One thing the demo does right and should be copied:** it has **no `backdrop-filter` anywhere** —
`grep -n 'backdrop-filter' Docs/NEXUS_ERP_Demo.html` returns **no rows**. The glass risk to these
screens is not coming from the demo; it comes from `globals.css:877-907`, and that is already gated
behind `[data-zone="expressive"]`.

### 8.2 Live leaks already present in the app (independent of the demo)

1. **Raw `animate-pulse` skeletons on operational surfaces.** `components/ui/skeleton.tsx:27-40` is
   correctly zone-aware — `still = zone === "operational"` renders a flat `bg-muted` instead of the
   `.skeleton` shimmer (`globals.css:1088-1091`, `animation: shimmer 1.8s infinite`). But six call
   sites bypass `Skeleton` entirely and hard-code Tailwind's infinite `animate-pulse`:
   `menu-grid.tsx:199` (category pill), `menu-grid.tsx:298` (8 tile skeletons),
   `table-floor-view.tsx:110` (12 table skeletons), `expo-board.tsx:316`,
   `kds-clear-stale.tsx:116`, `kds-cleared-board.tsx:141`. Each is a perpetual animation on an
   operational surface — exactly what 38-04's "no perpetual animation" clause forbids. They read as
   `0` in the evidence only because the probe waited 5500ms for loading to finish
   (`verify-38-wave3.mjs:190`, `page.waitForTimeout(5500)`), so the gate never sees the loading state.
2. **A 400ms geometry transition on the KDS board.** `kds-item-column.tsx:227` —
   `motion-safe:transition-all motion-safe:duration-400` on the bump collapse
   (`BUMP_COLLAPSE_MS = 400`, `station-board.tsx:109`). It is height+opacity, not transform, so the
   print path is safe; but a `getAnimations()`-based "0 running animations" gate goes red for 400ms
   after every bump. Whether that is the sanctioned §7.2 exception or a gate hole needs deciding
   before the gate is trusted.
3. **`active:scale-*` on 15 controls** across `components/pos` and `components/kds`. A `:active`
   transform is a containing-block creator *for the duration of the press*. Not a print risk (the
   receipt route is a different page state) but it means the containment gate's `0` is a
   resting-state `0`, not an all-states `0`.

---

## 9. Measurement caveats a redesign must not inherit

1. **`cartWidth` in the wave-3 evidence measures the sidebar, not the cart** — `verify-38-wave3.mjs:169`
   falls through to `aside`, which is `sidebar.tsx:161`'s `w-64`. Adding
   `data-testid="order-panel"` to `pos-terminal.tsx:498` is the one-line prerequisite for the 360px
   gate to mean anything.
2. **`itemFontSizes: []` at every KDS width** — no ticket was on the board. The §9.3 legibility
   requirement (every item line ≥22px) has never been executed against real data, and 38-05 warns in
   its own text that a KDS gate anchored on an empty or error surface reports green while running
   nothing.
3. **Touch measurement ran an empty cart** — see §4. Ten sub-44px class declarations are outside the
   measured set.
4. **`kitchen-service` availability** — 38-05 requires the KDS gates to be reported as *not run*
   rather than *passed* if the service is down. Nothing in `verify-38-wave3-after.json` records
   service state, so a future reader cannot tell which it was.
