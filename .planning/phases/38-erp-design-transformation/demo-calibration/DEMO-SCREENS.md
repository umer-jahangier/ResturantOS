# DEMO-SCREENS — Layout & Information Architecture of NEXUS_ERP_Demo.html

Source: `/Users/muhammadumer/Documents/Projects/ResturantOS/Docs/NEXUS_ERP_Demo.html` (1562 lines).
Everything below was read out of that file; line numbers are `Docs/NEXUS_ERP_Demo.html:N`.
Read-only analysis — no source file was modified.

## 0. Measured inventory (grep counts)

| Thing | Count | Command |
|---|---|---|
| Screens | **11** (not 10) | `grep -c 'id="screen-'` |
| KPI cards | 24 | `grep -o 'class="kpi-card'` |
| `.data-table` tables | 10 | `grep -o 'class="data-table"'` |
| Chart canvases | 9 | `grep -o '<canvas id="[a-zA-Z0-9]*"'` |
| `.card-title` section headers | 32 | `grep -o 'class="card-title"'` |
| `.tabs` segmented controls | 3 | `grep -n 'class="tabs"'` → 683, 940, 1143 |
| `.input` search/text fields | 3 | `grep -n 'class="input'` → 856, 1100, 1194 |
| Badge variants | green 29, teal 11, gold 9, blue 5, gray 3, red 1 | `grep -o 'class="badge [a-z]*"' \| sort \| uniq -c` |

Screen anchors (`grep -n 'id="screen-'`):
`dashboard:638  pos:783  inventory:836  orders:890  finance:920  hr:979  vendors:1031  crm:1083  analytics:1139  reports:1204  admin:1277`

---

## 1. Shell (chrome shared by all screens)

`.app-shell` = flex row, `height:100vh; overflow:hidden` (:63).

```
┌────────────────┬──────────────────────────────────────────────────────────────┐
│ SIDEBAR 240px  │ TOPBAR  h=56px  bg-2, 1px bottom border, padding 0 24px       │
│ bg-2, 1px      │ NEXUS / <Current>            [●LIVE] 19:42 [🔔•] [👤]         │
│ right border   ├──────────────────────────────────────────────────────────────┤
│ + 1px gradient │ CONTENT-AREA   flex:1, overflow-y:auto, padding: 24px         │
│ hairline       │                                                              │
│ (transparent→  │   .screen (display:none / .active display:block,             │
│  primary 40% → │    fadeIn 0.25s translateY(6px)→0)                            │
│  teal 70% →    │                                                              │
│  transparent,  │                                                              │
│  opacity .3)   │                                                              │
├────────────────┤                                                              │
│ FOOTER: avatar │                                                              │
│ AR / Ahmed Raza│                                                              │
│ Super Admin ⚙  │                                                              │
└────────────────┴──────────────────────────────────────────────────────────────┘
```

- Sidebar `:66-68` — `width:240px; min-width:240px`, `background: var(--bg-2)`, `border-right: 1px solid var(--border)`, plus `::after` 1px vertical gradient (`transparent → --primary 40% → --teal 70% → transparent`, opacity .3) `:74-80`.
- Logo block `:82-86` — 34×34 rounded-8 gradient mark "N" (Fraunces 800/16px, color `--bg`, glow `0 2px 12px rgba(232,160,69,.3)`) + stacked `NEXUS` (13px/700, tracking .08em) over `Restaurant ERP` (10px, `--text-3`).
- Topbar `:146-149` — `height:56px`, breadcrumb `NEXUS / <current>` (`current` = 13px/600 `--text`, separator opacity .3), right cluster = LIVE pill (green, pulsing 6px dot, 2s) + mono clock (`toLocaleTimeString` HH:MM, `:1477-1481`) + bell button with red notif dot + account button (routes to `admin`).
- Content padding is **24px** (`:176`); vertical rhythm between blocks is `mb-4` = **16px**; all grids gap **16px** (`:196-199`).

### Sidebar nav grouping (`:534-599`)

| Group label | Items (in order) | Badge | Target screen |
|---|---|---|---|
| **Overview** | Dashboard | — | `dashboard` (active on load) |
| **Operations** | POS Terminal | `3` gold badge (`:547`) | `pos` |
| | Inventory | `5` red badge (`:552`) | `inventory` |
| | Orders | — | `orders` |
| **Business** | Finance | — | `finance` |
| | HR & Payroll | — | `hr` |
| | Vendors | — | `vendors` |
| | CRM & Loyalty | — | `crm` |
| **Insights** | Analytics | — | `analytics` |
| | Reports | — | `reports` |
| **System** | Admin & RBAC | — | `admin` |

Group label style `:100-103`: 10px/600, letter-spacing .12em, uppercase, `--text-3`, padding `10px 20px 4px`.
Nav item `:104-109`: 13px/400, `--text-2`, 16px stroke icon at opacity .8, padding `8px 20px`.
Active `:111-120`: color `--primary`, background `--primary-soft`, plus a **3px left rail** (`::before`, inset 4px top/bottom, radius `0 3px 3px 0`, `box-shadow: 0 0 8px var(--primary)`).
Badge `:126-131`: 10px/600, pill radius 10px, red default / gold variant (gold uses `--bg` text).

### Shared primitives

- `.page-header` `:183-185` — `margin-bottom:24px`; title = **Fraunces 26px/600, line-height 1**; subtitle = **12px `--text-3`, margin-top 4px**.
- `.card` `:187-192` — `--surface` bg, 1px `--border`, `radius-lg 16px`, padding 20px. `.card-title` `:194` = 12px/600 uppercase, tracking .08em, `--text-2`, `margin-bottom:12px`.
- `.kpi-card` `:201-216` — same shell + 2px top accent bar (`::before`) tinted per variant (gold/teal/blue/red/green/purple), hover `translateY(-1px)` + shadow. Anatomy top→bottom: **36px tinted icon tile → 11px label (`--text-3`, tracking .05em) → Fraunces 28px value → 11px delta row** (`.up` green / `.down` red, chevron SVG, then a `.kpi-meta` grey comparator).
- `.data-table` `:284-300` — header `th`: 11px/600 uppercase `--text-3` tracking .07em on `--bg-3` with bottom border; `td`: 13px `--text-2`, 11px/14px padding, 1px `rgba(255,255,255,.03)` divider, row hover `--surface-2`. First cell padding-left 20px; **last column is right-aligned** and holds the row action button.
- `.td-primary` = `--text` + 500 (the identity column). `.td-mono` = DM Mono (all numerics).
- `.badge` `:256-264` — 11px/600 pill, tinted bg + 8%-alpha border, optional 5px `currentColor` dot.
- `.tabs` `:305-312` — segmented control: `--bg-3` track, 1px border, radius 10px, 4px padding; tab 12px/600 `--text-3`, active gets `--surface` chip + `--text` + shadow.
- `.progress-bar` `:301-302` — 5px tall, `--surface-2` track, radius 3px; fill colored inline per metric, `transition: width .8s`.
- `.toast` `:490-501` — fixed bottom-right 24/24, `--surface-3`, radius 10px, green check circle, auto-hide 2800ms (`:1487`).

---

## 2. DASHBOARD (`:638-782`)

- **Title:** `Good morning, Ahmed ☕` — the only *greeting* title in the app.
- **Subtitle:** `Monday, 14 April 2025 — Al-Baik Restaurant, Branch 1` (date — tenant, branch; em-dash, not the `·` stat pattern).
- **Header actions:** `Export` (ghost, envelope icon) · `New Order` (primary, plus icon → `showScreen('pos')`).

**Grid skeleton — 3 rows**
1. `.grid-4 mb-4` (:651) — 4 KPI cards.
2. `.grid-2 mb-4` with inline `grid-template-columns:2fr 1fr` (:678).
3. `.grid-3` (:720) — three equal cards.

**Row 1 KPIs** (label / value / delta):
| # | Variant | Label | Value | Delta | Meta |
|---|---|---|---|---|---|
| 1 | gold | Today's Revenue | `$4,218` | ▲ +12.4% | vs last Mon |
| 2 | teal | Orders Today | `127` | ▲ +8 | vs yesterday |
| 3 | blue | Avg. Order Value | `$33.2` | ▲ +3.1% | vs last week |
| 4 | red | Food Cost % | `28.4%` | ▼ −1.2% | vs budget 30% |

