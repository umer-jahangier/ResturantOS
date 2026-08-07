# Interaction-quality audit — what makes RestaurantOS feel unfinished

**Date:** 2026-08-07 · **Tenant:** `floating-terrace` · **Personas driven:** owner, cashier
**Method:** live browser (Playwright/Chromium) against the running stack — frontend `localhost:3000`,
gateway `localhost:8080`. Console and network read on every screen. 136 screenshots in
[`ux-shots/`](./ux-shots/).

Every finding below has a screen, a reproduction, and an artefact — a file:line, an observed HTTP
status, or a measured DOM value. Impressions were dropped. Two things I *expected* to find and
did **not** are recorded in [What is actually fine](#what-is-actually-fine), because a defect list
that never clears anything is not trustworthy.

---

## The headline

Three defects account for most of the "literally crap" feeling. They are not cosmetic.

| # | Defect | Why it matters |
|---|---|---|
| **F-02** | 11 of 15 list screens render the **empty state when the request fails** | The app tells an owner their vendors, tills, accounts and customers *do not exist* during an outage |
| **F-05** | Journal-entry detail shows **raw paisa** as the total | A Rs 3,886.00 entry displays as `388,600` — 100× overstated, on the ledger |
| **F-01** | A wrong authenticator code produces **no visible change at all** | Owner, tenant admin and accountant — 3 of 8 personas — are stuck at a screen that never says why |

---

## Reproduction harness

Scripts used are in the session scratchpad; each finding names the one that produced it. All of
them log in through the real gateway (TOTP generated from `.seed-state/totp/`) and drive the real UI.

> **Environment note, not a finding.** `auth-service`, `hr-service`, `authorization-service` and
> `audit-service` each went 503-via-stale-Eureka-lease during the audit and were restarted. Where a
> screen's state mattered I used Playwright **route interception** to force `500` / `[]` / a 6 s
> delay, so the evidence below is independent of which services happened to be alive.

---

# BLOCKER

## F-02 — A failed request renders the empty state: the app says your data does not exist

**Screens:** vendors, purchase orders, till review, chart of accounts, journal entries, periods,
expenses, ingredients, menu items, customers, reports (11 of 15 audited).

**Reproduce**

1. Sign in as owner.
2. Intercept the screen's data call and return `500` with the standard error envelope.
3. Load the screen.

```
node ux-states.mjs error      # forces 500 on each screen's primary API
node ux-states.mjs empty      # returns [] on the same call
```

**Observed — `error` and `empty` render byte-identical text:**

| Screen | With HTTP 500 from the API | With a genuinely empty list |
|---|---|---|
| `/app/purchasing/vendors` | "No vendors yet — Use "Add vendor" to create your first vendor…" | *identical* |
| `/app/pos/tills` | "No till sessions yet — Opened and closed tills appear here for review." | *identical* |
| `/app/finance/accounts` | "No accounts found — Chart of Accounts will appear here after provisioning." | *identical* |
| `/app/finance/journal-entries` | "No journal entries — Journal entries will appear here once created." | *identical* |
| `/app/crm` | "No customers found — Add your first customer to start tracking loyalty." | *identical* |
| `/app/purchasing/purchase-orders` | "No purchase orders yet" | *identical* |
| `/app/finance/expenses` | "No expenses" | *identical* |
| `/app/finance/periods` | "No periods found" | *identical* |
| `/app/inventory/ingredients` | "No ingredients yet" | *identical* |
| `/app/menu/items` | "No items in this category yet." ×3 | *identical* |
| `/app/reports` | "No reports available — The report catalog is empty." | *identical* |

**Evidence — the root cause is the same one line, two ways:**

```tsx
// frontend/components/finance/JournalEntryTable.tsx:37
if (isError || !data?.data.length) {
  return <FinanceEmptyState title="No journal entries" … />;
}
```

```tsx
// frontend/app/(tenant)/app/purchasing/vendors/page.tsx:12-13
const { data, isLoading } = useVendors();   // ← isError is never destructured
const vendors = data ?? [];                  //   on error data is undefined → [] → "No vendors yet"
```

Same shape at `frontend/components/pos/till-review.tsx:59,62,66` and
`frontend/components/crm/customer-list.tsx:33`.

**Screenshots:** `ux-shots/state-error_app_purchasing_vendors.png` vs
`ux-shots/state-empty_app_purchasing_vendors.png` (and the matching pair for every row above).

**Also:** only 2 of the 15 screens offer a **Retry** control (HR employees, HR payroll). Nothing
carries `role="alert"`, so a screen-reader user is told nothing at all.

**The 4 screens that get it right** — proof the fix is a pattern, not research:
`/app/hr/employees`, `/app/hr/payroll` ("Couldn't load the employee roster… **Try again**"),
`/app/inventory/stock` ("Inventory is temporarily unavailable."), `/app/finance/gl`
("Could not load GL balances" vs "No posted activity for this branch and period").

**Owner:** frontend, all modules · **Effort:** 3 d

---

## F-05 — Journal-entry detail renders raw paisa: every total is 100× too large

**Screen:** `/app/finance/journal-entries/{id}`

**Reproduce** — open any entry from `/app/finance/journal-entries`. The list row reads
`Rs 3,886.00`; the detail header for the same entry reads `388,600`.

**Evidence**

```tsx
// frontend/app/(tenant)/app/finance/journal-entries/[id]/page.tsx:93,99
<p className="mt-0.5 font-mono tabular-nums font-medium">
  {je.totalDebitPaisa.toLocaleString()}      // ← no /100, no currency
</p>
…
  {je.totalCreditPaisa.toLocaleString()}
```

This contradicts the codebase's own rule, stated at the top of the money helper:

```ts
// frontend/lib/adapters/shared.ts:1-2
// Money is stored as integer paisa on the wire and must NEVER be divided by 100 in a
// component — always go through here.
```

The list view is correct (`DrCrCell` → `MoneyDisplay`). Only the detail page is wrong, so the two
disagree about the same record.

**Screenshot:** `ux-shots/resp-1280_app_finance_journal-entries.png` (list, correct) — open a row to
see the detail.

**Owner:** frontend/finance · **Effort:** 0.5 d

---

# HIGH

## F-01 — A wrong authenticator code changes nothing on screen

**Screen:** `/login?tenant=floating-terrace` · **Affects:** owner, tenant admin, accountant

**Reproduce** (`node ux-login.mjs`)

1. Email `owner@terrace.local`, password `Terrace#Owner1`, Sign in → the *Authenticator code* field appears.
2. Type `000000`. Sign in.
3. Nothing happens. No message, no field highlight, no change of any kind.

**Observed** — the DOM before and after the failed submit is identical:

```
B) TOTP PROMPT SHOWN → {"alerts":[],"hasSignInFailed":false,"body":"Sign in to Floating Terrace … Authenticator code Enter your authenticator code to finish signing in. …"}
C) WRONG TOTP CODE   → {"alerts":[],"hasSignInFailed":false,"body":"Sign in to Floating Terrace … Authenticator code Enter your authenticator code to finish signing in. …"}
   >>> USER TOLD ANYTHING? NO — screen is unchanged
network: !! 401 POST http://localhost:8080/api/v1/auth/login
```

**Evidence — the server cannot distinguish the two cases, and the client clears the error:**

```console
$ curl -X POST localhost:8080/api/v1/auth/login -d '{…,"totpCode":"000000"}'
{"error":{"code":"TOTP_REQUIRED","message":"TOTP code required",…}}   HTTP 401
# identical to the response when no code was supplied at all
```

```tsx
// frontend/components/auth/login-form.tsx:135-144
if (error.isTotpRequired()) {
  setTotpRequired(true);
  setFormError(null);          // ← actively wipes any message
  window.setTimeout(() => form.setFocus("totpCode"), 0);
  return;
}
```

A wrong password *is* handled correctly ("Sign-in failed — Invalid email or password.",
`ux-shots/login-A-wrong-password.png`), which makes the silence on the second factor more confusing,
not less.

**Fix needs both ends:** auth-service must return a distinct code (e.g. `TOTP_INVALID`) when a code
was supplied and rejected.

**Screenshots:** `ux-shots/login-B-totp-prompt.png`, `ux-shots/login-C-wrong-totp-NO-FEEDBACK.png`

**Owner:** auth-service + frontend/auth · **Effort:** 1 d

---

## F-03 — The top-bar search searches nothing

**Screen:** every screen (app shell) · *This is the "limited top-bar search" the user named.*

**What it searches today:** a hardcoded array of **two** links.

**Reproduce** (`node ux-search.mjs`) — press ⌘K or click *Search…*, then type anything:

```
opened (no query) → groups: [ Navigation: ["Dashboard", "Appearance"], Theme: ["Toggle theme"] ]

query "Chicken"  → {"items":[],"empty":"No results found."}
query "vendor"   → {"items":[],"empty":"No results found."}
query "order"    → {"items":[],"empty":"No results found."}
query "invoice"  → {"items":[],"empty":"No results found."}
query "employee" → {"items":[],"empty":"No results found."}
query "till"     → {"items":[],"empty":"No results found."}
query "user"     → {"items":[],"empty":"No results found."}
query "menu"     → {"items":[],"empty":"No results found."}

NETWORK during palette use (api only):
  (none — the palette makes NO API call)
```

**Evidence**

```tsx
// frontend/components/shared/top-bar.tsx:95-98
const NAV_COMMANDS = [
  { label: "Dashboard",  href: "/app/dashboard" },
  { label: "Appearance", href: "/settings/appearance", roles: ["OWNER", "TENANT_ADMIN"] },
];
```

It is a client-side `cmdk` filter over that array. It issues no request, so it cannot find a record
by construction.

**What it should search.** Every one of these is already a live, permission-scoped gateway endpoint,
so the backend work is mostly aggregation, not new data:

| Object | Endpoint that already exists | Typical query |
|---|---|---|
| Menu items | `GET /api/v1/pos/menu/items` | "Chicken Karahi" |
| Orders | `GET /api/v1/pos/orders` | "ORD-20260807-0028" |
| Vendors | `GET /api/v1/purchasing/vendors` | "Fresh Foods" |
| Purchase orders / invoices | `GET /api/v1/purchasing/purchase-orders`, `/invoices` | a PO number |
| Ingredients | `GET /api/v1/inventory/ingredients` | "Basmati" |
| Customers | `GET /api/v1/crm/customers` | a phone number |
| Employees | `GET /api/v1/hr/employees` | a name or employee no. |
| Accounts / journal entries | `GET /api/v1/finance/accounts`, `/journal-entries` | "4000", "JE-2027-000004" |
| **Navigation** | — | even the app's own 30+ routes are not searchable today |

The minimum credible version is the last row alone: make the real sidebar routes findable. That
turns "No results found." for *"menu"* — a real destination two clicks away — into a hit.

**Screenshots:** `ux-shots/search-palette-open.png`, `ux-shots/search-query-chicken.png`

**Owner:** frontend + a search/suggest endpoint per service · **Effort:** 5 d (0.5 d for nav-only)

---

## F-13 — An owner has no user-management UI; three sidebar destinations 404

**Screen:** Settings

**Reproduce** — sign in as owner and navigate directly:

```
GET /app/settings         → HTTP 404  (raw Next.js "404 This page could not be found.")
GET /app/settings/users   → HTTP 404
GET /app/reporting        → HTTP 404
GET /settings/profile     → HTTP 404
```

The 404 is the framework's bare page — no app shell, no sidebar, no way back except the browser
Back button.

**Evidence**

```ts
// frontend/components/shared/sidebar-nav-items.ts:343-349
{ label: "Users", href: "/app/settings/users", icon: Users,
  permission: "rbac.manage",
  comingSoon: true },        // /app/settings/users page not built yet
```

Same at `:330-335` (`/app/settings`) and `:295-301` (`/app/reporting`). The items are hidden from the
sidebar by `comingSoon`, so the owner's Settings group renders exactly one entry — *Appearance* — and
the profile menu offers only *Appearance* and *Log out* (measured: `PROFILE MENU: My Account |
Appearance | Log out`).

Net effect: **an OWNER holding `rbac.manage` (65 permissions, all of them) cannot create, invite,
deactivate or re-role a single user through the product.** user-service and the RBAC catalog exist;
the screen does not.

**Screenshots:** `ux-shots/owner_app_settings_users.png`, `ux-shots/chrome-profile-menu.png`

**Owner:** frontend + user-service (endpoints exist) · **Effort:** 5 d

---

## F-14 — There is no way to create a dining table, in the UI *or* the API

**Screens:** `/app/pos` (Floor View, table picker), `/app/dashboard`

**Reproduce**

1. `/app/pos` → **Floor View** tab → "🪑 **No tables configured**". No action offered.
2. `/app/pos` → **Select table** → "No table (optional) / **No tables match**". Dead end.
3. `/app/dashboard` → tile reads "Dining tables **0 / 0** — 0 available now".

**Evidence** — unlike menu images (where a backend exists), here *neither side* has a create path:

```console
$ curl "…/api/v1/pos/tables?branchId=…"    → {"data":[],"meta":null,"warnings":[]}   HTTP 200
$ curl -X POST "…/api/v1/pos/tables" -d '{"tableNumber":"AUDIT-1","seats":4}'
405                                          # Method Not Allowed
```

```java
// services/pos-service/…/TableController.java
:29  @GetMapping                       listTables(@RequestParam UUID branchId)
:38  @PatchMapping("/{id}")            updateStatus(…)
:48  @GetMapping("/{id}/active-order") getActiveOrder(…)
//   no @PostMapping, no @DeleteMapping
```

```ts
// frontend/lib/repositories/pos.repository.ts:168,178,184 — list / patch status / get active order only
```

So dine-in table service can be *displayed* and *status-updated*, but a restaurant can never define
its floor plan. Every table-shaped surface in the product is permanently empty.

**Screenshots:** `ux-shots/pos-768-floor-view.png`, `ux-shots/pos-768-table-picker.png`

**Owner:** pos-service + frontend/pos · **Effort:** 3 d

---

## F-15 — A menu item cannot have a picture

**Screen:** `/app/menu/items` → **Add item**

**Reproduce** — open the dialog and inspect its fields.

**Observed**

```
[dialog opened] {"title":"Add menu item",
  "fields":[{"name":"categoryId"},{"name":"name"},{"name":"description"},{"name":"priceRupees"}],
  "fileInputs":0}
```

Four text fields, **zero file inputs**. The POS grid therefore renders text-only tiles
(`ux-shots/resp-768_app_pos.png`) — for a touch POS, the single highest-value visual affordance is
missing.

`FileController` exists in file-service, so upload transport is built; the menu-item model has no
image field to point at.

**Screenshot:** `ux-shots/form-menu-item-dialog.png`

**Owner:** pos-service (model) + file-service (wired) + frontend/menu · **Effort:** 3 d

---

## F-06 — The journal-entry form asks accountants to type paisa

**Screen:** `/app/finance/journal-entries/new`

**Reproduce** — open the form. The amount columns are labelled, literally, **"Debit (paisa)"** and
**"Credit (paisa)"**. To book Rs 5,000 the accountant must type `500000`.

**Evidence**

```tsx
// frontend/components/finance/JournalEntryForm.tsx:118-119
<span className="text-right">Debit (paisa)</span>
<span className="text-right">Credit (paisa)</span>

// :57-58  — parsed as raw paisa integers
const totalDebit  = lines.reduce((s, l) => s + (parseInt(l.debitPaisa  || "0", 10) || 0), 0);
const totalCredit = lines.reduce((s, l) => s + (parseInt(l.creditPaisa || "0", 10) || 0), 0);

// :187,193 — and echoed back unconverted
{totalDebit.toLocaleString()}     // "Total DR: 500,000"
```

Every other money input in the product takes **rupees** and converts internally —
`ExpenseFormDialog.tsx:66`, `ApPaymentDialog.tsx:57`, `MenuItemFormDialog.tsx:95`,
`VendorItemPriceDialog.tsx:104`, `ArChargeDialog.tsx:98`. Two opposite conventions for entering money
in one app, and the one that leaks the storage unit is on the ledger.

**Owner:** frontend/finance · **Effort:** 1 d

---

## F-08 — At 768 px the module tab bar is clipped and has no scroll affordance

**Screens:** all Finance screens, all Purchasing screens · **Widths:** 375 px and 768 px

**Reproduce** — resize to 768×1024, go to `/app/finance/journal-entries`.

**Measured** (`node ux-clip.mjs`, viewport width 768):

```
TABS: … {"label":"AP Aging","right":713,"offscreen":false},
        {"label":"House Accounts","right":799,"offscreen":true},
        {"label":"AR Aging","right":861,"offscreen":true}
nav overflowX=visible   (sw=589 cw=480)
doc scrollW=768 clientW=768   → page has no horizontal scrollbar
```

At 375 px, **4 of 8** Finance tabs are off-screen (Expenses, AP Aging, House Accounts, AR Aging), and
Purchasing loses Analytics.

**Evidence**

```tsx
// frontend/app/(tenant)/app/finance/layout.tsx:35        (8 tabs)
<nav className="mb-4 flex gap-4 border-b">
// frontend/app/(tenant)/app/purchasing/layout.tsx:25     (6 tabs) — identical
```

A plain flex row: no `overflow-x-auto`, no `flex-wrap`, no scroll snap. The overflow is absorbed by
`main.overflow-y-auto` two levels up, so the tabs are technically reachable only by scrolling the
*entire content region* sideways — there is no scrollbar on the tab strip itself and no visual hint
that anything is there.

**Screenshot:** `ux-shots/resp-768_app_finance_journal-entries.png` — "House Accounts" is cut
mid-word, "AR Aging" is absent.

**Owner:** frontend/shell · **Effort:** 1 d

---

## F-09 — The sidebar never collapses at tablet width, costing a third of the screen

**Screens:** all · **Width:** 768 px

**Reproduce** — 768×1024, any screen with a table.

**Measured:** sidebar occupies 255 px of 768 (`w-64`), leaving 512 px of content. On
`/app/finance/journal-entries` the *Credit* column is cut mid-number — the header renders as
"Crec", values as `Rs 290.0`, `Rs 3,886.0`. The avatar (which contains **Log out**) sits at
`right=787`, outside the 768 px viewport.

**Evidence**

```tsx
// frontend/components/shared/sidebar.tsx:145,154-155
const [collapsed, setCollapsed] = useState(false);   // always starts expanded; not persisted
…
"hidden md:flex",                                     // full width from 768px up
collapsed ? "w-16" : "w-64",
```

There is a manual *Collapse* control, but no `md`-breakpoint default and no persistence — a tablet
user re-collapses it after every full page load. A POS is explicitly a tablet target.

**Screenshot:** `ux-shots/resp-768_app_finance_journal-entries.png`

**Owner:** frontend/shell · **Effort:** 1 d

---

## F-10 — The sidebar shows a different tenant's brand name

**Screen:** every screen (app shell)

**Reproduce** — sign in as `owner@terrace.local` (tenant *Floating Terrace*). The login page says
"Sign in to **Floating Terrace**". The sidebar then says "**Lume**".

**Measured**

```
APP SHELL: { "brandInSidebar": "Lume", "branchChip": "Floating Terrace HQ", … }

$ curl localhost:8080/api/v1/auth/tenants/test              → {"slug":"test","name":"Lume"}
$ curl localhost:8080/api/v1/auth/tenants/floating-terrace  → {"slug":"floating-terrace","name":"Floating Terrace"}
```

**Evidence**

```ts
// frontend/lib/hooks/use-tenant-brand.ts:19
const slug = env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG?.trim();   // ← build-time env var, not the session
…
fetch(`${…}/api/v1/auth/tenants/${encodeURIComponent(slug!)}`)
```

The shell brand is resolved from a build-time default slug rather than the signed-in user's tenant,
so **every tenant sees the same brand** — currently that of the stale `test` tenant. This is a
separate bug from the `/login?tenant=test` redirect already being fixed: it lives in the app shell
and will still be wrong once the login redirect is corrected.

**Screenshot:** `ux-shots/resp-1280_app_dashboard.png` (sidebar header)

**Owner:** frontend/shell + expose brand on the session · **Effort:** 0.5 d

---

## F-16 — Session expiry drops you on a bare login, with no reason and no way back

**Screens:** all protected routes

**Reproduce** — let the 15-minute access token lapse, then click any nav item. Observed live on
`/app/crm` and `/app/reports`: a plain "Sign in to RestaurantOS" with **no notice at all**, and after
re-authenticating you land on `/app/dashboard`, not where you were.

**Evidence — three different redirects, none carrying a return path:**

```ts
// frontend/proxy.ts:57  — no ?reason=, no ?next=
return NextResponse.redirect(loginUrl(request));

// frontend/lib/api-client/client.ts:54
window.location.href = "/login?reason=session_expired";        // reason, but no ?next=

// frontend/components/providers/session-provider.tsx:72
router.replace("/login?reason=session_expired");               // reason, but no ?next=
```

The machinery already exists and is only half-wired — `sanitizeReturnPath` and the `?next=`
convention (`frontend/lib/auth/step-up.ts:18,25`) are used by the step-up flow
(`components/auth/step-up-required-notice.tsx:24`) and by nothing else. `proxy.ts` is the most common
path (cookie gone after a browser restart) and is the one that explains nothing.

**Owner:** frontend/auth · **Effort:** 1 d

---

## F-18 — Journal entries: no sort, no search, no date filter — while the filter API already exists

**Screen:** `/app/finance/journal-entries`

**Measured** — 25 rows rendered:

```
TABLES: [{"headers":[
  {"text":"Entry No","sortable":false},{"text":"Date","sortable":false},
  {"text":"Description","sortable":false},{"text":"Status","sortable":false},
  {"text":"Debit","sortable":false},{"text":"Credit","sortable":false}], "rows":25}]
FILTER/SEARCH INPUTS: []
```

**Evidence — the filter prop is declared and never passed:**

```tsx
// frontend/components/finance/JournalEntryTable.tsx:10-16
interface JournalEntryTableProps { filters?: JeFilters }
function JournalEntryTable({ filters }: JournalEntryTableProps) {
  const { data, isLoading, isError } = useJournalEntries(filters);
```

```tsx
// frontend/app/(tenant)/app/finance/journal-entries/page.tsx:22
<JournalEntryTable />        // ← no filters, and no UI anywhere to build them
```

A sortable, filterable table primitive is already implemented —
`frontend/components/ui/data-table.tsx:56,96-119` (TanStack `getSortedRowModel`, click-to-sort
headers, column filters) — but **only 3 screens use it**: vendor detail, ingredients, stock. Compare
`/app/inventory/ingredients`: 6 sortable headers plus "Search by name or SKU…". Everything else is a
hand-rolled `<table>`: purchase orders, invoices, payments, expenses, periods, house accounts,
payroll, attendance, recipes, coverage, till review, reports.

Purchase orders does have a status `<select>`; it has no sort and no text search.

**Screenshots:** `ux-shots/insp-owner_app_finance_journal-entries.png` vs
`ux-shots/insp-owner_app_inventory_ingredients.png`

**Owner:** frontend, all list screens · **Effort:** 2 d

---

# MEDIUM

## F-07 — HR screens format money differently from the rest of the app

**Screens:** `/app/hr/employees`, `/app/hr/payroll`

```tsx
// frontend/app/(tenant)/app/hr/employees/page.tsx:20   (identical at hr/payroll/page.tsx:24)
function rupees(paisa: number): string {
  return `₨ ${(paisa / 100).toLocaleString()}`;
}
```

Different symbol, and no fixed decimals — so a salary column is ragged:

| paisa | Rest of app (`MoneyDisplay`) | HR pages |
|---|---|---|
| 250050 | `Rs 2,500.50` | `₨ 2,500.5` |
| 250000 | `Rs 2,500.00` | `₨ 2,500` |

On a payroll table the decimals no longer line up and `₨ 2,500.5` reads like a truncation bug. It
also violates the rule quoted at `frontend/lib/adapters/shared.ts:1-2`.

**Owner:** frontend/hr · **Effort:** 0.5 d

---

## F-21 — Dates are rendered four different ways

| Rendering | Site | Example |
|---|---|---|
| Raw ISO | `components/finance/JournalEntryTable.tsx:69` `{je.entryDate}` | `2026-08-06` |
| Machine locale, date+time | `components/pos/till-review.tsx:47` `d.toLocaleString()` | `8/6/2026, 7:15:00 AM` |
| `dateStyle: "medium"` | `components/pos/charge-summary.tsx:50` | `6 Aug 2026, 07:15` |
| `toLocaleDateString()` | `app/(tenant)/app/inventory/stock/page.tsx:129` | `8/6/2026` |

`lib/adapters/shared.ts` has `toInstant()` but no formatter, so there is nothing to standardise on.
For a Pakistan-market product, `8/6/2026` is also ambiguous day/month.

**Owner:** frontend, shared · **Effort:** 1 d

---

## F-12 — The notification bell is inert and claims three unread messages

**Screen:** every screen

**Measured:** `bellLabel: "Notifications (3 unread)"`, `bellHasHandler: false`; clicking it leaves
`document.body.innerHTML.length` unchanged (54310 → 54310) and opens 0 popovers.

```tsx
// frontend/components/shared/top-bar.tsx:174-185
<button type="button" aria-label="Notifications (3 unread)">   {/* no onClick */}
  <Bell className="size-4" />
</button>
{/* Hardcoded stub count — real notification system in later phase */}
<span className="absolute right-1.5 top-1.5 … bg-destructive" aria-hidden="true" />
```

A permanent red dot that never clears, announcing a count that is a literal, on a control that does
nothing. Screen-reader users are told there are 3 unread items on every page of the app.

**Screenshot:** `ux-shots/chrome-after-bell-click.png`

**Owner:** frontend/shell · **Effort:** 0.2 d to remove, 3 d to build

---

## F-11 — The avatar shows a hex digit from the user's UUID

**Measured:** `avatarText: "6"` for `owner@terrace.local`.

```tsx
// frontend/components/shared/top-bar.tsx:111
const userInitial = userId ? userId.slice(0, 1).toUpperCase() : "U";
```

`userId` is a UUID, so the "initial" is the first hex character of `61334688-6b5c-…`. Fixing it needs
a display name on the session; the token carries only `sub`.

**Owner:** frontend/shell + auth-service claim · **Effort:** 0.5 d

---

## F-04 — The "Toggle theme" command does nothing

**Screen:** command palette (⌘K)

**Measured:** `documentElement.className` before and after selecting it — `changed=false`.

```tsx
// frontend/components/shared/top-bar.tsx:246-248
<CommandGroup heading="Theme">
  <CommandItem onSelect={() => setCmdOpen(false)}>Toggle theme</CommandItem>
</CommandGroup>
```

It closes the palette and nothing else. A working `ThemeToggle` sits in the same header
(`top-bar.tsx:189`); the command just never calls it. One third of the palette's contents is a no-op.

**Owner:** frontend/shell · **Effort:** 0.1 d

---

## F-17 — Deactivating an employee takes one click, with no confirmation

**Screen:** `/app/hr/employees`

```tsx
// frontend/app/(tenant)/app/hr/employees/page.tsx:181
onClick={() => deactivate(e.id)}

// :64-69
function deactivate(id: string) {
  deactivateEmployee.mutate(id, {                    // ← fires immediately
    onSuccess: () => toast.success("Employee deactivated"),
    onError:   () => toast.error("Failed to deactivate"),
  });
}
```

There is no `window.confirm` anywhere in the codebase, and every other module *does* gate its
destructive action behind a dialog — `inventory/ingredients/page.tsx:320` (`setArchiving`),
`inventory/categories/page.tsx:241`, `pos/order-panel.tsx:634` (`setConfirmingCancel`),
`pos/menu-grid.tsx:134` (clear-cart dialog). HR is the outlier, and its action affects payroll.

Two POS actions also mutate directly — `components/pos/order-panel.tsx:594` and
`components/pos/order-table-detail-drawer.tsx:295` (remove line item). Both are aria-labelled and
speed matters at a till, so they are defensible; the employee one is not.

**Owner:** frontend/hr · **Effort:** 0.5 d

---

## F-25 — A failed save shows only a transient toast carrying the raw server message

**Screen:** every create/edit dialog

**Reproduce** — open *Add item* on `/app/menu/items`, fill it, force the `POST` to return 500.

**Observed:** the dialog's inline error region stays empty (`"errors":[]`); the only signal is a
Sonner toast whose text is the backend's message verbatim — in the test, `"server exploded"`. Once it
auto-dismisses, the dialog looks exactly as it did before the click, with the Save button live again.

There is a `formatUserFacingError` helper (`lib/errors/user-facing`) that this path does not use.

**Screenshot:** `ux-shots/form-menu-item-after-error.png`

**Owner:** frontend, shared dialog pattern · **Effort:** 1 d

---

## F-20 — Journal-entry descriptions are raw UUIDs

**Screen:** `/app/finance/journal-entries`

The Description column — the only human-readable field an accountant has — reads:

```
Order revenue 5e98e671-908c-4829-b2d0-4e6865c4c3b7
Order revenue b64e3cdd-6e00-4d45-88d6-7e8afdaff0fb
```

`JournalEntryTable.tsx:70` renders `{je.description}` faithfully; the value is what finance-service
writes when it posts order revenue. It should carry the order number (`ORD-20260807-0028`), which the
dashboard already displays for the same records.

**Screenshot:** `ux-shots/resp-768_app_finance_journal-entries.png`

**Owner:** finance-service (posting rule) · **Effort:** 1 d

---

## F-22 — Tap targets below 44 px on the POS at tablet and phone width

**Screen:** `/app/pos`, `/app/menu/items` · **Widths:** 375 px, 768 px

Measured at 375 px on `/app/pos` — 10 controls under 44 px in either dimension:

```
106x28  "Add customer"
 72x32  "Dine-in"      89x32 "Takeaway"    69x32 "Pickup"
 85x36  "Starters"     71x36 "Mains"       74x36 "Drinks"
288x40  "Select table"
 65x40  "Close Till"
```

`/app/menu/items` row menus are `28x28` ("Actions for Chicken Samosa"). At 768 px every sidebar link
is `239x36`. WCAG 2.5.5 asks for 44×44; a greasy finger on a mounted tablet needs it more than a
mouse does. The shell already defines a `touch-target` utility and uses it in the top bar — it is
just not applied to the order-entry controls.

**Screenshots:** `ux-shots/resp-375_app_pos.png`, `ux-shots/resp-375_app_menu_items.png`

**Owner:** frontend/pos · **Effort:** 1 d

---

## F-26 — The POS WebSocket carries the access token in the URL

**Screen:** `/app/pos`

Console, on every POS load:

```
WebSocket connection to 'ws://localhost:8080/api/v1/pos/ws/orders/34cd6f62-…?token=eyJraWQiOiJkZXYta2V5LTEi…' failed
```

The full access JWT — including the `roles` and `permissions` arrays — is a query parameter, so it
lands in gateway access logs, proxy logs and browser history. It should move to a subprotocol header
or a short-lived single-use ticket.

The UI degrades honestly when the socket fails (the header badge switches to "Polling"), which is
good; the token placement is the defect.

**Owner:** gateway + pos-service + frontend/pos · **Effort:** 1 d

---

# LOW

## F-19 — The page advertises a keyboard shortcut that does nothing

`/app/finance/journal-entries` subtitle: *"Tab to navigate rows, Enter to open, **E to export**"*
(`app/(tenant)/app/finance/journal-entries/page.tsx:16`).

```tsx
// frontend/components/finance/JournalEntryTable.tsx:22-24
if (e.key === "e" || e.key === "E") {
  // Export stub — Phase 7
}
```

Tab and Enter work. E does nothing, silently.

**Owner:** frontend/finance · **Effort:** 0.2 d (remove the claim) / 2 d (build export)

---

## F-23 — Unlabelled 16×16 checkbox on Menu Items

```html
<!-- rendered on /app/menu/items -->
<input class="size-4 rounded border-input" type="checkbox">
```

No `id`, no `aria-label`, no associated `<label>`. The visible words "Show inactive" sit beside it but
are not programmatically connected, so a screen reader announces a bare checkbox — and 16×16 is below
any tap-target minimum.

**Screenshot:** `ux-shots/insp-owner_app_menu_items.png` · **Owner:** frontend/menu · **Effort:** 0.1 d

---

## F-24 — The breadcrumb mis-cases acronyms

`/app/finance/ar-aging` → "App › Finance › **Ar Aging**"; `/app/finance/gl` → "**Gl**".

```tsx
// frontend/components/shared/top-bar.tsx:36
return segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
```

The sidebar and the tab bar both say "AR Aging" and "General Ledger" correctly, so the breadcrumb is
the only place that gets it wrong. A small label map fixes it.

**Owner:** frontend/shell · **Effort:** 0.2 d

---

# What is actually fine

Verified, not assumed — these are the checks that came back clean.

| Checked | Result |
|---|---|
| **Forms losing data on error** | **No defect.** Forced a 500 on menu-item create: the dialog stayed open and kept every value (`"AUDIT Test Item"`, `"777.50"`). The login form likewise keeps email *and* password when the TOTP step-up appears (`login-form.tsx:136-139`). |
| **Keyboard focus trap** | **No defect.** 25 Tab presses inside the Add-vendor dialog never escaped it (`escapes dialog: false`), focus cycled correctly, and Escape closed it. |
| **Loading states** | Present on 13 of 15 list screens (skeletons). Two gaps only: HR uses a bare "Loading…" where everything else uses skeletons, and `/app/pos/tills` renders a complete table plus "Page 1 · **0 sessions total**" *while still loading*. |
| **Destructive confirmations** | Present in inventory, purchasing and POS (archive dialogs, `setConfirmingCancel`, clear-cart). Only HR employee deactivation is unguarded (F-17). |
| **Success feedback** | Toasts fire on HR mutations and dialog saves. |
| **Horizontal page scroll** | None at any of 375 / 768 / 1280 — `document.scrollWidth === clientWidth` everywhere. The clipping in F-08/F-09 is inside the content region, not the page. |
| **Permission-scoped nav** | Correct. A cashier's sidebar is `Dashboard | POS | Customers` — no Till Review, no Finance. |
| **`/app/reports/fbr`** | Returned HTTP 400 once during a service restart; re-tested clean (HTTP 200, `Rs 31,940.00` taxable sales, `Rs 5,110.40` output tax). **Not a finding.** |
| **POS degradation** | When the order WebSocket fails, the header badge switches to "Polling" rather than going silently stale. |

---

# Summary

| Severity | Count | Findings |
|---|---|---|
| BLOCKER | 2 | F-02, F-05 |
| HIGH | 11 | F-01, F-03, F-06, F-08, F-09, F-10, F-13, F-14, F-15, F-16, F-18 |
| MEDIUM | 10 | F-04, F-07, F-11, F-12, F-17, F-20, F-21, F-22, F-25, F-26 |
| LOW | 3 | F-19, F-23, F-24 |
| **Total** | **26** | |

**Total estimated effort: ~34 developer-days.**

**Cheapest credible wins** — under a day each, all highly visible:
F-04 (dead theme command, 0.1 d) · F-23 (unlabelled checkbox, 0.1 d) · F-12 (remove the fake unread
badge, 0.2 d) · F-24 (breadcrumb casing, 0.2 d) · F-19 (drop the phantom shortcut, 0.2 d) ·
F-10 (sidebar brand, 0.5 d) · F-05 (the 100× money bug, 0.5 d) · F-07 (HR currency, 0.5 d) ·
F-17 (confirm before deactivating an employee, 0.5 d) · F-03 nav-only search (0.5 d).

**Biggest trust win for the effort:** F-02. One shared `isError` branch across ~11 screens stops the
product telling owners their data has vanished, and it is the defect most likely to be behind
"literally crap".
