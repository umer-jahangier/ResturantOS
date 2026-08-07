# ResturantOS — Consolidated Defect Register

**Produced** 2026-08-07 · branch `phase-13-access-repair`
**Sources** 9 independent audits (7 of them driven live through a real browser against the running
stack), 168 raw findings, deduplicated to **103 unique defects**.
**Phase numbering** is `.planning/research/adaptivity/ROADMAP-14-PLUS.md` (phases 14–38). Nothing
here invents a parallel scheme. Where a defect forces a phase to change scope, §5 says so explicitly.

Raw sources, all read in full:

| Audit | File | Raw findings |
|---|---|---:|
| API ↔ UI parity, all 16 services | `api-ui-parity.md` | 29 |
| Owner / Tenant-Admin browser walkthrough | `browser-owner.md` | 18 |
| Back office (inventory/purchasing/finance/HR) browser sweep | `browser-back-office.md` | 18 |
| CRUD completeness, 30 entities × 7 layers | `crud-completeness.md` | 20 |
| Interaction quality / UX | `ux-defects.md` | 26 |
| Role visibility, 8 personas | `role-visibility.md` | 17 |
| Tenant onboarding, end to end | `onboarding-gap.md` | 20 |
| SuperAdmin platform console | `superadmin-console.md` | 10 |
| FBR optionality + tax-authority abstraction | `fbr-optional.md` | 10 |
| | **Total** | **168** |

---

## 1. The honest state of the app

The user's verdict was "literally crap". The measurements below say the verdict is **directionally
correct and specifically wrong about the cause**. The engine is real. What is missing is everything
a human uses to reach it.

### 1.1 The number that matters

**Of 264 public API endpoints, 80 (30%) have no caller anywhere in application code.** Not "no
tests" — no caller. Fourteen entire controllers have zero application-code callers; several of them
are exercised *only* by Playwright specs, which is exactly why the test suite is green while the
product cannot reach the feature.

Traced independently through all seven layers (migration → JPA → service → controller → gateway
route → frontend repository → UI screen), **10 of 30 domain entities are complete at every layer.**
Seventeen have at least one layer entirely absent. Six have a fully built, live-`200` backend that
no screen in the product can reach. Nine have a database table and a JPA entity with **no controller
at all** — `ModifierGroup` has a table and an entity and literally nothing above them: no repository,
no service, no controller, no UI.

### 1.2 What an owner actually gets

The OWNER of a restaurant holds **66 permissions** and sees **19 navigation items** — a 29% ratio.
The single permission separating OWNER from TENANT_ADMIN (`rbac.manage`) maps to exactly one nav
entry, which is hidden. **An owner's extra authority buys them nothing in the UI.**

The `SETTINGS` section of the sidebar, for both OWNER and TENANT_ADMIN, contains **one item:
Appearance.** That one screen writes to `localStorage`, issues **zero network requests**, displays a
success message, and then fails to rehydrate its own value on reload — the user watches the setting
vanish. `/app/settings`, `/app/settings/users`, `/settings/profile`, `/app/profile`, `/app/users` and
`/app/reporting` all return **HTTP 404** for both personas.

The four things the user named are four *different* failure modes, and naming them precisely is the
whole point of this document:

| What the user said | What is actually true |
|---|---|
| "no user-management UI" | **The backend is complete and proven.** I ran the whole lifecycle live: `GET /api/v1/users` → 200 (17 users), `POST` → 201, `PATCH` → 200, `POST /deactivate` → 200. TENANT_ADMIN also gets 200, so it is not a permission problem. The frontend has **zero** consumers — no hook, no schema, no repository, no page. Every account on the system exists because a Python seed script made it. |
| "no way to add tables" | **Neither half exists.** `TableController` has `GET`, `PATCH /{id}` (status only) and `GET /{id}/active-order`. There is no `POST` — `POST /api/v1/pos/tables` returns **405**. `TableService` has no create method. The `dining_tables` table is fully modelled in `V1__pos_schema.sql:115-129` including `floor_plan_x/y/shape`. Tables can only enter the system by SQL. |
| "no menu-item image upload" | **Nothing exists on the menu side; the uploader is complete and unused.** `MenuItem.java:19-51` has no image column, no DTO field, no schema field. The live Add-item dialog has 4 fields and `input[type=file]` count **0**. Meanwhile `FileController` implements multipart upload with MinIO and quota enforcement — and `grep "api/v1/files" frontend/{app,components,lib}` returns **0 hits**. There are **zero file inputs in the entire product**. |
| "dead settings and profile pages" | **The pages were never built and the fix applied was to delete the links.** `top-bar.tsx:205-209` says so in source. `sidebar-nav-items.ts` marks `/app/settings` and `/app/settings/users` `comingSoon: true`, and `use-nav-visibility.ts:51` **hides** rather than disables — so an owner does not see a broken Settings section, they see no Settings section. |

Add a fifth the user did not name but felt: **the top-bar ⌘K search is a hardcoded two-element
array** (`top-bar.tsx:95-98`). Typing a real seeded menu item ("Beef Nihari") and a real user email
both return "No results found" with **zero network requests**. Even the word "menu" — a real sidebar
route — is unfindable. No global-search endpoint exists in any service either.

### 1.3 The defect most likely to be behind the verdict

**Eleven of fifteen list screens render the *empty* state when the request *fails*.** Forced HTTP 500
and forced `[]` produce byte-identical text: "No vendors yet", "No till sessions yet", "No accounts
found", "No journal entries", "No customers found". Root cause is one line, two ways —
`JournalEntryTable.tsx:37` (`if (isError || !data?.data.length)`) and `vendors/page.tsx:12` (never
destructures `isError`, so `data ?? []` collapses failure into emptiness).

Compounding it: **a single `503` on `/api/v1/feature-flags` silently deletes 8 of 11 navigation items
with no banner and no toast** (`use-nav-visibility.ts:29` — `if (isPending) return false;`). A
MANAGER's sidebar collapsed to Dashboard / Reports / Realtime while POS, Kitchen, Inventory, Menu,
Purchasing and Customers vanished. Re-login once the endpoint returned 200 restored all eight.

**That combination is the app telling the user their business has no data and no features. It is the
single largest contributor to "the app is empty", and it is roughly 3.5 developer-days to fix.**

### 1.4 The SuperAdmin plane does not exist

`frontend/app/(platform)/` is **two files, 23 lines**: a header-only layout and a 9-line placeholder.
Fourteen SuperAdmin endpoints shipped and **zero** have a UI. Rendered markup of the only route that
resolves is one sentence with 0 anchors and 0 `<nav>` elements — a SuperAdmin who lands there has no
navigation out. Worse, usage-against-entitlement is not a missing screen: `usage_records` has **0
rows**, there are **0 producers** anywhere in the fleet, there is no read endpoint (`GET .../usage` →
404), the recorder returns a row count where a summed quantity is meant, the correct aggregate is
dead code, and the response's `limit` is hardcoded to `Long.MAX_VALUE`. The metering is structurally
present and behaviourally absent.

### 1.5 What is genuinely real — stated so the picture is accurate in both directions

This is not a rewrite, and reading §1.1–§1.4 as "nothing works" would be as wrong as the original
verdict. Verified working, live, during these audits:

- **POS order → payment → close → GL** end to end. Menu item create submitted and returned `200`,
  dialog closed, row appeared.
- **`ORDER_CLOSED` → inventory depletion → COGS** — the healthiest chain in the system.
- **KDS** rendering 2 stations and 11 live tickets.
- **Inventory** — 6 screens, all loading real data; created "Audit Test Olive Oil", list went 3 → 4.
- **Finance** — 7 screens; drove a journal entry from draft to **POSTED `JE-2027-000026`**.
- **Reporting** — 5 of 7 named reports return rows (sales-by-item: Chicken Karahi 14 / Rs 23,548.00);
  realtime tiles return `todays-revenue: 3705040` paisa. The two empty reports are *consequences*, not
  defects (no till was ever closed; no PO could be received).
- **Purchasing read paths, NLQ, FBR tax summary, forms keeping typed data on a failed save, focus
  trapping, permission-scoped nav, honest WebSocket degradation to "Polling", no horizontal page
  scroll at any breakpoint.**

### 1.6 The one-sentence verdict

**Roughly a third of the built backend is unreachable from the UI, the administrative shell around
the transactional core essentially does not exist, and the frontend lies about failure — but the
transactional core itself is real, tested and demonstrably working.** The gap is a shell, not a
foundation.

### 1.7 Corrections to earlier research, carried forward

Several premises in prior documents are now **stale or wrong**, and planning against them would waste
time:

| Prior claim | Status |
|---|---|
| "Nine live API surfaces have zero frontend callers" | **Wrong — it is 14** (and 80 individual endpoints) |
| "`TableController` = backend built, no UI" | **Wrong on both halves.** The frontend *does* call it and renders it. The gap is that no create endpoint exists at all |
| "`mobile-bottom-nav.tsx` and `top-bar.tsx` point at dead routes" | **Already fixed**; removal documented in-file |
| "Phase 23 blocks onboarding on `403 PASSWORD_CHANGE_REQUIRED`" | **Fixed.** The gate immediately behind it — `401 TOTP_ENROLLMENT_REQUIRED` — is worse and is in **no** roadmap document |
| "Purchasing 403s for MANAGER" (`CREDENTIALS.md:129-131`) | **Wrong.** Live it is 200. The seeder's gap check (`seed_restaurantos.py:1337`) treats 403/404/503 identically and the service was 503 |
| "This tenant has 106 orders / 42 ingredients / 78 menu items" | **Global counts, not tenant counts.** Floating Terrace has 29 orders (25 CLOSED), 3 ingredients, 7 active menu items, 0 tables, 0 employees |
| `CREDENTIALS.md` permission counts (OWNER 65 / TENANT_ADMIN 64) | **Live is 66 / 65** |

---

## 2. Themes — the counts that matter more than any individual bug

Seven causes account for all 103 defects. **The distribution is the finding.**