**Row 2 left (2fr) — "Revenue This Week"** card: header is `flex-between` with card-title left and a **3-tab segmented control right: Week (active) / Month / Year**. Chart container height **200px**, `#revenueChart`.
**Row 2 right (1fr) — "Live Operations"**: 5 stacked label/value + progress-bar meters, gap 14px, each row `flex-between` 12px text then a 5px bar:
`Tables Occupied 8 / 14` (57%, primary) · `Labour Cost % 18.2%` (61%, green, value colored green) · `Inventory Value $12,840` (78%, blue) · `Loyalty Members Active 342` (45%, teal) · `Staff On Shift 11 / 14` (79%, purple).

**Row 3 card A — "Top Menu Items Today"** (table, `margin-top:4px`):
| Col | Format |
|---|---|
| Item | `.td-primary` |
| Qty | plain `--text-2` |
| Revenue | `.td-mono .text-primary` (gold), right-aligned (last col) |
Rows: Grilled Salmon 34 $952 · Chicken Shawarma 28 $532 · Beef Burger 22 $418 · Pasta Primavera 19 $342 · Caesar Salad 16 $224.

**Row 3 card B — "Alerts & Actions"**: 5 `.alert-item` rows (`:345-352`), each = 28px rounded-7 tinted icon tile · 12px text with `<strong>` subject in `--text` · right-aligned 10px `--text-3` relative timestamp. Bottom border `rgba(255,255,255,.04)` except last.
`red` Salmon fillet below reorder point (320g left) — 2m ago · `gold` PO #2041 awaiting your approval — 14m ago · `blue` Payroll due in 3 days — 14 staff pending — 1h ago · `green` Revenue target 84% reached at 6pm — 3h ago · `purple` Sarah K. earned Gold loyalty status — 5h ago.

**Row 3 card C — "Sales by Category"**: donut `#categoryChart` at height **160px**, legend rendered *in HTML, not by Chart.js* — a `1fr 1fr` grid, gap 6px, margin-top 12px, each entry = 8px color dot + 11px `--text-2` `"Mains 42%"` (label and share in one string).

```
DASHBOARD
┌ Good morning, Ahmed ☕ ────────────────────────[Export][+ New Order]┐
│ Monday, 14 April 2025 — Al-Baik Restaurant, Branch 1                │
├──────────┬──────────┬──────────┬──────────┐  grid-4, gap16          │
│ ▮ gold   │ ▮ teal   │ ▮ blue   │ ▮ red    │                         │
│ REVENUE  │ ORDERS   │ AOV      │ FOODCOST │                         │
│ $4,218   │ 127      │ $33.2    │ 28.4%    │                         │
│ ▲+12.4%  │ ▲+8      │ ▲+3.1%   │ ▼−1.2%   │                         │
├──────────┴──────────┴──────┬───┴──────────┘                         │
│ REVENUE THIS WEEK  [Week|Month|Year]│ LIVE OPERATIONS                │
│ ┌─ bar+line, h200 ───────────────┐  │ Tables Occupied      8/14      │
│ │                                │  │ ▬▬▬▬▬▬░░░░░  (57% gold)        │
│ │                                │  │ Labour Cost %       18.2%      │
│ └────────────────────────────────┘  │ ▬▬▬▬▬▬▬░░░░  (61% green)       │
│              2fr                    │ Inventory Value   $12,840      │
│                                     │ ▬▬▬▬▬▬▬▬▬░░  (78% blue)        │
│                                     │ Loyalty Active       342       │
│                                     │ ▬▬▬▬▬░░░░░░  (45% teal)        │
│                                     │ Staff On Shift      11/14      │
│                                     │ ▬▬▬▬▬▬▬▬▬░░  (79% purple) 1fr  │
├─────────────────┬───────────────────┴──┬──────────────────────────┐  │
│ TOP MENU ITEMS  │ ALERTS & ACTIONS     │ SALES BY CATEGORY        │  │
│ Item  Qty  Rev  │ ⚠ Salmon…      2m ago│    ╭───────╮  donut 72%  │  │
│ Salmon 34  $952 │ ✓ PO #2041    14m ago│    │       │  h160       │  │
│ Shawar 28  $532 │ ▤ Payroll…     1h ago│    ╰───────╯             │  │
│ Burger 22  $418 │ ↗ Rev target   3h ago│  ● Mains 42% ● Bev 24%   │  │
│ Pasta  19  $342 │ ♥ Sarah K.     5h ago│  ● Start 18% ● Dess 16%  │  │
│ Caesar 16  $224 │                      │                          │  │
└─────────────────┴──────────────────────┴──────────────────────────┘  │
```

---

## 3. POS TERMINAL (`:783-835`)

- **Title:** `POS Terminal` · **Subtitle:** `Dine-In · Table 5 · Server: Omar K.` (order-context triple, `·` separated).
- **Header right is NOT buttons** — it is the `.table-selector` (`:790-792`): seven 38×38 rounded-8 `.table-chip`s `1 2 3 4 5 6 7`; states = default (`--surface`/`--text-2`), `.occupied` (primary-soft bg + primary border/text → chips 2, 3, 6), `.active` (solid primary on `--bg` → chip 5).
- `page-header` margin-bottom overridden to **12px** (tighter than the 24px standard) `:784`.

**Grid skeleton — `.pos-layout` (:356): `grid-template-columns: 1fr 340px`, gap 16, `height: calc(100vh - 56px - 48px)`** — the only fixed-height, non-scrolling screen body.

- **Left column** (`.pos-left`, flex column gap 12, overflow hidden):
  - **Category filter row** `.menu-cats` — 5 pill `.cat-btn`s, radius 20px, 12px/600: `All Items` (active, solid primary) / `Mains` / `Starters` / `Beverages` / `Desserts` → `filterMenu(cat,this)`.
  - **Menu grid** `#menuGrid` (`:371`) — `repeat(auto-fill, minmax(130px,1fr))`, gap 10px, `overflow-y:auto; flex:1`. 17 items rendered from JS `menu[]` (`:1494-1512` region, array at `:1503`-ish). Card anatomy (`:1541` render fn): 24px category emoji (`mains 🍽 / starters 🥗 / beverages 🥤 / desserts 🍰`) → 12px/600 name → **13px/700 mono price in primary** → availability row = 5px dot + 10px `--text-3` text (`ok`→green "Available", `low`→primary "Low Stock", `out`→red "Out"). Only `Lamb Chops` is `low`.
- **Right column** (`.pos-right`, fixed **340px**, a single bordered `--surface` panel with `overflow:hidden`, internally 4 stacked regions):
  1. **Ticket header** (`--bg-3`, padding 14/16): `Table 5 — Order` 13px/700 + `Server: Omar K. · 19:42` 11px `--text-3`; right = teal dot badge `Open`.
  2. **Ticket items** `#ticketItems` — `flex:1; overflow-y:auto`; each row = name (12px/500) · `−  [qty mono 700]  +` stepper (22px rounded-5 buttons) · right-aligned mono price in primary (min-width 50px). Seeded cart = Grilled Salmon ×1, Pasta Primavera ×2.
  3. **Dashed divider** then **summary** (4 rows, 12px, label `--text-3` / value mono): `Subtotal` · `Discount (10%)` (green, `−$`) · `Tax (15%)` · **`Total Due`** (15px/700, top border, value in primary). Math at `:1560`: `disc = sub*0.10; tax = (sub−disc)*0.15`.
  4. **Actions** (`:388`, `grid-template-columns:1fr 1fr`, gap 6, top border): `💳 Charge $<total>` primary, **spans both columns**; then `Card` and `Hold` side by side on `--surface-2`.

