# Frontend Stack Decision — Professional ERP UI Revamp

**Scope:** `frontend/` (Next.js App Router).
**Date of research:** 2026-08-07.
**Verdict in one line:** **Keep the stack you already have. Do not adopt a component library.** The revamp is an *additive* build-out on shadcn/ui + Radix + TanStack Table v8, plus exactly three new dependencies (`@tanstack/react-virtual`, `recharts`, and optionally `@hookform/resolvers`). Every alternative below is a net rewrite with no compensating benefit.

---

## Part 1 — What is actually in the repo (verified)

### 1.1 Exact installed versions

Read from `frontend/package.json` and confirmed against the resolved tree in `frontend/node_modules/*/package.json`:

| Package | `package.json` range | Resolved installed |
|---|---|---|
| `next` | `16.2.9` (pinned) | **16.2.9** |
| `react` / `react-dom` | `19.2.4` (pinned) | **19.2.4** |
| `tailwindcss` | `^4` (dev) | **4.3.1** |
| `@tailwindcss/postcss` | `^4` (dev) | — |
| `@tanstack/react-query` | `^5.101.1` | **5.101.1** |
| `@tanstack/react-table` | `^8.21.3` | **8.21.3** |
| `react-hook-form` | `^7.80.0` | **7.80.0** |
| `zod` | `^4.4.3` | **4.4.3** |
| `radix-ui` (unified pkg) | `^1.6.0` | **1.6.0** |
| `framer-motion` | `^12.41.0` | **12.41.0** |
| `lucide-react` | `^1.21.0` | **1.21.0** |
| `cmdk` | `^1.1.1` | — |
| `sonner` | `^2.0.7` | — |
| `zustand` | `^5.0.14` | — |
| `next-intl` | `^4.13.0` | — |
| `tailwind-merge` / `class-variance-authority` / `clsx` | `^3.6.0` / `^0.7.1` / `^2.1.1` | — |
| `tw-animate-css` | `^1.4.0` | — |

Note the pinning discipline: `next`, `react`, `react-dom` are exact (no caret). React 19.2.4 + Next 16 is the constraint every candidate below must satisfy.

Source: `/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/package.json`.

### 1.2 The enforced 4-layer architecture

Directory evidence under `/Users/muhammadumer/Documents/Projects/ResturantOS/frontend/lib/`:

```
Layer 1  lib/api-client/     client.ts, request.ts, errors.ts, types.ts
         lib/api-client/schemas/   {auth,branch,crm,finance,hr,inventory,
                                    kds,nlq,pos,purchasing,reporting}.schema.ts
Layer 2  lib/repositories/   12 × *.repository.ts
Layer 3  lib/adapters/       11 × *.adapter.ts + shared.ts
         lib/models/         10 × *.model.ts      (domain types)
         lib/hooks/          38 × *.ts across auth/crm/finance/hr/inventory/
                                  kds/nlq/pos/purchasing/reporting + query-keys.ts
Layer 4  components/**, app/**
```

Verified flow, e.g. `lib/hooks/reporting/use-dashboard-socket.ts` imports
`apiDashboardTileSchema` from `@/lib/api-client/schemas/reporting.schema`,
`adaptDashboardTile` from `@/lib/adapters/reporting.adapter`, and returns
`DashboardTile` from `@/lib/models/reporting.model` — schema → adapter → model,
written into the TanStack Query cache. Hooks import repositories directly
(confirmed in `lib/hooks/{kds,reporting,auth,purchasing}/…`).

**Zod is the schema layer.** `zod@4.4.3` is a production dependency and is what
`lib/api-client/schemas/*.schema.ts` is built from. There is no second validation library.

### 1.3 The ESLint boundary rule — and its gap

`frontend/eslint.config.mjs` lines 14–37:

```js
files: ["components/**/*.{ts,tsx}"],
rules: { "no-restricted-imports": ["error", {
  paths:    [{ name: "axios", … }],
  patterns: [{ group: ["@/lib/api-client", "@/lib/api-client/*", "@/lib/api-client/**",
                       "@/lib/repositories", "@/lib/repositories/*", "@/lib/repositories/**"], … }],
}]}
```

Two things follow, and both matter for the revamp:

1. **The rule is scoped to `components/**` only.** `app/**` is *not* covered. That is
   not theoretical — two page files import Layer-1 directly and lint stays green:
   - `app/(tenant)/app/purchasing/invoices/page.tsx:8` →
     `import { INVOICE_STATUSES, type InvoiceStatus } from "@/lib/api-client/schemas/purchasing.schema"`
   - `app/(tenant)/app/purchasing/purchase-orders/page.tsx:8` →
     `import { PO_STATUSES, type PoStatus } from "@/lib/api-client/schemas/purchasing.schema"`

   These are const-enum + type imports, not API calls, so runtime is fine — but the
   guard rail the architecture depends on does not currently reach the layer that holds
   every page. **Hardening this is a prerequisite for the revamp**, not a side quest,
   because an ERP revamp moves a lot of code into `app/**`.

2. `components/finance/ProvisionPeriodDialog.tsx` matches a grep for `api-client` only
   inside a *comment* (line 27) referencing `docs/finance-eslint-backlog.md`. Not a
   violation. That backlog file is itself marked **RESOLVED 2026-08-06** — the two real
   violations were fixed by moving `formatUserFacingError`/`ApiError` into a
   transport-agnostic `@/lib/errors` barrel that any layer may import. That is the
   established escape hatch pattern, and the revamp should reuse it rather than invent
   a new one.

### 1.4 Tailwind v4 CSS-first token setup

`frontend/app/globals.css` (237 lines). There is **no `tailwind.config.js`/`.ts`** —
`components.json` has `"tailwind": { "config": "" }`, i.e. pure CSS-first.

- `@import "tailwindcss";` + `@import "tw-animate-css";`
- `@custom-variant dark (&:is(.dark *));` — class-based dark mode
- A `@theme inline { … }` block mapping every token: `--color-background`, `--color-primary`,
  `--color-destructive`, plus project-specific `--color-success`, `--color-warning`,
  `--color-info`, the full `--color-sidebar-*` set, a `--radius-sm…--radius-4xl` scale
  derived from one `--radius: 0.625rem`, and six `--animate-*` tokens.
- `:root` / `.dark` define the raw values in **OKLCH** (`oklch(0.577 0.245 27.325)` etc.),
  with `color-scheme: light|dark` set so native controls follow the theme.
- **`--chart-1` … `--chart-5` already exist** and are already exposed as
  `--color-chart-1…5` in `@theme inline`. In light *and* dark they are currently
  **greyscale** — every one has chroma `0` (`oklch(0.87 0 0)`, `oklch(0.556 0 0)`,
  `oklch(0.439 0 0)`, `oklch(0.371 0 0)`, `oklch(0.269 0 0)`). The slots are wired;
  the hues were never chosen.
- `@layer base` sets a global `:focus-visible { ring-2 ring-ring ring-offset-2 }` and a
  `.touch-target { min-height: 44px; min-width: 44px }` utility — the POS a11y groundwork exists.
- A `@media (prefers-reduced-motion: reduce)` block neutralises all animation.

`components.json`: `"$schema": "https://ui.shadcn.com/schema.json"`, `"style": "radix-nova"`,
`"rsc": true`, `"cssVariables": true`, `"baseColor": "neutral"`, `"iconLibrary": "lucide"`.
**This project is already a shadcn/ui project.**

### 1.5 What components exist

- `components/ui/` — 20 files: `alert, animated-number, button, card, command-palette,
  data-table, dialog, dropdown-menu, empty-state, form, input, label, money-display,
  popover, skeleton, sonner, status-announcer, status-badge, theme-toggle, tooltip`.
- Radix is consumed through the **unified `radix-ui` package**, not `@radix-ui/react-*`.
  Grep of `components/**` shows exactly six primitives in use:
  `Dialog`, `DropdownMenu`, `Label`, `Popover`, `Tooltip`, `Slot`.
- **204 `.tsx` files** across `components/` + `app/`.
- Feature folders: `pos` (18 files), `kds`, `finance`, `hr`, `inventory`, `purchasing`,
  `crm`, `menu`, `reporting`, `nlq`, `settings`, `dashboard`, `shared`, `skeletons`, `providers`.

### 1.6 The three real gaps

