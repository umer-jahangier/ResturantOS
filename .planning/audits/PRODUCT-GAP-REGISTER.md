# RestaurantOS — Product Gap Register

**Compiled:** 2026-08-12
**Method:** 15 domains driven against the running stack with Playwright/Chromium, then adversarially
re-verified by a second pass per domain. Evidence lives under
`/Users/muhammadumer/Documents/Projects/ResturantOS/.planning/audits/diagnosis/` (31 directories,
~1,100 screenshots and transcripts).
**Rule applied throughout:** a capability is implemented only if a real user can reach it in a
browser and finish the task. Code existing, a 200 from an endpoint, and a green test are all worth
zero here.

---

## 1. THE HONEST HEADLINE

**No. This cannot be sold to a restaurant today, and the 3/10 is generous — the honest number is
2.5/10.** Not because little was built: 71 pages exist, 16 services exist, HR runs a real payroll
and purchasing runs a real PO-to-invoice cycle. It is because the product fails on the two
questions a restaurant asks first. *Can my cashier take the order the guest actually placed?* No —
there are no modifiers, no half/full variants, no discounts, no open-price key, no delivery, and
the till silently shows only about 20 menu items no matter how many you create. *Can I trust the
money?* No — a manager can void a fully-paid order at HTTP 200 with the cash still recorded against
it and no reversal, the voided order then vanishes from all seven order filters and from search
while its payment row survives, and cash taken against an open order never reaches the Takings
screen at all. That is a shrinkage mechanism, not a bug list. On top of that the tenant cannot
configure the two things every install starts with: there is no screen anywhere to route a dish to
a station (every ticket in the system lands on `DEFAULT`, so a bar screen is permanently empty),
and there is no screen anywhere to configure a printer, so every receipt is a browser print dialog.
And as this register is being written, six of sixteen backend services — POS, kitchen, CRM, HR,
file and notification — are not running, so a signed-in manager gets
`{"error":{"code":"SERVICE_UNAVAILABLE"}}` when they open the till. A restaurant that installed
this on Friday would be closed by Saturday lunch.

The 3/10 is generous for one further reason worth stating plainly: the recurring failure mode here
is not "unfinished", it is **"structurally present, behaviourally absent"**. `serviceModel`
(COUNTER / TABLE_SERVICE / SELF_SERVE) is configurable on every terminal and read by nothing.
`useApplyDiscount()` exists in `frontend/lib/hooks/pos/use-orders.ts:186` with zero callers.
`Modifier.java` and `ModifierGroup.java` are JPA entities with no repository, no service and no
route. `receiptConfig` on every branch already carries a `printers[]` array and a print-agent URL
that no screen ever shows. `pos.order.void.own` is in the cashier's live JWT and the endpoint
demands a different permission, so the button 403s — and `VoidOwnOrderIT.java` is green while it
does. That pattern is why status reports have been optimistic and the product is a 3. Any plan
built from "what code exists" will repeat it.

---

## 2. THE SCORECARD

Scores are out of 10 against what a Pakistani single-site or small-group restaurant needs to run a
day, benchmarked against eposmatic / Toast / Lightspeed / Square. **Table stakes** means a
restaurant will not buy without it.

| # | Module | Table stakes | Status | Score | One line of evidence |
|---|---|---|---|---|---|
| 1 | POS — Order Capture & Service Modes | ✅ | PARTIAL | **3** | Ring → table → Send to Kitchen → CASH works (`ORD-20260812-0008`), but the whole order panel is `[Send to Kitchen, Save as Draft, Charge Now]` — no modifier prompt on tap (`dialogs before=0 after=0`), no variant, no discount, no open price |
| 2 | Table & Floor Management | ✅ | PARTIAL | **2** | `/app/tables` is a text list grouped by section with 3 states (`AVAILABLE / OCCUPIED / NEEDS_BUSSING`); "Floor View" is `grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6` (`table-floor-view.tsx:97`) — no drag-placed plan, and `DiningTable` has no `posX/posY/shape` |
| 3 | Kitchen Display & Routing | ✅ | PARTIAL | **3** | Live WebSocket push is real (`ORD-20260812-0020` appeared on an un-reloaded board at age `00:18`); but all 9 menu items return `effectiveStationCode=null`, so one mixed check fires as ONE ticket to `DEFAULT` and `/app/kitchen/BAR` shows 0 cards |
| 4 | Menu, Modifiers & Pricing | ✅ | PARTIAL | **2** | Item dialog labels are exactly `[Category, Name, Description, Price (Rs), Picture]` — no variant, no modifier, no tax, no channel price. Till showed **10 of 15** newly created items (`RUN-LOG-5.txt`) |
| 5 | Inventory & Stock Control | ✅ | PARTIAL | **4** | Ingredients (19 rows), categories, UoM, storage locations, and stock dialogs `[Opening balance, Receipt, Count, Transfer]` all render and post; `/app/inventory/wastage`, `/valuation`, `/counts`, `/transfers`, `/movements`, `/expiry` have **no `page.tsx`** |
| 6 | Recipes, Sub-Recipes & Food Costing | ❌ | PARTIAL | **5** | Real: `Chicken Karahi v1 · active since 8/11/2026`, `Batch cost Rs 1,130.06`, `Food cost % 77.9%`, plus a Coverage worklist reading `10 Total · 2 Covered · 8 No Recipe` |
| 7 | Purchasing, Vendors & Procurement | ✅ | PARTIAL | **5** | Full PO lifecycle driven (`po-draft → PENDING_APPROVAL → Approve → send → receive → close`) and invoices reach `MATCHED` / `MISMATCHED` / `PAID`; but `/api/v1/purchasing/vendors` returns `rows:20 total:29 next:"1"` and the page renders **no pager** — 9 vendors are unreachable |
| 8 | Wastage, Voids & Variance Control | ❌ | MISSING | **1** | No wastage route exists; comps share one `discount_paisa` column; and since no discount UI exists at all, the Discount Summary report can only ever read zero |
| 9 | Payments & Tender Types | ✅ | PARTIAL | **3** | Split multi-method tender genuinely works (CASH Rs 50.00 + CARD Rs 42.80 → `Remaining balance Rs 0.00`); but the field is `aria-label="Amount in paisa"`, no change due, no tip, no service charge, and `{tip:false, wallet:false, qr:false, houseAccount:false}` |
| 10 | Finance & Accounting | ✅ | PARTIAL | **6** | CoA, GL, Periods, Expenses, AP/AR Aging, House Accounts, Takings and a posting JE with a working `Reverse` (`201 POST /journal-entries/{id}/reverse`); but Rs 77.00 of cash recorded on an open order moved **no figure** on `/app/finance/takings` |
| 11 | Reporting & Analytics | ✅ | PARTIAL | **2** | 8 reports render real rows (`purchases-by-po` = 25 rows). `trendChart = 0` on **every** page probed, `exportButtons = []` on **every** report. There is not one graph in the product |
| 12 | NLQ / "Ask" | ❌ | PARTIAL | **1** | `/app/nlq` renders and accepts a question; three plain questions returned `That question couldn't be answered`, `tableCount=0`, `charts=0`. `/app/settings/ai`, `/settings/nlq`, `/settings/ai-provider`, `/app/nlq/settings` → 404 |
| 13 | CRM, Loyalty & Marketing | ❌ | PARTIAL | **2** | Phone lookup and attach-to-check works and points accrue on settle (`Diag Loyalty 24573 · 1682 pts · Rs 1,682.00`); `/app/crm/loyalty`, `/promotions`, `/campaigns`, `/segments`, `/rewards`, `/app/loyalty`, `/app/marketing`, `/app/subscriptions` → **all 404** |
| 14 | HR, Payroll & Scheduling | ❌ | WORKS | **6** | Strongest module. `8/2026 · PAID · gross Rs 270,000.00 · net Rs 267,420.00`, step-up TOTP enforced on approve ("Verification expired… sign in again with your authenticator code"), weekly drag-assign roster, income-tax band editor |
| 15 | Users & Staff Administration | ✅ | PARTIAL | **5** | Add user → temp password → role per branch → deactivate → deactivated login `401 Invalid credentials`: all driven and persisted. But a role, once assigned, has **no revoke control** (`anyRevokeText: false`) |
| 16 | Branch Management | ✅ | MISSING | **2** | `/app/branches`, `/app/settings/branches`, `/app/branch`, `/app/locations`, `/app/admin/branches` → `This page doesn't exist` for **owner and admin**. No branch can be created, renamed or deactivated from the product |
| 17 | RBAC / Custom Role Builder | ✅ | MISSING | **2** | `/app/roles` and `/app/settings/roles` → 404. The Assign-role dialog offers a fixed list of 8; there is no permission picker anywhere (`checkboxes: 0`). Server-side ceiling is solid (`ROLE_CEILING_EXCEEDED`) |
| 18 | Platform / SuperAdmin Console | ✅ | PARTIAL | **5** | Create tenant → tier change (`Moved from GROWTH to STARTER. 9 module(s) changed`) → 20 module toggles with override semantics → suspend → reactivate, all persisted. `/platform/users`, `/health`, `/billing`, `/plans`, `/usage`, `/audit`, `/impersonate` → 404; no MFA on the platform account |
| 19 | Tax & Fiscal Configuration | ✅ | MISSING | **1** | Owner sidebar: `hrefs matching tax/fiscal: []`. No sales-tax screen exists. Editing an item's **description** through the UI erases its `taxRateCode` (`'SR-STD-17'` → `None`) because the PUT body has no tax keys |
| 20 | Printing & Hardware | ✅ | MISSING | **1** | `/app/settings/printers` → 404 for cashier, manager, admin **and owner**; `nav mentions printer? false` for all. Receipt footer literally reads `No printer configured for this branch - browser bill`; `window.print()` count = 2, agent calls to `:7654` = 0 |
| 21 | Online Ordering / QR / Delivery / Aggregators | ✅ | MISSING | **0** | `grep deliveryAddress\|deliveryZone\|driverId\|qrCode` across `services/pos-service/src/main` → **0 hits**. `order-type-toggle.tsx:12-19` says DELIVERY "is deliberately not exposed here" |
| 22 | Onboarding & Tenant Configuration | ✅ | PARTIAL | **3** | New tenant → forced password change → TOTP enrol → dashboard works end to end. But `/app/onboarding`, `/app/setup`, `/app/welcome`, `/app/getting-started` → 404, and `/app/settings/page.tsx` records that `/api/v1/tenant-profile`, `/tenants/{id}/settings`, `/api/v1/settings` and `/api/v1/onboarding` **all 404** |
| 23 | Cross-cutting UI Quality | ✅ | PARTIAL | **3** | No inline validation anywhere: typing `-100` into Price and `not-an-email` into Email produced `ariaInvalid: 0` on type **and** on blur, submit never disabled, errors appear only after submit and do not clear when the field is fixed |
| 24 | Reliability & Operability | ✅ | BROKEN | **2** | Right now: 6/16 services down; POS, KDS, CRM and HR all return `503 SERVICE_UNAVAILABLE` to a signed-in manager. During the audit the gateway returned `429 Too Many Requests` on ordinary page navigation and killed a run |