```
POS TERMINAL
┌ POS Terminal ──────────────────[1][2*][3*][4][▣5][6*][7] table chips┐
│ Dine-In · Table 5 · Server: Omar K.                                 │
├──────────────────────────────────────────────┬──────────────────────┤
│ (All Items)(Mains)(Starters)(Bev)(Desserts)  │ Table 5 — Order  ●Open│
│ ┌──────┬──────┬──────┬──────┬──────┐         │ Server: Omar K.·19:42 │
│ │ 🍽   │ 🍽   │ 🍽   │ 🍽   │ 🍽   │ auto-fill│──────────────────────│
│ │Salmon│Shawar│Burger│Pasta │Lamb  │ min130px │ Grilled Salmon −1+ 28│
│ │$28.00│$19.00│$19.00│$18.00│$34.00│ gap10    │ Pasta Primav.  −2+ 36│
│ │●Avail│●Avail│●Avail│●Avail│●Low  │          │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│ ├──────┼──────┼──────┼──────┼──────┤          │ Subtotal       $64.00│
│ │ 🥗   │ 🥗   │ 🥗   │ 🥗   │ 🥤   │  scrolls │ Discount(10%) −$6.40 │
│ │…17 items total…                  │          │ Tax (15%)       $8.64│
│ └──────────────────────────────────┘          │ TOTAL DUE      $66.24│
│                  1fr                          │ [💳 Charge $66.24 ]  │
│                                               │ [ Card  ][  Hold  ]  │
└───────────────────────────────────────────────┴──────────── 340px ───┘
   height = calc(100vh − 56px − 48px), no page scroll
```

---

## 4. INVENTORY (`:836-889`)

- **Title:** `Inventory Management` · **Subtitle:** `138 ingredients · 5 alerts · Last count: Today 08:00`
  → the canonical stat-line: **[scale count] · [exception count] · [freshness/recency]**.
- **Header actions:** `📊 Stock Count` (ghost, emoji as icon) · `+ Draft PO` (primary → toast "Purchase order drafted").

**Grid skeleton — 2 rows:** `.grid-4 mb-4` (:845) then `.grid-2` `2fr 1fr` (:852). The right 1fr column is a **flex column, gap 16** holding two stacked cards.

**KPIs:** teal `Total Ingredients 138` ▲ `3 new / this week` · gold `Stock Value $12,840` ▼ `−$420 / today` · red `Low / Critical 5` ▼ `2 need PO / urgent` · green `Waste This Week $184` ▲ `−32% / vs last week`.

**Left (2fr) — "Stock Levels"** card with `padding:0; overflow:hidden` and a 16/20 header strip (bottom border) containing card-title left + **`.input` search 180px wide, placeholder `🔍 Search ingredient...`** right.

| # | Column | Formatting |
|---|---|---|
| 1 | *(blank header)* | 8px `.stock-status` dot with matching glow: `.ok` green / `.low` primary / `.critical` red (`:401-404`) |
| 2 | Ingredient | `.td-primary` |
| 3 | Category | `.text-dim` (`--text-3`) |
| 4 | On Hand | `.td-mono` (value + unit, e.g. `0.32 kg`, `1.2 L`) |
| 5 | Par Level | `.td-mono` |
| 6 | Unit Cost | `.td-mono` `$` |
| 7 | Status | badge: red `Critical` / gold `Low` / green `OK`, each with `.badge-dot` |
| 8 | *(blank header)* | ghost `btn-sm`: **`PO`** when low/critical (fires a per-ingredient toast), **`Edit`** when OK — the action label is state-dependent |

7 rows: Salmon Fillet (critical, 0.32/2.0 kg, $28.00) · Heavy Cream (low, 1.2/5.0 L, $4.20) · Chicken Breast (ok, 8.4/5.0 kg, $12.50) · Basmati Rice (ok, 14.0/8.0 kg, $2.80) · Roma Tomatoes (ok, 6.5/4.0 kg, $3.40) · Parmesan (low, 0.8/2.0 kg, $22.00) · Olive Oil EV (ok, 4.2/2.0 L, $9.80).

**Right (1fr) card 1 — "AI Forecast — Next 7 Days"**: `#forecastChart` at **150px**, then an **AI recommendation panel**: padding 10, `--primary-soft` bg, `1px rgba(232,160,69,.2)` border, radius 8 — 11px/600 primary heading `⚡ AI Recommendation` + 11px `--text-2` body *"Order 4kg Salmon + 6L Cream by Wednesday based on weekend demand pattern."*
**Right card 2 — "Wastage This Week"**: `#wasteChart` at **120px**, no legend.

```
INVENTORY
┌ Inventory Management ─────────────[📊 Stock Count][+ Draft PO]──────┐
│ 138 ingredients · 5 alerts · Last count: Today 08:00                │
├───────────┬───────────┬───────────┬───────────┐                     │
│ INGREDIEN │ STOCK VAL │ LOW/CRIT  │ WASTE WK  │  grid-4             │
│ 138 ▲3new │ $12,840▼  │ 5 ▼2 PO   │ $184 ▲−32%│                     │
├───────────┴───────────┴──────┬────┴───────────┴─────────────────┐   │
│ STOCK LEVELS   [🔍 Search…]  │ AI FORECAST — NEXT 7 DAYS        │   │
│ ● Ingredient Cat  OnHand Par │ ┌ line ×2 (Chicken/Salmon) h150 ┐│   │
│ ● Salmon Fillet Prot 0.32 2.0│ └───────────────────────────────┘│   │
│   $28.00 [Critical] [PO]     │ ┌ ⚡ AI Recommendation ─────────┐ │   │
│ ● Heavy Cream  Dairy 1.2  5.0│ │ Order 4kg Salmon + 6L Cream…  │ │   │
│ ● Chicken Br.  Prot  8.4  5.0│ └───────────────────────────────┘ │   │
│ ● Basmati Rice Grain 14.0 8.0├──────────────────────────────────┤   │
│ ● Roma Tomato  Prod  6.5  4.0│ WASTAGE THIS WEEK                │   │
│ ● Parmesan     Dairy 0.8  2.0│ ┌ red bars Mon–Sun h120 ────────┐│   │
│ ● Olive Oil EV Oils  4.2  2.0│ └───────────────────────────────┘│   │
│            2fr               │            1fr                   │   │
└──────────────────────────────┴──────────────────────────────────┘   │
```

---

## 5. ORDERS (`:890-919`)

- **Title:** `Order Management` · **Subtitle:** `127 orders today · $4,218 revenue · 3 active` (**[volume] · [money] · [live count]**).
- **Header actions:** `Filter` (ghost — label only, no icon, no dropdown wired) · `+ New Order` (primary → `showScreen('pos')`).

**Grid skeleton — 2 rows:** `.grid-4 mb-4` (:898) then one full-width `.card` with `padding:0; overflow:hidden` wrapping a table (no card header strip on this one).

**KPIs (bare — these four carry NO `.kpi-change` delta row, unlike every other KPI row in the app):** teal `Active Orders 3` · gold `Completed 121` · blue `Avg. Prep Time 14 min` · red `Voids / Refunds 3`.

**Table columns:**
| Column | Formatting |
|---|---|
| Order # | `.td-primary .td-mono` — `#2147` |
| Table | plain; `—` when not dine-in |
| Items | plain, `"3 items"` |
| Type | badge: teal `Dine-in` / blue `Takeaway` / blue `Delivery` (**no dot** on type badges) |
| Time | plain `19:42` (not mono) |
| Prep | plain `12 min` (not mono) |
| Total | `.td-mono .text-primary` |
| Status | badge **with** dot: gold `In Kitchen`, green `Ready`, green `Completed`; gray `Served` **without** dot |
| *(blank)* | ghost `View` button, right-aligned |

6 rows: #2147 T5 3 items Dine-in 19:42 12min $87.40 In Kitchen · #2146 T3 5 Dine-in 19:38 18min $124.60 In Kitchen · #2145 — 2 Takeaway 19:35 10min $42.00 Ready · #2144 T2 4 Dine-in 19:20 16min $98.20 Served · #2143 T6 6 Dine-in 19:10 22min $156.80 Completed · #2142 — 3 Delivery 18:55 30min $68.50 Completed.

```
ORDERS
┌ Order Management ───────────────────────────[Filter][+ New Order]──┐
│ 127 orders today · $4,218 revenue · 3 active                       │
├──────────┬──────────┬──────────┬──────────┐ (KPIs have no deltas)  │
│ ACTIVE 3 │ DONE 121 │ PREP 14m │ VOIDS 3  │                        │
├──────────┴──────────┴──────────┴──────────┴───────────────────────┐│
│ Order# Table Items Type      Time  Prep  Total    Status      ⌄   ││
│ #2147  T5    3     ▪Dine-in  19:42 12min $87.40  ●In Kitchen [View]││
│ #2146  T3    5     ▪Dine-in  19:38 18min $124.60 ●In Kitchen [View]││
│ #2145  —     2     ▪Takeaway 19:35 10min $42.00  ●Ready      [View]││
│ #2144  T2    4     ▪Dine-in  19:20 16min $98.20   Served     [View]││
│ #2143  T6    6     ▪Dine-in  19:10 22min $156.80 ●Completed  [View]││
│ #2142  —     3     ▪Delivery 18:55 30min $68.50  ●Completed  [View]││
└────────────────────── full-width card, padding:0 ──────────────────┘│
```