| # | Theme | Meaning | Count | Days | What it tells you |
|---|---|---|---:|---:|---|
| **T1** | `BACKEND_NO_UI` | API built, tested, live-`200` — no screen reaches it | **26** | 79 | **The largest bucket, and the cheapest.** The hard half is already shipped and paid for. This is where "we built a lot" and "the app is empty" are both true simultaneously |
| **T3** | `BROKEN_AT_RUNTIME` | Wired end to end and misbehaves live | **26** | 35 | **The dangerous bucket** — free food, 100× money, silent data discard, a nav that deletes itself. Cheap to fix, catastrophic to demo |
| **T5** | `UX_DEFECT` | Reachable, works, wrong | **25** | 19 | Money in paisa, four date formats, 28px tap targets, a clipped tablet layout, six no-op controls |
| **T2** | `NEITHER_EXISTS` | No API and no UI | **14** | 86 | The genuinely expensive bucket. Tables, images, printing, tax profiles, modifiers, onboarding, notifications |
| **T7** | `DATA_MISSING` | Plumbing exists, values never arrive | **7** | 9 | Usage rows, entitlement ceilings, NTN/STRN, employee↔user linkage, JE descriptions |
| **T4** | `UI_NO_BACKEND` | A screen that pretends | **3** | 4 | Appearance saving to `localStorage`, the "3 unread" bell, two dead-end purchasing screens. These actively destroy trust |
| **T6** | `DEAD_LINK` | Nav points at nothing | **2** | 0.5 | Only **one** is live (`/platform/tenants`); every other unbuilt route is correctly guarded |
| | | **Total** | **103** | **≈232** | |

### Severity distribution

| Severity | Count | Days | Definition used |
|---|---:|---:|---|
| **BLOCKER** | **13** | 66 | A restaurant cannot operate, money/data is wrong, or an entire plane is unreachable |
| **HIGH** | **45** | 109 | A named workflow is impossible, or the product visibly lies |
| **MEDIUM** | **31** | 46 | Materially degrades a workflow that still completes |
| **LOW** | **14** | 11 | Cosmetic, or a niche path |

### The three sentences the theme counts are actually saying

1. **26 defects (T1) are frontend-only work against a tested, live API.** That is the single biggest
   arbitrage in the programme: **79 days of frontend closes a quarter of the register**, and every
   one of them is a demo the customer can see. The backend for all 26 is already paid for.
2. **26 defects (T3) are live misbehaviour on wired paths, at an average of 1.3 days each.** These
   are the ones that make the product *feel* broken — the free-food tender, the 100× money, the nav
   that deletes itself, the empty state that means "failed". **Fixing all 26 costs 35 days, less
   than building three screens.**
3. **Only 14 defects (T2) are genuinely new construction, and they carry 37% of the effort.** Table
   CRUD, images, printing and modifiers are the four a restaurant actually notices; the rest
   (onboarding wizard, notifications, tax engine, metering) are platform maturity, not table stakes.

**T1 + T3 + T5 = 77 of 103 defects and 133 of 232 days, and not one of them requires a new backend
domain.** That is the shape of this register: the system was built, then never finished at the edge.

---

## 3. The register

Sorted by severity, then by **Unblocks** — how many other register entries this one gates. A high
Unblocks number on a cheap row is where to spend first.

`Kind` uses the theme codes from §2. `Phase` is the ROADMAP-14-PLUS phase that owns it (`14b` is
the one new phase proposed in §5). Effort is dev-days for one engineer, pre-multiplier.

### 3.1 BLOCKER — 13 defects, 71 days

| ID | Title | Kind | Owner | Days | Phase | Unblk | Evidence |
|---|---|---|---|---:|---|---:|---|
| **GA-001** | A failed request renders the empty state — 11 of 15 list screens tell the user their data does not exist | T3 | frontend (all modules) | 3 | **14b** | 11 screens | `JournalEntryTable.tsx:37` `if (isError \|\| !data?.data.length)`; `purchasing/vendors/page.tsx:12-13` never destructures `isError`; also `till-review.tsx:59,62,66`, `customer-list.tsx:33`. Forced 500 and forced `[]` render byte-identical text. Only 2 of 15 offer Retry; no `role="alert"` anywhere |
| **GA-002** | One 503 on `/api/v1/feature-flags` silently deletes 8 of 11 nav items with no error | T3 | frontend shell | 0.5 | **14b** | all nav | `use-nav-visibility.ts:29` `if (isPending) return false;`. Live: MANAGER sidebar rendered only Dashboard/Reports/Realtime; POS, Kitchen, Till Review, Inventory, Menu, Purchasing, Customers vanished. Re-login at 200 restored all eight |
| **GA-003** | No user-management UI — complete `/api/v1/users` CRUD is unreachable from the app | T1 | frontend + user-service | 5 | **23** | 9 | `UserAdminController.java:83,98,111,123,139,146,176,187,197,218` — 10 endpoints. Live as OWNER: `GET` 200 (17 users), `POST` 201, `PATCH` 200, `deactivate` 200. TENANT_ADMIN also 200. Zero frontend consumers; only `sidebar-nav-items.ts:345` `comingSoon:true`. `/app/settings/users` → **404** |
| **GA-004** | Nobody in the tenant can approve a purchase order — `approval_limit_paisa` is NULL for every principal | T3 | purchasing + auth seed | 1 | **17** | 5 | `POST .../purchase-orders/{id}/approve` → **403 APPROVAL_LIMIT_EXCEEDED** for MANAGER, TENANT_ADMIN **and OWNER**. `policies/restaurantos/vendor.rego:17` requires `amount_paisa <= user.attributes.approval_limit_paisa`; `auth_db.user_branch_roles.approval_limit_paisa` is NULL for all 5 principals; every JWT carries `attributes:{}`. `seed_restaurantos.py` has 0 occurrences; `onboarding.py:340` sets it. **Unfixable from inside the product** — see GA-003 |
| **GA-005** | Dining tables cannot be created — no `POST` endpoint, no service method, no UI | T2 | pos-service + frontend | 4 | **17** + 23 | 4 | `TableController.java` has exactly `GET /` (:29), `PATCH /{id}` status (:38), `GET /{id}/active-order` (:48). `POST /api/v1/pos/tables` → **405**. `TableService` declares only `listByBranch/updateStatus/getActiveOrderForTable/syncStatusForOrder`. Live: both branches 200 `{"data":[]}`; Floor View "🪑 No tables configured" with no create control; dashboard "Dining tables 0 / 0" |
| **GA-006** | `LOYALTY_POINTS` tender gives away food free and corrupts the GL | T3 | pos + crm | 4 | **17** | 1 | `charge-summary.tsx:23-29` lists it in `PAYMENT_METHODS` as a selectable tender. `PaymentServiceImpl.java:11,36` — only Feign client is `FinanceArClient`, **no CRM dependency**; `:129` validates order balance only, never points balance. `AutoPostingRecipeEngine.java:598` books it to `LOYALTY_LIABILITY`. `GET /api/v1/crm/loyalty` → 404; `LoyaltyService` has no `redeem`. **Interim mitigation is one line** |
| **GA-007** | Journal-entry detail renders raw paisa — every total is 100× too large | T3 | frontend/finance | 0.5 | **14b** | 0 | `finance/journal-entries/[id]/page.tsx:93,99` render `{je.totalDebitPaisa.toLocaleString()}` — no `/100`, no currency. Live: list row "Rs 3,886.00", detail header "388,600" for the same entry. Contradicts `lib/adapters/shared.ts:1-2` |
| **GA-008** | A new tenant's owner cannot log in — TOTP enrolment has no UI, and the UI tells them to ask an administrator who does not exist | T1 | frontend/auth | 3 | **23** | onboarding | Provisioned `gap-audit-bistro` live: forced password change **works**, then `POST /api/v1/auth/login` → **401 `TOTP_ENROLLMENT_REQUIRED`**. `login-form.tsx:174-184` renders "Ask an administrator to complete enrolment" — the owner is the only account. `TwoFactorController.java:35-50` exposes `/2fa/bootstrap` + `/bootstrap/verify` **for exactly this deadlock**; grep for `2fa` across `frontend/{app,components,lib}` returns **2 comments and no code path**. **Absent from every roadmap document** |
| **GA-009** | `/app/settings` is a 404 — the platform has no tenant settings surface at all | T2 | frontend + user-service | 4 | **16** | 8 | `find frontend/app -ipath '*settings*' -name page.tsx` returns only `settings/appearance/page.tsx`. `/app/settings` → **404** for OWNER and TENANT_ADMIN. Nav entry `sidebar-nav-items.ts:332` hidden by `comingSoon:true` at `:334`, so the owner cannot even see it is missing |
| **GA-010** | Entire SuperAdmin console is a 9-line placeholder — 14 endpoints, 0 UI | T1 | frontend `(platform)` | 12 | **21** | 7 | `app/(platform)/platform/dashboard/page.tsx:1-9` + `layout.tsx:1-14` = the whole console. Rendered markup: one sentence, **0 anchors, 0 `<nav>`**. `PlatformAdminController.java:61-225` + `PlatformUserAdminController.java:90` = 14 operations. Zero `api/v1/platform` occurrences outside `frontend/e2e/` |
| **GA-011** | Per-feature usage is never recorded — 0 producers, 0 rows, no read endpoint | T2 | platform-admin + every metered service | 8 | **21** | 3 | `GET .../usage`, `/usage-summary`, `/entitlements`, `/limits` all **404** with a valid SUPER_ADMIN token. Only route is write-only `PlatformInternalController.java:106`. Grep for `/internal/platform` finds consumers of `/status`, `/features`, `/auth/verify`, `/slug` — **no consumer of `/usage`**. Live: `select resource, count(*), sum(qty) from usage_records group by resource;` → **(0 rows)** |
| **GA-012** | No printed receipt anywhere — the customer gets nothing, and the FBR QR has no destination | T2 | pos + new print-agent + frontend | 18 | **30** | 3 | `grep -rn "window\.print\|@media print" frontend/` → **0 hits**. `grep -rn "[Rr]eceipt" services/pos-service/src/main/java` → **0 hits**. `charge-summary.tsx` is 484 lines — the entire settlement surface — and contains neither "receipt" nor "print". No printer registration of any kind: `grep -rli "printer\|escpos" services/*/src/main/java` → **0 files** |
| **GA-013** | Live cross-tenant data exposure — 37 menu categories spanning 15 tenants returned to a tenant that owns 3 | T3 | pos_db + purchasing_db RLS | 3 | **18** *(pull into 14)* | 6 | Live as `owner@terrace.local`: `GET /api/v1/pos/menu/categories/admin` → **37 rows, 15× "Starters", 15× "Mains"**; `SELECT count(*) … WHERE tenant_id='d108c2e6-…'` → **3**. `pos_db` has 2 `FORCE` statements against 224 fleet-wide; `pos_user` owns its tables via Flyway so RLS does not bind. A cross-tenant **vendor** leak was observed at 07:26 and fixed mid-audit by an RLS-force migration on `purchasing_db`. Existing task #15. **Also makes the Menu screen unusable: ~40 sections, nearly all "No items in this category yet", and 14 indistinguishable "Starters" in the Add-item picker** |

