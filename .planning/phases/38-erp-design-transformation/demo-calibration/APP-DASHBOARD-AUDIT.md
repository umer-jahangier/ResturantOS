# APP-DASHBOARD-AUDIT — Dashboards, Reports & Analytics

**Scope:** `frontend/components/dashboard/**`, `frontend/components/reporting/**`,
`frontend/components/platform/**`, routes `app/(tenant)/app/{dashboard,reports,nlq}`,
`app/(platform)/platform/**`, plus the authoritative RBAC seed in
`services/auth-service/src/main/resources/db/changelog/v1.0.0/`.

**Method:** read-only. Every claim below is anchored to a `file:line` or to a command whose
output is quoted. Nothing was built, no server was started, no source file was modified.
Branch at time of audit: `phase-13-access-repair`.

---

## 1. Inventory of what exists

`find frontend/components/dashboard frontend/components/reporting frontend/components/platform -type f`
returns exactly 22 files:

| File | Lines |
|---|---|
| `frontend/components/dashboard/dashboard-shell.tsx` | 122 |
| `frontend/components/dashboard/dashboard-type.ts` | 20 |
| `frontend/components/dashboard/focused-dashboard.tsx` | 191 |
| `frontend/components/dashboard/manager-dashboard.tsx` | 319 |
| `frontend/components/dashboard/owner-dashboard.tsx` | 258 |
| `frontend/components/dashboard/presets.ts` | 332 |
| `frontend/components/dashboard/tenant-dashboard.tsx` | 47 |
| `frontend/components/dashboard/portlets/portlet.tsx` | 416 |
| `frontend/components/dashboard/portlets/trend-chart.tsx` | 292 |
| `frontend/components/reporting/DashboardTileGrid.tsx` | 73 |
| `frontend/components/reporting/FbrTaxSummaryCard.tsx` | 94 |
| `frontend/components/reporting/ReportTable.tsx` | 114 |
| `frontend/components/platform/*` (9 files) | 1 442 total |

Routes actually present (`find "frontend/app/(tenant)/app/dashboard" ".../reports" ".../nlq" "frontend/app/(platform)" -type f`):

```
frontend/app/(platform)/layout.tsx
frontend/app/(platform)/platform/dashboard/page.tsx
frontend/app/(platform)/platform/impersonations/page.tsx
frontend/app/(platform)/platform/tenants/[tenantId]/page.tsx
frontend/app/(platform)/platform/tenants/page.tsx
frontend/app/(tenant)/app/dashboard/page.tsx            (16 lines)
frontend/app/(tenant)/app/dashboard/realtime/page.tsx   (57 lines)
frontend/app/(tenant)/app/nlq/page.tsx                  (50 lines)
frontend/app/(tenant)/app/reports/page.tsx              (90 lines)
frontend/app/(tenant)/app/reports/[code]/page.tsx
frontend/app/(tenant)/app/reports/fbr/page.tsx
```

There are **two separate, unrelated dashboards** in the tenant app:
`/app/dashboard` (the role-preset portlet dashboard) and `/app/dashboard/realtime`
(the ClickHouse/WebSocket tile grid). They share no component, no hook and no data source.
Both are reachable from the sidebar — `sidebar-nav-items.ts:83` and `:169`.

---

## 2. Role presets: which exist, what they contain, what feeds them

Source of truth: `frontend/components/dashboard/presets.ts`. **Four** preset ids
(`presets.ts:29`): `"owner" | "manager" | "cashier" | "kitchen"`.

Routing: `frontend/components/dashboard/tenant-dashboard.tsx:36-46` switches on
`resolveDashboardPreset(roles, permissions)` (`presets.ts:301-322`) and renders one of four
components. Before the session rehydrates it renders `DashboardSkeleton`
(`tenant-dashboard.tsx:32-34`).

### 2.1 OWNER preset — `presets.ts:82-146`
question "Is the business healthy?" · timeFrame "Last 30 days vs the 30 before" · density `comfortable`
Implemented in `owner-dashboard.tsx`.

| Portlet id | Declared type | Permission | Data hook (file:line) | Backing call |
|---|---|---|---|---|
| `owner-net-sales` | KpiTile | `reporting.report.view` | `useRunReport("sales-by-day", …)` `owner-dashboard.tsx:77` | `POST /api/v1/reporting/reports/sales-by-day/run` |
| `owner-gross-margin` | KpiTile | `reporting.report.view` | `useRunReport("sales-by-item")` `:79` | same; **always renders `—`** (`owner-dashboard.tsx:175`, hardcoded `value="—"`) |
| `owner-covers` | KpiTile | `pos.order.view` | `useOrderSummaries(["CLOSED"])` `:80` | pos-service order summaries |
| `owner-avg-order` | KpiTile | `pos.order.view` | derived from `sales-by-day` `:94` | — |
| `owner-sales-trend` | TrendChart | `reporting.report.view` | `sales-by-day` rows `:100-118` | — |
| `owner-top-items` | RankedList | `reporting.report.view` | `sales-by-item` rows `:120-135` | — |
| `owner-exceptions` | ExceptionList | `pos.order.view` | `useOrderSummaries(["VOIDED","REFUNDED"])` `:81` | pos-service |