---

## 6. FINANCE (`:920-978`)

- **Title:** `Financial Overview` · **Subtitle:** `April 2025 · All figures in USD` (**[period] · [unit convention]** — a 2-part variant).
- **Header actions — three:** `+ Expense` (ghost) · `+ Invoice` (ghost) · `Reconcile` (primary).

**Grid skeleton — 2 rows:** `.grid-4 mb-4` (:930) then `.grid-2` **`3fr 2fr`** (:937) — the wider-right variant; right column is flex column gap 16 with two cards.

**KPIs:** green `Revenue (MTD) $68,420` ▲ `+11.2% / vs budget` · red `COGS (MTD) $19,432` ▲ `28.4% / food cost %` · blue `Operating Expenses $22,180` ▲ `32.4% / of revenue` · teal `Net Income (MTD) $26,808` ▲ `39.2% / net margin`.
Note: the delta slot is reused as a **ratio slot** on 3 of 4 cards (the chevron is `up` even when the number is a share, not a change).

**Left (3fr) — "Recent Transactions"**: header strip (16/20, bottom border) = card-title + **3-tab segmented control `All (active) / Income / Expense`**.
| Column | Formatting |
|---|---|
| Date | `.text-dim`, `14 Apr` |
| Description | `.td-primary` — includes the counterparty: `Vegetable Supply — Green Gardens` |
| Account | `.text-dim` — Revenue / COGS / Labour |
| Reference | `.td-mono .text-dim` — `#INV-2041`, `PO-1094`, `PR-W15` |
| Amount | `.td-mono`, **signed and color-coded**: `+$4,218` green, `−$840` red; right-aligned |
6 rows spanning 12–14 Apr.

**Right card 1 — "P&L Summary — April 2025"**: 7 `.fin-stat-row`s (`:409-415`) — 13px label `--text-2` left, **14px/700 mono value** right, 1px divider; negatives rendered in **accounting parentheses** and red: `($19,432)`. Final `.total` row gets a heavier top border (`--border-2`), label 14px/600 `--text`, value **18px teal**.
Order: Gross Revenue `$68,420` (green) · Cost of Goods Sold `($19,432)` · Gross Profit `$48,988` (primary) · Labour Cost `($12,460)` · Rent & Utilities `($6,200)` · Other OpEx `($3,520)` · **Net Income `$26,808`** (teal, 18px).

**Right card 2 — "AP Aging"**: 3 bucket meters (11px labels, mono values, 5px bars): `Current $4,820` (72%, green) · `30 Days $1,240` (20%, primary) · `60 Days $380` (8%, red).

```
FINANCE
┌ Financial Overview ──────────[+ Expense][+ Invoice][Reconcile]─────┐
│ April 2025 · All figures in USD                                    │
├──────────┬──────────┬──────────┬──────────┐                        │
│ REV MTD  │ COGS MTD │ OPEX     │ NET INC  │                        │
│ $68,420  │ $19,432  │ $22,180  │ $26,808  │                        │
│ ▲+11.2%  │ ▲28.4%   │ ▲32.4%   │ ▲39.2%   │                        │
├──────────┴──────────┴────┬─────┴──────────┴────────────────────┐   │
│ RECENT TRANSACTIONS      │ P&L SUMMARY — APRIL 2025            │   │
│         [All|Income|Exp] │ Gross Revenue            $68,420    │   │
│ Date Description Acct Ref│ Cost of Goods Sold      ($19,432)   │   │
│      Amount              │ Gross Profit             $48,988    │   │
│ 14Apr Dinner Svc  Rev    │ Labour Cost             ($12,460)   │   │
│       #INV-2041  +$4,218 │ Rent & Utilities         ($6,200)   │   │
│ 14Apr Veg — Green COGS   │ Other OpEx               ($3,520)   │   │
│       PO-1094      −$840 │ ═══════════════════════════════════ │   │
│ 13Apr Full Day    Rev    │ Net Income               $26,808    │   │
│       #INV-2040  +$5,124 ├─────────────────────────────────────┤   │
│ 13Apr Payroll W15 Labour │ AP AGING                            │   │
│       PR-W15     −$3,220 │ Current   $4,820 ▬▬▬▬▬▬▬░░ 72% grn  │   │
│ 12Apr Seafood     COGS   │ 30 Days   $1,240 ▬▬░░░░░░░ 20% gold │   │
│ 12Apr Full Day    Rev    │ 60 Days     $380 ▬░░░░░░░░  8% red  │   │
│           3fr            │              2fr                    │   │
└──────────────────────────┴─────────────────────────────────────┘   │
```

---

## 7. HR & PAYROLL (`:979-1030`)

- **Title:** `HR & Payroll` · **Subtitle:** `14 staff · 11 on shift today · Payroll due Apr 20` (**[headcount] · [live subset] · [next deadline]**).
- **Header actions:** `Schedule` (ghost) · `Run Payroll` (primary → toast "Payroll run initiated for 14 staff").

**Grid skeleton — 2 rows:** `.grid-4 mb-4` (:988) then `.grid-2` `2fr 1fr` with explicit `margin-bottom:16px` (:995); right = flex column gap 16, two cards.

**KPIs:** blue `Total Staff 14` (no delta) · green `On Shift Now 11` (no delta) · gold `Monthly Payroll $22,400` (no delta) · purple `Labour Cost % 18.2%` ▲ `Under budget / (20%)` — **only the 4th has a delta row, and its "delta" is a text verdict, not a number**.

**Left (2fr) — "Staff Directory"** (`padding:0`, plain 16/20 header strip, no search):
| Column | Formatting |
|---|---|
| Employee | 28px circular avatar with **per-person gradient** (gold, teal, blue, purple, green) + initials in `--bg`, then `.td-primary` name at `margin-left:8px` |
| Role | `.text-dim` |
| Hours (Month) | `.td-mono` — `168h` |
| Salary | `.td-mono .text-primary` |
| Status | badge green + dot `On Shift` / badge gray `Off Today` |
| *(blank)* | ghost `View` |
5 rows: Ahmed Khan/Head Chef/168h/$3,200 · Sarah Rashid/Sous Chef/160h/$2,400 · Omar Malik/Cashier/154h/$1,600 · Fatima Zaidi/Waitstaff/140h/$1,400 (Off Today) · Hassan Baloch/Inventory Mgr/168h/$1,800.

**Right card 1 — "Labour Cost Trend"**: `#labourChart` at **140px**.
**Right card 2 — "Today's Shift Coverage"**: 3 `flex-between` 11px rows `Morning (07:00–15:00) 5 / 5` (green) · `Afternoon (12:00–20:00) 4 / 5` (primary) · `Evening (17:00–23:00) 3 / 4` (primary) — coverage as `filled / required`, colored by whether it is met. Then the same **⚡ primary-soft suggestion panel** as Inventory: *"Afternoon short 1 staff — Fatima available, confirm shift?"* (8px padding, 11px, primary text).

```
HR & PAYROLL
┌ HR & Payroll ───────────────────────────[Schedule][Run Payroll]────┐
│ 14 staff · 11 on shift today · Payroll due Apr 20                  │
├──────────┬──────────┬──────────┬──────────┐                        │
│ STAFF 14 │ ONSHIFT11│ PAY $22.4k│LABOUR18.2%│ (only #4 has delta)   │
├──────────┴──────────┴────┬─────┴──────────┴───────────────────┐    │
│ STAFF DIRECTORY          │ LABOUR COST TREND                  │    │
│ ◍AK Ahmed Khan  HeadChef │ ┌ line W10–W15 + dashed budget h140┐│    │
│    168h $3,200 ●On Shift │ └──────────────────────────────────┘│    │
│ ◍SR Sarah Rashid Sous    ├────────────────────────────────────┤    │
│    160h $2,400 ●On Shift │ TODAY'S SHIFT COVERAGE             │    │
│ ◍OM Omar Malik  Cashier  │ Morning (07:00–15:00)      5 / 5 ✓ │    │
│    154h $1,600 ●On Shift │ Afternoon (12:00–20:00)    4 / 5   │    │
│ ◍FZ Fatima Zaidi Waitst. │ Evening (17:00–23:00)      3 / 4   │    │
│    140h $1,400  Off Today│ ┌ ⚡ Afternoon short 1 staff —     ┐│    │
│ ◍HB Hassan Baloch InvMgr │ │   Fatima available, confirm?    ││    │
│    168h $1,800 ●On Shift │ └─────────────────────────────────┘│    │
│           2fr            │              1fr                   │    │
└──────────────────────────┴────────────────────────────────────┘    │
```