**(a) Tables are 87% hand-rolled.** `components/ui/data-table.tsx` wraps TanStack Table
v8 but wires only three row models — `getCoreRowModel`, `getSortedRowModel`,
`getPaginationRowModel`. No filtering, no faceting, no grouping, no column
visibility/pinning/resizing, no virtualization; pagination is client-side over a fully
materialised array. Only **4 files consume it**:
`app/(tenant)/app/purchasing/vendors/[id]/page.tsx`,
`app/(tenant)/app/inventory/ingredients/page.tsx`,
`app/(tenant)/app/inventory/stock/page.tsx`,
`components/pos/order-management.tsx`.
Meanwhile **31 files contain a raw `<table>`** — including
`components/finance/{AccountTable,ApAgingTable,ArAgingTable,GeneralLedger,JournalEntryTable}.tsx`,
`components/purchasing/{SpendAnalyticsTable,ThreeWayMatchTable}.tsx`,
`components/reporting/ReportTable.tsx`, and 15 `app/**/page.tsx` files across finance,
hr, inventory and purchasing. That is the single largest source of ERP-grade
inconsistency in the app.

**(b) There is no charting library at all.** A grep for `recharts|visx|echarts` across
the repo (excluding `node_modules`, `.next`, `coverage`, the lockfile) returns **zero
hits**. `components/reporting/DashboardTileGrid.tsx` and
`components/dashboard/tenant-dashboard.tsx` render numeric tiles only. This is a
greenfield decision — nothing to migrate, nothing to break.

**(c) There is no virtualization anywhere.** Grep for `virtual|react-window|windowing`
across `components/`, `lib/`, `app/` returns nothing. `components/pos/menu-grid.tsx`
(237 lines) and the KDS boards render full lists.

### 1.7 Forms — already solved, deliberately

`react-hook-form@7.80.0` + `zod@4.4.3`, joined by a **hand-rolled resolver** at
`frontend/lib/forms/zod-resolver.ts`. `@hookform/resolvers` is **not installed**, and the
file says why in a comment (lines 32–34):

> "We hand-roll this instead of pulling in `@hookform/resolvers` because
> `frontend/package.json` is owned by plan 04-03 (parallel-safety)"

It is not a stub. It walks each Zod issue's **full** path (`["lines", 0, "vendorItemId"]`),
building arrays vs objects based on whether the next segment is numeric, so nested
array-field errors resolve against react-hook-form's own `getFieldState("lines.0.vendorItemId")`
lookup. `components/ui/form.tsx` is the standard shadcn `Form`/`FormField`/`FormControl`
stack on `Slot.Root`, wired for a11y (`aria-describedby`, `aria-invalid`,
`data-error`, `id` threading).

---

## Part 2 — Recommendations

### 2.1 Component library → **stay on shadcn/ui + Radix. Do not migrate.**

**Recommendation: shadcn/ui (CLI `shadcn@4.16.2`, MIT) on `radix-ui@1.6.0`.** Add
components; change nothing structural.

The decisive fact is that this is not a greenfield choice — **the project is already a
shadcn project** (`components.json` with `ui.shadcn.com/schema.json`), already on the
CSS-variable + `@theme inline` + OKLCH setup that shadcn's own Tailwind v4 guide
prescribes, and already on the unified `radix-ui` package. shadcn's Tailwind v4 docs
confirm the alignment point by point: `@theme inline` support, `data-slot` attributes on
every primitive, `React.forwardRef` removed in favour of `React.ComponentProps`, HSL
converted to OKLCH, and chart tokens referenced as `var(--chart-1)` rather than
`hsl(var(--chart-1))`. `frontend/components/ui/form.tsx` already follows exactly this
shape (`data-slot="form-item"`, plain function components, no `forwardRef`).

| Option | Version | Tailwind v4 fit | Data table | Existing code that survives |
|---|---|---|---|---|
| **shadcn/ui + Radix** ✅ | CLI `4.16.2`; `radix-ui@1.6.0` | Native — it *is* the v4 reference setup | Headless; you own the markup | **~100%** |
| Mantine | `@mantine/core@9.5.1` (2026-08-02) | **Conflicts.** Needs `@layer theme, base, mantine, components, utilities` ordering + `@mantine/core/styles.layer.css`, or Tailwind preflight wins | `<Table>` is presentational; DataTable is 3rd-party | ~0% of `components/ui/` |
| Ant Design | `antd@6.5.3` (2026-07-31) | Own CSS-in-JS design-token system; two competing token systems in one app | Strong built-in `<Table>` | ~0%; also fights the OKLCH tokens |
| Radix primitives raw | `radix-ui@1.6.0` | Fine | None | ~100% — but this *is* the current state minus shadcn's styled layer |

