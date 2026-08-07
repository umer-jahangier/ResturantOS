# CRUD completeness audit — every domain entity, every layer

**Date:** 2026-08-07
**Method:** static trace of all 7 layers (migration → JPA → service → controller → gateway route →
frontend repository → UI route), plus live probing of the running stack (gateway `:8080`, frontend
`:3000`, tenant `floating-terrace`) with curl and the browser.
**Evidence standard:** every ABSENT cell below is backed by a file path + line, or an observed HTTP
status / DOM inspection. Nothing here is an impression.

---

## Verdict on the two claims I was asked to verify

**Claim 1 — "five built domains have no controller at all."**
**CONFIRMED, and it is an undercount. There are nine.** Each has a table, a JPA entity, and in most
cases a repository and service that write to it — and no `@RestController` anywhere reaches them:

| Domain | Entity file | repos referencing | services referencing | controllers referencing |
|---|---|---|---|---|
| Loyalty account | `services/crm-service/.../entity/LoyaltyAccountEntity.java` | 4 | 3 | **0** |
| Stock movement | `services/inventory-service/.../domain/model/InventoryMovement.java` | 8 | 7 | **0** |
| Stock lot | `services/inventory-service/.../domain/model/StockLot.java` | 7 | 6 | **0** |
| Branch menu override | `services/pos-service/.../domain/model/BranchMenuOverride.java` | 3 | 3 | **0** |
| Modifier | `services/pos-service/.../domain/model/Modifier.java` | **0** | 5 | **0** |
| Modifier group | `services/pos-service/.../domain/model/ModifierGroup.java` | **0** | **0** | **0** |
| Attendance policy | `services/hr-service/.../entity/AttendancePolicyEntity.java` | 2 | 1 | **0** |
| PO approval tier | `services/purchasing-service/.../domain/model/PoApprovalTier.java` | 2 | 1 | **0** |
| Tenant match tolerance | `services/purchasing-service/.../domain/model/TenantMatchTolerance.java` | 2 | 2 | **0** |

`ModifierGroup` is the deepest hole in the codebase: a table
(`services/pos-service/src/main/resources/db/migration/V1__pos_schema.sql:75-111`) and an entity, and
**nothing above it at all** — no repository, no service, no controller, no UI.

**Claim 2 — "loyalty accrues points that can never be redeemed."**
**CONFIRMED, and the reality is worse than the claim.** `points_balance` is mutated in exactly two
places in the entire system:

- `services/crm-service/src/main/java/io/restaurantos/crm/service/LoyaltyService.java:67`
  — `account.setPointsBalance(account.getPointsBalance() + points)` (accrual)
- `services/crm-service/src/main/java/io/restaurantos/crm/service/LoyaltyService.java:94`
  — `account.setPointsBalance(account.getPointsBalance() - points)` (**refund clawback only**)

Both are driven by RabbitMQ consumers (`OrderClosedLoyaltyConsumer.java:56`,
`OrderRefundedLoyaltyConsumer.java:57`). There is no `redeem` method, no controller, and live probing
confirms no endpoint: `GET /api/v1/crm/loyalty` → **404**, `/api/v1/crm/loyalty/accounts` → **404**.
The only way a customer's balance ever goes down is by refunding their order.

**The aggravating factor:** `LOYALTY_POINTS` is a live, selectable tender in the POS charge screen
(`frontend/components/pos/charge-summary.tsx:23-29` lists it in `PAYMENT_METHODS`, rendered as an
option). But `PaymentServiceImpl` has no CRM dependency at all — its only Feign client is
`FinanceArClient` (`services/pos-service/.../service/PaymentServiceImpl.java:11,36`). So a cashier can
tender an order to "Loyalty points" and:

1. no points are deducted (nothing calls CRM),
2. no balance is checked (the only guard,
   `PaymentServiceImpl.java:129`, validates the **order** balance, not the points balance — a customer
   with zero points can pay in full),
3. the order closes as paid and the food goes out,
4. finance books it against `LOYALTY_LIABILITY`
   (`services/finance-service/.../autopost/AutoPostingRecipeEngine.java:598`) — a liability reduction
   for points that were never deducted.