Prior-period comparison is a **second** `sales-by-day` run over `[-60d, -31d]`
(`owner-dashboard.tsx:78`). `pctChange` returns `null` when prior ≤ 0 and the tile then prints
"No comparable prior period" rather than `0%` (`portlet.tsx:187-189`).

### 2.2 MANAGER preset — `presets.ts:154-215`
question "What needs me in the next five minutes?" · timeFrame "Today, live" · density `compact`
Implemented in `manager-dashboard.tsx`. Six queries (`manager-dashboard.tsx:49-54`):

| Portlet id | Type | Permission | Hook |
|---|---|---|---|
| `manager-open-orders` | KpiTile | `pos.order.view` | `useOrderSummaries()` |
| `manager-late-tickets` | KpiTile | `pos.kds.view` | `useKdsTickets(branchId)` + `useKdsStations(branchId)` |
| `manager-till-variance` | KpiTile | `pos.till.review` | `useBranchTills(branchId)` |
| `manager-tables-occupied` | KpiTile | `pos.order.view` | `useTables()` |
| `manager-live-orders` | RecordList | `pos.order.view` | `useOrderSummaries()` |
| `manager-station-load` | RankedList | `pos.kds.view` | tickets + stations |
| `manager-exceptions` | ExceptionList | `pos.order.view` | tickets + stations + tills (merged, `:127-154`) |
| `manager-86d` | RankedList | `pos.menu.view` | `useMenuItemsAdmin()` |

"Late" reuses the KDS board's own `getAgingState` against each station's
`escalationThresholdSeconds` (`manager-dashboard.tsx:68-85`), defaulting to 900s.
Error granularity is **per portlet** — 8 separate `<QueryBoundary>` wrappers
(`manager-dashboard.tsx:190-316`), documented at `:170-189` as the fix for a page-wide boundary
that blanked the whole dashboard on one transient 503.

### 2.3 CASHIER preset — `presets.ts:222-243`
question "Where is my till, and what is still open?" · `compact` · 3 portlets:
`cashier-till` (KpiTile, `pos.till.open`), `cashier-open-orders` (KpiTile, `pos.order.view`),
`cashier-shortcuts` (Shortcuts, **no permission**).
Hooks: `useActiveTill()`, `useOrderSummaries()` (`focused-dashboard.tsx:71-72`).

### 2.4 KITCHEN preset — `presets.ts:250-282`
question "What is on the pass?" · `compact` · 3 portlets:
`kitchen-late-tickets`, `kitchen-open-tickets` (both `pos.kds.view`), `kitchen-shortcuts`.
Hooks: `useKdsTickets`, `useKdsStations` (`focused-dashboard.tsx:141-142`).

### 2.5 The `/app/dashboard/realtime` tiles (a fifth, preset-less dashboard)
`app/(tenant)/app/dashboard/realtime/page.tsx` + `components/reporting/DashboardTileGrid.tsx`.
Hooks `useDashboardTiles(branchId)` (`lib/hooks/reporting/use-reports.ts:47`) →
`GET /api/v1/reporting/dashboard/{branchId}/tiles`, then `useDashboardSocket` merges live pushes
into the same cache key. Server side, `DashboardTileService.queryTiles`
(`services/reporting-service/.../service/DashboardTileService.java:144-163`) returns **exactly
four** hardcoded tiles from one ClickHouse query:
`todays-revenue`, `todays-orders`, `todays-tax`, `average-order-value`
(the last is `null` when `orderCount == 0`, never `0` — `:155`).
A fifth tile, `open-tills`, is deliberately absent — `till_session_facts` is written only on
`TILL_CLOSED`, so "tills currently open" is not computable (`DashboardTileService.java:34-37`).

---

## 3. Portlet TYPES: implemented vs merely declared — PROVEN

`PortletType` (`presets.ts:32-39`) declares six: `KpiTile | TrendChart | RankedList |
ExceptionList | RecordList | Shortcuts`.

`ls frontend/components/dashboard/portlets/` → `portlet.tsx`, `trend-chart.tsx` (2 files).

`grep -rn "export function \(KpiTile\|RankedList\|ExceptionList\|RecordList\|TrendChart\|PortletShell\)" frontend/components`:

```
frontend/components/dashboard/portlets/trend-chart.tsx:69  export function TrendChart(
frontend/components/dashboard/portlets/portlet.tsx:37      export function PortletShell(
frontend/components/dashboard/portlets/portlet.tsx:122     export function KpiTile(
frontend/components/dashboard/portlets/portlet.tsx:243     export function RankedList(
frontend/components/dashboard/portlets/portlet.tsx:311     export function ExceptionList(
frontend/components/dashboard/portlets/portlet.tsx:374     export function RecordList(
```