---

## 8. VENDORS (`:1031-1082`)

- **Title:** `Vendor & Supply Chain` · **Subtitle:** `12 active vendors · 3 open POs · $6,440 outstanding` (**[entities] · [in-flight docs] · [money at risk]**).
- **Header actions:** `+ Vendor` (ghost) · `+ Purchase Order` (primary → toast).
- **No KPI row.** Grid skeleton is a single `.grid-2` `2fr 1fr` (:1039); right = flex column gap 16, two cards.

**Left (2fr) — "Vendor Directory"** (`padding:0`, plain header strip):
| Column | Formatting |
|---|---|
| Vendor | `.td-primary` |
| Category | `.text-dim` |
| Lead Time | `.td-mono` — `2 days` |
| Score | **`.score-circle`** (`:441-445`) — 40px circle, mono 13px/700, tinted bg+fg by band: green ≥88, primary/gold 78, red 62 |
| Outstanding | `.td-mono`, color-graded: red `$1,240`, primary `$840`/`$620`, dim `$0`/`$380` |
| Status | badge green `Active` / badge gold `Review` (no dots) |
| *(blank)* | ghost `PO` |
5 rows: Ocean Fresh Co./Seafood/2 days/94/$1,240 · Green Gardens/Produce/1 day/91/$840 · Prime Dairy Ltd/Dairy/1 day/78/$620 · Grain Masters/Grains & Dry/3 days/88/$0 · SpiceRoute Int./Spices & Herbs/4 days/62/$380 (Review).

**Right card 1 — "Open Purchase Orders"** — 3 **mini-cards** (not table rows): padding 10, `--bg-3` bg, radius 8, 1px border; each = title row (`PO-1094` 12px/600 + status badge) → 11px `--text-3` line "vendor · contents" → footer row (11px money/ETA left, `btn-sm` right).
`PO-1094` gold `Pending Approval` — Ocean Fresh Co. · Salmon 4kg + Prawns 2kg — Est. $448 — **[Approve] primary** ·
`PO-1093` blue `In Transit` — Green Gardens · Mixed veg 20kg — $184 · ETA: Tomorrow — [Track] ghost ·
`PO-1092` teal `Delivered` — Prime Dairy · Cream 8L + Parmesan 2kg — $208 · Received today — [Confirm] ghost.
The action verb changes with lifecycle state; only the pending one gets the primary button.

**Right card 2 — "Monthly Spend by Vendor"**: `#vendorChart` at **140px**, horizontal bars.

```
VENDORS
┌ Vendor & Supply Chain ──────────────[+ Vendor][+ Purchase Order]───┐
│ 12 active vendors · 3 open POs · $6,440 outstanding   (no KPI row) │
├──────────────────────────────┬─────────────────────────────────┐   │
│ VENDOR DIRECTORY             │ OPEN PURCHASE ORDERS            │   │
│ Vendor    Cat  Lead ⓢ Outst. │ ┌ PO-1094      [Pending Appr.] ┐│   │
│ Ocean Fr. Sea  2d  (94) $1,240│ │ Ocean Fresh · Salmon+Prawns ││   │
│ Green Gd. Prod 1d  (91)  $840 │ │ Est. $448        [Approve]  ││   │
│ Prime Dry Dair 1d  (78)  $620 │ ├ PO-1093         [In Transit]┤│   │
│ Grain Mst Grn  3d  (88)    $0 │ │ Green Gardens · Mixed veg   ││   │
│ SpiceRte  Spic 4d  (62)  $380 │ │ $184 · ETA Tomorrow [Track] ││   │
│                     [Review]  │ ├ PO-1092          [Delivered]┤│   │
│                               │ │ Prime Dairy · Cream+Parm    ││   │
│                               │ │ $208 · Received   [Confirm] ││   │
│                               ├─────────────────────────────────┤  │
│                               │ MONTHLY SPEND BY VENDOR         │  │
│                               │ ▬▬▬▬▬▬▬▬ Ocean Fresh $3,240 h140│  │
│                               │ ▬▬▬▬ Green Gardens              │  │
│            2fr                │        1fr                      │  │
└───────────────────────────────┴─────────────────────────────────┘  │
```

---

## 9. CRM & LOYALTY (`:1083-1138`)

- **Title:** `CRM & Loyalty` · **Subtitle:** `1,842 customers · 342 active this month · NPS: 72` (**[total] · [active subset] · [named index]**).
- **Header actions:** `Segment` (ghost) · `+ Campaign` (primary → toast).

**Grid skeleton — 2 rows:** `.grid-4 mb-4` (:1091) then a **plain `.grid-2` (1fr 1fr — no inline ratio override)** (:1098); right = flex column gap 16, two cards. This is the only content screen using a true 50/50 split.

**KPIs:** teal `Total Members 1,842` ▲ `+28 / this week` · gold `Gold Members 184` ▲ `+3 / upgraded` · purple `Points Redeemed 8,420` (no delta) · blue `NPS Score 72` ▲ `+4 / vs last month`.

**Left — "Top Customers"** (`padding:0`; header strip has card-title + **`.input` 160px, placeholder `Search...`**):
| Column | Formatting |
|---|---|
| Customer | `.td-primary` |
| Visits | plain integer |
| Lifetime Value | `.td-mono .text-primary` |
| Points | `.td-mono`, **colored by tier**: teal for Gold rows, `#B0B4C8` for Silver, `#CD7F32` for Bronze |
| Tier | `.loyalty-tier` pill (`:424-431`) — 11px/700, tinted bg + border: `tier-gold #D4AF37` `★ Gold`, `tier-silver #B0B4C8` `◆ Silver`, `tier-bronze #CD7F32` `● Bronze` — **glyph differs per tier** |
| *(blank)* | ghost `View` |
5 rows: Sarah Khalid 42 $2,840 12,400 Gold · Tariq Mansour 38 $2,210 9,800 Gold · Nadia Al-Farsi 24 $1,440 5,200 Silver · Omar Qureshi 18 $980 3,600 Silver · Yasmin Hassan 11 $540 1,200 Bronze.

**Right card 1 — "Loyalty Tier Distribution"**: `#loyaltyChart` donut, **160px**, Chart.js legend at `position:'bottom'`.
**Right card 2 — "Active Campaigns"**: 3 mini-cards (padding 10, `--bg-3`, radius 8, 1px border): title 12px/600 + status badge; second line 11px `--text-3` combining **cadence · mechanic · result**:
`Weekend Double Points` green `Live` — "Sat–Sun · 2× earn on all mains · 284 redemptions" ·
`Birthday Free Dessert` green `Live` — "Automated · Birthday month · 42 sent this month" ·
`Win-Back — 60 Days Silent` blue `Scheduled` — "Starts Mon · 15% voucher · 38 customers targeted".

```
CRM & LOYALTY
┌ CRM & Loyalty ────────────────────────────[Segment][+ Campaign]────┐
│ 1,842 customers · 342 active this month · NPS: 72                  │
├──────────┬──────────┬──────────┬──────────┐                        │
│ MEMBERS  │ GOLD 184 │ POINTS   │ NPS 72   │                        │
│ 1,842▲+28│ ▲+3      │ 8,420    │ ▲+4      │                        │
├──────────┴──────────┴────┬─────┴──────────┴───────────────────┐    │
│ TOP CUSTOMERS [Search…]  │ LOYALTY TIER DISTRIBUTION          │    │
│ Customer Vis LTV  Pts Tie│      ╭────────╮  donut 68%, h160    │    │
│ Sarah K.  42 $2,840 12.4k│      │        │  legend: bottom     │    │
│                  [★Gold] │      ╰────────╯                     │    │
│ Tariq M.  38 $2,210 9,800│  ■ Gold(184) ■ Silver(528) ■ Bronze │    │
│                  [★Gold] ├────────────────────────────────────┤    │
│ Nadia A.  24 $1,440 5,200│ ACTIVE CAMPAIGNS                   │    │
│                [◆Silver] │ ┌ Weekend Double Points     [Live] ┐│    │
│ Omar Q.   18   $980 3,600│ │ Sat–Sun · 2× mains · 284 redeem  ││    │
│                [◆Silver] │ ├ Birthday Free Dessert     [Live] ┤│    │
│ Yasmin H. 11   $540 1,200│ │ Automated · 42 sent this month   ││    │
│                [●Bronze] │ ├ Win-Back — 60 Days  [Scheduled]  ┤│    │
│                          │ │ Starts Mon · 15% · 38 targeted   ││    │
│         1fr              │              1fr                   │    │
└──────────────────────────┴────────────────────────────────────┘    │
```