That is not a missing feature. It is a **free-food button in production POS** that also corrupts the
GL. Rated BLOCKER below.

---

## The matrix — most incomplete first

Legend: **YES** = present and wired · **PART** = present but incomplete (detail in notes) ·
**ABSENT** = does not exist.

| # | Entity | DB table | JPA entity | Service method | REST endpoint | FE repository | UI screen |
|---|---|---|---|---|---|---|---|
| 1 | **modifier / modifier group** | YES `modifiers`, `modifier_groups` | YES | **ABSENT** | **ABSENT** | **ABSENT** | **ABSENT** |
| 2 | **loyalty account** | YES `loyalty_accounts`, `loyalty_transactions`, `loyalty_tier_config` | YES | PART (accrue + refund only) | **ABSENT** (404 live) | **ABSENT** | PART (read-only tier/points) |
| 3 | **stock movement** | YES `inventory_movements` | YES | YES (7 writers) | **ABSENT** | **ABSENT** | **ABSENT** |
| 4 | **tenant** | YES `tenants` | YES | YES | YES (13 endpoints) | **ABSENT** | **ABSENT** (9-line placeholder + dead link) |
| 5 | **station** (POS) | YES `stations` | YES | YES | YES (full CRUD) | **ABSENT** | **ABSENT** |
| 6 | **user** | YES `users`, `user_branch_roles` | YES | YES | YES (full CRUD) | **ABSENT** | **ABSENT** |
| 7 | **table** | YES `dining_tables` | YES | PART | PART (**no POST/PUT/DELETE**) | PART | PART (no create anywhere) |
| 8 | **role** | YES `roles`, `role_permissions`, `permissions` | YES | YES | PART (**read-only**) | **ABSENT** | **ABSENT** |
| 9 | **wastage** | YES `stock_wastage`, `stock_wastage_lines` | YES | YES | YES (POST+GET) | **ABSENT** | **ABSENT** |
| 10 | **branch** | YES `branches` | YES | YES | YES (full CRUD) | PART (`/mine` only) | **ABSENT** (switcher only) |
| 11 | **stock take** | YES `stock_counts`, `stock_count_lines` | YES | YES | PART (**write-only**) | PART | PART (submit, no history) |
| 12 | **goods receipt** | YES `mock_grn_receipts` + movements | YES | YES | PART (**write-only**) | PART | PART (submit, no history) |
| 13 | **customer** | YES `customers` | YES | YES | YES (full CRUD) | PART (no update/delete/list) | PART (read + create only) |
| 14 | **menu item** | YES `menu_items` | PART (**no image column**) | YES | YES | YES | PART (4-field form, no image) |
| 15 | **account** (CoA) | YES `chart_of_accounts` | YES | YES | PART (no PUT/DELETE) | YES | YES |
| 16 | **vendor** | YES `vendors` | YES | YES | PART (no DELETE) | YES | YES |
| 17 | **attendance** | YES `attendance_punches`, `attendance_devices` | YES | YES | YES | PART (no device calls) | PART (no device admin UI) |
| 18 | **menu category** | YES `menu_categories` | YES | YES | YES | YES | YES |
| 19 | **order** | YES `orders`, `order_items` | YES | YES | YES | YES | YES |
| 20 | **payment** | YES `order_payments` | YES | YES | YES | YES | PART (loyalty tender broken) |
| 21 | **till** | YES `till_sessions`, `till_review_actions` | YES | YES | YES | YES | YES |
| 22 | **shift** | YES `shifts`, `shift_assignments` | YES | YES | YES | YES | YES |
| 23 | **ingredient** | YES `ingredients` | YES | YES | YES | YES | YES |
| 24 | **recipe** | YES `recipes`, `recipe_lines` | YES | YES | YES | YES | YES |
| 25 | **purchase order** | YES `purchase_orders`, `purchase_order_lines` | YES | YES | YES | YES | YES |
| 26 | **invoice** | YES `vendor_invoices`, `vendor_invoice_lines` | YES | YES | YES | YES | YES |
| 27 | **journal entry** | YES `journal_entries`, `journal_lines` | YES | YES | YES | YES | YES |
| 28 | **employee** | YES `employees` | YES | YES | YES | YES | YES |
| 29 | **leave** | YES `leave_requests`, `leave_balances`, `leave_types` | YES | YES | YES | YES | YES |
| 30 | **payroll run** | YES `payroll_runs`, `payslips` | YES | YES | YES | YES | YES |