| Type | Implemented? | Evidence |
|---|---|---|
| `KpiTile` | **YES** | `portlet.tsx:122` — value, caption, delta, tone, optional `Sparkline` (`portlet.tsx:200-216`), `unavailableReason` → `—` + reason |
| `RankedList` | **YES** | `portlet.tsx:243` — labelled rows + optional proportional bar (`fraction` is **optional**, `portlet.tsx:240`; no fraction → no bar, `:278`) |
| `ExceptionList` | **YES** | `portlet.tsx:311` — severity as badge word ACT/CHECK/FYI + colour |
| `RecordList` | **YES** | `portlet.tsx:374` — primary/secondary/trailing rows |
| `TrendChart` | **YES** | `trend-chart.tsx:69` — hand-written inline SVG, two polylines, direct end-of-line labels, dash patterns, `aria-hidden` SVG over a visually-hidden `<table>` |
| `Shortcuts` | **NO — ABSENT** | `grep -rn "function Shortcuts\|const Shortcuts\|<Shortcuts" frontend/components frontend/app frontend/lib` → **no matches**. `grep -rn "Shortcuts" frontend --include="*.ts" --include="*.tsx"` (excluding `node_modules`) returns only three lines: `presets.ts:38`, `presets.ts:253`, `presets.ts:284` |

**So five of six are implemented. Only `Shortcuts` is declared-but-unimplemented.**

The `cashier-shortcuts` / `kitchen-shortcuts` slots are instead filled by a local
`PrimaryAction` component (`focused-dashboard.tsx:29-54`) — a 72px `<Link>` labelled
"Open POS" / "Open KDS board". That link is rendered **unconditionally**
(`focused-dashboard.tsx:114-118`, `:183-187`) — it is *not* wrapped in
`shown.has("cashier-shortcuts")` the way the two KPI tiles above it are.

### 3.1 A second, larger finding: `PortletSpec.type` and `PortletSpec.drillTo` are dead data

`grep -rn "\.type ===\|switch (p\.type\|portlet\.type\|spec\.type\|p\.type" frontend/components/dashboard frontend/app frontend/__tests__`
→ **no matches**. Nothing anywhere branches on `PortletSpec.type`.

There is no generic portlet renderer. Each of the four dashboard components hand-writes its JSX
and only consults `visiblePortlets(...)` to build a `Set` of **ids**
(`owner-dashboard.tsx:69-70`, `manager-dashboard.tsx:46-47`, `focused-dashboard.tsx:66-69`,
`:136-139`), then guards each hardcoded block with `shown.has("<id>")`.

`drillTo` is likewise never read from the preset: every call site passes a string literal
(`owner-dashboard.tsx:161,173,188,198,215,235,248`; `manager-dashboard.tsx`; `focused-dashboard.tsx`).

Consequence: the preset table is a **permission filter plus a page header**, not a layout engine.
`type`, `drillTo` and `row` are documentation that the compiler checks and the runtime ignores.
Changing a portlet's `type` in `presets.ts` changes nothing on screen.

---

## 4. What the dashboard actually renders TODAY

### 4.1 Layout & density
`DashboardShell` (`dashboard-shell.tsx:22-45`) — a `<section>` with `gap-4` (compact) or `gap-6`
(comfortable), a `<header>` carrying `<h1>{preset.question}</h1>` at `--text-display` and the
timeframe at `--text-small`, right-aligned. Attributes `data-testid="dashboard"`,
`data-preset`, `data-density`.

`PortletRow` (`dashboard-shell.tsx:52-96`) — fixed column counts, no auto-fit:
- `columns={4}` → `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`
- `columns={2}` → `grid-cols-1 lg:grid-cols-2`
- `columns={1}` → `grid-cols-1`
Gap: `gap-3` compact / `gap-4` comfortable. It clones each child to inject `--vdl-i` for a
staggered entrance (`vdl-stagger`, `dashboard-shell.tsx:76,83-93`).

Concrete row structure rendered today:
- **Owner:** row of 4 KPI tiles → row of 2 (TrendChart panel | RankedList) → row of 1 (ExceptionList).
- **Manager:** row of 4 KPI tiles → row of 2 (RecordList | RankedList) → row of 2 (ExceptionList | RankedList).
- **Cashier / Kitchen:** row of 2 KPI tiles → row of 1 containing a single 72px button.

### 4.2 Portlet chrome
`PortletShell` (`portlet.tsx:37-94`): **the whole card is a `<Link>`** to `drillTo`, with
`data-portlet`, `data-testid="portlet-<id>"`, an `aria-label` drill sentence, and an
`ArrowUpRight` that fades in on hover. Classes: `glass-surface shadow-depth-2 vdl-lift`,
`rounded-xl`, padding `p-3` (compact) / `p-4` (comfortable). Title is an uppercase
tracking-wide `--text-label` in `text-foreground-tertiary`.

### 4.3 Are there charts?
Yes, but only two drawings, both hand-rolled SVG:

1. **`TrendChart`** — `trend-chart.tsx`, a 640×200 viewBox, `h-44 w-full`, two `<polyline>`s
   (`--chart-1` solid, `--chart-2` dashed `"6 4"`), a gradient area fill, direct labels in a
   96px right pad, plus a mask-driven `stroke-dashoffset` reveal. Rendered **only** on the owner
   dashboard (`owner-dashboard.tsx:224-227`).
2. **`Sparkline`** — `portlet.tsx:200-216`, a 100×20 `<polyline>`, `h-5 w-full`, `aria-hidden`.
   Rendered **only** on `owner-net-sales` (`owner-dashboard.tsx:166`).

