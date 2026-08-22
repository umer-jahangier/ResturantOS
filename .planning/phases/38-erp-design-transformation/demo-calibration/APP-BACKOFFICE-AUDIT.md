# APP-BACKOFFICE-AUDIT — Back-office modules vs. the NEXUS demo

**Scope:** `frontend/components/{inventory,menu,purchasing,finance,hr,crm,users,roles,branches,settings,audit}/**`
and their routes under `frontend/app/(tenant)/app/`.
**Reference:** `Docs/NEXUS_ERP_Demo.html` (1562 lines, 11 screens).
**Method:** read-only. Every number below is a `grep`/`find` count or a `file:line`. Nothing was
built, run, or edited. Commands are given so each figure can be re-run.

---

## 0. Headline measurements

All counts exclude `__tests__` and are taken over `components/<module>` + `app/(tenant)/app/<module>`.

Command (verbatim, in `frontend/`):

```sh
grep -ro '<table'  components/<m> 'app/(tenant)/app/<m>' --include='*.tsx' | grep -v __tests__ | wc -l
grep -rl 'ui/data-grid'   ... ; grep -rl 'ui/data-table' ... ; grep -rl 'ui/status-badge' ...
grep -rl 'ui/confirm-dialog' ... ; grep -ro '<select' ... ; grep -rl 'components/ui/select' ...
grep -rl 'ui/page-header' ... ; grep -ro '<h1' ... ; grep -ro '<ul className' ...
```

| Module | raw `<table>` | files using **DataGrid** | files using **DataTable** | files using shared **StatusBadge** | files using shared **ConfirmDialog** | raw `<select>` | files using shared **Select** | files using **PageHeader** | raw `<h1>` | `<ul>` list-layouts |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| inventory | **7** | 2 | 0 | 5 | 3 | **28** | 0 | 3 | 5 | 0 |
| menu | 0 | 0 | 0 | 3 | 0 | 1 | 3 | **0** | 2 | 1 |
| purchasing | **8** | 1 | 1 | 1 | 1 | 8 | 0 | 3 | 7 | 1 |
| finance | **13** | **0** | 0 | 4 | 0 | 5 | 0 | 1 | 13 | 2 |
| hr | 6 | **0** | 0 | **0** | **0** | 4 | 3 | **0** | 5 | 0 |
| crm | 0 | **0** | 0 | 3 | 0 | 0 | 0 | **0** | 1 | 2 |
| users | 0 | **0** | 0 | 2 | 1 | 4 | 0 | **0** | 1 | 5 |
| roles | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 2 |
| branches | 0 | 0 | 0 | 1 | 1 | 0 | 1 | **0** | 1 | 1 |
| settings | 0 | 0 | 0 | 1 | 0 | 0 | 1 | **0** | 7 | 4 |
| audit | 0 | **1** | 0 | 0 | 0 | 1 | 1 | **0** | 0 | 0 |

Product-wide, for context:

- **41 files contain a raw `<table>`** (`grep -rc '<table' components app --include='*.tsx' | grep -v ':0'`), of which 2 are the primitives themselves (`ui/data-grid/data-grid.tsx`, `ui/data-table.tsx`) and 1 is a test.
- **DataGrid has exactly 4 non-primitive call sites**: `app/(tenant)/app/inventory/ingredients/page.tsx:18`, `app/(tenant)/app/inventory/stock/page.tsx:16`, `app/(tenant)/app/purchasing/purchase-orders/page.tsx:16`, `components/audit/audit-log.tsx:7`.
- **DataTable (the 38-02 façade) has 2**: `app/(tenant)/app/purchasing/vendors/[id]/page.tsx:20`, `components/pos/order-management.tsx`.
- **`FilterBar` does not exist.** `grep -rn "FilterBar" components app e2e` returns **0 lines**. 38-02-SUMMARY says so explicitly ("**No `FilterBar`.** Plan task 4. Not built").
- **69 raw `<select>` occurrences** product-wide (`grep -ro '<select' components app --include='*.tsx' | wc -l`); the shared `Select` is imported in **11 files**. Note `components/ui/select.tsx` is *itself* a styled native `<select>` by deliberate design (its docblock, lines 15–22) — so "raw select" here means an unstyled inline `<select>`, not a different control class.
- **10 files use `PageHeader`**; **67 files still declare a raw `<h1>`** (`grep -rl '<h1' components app --include='*.tsx' | wc -l` → 67, incl. platform/pos/kds/auth and the primitive's own docblock).

---

## 1. Module-by-module

### 1.1 Inventory — `components/inventory/` (23 files) · 8 routes

| Route | Layout | Table impl | Header |
|---|---|---|---|
| `/app/inventory` | 4 nav Cards (`page.tsx:27`) | none | raw `<h1 className="text-xl font-semibold">` `page.tsx:22` |
| `/app/inventory/stock` | filter row + grid + footer total | **DataGrid** `page.tsx:16,227` | **PageHeader** `page.tsx:145` (`title`, `description`) |
| `/app/inventory/ingredients` | 2 filter selects + grid | **DataGrid** `page.tsx:18,285` | **PageHeader** `page.tsx:207` |
| `/app/inventory/categories` | tree (`components/inventory/category-tree.tsx`) | none — tree, no table | raw `<h1 className="text-2xl font-semibold">` `page.tsx:132` |
| `/app/inventory/coverage` | **4 stat Cards** + table | **raw `<table>`** `page.tsx:102` | raw `<h1>` `page.tsx:45` |
| `/app/inventory/recipes` | filter select + table | **raw `<table>`** `page.tsx:115` | raw `<h1>` `page.tsx:69` |
| `/app/inventory/recipes/[menuItemId]` | form + line table | **raw `<table>`** `page.tsx:254` | raw `<h1>` `page.tsx:206` |
| `/app/inventory/setup` | two panels | **2 raw `<table>`** `page.tsx:132,216` | **PageHeader** `page.tsx:94` |

- **StatusBadge:** shared, 5 files. One **local** chip: `RiskChip` at `app/(tenant)/app/inventory/stock/page.tsx:47` — it composes `StatusBadge` with a lucide icon rather than forking it (docblock at line 44 explains why), so it is a wrapper, not drift.
- **ConfirmDialog:** shared, 3 files (categories, ingredients, setup) — migrated by 38-03.
- **Raw `<select>`: 28** — the worst concentration in the product. `components/inventory/IngredientFormDialog.tsx` alone has **12** (`grep -c '<select' → 12`), `RecipeFormDialog.tsx` 4, `recipes/[menuItemId]/page.tsx` 3, `CategoryFormDialog.tsx` 2, `UomFormDialog.tsx` 2, `ingredients/page.tsx` 2 (`:229`, `:243`), `stock/page.tsx` 1 (`:184`), `recipes/page.tsx` 1, `StockTransferDialog.tsx` 1.
- **Stat header:** only `/app/inventory/coverage` has one — 4 `Card`s wrapping `AnimatedNumber` (`page.tsx:52–83`): Total Active Menu Items / Covered / Scheduled / No Recipe. `/app/inventory/stock` has a **footer** total, not a header: `Total stock value: <MoneyDisplay …>` at `page.tsx:225`.

### 1.2 Menu — `components/menu/` (9 files) · 2 routes

| Route | Layout | Table impl | Header |
|---|---|---|---|
| `/app/menu/items` | category accordion → nested item rows in `<div className="grid gap-2">` (`page.tsx:149`) | **no table at all** | raw `<h1>` `page.tsx:100` |
| `/app/menu/routing` | board (`components/menu/station-routing-board.tsx`) | none | raw `<h1>` `page.tsx:158` |

- **Zero DataGrid, zero PageHeader.**
- Shared `StatusBadge` in 3 files. Shared `Select` in 3 files (`MenuCategoryFormDialog`, `MenuItemFormDialog`, `station-routing-board`) — menu is the **best-converged module for `Select`**; only 1 raw `<select>` remains (`MenuItemFormDialog.tsx`).
- No `ConfirmDialog` — menu uses activate/deactivate with `toast` (`items/page.tsx:78,82,90,92`), no destructive delete.
- `MenuItemImage` is used at `items/page.tsx:234`, so 38-07 task 7's image slot exists.
- **No stat header.**

### 1.3 Purchasing — `components/purchasing/` (17 files) · 10 routes  *(the demo's "Vendors")*

| Route | Layout | Table impl | Header |
|---|---|---|---|
| `/app/purchasing` | 4 nav Cards | none | raw `<h1 className="text-xl">` `page.tsx:37` |
| `/app/purchasing/purchase-orders` | status select + grid | **DataGrid** `page.tsx:16,133` | **PageHeader** `page.tsx:92` (no `description`) |
| `/app/purchasing/purchase-orders/[id]` | detail | — | raw `<h1>` `:123` + `PoStatusBadge` `:124` |
| `/app/purchasing/vendors` | **`<ul className="mt-4 divide-y rounded-lg border">`** `page.tsx:47` | **none — list, not table** | **PageHeader** `page.tsx:23` (no `description`) |
| `/app/purchasing/vendors/[id]` | tabs + 2 tables | **DataTable** `page.tsx:20,315,328,342,349` | raw `<h1>` `:277` |
| `/app/purchasing/invoices` | filter select + table | **raw `<table>`** `page.tsx:77` | raw `<h1>` `:39` |
| `/app/purchasing/invoices/[id]` | detail + `ThreeWayMatchTable` | **raw `<table>`** (component) | raw `<h1>` `:22` |
| `/app/purchasing/payments` | two panels | **2 raw `<table>`** `page.tsx:68,113` | raw `<h1>` `:42` |
| `/app/purchasing/order-suggestions` | two panels | **2 raw `<table>`** `page.tsx:224,341` | **PageHeader** `page.tsx:143` (has `description`) |
| `/app/purchasing/analytics` | period select + `SpendAnalyticsTable` | **raw `<table>`** (component) | raw `<h1>` `:58` |

- **Badges are forked here.** `components/purchasing/PoStatusBadge.tsx:25` and `components/purchasing/ThreeWayMatchTable.tsx:26` (`MatchStatusBadge`) are **two local implementations**; the shared `StatusBadge` appears in only **1** purchasing file (`vendors/[id]/page.tsx:21`). `MatchStatusBadge` is used on 3 routes (`invoices`, `invoices/[id]`, `payments`).
- **ConfirmDialog:** 1 file (`vendors/[id]`), migrated by 38-03.
- **Raw `<select>`: 8**, one per dialog plus `purchase-orders/page.tsx:96` and `analytics/page.tsx:68`.
- **No stat header on any purchasing screen.** `VendorScorecardCard.tsx` exists but is a per-vendor detail card, not a page-level stat row.

### 1.4 Finance — `components/finance/` (31 files, largest dir) · 15 routes

**13 raw `<table>` occurrences — the largest concentration in the product, and zero DataGrid.**

Nine table components, all hand-rolled (`grep -rc '<table' components/finance`):
`AccountTable.tsx:1` · `ApAgingTable.tsx:1` · `ArAgingTable.tsx:1` · `GeneralLedger.tsx:1` ·
`JournalEntryTable.tsx:1` · `TenderSplit.tsx:1` · `TillVariancePanel.tsx:1` ·
`TransactionLedgerLinks.tsx:1` · `TransactionRegister.tsx:1`.
Plus 4 in routes: `expenses/page.tsx:217`, `house-accounts/page.tsx:112`,
`journal-entries/[id]/page.tsx:128`, `periods/page.tsx:71`.

Headers: **13 raw `<h1>`, 1 PageHeader** (`periods/page.tsx:33`, with a `description` of
`FY 2024–2025 (Jul – Jun)`). `finance/page.tsx` (11 lines) has **no `<h1>` at all**.
Every other finance route uses `<h1 className="text-2xl font-semibold">` — 24px, against the
contract's `--text-h1` = 20px (see `components/ui/page-header.tsx` docblock lines 9–17).

- **Badges:** shared `StatusBadge` in 4 files; **`components/finance/PeriodStatusChip.tsx:12` is a local sixth implementation**, used at `periods/page.tsx:89`.
- **ConfirmDialog: 0 files.** Period close uses its own `PeriodCloseModal.tsx`.
- **`MoneyDisplay`** is imported in 5 finance files (`ArAgingTable`, `ApAgingTable`, `GeneralLedger`, `JournalEntryForm`, `DrCrCell`); 49 files product-wide. **12 `toFixed(2)` call sites remain outside `money-display`** (`grep -rn 'toFixed(2)' components app --include='*.tsx' | grep -v money-display | wc -l` → 12).
- **The honesty affordances are intact.** `components/finance/UnknownFigure.tsx:40` (`const headline = "Not known"`), `:46` (`aria-label="…: not known. ${figure.reason}"`), `DailyTakings.tsx:246` ("Also not known").
- **Money is still monospace on takings** — `DailyTakings.tsx:298,308,326,375` all carry `font-mono tabular-nums`. 38-08 task 3 wants this converged to tabular sans.
- **No stat header on any finance route.** No KPI row anywhere in `components/finance/`.

### 1.5 HR — `components/hr/` (8 files) · 9 routes

| Route | Layout | Table impl | Header |
|---|---|---|---|
| `/app/hr` | 6-line stub | — | **no `<h1>`** |
| `/app/hr/employees` | filter + table | **raw `<table>`** `page.tsx:131` | raw `<h1 className="text-lg font-semibold">` `:81` — **18px, two steps off contract** |
| `/app/hr/attendance` | 3 selects + table with an in-cell select | **raw `<table>`** `page.tsx:292` | **`<h1>` count = 0** |
| `/app/hr/payroll` | table | **raw `<table>`** `page.tsx:209` | raw `<h1 className="text-lg">` `:91` |
| `/app/hr/schedule` | `shift-calendar.tsx` | **raw `<table>`** (component) | raw `<h1 className="text-lg">` `:65` |
| `/app/hr/settings/{,departments,designations}` | `lookup-list-screen.tsx` | **raw `<table>`** (component) | `<h1>` inside the shared screen component |
| `/app/hr/settings/tax` | `tax-config-form.tsx` | **raw `<table>`** (component) | raw `<h1 className="text-lg">` `:54` |

- **`/app/hr/attendance` is the worst-instrumented back-office screen in the product.** Measured directly:
  `<h1>` **0**, `<label>` **0**, `aria-label` **0**, `htmlFor` **0**, `<select>` **4** (`:94, :153, :165, :312`).
  Command: `grep -c '<h1'\|'<label'\|'aria-label'\|'htmlFor' "app/(tenant)/app/hr/attendance/page.tsx"`.
  Every input on that screen is unlabelled in source. 38-03-SUMMARY deferred this ("`/app/hr/attendance` labelling is not done. Plan task 6").
- **Zero DataGrid, zero shared StatusBadge, zero ConfirmDialog, zero PageHeader** in the entire module.
- Shared `Select` **is** used in 3 files (`employees/page.tsx:12`, `settings/tax/page.tsx:8`, `components/hr/option-selects.tsx`) — HR is partially through the phase-35 select migration.
- **No stat header.** `/app/hr/attendance` renders a one-line inline summary at `page.tsx:137` (`{date}: late {n}m · early-leave {n}m`) — the closest thing in the whole back office to the demo's subtitle stat line, but it is body text below the fold, not a header.

### 1.6 CRM — `components/crm/` (3 files) · 1 route

- `/app/crm/page.tsx` (39 lines): raw `<h1 className="text-xl font-semibold">` `:17`, delegating to `customer-list.tsx` + `customer-detail.tsx`.
- **Table impl: none.** `customer-list.tsx:71` is `<ul className="divide-y rounded-md border">`; `customer-picker.tsx:157` likewise.
- Shared `StatusBadge` in all 3 files (`customer-list.tsx:89` maps a loyalty tier through `tierStatus()`).
- Zero DataGrid, zero PageHeader, zero ConfirmDialog, zero `<select>`.
- **No stat header.** No NPS, no member count, no points figure anywhere in `components/crm/`.

### 1.7 Users — `components/users/` (11 files) · 1 route

- `/app/users/page.tsx` (73 lines): raw `<h1 className="text-xl">` `:36`.
- **Table impl: none — 5 `<ul>` list layouts.** `user-list.tsx:148` (`data-testid="user-list"`), `user-detail-panel.tsx:151,257,304`, `menu-category-assignment-field.tsx:116`, `station-assignment-field.tsx:101`.
- Shared `StatusBadge` at `user-list.tsx:176,178` and `user-detail-panel.tsx:132,199`.
- **ConfirmDialog** at `user-detail-panel.tsx:9,422` — a 38-03 primitive adopted outside the five files 38-03 claims, so adoption is slightly wider than the summary states.
- **Raw `<select>`: 4** — `role-select.tsx:75`, `assign-role-dialog.tsx:207`, `user-form-dialog.tsx:260`, plus one more in `role-select.tsx`. Note `role-select.tsx:33` documents the same "empty picker is a lie" rule the shared `Select` implements — a duplicated principle, not a shared component.
- **No PageHeader, no stat header.**

### 1.8 Roles — `components/roles/` (4 files) · 1 route

- **The only back-office screen using `PageHeader`'s `meta` slot** — `app/(tenant)/app/roles/page.tsx:120`:
  `{roles.length} {roles.length === 1 ? "role" : "roles"} · {customCount} of them yours`.
  This is the **one existing instance of the demo's dot-separated stat subtitle pattern in the entire product** (`grep -rn "meta=" app components --include='*.tsx'` → 1 hit).
- Two `PageHeader` call sites (`:102` denied-state, `:118` normal), both with a `description`.
- **Table impl: none.** `role-list.tsx:34` is `<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">` — a card grid.
- Zero StatusBadge, zero ConfirmDialog, zero `<select>`, zero `<table>`.
- No permission **matrix** view; `permission-picker.tsx:162` is a nested `<ul>` checklist inside a dialog.

### 1.9 Branches — `components/branches/` (3 files) · 1 route

- `/app/branches/page.tsx` (227 lines): raw `<h1 className="text-xl">` `:116`. **No PageHeader.**
- **Table impl: none.** `branch-list.tsx:55` is `<ul className="divide-y">`; its docblock at `:19` states the design intent — "Cards on a narrow screen, a row per branch on a wide one".
- Shared `StatusBadge` `branch-list.tsx:79,81`; shared **`ConfirmDialog`** `page.tsx:12,196` (again, beyond 38-03's claimed five).
- `timezone-select.tsx` consumes `SelectOption` from the shared `Select` — 0 raw `<select>` in the module.
- **No stat header.**

### 1.10 Settings — `components/settings/` (9 files) · 7 routes

| Route | Header class | Notes |
|---|---|---|
| `/app/settings` | `<h1 className="text-xl">` `:53` | 10 `Card` nav tiles |
| `/app/settings/ai` | `text-xl` `:51` | |
| `/app/settings/audit` | `text-xl` `:48` | delegates to `components/audit/audit-log.tsx` |
| `/app/settings/health` | **`text-h1`** `:52` | contract-correct utility |
| `/app/settings/printers` | **`text-h1`** `:49` | |
| `/app/settings/service-charge` | `text-xl` `:51` | |
| `/app/settings/tax` | **`text-h1`** `:42` | |

- Three routes already use the `text-h1` utility from 38-01 but **none uses `PageHeader`** — so the type is right and the structure is not.
- **Table impl: none — 4 `<ul>` layouts** (`print-agent-panel.tsx:149`, `printer-registry-form.tsx:552`, `profile-panel.tsx:126`, `tax-class-manager.tsx:96`).
- Shared `Select` in `printer-registry-form.tsx:31`; **0 raw `<select>`** in the module.
- Zero ConfirmDialog. `settings/printers` and `tax-class-manager` both delete records without the shared primitive.
- **No stat header.**

### 1.11 Audit — `components/audit/` (1 file, 587 lines) · route `/app/settings/audit`

- **The best-converged back-office screen.** `audit-log.tsx` imports **DataGrid** (`:7,460`) *and* the shared **`Select`** (`:11`) — the only file in the product doing both.
- It still carries **1 raw `<select>`** at `:500`.
- Server-side paging deliberately bypasses `DataGrid`'s pager (`:464` comment: "The server already paged this; DataGrid must not page it a second time").
- Route wrapper has a raw `<h1 className="text-xl">` at `settings/audit/page.tsx:48` — no `PageHeader`.
- **No stat header.**

---

## 2. Shared-primitive adoption, summarised

### 2.1 Table primitives

| Implementation | Call sites | Where |
|---|---:|---|
| `DataGrid` (38-02) | **4** | inventory/ingredients, inventory/stock, purchasing/purchase-orders, audit-log |
| `DataTable` (38-02 façade) | **2** | purchasing/vendors/[id], pos/order-management |
| Hand-rolled `<table>` | **38 files** | everything else — 13 in finance, 8 in purchasing, 7 in inventory, 6 in hr |
| `<ul>` "list-not-table" | **~19** | users (5), settings (4), roles (2), crm (2), finance (2), branches, purchasing/vendors, menu |
| `FilterBar` | **0 — does not exist** | `grep -rn FilterBar components app e2e` → 0 lines |

### 2.2 Status badges — **6 implementations, still**

| Implementation | Defined at | Consumers |
|---|---|---|
| shared `StatusBadge` | `components/ui/status-badge.tsx:191` | **29 files** |
| `PoStatusBadge` | `components/purchasing/PoStatusBadge.tsx:25` | 2 routes |
| `MatchStatusBadge` | `components/purchasing/ThreeWayMatchTable.tsx:26` | 3 routes |
| `PeriodStatusChip` | `components/finance/PeriodStatusChip.tsx:12` | finance/periods |
| `PaymentStatusBadge` | `components/pos/payment-status-badge.tsx:59` | POS (out of scope) |
| `SyncStatusBadge` | `components/pos/sync-status-badge.tsx:34` | POS (out of scope) |
| `TenantStatusBadge` / `TierBadge` | `components/platform/tenant-badges.tsx:34,48` | platform (out of scope) |
| `ImpersonationStatusBadge` | `components/platform/impersonation-log.tsx:58` | platform |
| `RiskChip` | `app/(tenant)/app/inventory/stock/page.tsx:47` | wrapper over shared — **not** drift |

38-03-SUMMARY predicted this: *"the six `StatusBadge` implementations are untouched."* Confirmed —
**within the back-office scope alone, 3 forks remain** (`PoStatusBadge`, `MatchStatusBadge`, `PeriodStatusChip`).

### 2.3 ConfirmDialog

**7 files import `ui/confirm-dialog`** — the 5 that 38-03 migrated plus two it did not claim:
`app/(tenant)/app/branches/page.tsx:12` and `components/users/user-detail-panel.tsx:9`.
Modules with destructive actions and **no** shared confirm: **finance** (0), **hr** (0),
**settings** (0 — printer + tax-class deletes), **menu** (0), **crm** (0), **roles** (0).
`grep -rn "window.confirm" components app --include='*.tsx'` → **0 lines** (no native confirms lurking).

### 2.4 Selects

- **69** raw `<select>` occurrences product-wide; **50** of them inside the eleven back-office modules.
- Shared `Select` in **11 files**, of which back-office: menu (3), hr (3), audit (1), settings (1), branches (1).
- **`components/inventory/IngredientFormDialog.tsx` has 12 in one file** — 17% of the product total.
- Both 38-07 and 38-08 explicitly hand this to **phase 35**, not to phase 38.

### 2.5 Page headers and stat lines

- `PageHeader` importers: **10 files**; only **6** pass a `description`; only **1** passes `meta` (roles).
- **Zero back-office screens have a KPI/stat row** except `/app/inventory/coverage` (4 `Card`s + `AnimatedNumber`, `page.tsx:52–83`).
- `grep -rln "StatCard\|KpiCard\|MetricCard\|SummaryCard\|StatTile" components app` returns **3 files**, all outside back-office (`components/reporting/FbrTaxSummaryCard.tsx`, `app/reports/fbr`, `app/(platform)/platform/dashboard`). **There is no reusable stat-tile primitive in this product.**

---

## 3. Demo ↔ real-app mapping

The demo has **11 screens** (`grep -n 'class="screen' Docs/NEXUS_ERP_Demo.html`): dashboard, pos,
inventory, orders, finance, hr, vendors, crm, analytics, reports, admin.

### 3.1 Demo screen → real module

| Demo screen (line) | Demo subtitle stat line | Real module | Match quality |
|---|---|---|---|
| `dashboard` (638) | `Monday, 14 April 2025 — Al-Baik Restaurant, Branch 1` | `/app/dashboard` | out of this audit's scope |
| `pos` (783) | `Dine-In · Table 5 · Server: Omar K.` | `/app/pos` | out of scope (POS audit) |
| `inventory` (836) | `138 ingredients · 5 alerts · Last count: Today 08:00` | `/app/inventory/*` (8 routes) | **1 demo screen ↔ 8 real routes** |
| `orders` (890) | `127 orders today · $4,218 revenue · 3 active` | `/app/pos/orders` | out of scope (POS) |
| `finance` (920) | `April 2025 · All figures in USD` | `/app/finance/*` (15 routes) | **1 ↔ 15** |
| `hr` (979) | `14 staff · 11 on shift today · Payroll due Apr 20` | `/app/hr/*` (9 routes) | **1 ↔ 9** |
| `vendors` (1031) | `12 active vendors · 3 open POs · $6,440 outstanding` | `/app/purchasing/*` (10 routes) | **1 ↔ 10** |
| `crm` (1083) | `1,842 customers · 342 active this month · NPS: 72` | `/app/crm` (1 route) | 1 ↔ 1 |
| `analytics` (1139) | `Real-time data · April 2025` | `/app/reporting`, `/app/dashboard/realtime`, **and `/app/nlq`** | see 3.3 |
| `reports` (1204) | `50+ pre-built reports · Scheduled delivery · Export ready` | `/app/reports`, `/app/reports/[code]`, `/app/reports/fbr` | 1 ↔ 3 |
| `admin` (1277) | `Multi-branch ready · RBAC · Full audit log` | **`/app/users` + `/app/branches` + `/app/roles` + `/app/settings/audit`** | **1 ↔ 4** |

**The demo compresses the whole back office into 6 screens; the real app has **74** route files under
`app/(tenant)/app/`.** The demo's per-screen density is the design signal, not its screen count.

### 3.2 Demo screens with NO real 1:1 module

Strictly, **none** — every demo screen maps to something. But three map only *partially*:

1. **`analytics`** — the demo's `Key Performance Ratios`, `Revenue by Hour`, `Menu Margin Ranking`
   and `Revenue vs COGS — Daily` cards have no single real home; they are split across
   `/app/reporting`, `/app/dashboard/realtime` and `/app/reports/[code]`.
2. **`reports`** — the demo groups reports into `Financial Reports` / `Operations Reports` /
   `HR & Vendor Reports` cards. `/app/reports/page.tsx` uses `PageHeader` with description
   "Named reports backed by real sales, cash and purchasing data" but no grouping cards.
3. **`admin`** — a single screen containing four real modules (below).

### 3.3 What the demo's `admin` screen actually gives us (corrects a common assumption)

Reading `Docs/NEXUS_ERP_Demo.html:1277–1352`, the admin screen contains **four** blocks:

| Demo block (line) | Real module | Real implementation today |
|---|---|---|
| `User Management` table — cols User / Role / Branch / Last Active / 2FA (1285–1294) | **users** | `<ul>` at `user-list.tsx:148`; **no** last-active, **no** 2FA column |
| `Branch Management` cards + "+ Add Second Branch" dashed tile (1298–1308) | **branches** | `<ul>` at `branch-list.tsx:55`; no dashed add-tile |
| `Audit Log` — 5 compact `event · actor · time` rows + "View Full Log" (1309–1320) | **audit** | full `DataGrid` at `audit-log.tsx:460`; **no compact digest view exists** |
| `Role Permission Matrix` table — permission × 5 roles (1326–1341) | **roles** | `<ul>` card grid at `role-list.tsx:34`; **no matrix view exists** |

And `Docs/NEXUS_ERP_Demo.html:1139–1204` contains a card titled **`AI — Natural Language Query`**,
which is direct guidance for `/app/nlq`.

**So: users, branches, roles, audit and NLQ DO have demo guidance** — inside `admin` and
`analytics` respectively, not as their own screens.

### 3.4 Real modules with NO demo guidance — these need extrapolation

| Real module | Routes | Nearest demo language to extrapolate from |
|---|---|---|
| **menu** | `/app/menu/items`, `/app/menu/routing` | none. Closest: the demo POS's `menu-item` card grid (`renderMenu()`, line 1421) — but that is an order-taking grid, not a catalogue editor. **Needs a design.** |
| **stations** | `/app/stations` | none. Demo has no kitchen-station concept. Extrapolate from `admin`'s Branch Management card list. |
| **terminals** | `/app/terminals` | none. Extrapolate from `admin`'s User Management table (device row + status badge + last-seen). |
| **tables** | `/app/tables` | demo POS has a table concept in its subtitle only (`Table 5`); no table-management screen. |
| **settings/*** | 7 routes (`ai`, `audit`, `health`, `printers`, `service-charge`, `tax`, root) | none — the demo has no settings screen at all. `audit` is the one exception (see 3.3). |
| **platform admin** | `app/(platform)/**` | none. The demo is single-tenant; it has no tenant concept. |
| **kitchen / KDS** | `/app/kitchen/*` | none (out of back-office scope, noted for completeness). |
| **finance sub-ledger depth** | `accounts`, `gl`, `journal-entries`, `periods`, `ap-aging`, `ar-aging`, `house-accounts`, `takings`, `transactions`, `guide` | the demo's `finance` screen is 4 KPIs + a transaction list + charts. **It has no chart of accounts, no journal entry, no period close, no aging.** These 10 routes have essentially no demo guidance. |
| **inventory depth** | `categories`, `coverage`, `recipes`, `recipes/[id]`, `setup` | the demo's `inventory` screen is 4 KPIs + a stock-level table + 2 charts. **No recipe, no BOM, no UoM setup, no category tree.** |
| **purchasing depth** | `invoices`, `invoices/[id]`, `payments`, `order-suggestions`, `analytics` | the demo's `vendors` screen is a directory table + an open-PO card list + a spend chart. **No three-way match, no AP aging, no reorder suggestion engine.** |
| **hr depth** | `attendance`, `payroll`, `schedule`, `settings/*` | the demo's `hr` screen is a staff directory + labour-cost chart + shift-coverage card. **No payroll run, no attendance clock, no tax/EOBI config.** |

**The pattern:** the demo gives strong guidance for the **landing screen** of each module family and
none at all for the **operational depth** underneath it. Extrapolating requires taking the demo's
grammar — page title + dot-separated stat subtitle, a 4-up KPI row, a `2fr 1fr` split of primary
table against a right-hand card stack, `padding:0;overflow:hidden` cards wrapping full-bleed tables
with a `card-title` + inline search in the header strip — and applying it downward.

### 3.5 The demo's design grammar, measured

Values taken from `Docs/NEXUS_ERP_Demo.html:196–300`:

| Element | Demo value | Real-app equivalent |
|---|---|---|
| `.page-title` | `font-family: Fraunces` (display serif), **26px**, weight 600, `line-height: 1` | `--text-h1` = 20/28 weight 600, sans (`page-header.tsx:69`) |
| `.page-subtitle` | **12px**, `var(--text-3)` (`#5A6E8A`), `margin-top: 4px` | `PageHeader.meta` at `--text-small`, `text-foreground-tertiary` — **structurally identical, used once** |
| `.kpi-value` | Fraunces, **28px**, weight 600 | no primitive |
| `.kpi-label` | **11px**, weight 500, `letter-spacing: .05em` | matches `--text-label` (11px) from 38-01 |
| `.kpi-change` | 11px, `.up` green / `.down` red, + a `.kpi-meta` grey qualifier | no primitive |
| `.data-table th` | **11px**, uppercase, `.07em`, `background: var(--bg-3)` | `DataGrid` header = 11px `--text-label` — **match** |
| `.data-table td` | **13px**, `padding: 11px 14px` | `DataGrid` cell = 13px `--text-small`, row height 44 — **match** |
| `.badge` | **11px**, weight 600, `padding: 2px 8px`, `border-radius: 20px`, optional `.badge-dot` | `StatusBadge` — the `.badge-dot` leading marker has no equivalent |
| `.card` header strip | `padding:16px 20px; border-bottom` + `card-title` (12px uppercase `.08em`) + inline search `input` | **no equivalent** — this is what `FilterBar` was supposed to be |
| Grid split | `grid-2` with `grid-template-columns: 2fr 1fr` — table left, card stack right | used on inventory, vendors, crm, admin. **Zero back-office screens do this today.** |

The two things the demo has that this codebase has **no primitive for at all**: the **KPI card**
and the **card header strip** (title + inline search over a full-bleed table).

---

## 4. 38-07-PLAN.md — status per task

`38-07-PLAN.md` has **no `38-07-SUMMARY.md`** (`ls .planning/phases/38-erp-design-transformation/` shows summaries for 01 and 02 only… and 03). Status below is derived from the code.

| # | Task | Status | Evidence |
|---|---|---|---|
| 1 | Migrate 12 routes to `DataGrid` + `FilterBar` | **PARTIAL — 3 of 12; FilterBar 0 of 12** | Done: `inventory/stock:227`, `inventory/ingredients:285`, `purchasing/purchase-orders:133`. Not done: `inventory/{categories,coverage,recipes,setup}`, `menu/items`, `purchasing/{vendors,invoices,payments,order-suggestions}`. `grep -rn FilterBar` → **0 lines**; 38-02-SUMMARY says it was never built. |
| 2 | PO number becomes a human identifier; drop "Expected date"; paginate | **PARTIAL** | Paginated ✅ (`DataGrid` at `:133`, verified in 38-02 as "Page 1 of 4 · 84 rows"). Identifier ❌ — `poReference()` at `purchase-orders/page.tsx:37` still returns `po.id.slice(0,8).toUpperCase()`; the docblock at `:30` labels it "a stopgap" and says the endpoint exposes no PO number. "Expected date" **still declared** at `:72`; the docblock at `:84` argues it correctly survives `dropEmptyColumns` because one of 84 rows is populated — a **deliberate, documented deviation** from the plan. |
| 3 | Low/out-of-stock alerts on three channels (icon + text + colour) | **DONE for `/app/inventory/stock`** | `RiskChip` at `stock/page.tsx:47–66`: `XCircle` + `StatusBadge status="error" label="Out of stock"`, `AlertTriangle` + `label="Below reorder point"`, plus `rowClassName` tinting at `:40`. Not applied on `ingredients`, `coverage`, `recipes`. |
| 4 | Negative on-hand gets a stated reason | **UNTOUCHED** | `grep -n "negative\|Why?\|UnknownFigure" app/(tenant)/app/inventory/stock/page.tsx` → **0 lines**. `Total stock value` at `:225` renders `<MoneyDisplay paisa={…}>` with no qualifier; per-row `Stock value` at `:126` likewise. The plan's negative control #4 ("Watch this fail against today's code first") would still fail. |
| 5 | Bulk actions with `{n} selected` + `ConfirmDialog` naming the count | **UNTOUCHED** | `grep -rn "bulkActions" components app` → **5 hits, all inside `data-grid.tsx` itself** (`:36,120,141,170,218`). **No call site passes `bulkActions`.** 38-02-SUMMARY says the same ("Bulk actions are supported but unused"). |
| 6 | Menu availability toggle — optimistic + toast, revert on failure | **PARTIAL** | Toasts exist: `menu/items/page.tsx:78,82,90,92` (success and `toast.error(error.message …)`). No `onMutate`/optimistic path found (`grep -n "optimistic\|onMutate" menu/items/page.tsx` → 0). So the toast half is done, the optimistic-revert half is not. |
| 7 | Product cards on `/app/menu/items` (image, name, price, category, availability) | **PARTIAL** | `MenuItemImage` is rendered at `menu/items/page.tsx:234`, layout is `<div className="grid gap-2">` at `:149` with `StatusBadge` for inactive at `:184,241`. It is a nested accordion list, not the demo's product-card grid. |
| 8 | `PageHeader` on every screen in the family; targets to 44px | **PARTIAL — 6 of 14** | Have it: `inventory/{stock,ingredients,setup}`, `purchasing/{purchase-orders,vendors,order-suggestions}`. Missing: `inventory/{categories,coverage,recipes,recipes/[id]}`, `menu/{items,routing}`, `purchasing/{invoices,payments,analytics}`. Target sizes not re-measured here (needs a browser). |
| — | `e2e/journeys/inventory-purchasing.spec.ts` | **ABSENT** | `ls frontend/e2e/journeys/inventory-purchasing.spec.ts` → `No such file or directory`. |

**38-07 overall: 1 task done, 5 partial, 2 untouched, verification harness absent.**

## 5. 38-08-PLAN.md — status per task

| # | Task | Status | Evidence |
|---|---|---|---|
| 1 | Migrate the **nine** finance tables to `DataGrid` | **UNTOUCHED — 0 of 9** | `grep -rl 'ui/data-grid' components/finance 'app/(tenant)/app/finance'` → **0 files**. All nine (`AccountTable`, `ApAgingTable`, `ArAgingTable`, `GeneralLedger`, `JournalEntryTable`, `TenderSplit`, `TillVariancePanel`, `TransactionLedgerLinks`, `TransactionRegister`) still contain a raw `<table>`, plus 4 more in routes. |
| 2 | Money through `MoneyDisplay` only; negatives in parentheses | **PARTIAL** | `MoneyDisplay` imported in 49 files including 5 finance components. But **12 `toFixed(2)` sites remain outside `money-display`** (`grep -rn 'toFixed(2)' components app --include='*.tsx' \| grep -v money-display \| wc -l` → 12). Parentheses behaviour not re-verified here. |
| 3 | One money typeface — takings converges from monospace to tabular sans | **UNTOUCHED** | `components/finance/DailyTakings.tsx:298,308,326,375` all still carry `font-mono tabular-nums`. |
| 4 | Preserve every honesty affordance | **DONE (intact, unchanged)** | `UnknownFigure.tsx:40` `const headline = "Not known"`, `:46` `aria-label="…: not known. ${figure.reason}"`; `DailyTakings.tsx:246` "Also not known". Nothing in this area was modified, which is the desired outcome. Whether an *assertion* now guards it was not checked in source. |
| 5 | CRM and HR lists to `DataGrid`; `PageHeader`, `StatusBadge`, `ConfirmDialog` on each | **UNTOUCHED** | crm: DataGrid 0, PageHeader 0, ConfirmDialog 0 (`StatusBadge` ✅ in 3 files, pre-existing). hr: DataGrid 0, PageHeader 0, StatusBadge 0, ConfirmDialog 0. |
| 6 | `/app/hr/attendance` — 6 unlabelled inputs, 3 unnamed controls, `h1Count = 0` | **UNTOUCHED** | Re-measured in source: `<h1>` **0**, `<label>` **0**, `aria-label` **0**, `htmlFor` **0**, `<select>` **4**. Every one of the plan's stated defects is still present. |
| 7 | G3 literal baselines → 0 for `TillVariancePanel`, `TransactionRegister`, `PeriodCloseModal`, `PeriodStatusChip` | **NOT VERIFIED HERE** | Requires running the conformance scanner (`__tests__/lib/theme/conformance-scan.ts`); this audit does not run tests. All four files still exist unmodified in shape (`PeriodStatusChip.tsx` is 22 lines and still a fork). |
| — | `e2e/journeys/finance-tables.spec.ts` | **ABSENT** | `ls frontend/e2e/journeys/finance-tables.spec.ts` → `No such file or directory`. |

**38-08 overall: 1 task effectively satisfied (by non-regression), 1 partial, 5 untouched, verification harness absent.**

---

## 6. The five things that matter most

1. **`FilterBar` does not exist, and both wave-4 plans depend on it.** `grep -rn "FilterBar" components app e2e` returns zero lines. 38-07 task 1 names it in the same breath as `DataGrid` for twelve routes. Every filter in the back office is therefore a bare inline `<select>` sitting loose above a table — `inventory/stock:184`, `inventory/ingredients:229,243`, `purchasing/purchase-orders:96`, `purchasing/invoices:41`, `finance/accounts:51`, `finance/expenses:182`, `hr/attendance:94,153,165`. The demo's equivalent is the card header strip (`padding:16px 20px; border-bottom` + `card-title` + inline search input) which appears on 5 of its 11 screens. This is the single highest-leverage missing primitive.

2. **DataGrid adoption is 4 call sites out of ~40 tables; finance — the module the plan calls the largest concentration — has zero.** Thirteen raw `<table>` occurrences live in finance, spread over nine components plus four routes, and not one imports `ui/data-grid`. Wave 4 is, in table terms, essentially unstarted: 38-07 delivered 3 of 12 routes and 38-08 delivered 0 of 9 tables.

3. **The demo's stat subtitle exists in this product exactly once.** `grep -rn "meta=" app components --include='*.tsx'` returns **one hit** — `app/(tenant)/app/roles/page.tsx:120`, rendering `{n} roles · {m} of them yours`. The `PageHeader.meta` slot was built for precisely the demo's `138 ingredients · 5 alerts · Last count: Today 08:00` pattern and is used on 1 of 74 routes. Meanwhile **no back-office screen has a KPI row** except `/app/inventory/coverage` (4 `Card`s + `AnimatedNumber`, `page.tsx:52–83`), and **no stat-tile primitive exists anywhere in the codebase**.

4. **Half the back office is `<ul>`, not tables — so "migrate the tables" misses it.** Users (5 `<ul>` layouts), settings (4), roles (2), crm (2), branches (1) and `purchasing/vendors` (1) render list rows, not tabular data. `purchasing/vendors/page.tsx:47` is a `<ul className="divide-y">` where the demo shows a 7-column `Vendor Directory` table with lead time, a numeric supplier score and outstanding balance. A `DataGrid` migration plan scoped to files containing `<table>` will silently skip every one of these screens.

5. **`/app/hr/attendance` has no `<h1>`, no `<label>`, no `aria-label` and no `htmlFor` — zero of each — and 4 raw `<select>`s.** 38-03 deferred it, 38-08 task 6 named it and left it. It is the only back-office screen that is simultaneously unlabelled, unheaded and un-migrated. 38-08 also carries an explicit warning that gates anchored on HR routes while `hr-service` is down will *skip and report green*; the plan-named spec `e2e/journeys/finance-tables.spec.ts` does not exist at all, so there is currently no gate to skip.

### Correction worth carrying forward

The task brief assumed the demo has **no equivalent for users, branches, roles, audit and NLQ**. It
does. `Docs/NEXUS_ERP_Demo.html:1277–1352` (`admin`) contains a **User Management table** (User /
Role / Branch / Last Active / 2FA), a **Branch Management** card stack with a dashed "+ Add Second
Branch" tile, a compact **Audit Log** digest with a "View Full Log" button, and a **Role Permission
Matrix** (permission × 5 roles). `:1139–1204` (`analytics`) contains an **AI — Natural Language
Query** card. Two of those — the **role matrix** and the **audit digest** — have **no counterpart in
the real app at all** (`role-list.tsx:34` is a card grid; `audit-log.tsx:460` is a full paged grid
with no digest view), so they are net-new design work rather than restyling.

The modules genuinely without demo guidance are: **menu, stations, terminals, tables, settings (6 of
7 routes), platform admin**, plus the operational depth beneath every module landing screen —
10 finance routes, 5 inventory routes, 5 purchasing routes, 6 HR routes.