**Score: 10 of 30 entities are complete at every layer. 17 have at least one ABSENT cell. 6 have a
fully built backend that no screen can reach.**

---

## The six "backend built, no UI" domains

These are the cheapest wins in the codebase — the hard part is already done and shipped:

| Entity | Endpoint that exists | Proof there is no caller |
|---|---|---|
| **tenant** | `/api/v1/platform/tenants` — create, list, get, patch, tier, retry-provisioning, suspend, reactivate, cancel, delete, features, toggle-feature, impersonate (`PlatformAdminController.java:61-225`) | `grep -rn "api/v1/platform" frontend/{app,components,lib}` → **0 hits**. `app/(platform)/platform/dashboard/page.tsx` is **9 lines** reading "SuperAdmin shell placeholder." |
| **user** | `/api/v1/users` — full CRUD + branch-roles + reset-password (`UserAdminController.java:83-218`) | `grep -rn "api/v1/users" frontend/{app,components,lib}` → **0 hits**. `sidebar-nav-items.ts:348`: `comingSoon: true, // /app/settings/users page not built yet` |
| **role** | `GET /api/v1/roles`, `GET /api/v1/permissions` (`RoleCatalogController.java:81,98`) | `grep -rn "api/v1/roles" frontend/…` → **0 hits** |
| **station** | `/api/v1/pos/stations` — full CRUD (`StationController.java:35-59`) | `grep -rn "pos/stations" frontend/…` → **0 hits**. The KDS station picker reads kitchen-service's *different* table via `/api/v1/kitchen/kds/stations`. |
| **wastage** | `/api/v1/inventory/wastage` — POST + GET (`WastageController.java:40,48`) | absent from `frontend/lib/repositories/inventory.repository.ts` |
| **file upload** | `/api/v1/files` — POST multipart, GET, download, DELETE, quota (`FileController.java:67-113`) | `grep -rn "api/v1/files" frontend/…` → **0 hits** |

All six verified live as **HTTP 200** through the gateway with an owner token.

---

## Confirmed defects, with evidence

### BLOCKER — Loyalty points tender gives away food for free and corrupts the GL
Covered in full above. `charge-summary.tsx:23-29` offers the tender; `PaymentServiceImpl.java:11,36`
has no CRM client; `PaymentServiceImpl.java:129` checks only the order balance.
**Owner:** pos-service + crm-service. **Effort:** ~4 days (redeem endpoint, balance check, POS wiring).
Interim mitigation is one line — drop `"LOYALTY_POINTS"` from `PAYMENT_METHODS`.

### BLOCKER — Menu items have no image, at any layer
`services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuItem.java:19-51` declares
`name`, `description`, `basePricePaisa`, `taxRatePct`, `taxRateCode`, `kdsStation`, `stationId`,
`active` — **no image/photo/media column**. Live DOM inspection of the Add-item dialog on
`/app/menu/items` returned:
`labels: [Category, Name, Description, Price (Rs)]`, `input[type=file] count: 0`.
Meanwhile `FileController` already implements multipart upload with quota enforcement and MinIO is
running. This is the "different failure modes" case in miniature: the *upload* backend exists, the
*menu item image field* does not. **Owner:** pos-service + frontend. **Effort:** ~3 days.

### BLOCKER — There is no way to create a dining table anywhere in the system
`TableController.java:29-48` exposes exactly three operations: `GET` (list),
`PATCH /{id}` (status only), `GET /{id}/active-order`. **No POST, no PUT, no DELETE.**
`grep -rn "Add table\|createTable\|addTable" frontend/{app,components,lib}` → **0 hits**.
Tables can only enter the system through the seed script. A restaurant that adds a table to its floor
cannot represent it. **Owner:** pos-service + frontend. **Effort:** ~2 days.