Plus **bars**: `RankedList` draws a 6px (`h-1.5`) rounded `bg-primary-700` bar whose width is
`fraction * 100%`, min 2% (`portlet.tsx:279-288`). Used by `owner-top-items` and
`manager-station-load`; deliberately **not** by `manager-86d`, which passes no `fraction`
(`manager-dashboard.tsx:114-125` — the comment records the defect where every 86'd row drew a
full-width bar encoding nothing).

**No charting library is installed.**
`grep -nE "recharts|chart\.js|d3|victory|visx|nivo|apexcharts|echarts" frontend/package.json`
→ no match. `trend-chart.tsx:53-61` records the decision: Recharts is permitted by UI-SPEC §7.3
on dashboard routes only, but is not a dependency, because its tree drags in
`@reduxjs/toolkit`/`react-redux`/`immer`/`victory-vendor`.

`grep -rln "<svg" frontend/components --include="*.tsx" | xargs grep -ln "polyline\|<path d=\|<rect"`
returns exactly two files: `portlet.tsx` and `trend-chart.tsx`. **There are no other charts
anywhere in the frontend.** No pie/donut, no stacked bar, no heatmap, no hour-of-day histogram.

Chart colour tokens exist and are OKLCH: `--chart-1..5` at `frontend/app/globals.css:397-401`
(light) and `:685-689` (dark), bridged into `@theme` as `--color-chart-N` at `globals.css:37-41`.

### 4.4 Density is real, not cosmetic
`comfortable` vs `compact` drives three things and nothing else: shell gap
(`dashboard-shell.tsx:31`), row gap (`:77`), portlet padding + inner gap (`portlet.tsx:71`).

### 4.5 The realtime dashboard renders in a different visual language
`DashboardTileGrid.tsx:34` — `rounded-lg border border-border p-6`, plain `text-3xl`, no glass,
no depth, no drill link, `sm:grid-cols-2 lg:grid-cols-3` (three across, not four), and a live
"updated Ns ago" counter re-rendered on a 5s interval (`:26-31`). `app/.../realtime/page.tsx:36`
uses a raw `text-xl font-semibold` heading rather than the type scale, and its connection dot
uses literal Tailwind palette colours `bg-emerald-500` / `bg-amber-500` (`:15`) instead of
semantic tokens. Same for `/app/nlq` (`nlq/page.tsx:17` `text-xl`, `:18` `text-sm text-muted-foreground`).

### 4.6 Reports & platform surfaces
- `/app/reports` — a text list grouped by category, `<ul className="divide-y rounded-lg border">`,
  each row a `<Link>` showing title + "N columns" (`reports/page.tsx:60-74`). No charts, no
  previews, no thumbnails.
- `/app/reports/[code]` — two `<input type="date">`s and `ReportTable`, a plain `<table w-full text-sm>`
  (`ReportTable.tsx:88-111`). `null` cells render `—` with an aria label, never `0`
  (`ReportTable.tsx:26-34`). A `dataNotes` banner appears above the table when the report declares
  gaps (`:81-87`).
- `/app/reports/fbr` — `FbrTaxSummaryCard`, a bordered card with a 2-column figure grid; a negative
  net payable is relabelled "Refundable input-tax credit" rather than shown as a minus
  (`FbrTaxSummaryCard.tsx:33,77`).
- `/platform/dashboard` — 4 `StatTile`s (`glass-surface vdl-lift rounded-xl p-4 shadow-depth-2`,
  `platform/dashboard/page.tsx:151`) counting Tenants / Active / Suspended / Provisioning-failed,
  plus a 4-cell "By tier" grid. **Every number is counted client-side from the tenant list already
  fetched** (`:29-32`), documented at `:13-19` as a deliberate refusal to invent a revenue tile.
- `platform-shell.tsx` — a permanent 4px `bg-warning` rule (`:49-53`) and a "PLATFORM" chip (`:73-78`).
- `usage-panel.tsx:16-38` — most meters render "Not metered" on purpose: `usage_records` was
  measured at 0 rows, 0 producers, 0 `nlq_quota:*` Redis keys. Only *branches* has a real count.

---

## 5. The real ROLE CATALOGUE

The authoritative RBAC seed is **Liquibase, not Flyway, and lives only in auth-service**.
`find services/auth-service -name "*.sql" -not -path "*/target/*"` → **no output**;
`grep -rln "INSERT INTO roles" --include="*.sql" .` → **no output**.
The catalogue is XML changelogs under
`services/auth-service/src/main/resources/db/changelog/v1.0.0/` (51 files).

Tables: `permissions` (global, non-RLS), `roles` (system rows have `tenant_id IS NULL`; tenant rows
under RLS), `role_permissions` (non-RLS junction) — `030-create-roles-permissions.xml:9-66`.

### 5.1 The nine system roles

| Role code | Display name | Created in |
|---|---|---|
| `OWNER` | Owner | `030-…xml:120` |
| `TENANT_ADMIN` | Tenant Admin | `030-…xml:121` |
| `MANAGER` | Manager | `030-…xml:122` |
| `ACCOUNTANT` | Accountant | `030-…xml:123` |
| `INVENTORY_MANAGER` | Inventory Manager | `030-…xml:124` |
| `CASHIER` | Cashier | `030-…xml:125` |
| `FINANCE_VIEWER` | Finance Viewer (dev-only, per its own comment) | `030-…xml:127` |
| `KITCHEN_STAFF` | Kitchen Staff | `042-kds-permissions-kitchen-role.xml:23-27` |
| `WAITER` | Waiter | `055-waiter-role-and-tenant-admin-authority.xml:90-95` |