### 3.2 HIGH — 45 defects, 125 days

| ID | Title | Kind | Owner | Days | Phase | Unblk | Evidence |
|---|---|---|---|---:|---|---:|---|
| GA-014 | Menu items have no image field at any layer | T2 | pos-service + frontend | 3 | **17** | 1 | `MenuItem.java:19-51` — no image column. Live `GET /api/v1/pos/menu/items` key set: `active, basePricePaisa, categoryId, categoryName, description, id, kdsStation, name, overridePricePaisa, stationId, taxRateCode, taxRatePct`. Add-item dialog: 4 fields, `input[type=file]` = **0** (`MenuItemFormDialog.tsx:147-209`) |
| GA-015 | No file-upload UI anywhere in the product | T1 | frontend | 2 | **23** | 1 | `FileController.java:67,80,97,104,113` — 5 endpoints, `GET /api/v1/files` → 200. `grep 'type="file"\|FormData\|api/v1/files' frontend/{app,components,lib}` → **nothing**. Live DOM count across 6 screens: **TOTAL FILE INPUTS: 0** |
| GA-016 | file-service 500s on every request — Feign client pinned to the compose hostname | T3 | file-service | 0.5 | **14** | GA-015 | `POST /api/v1/files` → 500 (trace `862ab2c2`), `GET /quota` → 500 (trace `22be87e2`), reproduced direct on `:8095`. `.dev-logs/file-service-new.log:800-804` — `UnknownHostException: platform-admin-service` on `GET http://platform-admin-service:8096/internal/platform/tenants/{id}/status` |
| GA-017 | POS live-order WebSocket refused at the gateway for every user | T3 | gateway | 0.5 | **17** | 0 | `JwtGlobalFilter.java:110-113` — `WS_UPGRADE_PATHS = ["/api/v1/reporting/dashboard/","/api/v1/kitchen/"]`; `/api/v1/pos/ws/` absent, so the `?token=` fallback never applies and a browser WebSocket (which cannot set `Authorization`) is rejected. **4 failed handshakes per page load**; POS header sits at "Polling" |
| GA-018 | Appearance "Save" writes `localStorage`, reports success, and loses the value on reload | T4 | frontend + user-service | 2 | **16** | 0 | `SAVE APPEARANCE -> network: []` (zero requests). `appearance-form.tsx:118-121` — `// Persistence stub (localStorage). // Phase 7 backend contract: PUT /api/v1/tenants/:id/theme`. After `page.reload()` the logoUrl input rendered **empty**; a fresh context read `localStorage = null` |
| GA-019 | No profile page, and a signed-in user cannot change their own password although the endpoint exists | T1 | frontend | 2 | **23** | 1 | `/settings/profile` → 404, `/app/profile` → 404. Profile dropdown = `My Account \| Appearance \| Log out` (`top-bar.tsx:205-209`). `PasswordChangeController.java:41` implements `POST /api/v1/auth/change-password`; only the **forced** variant is wired (`session.repository.ts:31`). For 6 of 8 roles the profile menu is Log out alone |
| GA-020 | Top-bar search is two hardcoded links — and no search backend exists in any service | T2 | frontend + new endpoint | 5 | **22** | 0 | `top-bar.tsx:95-98` `NAV_COMMANDS = [Dashboard, Appearance]`. Live queries `Chicken`, `vendor`, `order`, `invoice`, `employee`, `till`, `user`, `menu`, `Karahi`, `Beef Nihari`, `owner@terrace.local` → all "No results found", **zero API requests**. Only scoped search endpoints exist (`CustomerController.java:55`, `AccountController.java:73`), neither wired |
| GA-021 | No branch-management UI — `BranchController` POST/PUT/DELETE unreachable | T1 | frontend | 3 | **23** | 2 | `BranchController.java:48,55,69,75,83` gated on `rbac.manage`/`branch.manage`, both held by OWNER; `GET /api/v1/branches` → 200 with both branches; `POST` → 201 live on a fresh tenant. `branch.repository.ts` is 11 lines calling only `/branches/mine`. The saga-created "`<brand>` HQ" can never be renamed or given an address |
| GA-022 | Branch NTN/STRN accepted with HTTP 200 then silently discarded | T3 | user-service | 1 | **16** | 2 | `PUT /api/v1/branches/{id} {"ntn":"1234567-8","fbrStrn":"…"}` → **200 OK**, response `"ntn": null`; fresh GET also null; DB row empty. `BranchDtos.java:14,26` — neither Create nor Update declares the fields, while `BranchResponse:38` returns both. `grep 'setNtn\|setFbrStrn' services/user-service/src/main/java` → **no call sites**. Consumer: `FbrTaxSummaryService.java:114` reads `branch.ntn()` |
| GA-023 | Dashboard "Closed sales" is structurally always Rs 0.00 / 0 completed orders | T3 | frontend/dashboard | 0.5 | **14b** | 0 | `tenant-dashboard.tsx:110` calls `useOrderSummaries()` with no status filter; `pos.repository.ts:206-210` documents the endpoint defaults to **all non-terminal statuses** server-side; `:125` then filters that list for `status==="CLOSED"`. Observed "Rs 0.00 · 0 completed orders" while `pos_db` holds 25 CLOSED orders totalling 3,705,040 paisa and the tiles endpoint returns `todays-revenue: 3705040` |
| GA-024 | Report catalog returns full SQL and ClickHouse schema to any report viewer | T3 | reporting-service | 0.5 | **17** | 0 | `ReportController.java:43-44` returns `List<ReportDefinition>` directly under `hasAuthority('reporting.report.view')`; `ReportDefinition.java` carries `sqlBranchScoped` and `sqlTenantWide`. Observed as MANAGER: body contains `FROM clickhouse_analytics.sales_order_facts WHERE tenant_id = ? AND branch_id = ? …` for all 7 reports |
| GA-025 | Authorization-service outage surfaces as a generic 500 "An unexpected error occurred" | T3 | purchasing-service | 1 | **14** | 0 | `PoApprovalService.java:105` (`assertOpaAllows`) lets `FeignException$ServiceUnavailable` escape. Log `[75461a67-…]`: `[503] during [POST] to [http://authorization-service/internal/authorize] … Load balancer does not contain an instance` → gateway 500 → toast. **Indistinguishable from a permission failure** — this is why GA-004 was misdiagnosed for weeks |
| GA-026 | Menu item form drops tax — every UI-created item is zero-rated | T3 | frontend/menu | 1 | **16** | 0 | `MenuItemFormDialog.tsx:95` builds `{categoryId, name, description, basePricePaisa}` only. Backend accepts `taxRatePct`+`taxRateCode` (`MenuItemAdminDtos.java:16-23`, persisted `MenuServiceImpl.java:177,203`); zod declares both optional so nothing errors. Measured: UI-created item `tax_rate_pct=0.00` vs seeded items at `16.00`. Live admin list: `{16.00 ×68, 13.00 ×10}`, `taxRateCode null ×78` |
| GA-027 | A wrong authenticator code produces no visible change at all | T3 | auth-service + frontend | 1 | **23** | 0 | Server returns identical `401 {"code":"TOTP_REQUIRED"}` for "code needed" and "code wrong". `login-form.tsx:135-144` branches on `isTotpRequired()` and calls `setFormError(null)`, wiping any message. DOM before/after a failed submit: identical (`{"alerts":[],"hasSignInFailed":false}`). Affects OWNER, TENANT_ADMIN, ACCOUNTANT |
| GA-028 | Roles and permissions are read-only — RBAC cannot be administered from the product | T1/T2 | auth-service + frontend | 5 | **23** | 2 | `RoleCatalogController.java:81,98` expose only `GET /roles` and `GET /permissions` (both live 200 with the full catalog); grepping the file for `PostMapping\|PutMapping` returns empty. Zero frontend callers — the only reference is `e2e/journeys/tenant-admin-user-provisioning.spec.ts:55`. **This is exactly the data a role-assignment UI needs** |
| GA-029 | KDS station CRUD has no UI, so a menu item can never be routed to a station | T1 | frontend | 3 | **23** | 1 | `StationController.java:35,41,50,59` — full CRUD; `POST /api/v1/pos/stations` → **201** live. Paired with the uncalled `PUT /api/v1/pos/menu/items/{id}/station` (`MenuController.java:108`). Frontend's only station call is `kds.repository.ts:82` → kitchen-service's *different* `kds_stations` table. Consistent with `menu_items.station_id` being NULL for every row |
| GA-030 | Wastage record/list API with no screen — a restaurant cannot run food cost without spoilage | T1 | frontend | 2 | **26** | 1 | `WastageController.java:40,48`; `GET /api/v1/inventory/wastage?branchId=…` → 200 live. Absent from `inventory.repository.ts`. (`GET` without `branchId` → 400 — the param is mandatory) |
| GA-031 | No split-bill UI | T1 | frontend | 3 | **22** | 0 | `PaymentController.java:106` `POST /api/v1/pos/orders/{id}/split` has no frontend caller; `:87` `POST .../close` likewise uncalled. A core table-service workflow |
| GA-032 | Sidebar shows a different tenant's brand name on every screen | T3 | frontend + session claim | 0.5 | **14b** | 0 | `use-tenant-brand.ts:19` resolves brand from `env.NEXT_PUBLIC_DEFAULT_TENANT_SLUG` (build-time, `'test'`) rather than the session. Live as `owner@terrace.local`: `brandInSidebar='Lume'`, `branchChip='Floating Terrace HQ'`, login page said "Sign in to Floating Terrace". Also fires `GET /api/v1/auth/tenants/test` on **every** navigation |
| GA-033 | Session expiry drops the user on a bare login with no reason and no return path | T5 | frontend/auth | 1 | **22** | 0 | `proxy.ts:57` `NextResponse.redirect(loginUrl(request))` — no `?reason=`, no `?next=`. `client.ts:54` and `session-provider.tsx:72` set `?reason=` but never `?next=`. Observed: plain "Sign in to RestaurantOS", re-auth lands on `/app/dashboard`. `sanitizeReturnPath`/`?next=` already exist (`lib/auth/step-up.ts:18,25`) and are used only by step-up |
| GA-034 | At 768px the module tab bar is clipped with no scroll affordance | T5 | frontend/shell | 1 | **20**/22 | 0 | `finance/layout.tsx:35` `<nav className="mb-4 flex gap-4 border-b">` (8 tabs) and `purchasing/layout.tsx:25` (6 tabs) — no `overflow-x-auto`, no `flex-wrap`. Measured at 768: "House Accounts" right=799, "AR Aging" right=861, `overflowX=visible` (sw=589 cw=480), page `scrollWidth==clientWidth`. At 375px, 4 of 8 Finance tabs are off-screen |
| GA-035 | Sidebar never collapses at tablet width, costing a third of the screen and clipping money columns | T5 | frontend/shell | 1 | **22** | 0 | `sidebar.tsx:145` `useState(false)` (never persisted), `:154-155` `hidden md:flex` + `w-64` — full width from 768px up. Measured at 768: sidebar 255px of 768, content 512px; Credit column cut mid-number ("Rs 3,886.0"); profile avatar containing Log out at right=787, **outside the viewport** |
| GA-036 | The journal-entry form asks accountants to type paisa | T5 | frontend/finance | 1 | **22** | 0 | `JournalEntryForm.tsx:118-119` headers read literally "Debit (paisa)" / "Credit (paisa)"; `:57-58` parse as raw paisa; `:187,193` echo "Total DR: 500,000" for Rs 5,000. Every other money input takes rupees (`ExpenseFormDialog.tsx:66`, `ApPaymentDialog.tsx:57`, `MenuItemFormDialog.tsx:95`, `VendorItemPriceDialog.tsx:104`, `ArChargeDialog.tsx:98`) |
| GA-037 | Journal entries: no sort, no search, no date filter — while the filter API and a sortable primitive already exist | T1 | frontend (all list screens) | 2 | **20**/22 | ~12 screens | Measured live: 25 rows, all 6 headers `sortable:false`, 0 filter inputs. `JournalEntryTable.tsx:10-16` declares `filters?: JeFilters` and passes it to the hook; the page renders `<JournalEntryTable />` with none. `data-table.tsx:56,96-119` implements TanStack sorting + column filters but only 3 screens use it. **`data-table.tsx:65` calls `getFilteredRowModel()` and never registers it (W10), so filtering can never work** |
| GA-038 | Purchase order list shows truncated UUIDs under a "PO number" header and has no vendor column | T5 | purchasing DTO + frontend | 1.5 | **22** | 0 | `purchase-orders/page.tsx:84` renders `{po.id.slice(0,8)}…` under the th at `:69` labelled "PO number". Observed 12 rows reading `7b2c4a9f…`, `528d242e…`, all "—" for expected date. PO detail line items render the ingredient UUID (`5e6ab5ff… (kg)`). The payload has `id`/`vendorId` but no `poNumber` and no `vendorName` |
| GA-039 | Goods receipt is a dev mock rendered in the production UI | T2 | purchasing + inventory + finance | 8 | **24** | 3 | Only receiving path is `MockGrnController` `POST /purchase-orders/{poId}/mock-receive`. The PO detail page renders a panel titled *"Mock goods receipt (dev) — Simulates Phase 8 GRN while integration-mode=mock."* to a MANAGER. No real GRN controller exists, and `integration-mode` defaults to `mock` with no YAML setting it |
| GA-040 | HR nav is role-gated to OWNER/TENANT_ADMIN although MANAGER and ACCOUNTANT hold `hr.*` and the API answers 200 | T5 | frontend nav | 0.25 | **22** | 0 | `sidebar-nav-items.ts:266-274` gates on `roles:["OWNER","TENANT_ADMIN"]` behind the stale comment *"HR permissions not yet in DB catalog"*. `hr/layout.tsx:44` guards on `hr.employee.view`. MANAGER carries 6 HR codes; ACCOUNTANT carries 3 **including `hr.payroll.run`**. `GET /hr/employees` and `/hr/payroll-runs` → 200 for both; the module renders fully when reached by URL |
| GA-041 | Modifier and ModifierGroup: table and entity exist with nothing above them | T2 | pos-service + frontend | 6 | **17** | GA-042 | `V1__pos_schema.sql:75-111` creates `modifier_groups` and `modifiers`; `Modifier.java` and `ModifierGroup.java` exist. **No `ModifierRepository`.** Zero services, zero controllers, zero frontend references to `ModifierGroup`. For a café (sizes, milks) or QSR (combos) modifiers *are* the menu |
| GA-042 | Order modifiers are always priced at zero and print as raw UUIDs | T3 | pos-service | 3 | **17** | 0 | `OrderServiceImpl.java:250-261` — `oim.setModifierNameSnapshot(modifierId.toString())` and `oim.setPriceDeltaPaisa(0L)`, because no `ModifierRepository` exists to look one up. `kds-ticket-detail.tsx:118-120` renders `item.modifiers.join(" · ")`, so a kitchen ticket prints a UUID. Latent only because nothing populates `modifierIds` today — a live revenue bug the moment a picker ships |
| GA-043 | No forgot-password flow despite a working reset API — and no channel to deliver the token | T1 | frontend + notification | 2 | **23**+25 | 0 | `PasswordResetController.java:53,65` (request + confirm), zero callers; the login form has no "forgot password?" control. Tokens are minted with **no consumer to deliver them** — `services/notification-service` has zero `.java` files |
| GA-044 | Stock movement ledger is written by 7 services and readable by none | T1 | inventory + frontend | 3 | **26** | 0 | `InventoryMovement.java` is referenced by 8 repositories and 7 services (`DepletionService`, `StockCountService`, `IngredientService`, `WastageService`, `TransferService`, `ReceiptService`, `OpeningBalanceService`) and by **0 files** under `inventory-service/.../web/`. A manager cannot answer "why did my flour drop by 4 kg?" |
| GA-045 | No tax profile or tax-rate catalogue; inclusive pricing not modelled | T2 | finance + pos | 5 | **16** | GA-026 | `GET /api/v1/finance/tax-profile` → 404; `/tax-rates` → 404. No controller matching "tax" outside reporting. `menu_items.tax_rate_code` is free text with no table behind it. `OrderPricingCalculator` computes additively, so **tax-inclusive menu pricing — the common case in Pakistan — cannot be expressed** |
| GA-046 | No onboarding state, no tenant profile, no wizard surface | T2 | user-service + frontend | 8 | **29** | 0 | `GET /api/v1/onboarding` → 404; `GET /api/v1/tenant-profile` → 404, both as an authenticated new owner. No `onboarding\|setup\|welcome\|wizard` route under `frontend/app`. Nothing tracks setup progress, so nothing can be resumed or derived |
| GA-047 | No notification channel — temp password and TOTP secret must be hand-carried | T2 | notification-service | 8 | **25** | GA-043, GA-008 | `find services/notification-service -name '*.java'` → **0 files**. Provisioning returns `tempPassword` once (Redis, 1h TTL); the TOTP secret is returned once as an `otpauthUri` and re-issue is refused (`TOTP_ALREADY_ENROLLED`). No invite email, no reset nudge, no in-product delivery |
| GA-048 | Tier change and subscription editing unreachable from the browser | T1 | frontend | 4 | **21** | 0 | `POST .../tenants/{id}/tier` (`:122`) and `PATCH .../tenants/{id}` for `billingRef`/`trialEndsAt`/`renewsAt` (`:105`) both work and are exercised green by `e2e/journeys/superadmin-tenant-lifecycle.spec.ts:82`. `/platform/subscriptions`, `/platform/tenants`, `/platform/tenants/{id}` → **404**. `TenantSubscriptionService.java:255-264` returns a `TierChangeResult` whose javadoc says it carries "enough detail for a SuperAdmin UI to say so" |
| GA-049 | Feature toggles unreachable from the browser | T1 | frontend | 3 | **21** | 0 | `PATCH .../tenants/{id}/features/{code}` (`:192`) and `GET .../features` (`:187`) both work — GET returned 200 with **20 `FEATURE_*` codes** for floating-terrace. `/platform/features` → 404, no frontend caller outside `e2e/`. **Every plan that says "a SuperAdmin enables the flag" is describing a curl** |
| GA-050 | Tenant creation, suspension, cancel and purge unreachable from the browser | T1 | frontend | 4 | **21** | 0 | `POST /tenants` (`:61`), `/suspend` (`:157`), `/reactivate` (`:165`), `/cancel` (`:171`), `DELETE` (`:179`) all exist; `GET /tenants` → 200 listing 8 tenants. `/platform/tenants` → 404. Note `POST /tenants` returns a one-time `tempPassword` (`:72-74`) with **no delivery channel and no screen to display it** |
| GA-051 | `UsageService.record` returns a row count where a summed quantity is meant | T3 | platform-admin | 0.5 | **21** | GA-011 | `UsageService.java:41` returns `countByTenantIdAndResource` — the number of rows — surfaced as `newCount`, a running total (`PlatformInternalController.java:110-111`). Record delta 5 then 3 → reports **2**. The correct aggregate `sumQtyByTenantIdAndResource` (`UsageRecordRepository.java:17`) has **zero callers**; so does `UsageService.getTotal` |
| GA-052 | Usage response hardcodes `limit` to `Long.MAX_VALUE` instead of the tier ceiling | T7 | platform-admin | 1 | **21** | GA-011 | `PlatformInternalController.java:111` — `new UsageRecordResponse(newCount, Long.MAX_VALUE)`. The `limit` field **is** the entitlement half of usage-against-entitlement. Real ceilings exist on the tenant row and are set by `TierLimits.java:37-44` |
| GA-053 | `/platform/tenants` nav entry 404s — the only unguarded dead link in the product | T6 | frontend | 0.25 | **14b** | 0 | `sidebar-nav-items.ts:355-360` declares it in `platformNavItems` **without** `comingSoon`, unlike the correctly-guarded `:300`, `:334`, `:348`. Live: browser tab title "404: This page could not be found." Compounding: `platformNavItems` has zero application-code consumers, and `(platform)/layout.tsx` renders only a `<header>`, so a SuperAdmin has **no navigation at all** |
| GA-054 | `EncryptedStringConverter` NPEs at runtime when the key is unset, and pos-service has no fail-fast guard | T3 | pos-service + shared-lib | 1 | **16** | GA-012, 35 | `EncryptedStringConverter.java:16-17` calls `encryptionService.encrypt(...)` with no null check on the static field set by `init()` at `:10`. `EncryptionAutoConfiguration.java:11` is `@ConditionalOnProperty`, so an unset key silently skips the bean and the **first write throws NPE at runtime — during a sale**. purchasing-service guards this with `EncryptionRequiredConfig`; pos-service has no equivalent |
| GA-055 | No province/jurisdiction anywhere; branch address is null, so `sellerProvince` cannot be produced | T7 | user-service | 1 | **16**→35 | 35 | `grep "province\|jurisdiction\|taxAuthority" --include=*.java services/` → **0 hits**. `BranchEntity.java:36` stores address as untyped `jsonb`; live `GET /api/v1/branches` → `"address": null` on **both** Floating Terrace branches. `sellerProvince` is mandatory in the DI payload (error 0074), and authority choice (FBR vs SRB vs PRA) is upstream of every other FBR decision |
| GA-056 | Branch address is untyped JSONB-in-a-String and fails with a misleading duplicate-name error | T3 | user-service | 2 | **16** | 0 | Isolated live on `PUT /api/v1/branches/{id}`: `{"phone":…}` → 200; `{"email":…}` → 200; `{"address":"12 Zamzama Karachi"}` → **409 CONFLICT**; `{"address":"{\"line1\":…}"}` → 200. `branches.address` is `jsonb` while `UpdateBranchRequest.address` is `String`. `BranchService.java:127-131` catches **every** `DataIntegrityViolationException` and reports *"Branch with name '…' already exists"* |
| GA-057 | On-hand stock goes deeply negative with no floor or warning | T3 | inventory-service | 2 | **26** | 0 | `inventory_db.ingredient_branch_stock` for tenant `d108c2e6`: `Chicken \| -3000.0000 \| avg_cost_paisa 0`. Screen renders "-3000 KG", "Rs 0.00", "Out of stock", "Last counted: Never". **11 negative rows across tenants (min -3000).** Order consumption decrements stock never received; with GA-039 no receipt can ever be posted |
| GA-058 | Payment methods are a compile-time enum with no per-tenant enablement | T2 | pos-service | 3 | **29** | GA-006 | `GET /api/v1/pos/payment-methods?branchId=…` → **404**. `PaymentMethod.java` is a fixed enum `{CASH, CARD, LOYALTY_POINTS, BANK_TRANSFER, VOUCHER, CHARGE_TO_ACCOUNT}`. Every tenant gets the identical unfiltered list — a cloud kitchen cannot hide CASH, a bar cannot enable house tabs selectively, **and nobody can switch off the broken loyalty tender per tenant** |