**Modules that do not exist in any form** — this is the most important row in the table:
Delivery, QR-at-table / guest ordering, aggregator integration (foodpanda / Cheetay), drive-thru,
room service, waitlist, reservations, modifier groups, item variants, discounts and comps, wastage,
lot/expiry tracking, tip and service charge, mobile wallets (JazzCash / Easypaisa / Raast /
SadaPay), integrated card terminals, 86-list propagation, all-day counts, expo screen, kitchen
printer fallback, per-terminal quick-key layouts, custom roles, branch CRUD, sales-tax
configuration, printer configuration, CSV/PDF export of any report, and any chart anywhere.

---

## 3. THE CRITICAL PATH TO SELLABLE

This is the minimum, not the wish list. Nothing here is optional and nothing not here belongs in
the first release. Ordered — each item is a precondition for the ones under it.

1. **Stop the money leaking.** Block `POST /orders/{id}/void` when `amountPaidPaisa > 0` and force
   the Refund path; make Refund reachable from any paid order rather than only from `CLOSED`
   (`void-refund-dialog.tsx:61` gates on `order.status === 'CLOSED'`, which paid orders rarely
   reach); make a voided order still findable by search and by a "Voided" filter; and make cash
   recorded against an open order appear on `/app/finance/takings` on the day it was taken.
   *Without this the product is a theft tool.*
2. **Get all 16 services up and keep them up**, with a health page an operator can see. Six are
   down as this is written and the failure surfaced to the user as a blank till.
3. **Ship the station-routing screen.** One admin screen writing the two endpoints that already
   exist (`PUT /pos/menu/categories/{id}/station`, `PUT /pos/menu/items/{id}/station`). The entire
   backend chain is proven correct — routing Drinks→BAR over the API made one check split into two
   tickets and made the bar board light up. This is the single highest value-per-hour fix in the
   register.
4. **Make the till show the whole menu.** The grid renders ~20 items regardless of catalogue size
   (10 of 15 probe items were invisible) and search filters only what was already fetched. A
   restaurant cannot sell what it cannot see.
5. **Modifiers and variants.** Half/Full and "no chilli, extra naan" are not features here, they are
   the Pakistani menu. Until these exist the till cannot ring a normal order.
6. **Discounts and comps with a reason code**, wired to the endpoint, hook and permission that all
   already exist and have zero callers.
7. **Printer configuration and silent printing.** The `receiptConfig.printers[]` and the print agent
   at `127.0.0.1:7654` are already in the branch record; there is no screen, and no browser request
   to the agent was ever observed. A restaurant will not accept a Ctrl-P dialog per bill.
8. **Sales-tax configuration**, and stop the item editor wiping `taxRateCode` on an unrelated save.
9. **Branch CRUD**, and make the branch switcher survive a reload (it currently reverts to HQ).
10. **Cash ergonomics:** rupees not paisa, tendered amount, change due. This is the most repeated
    action in the building and it is a raw integer field in the wrong unit.

Everything else — loyalty rewards, delivery, QR, aggregators, charts, NLQ, expo screens, all-day
counts, waitlist — is version 2. Shipping any of it before items 1–10 is how this stays a 3.

---

## 4. THE OWNER'S SPECIFIC COMPLAINTS, ANSWERED

### 4.1 "Stations, KDS, POS and terminals are not wired together"
**Correct, and worse than stated. VERDICT: the two ends work and the middle does not exist.**
An admin *can* create a station: `/app/stations → Add station → Code=DGB28334, Type=[Kitchen, Bar,
Pantry, Expo (the pass), Dessert] → 201 POST /api/v1/pos/stations`, dialog 448×409, persists.
An admin *can* create a scoped terminal: `/app/terminals → Add terminal`, tick Drinks, tick Main
bar, and the row reads `Offers Drinks · fires to Main bar` — persisted as
`categoryIds:[2], stationIds:[1], offersWholeMenu:false`.
**But there is no screen to route a dish or a category to a station.** The item action menu is
exactly `["Edit","Deactivate"]`; the Edit dialog is `[Category, Name, Description, Price (Rs),
Picture]`; `/app/menu/routing`, `/app/menu/stations`, `/app/settings/stations` all render
`This page doesn't exist` — as OWNER, so it is not a permissions artefact. Consequence, measured:
`GET /api/v1/pos/menu/items` returns all 9 items with `effectiveStationCode: null`. Ringing Mutton
Biryani + Pinacolada produced **one** ticket on `DEFAULT` carrying both, while `/app/kitchen/BAR`
showed 0 cards and did not contain the string "Pinacolada". The bar never gets the drink.
The terminal profile is equally inert: `grep serviceModel` finds it in
`terminal-form-dialog.tsx`, `terminal-list.tsx` and the model — and **nothing** under
`frontend/components/pos/` or `frontend/lib/hooks/pos/` reads a terminal at all. A cashier's till
renders every category (`["All","Diag Cat 683566","Diag Cat 785508","Starters","Mains","Drinks",
"Soft Drinks"]`) while a "Drinks only" terminal exists. `page.getByTestId('terminal-picker')`
count = 0; `localStorage` keys = `[]`. There is no way to bind a device or an account to a terminal.
A bartender created exactly as documented (`/app/users → Role Kitchen Staff → tick "Main bar / Bar —
Bar screen"`) signs in and sees `No active stations configured`.
The good news, and it changes the estimate: the backend chain is correct. Routing Drinks→BAR over
the API (`204`) made the very next mixed check split into two tickets — `station=DEFAULT
items=Chicken Karahi` and `station=BAR items=Pinacolada` — and `/app/kitchen/BAR` immediately
rendered one card. **The gap is one missing admin screen, not a pipeline.**