**There is no `BRANCH_MANAGER` and no `SUPER_ADMIN` row in `roles`.** The SuperAdmin is a
platform-plane principal, not a tenant role (see `components/platform/platform-guard.tsx`,
`lib/hooks/use-platform-session.ts:16`). `resolveDashboardPreset` nonetheless matches the strings
`SUPER_ADMIN`, `BRANCH_MANAGER` and `KITCHEN` (`presets.ts:305-308`) — aliases for role codes that
the seed never mints.

The frontend **never hardcodes the role list** — `lib/api-client/schemas/user.schema.ts:128-129`
records that assignable roles are fetched from the server and filtered by the caller's ceiling.

### 5.2 The permission catalogue — 79 live codes

80 codes are ever inserted; `pos.order.void` is retired by
`054-retire-orphan-pos-order-void.xml:39` (`DELETE FROM permissions WHERE code = 'pos.order.void'`),
leaving **79 live**. By module:

| Module | Count | Codes |
|---|---|---|
| pos | 28 | `pos.kds.update, pos.kds.view, pos.menu.manage, pos.menu.view, pos.order.close, pos.order.create, pos.order.discount.line, pos.order.discount.order, pos.order.discount.override, pos.order.refund, pos.order.send_to_kds, pos.order.split_bill, pos.order.update, pos.order.view, pos.order.view.all, pos.order.void.any, pos.order.void.own, pos.printers.admin, pos.service_charge.manage, pos.tables.admin, pos.tables.manage, pos.tax.manage, pos.terminals.admin, pos.till.close, pos.till.open, pos.till.open.other, pos.till.reconcile.override, pos.till.review` |
| hr | 11 | `hr.attendance.manage, hr.attendance.view, hr.config.manage, hr.config.view, hr.employee.manage, hr.employee.view, hr.leave.approve, hr.leave.view, hr.payroll.approve, hr.payroll.run, hr.payroll.view` |
| finance | 10 | `finance.ar.manage, finance.ar.view, finance.coa.manage, finance.coa.view, finance.expense.approve, finance.journal.post, finance.journal.reverse, finance.journal.view, finance.period.close, finance.period.open` |
| vendor | 10 | `vendor.grn.receive, vendor.invoice.book, vendor.invoice.override, vendor.manage, vendor.payment.create, vendor.po.approve, vendor.po.close, vendor.po.create, vendor.po.send, vendor.view` |
| crm | 4 | `crm.customer.manage, crm.customer.view, crm.promotion.manage, crm.promotion.view` |
| file | 3 | `file.manage, file.upload, file.view` |
| rbac | 3 | `rbac.manage, rbac.role.manage, rbac.user.manage` |
| reporting | 3 | `reporting.dashboard.view, reporting.report.fbr, reporting.report.view` |
| inventory | 2 | `inventory.item.manage, inventory.item.view` |
| nlq | 2 | `nlq.query.run, nlq.settings.manage` |
| audit | 1 | `audit.log.view` |
| branch | 1 | `branch.manage` |
| ops | 1 | `ops.health.view` |

**Reporting is three permissions wide.** There is no per-report permission, no
`reporting.export`, no `analytics.*` namespace.

### 5.3 Grants per role

**OWNER — all 79.** `057-repair-administration-role-grant-drift.xml`:
`INSERT INTO role_permissions SELECT 'OWNER', code FROM permissions ON CONFLICT … DO NOTHING`.
(The same idempotent top-up appears in 030/044/045/046.)

**TENANT_ADMIN — all except `rbac.manage` (78).** Same changesets, `WHERE code != 'rbac.manage'`.
`030-…xml` and `user.schema.ts:128` both record why: a tenant admin must not be able to mint an OWNER.

**MANAGER — 57 explicit grants** (after 054 removes `pos.order.void`, 56 live):
`crm.customer.manage, crm.customer.view, crm.promotion.manage, crm.promotion.view, file.manage,
file.upload, file.view, finance.ar.view, finance.expense.approve, hr.attendance.manage,
hr.attendance.view, hr.employee.view, hr.leave.approve, hr.leave.view, hr.payroll.view,
inventory.item.manage, inventory.item.view, nlq.query.run, pos.kds.view, pos.menu.manage,
pos.menu.view, pos.order.close, pos.order.create, pos.order.discount.line,
pos.order.discount.order, pos.order.discount.override, pos.order.refund, pos.order.send_to_kds,
pos.order.split_bill, pos.order.update, pos.order.view, pos.order.view.all, pos.order.void.any,
pos.order.void.own, pos.printers.admin, pos.tables.admin, pos.tables.manage, pos.terminals.admin,
pos.till.close, pos.till.open, pos.till.open.other, pos.till.reconcile.override, pos.till.review,
reporting.dashboard.view, reporting.report.fbr, reporting.report.view, vendor.grn.receive,
vendor.invoice.book, vendor.invoice.override, vendor.manage, vendor.payment.create,
vendor.po.approve, vendor.po.close, vendor.po.create, vendor.po.send, vendor.view`
— **note MANAGER holds `reporting.report.view`.**