### 3.3 MEDIUM — 31 defects, 74 days

| ID | Title | Kind | Owner | Days | Phase | Evidence |
|---|---|---|---|---:|---|---|
| GA-059 | Notification bell is inert and hardcodes "3 unread" with a permanent red dot | T4 | frontend shell | 0.2 / 3 | **14b** / 25 | `top-bar.tsx:174-190` — `<button>` with no `onClick`, `aria-label="Notifications (3 unread)"` a literal, always-on destructive dot. Measured: `bellHasHandler=false`; click leaves `body.innerHTML.length` unchanged (54310 → 54310), 0 popovers. Screen readers are told there are 3 unread items on **every** page |
| GA-060 | CRM: customer detail/edit/delete unreachable; the empty state says "Add your first customer" with no control | T1 | frontend | 2 | **23** | `CustomerController.java:75,81,87` (GET/PUT/DELETE `/{id}`) have no callers; `crm.repository.ts` wires only search (`:18`), `/detail` (`:23`), create (`:29`). Live DOM of `/app/crm` main region: `{"buttons":[], "text":"Customers … No customers found Add your first customer…"}` — **zero buttons on the screen**. A typo in a phone number is permanent |
| GA-061 | Promotions can be created but never applied to an order | T1 | frontend | 2 | **23** | `OrderController.java:85` `POST .../promotions/apply` has no caller; `PromotionController.java:36` `POST /api/v1/crm/promotions` likewise (only the GET list at `:45` is wired via `crm.repository.ts:41`) |
| GA-062 | Stock takes and goods receipts are write-only — no history readable | T1/T2 | inventory + frontend | 3 | **17**+23 | `StockCountController.java:36` and `ReceiptController.java:36` each expose a single `@PostMapping` and no GET. `StockCountDialog.tsx` / `StockReceiptDialog.tsx` submit only; `/app/inventory/stock` has no count or receipt history. A posted variance can never be re-read or audited |
| GA-063 | Audit trail unreachable, with no UI — and the gateway misreports why | T1/T3 | gateway + audit + frontend | 3 | **17**+23 | `AuditQueryController.java:60,82` exposes `/api/v1/audit/events` and the route is committed at `gateway/application.yml:237-240` (commit `1199450`), but the **running gateway binary predates it** → live 404 for all 8 role tokens. Separately `grep "api/v1/audit" frontend/{app,components,lib}` → **0 hits**. The 7-year compliance trail has no reader |
| GA-064 | nlq-service and notification-service are absent from the running stack while `/app/nlq` is a visible nav item | T3 | platform / dev stack | 2 | **37** | nlq-service listens on 8094 per `application.yml:2`; ports 8091 and 8094 both answer `000` and `NLQ-SERVICE` is unregistered in Eureka. Live `POST /api/v1/nlq/query` → **503**. Only **14 of 16** services are registered |
| GA-065 | A response-schema drift kills the login form with an uncaught TypeError and no user-visible error | T3 | frontend/auth | 0.5 | **23** | `session.repository.ts:12` runs `apiLoginSchema.parse(raw)`; the resulting ZodError is not an ApiError, but `login-form.tsx:135` calls `error.isTotpRequired()` on it unconditionally. Observed live: `POST /api/v1/auth/login` → **200 OK**, then `Uncaught (in promise) TypeError: error.isTotpRequired is not a function`, and the form did nothing — no spinner, no message, no navigation |
| GA-066 | `/settings/appearance` has no guard — KITCHEN_STAFF reaches the tenant-branding screen | T3 | frontend | 0.5 | **16**/17 | Nav entry is role-gated (`sidebar-nav-items.ts:336-342`), palette twin (`top-bar.tsx:102`) and mobile twin too — but the **page** has no `PermissionGuard`, `(tenant)/layout.tsx` has no auth guard despite `page.tsx:21` claiming one, and `proxy.ts:21,64` exclude `/settings` from both `PROTECTED` and the matcher. Live: KITCHEN_STAFF (2 permissions) rendered the page and clicked a working Save. Reproduced as MANAGER |
| GA-067 | `GET /api/v1/branches` is ungated — every role reads the full branch list, unscoped | T3 | user-service | 0.5 | **17** | `BranchController.java:55-62` (list) and `:71-74` (get) carry **no `@PreAuthorize`** while create/update/delete on the same controller require `rbac.manage`/`branch.manage`. Live with a KITCHEN_STAFF token (2 permissions): **200** returning both branches with `fbrStrn`, `ntn`, `phone`, `email`, `receiptConfig` — unscoped to assigned branches, though a scoped `/branches/mine` exists at `:66-69` |
| GA-068 | INVENTORY_MANAGER's dashboard is the Kitchen screen and its only CTA is refused | T5 | frontend | 1 | **22** | `tenant-dashboard.tsx:282-289` branches solely on `permissions.includes('pos.order.view')`; anyone without it is assumed to be kitchen staff. INVENTORY_MANAGER's 5 permissions contain neither `pos.order.view` nor `pos.kds.view`. Live as `storekeeper@terrace.local`: dashboard read "Kitchen — Your account is set up for kitchen display" with one link "Open KDS board" → clicking it returned "You do not have permission to access the Kitchen Display" |
| GA-069 | MANAGER holds `finance.expense.approve` but every Finance route is gated on `finance.journal.view` | T5 | frontend | 1 | **22** | MANAGER's JWT carries `finance.expense.approve` and `finance.ar.view`; `ExpenseController.java:53,59` enforce exactly `finance.expense.approve`. But `finance/layout.tsx:60` guards the whole module on `finance.journal.view`, and all six Finance nav entries (`sidebar-nav-items.ts:206-249`) use the same single code. Live: MANAGER at `/app/finance/accounts` → "Access denied" |
| GA-070 | Mobile bottom nav has no Kitchen Display entry — a kitchen tablet gets a one-icon bar | T5 | frontend | 0.5 | **22** | `mobile-bottom-nav.tsx:25-57` defines Dashboard, Orders (`pos.order.create`), Menu (`inventory.item.view`), Finance (`finance.journal.view`), Appearance (roles) — **no `pos.kds.view` entry**. KITCHEN_STAFF (permissions `pos.kds.view` + `pos.kds.update` only) is left with Dashboard alone and no mobile route to the KDS |
| GA-071 | Purchasing Payments and Order Suggestions render data with no way to act on it | T4 | frontend | 2 | **22** | Live DOM as OWNER: `/app/purchasing/payments` → buttons=0, inputs=0, tables=0, while the hub card promises "Record and track payments against approved invoices". `/app/purchasing/order-suggestions` → 4 real suggestion rows and **buttons=0**, so a suggestion cannot be turned into a PO |
| GA-072 | HR Employees is empty while 17 users exist — no screen anywhere lists the staff | T7 | hr-service + frontend | 2 | **23** | `/app/hr/employees` renders "No employees yet" for a tenant where `GET /api/v1/users` returns 17 principals. Employee records and user records are **disjoint**, and with GA-003 missing there is no screen at all that lists the people who work at this restaurant |
| GA-073 | The access JWT is placed in the WebSocket query string on all three sockets | T5 (security) | gateway + frontend | 2 | **17**/37 | `use-pos-orders-socket.ts:53` builds `wsUrl('/api/v1/pos/ws/orders/${branchId}?token=${accessToken}')`; same in `use-kds-socket.ts:68` and `use-dashboard-socket.ts:60`; allowed deliberately at `JwtGlobalFilter.java:114-121`. The console prints the **complete signed JWT including the roles and permissions arrays**, so it lands in gateway access logs, proxy logs and browser history |
| GA-074 | Tap targets below 44px on the POS at tablet and phone width | T5 | frontend/pos | 1 | **20**/22 | Measured at 375px on `/app/pos`: "Add customer" 106×28, order-type chips 72×32 / 89×32 / 69×32, category chips 85×36, "Select table" 288×40, "Close Till" 65×40 — **10 controls under 44px**. `/app/menu/items` row menus are 28×28. At 768px every sidebar link is 239×36. WCAG 2.5.5 asks 44×44. The shell defines a `touch-target` utility and uses it in the top bar but not on order-entry controls |
| GA-075 | A failed save shows only a transient toast carrying the raw server message, with no inline error | T5 | frontend (shared dialog) | 1 | **23** | Forced 500 on `POST /api/v1/pos/menu/items`: the dialog's inline error region stayed empty (`"errors":[]`) and the only signal was a Sonner toast reading the backend message verbatim ("server exploded"). Once it auto-dismisses the dialog looks untouched with Save live again. `lib/errors/user-facing` exports `formatUserFacingError`, which this path does not use |
| GA-076 | Journal-entry descriptions are raw UUIDs | T7 | finance-service (posting rule) | 1 | **27** | Live Description column: "Order revenue 5e98e671-908c-4829-b2d0-4e6865c4c3b7". `JournalEntryTable.tsx:70` renders `{je.description}` faithfully — the value is what finance-service writes when posting order revenue. Should carry the order number (`ORD-20260807-0028`), which the dashboard already shows for the same records |
| GA-077 | Dates are rendered four different ways with no shared formatter | T5 | frontend (shared) | 1 | **20** | Raw ISO at `JournalEntryTable.tsx:69` → `2026-08-06`; machine-locale date+time at `till-review.tsx:47` → `8/6/2026, 7:15:00 AM`; `dateStyle:'medium'` at `charge-summary.tsx:50`; `toLocaleDateString()` at `inventory/stock/page.tsx:129`. `lib/adapters/shared.ts` has `toInstant()` but no formatter. `8/6/2026` is also ambiguous day/month for a Pakistan-market product |
| GA-078 | HR screens format money with a different symbol and ragged decimals | T5 | frontend/hr | 0.5 | **14b** | `hr/employees/page.tsx:20` and `hr/payroll/page.tsx:24`: `` `₨ ${(paisa / 100).toLocaleString()}` ``. Verified: 250050 paisa → "Rs 2,500.50" via `MoneyDisplay` but "**₨ 2,500.5**" on HR; 250000 → "Rs 2,500.00" vs "**₨ 2,500**". Decimals no longer align in a payroll column. Violates `lib/adapters/shared.ts:1-2` |
| GA-079 | Avatar shows a hex digit from the user UUID instead of an initial | T5 | frontend + auth claim | 0.5 | **22** | `top-bar.tsx:111` — `const userInitial = userId ? userId.slice(0,1).toUpperCase() : "U";` — `userId` is a UUID, so `owner@terrace.local` (`61334688-…`) renders as "**6**". Fixing needs a display name on the session; the token carries only `sub` |
| GA-080 | Deactivating an employee takes one click with no confirmation | T5 | frontend/hr | 0.5 | **23** | `hr/employees/page.tsx:181` `onClick={() => deactivate(e.id)}` → `:64-69` mutates immediately. No `window.confirm` exists anywhere in the codebase, and **every other module** gates its destructive action behind a dialog (`inventory/ingredients:320`, `inventory/categories:241`, `pos/order-panel:634`, `pos/menu-grid:134`). HR is the outlier and the action affects payroll |
| GA-081 | Add-ingredient form hides two required fields and validates them one at a time | T5 | frontend/inventory | 0.25 | **22** | Only "Primary category *" carries an asterisk. Submitting a filled form failed with "SKU is required"; filling SKU and resubmitting then failed with "Enter a reorder point". Two submit-fail round trips to discover two unmarked required fields; SKU's placeholder `ING-CHK` reads as an example |
| GA-082 | Tier branch limit unenforced on create, and the tenant cannot read its own limits | T3 | user-service + platform-admin | 2 | **21** | `platform_db.tenants`: tier GROWTH, `max_branches=5`. Six further `POST /api/v1/branches` all returned **201**, leaving 7 live branches. `BranchService.create` performs no limit check. `GET /api/v1/platform/tenants/{id}` → 403 (class-annotated SUPER_ADMIN), so the tenant plane cannot read `max_branches`/`max_users` to self-limit |
| GA-083 | Entitlement ceilings are returned by the API and read by no UI | T7 | frontend + platform-admin | 2 | **21** | `GET /api/v1/platform/tenants` returns `maxBranches`, `maxUsers`, `storageGb`, `nlqQuota` per tenant (live: 50/500/100/50000). Grepping the frontend for any of those four names returns **zero matches**. The only "quota" in the frontend is `NlqRejectionNotice.tsx:60`, a 429 toast shown **after** the user is blocked. The sole usage-vs-limit comparison in the system checks branches only, at tier-change time |
| GA-084 | Impersonation and tenant-user password reset have no UI | T1 | frontend | 3 | **21** | `POST .../tenants/{id}/impersonate` (`:225`, with an audited acting-principal fix at `:206-224`) and `POST .../tenants/{tid}/users/{uid}/reset-password` (`PlatformUserAdminController.java:90`) both exist and are SUPER_ADMIN-gated. The reset endpoint returns a `tempPassword` that `:87-89` states must be delivered out of band **by a SuperAdmin who has no screen on which to read it** |
| GA-085 | No CSV or bulk import for the menu | T2 | pos-service + frontend | 5 | **29** | No `/import` or `bulkImport` mapping in any `*Controller.java` across `services/`. A restaurant with 200 items must create each one through a 4-field dialog, one at a time — **and each one is created zero-rated** (GA-026) |
| GA-086 | Biometric attendance-device registration has no screen | T1 | frontend | 2 | **23** | `AttendanceDeviceController.java:38,45,51` — register/list/deactivate. No path in `hr.repository.ts` references `/hr/devices`. Feeds the `/iclock` ADMS ingest path, so a real terminal cannot be enrolled from the product |
| GA-087 | Customer feedback capture and list have no screen | T1 | frontend | 2 | **23** | `FeedbackController.java:36,43` (submit + list), zero callers; live `GET /api/v1/crm/feedback` → 200. `/app/crm` does not reference them |
| GA-088 | Leave requests can be created, approved and rejected but never listed | T1 | frontend | 1 | **23** | `LeaveController.java:36` `GET /api/v1/hr/leave/requests` has no frontend caller; `hr.repository.ts:199,203,207` call only POST create/approve/reject. **The client functions are already written** — this is pages only |
| GA-089 | Two "my branches" surfaces, one dead | T5 | auth / user-service | 1 | **17** | `MyBranchesController.java:27` `GET /api/v1/auth/my-branches` → live 200, zero callers. The branch switcher instead uses `GET /api/v1/branches/mine` (user-service `BranchController.java:64`, called at `branch.repository.ts:8`). One of the two is dead weight |