---

## 10. ANALYTICS & INTELLIGENCE (`:1139-1203`)

- **Title:** `Analytics & Intelligence` · **Subtitle:** `Real-time data · April 2025` (2-part).
- **Header right is a control + a button:** the **`.tabs` segmented control `This Month (active) / Quarter / Year`** sits *inside the page header* next to `Export` (ghost). Only screen where a period switcher is promoted to page level.

**Grid skeleton — 2 rows:** `.grid-2 mb-4` `3fr 2fr` (:1148) then `.grid-3` (:1164).

**Row 1 left (3fr) — "Revenue vs COGS — Daily"**: header `flex-between` with card-title + teal `Live` badge. `#revCOGSChart` at **220px** — the tallest chart in the demo.
**Row 1 right (2fr) — "Key Performance Ratios"**: 4 meters at gap 14, each = label + bold colored value → **8px-tall** progress bar with a **gradient fill** → 11px `--text-3` benchmark caption:
| Metric | Value | Fill % | Gradient | Caption |
|---|---|---|---|---|
| Food Cost % | `28.4% ✓` (green — checkmark appended when in budget) | 56% | green→teal | Budget: 30% |
| Labour Cost % | `18.2%` (primary) | 36% | primary→`#E8C045` | Budget: 20% |
| Net Margin | `39.2%` (teal) | 78% | teal→blue | Target: 35% |
| Avg. Table Turn Time | `48 min` (purple) | 60% | purple→blue | Target: 45 min |

**Row 2 card A — "Revenue by Hour (Today)"**: `#hourlyChart` at **160px**.
**Row 2 card B — "Menu Margin Ranking"** (table, `margin-top:4px`):
| Column | Formatting |
|---|---|
| Item | `.td-primary` — **names truncated by hand** to fit (`Pasta Prim.`, `Chicken Shar.`) |
| Cost% | `.td-mono` **conditionally colored**: green ≤24%, primary 28–35%, red 42% |
| Margin | `.td-mono .text-primary`; the worst row ($8.10) drops to `--text-2` |
Rows: Beef Burger 21% $15.00 · Pasta Prim. 24% $13.60 · Chicken Shar. 28% $13.70 · Grilled Salmon 35% $18.20 · Caesar Salad 42% $8.10.

**Row 2 card C — "AI — Natural Language Query"** — a 4-part conversational block:
1. Question echo panel (`--bg-3`, radius 8, 1px border): 11px `--text-3` "You asked:" + 12px/600 quoted question *"What was my best margin item last Tuesday?"*
2. Answer panel (`--primary-soft` + `rgba(232,160,69,.2)` border): 11px/600 primary `⚡ NEXUS AI` + 12px `--text-2` full-sentence answer with numbers inline.
3. Composer row: `.input.w-full` (12px, placeholder "Ask anything about your data...") + primary `Ask` button.
4. 11px `--text-3` suggestion line: `Try: "Compare food cost % week over week" or "Which vendor had late deliveries?"`

```
ANALYTICS
┌ Analytics & Intelligence ───────[This Month|Quarter|Year][Export]──┐
│ Real-time data · April 2025                                        │
├──────────────────────────────────┬─────────────────────────────┐   │
│ REVENUE vs COGS — DAILY   [Live] │ KEY PERFORMANCE RATIOS      │   │
│ ┌ dual area line, days 1–14 ────┐│ Food Cost %        28.4% ✓  │   │
│ │              h220             ││ ▬▬▬▬▬▬░░░░░ grn→teal        │   │
│ │                               ││ Budget: 30%                 │   │
│ └───────────────────────────────┘│ Labour Cost %       18.2%   │   │
│              3fr                 │ ▬▬▬▬░░░░░░░ gold→#E8C045    │   │
│                                  │ Budget: 20%                 │   │
│                                  │ Net Margin          39.2%   │   │
│                                  │ ▬▬▬▬▬▬▬▬░░ teal→blue        │   │
│                                  │ Target: 35%                 │   │
│                                  │ Table Turn         48 min   │   │
│                                  │ ▬▬▬▬▬▬░░░░ purple→blue  2fr │   │
├───────────────────┬──────────────┴────────┬────────────────────┘   │
│ REVENUE BY HOUR   │ MENU MARGIN RANKING   │ AI — NL QUERY          │
│ ┌ gold bars 10–21 │ Item        Cost% Marg│ ┌ You asked: ────────┐ │
│ │      h160      ││ Beef Burger  21% $15.0│ │"best margin item…" │ │
│ └────────────────┘│ Pasta Prim.  24% $13.6│ ├ ⚡ NEXUS AI ───────┤ │
│                   │ Chicken Sh.  28% $13.7│ │ Beef Burger — 79%… │ │
│                   │ Grilled Sal. 35% $18.2│ └────────────────────┘ │
│                   │ Caesar Sal.  42%  $8.1│ [Ask anything…][Ask]   │
│                   │                       │ Try: "Compare food…"   │
└───────────────────┴───────────────────────┴────────────────────────┘
```

---

## 11. REPORTS (`:1204-1276`)

- **Title:** `Reports` · **Subtitle:** `50+ pre-built reports · Scheduled delivery · Export ready` (**capability triple — no live numbers at all**).
- **Header action — one:** `+ Custom Report` (primary → toast). Note the header markup drops the `.flex.gap-2` wrapper and puts the button directly in the header (`:1206-1207`).
- **No KPI row, no table, no chart.** Single `.grid-3` (:1209) of three equal cards; each card is a **flex column, gap 6px** of 4 clickable report tiles = 12 tiles total.

Tile anatomy: `padding:10px`, `--bg-3` bg, radius 8, `1px solid var(--border)`, `cursor:pointer`, inline `onmouseover/onmouseout` that swaps `borderColor` to a **per-column accent** — column 1 hovers to `--primary`, column 2 to `--teal`, column 3 to `--purple`. Inside: `flex-between` with 12px/600 name + status badge, then 11px `--text-3` descriptor line.

| Card 1 — Financial Reports | Badge | Descriptor |
|---|---|---|
| Profit & Loss Statement | green `Ready` | Monthly, Quarterly, Annual · By branch |
| Balance Sheet | green `Ready` | Assets, liabilities, equity snapshot |
| AP Aging Report | green `Ready` | Outstanding payables by vendor |
| Cash Flow Statement | gold `Scheduled` | Daily auto-send to your email |

| Card 2 — Operations Reports | Badge | Descriptor |
|---|---|---|
| Food Cost % Report | teal `Live` | By item, category, and period |
| Wastage Analysis | teal `Live` | Root-cause, trend, by ingredient |
| Sales by Category | green `Ready` | Mains, starters, beverages, desserts |
| Menu Margin Ranking | green `Ready` | Best and worst performing items |

| Card 3 — HR & Vendor Reports | Badge | Descriptor |
|---|---|---|
| Payroll Summary | green `Ready` | By employee, role, and period |
| Labour vs Revenue Report | teal `Live` | Cost % by shift and department |
| Vendor Spend Analysis | green `Ready` | By vendor, category, and month |
| Customer Loyalty Report | green `Ready` | Tier breakdown, NPS, churn risk |

Badge semantics across the screen: **Ready** (generate now) / **Live** (continuously computed) / **Scheduled** (auto-delivered).