**ACCOUNTANT — 26:**
`crm.customer.view, crm.promotion.view, file.upload, file.view, finance.ar.manage, finance.ar.view,
finance.coa.manage, finance.coa.view, finance.expense.approve, finance.journal.post,
finance.journal.reverse, finance.journal.view, finance.period.close, finance.period.open,
hr.employee.view, hr.payroll.run, hr.payroll.view, nlq.query.run, pos.order.view,
reporting.dashboard.view, reporting.report.fbr, reporting.report.view, vendor.invoice.book,
vendor.invoice.override, vendor.payment.create, vendor.view`
(+ `hr.config.view`, back-granted by `046-hr-config-permissions.xml` to every role holding
`hr.employee.view`).

**CASHIER — 14:**
`crm.customer.manage, crm.customer.view, crm.promotion.view, pos.menu.view, pos.order.close,
pos.order.create, pos.order.discount.line, pos.order.send_to_kds, pos.order.update,
pos.order.view, pos.order.void.own, pos.tables.manage, pos.till.close, pos.till.open`

**WAITER — 7** (`055-…xml:96-104`):
`pos.order.create, pos.order.update, pos.order.view, pos.order.send_to_kds, pos.menu.view,
pos.tables.manage, pos.kds.view`

**INVENTORY_MANAGER — 7:**
`file.upload, file.view, inventory.item.manage, inventory.item.view, vendor.grn.receive,
vendor.po.create, vendor.view`

**FINANCE_VIEWER — 4:**
`finance.coa.view, finance.journal.post, finance.journal.view, hr.payroll.view`

**KITCHEN_STAFF — 2** (`042-…xml:30-37`): `pos.kds.view, pos.kds.update`

### 5.4 Preset × role: what each real role actually sees on `/app/dashboard`

Computed by applying `resolveDashboardPreset` (`presets.ts:301-322`) then `visiblePortlets`
(`presets.ts:327-332`) to each role's grant set above.

| Real role | Preset resolved | Portlets that survive the permission filter |
|---|---|---|
| OWNER | `owner` | all 7 |
| TENANT_ADMIN | `owner` | all 7 |
| MANAGER | `manager` | all 8 |
| **ACCOUNTANT** | **`owner`** (falls through role match, caught by `permissions.includes("reporting.report.view")` at `presets.ts:315`) | all 7 — an accountant gets a page titled "Is the business healthy?" |
| **INVENTORY_MANAGER** | **`cashier`** (final fallback, `presets.ts:321`) | **only `cashier-shortcuts`** — 0 KPI tiles |
| CASHIER | `cashier` | all 3 |
| **FINANCE_VIEWER** | **`cashier`** | **only `cashier-shortcuts`** — 0 KPI tiles |
| KITCHEN_STAFF | `kitchen` | all 3 |
| **WAITER** | `cashier` | 2 of 3 — `cashier-till` dropped (WAITER has no `pos.till.open`) |

Because the `Shortcuts` slot is not permission-gated in code (`focused-dashboard.tsx:114-118`),
an INVENTORY_MANAGER or FINANCE_VIEWER signing in today lands on a page reading
*"Where is my till, and what is still open?"* / *"This shift"* with **no numbers at all** and a
72px **Open POS** button — a POS neither role holds `pos.order.create` for.

---

## 6. Demo stats vs. what we can honestly compute

The demo (`Docs/NEXUS_ERP_Demo.html`, 1 562 lines) is a dark-themed, Chart.js-driven ERP with
11 screens (`showScreen` ids at `:1355-1365`): dashboard, pos, inventory, orders, finance, hr,
vendors, crm, analytics, reports, admin.

**24 KPI cards** (regex over `kpi-label`/`kpi-value` pairs) and **9 Chart.js canvases**
(`revenueChart` bar, `categoryChart` doughnut, `forecastChart` line, `wasteChart` bar,
`labourChart` line, `vendorChart` bar, `loyaltyChart` doughnut, `revCOGSChart` line,
`hourlyChart` bar) loaded from `cdnjs …/Chart.js/4.4.1` (`:8`).

### 6.1 Demo stats that HAVE a backing endpoint today