### 3.4 LOW — 14 defects, 13 days

| ID | Title | Kind | Owner | Days | Phase | Evidence |
|---|---|---|---|---:|---|---|
| GA-090 | A second, divergent nav list that only tests import | T5 | frontend | 1 | **22** | `sidebar-nav-items.ts` exports `tenantNavItems` (L59-145), imported **only** by `__tests__/lib/nav-feature-flags.test.ts:7`, and `navGroups` (L148-352), imported by `sidebar.tsx:12`. They have diverged: `tenantNavItems:111-118` lists Reporting **without** `comingSoon` while `navGroups:295-301` marks it `comingSoon:true`. **Tests assert over a list the product never renders** |
| GA-091 | `/app/reporting` nav target 404s | T6 | frontend | 0.25 | **14b** | `/app/reporting` → 404 for both personas; hidden only by `comingSoon:true` in the list that renders, and declared **without** the flag in the list that does not (GA-090) |
| GA-092 | The "Toggle theme" command palette item does nothing | T5 | frontend shell | 0.1 | **14b** | `top-bar.tsx:246-248` — `<CommandItem onSelect={() => setCmdOpen(false)}>Toggle theme</CommandItem>`. Measured `document.documentElement.className` before/after: `changed=false`. A working `ThemeToggle` sits in the same header at `:189`. **One third of the palette's contents is a no-op** |
| GA-093 | Unlabelled 16×16 checkbox on Menu Items | T5 | frontend/menu | 0.1 | **14b** | `<input class="size-4 rounded border-input" type="checkbox">` with no `id`, no `aria-label`, no associated `<label>`. The visible words "Show inactive" are not programmatically connected |
| GA-094 | The page advertises a keyboard shortcut that does nothing | T5 | frontend/finance | 0.2 | **14b** | `finance/journal-entries/page.tsx:16` subtitle reads "Tab to navigate rows, Enter to open, **E to export**". `JournalEntryTable.tsx:22-24`: `if (e.key === "e" \|\| e.key === "E") { // Export stub — Phase 7 }` — empty body |
| GA-095 | Breadcrumb mis-cases acronyms | T5 | frontend shell | 0.2 | **14b** | `top-bar.tsx:36` `segment.replace(/-/g," ").replace(/\b\w/g, c => c.toUpperCase())`. Live: `/app/finance/ar-aging` → "App Finance **Ar Aging**"; `/app/finance/gl` → "**Gl**". The sidebar and tab bar both render "AR Aging" and "General Ledger" correctly |
| GA-096 | Developer "Seed default leave types" button ships on the HR attendance screen | T5 | frontend/hr | 0.25 | **14b** | Live button inventory of `/app/hr/attendance` as OWNER: `['Clock in','Clock out','Request leave','Approve','Reject','Seed default leave types']` |
| GA-097 | Reports render raw UUIDs and two permanently empty columns | T5 | reporting + frontend | 1 | **27** | `/app/reports/sales-by-item` shows a leading "Menu Item Id" column of raw UUIDs beside Item Name; headers derived verbatim from catalog columns ("Gross Revenue Paisa", "Cogs Paisa", "Gross Margin Paisa") though values format as Rs; Cogs and Gross Margin are "—" on **every** row |
| GA-098 | FBR tax summary returns null NTN and STRN, making the statutory report unfilable | T7 | reporting + tenant settings | 1 | **16** | `GET .../fbr-tax-summary?…` → 200 with `outputTaxPaisa 511040`, `taxableSalesPaisa 3194000`, but `"ntn": null, "fbrStrn": null`. Direct consequence of GA-022; no screen exists to enter them |
| GA-099 | GL balance rows cannot be drilled into | T1 | frontend | 2 | **27** | `GlController.java:38` `GET /api/v1/finance/gl/{accountCode}/entries` has no caller; `finance.repository.ts:172` wires only `/gl/balances`. Same pattern for `ExpenseController.java:46` and `PeriodController.java:68` detail endpoints |
| GA-100 | Menu items can be deactivated but never deleted | T1 | frontend | 0.5 | **23** | `DELETE /api/v1/pos/menu/items/{id}` has no frontend caller |
| GA-101 | No QR code library in the repository | T2 | pos-service | 1 | **35** | `grep "zxing\|qrcode\|QRCode"` across every `pom.xml` and `package.json` → **0 hits**. The DI spec requires QR v2.0 (25×25) at 1.0×1.0 inch on every invoice, rendered **server-side** as a raster |
| GA-102 | Services report `UP` in Eureka while their port answers nothing | T3 | platform / ops | 2 | **37** | Eureka listed `AUDIT-SERVICE` and `AUTHORIZATION-SERVICE` as `UP` while ports 8093 and 8083 answered `000`. `GET /api/v1/audit/events` returned **404**, not 503 — a client cannot distinguish "no such endpoint" from "service is down". Existing task #12 |
| GA-103 | The working tenant has too little data to demonstrate a back office | T7 | seed script | 1 | **15** | Floating Terrace: 3 ingredients, 7 active menu items, 0 dining tables, 0 HR employees, 0 leave types, 0 expenses, 0 vendor invoices, 12 finance periods all still OPEN so `finance.period.close` has never been exercised. HR renders "No employees yet" and cannot demonstrate payroll, rostering or attendance |