Mantine's Tailwind v4 problem is real and documented: in v3 Tailwind classes composed
onto Mantine components fine; in v4 the cascade-layer ordering changed and Mantine's own
styles win unless you explicitly declare the layer order. The community workarounds
(`styles.layer.css`, `tailwind-preset-mantine`) work, but you would be adopting a
permanent cascade-ordering tax to replace 20 components you already own the source of.

Ant Design is worse for this codebase specifically: its token system would sit alongside
the 60+ OKLCH custom properties in `globals.css` with no shared source of truth, and
`baseColor: neutral` / `--radius` / the `--color-sidebar-*` set would have to be mirrored
into a second config. AntD's `<Table>` is genuinely good — but that single win does not
justify discarding the design-token layer.

Raw Radix is not a distinct option; it is what you have *underneath* shadcn. Dropping
shadcn's styled layer means re-authoring 20 components for no gain.

**Concrete action:** run `shadcn add` for the ERP primitives that are missing —
`table`, `select`, `tabs`, `sheet`, `checkbox`, `radio-group`, `separator`, `badge`,
`scroll-area`, `calendar`, `pagination`, `toggle-group`, `breadcrumb`, `sidebar`,
`alert-dialog`, `hover-card`, `progress`. Each lands as a file in `components/ui/`, uses
the tokens already defined, and touches no layer boundary.