### HIGH — Order modifiers are always free and print as raw UUIDs
`services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java:250-261`:

```java
// Load modifier from item's groups — for simplicity use a direct lookup
// We store snapshot data so we need the modifier entity
OrderItemModifier oim = new OrderItemModifier();
oim.setModifierId(modifierId);
oim.setModifierNameSnapshot(modifierId.toString());   // ← UUID as the display name
oim.setPriceDeltaPaisa(0L);                            // ← every modifier is free
modifierDeltas.add(0L);
```

There is no `ModifierRepository` to look one up with, so the code stores the UUID as the name and
hardcodes the price delta to zero. `kds-ticket-detail.tsx:118-120` renders
`item.modifiers.join(" · ")` — a kitchen ticket would print a UUID instead of "Extra cheese". Any
paid modifier is charged Rs 0. Currently latent because no UI populates `modifierIds`
(`cart-reducer.ts:13` carries the field; nothing fills it), so this becomes a live revenue bug the
moment a modifier picker ships. **Owner:** pos-service. **Effort:** ~3 days.

### HIGH — Stock movement ledger is invisible
`inventory_movements` is written by seven services (`DepletionService`, `StockCountService`,
`IngredientService`, `WastageService`, `TransferService`, `ReceiptService`, `OpeningBalanceService`)
and readable by none — no controller references `InventoryMovement`. A manager cannot answer "why did
my flour drop by 4 kg?" The audit trail exists and has no reader.
**Owner:** inventory-service + frontend. **Effort:** ~3 days.

### HIGH — SuperAdmin has no tenant management UI
`PlatformAdminController` exposes 13 tenant lifecycle endpoints. `app/(platform)/platform/dashboard/page.tsx`
is 9 lines of placeholder text. Tenant is the root entity of a multi-tenant SaaS and it is managed
entirely by curl. **Owner:** frontend. **Effort:** ~5 days.

### HIGH — `/platform/tenants` is a dead link rendered in the sidebar
`frontend/components/shared/sidebar-nav-items.ts:357` declares
`href: "/platform/tenants"` with **no `comingSoon: true`**, so it renders as a live nav item — but
`find app -path "*platform*" -name page.tsx` returns only `dashboard/page.tsx`. Clicking it 404s.
Every other unbuilt route in that file is correctly guarded (`:300`, `:334`, `:348`); this one was
missed. **Owner:** frontend. **Effort:** 0.25 days.

### HIGH — Roles are read-only; RBAC cannot be administered
`RoleCatalogController` has `GET /roles` and `GET /permissions` and nothing else — grepping the file
for `PostMapping|PutMapping` returns empty. Combined with the absent user-management UI, an owner
cannot create a role, change a role's permissions, or assign a user to a branch role from the product
at all. **Owner:** auth-service + frontend. **Effort:** ~5 days.

### MEDIUM — Settings and profile pages do not exist; the fix was to delete the links
`frontend/components/shared/top-bar.tsx:90-92` and `:205-209` document this in the source:

> `/app/settings` … has no `page.tsx` and `sidebar-nav-items.ts:334` has marked it `comingSoon: true`
> all along — only the shell chrome never got the memo. `/settings/profile` was dead the same way.
> … A menu whose every item 404s is worse than a short menu … Profile returns when the page does.

The only surviving settings route is `/settings/appearance` (42 lines). A user cannot view or edit
their own profile or change their password from the UI. **Owner:** frontend. **Effort:** ~4 days.

### MEDIUM — Top-bar search is navigation-only, not business objects
`top-bar.tsx:93-94`: *"The real GlobalSearch (business objects, permission-filtered) is UI-SPEC §4.4 /
step 6; this list stays a stopgap."* ⌘K searches a hardcoded nav list — it cannot find an order, a
customer, a vendor, or a menu item. **Owner:** frontend. **Effort:** ~5 days.