---

## 4. The shortest path to a demo-able app for Floating Terrace

**Target:** Floating Terrace, Islamabad F-7, table-service restaurant, **not sales-tax registered**.
The bar is not "feature complete". The bar is: *a real waiter, a real cook and a real cashier could
run one dinner service on this, and the owner could read the takings afterwards without being lied
to.*

### 4.1 What that rules OUT, immediately and completely

Being ruthless is the point of this section. **None of the following is required, and every day
spent on them before the service runs is a day wasted:**

| Cut | Why |
|---|---|
| **All of FBR / provincial digital invoicing** (Phase 35, GA-055, GA-101, and the NTN/STRN half of GA-022) | The tenant is **not registered**. Nothing on the operating path touches it. D1 (FBR vs SRB vs PRA) stays open and blocks nothing here. `GA-022` still ships in Phase 16 because the *already-shipped* FBR report reads columns nothing can write — but it is not on this path |
| **The entire SuperAdmin console** (GA-010, GA-048, GA-049, GA-050, GA-084) and **usage metering** (GA-011, GA-051, GA-052, GA-083) | A restaurant running a service never touches the platform plane. This is a commercial capability, not an operating one |
| **Guided onboarding** (GA-046), **CSV import** (GA-085), **notifications** (GA-047) | The tenant is already provisioned and its staff already exist. These matter for tenant #2, not for service #1 |
| **Modifiers** (GA-041, GA-042), **wastage** (GA-030), **stock ledger** (GA-044), **real GRN** (GA-039), **financial statements**, **NLQ depth** | Real gaps. None of them stops a plate reaching a table |
| **Global business-object search** (GA-020) | Ship the 0.5-day nav-only version so the palette stops lying; defer the real thing |
| **The full print agent** (GA-012 as scoped, 18 days) | See §4.3 — a 3-day `window.print()` bill is the demo-grade substitute. The agent is Phase 30 and stays there |