> **Caveat, verified:** the `radix-nova` style is a real shadcn style (the `style` field
> uses a `{library}-{style}` format; `radix-nova` sits alongside `radix-vega`,
> `radix-maia`, `radix-lyra`, `radix-mira`, and Nova is the compact/reduced-padding
> variant — a good fit for dense ERP). But there is a reported CLI bug where
> `https://ui.shadcn.com/r/styles/radix-nova/app.json` 404s and `shadcn add` fails
> ([shadcn-ui/ui#10730](https://github.com/shadcn-ui/ui/issues/10730)), plus a
> `radix-nova` CommandItem selected-state styling bug
> ([shadcn-ui/ui#9228](https://github.com/shadcn-ui/ui/issues/9228)). **Smoke-test
> `shadcn add table` before planning the phase around the CLI.** If it 404s, add
> components by copying from the docs — the source is MIT and self-contained either way.
> I have not re-tested this against CLI 4.16.2 myself; that is a 5-minute verification
> to run first.

---

### 2.2 Data table → **TanStack Table, stay on v8.21.3. Do NOT take v9 yet.**

**Recommendation: `@tanstack/react-table@8.21.3` (already installed), extended in
place, paired with `@tanstack/react-virtual@3.14.9`.**

TanStack Table v8 already covers every dense-ERP requirement in the brief. Its own
feature list is "sorting, pagination, filtering, faceting, grouping, aggregation, row
expansion, row and cell selection, cell spanning, row and column pinning, column
ordering, visibility, resizing" — the current `data-table.tsx` simply doesn't import
those row models yet. Adding `getFilteredRowModel`, `getFacetedRowModel`,
`getGroupedRowModel`, `getExpandedRowModel` is *additive*: existing callers that pass
only `columns`/`data` see zero behaviour change, which is precisely the pattern the file
already documents for its `rowClassName` prop (lines 25–32).

**On v9: `@tanstack/react-table@9.0.0` is the npm `latest` tag, but it was published
2026-08-04 — three days before this research.** (v8.21.3 was published 2025-04-14.)
The `alpha` and `beta` dist-tags still point at `9.0.0-alpha.54` / `9.0.0-beta.80`, i.e.
a ~110-prerelease cycle just concluded. **I could not verify the v9 breaking-change
list** — `https://tanstack.com/table/latest/docs/guide/migrating-to-v9` returned 404 when
fetched, so I cannot tell you what happens to `useReactTable`, `getCoreRowModel`,
`ColumnDef` or `flexRender`, and I am not going to guess. Taking a 3-day-old major into
an ERP revamp that must "keep working throughout" is exactly the risk the constraint
forbids. Revisit at 9.1/9.2 once the migration guide exists.

**AG Grid is rejected on licensing, not capability.** `ag-grid-react@36.1.0` peers
cleanly with React 19 and the package is MIT — but that MIT covers *Community* only.
AG Grid's own pricing page puts **row grouping, pivoting, aggregation, master/detail and
integrated charts all behind the Enterprise licence at $999 USD per developer**
(perpetual, including 1 year of updates; $1,498 for the Grid+Charts bundle). Grouping and
aggregation are exactly the two features you named. So AG Grid means either paying
per-seat for capabilities TanStack gives you free under MIT, or getting a Community grid
that does *less* than what you already have installed. On top of that it would introduce
a second styling system (AG Grid themes) alongside the OKLCH token layer, and its cell
renderers do not compose with `components/ui/*`.

| | TanStack Table v8.21.3 | AG Grid 36.1.0 |
|---|---|---|
| Licence | MIT, all features | MIT Community; **grouping/pivot/aggregation = $999/dev** |
| Filtering | `getFilteredRowModel` + faceting | Community: basic; advanced = Enterprise |
| Grouping | `getGroupedRowModel` (free) | **Enterprise only** |
| Virtualisation | via `@tanstack/react-virtual` | built in |
| Styling | your markup, your tokens | AG Grid theme system |
| Already in repo | **yes** | no |
| Rewrite cost | 0 for the 4 call sites | all 4 + every future grid |

**Concrete action:** grow `components/ui/data-table.tsx` behind optional props
(`enableFiltering`, `enableGrouping`, `enableColumnVisibility`, `virtualize`,
`manualPagination`) so all 4 existing call sites keep compiling untouched, then convert
the 31 raw-`<table>` files module by module.

---

### 2.3 Charts → **Recharts 3.10.1**

**Recommendation: `recharts@3.10.1`** (published 2026-07-25; peer `react ^16.8 || ^17 || ^18 || ^19` — satisfied by React 19.2.4).

The reason is not that Recharts is the best charting library in the abstract — ECharts is
more capable. The reason is that **shadcn's chart component is Recharts**, and the
integration contract is already half-built in your `globals.css`. shadcn's chart docs
state plainly: "We use Recharts under the hood", "The `chart` component now uses Recharts
v3", and — critically — "**We do not wrap Recharts. This means you're not locked into an
abstraction.**" Its colour contract is `var(--chart-1)`…`var(--chart-5)` referenced
through a `ChartConfig` object, used directly (not `hsl(var(--chart-1))`) since the
Tailwind v4 / OKLCH migration.

Your `app/globals.css` already defines `--chart-1`…`--chart-5` in both `:root` and
`.dark` and already re-exports them as `--color-chart-1`…`5` in `@theme inline`. Adopting
Recharts costs one `shadcn add chart` plus **choosing five hues** — the current values are
all chroma-0 greys and would render a monochrome dashboard. That is the smallest possible
distance from "no charts" to "themed, dark-mode-correct, ERP dashboards".

| | Recharts 3.10.1 | visx 4.0.0 | ECharts 6.1.0 |
|---|---|---|---|
| Published | 2026-07-25 | 2026-06-11 | — |
| Licence | MIT | MIT | Apache-2.0 |
| React 19 peer | ✅ explicit | ✅ `^18 \|\| ^19` | n/a (needs `echarts-for-react@3.0.6`) |
| Token integration | **shadcn contract, `var(--chart-N)`** | manual | manual (JS theme object) |
| Effort per chart | low | **high** — you compose scales/axes yourself | medium |
| Dark mode | CSS vars, free | manual | needs a second theme registration |

**The honest cost of Recharts:** its dependency list is heavy for a chart library —
`@reduxjs/toolkit`, `react-redux`, `immer@^11`, `reselect`, `es-toolkit`,
`victory-vendor` (the d3 bundle), `eventemitter3`, `decimal.js-light`, `tiny-invariant`,
`use-sync-external-store`. That is a real bundle addition, and Redux inside a chart
library is a surprising design. Mitigate by importing charts only in dashboard route
segments (Next 16 code-splits per route) and never in the POS terminal path.

**visx** is rejected for effort, not quality: it is a primitives toolkit (scales, shapes,
axes) — excellent if you are building a bespoke visualization system, wrong when the goal
is standard ERP dashboards on a deadline.

**ECharts** is rejected for integration friction: it is the most capable of the three
(and genuinely better for very large series), but it is a canvas library with its own
imperative theme system, driven from React through the third-party
`echarts-for-react@3.0.6` wrapper. It cannot read your OKLCH custom properties without a
hand-written bridge, and dark-mode switching becomes a manual theme re-registration
rather than a free CSS-variable flip. Keep it in your back pocket for a specific
high-cardinality chart later; do not make it the dashboard default.

---

### 2.4 Forms → **keep react-hook-form + zod. Optionally swap the resolver.**

**Recommendation: `react-hook-form@7.80.0` + `zod@4.4.3` — no change required.**
Yes, zod is already the schemas layer (`lib/api-client/schemas/*.schema.ts`).

The only open question is `lib/forms/zod-resolver.ts` vs the official
`@hookform/resolvers@5.7.1`. The official package now declares zod as an *optional* peer
at `^3.25.0 || ^4.0.0`, so zod 4.4.3 is supported, and it routes through
`@standard-schema/utils@^0.3.0` (the Standard Schema spec) rather than zod-specific code.

The custom resolver's stated reason for existing was **package.json ownership during
parallel plan execution** — a process constraint, not a technical one. That constraint is
gone. But the custom resolver is 66 lines, correct on nested array paths, and covered by
the existing forms. **This is a low-priority, optional cleanup — not part of the revamp.**
If you do swap it, do it as an isolated commit with the form tests as the gate, so a
regression in nested-array error mapping (the subtle part) is attributable.

Keep `components/ui/form.tsx` exactly as is. It is already the current shadcn shape:
`data-slot` attributes, no `forwardRef`, `Slot.Root`, and correct
`aria-describedby`/`aria-invalid` threading.

---

### 2.5 Virtualisation → **`@tanstack/react-virtual@3.14.9`**

**Recommendation: `@tanstack/react-virtual@3.14.9`** (peer `react ^16.8 || ^17 || ^18 || ^19` — satisfied). Nothing is installed today; this is greenfield.

It is headless ("Headless UI for virtualizing scrollable elements in React"), from the
same maintainers as the Query and Table packages you already depend on, and it is the
canonical pairing with TanStack Table — a virtualized table is `useVirtualizer` over
`table.getRowModel().rows`, which is why the row-model design in `data-table.tsx` matters.
Because it is headless it renders none of its own markup, so it cannot conflict with
Tailwind v4 or the token layer.

Apply it to, in priority order:
1. `components/ui/data-table.tsx` behind a `virtualize` prop — unblocks server-side
   pagination replacement for the GL, stock and spend-analytics grids.
2. `components/pos/menu-grid.tsx` (237 lines, full-list render) — the POS speed path.
3. The KDS boards (`components/kds/station-board.tsx`, `kds-item-column.tsx`).

---

### 2.6 A11y / keyboard for POS speed → build on what exists, add a roving-tabindex layer

The groundwork is real and should be extended rather than replaced:

- `app/globals.css` `@layer base` gives every focusable element a visible ring
  (`:focus-visible { @apply ring-2 ring-ring ring-offset-2 ring-offset-background outline-none }`)
  and defines `.touch-target { min-height: 44px; min-width: 44px }` — the 44px AA target size.
- `components/ui/status-announcer.tsx` plus `aria-live` regions in
  `components/shared/branch-switch-overlay.tsx`, `components/pos/sync-status-badge.tsx`,
  `components/pos/offline-indicator.tsx`, `components/pos/table-select-combobox.tsx`.
- `components/ui/command-palette.tsx` — `cmdk@1.1.1` in a Radix `Dialog`, bound to
  Cmd/Ctrl+K via a `document` keydown listener, with `DialogTitle` in `sr-only` and
  `aria-label="Command palette"`. cmdk supplies list navigation and
  `data-[selected=true]` styling.
- Radix primitives (Dialog, DropdownMenu, Popover, Tooltip) bring focus trapping,
  `Escape` handling and correct ARIA for free.
- The `@media (prefers-reduced-motion: reduce)` block already neutralises the
  `framer-motion` and `tw-animate-css` work.

What is missing for genuine POS speed — no new dependency needed:

1. **Roving tabindex + arrow-key grid navigation** in `components/pos/menu-grid.tsx`.
   Tab-per-tile is unusable at rush; the pattern is one tabbable cell, arrows to move,
   `role="grid"`/`role="row"`/`role="gridcell"`. (Only `status-announcer` and a few POS
   badges currently use explicit roles/`aria-live`.)
2. **A single app-wide shortcut registry.** The Cmd+K listener in `command-palette.tsx`
   is a bespoke `document.addEventListener`. Adding six more of those independently is
   how shortcut conflicts and leaked listeners happen. One `lib/hooks/use-hotkeys.ts`
   (Layer 3, no new dependency) with a documented keymap.
3. **Numeric-first payment entry** — `inputMode="decimal"`, Enter-to-confirm, no
   mouse required through the charge path.
4. **Keyboard-navigable grids** — Home/End/PageUp/PageDown and arrow-key cell movement
   inside `data-table.tsx`, which is where the roving-tabindex work pays off twice.

---

## Part 3 — Why this minimises rewrite risk

**The choice that minimises rewrite risk is: keep shadcn/ui + Radix and extend
`components/ui/data-table.tsx` in place on TanStack Table v8.** Everything else follows.

Concretely, this plan is additive at every layer:

- **Layers 1–3 are not touched at all.** `lib/api-client/`, `lib/repositories/`,
  `lib/adapters/`, `lib/models/`, `lib/hooks/` — no file in any of them needs to change
  for any recommendation above. The revamp lives entirely in Layer 4. Every alternative
  (Mantine, AntD, AG Grid) also technically leaves Layers 1–3 alone, but each forces a
  parallel *styling* system, which is where the real coupling damage happens.
- **The eslint `no-restricted-imports` rule keeps passing untouched.** No recommended
  package requires a component to reach into `api-client` or `repositories`. Recharts
  takes plain arrays; TanStack Table takes plain arrays; `react-virtual` takes a count.
  Data still arrives through Layer-3 hooks.
- **Three new dependencies, all additive, none replacing anything:**
  `@tanstack/react-virtual@3.14.9`, `recharts@3.10.1`, and optionally
  `@hookform/resolvers@5.7.1`. No removals. No version bumps to Next/React/Tailwind.
- **The app keeps working at every commit.** `data-table.tsx` grows optional props, so
  its 4 existing call sites are unchanged. The 31 raw-`<table>` files convert one module
  at a time. Charts appear on dashboards that currently have none, so there is no
  before-state to regress. `shadcn add` writes new files into `components/ui/` and edits
  nothing.

**Suggested sequencing (each step independently shippable):**

| # | Step | Risk | Touches layers? |
|---|---|---|---|
| 0 | Extend the eslint rule to `app/**`; fix the 2 purchasing schema imports (move the const-enums to `lib/models/` or a neutral barrel, as `@/lib/errors` was) | low | boundary hardening only |
| 1 | Smoke-test `shadcn add table` (the `radix-nova` 404 caveat); add missing `components/ui/*` primitives | low | no |
| 2 | Pick five real OKLCH hues for `--chart-1`…`--chart-5`, light + dark | low | no |
| 3 | Add `recharts@3.10.1` + `shadcn add chart`; build dashboard charts | low | no (greenfield) |
| 4 | Extend `data-table.tsx`: filtering, faceting, grouping, column visibility, sticky header | medium | no |
| 5 | Add `@tanstack/react-virtual@3.14.9`; wire `virtualize` into `data-table.tsx` | medium | no |
| 6 | Convert the 31 raw-`<table>` files, module by module (finance → purchasing → inventory → hr) | medium, incremental | no |
| 7 | POS a11y: roving tabindex in `menu-grid.tsx`, `lib/hooks/use-hotkeys.ts`, grid keyboard nav | medium | Layer 3 addition only |
| 8 | *Optional:* swap `lib/forms/zod-resolver.ts` → `@hookform/resolvers@5.7.1` | low | Layer 3, isolated |
| — | *Deferred:* TanStack Table v9 — revisit when a migration guide exists | — | — |

---

## Part 4 — What I could not verify

Stated explicitly rather than guessed:

1. **TanStack Table v9 breaking changes.** `https://tanstack.com/table/latest/docs/guide/migrating-to-v9`
   returned **404**. I know v9.0.0 exists and was published 2026-08-04 (npm registry
   `time` field), and that `latest` points to it. I do **not** know what changed in
   `useReactTable`, `getCoreRowModel`, `ColumnDef`, or `flexRender`, or whether a codemod
   ships. The recommendation to stay on v8.21.3 is partly *because* of this unknown.
2. **Whether `shadcn add` currently works with `"style": "radix-nova"`.** The 404 bug
   ([#10730](https://github.com/shadcn-ui/ui/issues/10730)) was reported around May 2026;
   I did not re-test it against CLI 4.16.2 or run the CLI in this repo. Verify before
   planning around it.
3. **Actual bundle-size numbers.** I read Recharts' dependency *list* from the npm
   registry, not measured kB. The "heavy" claim is an inference from
   `@reduxjs/toolkit` + `react-redux` + `immer` + `victory-vendor` being present, not a
   bundle analysis. Run `@next/bundle-analyzer` before/after step 3 if it matters.
4. **AG Grid Enterprise renewal terms** beyond "perpetual, including 1 year of updates"
   as stated on the pricing page. The EULA was not read.
5. **Whether the `radix-nova` CommandItem styling bug ([#9228](https://github.com/shadcn-ui/ui/issues/9228))
   affects this repo's `command-palette.tsx`.** It uses `data-[selected=true]:bg-accent`
   explicitly rather than relying on style defaults, which *may* sidestep it — untested.
6. **Runtime a11y behaviour.** All a11y claims come from reading source
   (`aria-live`, roles, focus CSS). No screen-reader or axe run was performed.

---

## Sources

**Repository files read (all paths absolute under `/Users/muhammadumer/Documents/Projects/ResturantOS`):**
`frontend/package.json` · `frontend/eslint.config.mjs` · `frontend/components.json` ·
`frontend/app/globals.css` · `frontend/components/ui/data-table.tsx` ·
`frontend/components/ui/form.tsx` · `frontend/components/ui/command-palette.tsx` ·
`frontend/lib/forms/zod-resolver.ts` · `frontend/lib/hooks/reporting/use-dashboard-socket.ts` ·
`frontend/components/reporting/DashboardTileGrid.tsx` · `frontend/components/reporting/ReportTable.tsx` ·
`frontend/docs/finance-eslint-backlog.md` · `frontend/app/(tenant)/app/purchasing/invoices/page.tsx` ·
`frontend/app/(tenant)/app/purchasing/purchase-orders/page.tsx` ·
plus directory listings of `frontend/lib/{api-client,repositories,adapters,models,hooks,forms}` and
`frontend/components/{ui,shared,pos,kds,finance,reporting,dashboard}`, and resolved versions from
`frontend/node_modules/*/package.json`.

**External sources fetched:**
- npm registry — [`@tanstack/react-table`](https://registry.npmjs.org/@tanstack/react-table) (9.0.0 latest, published 2026-08-04; 8.21.3 published 2025-04-14)
- npm registry — [`@tanstack/react-virtual`](https://registry.npmjs.org/@tanstack/react-virtual/latest) (3.14.9)
- npm registry — [`@hookform/resolvers`](https://registry.npmjs.org/@hookform/resolvers/latest) (5.7.1, zod `^3.25.0 || ^4.0.0`)
- npm registry — [`recharts`](https://registry.npmjs.org/recharts/latest) (3.10.1, 2026-07-25)
- npm registry — `@visx/visx` (4.0.0, 2026-06-11), `echarts` (6.1.0, Apache-2.0), `echarts-for-react` (3.0.6), `@mantine/core` (9.5.1, 2026-08-02), `antd` (6.5.3, 2026-07-31), `ag-grid-react` (36.1.0), `shadcn` (4.16.2)
- [AG Grid — License & Pricing](https://www.ag-grid.com/license-pricing/) — Enterprise-only features, $999/dev
- [shadcn/ui — Tailwind v4](https://ui.shadcn.com/docs/tailwind-v4) — `@theme inline`, `data-slot`, forwardRef removal, OKLCH
- [shadcn/ui — Chart](https://ui.shadcn.com/docs/components/chart) — Recharts v3, `ChartConfig`, `var(--chart-N)`
- [TanStack Table](https://tanstack.com/table/latest) — feature list incl. grouping/aggregation
- [mantinedev discussion #7459](https://github.com/orgs/mantinedev/discussions/7459) and [tailwindlabs discussion #15832](https://github.com/tailwindlabs/tailwindcss/discussions/15832) — Mantine × Tailwind v4 cascade-layer conflict; [`tailwind-preset-mantine`](https://www.npmjs.com/package/tailwind-preset-mantine)
- [shadcn-ui/ui#10730](https://github.com/shadcn-ui/ui/issues/10730) — radix-nova registry 404; [shadcn-ui/ui#9228](https://github.com/shadcn-ui/ui/issues/9228) — radix-nova CommandItem styling
- [Shadcnblocks — component styles Vega/Nova/Maia/Lyra/Mira](https://www.shadcnblocks.com/blog/shadcn-component-styles-vega-nova-maia-lyra-mira) — `{library}-{style}` naming, Nova = compact