### MEDIUM — Stock takes and goods receipts are write-only
`StockCountController.java:36` and `ReceiptController.java:36` each expose a single `@PostMapping`.
You can submit a stock count and never read it back — no list, no detail, no variance history. Same
for receipts. **Owner:** inventory-service + frontend. **Effort:** ~3 days.

### MEDIUM — Customers cannot be edited or deleted from the UI
`CustomerController.java:81,87` expose `PUT /{id}` and `DELETE /{id}`; `GET /api/v1/crm/customers`
(list) exists at `:69`. `frontend/lib/repositories/crm.repository.ts` implements only
`searchCustomers`, `getCustomer`, `createCustomer`, `listPromotions` — no update, no delete, no list.
A typo in a customer's phone number is permanent. `POST /api/v1/crm/promotions`
(`PromotionController.java:36`) likewise has no caller — promotions are read-only in the UI.
**Owner:** frontend. **Effort:** ~2 days.

### MEDIUM — Branches can be created by API but not by UI
`BranchController.java:48-83` is full CRUD. `frontend/lib/repositories/branch.repository.ts` is 11
lines and calls exactly one endpoint: `/api/v1/branches/mine`. Opening a second location requires
curl. **Owner:** frontend. **Effort:** ~2 days.

### LOW — Attendance devices have endpoints but no screen
`AttendanceDeviceController.java:38,45,51` (POST/GET/DELETE) has no frontend caller.
**Owner:** frontend. **Effort:** ~1.5 days.

---

## Environment observations (NOT product findings)

Recorded so the next reader does not re-investigate them:

1. **`crm-service` and `file-service` were not running.** Absent from Eureka and from `ps`, with no
   recent log file — not a stale lease, never started. `scripts/start-dev.sh:205,211` does start them,
   so the running stack had drifted from the script. I started both from their existing jars; both
   booted clean in ~14 s and every CRM/file endpoint then returned 200. All CRM rows in the matrix
   above were verified *after* that.
2. **`GET /api/v1/audit/events` returns 404 through the gateway**, but `audit-route` is committed at
   `gateway/src/main/resources/application.yml:237-240` (commit `1199450`, 15-01). The running gateway
   binary predates that commit. Stale binary, not a routing gap. *However*, the frontend has zero
   references to `/api/v1/audit` — the audit trail genuinely has no UI, which is a real gap.
3. **`auth-service` crash-looped repeatedly during this audit** with
   `NoClassDefFoundError: ch/qos/logback/classic/spi/ThrowableProxy` — a concurrent `mvn clean verify`
   in the same working tree replaced `auth-service-1.0.0.jar` underneath the running JVM. Killing the
   zombie on `:8081` and relaunching fixed it each time. Environment artifact of parallel agents, not
   a product defect.
4. **Cross-tenant leak corroborated (already tracked).** As `owner@terrace.local`,
   `GET /api/v1/pos/menu/categories/admin` returned **37 categories spanning 15 tenants** (15 named
   "Starters", 15 "Mains"); the tenant actually owns **3**
   (`SELECT count(*) FROM menu_categories WHERE tenant_id='d108c2e6-…'` → 3). The
   `uq_menu_category_tenant_name` constraint and the `tenant_isolation` RLS policy are both present in
   `pos_db`, so the policy is not being applied at runtime. This matches the open task
   *"BLOCKER: live cross-tenant data exposure — 33 tables with inert RLS"* and belongs to that
   workstream, not this one.

---

## Suggested sequencing

**Stop the bleeding first (≈1 day total):** remove `"LOYALTY_POINTS"` from `charge-summary.tsx:23-29`;
add `comingSoon: true` to `sidebar-nav-items.ts:357`. Both are one-line changes that remove a revenue
hole and a 404.

**Then the cheap wins — backend already shipped (≈2 weeks):** wastage screen, station admin, file
upload wiring, branch management, customer edit/delete. Each is frontend-only against a tested API.

**Then the real builds (≈6 weeks):** user + role administration, tenant management console, menu-item
images end-to-end, table CRUD, modifier domain, stock-movement ledger, settings/profile.