### 4.2 Tier 0 — Stop the bleeding (≈3 days, all frontend, no dependencies)

Every item is under a day, and every item is something the user personally saw.

| ID | Fix | Days |
|---|---|---:|
| GA-006 | Delete `"LOYALTY_POINTS"` from `charge-summary.tsx:23-29`. **One line removes a free-food button.** The redeem endpoint follows in Phase 17 | 0.1 |
| GA-053 | Add `comingSoon: true` to `sidebar-nav-items.ts:357`. **One line removes the product's only live 404** | 0.1 |
| GA-002 | `use-nav-visibility.ts:29` — render optimistically or show a skeleton while pending, never `false` | 0.5 |
| GA-007 | Divide by 100 in `journal-entries/[id]/page.tsx:93,99`. **The money is currently displayed 100× too large** | 0.5 |
| GA-023 | Pass a `CLOSED` status filter in `tenant-dashboard.tsx:110`, or read the tiles endpoint. The dashboard currently says Rs 0.00 while the till holds Rs 37,050 | 0.5 |
| GA-032 | Resolve the sidebar brand from the session, not `NEXT_PUBLIC_DEFAULT_TENANT_SLUG` | 0.5 |
| GA-078 | Route HR money through `MoneyDisplay` | 0.5 |
| GA-092, 093, 094, 095, 096, 091, 059 | Delete the no-op theme command, label the checkbox, drop the phantom "E to export", fix breadcrumb casing, remove the dev seed button, guard `/app/reporting`, strip the fake "3 unread" badge | 0.5 |
| | **Tier 0 total** | **≈3.2** |

### 4.3 Tier 1 — Operable: the minimum to run one dinner service (≈26 days)

Ordered by the sequence a service actually happens in.

| # | ID | What it buys | Days |
|---:|---|---|---:|
| 1 | GA-013 | **Force RLS on `pos_db`.** Without it the menu screen shows 37 categories from 15 tenants, 14 identical "Starters" in the item picker, and the tenant sees other restaurants' data. Pull the `pos_db` slice out of Phase 18 and land it now | 3 |
| 2 | GA-001 | **A shared `QueryBoundary` so a failed query can never render as an empty state.** 11 screens. This is the defect most likely to be behind "literally crap" | 3 |
| 3 | GA-005 | **Table CRUD** — `POST`/`PUT`/`DELETE` on `TableController` + `TableService.create`, plus a floor-plan admin screen. A table-service restaurant cannot seat anyone without this | 4 |
| 4 | GA-017 | POS order WebSocket into the gateway's `WS_UPGRADE_PATHS`. Live orders stop falling back to polling and the console stops throwing 4 errors per page load | 0.5 |
| 5 | *Phase 14* | **W1 + W2 money-path repair.** A discounted order currently produces an unbalanced JE that trips the deferred trigger and never reaches the ledger — and finance/crm/reporting have no `listener` block, so it requeues forever. A restaurant runs discounts | 5 |
| 6 | GA-012‑min | **A printed bill.** Not the agent — an HTML `@page { size: 80mm auto }` receipt from the charge screen plus a kitchen-ticket print view. A restaurant cannot serve a customer without giving them a bill | 3 |
| 7 | GA-003 | **User-management UI.** Create a waiter, assign a branch role, deactivate, reset password. Also the only way to set `approval_limit_paisa` from inside the product | 5 |
| 8 | GA-027 | A wrong TOTP code must say so. Three of eight personas use TOTP and currently see **nothing** on a wrong code | 1 |
| 9 | GA-016 | file-service Feign host — it 500s on **every** request today and fills the logs during any demo | 0.5 |
| 10 | GA-025 | Map `FeignException$ServiceUnavailable` to 503, not 500. This is why GA-004 was misdiagnosed as a permission gap for weeks | 1 |
| | | **Tier 1 total** | **≈26** |

**Tier 0 + Tier 1 = ≈29 dev-days ≈ 38 delivered at 1.3× ≈ 8 weeks solo, ~4 weeks with two engineers.**

At that point Floating Terrace can: seat a table, take an order on a menu that shows only their own
items, fire it to a kitchen that sees it live, take payment without giving food away, hand the
customer a bill, close the till, and read the day's real takings on a dashboard that does not lie
when a service blips.

### 4.4 Tier 2 — Credible: what a buyer judges before signing (≈22 days)

Not required to run a service. Required before anyone pays for it.

| ID | What | Days |
|---|---|---:|
| GA-014 + GA-015 | **Menu-item images end-to-end** (schema → DTO → `FileRepository.upload` posting FormData → file input in the dialog → thumbnail in the POS grid). This is the difference between a POS grid and a spreadsheet, and the user named it first | 5 |
| GA-009 + GA-019 | A tenant settings shell and a profile page with self-service password change | 6 |
| GA-004 | Set `approval_limit_paisa` — makes the entire purchasing module demonstrable rather than dead at step 3 of 6 | 1 |
| GA-034, GA-035, GA-074 | Responsive repair: overflow the tab bars, collapse the sidebar at tablet width, 44px tap targets on POS | 3 |
| GA-026 | Tax fields in the menu form — otherwise every item the customer creates is silently zero-rated | 1 |
| GA-031 | Split bill. Parties split bills constantly in table service | 3 |
| GA-036 + GA-077 | Rupees not paisa in the JE form; one shared date formatter | 2 |
| GA-020 | Nav-only search that at least finds real routes (stopgap; full search deferred) | 0.5 |
| | **Tier 2 total** | **≈21.5** |

**Full demo-able target: ≈51 dev-days ≈ 66 delivered ≈ 13 weeks solo, ~7 weeks with two engineers.**

### 4.5 The one thing to say out loud

Of the 51 days, **roughly 14 are backend** — the money-path repair (5), the `pos_db` RLS conversion
(3), the table create/update/delete endpoints (2), the menu-item image column and DTO (1.5), the
gateway WebSocket path (0.5), the file-service Feign host (0.5), and the 503 mapping (1). **The other
37 are frontend against APIs that already exist, already pass tests, and already return `200`.**

**The gap between "we built a lot" and "the app is crap" is almost entirely a missing frontend, and
closing it to a demonstrable standard is a quarter's work for two people — not a rewrite.**