```
REPORTS
┌ Reports ──────────────────────────────────────[+ Custom Report]────┐
│ 50+ pre-built reports · Scheduled delivery · Export ready          │
├──────────────────┬──────────────────┬──────────────────┐           │
│ FINANCIAL REPORTS│ OPERATIONS REPS  │ HR & VENDOR REPS │  grid-3   │
│ ┌ P&L  [Ready]  ┐│ ┌ FoodCost[Live]┐│ ┌ Payroll[Ready]┐│           │
│ │ Mo/Qtr/Ann·   ││ │ By item, cat  ││ │ By employee…  ││           │
│ ├ BalSheet[Rdy] ┤│ ├ Wastage [Live]┤│ ├ Labour  [Live]┤│           │
│ │ Assets, liab. ││ │ Root-cause    ││ │ Cost % by shift││          │
│ ├ AP Aging[Rdy] ┤│ ├ SalesCat[Rdy] ┤│ ├ VendSpnd[Rdy] ┤│           │
│ │ By vendor     ││ │ Mains, start… ││ │ By vendor, cat││           │
│ ├ CashFlw[Sched]┤│ ├ MenuMarg[Rdy] ┤│ ├ Loyalty [Rdy] ┤│           │
│ │ Daily auto-snd││ │ Best/worst    ││ │ Tier, NPS…    ││           │
│ └ hover→primary ┘│ └ hover→teal    ┘│ └ hover→purple  ┘│           │
└──────────────────┴──────────────────┴──────────────────┘           │
```

---

## 12. ADMIN & ACCESS CONTROL (`:1277-1345`)

- **Title:** `Admin & Access Control` · **Subtitle:** `Multi-branch ready · RBAC · Full audit log` (**capability triple, no numbers**).
- **Header action — one:** `+ Invite User` (primary → toast).

**Grid skeleton — 2 rows:** `.grid-2 mb-4` **`3fr 2fr`** (:1283); right = flex column gap 16, two cards. Then a **full-width card** holding the RBAC matrix (:1324).

**Row 1 left (3fr) — "User Management"** (`padding:0`, plain header strip):
| Column | Formatting |
|---|---|
| User | 28px avatar (row 1 uses the default gold→teal gradient; rows 2-4 override to teal, blue, green gradients) + `.td-primary` name |
| Role | **badge, one color per role**: gold `Super Admin`, blue `Branch Manager`, teal `Accountant`, gray `Cashier` |
| Branch | `.text-dim` — `All Branches` / `Branch 1` |
| Last Active | `.text-dim .text-xs` — `Now` / `2h ago` / `1h ago` / `Active now` (**inconsistent vocabulary in the same column**) |
| 2FA | badge green `On` / badge gold `Off` |
| *(blank)* | ghost `Edit` |

**Row 1 right card 1 — "Branch Management"**: one solid tile — `--bg-3` bg with a **`1px solid var(--primary)`** border, `Branch 1 — Main` in primary bold + green `Active` badge, sub-line `Al-Baik Restaurant · 14 Staff · 14 Tables`. Below it an **empty-state tile**: same padding, `1px dashed var(--border)`, centered, `+ Add Second Branch` over 11px `--text-3` "Scalable to unlimited locations".
**Row 1 right card 2 — "Audit Log"**: 5 `flex-between` 11px rows — action left (`--text-2`), `actor · HH:MM` right (`--text-3`): PO #1094 approved / Ahmed R. · 19:42 · User Maria K. logged in / Maria K. · 17:30 · Stock adjusted: Salmon −2kg / Hassan B. · 14:22 · Invoice #2040 marked paid / Farhan R. · 12:10 · Payroll run initiated / Ahmed R. · 09:00. Footer = full-width centered ghost `View Full Log`.

**Row 2 — "Role Permission Matrix"** (full-width card, `padding:0`, header strip):
Columns: `Module / Permission` (left, `.td-primary`) then 5 **center-aligned** role columns — `Super Admin`, `Branch Mgr`, `Accountant`, `Cashier`, `Kitchen`. Cell vocabulary is 4-valued: `✓` (granted, default color), `—` in `.text-dim` (denied), and dimmed **word-scopes** `View` and `Summary` for partial grants.
7 rows: POS — Process Orders · POS — Void / Refund · Inventory — Adjust Stock · Finance — View P&L · Finance — Payroll · Vendors — Approve PO · Users — Manage.

```
ADMIN & RBAC
┌ Admin & Access Control ──────────────────────────[+ Invite User]───┐
│ Multi-branch ready · RBAC · Full audit log                         │
├────────────────────────────────┬─────────────────────────────┐     │
│ USER MANAGEMENT                │ BRANCH MANAGEMENT           │     │
│ User      Role  Branch Last 2FA│ ┌ Branch 1 — Main  [Active] ┐│    │
│ ◍AR Ahmed [SuperAdmin] All  Now│ │ Al-Baik · 14 Staff · 14 T ││    │
│                     [On] [Edit]│ ├ + Add Second Branch ──────┤│    │
│ ◍MK Maria [BranchMgr] Br1  2h  │ │ (dashed, centered)        ││    │
│ ◍FR Farhan[Accountant]Br1  1h  ├─────────────────────────────┤     │
│ ◍OK Omar  [Cashier]   Br1 Now  │ AUDIT LOG                   │     │
│                    [Off] [Edit]│ PO #1094 approved Ahmed·19:42│    │
│                                │ Maria K. logged in Maria·17:30│   │
│              3fr               │ Stock adj Salmon  Hassan·14:22│   │
│                                │ Invoice #2040 paid Farhan·12:10│  │
│                                │ Payroll initiated Ahmed·09:00 │   │
│                                │ [      View Full Log      ]2fr│   │
├────────────────────────────────┴──────────────────────────────┐    │
│ ROLE PERMISSION MATRIX                (full-width card)        │    │
│ Module / Permission     SuperAdm BrMgr Acct Cashier Kitchen    │    │
│ POS — Process Orders        ✓      ✓     —     ✓     View      │    │
│ POS — Void / Refund         ✓      ✓     —     —      —        │    │
│ Inventory — Adjust Stock    ✓      ✓     —     —      —        │    │
│ Finance — View P&L          ✓   Summary  ✓     —      —        │    │
│ Finance — Payroll           ✓      —     ✓     —      —        │    │
│ Vendors — Approve PO        ✓      ✓     —     —      —        │    │
│ Users — Manage              ✓      —     —     —      —        │    │
└────────────────────────────────────────────────────────────────┘    │
```

---

## 13. Charts — full spec (all 9, `:1489-1554`)

Global defaults (`:1489-1491`): `Chart.defaults.color = '#5A6E8A'` (= `--text-3`), font family `'Sora', sans-serif`, size 11.
Every tooltip in the demo uses the same skin: `backgroundColor '#1A2740'` (= `--surface-2`), `borderColor '#263850'` (= `--border-2`), `borderWidth 1`.
Grid lines are always `rgba(255,255,255,0.04)` — or `display:false` when the axis is categorical and short.