| Demo stat | Backed by | Endpoint / source |
|---|---|---|
| Today's Revenue `$4,218` | ✅ | `todays-revenue` tile, `DashboardTileService.java:158` |
| Orders Today `127` | ✅ | `todays-orders` tile, `:159` |
| Avg. Order Value `$33.2` | ✅ | `average-order-value` tile, `:161` (null-guarded) |
| Revenue This Week (bar) | ✅ | `sales-by-day` report, `ReportCatalog.java:57-71` |
| Top Menu Items Today | ✅ | `sales-by-item`, `ReportCatalog.java:81-99` (already rendered as `owner-top-items`) |
| Revenue by Hour (Today) | ✅ | `sales-by-hour`, `ReportCatalog.java:101-114` — **report exists, no UI chart draws it** |
| Sales by Category (doughnut) | ⚠️ partial | `sales-by-order-type` exists (`:116-128`) but groups by ORDER TYPE, not menu category. No category-grouped fact. |
| Tables Occupied `8 / 14` | ✅ | `useTables()` — already live as `manager-tables-occupied` |
| Active Orders / Completed | ✅ | `useOrderSummaries()` |
| Voids / Refunds `3` | ✅ | `useOrderSummaries(["VOIDED","REFUNDED"])` — live as `owner-exceptions` |
| Stock Value `$12,840` | ✅ | `StockLevelService.java:95` `totalStockValuePaisa` (`GET /api/v1/inventory/stock`) |
| Low / Critical `5` | ✅ | `/reorder-shortfalls` (`InternalReorderController`) + `/api/v1/inventory/stock` |
| Total Ingredients `138` | ✅ | ingredients controller |
| Waste This Week `$184` / Wastage chart | ✅ | `WastageController` + `WastageService` (inventory-service) |
| Labour Cost % `18.2%` / Labour Cost Trend | ✅ | `GET /api/v1/hr/labour-cost` (`LabourCostController.java:18`); revenue is pulled server-side via `PosRevenueClient` and reports *unavailable* rather than fabricating (`PosRevenueClient.java:13-17`) |
| Total Staff / On Shift Now | ✅ | hr-service `/current`, `/week`, attendance endpoints |
| Monthly Payroll `$22,400` | ✅ | hr-service payroll run `/{id}` + `/{id}/payslips` |
| AP Aging | ✅ | finance-service `GET …/aging` |
| Vendor Spend / Monthly Spend by Vendor | ✅ | purchasing-service `GET …/spend`, `GET …/scorecard` |
| Open Purchase Orders | ✅ | purchasing-service PO endpoints |
| Vendor Directory | ✅ | purchasing-service vendors |
| Recent Transactions | ✅ | finance-service `/{accountCode}/entries`, transaction register |
| AI — Natural Language Query | ✅ | `POST /api/v1/nlq/query` — already shipped at `/app/nlq` |
| Audit Log | ✅ | audit-service `AuditQueryController`, `audit.log.view` |
| User / Branch Management | ✅ | user-service `UserAdminController`, `BranchController` |
| Role Permission Matrix | ✅ | auth-service `RoleCatalogController` (+ `/app/roles`) |

### 6.2 Demo stats we CANNOT honestly compute today — the list

Each line names the demo figure, the reason, and the command that proves the absence.