---

## 5. Roadmap deltas

### 5.1 One new phase — and only one

> #### Phase 14b — Truth and trust triage · **3 days** · no dependencies · Track: C · **parallel with 14**

**Why it must exist rather than fold into 20/22:** every item is frontend-only, under a day, and is
something the user personally reported. Phases 20 and 22 are 14 and 16 days and gated on a design
system that is ~10 weeks out. The user's complaint is now. This phase is deliberately tiny and
deliberately unblocked by anything.

**Scope:** GA-001 (QueryBoundary — the one substantial item, may run 3 days on its own),
GA-002, GA-007, GA-023, GA-032, GA-078, GA-053, GA-006 (the one-line tender removal),
GA-091, GA-092, GA-093, GA-094, GA-095, GA-096, GA-059 (badge strip only).

**Done when:** a forced 500 on any list screen renders an error with a Retry and never an empty
state; a 503 on `/api/v1/feature-flags` does not remove a nav item; no money value on any screen is
100× wrong; the sidebar shows the signed-in tenant's name; and the product contains zero live 404s
and zero no-op controls.

It does not renumber anything. It is a parallel track alongside Phase 14.

### 5.2 Existing phases that must change scope

| Phase | Change | Δ days |
|---|---|---:|
| **14** — Money-path, event-bus, unbounded-wait | **Add:** GA-016 (file-service Feign host — it 500s on every request today), GA-025 (`FeignException$ServiceUnavailable` escaping as a 500 from `PoApprovalService.java:105`). Both are boundary-repair shaped and both are actively poisoning diagnosis. **Also pull in the `pos_db` + `purchasing_db` FORCE-RLS slice from Phase 18** — see §5.3 | 5 → **9** |
| **15** — Verification spine | **Add:** GA-103 — reseed Floating Terrace with enough data (tables, employees, leave types, a closed till, a received PO) that the smoke tier can actually assert on a back office. Today five modules cannot be exercised at all | 10 → **11** |
| **16** — Tenant configuration spine | Already owns GA-009, GA-018, GA-022, GA-032, GA-045. **Add:** GA-026 (tax fields in the menu form — the spine is pointless if the form discards the value), GA-054 (pos-service encryption fail-fast — the kernel's `tenant_secrets` gate must be copied into pos-service *before* Phase 30/35 read a token during a sale), GA-056 (typed branch address + stop swallowing every `DataIntegrityViolationException` into a duplicate-name error), GA-066 (`/settings/appearance` has no guard), GA-098 | 22 → **25** |
| **17** — API reachability and boundary repair | Already owns loyalty redeem, modifier CRUD, stock-count GETs, table CRUD, the audit route and the POS WS path. **Add:** GA-024 (report catalog returns full SQL and ClickHouse schema to any report viewer — a live information leak), GA-067 (`GET /api/v1/branches` ungated, returns `ntn`/`fbrStrn`/`receiptConfig` to KITCHEN_STAFF), GA-004 (`approval_limit_paisa`), GA-089 (duplicate `my-branches` surface) | 12 → **15** |
| **18** — RLS harness and FORCE rollout | **Reorder, do not rescope.** See §5.3 | 15 → **12** |
| **21** — SuperAdmin console, subscriptions, metering | Already names all three usage defects inside the dead code. **Add:** GA-082 (tier branch limit unenforced on `BranchService.create` — six extra branches provisioned live on a `max_branches=5` tenant) and a tenant-readable limits endpoint, since `PlatformAdminController` is class-annotated SUPER_ADMIN and the tenant plane cannot self-limit | 24 → **26** |
| **22** — Screen rebuilds | Its "shell and navigation last" bullet is too small for what the audits found. **Add explicitly:** GA-033 (session expiry with no `?next=`), GA-036/GA-077 (money and date unification — three distinct money bugs contradicting `shared.ts:1-2`), GA-038 (PO list showing truncated UUIDs), GA-040/GA-069/GA-070/GA-090 (nav-vs-permission drift), GA-068 (INVENTORY_MANAGER lands on the Kitchen screen), GA-071 (two purchasing screens with zero buttons), GA-079, GA-081, GA-031 | 16 → **20** |
| **23** — Admin and missing-UI surfaces | **The premise is stale and the scope is short.** Its stated blocker — "no handling for `403 PASSWORD_CHANGE_REQUIRED`" — **is fixed**; I drove it successfully. Replace it with **GA-008: `401 TOTP_ENROLLMENT_REQUIRED` has no UI, and the message tells a solo owner to ask an administrator who does not exist.** That is the real onboarding gate and it appears in **no** roadmap document. **Also add:** GA-019 (profile + self-service password change), GA-043 (forgot password), GA-028 (RBAC admin), GA-060/GA-061 (customer edit/delete, promotion apply), GA-062 (stock-count and receipt history), GA-063 (audit reader), GA-088 (leave list), GA-065, GA-075, GA-080, GA-100 | 11 → **18** |
| **24** — Real goods receipt | Unchanged in scope. Note GA-057 (negative stock to −3000 with no floor) is a *consequence* — it cannot be closed until receipts post | — |
| **26** — Waste capture and control | **Add:** GA-044 (stock-movement ledger has 7 writers and 0 readers — the variance report in Phase 33 is unauditable without it) and GA-057 (a negative-stock floor + alert) | 20 → **23** |
| **29** — Guided tenant onboarding | Its "Reality" paragraph should record that the *first* blocker is TOTP enrolment (GA-008, now owned by 23), not provisioning. **Add:** GA-058 (`tenant_payment_methods` — already in its scope item 8; keep) and GA-085 (CSV import — already scope item 7; keep). No day change, but the dependency on 23 becomes hard rather than soft | — |
| **30** — Receipt and kitchen printing | **Split the minimum out.** Add a 3-day `window.print()` / `@page { size: 80mm auto }` bill and kitchen-ticket view **to Tier 1 of the demo path** (see §4.3), landing in Phase 22 or 14b. Phase 30 keeps the agent, the ESC/POS renderer, the SQLite queue, the drawer kick and the calibration print unchanged. The CSS fallback was always in Phase 30's scope; it just needs to ship first | 18 → **15** (+3 pulled forward) |
| **35** — FBR / provincial digital invoicing | **Explicitly off the demo path** — Floating Terrace is not registered. Add GA-055 (no province/jurisdiction anywhere; both branch addresses are `null`) as a **hard prerequisite owned by Phase 16**, because the authority choice is upstream of every other FBR decision and must be data, never an assumption. Add GA-101 (no QR library in any `pom.xml` or `package.json`) | — |
| **37** — Scalability and operability | **Add:** GA-102 (Eureka reports `UP` while the port answers nothing — already tracked as task #12) and GA-064 (only 14 of 16 services register; `/app/nlq` is a visible nav item with a 503 behind it) | 22 → **24** |

### 5.3 The one genuine reordering

**Pull the `pos_db` and `purchasing_db` FORCE-RLS conversion out of Phase 18 and into Phase 14.**

Phase 18 currently sits "after 15" and converts six databases as a batch. But two of them are
**live, observed, cross-tenant reads today**:

- `owner@terrace.local` received **37 menu categories spanning 15 tenants** for a tenant that owns 3.
- A cross-tenant **vendor** leak was observed at 07:26 during the back-office audit and fixed
  mid-audit by an RLS-force migration on `purchasing_db`.

`pos_service` has **2 `FORCE` statements against 224 fleet-wide**, and `pos_user` owns its tables via
Flyway, so RLS does not bind it — tenant isolation on the core transactional service is service-layer
only. This is not a test-harness improvement; it is a data-exposure fix, it makes the Menu screen
usable, and it is a prerequisite for the demo. The remaining twelve databases stay in Phase 18 with
its harness work, one PR at a time, as designed.

Everything else in the roadmap's ordering survives contact with these audits unchanged.

### 5.4 Effort impact on the programme

| Phase | Was | Now | Δ |
|---|---:|---:|---:|
| 14 Money-path / bus / timeouts | 5 | 9 | +4 |
| 15 Verification spine | 10 | 11 | +1 |
| 16 Tenant configuration spine | 22 | 25 | +3 |
| 17 API reachability | 12 | 15 | +3 |
| 18 RLS harness (pos/purchasing slice moved to 14) | 15 | 12 | −3 |
| 21 SuperAdmin console + metering | 24 | 26 | +2 |
| 22 Screen rebuilds | 16 | 20 | +4 |
| 23 Admin + missing-UI surfaces | 11 | 18 | +7 |
| 26 Waste capture | 20 | 23 | +3 |
| 30 Printing (CSS bill pulled forward) | 18 | 15 | −3 |
| 37 Scalability + operability | 22 | 24 | +2 |
| **New Phase 14b** — Truth and trust triage | — | 3 | +3 |
| | | **Net** | **+26** |

| | Raw days | At 1.3× |
|---|---:|---:|
| ROADMAP-14-PLUS as written | 423 | 550 |
| Revised | **449** | **≈584** |

**+26 raw days, +34 delivered — a 6% increase on a 423-day programme.** The register does not blow
up the plan; **it reorders the first six weeks of it.** The critical path
`14 → 15 → 16 → 19 → 22 → 23 → 29` is unchanged in shape, and the demo-able target in §4 is a
deliberate 51-day slice cut across phases 14, 14b, 17, 18, 22 and 23 — not a new track. The
calendar in ROADMAP §7.3 (3 engineers ≈ 10 months) survives unchanged.

---

## 6. Traceability

Every register ID maps back to at least one source finding. The nine audits produced 168 findings;
after deduplication the highest-corroborated defects were:

| Defect | Independently reported by |
|---|---:|
| GA-003 no user-management UI | **7 of 9 audits** |
| GA-005 dining tables cannot be created | **7 of 9** |
| GA-014 menu items have no image | **7 of 9** |
| GA-020 top-bar search searches nothing | **6 of 9** |
| GA-009 / GA-019 no settings, no profile | **5 of 9** |
| GA-021 branch CRUD has no UI | **5 of 9** |
| GA-053 `/platform/tenants` 404 | **5 of 9** |

Seven audits, working independently with different methods — static trace, live curl, headless
browser, role-by-role probe, fresh-tenant provisioning — converged on the same four defects the user
named unprompted. **The user's report was accurate. The register exists to say how much and in what
order.**