| # | Canvas | Screen (line) | Type | Series / data | Axes & legend |
|---|---|---|---|---|---|
| 1 | `revenueChart` | dashboard :686, init :1500 | **bar + overlaid line** | Revenue bars Mon–Sun `[3820,4240,3980,4680,5120,6240,5840]`, vertical gradient `rgba(232,160,69,.8)→(.3)`, `borderRadius 6`, `order 2`; Budget line `[4000,4000,4000,4000,5000,5500,5500]`, `rgba(45,212,191,.6)`, width 2, `pointRadius 0`, `tension .4`, `order 1` | legend **on**, 11px, `boxWidth 10`; both grids `.04`; y ticks `'$'+toLocaleString`; h200 |
| 2 | `categoryChart` | dashboard :758, init :1513 | doughnut, `cutout 72%` | `[42,24,18,16]` = Mains/Beverages/Starters/Desserts; colors `#E8A045 #2DD4BF #60A5FA #A78BFA`; `borderWidth 0`, `hoverOffset 4` | legend **off** — replaced by a hand-built HTML 2×2 legend; h160 |
| 3 | `forecastChart` | inventory :874, init :1517 | line, dual filled area | `Chicken (kg) [8.2,7.8,9.1,10.4,9.8,12.2,11.6]` gold, fill `rgba(232,160,69,.1)`; `Salmon (kg) [3.2,4.1,4.4,3.8,5.2,6.8,6.2]` teal, fill `.08`; `tension .4`, width 2, `pointRadius 3`; labels `Today,Tue…Sun` | legend on, **10px, boxWidth 8** (the small-card legend size); h150 |
| 4 | `wasteChart` | inventory :881, init :1524 | bar | `Waste $ [42,38,54,28,22,18,12]` Mon–Sun, `rgba(248,113,113,.7)`, `borderRadius 4` | legend **off**; x grid **off**; y ticks `'$'+v`; h120 |
| 5 | `labourChart` | hr :1013, init :1528 | line + dashed reference | `Labour % [21.4,20.8,19.6,18.9,18.4,18.2]` purple, fill `.1`, `pointRadius 3`; `Budget % [20×6]` `rgba(255,255,255,.2)`, `borderDash [4,4]`, width 1.5, `pointRadius 0`; labels W10–W15 | legend on 10px/8; x grid off; **y clamped `min:16 max:24`** (only zoomed axis in the demo); h140 |
| 6 | `vendorChart` | vendors :1074, init :1532 | **horizontal bar** (`indexAxis:'y'`) | `[3240,1840,1220,880,460]`, one color per bar `#E8A045 #2DD4BF #60A5FA #A78BFA #F87171`, `borderRadius 5`; labels contain `\n` line breaks (`Ocean\nFresh`) | legend off; x ticks `'$'+v`; y grid off; h140 |
| 7 | `loyaltyChart` | crm :1125, init :1536 | doughnut, `cutout 68%` | `[10,29,61]` **percentages**, labels carry counts: `Gold (184)`, `Silver (528)`, `Bronze (1130)`; colors `#D4AF37 #B0B4C8 #CD7F32` (metal palette, *not* the app accents) | legend **`position:'bottom'`**, 10px, `boxWidth 10`; tooltip `label + ' — ' + raw + '%'`; h160 |
| 8 | `revCOGSChart` | analytics :1152, init :1540 | line, dual filled area | Revenue teal fill `.08` / COGS red fill `.06`, 14 daily points (Apr 1–14), `tension .4`, width 2, `pointRadius 2` | legend on 11px/10; **x axis title `'April (Day)'`**; y ticks `'$'+toLocaleString`; h**220** |
| 9 | `hourlyChart` | analytics :1167, init :1547 | bar | `[120,240,580,640,420,280,320,480,820,960,840,560]` for hours 10–21, gold gradient `.8→.2`, `borderRadius 4` | legend off; x grid off + **title `'Hour'`**; y ticks `'$'+v`; h160 |

Chart heights are per-card, set inline on `.chart-container`: **220 (hero) > 200 > 160 > 150 > 140 > 120 (sparkline-scale)**.

---

## 14. Controls inventory (exhaustive)

| Control | Where | Notes |
|---|---|---|
| Segmented tabs `Week/Month/Year` | dashboard :683 | inside a card header, right-aligned |
| Segmented tabs `All/Income/Expense` | finance :940 | inside a card header, right-aligned |
| Segmented tabs `This Month/Quarter/Year` | analytics :1143 | **inside the page header**, left of `Export` |
| Category pills `All Items/Mains/Starters/Beverages/Desserts` | pos :798-804 | `.cat-btn`, radius-20, active = solid primary |
| Table chips `1–7` | pos :791 | in the page header; 3 states (free / occupied / active) |
| Search input 180px | inventory :856 | placeholder `🔍 Search ingredient...` |
| Search input 160px | crm :1100 | placeholder `Search...` |
| NL query input (full width) + `Ask` | analytics :1194-1195 | placeholder `Ask anything about your data...` |
| Qty steppers `− n +` | pos ticket, JS `:1545-1549` | 22px buttons, mono qty |
| `Filter` button (no menu) | orders :894 | label only — **no filter UI exists behind it** |
| Row-action buttons | all tables | always the last, right-aligned column: `PO`/`Edit`/`View`/`Approve`/`Track`/`Confirm` |

Header action-button pattern per screen: dashboard `[ghost Export][primary New Order]` · pos `[table chips]` · inventory `[ghost Stock Count][primary Draft PO]` · orders `[ghost Filter][primary New Order]` · finance `[ghost +Expense][ghost +Invoice][primary Reconcile]` · hr `[ghost Schedule][primary Run Payroll]` · vendors `[ghost +Vendor][primary +Purchase Order]` · crm `[ghost Segment][primary +Campaign]` · analytics `[tabs][ghost Export]` · reports `[primary +Custom Report]` · admin `[primary +Invite User]`.
**Rule: exactly one primary button per screen, always rightmost; ghosts to its left; finance is the only 3-button header.**

---

## 15. The subtitle stat-line pattern (verbatim, all 11)

| Screen | Subtitle | Shape |
|---|---|---|
| dashboard | `Monday, 14 April 2025 — Al-Baik Restaurant, Branch 1` | date — tenant, branch (em-dash) |
| pos | `Dine-In · Table 5 · Server: Omar K.` | mode · location · operator |
| inventory | `138 ingredients · 5 alerts · Last count: Today 08:00` | scale · exceptions · recency |
| orders | `127 orders today · $4,218 revenue · 3 active` | volume · money · live |
| finance | `April 2025 · All figures in USD` | period · unit convention |
| hr | `14 staff · 11 on shift today · Payroll due Apr 20` | headcount · live subset · deadline |
| vendors | `12 active vendors · 3 open POs · $6,440 outstanding` | entities · in-flight · money at risk |
| crm | `1,842 customers · 342 active this month · NPS: 72` | total · active subset · named index |
| analytics | `Real-time data · April 2025` | freshness · period |
| reports | `50+ pre-built reports · Scheduled delivery · Export ready` | capability triple |
| admin | `Multi-branch ready · RBAC · Full audit log` | capability triple |

Composition rule: **`·`-separated, 2 or 3 clauses, 12px `--text-3`, no punctuation at the end.** Clause 1 = the population size, clause 2 = the actionable subset, clause 3 = a time anchor or a money figure. Dashboard is the only screen that breaks it (uses `—` and no counts).

---

## 16. Layout ratios used, by frequency

| Ratio | Count | Screens |
|---|---|---|
| `2fr 1fr` | 4 | dashboard row 2 (:678), inventory (:852), hr (:995), vendors (:1039) |
| `3fr 2fr` | 3 | finance (:937), analytics row 1 (:1148), admin row 1 (:1283) |
| `1fr 1fr` (`.grid-2`, no override) | 1 | crm (:1098) |
| `repeat(4,1fr)` (`.grid-4`) | 6 | dashboard, inventory, orders, finance, hr, crm |
| `repeat(3,1fr)` (`.grid-3`) | 3 | dashboard row 3 (:720), analytics row 2 (:1164), reports (:1209) |
| `1fr 340px` (`.pos-layout`) | 1 | pos (:356) |
| `auto-fill minmax(130px,1fr)` | 1 | pos menu grid (:371) |
| `auto-fill minmax(200px,1fr)` (`.grid-auto`) | **0 uses** | declared at :199, never referenced (`grep -c 'class="grid-auto'` → 0) |

**The universal two-column body pattern:** wide left column = one `padding:0; overflow:hidden` card containing a header strip + a full-bleed table; narrow right column = a bare `div` with `display:flex; flex-direction:column; gap:16px` holding 2 stacked cards (chart card + list/summary card). Used verbatim on inventory, hr, vendors, crm, finance, admin.

---

## 17. Absences (verified, not assumed)

- **No modal / dialog / drawer anywhere** — `grep -ci 'modal\|dialog\|drawer\|<aside' Docs/NEXUS_ERP_Demo.html` → 0. Every mutating action resolves into the bottom-right toast.
- **No form screen** — `grep -c '<form' → 0`; the only inputs are 3 `<input class="input">` (2 search, 1 AI prompt). No `<select>`, no checkbox/radio, no date picker (`grep -c '<select\|type="checkbox"\|type="date"' → 0`).
- **No empty / loading / error state** for any table or chart; all data is hardcoded or seeded in JS.
- **No responsive rules** — `grep -c '@media' → 1`, and that one is `prefers-reduced-motion` (:52). The 240px sidebar and 340px POS panel are fixed at every viewport.
- **No light theme** — `:root` has one palette (:13-51); no `prefers-color-scheme`, no `[data-theme]`.
- **No pagination, sort headers, or column controls** on any of the 10 tables.
- `.sparkline` / `.spark-bar` are defined (:506-508) but **never used in markup** (`grep -c 'class="sparkline"' → 0`).
- `.btn-teal` (:275) and `.grid-auto` (:199) are declared and unused.