1. **Food Cost % `28.4%`** (dashboard KPI *and* the analytics "Key Performance Ratios" row).
   No aggregate food-cost figure exists. `grep -rn "foodCost" services/*/src/main/java` returns
   only `RecipeDtos.java:69,76` and `RecipeCostPreviewService.java:158-167` — a **per-recipe
   preview**, null whenever the menu item has no price. There is no branch-level or period-level
   food cost, because COGS is not posted per sale (see #2).

2. **COGS (MTD) `$19,432`** and every margin derived from it — including **Net Income (MTD)
   `$26,808`**, **Net Margin `39.2%`**, and the whole **"Revenue vs COGS — Daily"** line chart.
   `sales_item_facts.cogs_paisa` and `.gross_margin_paisa` are Phase-8-deferred NULLs.
   `ReportCatalog.java:74-80` explains the `countIf(... IS NOT NULL) = 0 → NULL` guard that forces
   an honest NULL. The app already refuses this number: `owner-dashboard.tsx:175` hardcodes
   `value="—"` for Gross margin with the reason at `:179`.

3. **Menu Margin Ranking** (analytics table: Beef Burger 21% cost / $15.00 margin, etc.) and the
   NLQ demo answer *"Beef Burger — 79% gross margin"*. Same root cause as #2. This is the single
   most dangerous demo panel to reproduce: it is a *ranking* built entirely on a column that is
   null for every row.

4. **P&L Summary — April 2025** (Revenue / COGS / Operating Expenses / Net Income).
   `grep -rli "profit" services/*/src/main/java` → **0 files**;
   `grep -rli "income-statement\|trial-balance\|cash-flow" services/*/src/main/java` → **0 files**.
   finance-service has journal entries, a chart of accounts, periods, AR/AP aging and settlements —
   but **no statement-assembly endpoint of any kind**.

5. **Balance Sheet** (listed "Ready" on the demo Reports screen).
   `grep -rli "balance-sheet" services/*/src/main/java` → exactly one hit,
   `inventory-service/.../GlAccountUsage.java`, which is an account-classification enum, not a
   statement. **Absent.**

6. **Cash Flow Statement** (demo: "Scheduled · Daily auto-send to your email").
   `grep -rli "cash-flow" services/*/src/main/java` → **0 files**. Also: there is no report
   scheduling or email-delivery mechanism anywhere — `grep` for scheduled report delivery finds
   nothing in reporting-service (its only `@Scheduled` is `flushDueTiles`,
   `DashboardTileService.java:105`).

7. **Operating Expenses `$22,180`.** finance-service has `finance.expense.approve` and an expenses
   route, but no period-aggregated opex figure and no expense-category rollup endpoint.

8. **Avg. Prep Time `14 min`.** `grep -rn "prep\|duration\|elapsed" services/kitchen-service/src/main/java | grep -i "avg\|average\|mean"`
   → **no output**. The KDS knows a ticket's `receivedAt` and its status, and the frontend computes
   *current age* client-side (`getAgingState`, `formatAge`), but nothing anywhere computes a
   completed-ticket average. **Absent.**

9. **Avg. Table Turn Time `48 min`** (analytics KPI ratio). Same class: no turn-time aggregate.
   Tables carry a status (`OCCUPIED`/free) but no dwell measurement.

10. **NPS Score `72`.** `grep -rli "nps" services/*/src/main/java` → **0 files**.
    crm-service `FeedbackController` accepts and lists a raw integer `rating`
    (`CrmDtos.java:100,108`) with **no aggregate endpoint** — `GET /api/v1/crm/feedback` returns a
    `Page<FeedbackResponse>`, nothing more. NPS is not defined, not computed, not stored.

11. **Churn risk** (demo "Customer Loyalty Report — Tier breakdown, NPS, churn risk").
    `grep -rli "churn" services/*/src/main/java` returns 5 files, **none in crm-service** — the hits
    are inventory event payloads, nlq AI-key state and platform feature flags, all unrelated senses
    of the word. **Absent.**

12. **Total Members `1,842` / Gold Members `184` / Points Redeemed `8,420` / Loyalty Tier
    Distribution (doughnut).** Per-customer tier and points DO exist
    (`LoyaltyAccountEntity.java:34`, `LoyaltyTierConfigEntity`, `LoyaltyService`), but
    `CustomerController` exposes only `/search`, `/{id}`, `/{id}/detail`, `/customers/ids`,
    `/customers/lookup` — **no aggregate/count-by-tier and no points-redeemed total.**
    Computing these would mean paging the entire customer table in the browser.

13. **AI Forecast — Next 7 Days** (`forecastChart`).
    `grep -rli "forecast" services/*/src/main/java` → **0 files**. There is no forecasting model,
    no time-series projection, nothing. The NLQ service answers questions over existing data; it
    does not predict.

14. **"Revenue target 84% reached at 6pm"** (Alerts panel). There is no revenue-target or budget
    entity anywhere — the demo's "Budget: 30%" / "Budget: 20%" / "Target: 35%" / "Target: 45 min"
    annotations in Key Performance Ratios have no configuration surface and no storage.

15. **"50+ pre-built reports"** (demo Reports header). The real catalogue is **7**
    (`ReportCatalog.java:35-42`): `sales-by-day`, `sales-by-item`, `sales-by-hour`,
    `sales-by-order-type`, `discount-summary`, `till-sessions`, `purchases-by-po`.
    `ReportCatalog.java:11-13` is explicit that this is deliberate: *"Deliberately NOT the spec's
    '40 named reports' — a report backed by no data is a lie."*

16. **Vendor Spend Analysis "by vendor"**. `purchases-by-po` groups by `purchase_order_id`, not
    vendor, because `purchase_tax_facts` carries **no `vendor_id` column** —
    `ReportCatalog.java:15-22` documents the gap and the rename. purchasing-service's own
    `GET …/spend` and `/scorecard` can serve a per-vendor view, but the *analytics/ClickHouse*
    path cannot.

17. **Demo's role names.** The demo's Role Permission Matrix columns are
    *Super Admin · Branch Mgr · Accountant · Cashier · Kitchen* and its user table shows
    *"Super Admin / All Branches"*. Two of those five are not tenant roles in this system:
    `SUPER_ADMIN` is a platform-plane principal (no `roles` row) and `BRANCH_MANAGER` does not
    exist — the code is `MANAGER`. The demo also omits `TENANT_ADMIN`, `WAITER`,
    `INVENTORY_MANAGER` and `FINANCE_VIEWER`, which are four of the nine real roles.
    Its matrix row "Finance — View P&L: Summary" cannot be honoured at all (see #4).

---

## 7. Summary of gaps, ranked by risk

1. **Every margin/COGS/profit figure in the demo is uncomputable** (#2, #3, #4, #5). This is not a
   UI gap — the fact table column is null by design, and the app currently *refuses* to render it.
   Any redesign that puts a margin number, a P&L card or a margin ranking on screen re-introduces
   the exact failure class the codebase has already written three separate guards against
   (`ReportCatalog.java:74-80`, `ReportTable.tsx:22-34`, `owner-dashboard.tsx:52-65`).
2. **`Shortcuts` is the only unimplemented portlet type**, and its two slots are currently filled by
   an ungated hardcoded button.
3. **`PortletSpec.type` / `.drillTo` / `.row` are inert.** The preset table cannot change the layout.
4. **Two roles land on an empty dashboard** (INVENTORY_MANAGER, FINANCE_VIEWER), and ACCOUNTANT
   lands on a page titled for an owner.
5. **Two visual languages already coexist** — glass/depth/type-scale on `/app/dashboard`, plain
   bordered cards and raw `text-xl`/`text-3xl` on `/app/dashboard/realtime`, `/app/nlq` and the
   reporting components.
6. **No charting library, two hand-rolled SVGs, one chart on one screen.** `sales-by-hour` and
   `sales-by-order-type` are computed server-side and never visualised anywhere.

---

*Audit produced read-only on 2026-08-21. No source file under `frontend/`, `services/` or
`gateway/` was modified; no build or dev server was run; `git stash` was not used.*
