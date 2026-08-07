# ResturantOS — UI/UX Direction

**Date:** 2026-08-07
**Scope:** Competitive research into ERP/POS interface patterns, an audit of the existing Next.js frontend, and a concrete design direction with a rebuild order.
**Method note:** Every repo claim below cites a file I read. Every external claim cites a URL I fetched or a search result I received. Where I could not verify something, it is marked **[UNVERIFIED]** rather than filled in.

---

## 0. The judgment, stated plainly

The current frontend is **structurally competent and visually unfinished.** The routing, the permission/feature gating, the data layer, and the offline machinery are real engineering and should mostly survive. The *interface* — the part a restaurant owner judges in the first ten seconds — is the stock shadcn "neutral" starter with a grey-on-grey palette, 32px form controls, and hand-rolled `<table>` markup on most list pages.

Three specific things make it read as a prototype rather than a product:

1. **There is no colour.** `frontend/app/globals.css` defines `--primary: oklch(0.205 0 0)` — pure black, zero chroma. All five chart tokens (`--chart-1` … `--chart-5`) are also chroma-zero greys. A dashboard built on those tokens cannot draw a multi-series chart, and the product has no visual identity at all.
2. **The control sizes are desktop-CRM sizes, on a product whose two most important screens are touch screens.** `components/ui/button.tsx` tops out at `size: "lg"` → `h-9` (36px). `components/ui/input.tsx` is `h-8` (32px). WCAG 2.2 SC 2.5.5 (AAA) specifies 44×44 CSS px ([w3.org](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)). The codebase *knows* this — `globals.css` defines a `.touch-target { min-height: 44px }` utility — but that utility is bolted onto individual call sites rather than being a Button size, so POS and KDS get whatever the author remembered.
3. **The tokens are not enforced.** 26 `.tsx` files under `components/` and `app/` use raw Tailwind palette classes instead of semantic tokens (`bg-gray-950`, `text-amber-300`, `bg-emerald-500`, …). The entire KDS is hardcoded dark grey, so it is untouchable by the tenant-branding pipeline that `app/api/theme/route.ts` exists to serve.

None of this is a rewrite. It is a design-system pass plus five screen rebuilds.

---

## 1. External research — what the leaders actually do

### 1.1 POS order screen: the sub-10-second order

**Toast** organises the order screen as a three-level drill: *menus → groups → items*. You select a menu to see the groups inside it, then a group to see its items ([Toast support, via search](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens) — the page itself returns HTTP 403 to automated fetches, so this detail comes from the indexed summary, not a direct read). Colour-coding carries order status, table availability, and other state so staff can parse a screen without reading. Search exists specifically so staff can find a menu item or customer *without* navigating multiple screens.

**Square for Restaurants** exposes the order screen as a **user-editable tile grid**: an "Edit POS Layout" mode where an operator drags tiles, changes tile size, sorts tiles, and adds or deletes **pages** of tiles ([Square support, via search](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants)). Menu groups carry "color, size, and placement options." The important insight is not the drag-and-drop — it is that **the tile layout is operator-configurable data, not developer-authored layout.**