### 4.2 "The POS doesn't show product images"
**Correct. VERDICT: MISSING at the till, WORKS in management.**
Live DOM probe of `[data-testid="menu-grid"]` as `cashier@terrace.local`:
`{tiles:10, imgs:0, svgs:0, bgImages:0}`. The first tile's `outerHTML` is a bare `<button>` with two
`<span>`s — name and price. The item literally named `Photo Dish 50585`, which has a stored picture,
renders as text. `menu-grid.tsx` never reads `item.imageUrl` and never imports `MenuItemImage`,
although `lib/models/pos.model.ts:47-50` carries both `imageFileId` and a server-derived `imageUrl`
on every item. Upload does work and persists: as manager, `/app/menu/items → Edit Chicken Karahi →
Picture → Save changes`, then a full reload rendered `<img alt="Chicken Karahi" naturalWidth=120>` —
the exact fixture dimensions. Then back to `/app/pos`: still `{imgs:0, tiles:10}`. The photo is
uploaded, stored, served, and thrown away at the one screen it was bought for. Square lets you set
a tile colour per item in two clicks as a fallback; here there is not even that.

### 4.3 "SuperAdmin has no management"
**Half wrong, half right — and the right half is the important half. VERDICT: PARTIAL.**
Tenant lifecycle is genuinely good and was driven end to end: create a tenant (`dialog 384×423`,
`[brand-name, admin-email, tier]`, "Provisions the tenant, its HQ branch, its chart of accounts and
its first administrator. If any step fails the whole thing is rolled back"), change tier
(`Moved from GROWTH to STARTER. 9 module(s) changed: FEATURE_LOT_TRACKING, …` and after reload the
limits really read `Branch limit 1 / User limit 10 / NLQ quota 1,000`), toggle any of **20** modules
with correct override semantics (`FEATURE_CRM · Off · Revoked despite tier · Tier default: on — this
override survives a tier change`), suspend with a type-the-brand-name confirmation, reactivate, and
view 7 purged tenants. The module toggle is *enforced*, not cosmetic: after disabling CRM, the
sidebar entry disappeared and `/app/crm` showed `Access denied` on both an existing session and a
brand-new login.
What is missing is everything else a platform operator needs. `/platform/users`, `/platform/health`,
`/platform/billing`, `/platform/plans`, `/platform/usage`, `/platform/audit`,
`/platform/impersonate`, `/platform/tenants/{id}/users`, `/platform/tenants/{id}/audit` → all 404
or bounce to login. The operator account has no profile page and no avatar menu — the entire chrome
is `["RestaurantOS","Overview","Tenants","Sign out","Create tenant"]`. **The SuperAdmin signs in
with a password and no TOTP** (`landed straight on /platform/dashboard — no TOTP step was
presented`) while a tenant *accountant* is forced through TOTP — the most privileged account in the
platform is the least protected. The tenant list has `textInputs: []`, `selects: []`,
`pagination: false` — at 20 rows it is already unusable, and there is no support tooling: no
impersonation, no per-tenant audit, no health. Two entitlements are honest about being fake:
`Users — Not metered — auth-service exposes no per-tenant user count` and `Storage — Not metered —
no producer records storage usage`. You cannot bill on this.

### 4.4 "An admin cannot build a role from permissions"
**Correct. VERDICT: MISSING.**
`/app/roles` and `/app/settings/roles` → `404 This page doesn't exist`. The only role surface is
`Users → [pick a user] → Assign role`, a 448×297 dialog with exactly **two selects and zero
checkboxes**: a branch list and a fixed role list `[Accountant, Cashier, Inventory Manager, Kitchen
Staff, Manager, Owner, Tenant Admin, Waiter]`. There is no permission picker, no role creation, no
role cloning, no per-role permission view — nowhere in the product can anyone see what a role
actually grants. `FEATURE_CUSTOM_ROLES` is one of the 20 platform module toggles and switching it on
changes nothing, because no screen consumes it.
Two further findings inside this area. First, **a role cannot be revoked**: after assigning CASHIER
on the Rooftop branch the panel shows `Roles by branch … Floating Terrace — Rooftop No approval
authority CASHIER` and the probe for revoke controls returned
`{buttonsInsideRolesBlock: [], anyRevokeText: false}`. You can grant forever and never take back.
Second, the server-side half is genuinely well built and I could not break it: TENANT_ADMIN granting
OWNER over the API → `403 ROLE_CEILING_EXCEEDED: You cannot assign the role OWNER: it grants 1
permission(s) you do not hold yourself`; CASHIER self-granting OWNER → `403 PERMISSION_DENIED`;
OWNER/MANAGER/TENANT_ADMIN reaching the platform API → `403`; cross-tenant user and branch reads →
`404`. 14 of 14 privilege-boundary probes refused correctly.

### 4.5 "Branch management and per-branch staff"
**Half right. VERDICT: branch management MISSING; per-branch staff PARTIAL.**
There is **no branch management screen at all**. `/app/branches`, `/app/settings/branches`,
`/app/branch`, `/app/locations`, `/app/admin/branches` → `This page doesn't exist`, probed as both
OWNER and TENANT_ADMIN. A tenant cannot add its second branch, rename one, mark one inactive, or
even list them. `/app/settings` edits the *current* branch only, and even that is broken in a way
that will look insane to a user: saving the address `12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad`
returns `409 CONFLICT — "This conflicts with existing data"`, saving `Islamabad` also returns `409`,
and saving `"12 Khayaban-e-Iqbal"` **with literal quote marks typed by the user** returns `200` and
persists. The field only accepts input that happens to be valid JSON.
Per-branch staff assignment does work: `Assign a role to bartender.proof@terrace.local … A user
holds one role per branch` → `POST {branchId, roleCode:"CASHIER"} → 200` → after reload
`Roles by branch: Floating Terrace HQ primary KITCHEN_STAFF · Floating Terrace — Rooftop CASHIER`.
But the branch switcher is a lie about state: switching to `Floating Terrace — Rooftop` changes the
label, and **after a reload the label is back to `Floating Terrace HQ`** — and the JWT branch claim
never changed at either point. A manager who switches branch, refreshes, and keeps working is
looking at the wrong branch's data with no indication.

### 4.6 "Tax configuration"
**Correct, and there is a silent data-loss bug on top. VERDICT: MISSING.**
Owner sidebar has 31 entries and `hrefs matching tax/fiscal: []`. `/app/settings` shows
`Sales tax registration (STRN) — Not set` and `National tax number (NTN) — Not set` with the app's
own admission printed on screen: *"Read-only here. The branch update API has no field for either, so
an editable box would accept your change and discard it."* The menu-item create and edit dialogs
have five fields and none is tax. Measured in the databases: `menu_items` = 6 items at 16.00%, 5 at
0.00%, `taxRateCode` **null on all 11**; `pos_db` = 195 orders, **zero** with a non-zero
`service_charge_paisa`; `purchasing` = 28 vendor invoices of which 8 carry input tax that was
seeded, because the Book Invoice dialog (`672×260`, `[Purchase order, Invoice number, Invoice
date]`) has no input-tax field.
The data-loss bug, replicated deliberately and then restored: an item seeded with
`taxRatePct=17.0, taxRateCode='SR-STD-17'` was edited through the UI changing **only the
description**. The PUT body is `{categoryId, name, description, basePricePaisa, imageFileId}` — no
tax keys — and afterwards `taxRatePct=17.0` survived (null-guarded) while **`taxRateCode` became
`None`**. Fixing a typo in a description silently destroys the item's fiscal classification.
Two things do work and should not be rebuilt: the payroll income-tax band editor at
`/app/hr/settings/tax` (with a correct refusal — *"Payroll cannot run yet. FY2027 has no tax table
in force… a wrong payslip is worse than a refused run"*), and the FBR Tax Summary at
`/app/reports/fbr`, which computes `Output tax: Rs 3,703.60` vs `Input tax: Rs 4,565.00` and
correctly labels itself *"internal bookkeeping figures, not an FBR/IRIS e-filing submission."*

### 4.7 "Order-first vs payment-first, and dine-in / take-away"
**Correct. VERDICT: PARTIAL — both flows work, neither can be chosen.**
Both are hard-wired side by side on every terminal for every user: the order panel is exactly
`[Send to Kitchen, Save as Draft, Charge Now]`. Order-first was driven (cart → `ORD-20260812-0008` →
`SENT_TO_KDS`) and payment-first was driven (cart → `Charge Now` → `/charge` → CASH Rs 50.00 + CARD
Rs 42.80 → the item then showed `Sent`, i.e. persist-then-pay-then-fire). Nothing lets a tenant pick
one. A waiter can charge a dine-in table mid-service and a counter cashier can fire unpaid food, and
neither is prevented.
The cruel detail: the *configuration for this already exists and is ignored*. `PosTerminal` carries
`serviceModel: "COUNTER" | "TABLE_SERVICE" | "SELF_SERVE"` and `defaultOrderType`, both settable in
the Add-terminal dialog and rendered on the terminal list — and no POS component reads a terminal.
Order types: the radiogroup offers exactly `["Dine-in","Takeaway","Pickup"]`. DELIVERY is excluded
on purpose (`order-type-toggle.tsx:12-19`) and there is no delivery data model at all
(`grep deliveryAddress|deliveryZone|deliveryCharge|driverId` → 0 hits). The three options are a
frozen module-level `const` — a dine-in-only restaurant cannot hide Takeaway and Pickup.
Worst of all, **the order type is fabricated on the order list**: `order-management.tsx:186` renders
`{o.tableName ?? "Takeaway"}`, and the list projection carries no `type` field. `ORD-20260812-0026`
is `DINE_IN` on the detail endpoint and reads `Takeaway` in the list; 10 of 11 rows read "Takeaway"
and every one of them is DINE_IN. Every decision and every report made off that screen is wrong.

### 4.8 "Printer selection in settings, and printing without a browser dialog"
**Correct on both halves. VERDICT: MISSING.**
`/app/settings/printers` → `404 This page doesn't exist` for cashier, manager, admin **and owner**.
So do `/app/settings/printing`, `/app/settings/receipt`, `/app/settings/devices`, `/app/settings/
hardware`, `/app/pos/printers`, `/app/printers`. `nav mentions printer? false` for every persona,
and the `/app/settings` body does not contain the word "printer" for any of them.
Printing is the browser dialog and nothing else: opening a receipt fired
`window.print() AUTO-call count = 1`, clicking the on-page `Print` took it to 2, and the receipt
footer states `No printer configured for this branch - browser bill`.
**The configuration already exists in the data and no screen shows it.** The branch record returned
by `PUT /api/v1/branches/{id}` contains
`receiptConfig: {"fbr": null, "agent": {"lanUrl": null, "baseUrl": "http://127.0.0.1:7654"}, "footer": null, "header": null, "printers": [{"id": "kitchen-main", "cut": "F…`
— a printer array and a local print-agent URL. Across every driven run the browser made **zero**
requests to `:7654`. A `POST /orders/{id}/print-jobs` endpoint is called and produces no physical
output. There is no kitchen-ticket reprint anywhere — no KOT reprint control in the terminal, the
order drawer or Order Management — which is the single most common recovery action in a service.
Receipt reprint does exist and is tracked (`*** REPRINT #4 ***`), but the only route to it is
Order Management → Open → a button labelled **CHARGE NOW** → "Print bill", on an order that is
already paid.

### 4.9 "CRM: loyalty, subscriptions, rewards, POS customer lookup, QR registration"
**Mostly correct. VERDICT: lookup WORKS; everything else MISSING.**
What works, driven end to end: `/app/pos → Add customer → "Phone or name…" → typed "03" →
"Diag Loyalty 24573 / 03009824573 / 0 pts"` → attached, with a BRONZE tier badge and a Remove
action; inline enrolment of a new phone number is present and permission-gated; the order carries
`customerId=3a4ee2e0-…` on the wire. Points accrue on settlement: after paying Rs 1,682.00 the CRM
page read `Recheck Loyalty 9142 · 03007549142 · BRONZE · 1682 pts · Rs 1,682.00`.
What does not exist: `/app/crm/loyalty`, `/app/crm/rewards`, `/app/crm/promotions`,
`/app/crm/campaigns`, `/app/crm/segments`, `/app/crm/feedback`, `/app/loyalty`, `/app/promotions`,
`/app/marketing`, `/app/settings/loyalty`, `/app/settings/promotions`, `/app/subscriptions`,
`/app/settings/subscription` — **all 404 as OWNER**. So: points accrue and can never be spent; tiers
exist as a badge with no configurable thresholds and no benefits; there is no reward catalogue, no
redemption at the till, no voucher issuance, no campaign, no segment, no customer subscription or
meal-plan model, and no feedback capture. Promotions are API-only —
`POST /api/v1/pos/orders/{id}/promotions/apply` exists (`OrderController.java:85`) and a grep across
`frontend/lib`, `frontend/components` and `frontend/app` for `promotions/apply` or `applyPromotion`
returns **zero** hits. **QR registration does not exist in any form**: `grep qrCode|qr_code` across
`pos-service` → 0 hits; there is no QR menu route, no per-table QR, no guest ordering surface.
Also: the customer's history never reaches the till — no repeat-last-order, and order search matches
only order number and table (searching a seeded customer's phone `0300…` returned 0 rows).

### 4.10 "NLQ needs a proper UI with graphs, provider/model settings, and tenant isolation"
**Correct on the UI and the settings. VERDICT: PARTIAL, effectively unusable.**
`/app/nlq` renders cleanly — *"Ask about your restaurant's data in plain English — see the answer,
and the exact SQL that ran to produce it"* — with three suggested questions. Asking
`What was total revenue last week?`, `How many orders did we take yesterday?` and `Show me the top 5
selling items this month` all produced the same outcome: `tableCount = 0`, `charts = 0`, and the
alert *"That question couldn't be answered — Something prevented us from answering that question
safely."* Three for three. The page's own promise of showing the SQL never got the chance to fire.
**There are no graphs anywhere in the product**, not just in NLQ: `trendChart = 0` on `/app/nlq`,
`/app/reports`, all 8 report detail pages, `/app/dashboard`, `/app/dashboard/realtime` and
`/app/purchasing/analytics`. (The `chartMarks: 19` reading is constant on every page — it is the
sidebar icon set, not a chart.) There are also **no export controls anywhere**: `exportButtons: []`
on all 8 reports.
**No provider/model settings exist**: `/app/settings/ai`, `/app/settings/nlq`,
`/app/settings/ai-provider`, `/app/settings/analytics`, `/app/settings/integrations`,
`/app/nlq/settings` → 404. There is no way for a tenant or the platform to choose a model, set a
key, cap spend, or see what was asked.
On tenant isolation I found no leak and I tried: Control Bistro's token against Floating Terrace's
branch → `403 Cannot access resources for a different branch`; Floating Terrace's token against
Control Bistro's menu → `403 Cannot access menu pricing for a different branch`; cross-tenant user,
branch and menu-item writes → `404`, DB unchanged. The NLQ quota meter reads `0 / 50,000 queries`,
which is consistent with NLQ never having answered anything.

### 4.11 "Validation should happen at the UI layer"
**Correct, and it is absent by pattern, not by oversight. VERDICT: MISSING.**
Three representative dialogs were driven with deliberately bad input — Menu item `Price = -100`,
Vendor `Email = not-an-email`, Expense `Amount = -9999`. In all three, at every stage:
`onOpen {n:0, ariaInvalid:0, submitDisabled:false}` → `whileTyping {n:0, ariaInvalid:0}` →
`afterBlur {n:0, ariaInvalid:0}`. Nothing is validated as you type, nothing on blur, and the submit
button is never disabled. Errors appear only **after** a failed submit
(`afterSubmit: ["Name is required","Enter a price"]`), and then do not clear when you fix the field
(`afterFixNoBlur` still shows `["Name is required"]`). Note what is *not* in that error list: the
negative price and the malformed email were never objected to at all.
Two related cross-cutting defects in the same family:
- **Silent truncation of lists.** `/api/v1/purchasing/vendors` returns `rows:20 total:29 next:"1"`
  and the Vendors page renders **no pager** — 9 vendors simply do not exist as far as the user is
  concerned. `/api/v1/finance/journal-entries` returns `rows:50 total:209` and the page renders
  **no pager** — 159 journal entries unreachable. This is the identical bug already fixed once in
  the KDS ("the board silently showed 20 of 29 tickets", commit `1c84c58`), still live elsewhere.
- **Dialogs clipped on a small phone.** At iPhone SE (375×667) the ingredient dialog measures 691px
  tall against a 667px viewport: `clipTop: 12, clipBottom: 12`, and the close button is
  `fullyVisible: false`. Fields are reachable by inner scroll, but the dialog is cut at both ends.

### 4.12 "Was the app ever verified the way a real user would use it?"
**No — and that is the root cause of the 3/10, not a side effect of it.**
Concrete proof from this audit:
- `services/pos-service/src/test/java/io/restaurantos/pos/VoidOwnOrderIT.java` asserts *"a cashier
  can void their own OPEN order"* and is **green**. In the browser, a cashier with
  `pos.order.void.own` in their live JWT clicks Confirm Void and gets `403 Not permitted: pos.void`
  plus an inline *"You don't have permission to void this order."* The test's own docblock
  pre-emptively dismisses this live 403 as "cosmetic" and blames "JWT staleness" — disproved
  directly: the token was minted seconds earlier in a fresh context and carries the grant.
- Phase 28 plans `28-08`, `28-10`, `28-12`, `28-13` and `28-14` have `PLAN.md` files and **no
  `SUMMARY.md`** — they were never executed. `28-14` was the browser proof of the station→KDS→
  terminal chain, and the gaps found in §4.1 are precisely those five plans.
- The `useApplyDiscount` hook, the `applyDiscount` repository method and the
  `pos.order.discount.line` permission all exist and ship together with **zero UI callers**.
- Six of sixteen services are down right now and nothing in the product tells a user why the till is
  blank; a `503` on Send to Kitchen surfaces **no toast, no banner, no `[role=alert]`** because
  `useCreateOrder` has an `onSuccess` and no `onError`, and `handleSendToKitchen` wraps the call in
  `try/finally` with no `catch` — while the two sibling handlers do catch and toast.

The one thing that has been verified as a real user would use it is this audit, and it is what
produced this document.

---

## 5. THE FULL GAP LIST, SEVERITY-RANKED

Severity bands: **S0** money integrity or data loss · **S1** a restaurant cannot run a shift ·
**S2** a restaurant cannot sell what it sells · **S3** an owner cannot manage or configure ·
**S4** competitive parity.
Effort: S ≤1 day · M ≤1 week · L ≤3 weeks · XL >3 weeks.

### S0 — Money integrity and data loss

| # | Module | Capability | Verdict | Evidence | User impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|
| 1 | POS | Void must be blocked on a settled check; refund must be the only path | **MISSING** | `POST /pos/orders/f47df816-…/void → HTTP 200 {"status":"VOIDED","totalPaisa":168200}` driven in Chromium as manager on an order showing `Paid`; `GET /orders/{id}/payments` still returns `{method:CASH, amountPaisa:168200}`. Refund is gated on `order.status === 'CLOSED'` (`void-refund-dialog.tsx:61`), which paid orders rarely reach | A manager takes Rs 1,682 cash, voids the order in three clicks with a free-text reason, and both the order and the money disappear from every operator screen while the payment row survives in the database | M | — |
| 2 | POS / Finance | A voided order must stay findable | **MISSING** | `ORD-20260812-0026` appears in **none** of the 7 Order Management filters (All, Draft, In Progress, Partially Served, Served, Closed, Paid) and searching `0026` returns `No active orders` — while its Rs 100.00 CASH payment row persists | There is no screen in the product on which an owner can see that a paid order was voided | S | #1 |
| 3 | Finance | Cash taken against an open order must reach Takings | **MISSING** | Controlled before/after: baseline `/app/finance/takings` GROSS Rs 17,949.00 / NET Rs 19,791.00 / cash 12 payments / "10 orders closed". Recorded Rs 77.00 CASH on a new order. **Every figure identical.** Takings counts closed orders only | The day's reconciliation screen does not contain the day's cash. A shortfall is invisible until someone counts the drawer, and nothing tells them what it should be | M | — |
| 4 | Menu / Tax | Editing an item wipes its tax code | **CONFIRMED BUG** | Seeded `taxRatePct=17.0, taxRateCode='SR-STD-17'`; UI edit of the **description only** sends `{categoryId,name,description,basePricePaisa,imageFileId}`; after: `taxRateCode = None` | Correcting a typo silently destroys the item's fiscal classification, and nothing on screen says so | S | — |
| 5 | POS | Order lifecycle never reaches a terminal state | **PARTIAL** | `ORD-20260812-0011` sat at `SENT_TO_KDS` / `PAID` for over an hour showing `In Progress / Paid`, drawer still offering `Charge order` **and** `Void order`. Closure needs items separately Marked Served, which nothing prompts | The normal end state of a paid order is an open, voidable ticket — which is what makes gap #1 exploitable at scale | M | #1 |
| 6 | POS | Send to Kitchen fails silently | **PARTIAL** | Observed `503 POST /api/v1/pos/orders` with an unhandled `ApiError`; cart stayed full, button stayed enabled, **no toast, banner or `[role=alert]`**. `useCreateOrder` has `onSuccess` and no `onError`; `handleSendToKitchen` is `try/finally` with no `catch` | The cashier reads a still-full cart as "the tap didn't register" and presses again — the kitchen gets nothing, or gets it twice | S | — |
| 7 | POS | Offline downgrades a fired order to a draft | **PARTIAL** | Offline `Send to Kitchen` → the order later landed as `ORD-20260812-0030` with status **DRAFT**, not SENT. Panel showed `Subtotal Rs 0.00 / Total Rs 0.00` for a real Rs 499 order; connection dot still read a green `Live`; reload while offline → `net::ERR_INTERNET_DISCONNECTED`, empty body | When the line drops the cashier believes food was sent, the kitchen never sees it, the bill reads zero, and a refresh gives a blank white till | L | — |
| 8 | POS | "Full Menu" from a parked order silently abandons it | **PARTIAL** | Clicked `Full Menu →` on the drawer for `ORD-20260812-0019`; landed on a terminal with **no order number and an empty cart**, "Add items to start an order". `onFullMenu` passes only a `tableId`; `PosTerminal` accepts no `orderId` | A cashier recalling a parked bill loses it and rings the guest a second time — two checks, one party | M | — |

### S1 — A restaurant cannot run a shift

| # | Module | Capability | Verdict | Evidence | User impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|
| 9 | Reliability | All services running and visibly healthy | **BROKEN** | Live now: `pos-service`, `kitchen-service`, `crm-service`, `hr-service`, `file-service`, `notification-service` absent from `ps`; a signed-in manager gets `503 {"code":"SERVICE_UNAVAILABLE"}` on `/pos/menu/items`, `/pos/orders`, `/kitchen/kds/stations`, `/crm/customers`, `/hr/employees` | The till, the kitchen screen, the customer file and payroll are all simply gone, and the product's only explanation is a generic error | M | — |
| 10 | KDS | Route items to a station from a screen | **API_ONLY** | Endpoints exist (`MenuController.java:108,130`); `/app/menu/routing`, `/app/menu/stations`, `/app/settings/stations` → 404 as OWNER; all 9 items return `effectiveStationCode:null`; a mixed check produced ONE `DEFAULT` ticket while `/app/kitchen/BAR` had 0 cards | The bar never receives a drink order; every beverage on a mixed check is lost to the person who makes it | M | — |
| 11 | KDS | The board must show started work | **PARTIAL** | `station-board.tsx` flattens all columns in order, then slices into pages of 16. Walked all pages: page 1/3 = `NEW n=16, STARTED 0, PREPARING 0, READY 0`; page 2/3 = `NEW 12, STARTED 4`; page 3/3 = `STARTED 1`. Positions are numbered only for the first ten of a page, so a PREPARING fragment on page 2 has `pos:""` and cannot be keyboard-bumped | A cook bumps a ticket and it vanishes onto a page behind them; the three progress columns in front of them are permanently empty whenever 16+ tickets are new | M | — |
| 12 | Menu / POS | The till must show the whole menu | **PARTIAL** | `ZZPAGE probes visible at the till: 10 of 15 created`; grid rendered ≈22 price labels against 26 items. `getMenuItems` sends only `{categoryId, branchId}` to a `Page<MenuItemDto>` endpoint; search filters client-side over what was already fetched | A restaurant with a 60-item menu can sell about 20 of them, and searching for one of the others returns nothing | S | — |
| 13 | Menu / KDS | 86 an item and have it disappear from the tills | **MISSING** | Owner deactivated `Butter Naan`; the cashier's open till still showed it at +5s, +10s and +20s with no reload, and only dropped it after a manual refresh. `grep eighty-six\|86'd\|eightySix` across the KDS components → 0 matches | The kitchen runs out, nobody can stop the tills selling it, and waiters keep ringing it one guest at a time all night | L | — |
| 14 | Printing | Configure a printer and print without a browser dialog | **MISSING** | `/app/settings/printers` → 404 for all four personas; `nav mentions printer? false`; receipt footer `No printer configured for this branch - browser bill`; `window.print()` count 2, agent calls to `:7654` = **0** — while the branch record already carries `receiptConfig.printers[]` and `agent.baseUrl: http://127.0.0.1:7654` | Every bill is a Ctrl-P dialog. No kitchen ticket prints at all, and a lost KOT cannot be reprinted | L | — |
| 15 | POS | Cash ergonomics: rupees, tendered, change due | **PARTIAL** | Amount input is `aria-label="Amount in paisa"`, `placeholder="Amount (paisa)"`; `Full amount` prefills the raw integer `9280` for a Rs 92.80 bill. No tendered field, no change due, no denomination keys — although the API already stores `tenderedPaisa` and `changePaisa` | To split a Rs 3,456.80 bill the cashier multiplies by 100 in their head and types `172840` on a touchscreen with a queue waiting; change is mental arithmetic | M | — |
| 16 | Branch | Branch switcher must survive a reload | **PARTIAL** | Switched to `Floating Terrace — Rooftop` (label changed); after reload the label read `Floating Terrace HQ`; the JWT branch claim never changed in either state | A manager works a whole shift on the wrong branch's data believing they switched | S | — |
| 17 | KDS | A station created by an admin should appear on the KDS | **PARTIAL** | `GET /kitchen/kds/stations` returns only `DEFAULT` and `GRILL` (`sourceStationId: null`) while `GET /pos/stations` returns `BAR`, `GRILL`, `DGB28334`. `upsertStation()` is called only from the ticket-routing path — a station becomes visible only when its first ticket arrives | An admin creates a bar station and the kitchen never offers it, which reads as the owner's configuration mistake rather than a product defect | M | #10 |
| 18 | KDS | An unknown station code renders a healthy empty board | **CONFIRMED BUG** | `/app/kitchen/NOPE123` → `h1 "NOPE123"`, `0 tickets`, connection badge **LIVE**, no error | A typo in a URL gives a plausible, healthy-looking kitchen display that can never show a ticket | S | — |

### S2 — A restaurant cannot sell what it sells

| # | Module | Capability | Verdict | Evidence | User impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|
| 19 | Menu / POS | Modifier groups (forced/optional, min/max, paid add-ons) | **CODE_ONLY** | `find -iname '*Modifier*'` in `pos-service/src/main` returns only `Modifier.java`, `ModifierGroup.java`, `OrderItemModifier.java`; `grep ModifierRepository\|ModifierService` → **none**; `MenuController` exposes only `/categories*` and `/items*`. Tapping a tile added the line instantly: `dialogs before=0 after=0` | A cashier cannot ring "extra cheese", "no onions", "medium spicy" or any paid add-on. The kitchen ticket, the price and the stock depletion are all wrong for any order a real guest places | XL | — |
| 20 | Menu / POS | Variants (Half/Full, S/M/L) with independent prices | **MISSING** | The live edit dialog offers exactly `[Category, Name, Description, Price (Rs), Picture]`; `MenuItem` has a single `basePricePaisa` and no variant collection | Half/Full — the default portioning of the entire target market — must be modelled as two unrelated items with duplicated recipes and split reporting | XL | #19 |
| 21 | POS | Item- and check-level discount with reason code and approval | **CODE_ONLY** | `POST /pos/orders/{id}/discounts` (`OrderController.java:92`), `pos.repository.ts:356`, `useApplyDiscount` (`use-orders.ts:186`), cashier JWT carries `pos.order.discount.line` — and `grep useApplyDiscount app components` returns **zero** consumers. Charge page shows `Discounts Rs 0.00` as a read-only line | Nobody in the product can give a discount. Every staff meal and goodwill gesture is handled by not ringing the item, which destroys the sales record and the stock depletion with it | M | — |
| 22 | Wastage | Comps as their own cost bucket | **MISSING** | One `discount_paisa` column; `DailyTakings.test.tsx:61` states a full comp appears in it as a discount equal to the subtotal, and "Splitting them would require a field POS does not capture" | The owner cannot see what was given away free, by whom, or why | M | #21 |
| 23 | POS | Split a check by seat, by item, by amount | **API_ONLY** | `POST /pos/orders/{id}/split` (`PaymentController.java:106`) takes `{totalPaisa, diners}` and returns equal shares — it creates no second check, moves no items, assigns no seats. Zero frontend callers; charge page probe `split:false`. `PosAuthorizationService.java:92` shows `pos.order.split_bill` is a dead policy rule | Three friends at one table cannot pay separately; the product cannot produce a second check under any circumstances | XL | — |
| 24 | Payments | Wallets, Raast/QR, tip, service charge | **MISSING** | Charge-page probe `{tip:false, wallet:false, qr:false, houseAccount:false, rounding:false}`; no JazzCash/Easypaisa/Raast/SadaPay/NayaPay anywhere; `serviceChargePaisa` = 0 on all 195 orders | A guest who wants to pay by JazzCash or scan a Raast QR cannot. The restaurant cannot add a service charge or take a tip on card at all | XL | — |
| 25 | POS | Delivery orders (address, zone, charge, rider) | **MISSING** | `grep deliveryAddress\|delivery_address\|deliveryZone\|deliveryCharge\|driverId` across `pos-service/src/main` → **0 hits**; `order-type-toggle.tsx:12-19` excludes DELIVERY deliberately | A restaurant that delivers cannot take a delivery order at all | XL | — |
| 26 | Online | QR-at-table ordering and guest self-service | **MISSING** | `grep qrCode\|qr_code\|QrCode` in `pos-service` → 0 hits; no QR route, no per-table QR generation, no guest surface | Square ships this free in minutes; here it does not exist | XL | #25 |
| 27 | POS | Order type displayed truthfully on the order list | **MISSING** | `order-management.tsx:186` renders `{o.tableName ?? "Takeaway"}`; the list projection has no `type` field. `ORD-20260812-0026` is `DINE_IN` on detail and reads `Takeaway` in the list; 10 of 11 rows are mislabelled | A manager cannot tell dine-in from takeaway; every counter sale and every unseated dine-in order is silently relabelled | S | — |
| 28 | POS | Open-price item / misc charge line | **MISSING** | Full live button inventory of the terminal contains no open-price or misc control; `POST /orders/{id}/items` requires a `menuItemId`, so an arbitrary-price line has no wire representation | A corkage fee, a packaging charge, a one-off catering line — none can be sold | M | — |
| 29 | POS | Cover count and assigned server on a dine-in check | **MISSING** | `pos-terminal.tsx` `persistCart()` hardcodes `coverCount: 1`; no cover/guest/pax control exists; the SERVER/CASHIER column shows a raw UUID fragment (`eb2ee67e`). `owner-dashboard.tsx:93` sums `coverCount` for the owner's covers figure | Every per-cover number the owner sees is the order count wearing a different label; server-level sales, tips and void analysis are impossible | M | — |
| 30 | POS | Kitchen note taken *before* the ticket is fired | **PARTIAL** | Pre-send line controls are exactly `[Decrease, Increase, Remove]`; `+ Add note` and per-line `Edit note` appear only **after** Send to Kitchen | "No chilli" can only be added after the ticket is already on the pass | S | — |
| 31 | KDS | Course and seat assignment, fire-course-now | **MISSING** | `OrderItem` has no `seatNo` and no `courseNo`; no course control exists anywhere | Starters cannot be held back from mains; a fine-dining service cannot be paced at all | XL | #19 |
| 32 | Tables | Visual floor plan, merge, timers, server sections | **MISSING** | `table-floor-view.tsx:97` is `grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6`; `DiningTable` has `capacity` and `section` and no `posX/posY/shape`; 3 states only (`AVAILABLE/OCCUPIED/NEEDS_BUSSING`) | A manager cannot see the room. No table timers, no merge, no server sections, no rotation | L | — |
| 33 | Tables | Reservations and walk-in waitlist | **MISSING** | `grep -i reservation\|waitlist` across `frontend/components`, `frontend/app`, `frontend/lib` → 0 matches | A restaurant that takes bookings cannot use this product for its front desk | XL | #32 |
| 34 | POS | Takeaway token / queue number | **MISSING** | The only identifier issued is the daily invoice number (`ORD-20260812-0024`); no token, no customer display | A counter operation calls the next order by shouting an invoice number | M | #27 |
| 35 | POS | Merge two checks; transfer between servers | **MISSING/PARTIAL** | No merge route on `OrderController`. Table transfer works (`PATCH /orders/{id}/table`, inline "Assign Table" combobox); server transfer does not exist because orders carry no server | Two tables that join must be billed twice; a section cannot be handed over at shift change | L | #29 |

### S3 — An owner cannot manage or configure

| # | Module | Capability | Verdict | Evidence | User impact | Effort | Depends on |
|---|---|---|---|---|---|---|---|
| 36 | Branch | Create / edit / list / deactivate a branch | **MISSING** | 5 candidate routes → `This page doesn't exist` as OWNER and TENANT_ADMIN | A multi-branch tenant cannot add its second branch from the product | M | — |
| 37 | Branch | Branch address is unsavable unless typed as JSON | **CONFIRMED BUG** | `{"address":"12 Khayaban-e-Iqbal, F-7 Markaz, Islamabad"}` → `409 CONFLICT`; `{"address":"Islamabad"}` → `409`; `{"address":"\"12 Khayaban-e-Iqbal\""}` → `200`, persisted | The owner types their address, is told it "conflicts with existing data", and there is no correct input a human would guess | S | — |
| 38 | RBAC | Build a role from permissions | **MISSING** | `/app/roles`, `/app/settings/roles` → 404; assign dialog has 2 selects and `checkboxes: 0`; 8 fixed roles; `FEATURE_CUSTOM_ROLES` toggles nothing | Every restaurant's org chart must be forced into 8 fixed roles, and nobody can see what any role grants | L | — |
| 39 | RBAC | Revoke a role | **MISSING** | After assigning, `{buttonsInsideRolesBlock: [], anyRevokeText: false}` | A grant is permanent. A promoted, demoted or transferred employee keeps their old branch access | S | — |
| 40 | Tax | Configure sales tax, tax classes, per-item rates | **MISSING** | No tax route in a 31-entry owner sidebar; item dialogs have no tax field; `taxRateCode` null on all 11 items; `service_charge_paisa` non-zero on 0 of 195 orders | Tax rates can only be changed by a developer issuing SQL or HTTP by hand | L | #4 |
| 41 | Tenant | Any tenant-level settings API at all | **MISSING** | `/app/settings/page.tsx` header records that `/api/v1/tenant-profile`, `/tenants/{id}/settings`, `/tenants/{id}/theme`, `/api/v1/settings` and `/api/v1/onboarding` **all 404**. `/app/settings` renders branch details, a users link and an appearance link | There is no place to configure the restaurant — only the branch record. Appearance is stored in `localStorage` only: *"Stored in this browser only… colleagues and your other devices see the default"* | L | — |
| 42 | Onboarding | A first-run wizard | **MISSING** | `/app/onboarding`, `/app/setup`, `/app/welcome`, `/app/getting-started`, `/app/settings/business`, `/app/settings/company` → 404. A new tenant's owner lands on a dashboard reading `NET SALES Rs 0.00 · 0 orders in 30 days · GROSS MARGIN —` | Day one is a blank dashboard with 31 sidebar entries and no order of operations | L | #40, #36 |
| 43 | Auth | Losing an authenticator locks a tenant owner out permanently | **CONFIRMED BUG** | Tenant C: owner enrolled, device lost → login stalls at `Authenticator code`; the re-bootstrap call returns `400 VALIDATION_FAILED — tenantSlug must not be blank`. No SuperAdmin screen can reset it | The owner of a paying restaurant is locked out of their own business with no recovery path in the product | M | — |
| 44 | Platform | SuperAdmin has no MFA | **MISSING** | `landed straight on /platform/dashboard — no TOTP step was presented`, while a tenant accountant is forced through TOTP | One password compromises every restaurant on the platform | M | — |
| 45 | Platform | Platform operator management, health, billing, usage, audit, impersonation | **MISSING** | `/platform/users`, `/health`, `/billing`, `/plans`, `/usage`, `/audit`, `/impersonate`, `/tenants/{id}/users`, `/tenants/{id}/audit` → 404 or bounce. Chrome is `["Overview","Tenants","Sign out","Create tenant"]`. Users and Storage read `Not metered` | You cannot add a second platform operator, see whether the fleet is healthy, invoice anyone, or support a customer without a database client | XL | — |
| 46 | Platform | Tenant list does not scale | **PARTIAL** | `{textInputs: [], selects: [], pagination: false}` at 20 rows | At 100 tenants the console is a wall of text with no search | S | — |
| 47 | Users | User list truncates silently | **PARTIAL** | `/api/v1/users` returns `rows:25 total:29` — a pager exists here, but the same class of bug is unfixed on Vendors (`20/29`, no pager) and Journal Entries (`50/209`, no pager) | Records that exist are invisible, with nothing on screen to suggest more exist | S | — |
| 48 | Inventory | Wastage, valuation, transfers, counts, movements, expiry as screens | **MISSING** | No `page.tsx` for `/app/inventory/wastage`, `/valuation`, `/counts`, `/transfers`, `/movements`, `/expiry`; the stock page's dialogs (`Opening balance`, `Receipt`, `Count`, `Transfer`) are the only entry points | Food cost cannot be controlled: no valued waste, no theoretical-vs-actual variance, no stock value at a date | L | — |
| 49 | Reporting | Export any report | **MISSING** | `exportButtons: []` on all 8 reports and on the FBR summary | An accountant cannot get the numbers out of the product | S | — |
| 50 | Reporting | Any chart, anywhere | **MISSING** | `trendChart = 0` on every page probed including `/app/dashboard`, `/app/dashboard/realtime`, `/app/purchasing/analytics` and all 8 reports | The owner reads their business as tables of numbers | M | — |

### S4 — Competitive parity

| # | Module | Capability | Verdict | Evidence | Effort |
|---|---|---|---|---|---|
| 51 | CRM | Reward catalogue and point redemption | **MISSING** | `/app/crm/rewards`, `/app/crm/loyalty` → 404; points accrue and can never be spent | L |
| 52 | CRM | Promotions / coupons at the till | **API_ONLY** | `POST /pos/orders/{id}/promotions/apply` exists; `grep promotions/apply\|applyPromotion` across the whole frontend → 0 hits | M |
| 53 | CRM | Campaigns, segments, feedback, customer subscriptions | **MISSING** | `/app/crm/campaigns`, `/segments`, `/feedback`, `/app/marketing`, `/app/subscriptions` → 404 | XL |
| 54 | CRM | Order history and repeat-last-order at the till | **MISSING** | Customer panel shows phone, points and tier only; order search matches order number and table only (phone `0300…` → 0 rows) | M |
| 55 | KDS | All-day counts | **MISSING** | `grep all-day\|allDay` across the KDS components → 0 matches | M |
| 56 | KDS | Expo / pass screen | **MISSING** | `Expo (the pass) — Expo screen` is offered as a station **type**; `grep expo` across the KDS components → 0 matches; the only route is the generic `[stationCode]` board | L |
| 57 | KDS | Allergen flags and prep photos on the ticket | **MISSING** | `grep allergen` across the KDS components → 0 matches; the ticket detail renders order no, station, revision and item names only. (Allergens *do* exist on ingredients) | M |
| 58 | KDS | Prep-time metrics per station / hour / cook | **MISSING** | `grep prepTime\|cookTime` → 0 matches. `kds_stations.escalationThresholdSeconds = 900` exists in the data and the station dialog exposes only Code, Name, Type — the target cannot even be set | L |
| 59 | KDS | Priority flag for rider-waiting / VIP / SLA | **MISSING** | Ticket cards render sequence, order no, age, type, table and item lines only | M |
| 60 | KDS | Printer fallback when a screen dies | **MISSING** | `grep fallback.*print\|offline.*print` across `kitchen-service` and `pos-service` `src/main` → 0 matches | L |
| 61 | KDS | Keyboard bump past the first press | **PARTIAL** | Mouse path completes the full ladder (`Preparing` → `Ready`, verified over the API) and recall works; the advertised `F bump / R recall` legend cannot advance a ticket past its first bump because paged positions are only numbered for the first ten fragments | M |
| 62 | Menu | Channel price books, day-part menus, scheduling, versioning, bulk import | **MISSING** | `/app/menu/pricing`, `/app/menu/variants`, `/app/menu/modifiers` → 404; the item editor has 5 fields | XL |
| 63 | Menu | Menu engineering matrix (stars / dogs) | **MISSING** | Not present on any reports page; `Sales by Item` states `COGS and margin require…` | M |
| 64 | POS | Barcode entry and per-terminal quick-key layouts | **MISSING** | No barcode input and no configurable layout in the terminal's full button inventory | M |
| 65 | Purchasing | Landed cost, debit notes, vendor scorecards, price comparison | **UNVERIFIED / likely MISSING** | Vendors, catalog, suggestions, PO lifecycle, GRN, invoice match and payments were all driven; these four were not observed on any screen | L |
| 66 | Recipes | Sub-recipes and batch production | **UNVERIFIED** | Versioned recipes and plate cost work (`Batch cost Rs 1,130.06 · Food cost % 77.9%`); nesting was never driven | L |

---

## 6. WHAT IS GENUINELY GOOD — DO NOT REBUILD THIS

Each of these survived an adversarial second pass in a browser.

1. **HR and payroll — the strongest module in the product.** Employees CRUD with persistence across
   reload, clock in/out, leave request → approve, a weekly drag-assign roster that survives a
   reload, and a full payroll run: `Calculate → Approve → Pay`, ending at
   `8/2026 · PAID · gross Rs 270,000.00 · net Rs 267,420.00`, with payslips. The step-up is real and
   well worded: *"Verification expired — To approve this payroll run you need to sign in again with
   your authenticator code."* The income-tax band editor refuses to run payroll for a year with no
   table in force rather than guessing.
2. **Split multi-method tender.** CASH Rs 50.00 + CARD Rs 42.80 on one Rs 92.80 bill →
   `Tender total Rs 92.80` → `Remaining balance Rs 0.00` → badge flips to `Paid` → further tenders
   correctly refused with *"This order is fully paid — no further tenders can be recorded."* The
   earlier report's headline "take cash — and that is the entire till" is wrong and would send
   someone to rebuild working code.
3. **Live KDS delivery.** A ticket fired at the POS appeared on an un-reloaded board in a second tab
   at age `00:18`, twice, over a real WebSocket with a `LIVE` badge. Latency is at parity with Toast.
4. **Station scoping is enforced server-side.** A GRILL-scoped account typing `/app/kitchen/DEFAULT`
   directly got 0 tickets and the badge dropped `LIVE → POLLING` — the server refused both the REST
   fetch and the subscription (`KdsController.java:222`). This is not UI hiding.
5. **The platform tenant lifecycle.** Create → tier change with a truthful summary of the 9 modules
   it moved → 20 module toggles with correct tier-vs-override semantics → suspend → reactivate,
   every step persisting a reload, with confirmation dialogs that state consequences honestly
   (*"Every user of Floating Terrace loses access to this module immediately… Nothing is deleted"*).
6. **Privilege and tenant boundaries.** 14 of 14 escalation and cross-tenant probes refused
   correctly, including `ROLE_CEILING_EXCEEDED` on granting a role you do not fully hold yourself,
   and `403 Cannot access menu pricing for a different branch` in both directions between tenants.
7. **Recipes and plate costing.** Versioned recipes with an active-since date, per-ingredient share
   of plate cost, `Food cost % 77.9%`, and a Coverage screen framed as a worklist
   (`10 Total · 2 Covered · 8 No Recipe`).
8. **Purchasing.** Vendors with catalog and price lists, auto order suggestions, the full PO
   lifecycle through approve/send/receive/close, partial GRN, invoices reaching `MATCHED` /
   `MISMATCHED` / `PAID`, and payments.
9. **Finance double entry.** A posted JE reads `1010 CASH payment Rs 290.00 / 4100 Sales revenue
   Rs 250.00 / 2200 Output tax Rs 40.00` and reverses at `201`. Periods, GL, AP/AR aging, expenses
   with approval limits and house accounts all render.
10. **Park and recall (the drawer path), customer lookup and attach, table transfer, menu image
    upload, receipt reprint with a `*** REPRINT #n ***` stamp, user provisioning with temp passwords
    and a `401` on a deactivated account.** All driven, all persisted.
11. **The writing.** Empty states, refusals and confirmations across this product are unusually
    honest and well-phrased — *"an editable box would accept your change and discard it"*,
    *"a wrong payslip is worse than a refused run"*. Whoever wrote them should keep writing them.

---

## 7. WHERE THIS DIAGNOSIS IS WEAK

Stated plainly, because a gap register that overstates its own certainty is how the 3/10 happened.

1. **Six services are down as this is written, so nothing in POS, KDS, CRM, HR or file storage could
   be re-verified at compile time.** All POS/KDS/CRM/HR verdicts here are from earlier runs against
   a `checked=16 stale=0` stack. They were true then; they are not re-checkable right now.
2. **The environment mutated under the probes.** It is a shared tree with ~10 agents: KDS tickets
   went from 16 to 0 between two runs (API-confirmed, not a UI error), sessions expired mid-script,
   the gateway returned `429 Too Many Requests` on ordinary navigation twice, and a manager login
   failed in the browser while the same credentials succeeded against the gateway seconds later.
   Some measurements are therefore single-observation.
3. **The inventory/purchasing manager sweep died of session expiry part-way through.** Every route
   from `/app/inventory/stock` onward in that transcript shows the login page, not the product.
   Those routes were later covered by the red-team screenshots, but the *sweep* data for
   `stock`, `setup`, all of `purchasing`, `wastage`, `transfers`, `counts`, `valuation` and
   `goods-receipt` is invalid and was not used for any verdict here.
4. **Purchasing depth was not probed.** Landed cost, debit notes, vendor scorecards, three-way-match
   *exception handling* and side-by-side price comparison are listed as UNVERIFIED, not MISSING.
5. **Recipe nesting (sub-recipes and batch production) was never driven.** Single-level recipes and
   plate cost were.
6. **HR was verified from screenshots and a red-team pass, not from a transcript.** No `.txt`/`.json`
   evidence files exist for `hr-payroll/` or `hr-payroll-redteam/` — 60 screenshots only. The payroll
   verdict rests on reading those images. Also unverified: whether `net Rs 267,420.00` on
   `gross Rs 270,000.00` is a correct Pakistani income-tax computation. It looks low.
7. **Double-seating was set up and never completed.** The table combobox offers already-OCCUPIED
   tables as selectable for a new order (`["No table (optional)","G1Occupied","H1Available",
   "T1Occupied",…]`). The test to send a second order to an occupied table timed out and was not
   re-run. **No verdict is claimed.**
8. **The stranded-cash finding was checked on three surfaces only** — Order Management (all 7
   filters plus search), Till Review, and Finance Takings. The Transaction Register, the reporting
   service exports and the audit log were not checked. The claim is "invisible on the three screens
   an operator would look at", not "invisible everywhere".
9. **Bump/recall reached PARTIAL rather than a clean verdict.** The mouse path was driven and
   verified over the API; the keyboard path's failure mode is diagnosed from
   `station-board.tsx` plus a `pos:""` observation, and was not exhaustively driven at every
   pagination boundary.
10. **The bartender fix was proved by inference, not by a final drive.** Routing Drinks→BAR made the
    BAR station appear on the KDS index and a bar ticket render — but `kitchen-service` and
    `pos-service` went down before the bartender's own scoped screen could be re-checked with BAR
    live. Near-certain, not driven.
11. **The reference module model supplied to this compilation was truncated** mid-way through
    "Payments & Tender Types". Modules 10–24 of the scorecard are reconstructed from the 15 probed
    domains and the owner's stated complaints, not from the canonical list. If the canonical model
    names modules nobody probed — for example gift cards, multi-currency, franchise/consolidated
    reporting, or aggregator integrations beyond what is listed here — **those are unmeasured and
    absent from this register**, and absence from this document is not evidence they exist.
12. **Two probe reports fed into this were themselves truncated in transit** (the POS report cut off
    inside the discount finding). Where the red-team pass and the original disagreed, the measured
    red-team observation was used.
13. **Nothing here measures load, concurrency or data volume.** Every observation is a single
    operator on a seeded tenant with 195 orders and 11 menu items. The truncation defects found
    (20-of-29, 50-of-209, 10-of-15) all surfaced at trivially small scale, which suggests more of
    the same waits at real scale — but that is an inference, not a measurement.

---

*No production code was modified in producing this register. New files were confined to
`frontend/e2e/diag/` and `.planning/audits/diagnosis/`. Test data created during the audit — orders
`ORD-20260812-0008` through `-0032`, several voided, a handful of test payments, one uploaded menu
image, and a number of probe users, vendors, ingredients and tenants — is re-seedable via
`scripts/seed_restaurantos.py`.*