**Petpooja**, the closest comparator for the Pakistani/South-Asian market this product appears to target (paisa-denominated money, FBR tax reports at `app/(tenant)/app/reports/fbr`), claims "take orders, print KOT and print bills in three simple clicks," under-30-minute biller training, and — most usefully — **a single-click switch between a keyboard-optimised mode and a touch mode** ([petpooja.com](https://www.petpooja.com/poss/restaurant-billing-software), via search). That dual-mode idea is worth stealing outright: a high-volume counter biller wants a keyboard, a floor server wants a tablet.

**Toast's optimisation guidance** for faster order entry is: remove clutter, place high-traffic items prominently, group similar items with clear labels and icons, build dedicated buttons for common modifiers instead of forcing navigation, and offer a staff-customisable favourites section ([getanewpos.com](https://getanewpos.com/blog/toasttabpos/toast-tab-capabilities/optimize-your-toast-screen-for-faster-order-entry/)). That article explicitly does **not** give tile-count numbers or measured tap reductions — **[UNVERIFIED]**: I found no published, credible tile-count-per-screen or taps-per-order benchmark from any vendor. The "order in under 10 seconds" target in the brief should be treated as *our* internal target, not an industry-cited figure.

**Lightspeed (K-Series)** puts the floor plan on a dedicated Tables tab and colour-codes tables by **ownership**: a green symbol marks tables belonging to the logged-in user, other tables show an orange or red tag plus the first letter of the responsible staff member's name ([Lightspeed K-Series support](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328494-Understanding-the-Tables-screen), via search). On iPad the nav bar moved to the top and shrank; on iPhone a bottom nav was added specifically so servers can move between floor plan, order management, and settings **one-handed** ([Lightspeed K-Series](https://k-series-support.lightspeedhq.com/hc/en-us/articles/43162671781659-About-the-new-POS-navigation), via search).

**Grid vs search-first — the resolution.** Every vendor ships *both*, and the split is by service model, not preference:
- **Grid-primary** for QSR/counter: fixed menu, muscle memory, tile position is the index.
- **Search-primary** for large menus and keyboard billers: typing 3 characters beats three drill-downs.

The correct answer for ResturantOS is a persistent search field that never loses focus, with the grid underneath as the default surface — which, notably, is already what `components/pos/menu-grid.tsx` does (search at top, 150ms debounce, category pills, grid below). That structure is right. The sizing is not.

### 1.2 KDS: ticket cards, ageing, bump bars

**Colour-coded ageing** is universal. The commonly cited threshold pattern is green for the first five minutes, yellow from five to eight, red after eight, with the thresholds configurable per restaurant (multiple KDS vendor guides, via search — e.g. [delivety.com KDS guide](https://delivety.com/blog/kitchen-display-system-guide-what-is-a-kds), [orderout.co](https://www.orderout.co/blog/restaurant-kitchen-display-systems/)). **[UNVERIFIED]**: I could not find a single authoritative vendor spec fixing those exact minute values; treat 5/8 as a sane default, not a standard.

**The bump bar is the interaction model that matters,** and Toast documents it precisely ([doc.toasttab.com](https://doc.toasttab.com/doc/platformguide/platformKitchenUsingBumpBars.html)):

| Key | Behaviour |
|---|---|
| Up / Down | Rotate focus through tickets — up goes bottom→top and right→left; down goes top→bottom and left→right |
| Numbered 1–10 | Jump directly to the ticket showing that number |
| Page left / right | Move between ticket pages, resetting focus to the top-left ticket |
| Enter | Open ticket dialog; confirm; acknowledge a flashing ticket |
| Menu | Open ticket menu for Rush / Print |
| Fulfill | Fulfil selected items and the item in focus |
| Recall Last | Un-fulfil the most recently fulfilled items or ticket |
| View | Toggle display of recently fulfilled tickets |

The two design consequences: **every ticket must carry a visible position number** (that is what makes number-key jump work), and **there must be a persistent "focused ticket" concept** distinct from hover or selection. Our KDS currently has neither — `components/kds/kds-ticket-card.tsx` renders no index and the board has no focus state.

**Lightspeed KDS 2.0** makes ticket content configurable per screen: toggle Customer, Order ID, Number of Customers, Server, Type, Floor, Order Source, Pickup Time on or off; deactivate the "New" and "Ready to collect" status columns if the workflow does not need them; and route items to a station by "All items" or by menu category ([Lightspeed K-Series](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0)). That doc does **not** cover layout modes, colour thresholds, or courses — **[UNVERIFIED]** for those.

Other patterns from the KDS guides (via search): modifiers rendered in bold or colour **on the ticket face**, never buried in a notes field; course-based firing where appetisers fire immediately and entrées hold until the server signals; cross-station coordination so a grill item and a sauté side finish together.

### 1.3 Dashboard hierarchy: owner vs manager

**NetSuite** is the reference implementation. Its dashboard is composed of **portlets** — modular widgets, each showing one thing: a saved search, a KPI scorecard, a calendar, a list, a reminder, a report snapshot, or a trend graph. Dashboards are **role-based by default** — a sales rep, controller, warehouse manager, and CFO each land on a different home screen — users personalise further, and administrators can **publish** a standardised dashboard to a whole team ([netsuite.com SuiteAnalytics](https://www.netsuite.com/portal/products/business-intelligence.shtml) and [kimberlitepartners.com](https://www.kimberlitepartners.com/blog/netsuite-role-based-dashboards), via search). Behind most portlets sits a **saved search** — a named, shareable query.

The structural lesson: *the dashboard is not a page, it is a container of role-assigned portlets.* Owner and manager do not get the same page with different numbers; they get different portlet sets.

Applied to a restaurant:

| | **Owner** (multi-branch, weekly cadence) | **Manager** (one branch, today) |
|---|---|---|
| Time frame | This week / month vs last | Today, live |
| Top row | Net sales, gross margin %, labour % of sales, covers | Open orders, tickets over threshold, till variance, staff clocked in |
| Second row | Branch comparison table (sales, margin, labour by branch) | Live order list + station load |
| Exceptions | Voids/comps above threshold, negative-margin items, AP due this week | Items 86'd, late tickets, unapproved timesheets |
| Action | Drill to report | Act now — open the ticket, approve the till |

An owner's dashboard answers *"is the business healthy?"* An manager's answers *"what needs me in the next five minutes?"* Mixing them produces the page we currently have at `components/dashboard/tenant-dashboard.tsx`: four neutral stat cards (closed sales, active orders, menu items, dining tables) that serve neither.

### 1.4 Data-dense tables

**Odoo** is the best-documented pattern and I read the spec directly ([Odoo 19 search docs](https://www.odoo.com/documentation/19.0/applications/essentials/search.html)):

- **One search bar produces facets.** Typing a value and picking from the dropdown applies a `contains` filter shown as a removable chip.
- **Boolean semantics are explicit:** filters *within the same group* combine with **OR**; filters from *different groups* combine with **AND**. Custom filters offer "Match all of the following rules" / "Match any of the following rules", and rule branches nest with independent logic.
- **Group By is layered:** the first grouping is primary, each subsequent one subdivides. There is an "Add Custom Group" over any field.
- **Favourites = saved views.** "Save current search" takes a name, a **Default filter** toggle (this becomes the view's default on load), and a **share** setting; saved searches are editable, archivable, deletable by hovering the favourite.

Odoo's list view additionally supports **inline editing** (`editable="top"` / `editable="bottom"` — new rows at top or bottom, edited in place without opening a form) and **multi-record edit** via `multi_edit`, plus row decorations driven by field values (Odoo 18/19 list-view docs, via search).

**Toast** independently converged on the same idea for orders: a March 2026 release added a **table view** to the payment terminal — each order a row, with sort/filter by order source, dining type, amount paid, and status, toggleable against the old two-column grid, **with the choice remembered per user per device** ([updates.toasttab.com](https://updates.toasttab.com/announcements/view-orders-in-a-new-table-layout-in-the-payment-terminal-screen), Toast POS 2.103+).

The composite pattern to build: **search bar → facet chips → Filter/Group By/Saved-View menus → density toggle → column picker → row selection → bulk action bar → inline edit.** That is one component, used by every list in the app.

### 1.5 Navigating 15+ modules with role-scoped visibility

**SAP Fiori Launchpad** is the canonical answer and its rules are stated plainly ([SAP Fiori design guidelines](https://www.sap.com/design-system/fiori-design-web/v1-71/foundations/integration-and-services/sap-fiori-launchpad/launchpad)):

- A **shell bar** is permanently on top and holds cross-application functions only: branding, page title with navigation, enterprise search across all apps and business objects, notifications organised by priority and type, and a user actions menu (settings, app catalog, recent items, sign out). A back button appears once you enter an app.
- **Spaces and pages organise apps by business role** — "A space and its pages structure the most relevant apps for users with a certain business role," with the explicit instruction to include "only information and apps that users need to begin their daily business."
- Content is **role-based**: "the user's role determines which app tiles are shown."
- The model is **hub-and-spoke plus an application network**: a central home page is the centre of all navigation paths ([SAP Fiori navigation guidelines](https://www.sap.com/design-system/fiori-design-web/v1-38/foundations/best-practices/global-patterns/navigation/navigation), via search).

The lesson for a 15-module product: **do not put 15 modules in one scrolling sidebar.** Give each role a small set of *spaces*, put a global search in the shell bar that reaches business objects (not just page names), and let the home page be a role-assigned tile board rather than a nav list.

---

## 2. Repo audit

### 2.1 What is there

| Thing | Where | State |
|---|---|---|
| Next.js 16.2.9, React 19.2.4, Tailwind v4 | `frontend/package.json` | Current |
| shadcn config, style `radix-nova`, baseColor `neutral`, CSS variables on | `frontend/components.json` | Fine |
| Tailwind v4 CSS-first config (`@import "tailwindcss"` + `@theme inline`), no `tailwind.config.js` | `frontend/app/globals.css`, `frontend/postcss.config.mjs` | Correct v4 setup |
| Route groups `(auth)` / `(platform)` / `(tenant)` | `frontend/app/` | Good — 53 `page.tsx` routes |
| Grouped, permission+feature-gated sidebar | `frontend/components/shared/sidebar-nav-items.ts` (369 lines), `sidebar.tsx` | Strong logic, weak visual |
| Top bar with breadcrumb, ⌘K palette, notifications, theme toggle, profile | `frontend/components/shared/top-bar.tsx` | Structure right, content stubbed |
| TanStack Query + TanStack Table + Zustand + RHF + Zod | `frontend/package.json` | Right stack |
| Offline: service worker, IndexedDB outbox, sync engine | `frontend/lib/offline/`, `frontend/app/(tenant)/app/pos/layout.tsx` | Real, keep |
| Tenant brand palette generator (OKLCH) + WCAG validator | `frontend/lib/theme/palette-generator.ts`, `wcag-validator.ts`, `frontend/app/api/theme/route.ts` | Good idea, only overrides `--primary` |
| Semantic status system with icon + hue + label per status | `frontend/components/ui/status-badge.tsx` | **Best-designed thing in the codebase** — 20 statuses, token-only, never colour-alone |
| POS cart as pure reducer, no network on menu tap | `frontend/components/pos/cart-reducer.ts`, `pos-terminal.tsx` | Excellent architecture |
| KDS shared clock (one interval for all cards) | `frontend/lib/hooks/kds/use-kds-clock.ts`, used in `kds-ticket-card.tsx` | Correct |

### 2.2 What is broken or missing — specifics

**Colour tokens are colourless.** `frontend/app/globals.css`:
```css
--primary: oklch(0.205 0 0);      /* black */
--chart-1: oklch(0.87 0 0);       /* grey */
--chart-2: oklch(0.556 0 0);      /* grey */
--chart-3: oklch(0.439 0 0);      /* grey */
--chart-4: oklch(0.371 0 0);      /* grey */
--chart-5: oklch(0.269 0 0);      /* grey */
```
Five chart tokens with **zero chroma** cannot distinguish five series. The semantic tokens (`--success`, `--warning`, `--info`, `--destructive`) *are* real OKLCH colours and are well-chosen; the brand and chart ramps are not.

**Button and Input cannot reach touch size.** `frontend/components/ui/button.tsx` sizes: `default h-8`, `xs h-6`, `sm h-7`, `lg h-9`, `icon size-8`. `frontend/components/ui/input.tsx`: `h-8`. There is no `touch` or `xl` size. Compare WCAG AAA's 44px ([w3.org SC 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)). AA is only 24×24 ([w3.org SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)) so we technically pass AA — but AA is not the bar for a kitchen tablet with wet hands.

**26 files bypass the token system.** Raw palette classes found in, among others: all six `components/kds/*` files, `components/pos/till-review.tsx`, `till-session-bar.tsx`, `offline-indicator.tsx`, five `components/finance/*` files, five `components/purchasing/*` files, `app/(tenant)/app/dashboard/realtime/page.tsx`, and `app/(tenant)/app/pos/page.tsx`. Top offenders by count: `bg-gray-950` (16), `text-gray-400` (15), `text-gray-500` (10), `text-amber-300` (10), `bg-amber-500` (10). This is exactly the failure `status-badge.tsx`'s own comment warns against ("Semantic-token-only mapping, never raw Tailwind palette classes").

**The UI primitive set is too thin for an ERP.** `frontend/components/ui/` has 20 files: alert, animated-number, button, card, command-palette, data-table, dialog, dropdown-menu, empty-state, form, input, label, money-display, popover, skeleton, sonner, status-announcer, status-badge, theme-toggle, tooltip. **Missing:** Table (primitive), Select, Tabs, Sheet/Drawer, Badge, Separator, Checkbox, Switch, RadioGroup, Textarea, Combobox, DatePicker/Calendar, ScrollArea, Avatar, Progress, Accordion, Breadcrumb (currently hand-built inside `top-bar.tsx`), Pagination, Resizable, Toggle/ToggleGroup, Sidebar. That absence is *why* pages hand-roll markup — e.g. `app/(tenant)/app/purchasing/purchase-orders/page.tsx` uses a bare `<select>` for the status filter and a hand-written `<table>`.

**`DataTable` is a table, not a data grid.** `frontend/components/ui/data-table.tsx` (159 lines) has sorting and client pagination only. No filtering (`getFilteredRowModel` is never registered, though `table.getFilteredRowModel()` is called on line 65 — it silently falls back to the core row model), no column visibility, no row selection, no bulk actions, no saved views, no sticky header, no virtualisation, no density control, no URL state, no server-side pagination, no CSV export, no inline edit.

And it is barely used. **4 files consume `DataTable`**: `app/(tenant)/app/inventory/ingredients/page.tsx`, `app/(tenant)/app/inventory/stock/page.tsx`, `app/(tenant)/app/purchasing/vendors/[id]/page.tsx`, `components/pos/order-management.tsx`. Against that, **30 files hand-roll raw `<table>` markup** — 15 route pages (finance expenses, house-accounts, periods, journal-entries/[id]; hr attendance, employees, payroll; inventory coverage, recipes, recipes/[menuItemId], setup; purchasing invoices, order-suggestions, payments, purchase-orders) and 15 components (`finance/AccountTable.tsx`, `ApAgingTable.tsx`, `ArAgingTable.tsx`, `GeneralLedger.tsx`, `JournalEntryTable.tsx`, `hr/shift-calendar.tsx`, `inventory/StockCountDialog.tsx`, `StockTransferDialog.tsx`, `nlq/NlqResultPanel.tsx`, `pos/till-review.tsx`, `purchasing/MockGrnReceivePanel.tsx`, `SpendAnalyticsTable.tsx`, `ThreeWayMatchTable.tsx`, `reporting/ReportTable.tsx`, `dashboard/tenant-dashboard.tsx`). Each has its own header styling, its own empty state, its own (or no) pagination. That ratio — 4 shared to 30 bespoke — is why no two list pages in the app look alike.

**POS and KDS are trapped in the back-office shell.** `frontend/app/(tenant)/layout.tsx` line 917 renders `<main className="flex-1 overflow-y-auto p-4 lg:p-6 pb-20 md:pb-6">` wrapping `<PageTransition>`. So the POS terminal renders inside a padded, animated, scrollable back-office container with a 256px sidebar and a 56px top bar beside it. Meanwhile `components/kds/station-board.tsx` fights back with `className="dark bg-gray-950 min-h-screen ..."` — `min-h-screen` inside an already-scrolling `<main>` produces a nested scroll region and a dark panel floating in a light chrome. Both surfaces need to escape the shell entirely.

**Dead links in shipped navigation.** `frontend/components/shared/mobile-bottom-nav.tsx` links "Settings" to `/app/settings`; `top-bar.tsx` links the profile dropdown to `/settings/profile` and `/app/settings`. Neither route exists — `find app -path '*settings*' -name 'page.tsx'` returns only `app/(tenant)/settings/appearance/page.tsx`. `sidebar-nav-items.ts` correctly marks these `comingSoon: true` and hides them from the sidebar; the mobile nav and profile menu never got the memo.

**The nav is a 25-item flat scroll.** `sidebar-nav-items.ts` defines 8 groups / ~25 items. There is no notion of a role's *primary workspace*. A cashier and a CFO get the same sidebar shape, just with different rows hidden — the opposite of Fiori's spaces model.

**Command palette is decorative.** `top-bar.tsx` `NAV_COMMANDS` contains exactly three entries — Dashboard, Settings, Appearance — two of which are dead links. It does not reach orders, vendors, ingredients, employees, or any business object.

**Framer Motion page transition on every navigation.** `frontend/components/shared/page-transition.tsx` + `page-transition-motion.tsx` wrap every page. For an operator doing 200 navigations a shift this is added latency with no informational value. It does correctly respect `prefers-reduced-motion` and is SSR-safe — the engineering is fine, the product decision is wrong for this app class.

**No chart library.** `package.json` has no Recharts, no visx, no D3. `app/(tenant)/app/dashboard/realtime/page.tsx` exists and `react-countup` is installed, but there is no charting dependency. Any real analytics work needs one added.

### 2.3 Salvage / rebuild verdict

**Keep as-is (do not touch):**
- `lib/` in its entirety — adapters, api-client, repositories, hooks, models, offline, forms, features, auth
- `components/ui/status-badge.tsx` — extend the map, do not restructure
- `components/pos/cart-reducer.ts` and the lazy-persist logic in `pos-terminal.tsx`
- `lib/hooks/kds/use-kds-clock.ts` and `sortKdsTickets` in `station-board.tsx`
- `lib/theme/palette-generator.ts` + `wcag-validator.ts` (extend output, keep the generator)
- All permission/feature guard components and `use-nav-visibility`
- The route-group structure and every route path

**Keep with token/size surgery:**
- `components/ui/button.tsx`, `input.tsx`, `card.tsx` — add sizes, keep the CVA structure
- `components/shared/sidebar.tsx`, `top-bar.tsx` — keep the guard wiring, restyle and re-architect the content
- `app/globals.css` — keep the `@theme inline` bridge and the `.dark` structure, replace the values

**Rebuild:**
- `components/ui/data-table.tsx` → a real DataGrid (§3.5)
- `components/dashboard/tenant-dashboard.tsx` → role-scoped portlet dashboards
- All six `components/kds/*` files → token-driven, bump-bar-navigable board
- `components/pos/menu-grid.tsx` + `order-panel.tsx` → touch-sized, keyboard-mode-capable
- Every hand-rolled `<table>` in `app/(tenant)/app/**` → DataGrid call sites
- `app/(tenant)/layout.tsx` → shell that POS/KDS can opt out of

---

## 3. The direction

### 3.1 Layout shell — three shells, not one

The single biggest structural change. One `(tenant)` layout cannot serve a CFO reviewing a GL and a line cook at a wall-mounted screen.

**Shell A — Back office** (`app/(tenant)/app/**` except pos/kitchen)
```
┌──────────────────────────────────────────────────────────┐
│ ShellBar  56px   [brand] [space switcher] [⌘K search]  [branch] [bell] [avatar] │
├────────────┬─────────────────────────────────────────────┤
│ Rail 64px  │  Page                                       │
│ (space     │  ┌───────────────────────────────────────┐  │
│  icons)    │  │ PageHeader: title, meta, actions      │  │
│            │  ├───────────────────────────────────────┤  │
│ Nav 240px  │  │ Content — full-bleed, page owns pad   │  │
│ (pages in  │  │                                       │  │
│  the space)│  └───────────────────────────────────────┘  │
└────────────┴─────────────────────────────────────────────┘
```
Two-tier navigation replaces the 25-item scroll: a **64px icon rail** of *spaces* (Fiori's model), and a **240px panel** listing only the pages inside the active space. A user with three spaces sees three rail icons; the panel never exceeds ~8 rows. Rail collapses the panel away on `<1280px`.

Remove `p-4 lg:p-6` from `<main>` and remove `PageTransition`. Pages own their own padding via a `PageHeader` + `PageBody` pair, so a full-bleed grid page can actually be full-bleed.

**Shell B — Operator** (`app/(tenant)/app/pos/**`)
Full-viewport, no rail, no breadcrumb. Top strip 56px: till state, order type, branch, connection status, exit. Everything below is the working surface. Reachable only from the back office; exiting returns you there. Implement by moving POS to its own route group — `app/(operator)/pos/**` — rather than fighting the tenant layout from inside.

**Shell C — Kitchen** (`app/(tenant)/app/kitchen/**`)
Full-viewport, permanently dark, no chrome at all except a 48px station header. No sidebar, no top bar, no theme toggle. Same treatment: own route group, `app/(kitchen)/kitchen/**`. This also removes the reason `station-board.tsx` needs `min-h-screen` and `.dark` hacks.

### 3.2 Navigation model — spaces

Five spaces. Each user sees only those with at least one visible page, computed by the existing `useNavGroupVisibility` logic in `lib/hooks/auth/use-nav-visibility`.

| Space | Icon | Pages | Typical roles |
|---|---|---|---|
| **Operate** | `Store` | Dashboard, Floor, Orders, Tills, Kitchen (launcher) | Cashier, Server, Manager |
| **Menu & Stock** | `Boxes` | Menu items, Categories, Recipes, Ingredients, Stock, Coverage, Purchase orders, Vendors, GRN, Invoices | Manager, Purchaser |
| **Money** | `Wallet` | Accounts, Journal entries, GL, Periods, Expenses, AP/AR aging, House accounts, Payments | Accountant, CFO, Owner |
| **People** | `Users` | Employees, Schedule, Attendance, Payroll, Customers | HR, Owner |
| **Insight** | `BarChart3` | Reports, FBR, Realtime, Ask (NLQ) | Owner, Manager |

Plus a persistent **Admin** space (Settings, Users, Roles, Branches, Appearance) pinned to the rail bottom, and the existing `/platform/**` as a separate top-level shell for platform admins.

Three things this fixes: a cashier sees one rail icon instead of a filtered 25-row list; "Purchasing" stops being a peer of "Finance" when it is really the procurement end of stock; and adding module 16 does not lengthen anything.

**Global search must reach business objects.** Fiori's enterprise search "searches across all apps and business objects." Ours currently searches three hardcoded page names. Rebuild `⌘K` to search, in ranked order: recent items → orders by number → customers → vendors → ingredients → menu items → employees → pages → actions ("Open till", "New purchase order"). Each result type gets its own icon and a deep link. This is also the escape hatch that makes the two-tier nav survivable: if a user cannot find a space, they type.

### 3.3 Colour and typography tokens

**Brand.** Pick a real hue. Recommendation: a deep teal-green primary — it reads as hospitality without the fast-food-red cliché, survives the dark KDS context, and is distinguishable from the semantic success green by chroma and lightness rather than hue alone. Concrete values, replacing the chroma-zero primaries in `app/globals.css`:

```css
:root {
  --brand:            oklch(0.55 0.11 178);   /* deep teal */
  --primary:          oklch(0.55 0.11 178);
  --primary-foreground: oklch(0.99 0 0);
  --accent-brand:     oklch(0.72 0.14 55);    /* warm amber — CTAs, "fire" actions */
}
.dark {
  --primary:          oklch(0.70 0.12 178);
  --primary-foreground: oklch(0.16 0.02 178);
}
```

**Keep the existing semantic four.** `--success oklch(0.723 0.191 149.579)`, `--warning oklch(0.795 0.184 86.047)`, `--info oklch(0.685 0.169 237.323)`, `--destructive oklch(0.577 0.245 27.325)` are already sound and already have dark-mode pairs. Add the missing `--info-*`-style `-subtle` / `-border` variants so `status-badge.tsx`'s `/15` and `/30` alpha compositing can become named tokens rather than inline maths.

**Charts need a real categorical ramp.** Replace the five greys with five hues that are distinguishable in both themes and at 3px stroke width:
```css
--chart-1: oklch(0.60 0.13 178);  /* teal   — primary series */
--chart-2: oklch(0.66 0.15 55);   /* amber  */
--chart-3: oklch(0.58 0.16 265);  /* indigo */
--chart-4: oklch(0.64 0.17 340);  /* magenta*/
--chart-5: oklch(0.62 0.14 145);  /* green  */
```
Add a **sequential** ramp (`--seq-1..5`, single hue, lightness stepped) for heatmaps such as hourly-sales-by-day, and a **diverging** ramp (`--div-neg-2..--div-pos-2`) for variance — till over/short, budget vs actual, stock variance. Those three ramp types are the whole vocabulary a restaurant ERP needs.

**KDS-specific ageing tokens.** Extract the hardcoded values in `components/kds/kds-ticket-card.tsx` into named tokens so they are configurable per station and per tenant:
```css
--kds-surface:   oklch(0.16 0.005 250);
--kds-fresh:     oklch(0.72 0.15 150);
--kds-warn:      oklch(0.78 0.16 80);
--kds-late:      oklch(0.62 0.22 27);
```
The existing threshold logic (`fraction >= 0.66` → warn, `>= 1` → late, driven by the station's `escalationThresholdSeconds`) is good and should be kept exactly — it is more principled than the fixed 5/8-minute convention the industry guides describe, because it scales with the station's own target.

**Typography.** Geist Sans / Geist Mono are already wired correctly via `next/font/google` in `app/layout.tsx`. Keep them. Add an explicit scale, because there currently is none — page headings are ad-hoc `text-2xl` here, `text-xl` there (`tenant-dashboard.tsx` vs `purchase-orders/page.tsx`):

| Token | Size / line-height / weight | Use |
|---|---|---|
| `--text-display` | 30/36, 600 | Operator numerals — order total, till count |
| `--text-h1` | 20/28, 600 | Page title |
| `--text-h2` | 16/24, 600 | Section / card title |
| `--text-body` | 14/20, 400 | Default |
| `--text-sm` | 13/18, 400 | Table cells, secondary |
| `--text-xs` | 11/16, 500 | Labels, chips, column headers (uppercase, +0.04em) |
| `--text-pos` | 17/24, 500 | POS menu tile labels — min readable at arm's length |
| `--text-kds` | 22/28, 600 | KDS item lines — readable at 2 metres |

**Every number is tabular.** Enforce `font-variant-numeric: tabular-nums` globally on `td`, `.money`, and all numeric display, not per-call-site as now (`tenant-dashboard.tsx` applies `tabular-nums` in three places and misses others). Money stays in `MoneyDisplay` — right-aligned, currency symbol muted, negatives in `--destructive` with parentheses.

**Density.** Two levels, a `data-density` attribute on the grid root: `comfortable` (44px rows) and `compact` (32px rows). Persist per user per table, following Toast's per-user-per-device precedent.

**Radius.** `--radius: 0.625rem` (10px) is a touch soft for dense data. Drop to `0.5rem` for the base and keep the existing calc ladder in `@theme inline`; POS tiles override to `0.75rem` where the larger surface earns it.

### 3.4 Component inventory

**Tier 0 — primitives to add** (shadcn/Radix, mechanical):
Table, Select, Tabs, Sheet, Badge, Separator, Checkbox, Switch, RadioGroup, Textarea, Combobox, Calendar + DatePicker + DateRangePicker, ScrollArea, Avatar, Progress, Accordion, Breadcrumb, Pagination, ToggleGroup, Resizable, Sidebar, AlertDialog, HoverCard, ContextMenu.

**Tier 1 — sizing changes to existing primitives:**
- `Button`: add `touch` (`h-11`, 44px) and `pos` (`h-14`, 56px) sizes; keep `default h-8` for back office.
- `Input` / `Select` / `Combobox`: add `touch` (`h-11`).
- Delete the `.touch-target` utility from `globals.css` once sizes exist — a class that adds `min-height` on top of a fixed-height component is a source of silent layout bugs.

**Tier 2 — application components:**

| Component | Replaces | Notes |
|---|---|---|
| `AppShell` / `OperatorShell` / `KitchenShell` | `app/(tenant)/layout.tsx` | §3.1 |
| `SpaceRail` + `SpacePanel` | `components/shared/sidebar.tsx` | Reuses existing guard wiring verbatim |
| `ShellBar` | `components/shared/top-bar.tsx` | Fix the dead profile links |
| `GlobalSearch` | `top-bar.tsx` `NAV_COMMANDS` | Business objects, not page names |
| `PageHeader` / `PageBody` | ad-hoc `<h1>` in every page | Title, breadcrumb slot, meta, primary + overflow actions |
| **`DataGrid`** | `components/ui/data-table.tsx` | §3.5 — the highest-leverage single component |
| `FilterBar` + `FacetChip` | 12 bare `<select>` elements | Odoo facet model |
| `SavedViews` | nothing | Name, default-on-load, share |
| `BulkActionBar` | nothing | Appears on row selection |
| `Portlet` + `PortletGrid` | `tenant-dashboard.tsx` `StatCard` | NetSuite model, role-assigned |
| `KpiTile` | `StatCard` | Value, delta vs prior period, sparkline, drill target |
| `Chart*` (Line/Bar/Area/Donut) | nothing | Needs a chart dep added |
| `MenuTile` | inline in `menu-grid.tsx` | Configurable size 1×1 / 2×1, colour, image |
| `OrderTicket` | `components/pos/order-panel.tsx` line list | |
| `NumericKeypad` | nothing | Till counts, quantity, discount, cash tendered |
| `KdsTicket` + `KdsBoard` + `KdsFocusManager` | `components/kds/*` | Position numbers + focus model + key handling |
| `RecordDrawer` | `order-table-detail-drawer.tsx` | Generalise the one good drawer that exists |
| `AuditTrail` | nothing | Every ERP record needs a who/when/what tab |
| `EmptyState` (extend) | `components/ui/empty-state.tsx` | Add illustration + primary action slot |

### 3.5 `DataGrid` — the spec

Because 34 files render tabular data and only 4 of them share a component, this is worth over-investing in.

**Composition**
```
DataGrid
├─ Toolbar: search · FacetChip[] · Filter ▾ · Group ▾ · SavedViews ▾ · Columns ▾ · Density · Export
├─ BulkBar (visible only when rows selected): "12 selected" · actions · clear
├─ Header: sticky, sortable, resizable, pinnable-left
├─ Body: virtualised, optional grouped rows, optional inline edit, row decorations by field value
└─ Footer: "Showing 1–50 of 1,284" · page size · pagination
```

**Required behaviours**
- Filter semantics follow Odoo: same-group filters OR, cross-group AND, custom filters with explicit "match all / match any."
- Group By is layered — first grouping primary, later ones subdivide.
- Saved views take a name, a "default for me" flag, and a share flag; stored server-side per user per table key.
- **All grid state lives in the URL** (`?q=&f=&g=&sort=&page=&view=`). Non-negotiable: it is what makes a grid state shareable in a support conversation, and it is entirely absent today.
- Server-side pagination, sorting, and filtering by default; client-side only as an opt-in for known-small sets.
- Row virtualisation above 200 rows.
- Density and column visibility persist per user per table.
- Inline edit on double-click for permitted fields, optimistic with rollback (the `lib/offline` outbox pattern already models this).
- Keyboard: `↑↓` row focus, `Space` select, `Shift+↑↓` range, `Enter` open, `/` focus search, `Cmd+A` select page.

Wiring: register `getFilteredRowModel` — the current `data-table.tsx` calls `table.getFilteredRowModel()` on line 65 without ever providing the row model, so it silently falls through to the core model and filtering can never work even if a filter UI were added.

### 3.6 The five screens to rebuild first

Ordered by impact per unit of work.

---

**1. POS Order Terminal** — `app/(operator)/pos/**` (from `components/pos/pos-terminal.tsx`, `menu-grid.tsx`, `order-panel.tsx`)

*Why first:* it is the screen used most hours per day, it is the demo screen, and its architecture is already right — only the surface is wrong.

Layout, full viewport, three columns:
```
┌─ 56px strip: till · order type · table · branch · online dot · exit ─────────┐
├──────────────┬────────────────────────────────────┬────────────────────────┤
│ Categories   │  Item grid                         │  Order ticket          │
│ 180px        │  fluid, 5–6 cols @1280, 56px tiles │  360px                 │
│ vertical     │  search pinned at top, always      │  lines · qty steppers  │
│ 56px rows    │  focused, 3-char match             │  running total 30px    │
│              │                                    │  ─────────────────     │
│              │                                    │  [Send] [Charge]       │
│              │                                    │  72px, side by side    │
└──────────────┴────────────────────────────────────┴────────────────────────┘
```
Changes from today: categories move from horizontal pills to a vertical column (a 40-category restaurant wraps the pill row into three lines and destroys the grid); tiles go from `min-h-[100px]` mixed with `text-sm` to a 56px-min tile with `--text-pos`; the ticket panel widens from `w-80` (320px) to 360px; action buttons become 72px.

Adopt from research: a **staff favourites tile page** (Toast's optimisation guidance) as the default landing category; **operator-editable tile layout** stored as data (Square's Edit POS Layout model) — even a v1 that only allows reorder and size is worth it; and a **keyboard mode toggle** (Petpooja's single-click keyboard/touch switch) where item codes are typed and `Enter` commits, for counter billers.

Keep untouched: `cart-reducer.ts`, the lazy-persist `clientOrderId` idempotency in `pos-terminal.tsx`, the offline outbox, the `sendInFlightRef` double-click guard.

---

**2. KDS Station Board** — `app/(kitchen)/kitchen/[stationCode]` (from `components/kds/*`)

*Why second:* it is the screen a customer *sees working* during a demo, it currently hardcodes 16 instances of `bg-gray-950`, and it is missing the one interaction model that defines the category.

- Move to its own route group so `min-h-screen` and the `.dark` wrapper class disappear.
- Replace every raw grey/amber/red with the `--kds-*` tokens. Keep the `escalationThresholdSeconds` fraction logic in `getAgingTreatment` exactly as written.
- **Add a bump-bar-compatible focus model** (Toast's documented key map): render a position number on every ticket; maintain a focused-ticket index; bind `↑`/`↓` with Toast's exact traversal order (up = bottom→top and right→left; down = top→bottom and left→right), `1`–`0` for direct jump, `PageUp`/`PageDown` with focus reset to top-left, `Enter` to open, `F` to fulfil, `R` to recall last, `V` to toggle recently-fulfilled. USB bump bars enumerate as HID keyboards, so keyboard bindings *are* bump-bar support. **[UNVERIFIED]**: I did not confirm which specific bump-bar hardware the target market uses or what scan codes it emits by default — that needs a hardware check before finalising the key map.
- Ticket face: order number + position number, age chip, item lines at `--text-kds` (22px), **modifiers bold and inline** (per the KDS guides), notes as a distinct block. The current card truncates all items into one comma-joined line (`formatItemNames` + `truncate` in `kds-ticket-card.tsx`) — that is unreadable at 2 metres and must go.
- Configurable ticket fields per station, following Lightspeed KDS 2.0 (Customer, Order ID, Covers, Server, Type, Floor, Source, Pickup time as toggles).

---

**3. Role dashboards** — `app/(tenant)/app/dashboard` (from `components/dashboard/tenant-dashboard.tsx`)

*Why third:* it is the first authenticated screen every user sees, and it currently shows a cashier the same four cards it shows an owner.

Rebuild as `PortletGrid` with role-assigned defaults (NetSuite model, §1.3). Ship three presets — Owner, Manager, Cashier — as data, not as `if (permissions.includes(...))` branches. Portlet types for v1: `KpiTile`, `TrendChart`, `RankedList` (top items, worst-margin items), `ExceptionList` (voids over threshold, late tickets, unapproved timesheets), `RecordList` (recent orders), `Shortcuts`. Every portlet has a drill target.

This is where the chart dependency lands. **[UNVERIFIED]**: no charting library is currently installed and I have no evidence of a prior decision on one — that choice needs to be made explicitly rather than assumed.

---

**4. `DataGrid` + three reference list screens** — `components/ui/data-grid/**`

*Why fourth:* one component fixes 30+ files, but only if it is proven on real screens first. Build the grid, then convert exactly three pages that stress different axes:
- `app/(tenant)/app/purchasing/purchase-orders/page.tsx` — status facets, bulk approve, drill to detail (currently a bare `<select>` + hand-rolled `<table>`)
- `app/(tenant)/app/inventory/stock/page.tsx` — inline edit, threshold row decorations, large row count (already a `DataTable` consumer, so it is a clean before/after)
- `app/(tenant)/app/finance/journal-entries/page.tsx` via `components/finance/JournalEntryTable.tsx` — grouped rows, date-range facet, drill to `[id]`

Then convert the remaining ~27 mechanically.

---

**5. Shell + navigation** — `app/(tenant)/layout.tsx`, `components/shared/sidebar.tsx`, `top-bar.tsx`

*Why last despite being foundational:* the space model needs the other four screens to exist before you can tell whether the space boundaries are drawn in the right places. Ship the rail/panel, the real global search, the fixed profile menu, and delete the page transition. Also fix the three dead links (`/app/settings`, `/settings/profile`) — either build the pages or point the links at what exists.

---

## 4. What I could not verify

- **No vendor publishes a taps-per-order or seconds-per-order benchmark** I could find. "Under 10 seconds" is our target, not a cited industry figure. Petpooja's "three simple clicks" to order+KOT+bill and "150 bills per hour" are marketing claims from their own site, not independent measurement.
- **The 5-minute-green / 8-minute-red KDS convention** appears across several vendor blog posts but I found no authoritative spec fixing those values. Our existing per-station `escalationThresholdSeconds` fraction model is better and should not be replaced by fixed minutes.
- **Toast's ordering-screen support article and Oracle's KDS product page both return HTTP 403** to automated fetches. Toast ordering-screen details above come from an indexed summary; I have **no verified Oracle Simphony KDS specifics** at all and have not claimed any.
- **Bump-bar hardware scan codes** for the target market are unconfirmed. The key map in §3.6.2 mirrors Toast's documented *functions*; the physical key mapping needs a hardware test.
- **SAP Business One specifically** (as opposed to SAP Fiori generally) — the Fiori launchpad guidance I cite is from the SAP Fiori for Web design guidelines. I did not verify that B1's own client presents that shell.
- **No charting library decision** exists in the repo. §3.6.3 requires one; nothing in `package.json` predetermines it.
- **Tenant theming currently overrides `--primary` only** (`app/api/theme/route.ts`). Whether the brand ramp should also drive chart tokens is a product decision I did not find prior art for in `.planning/`.

---

## Sources

- [WCAG 2.2 — SC 2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [WCAG 2.2 — SC 2.5.5 Target Size (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)
- [Toast — Using the bump bar (platform guide)](https://doc.toasttab.com/doc/platformguide/platformKitchenUsingBumpBars.html)
- [Toast — Table layout in the payment terminal screen](https://updates.toasttab.com/announcements/view-orders-in-a-new-table-layout-in-the-payment-terminal-screen)
- [Toast — Manage Orders With Toast POS](https://support.toasttab.com/en/article/New-POS-Experience-Ordering-Screens) *(403 to fetch; summary only)*
- [Optimize Your Toast Screen for Faster Order Entry](https://getanewpos.com/blog/toasttabpos/toast-tab-capabilities/optimize-your-toast-screen-for-faster-order-entry/)
- [Odoo 19 — Search, filter, and group records](https://www.odoo.com/documentation/19.0/applications/essentials/search.html)
- [SAP Fiori — Launchpad design guidelines](https://www.sap.com/design-system/fiori-design-web/v1-71/foundations/integration-and-services/sap-fiori-launchpad/launchpad)
- [SAP Fiori — Navigation global patterns](https://www.sap.com/design-system/fiori-design-web/v1-38/foundations/best-practices/global-patterns/navigation/navigation)
- [NetSuite — SuiteAnalytics reporting & dashboards](https://www.netsuite.com/portal/products/business-intelligence.shtml)
- [Best practices for NetSuite role-based dashboards](https://www.kimberlitepartners.com/blog/netsuite-role-based-dashboards)
- [Lightspeed K-Series — Understanding the Tables screen](https://k-series-support.lightspeedhq.com/hc/en-us/articles/360050328494-Understanding-the-Tables-screen)
- [Lightspeed K-Series — About the new POS navigation](https://k-series-support.lightspeedhq.com/hc/en-us/articles/43162671781659-About-the-new-POS-navigation)
- [Lightspeed K-Series — Setting up Kitchen Display System 2.0](https://k-series-support.lightspeedhq.com/hc/en-us/articles/22168531609499-Setting-up-Kitchen-Display-System-2-0)
- [Square — Create menus with Square for Restaurants](https://squareup.com/help/us/en/article/6424-create-menus-with-square-for-restaurants)
- [Square — Organize your menu with menu groups](https://squareup.com/help/us/en/article/7804-organize-your-menu-with-square-for-restaurants)
- [Petpooja — Restaurant billing software](https://www.petpooja.com/poss/restaurant-billing-software)
- [Kitchen Display System Guide 2026](https://delivety.com/blog/kitchen-display-system-guide-what-is-a-kds)
- [Top strategies for restaurant kitchen display systems](https://www.orderout.co/blog/restaurant-kitchen-display-systems/)
