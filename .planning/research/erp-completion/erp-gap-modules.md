# ResturantOS — ERP Module Inventory and Gap Analysis

Date: 2026-08-07 · Branch: `phase-13-access-repair` · Method: read every `*Controller.java`
under `services/`, every `@Entity` class, the gateway route table
(`gateway/src/main/resources/application.yml`), every Next.js `page.tsx` under `frontend/app/`,
and every file in `frontend/lib/repositories/`.

Nothing below is inferred from a directory name. Every claim cites a path I opened.

---

## 0. How to read the "Status" column

The single most useful distinction in this document:

| Status | Meaning |
|---|---|
| `FULL` | Domain code + HTTP endpoint + gateway route + a frontend page that calls it |
| `NO_UI` | Backend built, endpoint live, gateway route present — **zero frontend code calls it** |
| `NO_API` | Domain code / entities / services exist — **no `@RestController` maps to them** |
| `INTERNAL_ONLY` | Only an `/internal/**` controller — no `/api/v1` path, so no browser can reach it |
| `NOT_ROUTED` | Controller exists but the gateway has no `Path=` predicate that reaches it |
| `MOCK_ONLY` | Only implementation is a simulator gated behind a config flag |
| `ABSENT` | No entity, no service, no controller, no migration anywhere in the repo |

---

## 1. Service inventory — what each service actually exposes

### `services/audit-service`
- Controllers (1): `controller/AuditInternalController.java` → `GET /internal/audit/events`
- Entities: `AuditEventEntity`, `ProcessedEventEntity`
- **Gateway: no `audit` route exists** (`grep -n audit gateway/src/main/resources/application.yml` → no match)
- Status: `INTERNAL_ONLY` + `NOT_ROUTED`. The audit trail is written and immutable
  (`services/audit-service/src/test/java/io/restaurantos/audit/AuditImmutabilityIT.java`) but **no
  tenant admin can read it through any UI or public API.**

### `services/auth-service`
- Controllers (13). Public `/api/v1/auth`: `GET /tenants/{slug}`, `POST /login`, `/refresh`,
  `/logout` (`AuthController.java`); `POST /switch-branch` (`BranchSwitchController.java`);
  `GET /my-branches` (`MyBranchesController.java`); `POST /change-password`,
  `/change-password/forced` (`PasswordChangeController.java`); `POST /reset-password/request`,
  `/confirm` (`PasswordResetController.java`); `POST /2fa/bootstrap`, `/bootstrap/verify`,
  `/setup`, `/verify`, `/disable` (`TwoFactorController.java`); `GET /api/v1/roles`,
  `/api/v1/permissions` (`RoleCatalogController.java`); `GET /.well-known/jwks.json`
  (`JwksController.java`).
- Internal: user lifecycle CRUD, branch-role grant/revoke, tenant provisioning, service token,
  platform token, impersonation, admin password reset.
- Status: `FULL` for the login/2FA path.

### `services/authorization-service`
- Controllers (1): `controller/InternalAuthorizeController.java` → `POST /internal/authorize`
- Gateway declares `- id: authorization-route … Path=/api/v1/authorization/**`
  (application.yml:147-150) — **no controller maps to that path.** Dead route.
- Status: `INTERNAL_ONLY` (by design) with a stale gateway route to delete.

### `services/crm-service`
- Controllers (4): `/api/v1/crm/customers` (POST, GET, GET `/search`, GET `/{id}`, GET
  `/{id}/detail`, PUT, DELETE); `/api/v1/crm/feedback` (POST, GET); `/api/v1/crm/promotions`
  (POST, GET); internal `/internal/crm/customers/lookup`, `/internal/crm/promotions/evaluate`.
- Entities: `CustomerEntity`, `CustomerFeedbackEntity`, `PromotionEntity`,
  **`LoyaltyAccountEntity`, `LoyaltyTierConfigEntity`, `LoyaltyTransactionEntity`**
- Loyalty is implemented — `service/LoyaltyService.java` (`accrueForOrder`, `debitForRefund`,
  `checkTierUpgrade`, `ensureTierConfig`) driven by `consumer/OrderClosedLoyaltyConsumer.java`
  and `consumer/OrderRefundedLoyaltyConsumer.java` — but **there is no `LoyaltyController`.**
  `grep -rn "redeem" services/crm-service/src/main/java` returns nothing.
- Status: customers `FULL`; feedback `NO_UI` (0 frontend refs); promotions read-only in UI;
  **loyalty `NO_API`** for everything except the read-through on `GET /customers/{id}/detail`
  (`service/CustomerService.java` injects `loyaltyAccountRepo`). No earn-rate config, no manual
  adjustment, and **no redemption path at all.**

### `services/file-service`
- Controllers (1): `/api/v1/files` — POST multipart, GET list, GET `/{id}/download`, DELETE, GET `/quota`
- Status: `NO_UI` — `grep -rn "api/v1/files" frontend/lib frontend/app frontend/components` → **0 refs**.

### `services/finance-service`
- Controllers (9): accounts (`GET`, `/search`, `/setup/status`, `/{code}`, `POST`);
  `GET /ap/aging`; AR (`POST|GET /customer-accounts`, `GET /{id}/statement`, `POST /charges`,
  `POST /settlements`, `GET /aging`); expenses (`POST`, `GET`, `GET /{id}`, `/{id}/approve`,
  `/{id}/reject`); GL (`/balances`, `/{accountCode}/entries`); journal entries (`POST`, `GET`,
  `GET /{id}`, `/{id}/post`, `/{id}/reverse`); periods (list, open, get, close, provision);
  two internal controllers.
- Entities: `ChartOfAccount`, `JournalEntry`, `JournalLine`, `AccountingPeriod`, `Expense`,
  `CustomerAccount`, `ArTransaction`, `JeSequence`, `PostedSourceEventEntity`
- Status: `FULL`. GL, AP aging, AR, expenses, periods all have pages under
  `frontend/app/(tenant)/app/finance/`.

### `services/hr-service`
- Controllers (11): ADMS device protocol (`/iclock/cdata`, `/getrequest`, `/devicecmd`);
  attendance (`/{employeeId}/clock-in`, `/clock-out`, `/punches`, `/summary`); devices (POST,
  GET, DELETE); employees (full CRUD); labour-cost (`/branch/{id}`, `/shift/{id}`); leave
  (`GET|POST /requests`, `/requests/{id}/approve`, `/reject`, `GET /balances`, `GET|POST /types`,
  `POST /types/defaults`, `POST /accrue`); payroll runs (`POST`, `/{id}/calculate`, `/approve`,
  `/pay`, `GET /{id}`, `GET`, `/{id}/payslips`); attendance quarantine; shifts (CRUD +
  assignments + `/assignments/move` + `GET /week`); 2 internal.
- Entities include `PayrollRunEntity`, `PayslipEntity`, `TaxConfigEntity`, `LeaveTypeEntity`,
  `LeaveBalanceEntity`, `LeaveAccrualLogEntity`, `AttendanceDeviceEntity`.
- UI pages: `hr/employees`, `hr/attendance`, `hr/payroll`, `hr/schedule` only.
- Status: employees/attendance/payroll/shifts `FULL`. **Leave `NO_UI`** — `hr.repository.ts`
  lines 185-211 define `leave/requests`, `/approve`, `/reject`, `/balances` calls, but the only
  page consuming anything leave-related is `hr/attendance/page.tsx` using `useLeaveTypes()`.
  There is no request/approve screen. **Devices `NO_UI`** (0 refs to `hr/devices`).

### `services/inventory-service`
- Controllers (17). Public: gl-accounts; ingredients (CRUD + archive/restore); categories
  (list, `/tree`, get, POST, PUT, `/{id}/parent`, archive/restore); menu-items catalog (GET);
  opening-balance (POST); receipts (POST); recipes (POST, GET, `/{menuItemId}/effective`,
  `/options`, `/coverage`, **`POST /preview`**); counts (**POST only**); stock (GET); storage
  locations (CRUD + archive/restore); transfers (`/ship`, `/receive`, `/pending`); uom (GET,
  POST); wastage (POST, GET). Internal: grn pending-count, ingredient-categories,
  reorder-shortfalls, uom-codes.
- Recipe costing is real: `dto/RecipeDtos.java` `RecipeCostPreviewDto{batchCostPaisa,
  portionCostPaisa, yieldServings, foodCostPct, lines[]}` with per-line `yieldPct`, computed by
  `service/RecipeCostPreviewService.java` off moving-average cost (`service/MacCalculator.java`).
- Stock-count variance posting is real: `service/StockCountService.java` writes a
  `COUNT_VARIANCE` movement and emits `COUNT_VARIANCE_POSTED` via the outbox.
- Status: ingredients/categories/recipes/coverage/stock/counts/transfers `FULL`
  (`StockCountDialog.tsx`, `StockTransferDialog.tsx` mount on `inventory/stock/page.tsx`).
  **Wastage `NO_UI`** — `grep -rin wastage frontend/{app,components,lib}` matches only a GL-account
  test fixture. **Stock counts have no list/history endpoint** — `StockCountController` is
  `POST` only, so a posted count can never be re-read.

### `services/kitchen-service`
- Controllers (1): `/api/v1/kitchen/kds` — `GET /tickets`, `POST /tickets/{t}/items/{i}/bump`,
  `/status`, `POST /tickets/{t}/recall`, `GET /tickets/{id}`, `GET /stations`
- Status: `FULL` (`app/(tenant)/app/kitchen/**`).

### `services/nlq-service`
- Controllers (1): `POST /api/v1/nlq/query`. Status: `FULL` (`app/(tenant)/app/nlq`).

### `services/notification-service`
- **Zero source files.** Directory contains only `README.md` and `pom.xml`. `<packaging>pom</packaging>`.
  README: *"INTENTIONAL PLACEHOLDER (no implementation) … email delivery declared out of scope"*
  (Phase 13, decision D-31).
- Status: `ABSENT`. Password-reset tokens are minted with no consumer to deliver them.

### `services/platform-admin-service`
- Controllers (5): tenants (POST, GET, GET `/{id}`, PATCH, `/tier`, `/retry-provisioning`,
  `/suspend`, `/reactivate`, `/cancel`, DELETE, `GET /features`, `PATCH /features/{code}`,
  `/impersonate`); platform auth login; public feature flags; tenant user password reset; internal.
- **UI: only `app/(platform)/platform/dashboard/page.tsx` exists.** `sidebar-nav-items.ts`
  declares `{ label: "Tenants", href: "/platform/tenants" }` **without `comingSoon`** → live dead link.
- Status: `NO_UI` for the entire tenant-management surface.

### `services/pos-service`
- Controllers (7): menu (categories CRUD + activate/deactivate, items CRUD + activate/deactivate
  + `PUT /items/{id}/station`); orders (create, list, get, add/remove item, apply promotion,
  discount, send-to-kds, void, refund, instructions, serve item, cancel item, set table);
  payments (`POST /{id}/payments`, `GET`, `POST /{id}/close`, `POST /{id}/split`); stations CRUD;
  tables (`GET`, `PATCH /{id}` status, `GET /{id}/active-order`); tills (open, close, get, list,
  reconciliation, approve, flag, note, review-actions); internal.
- Entities include `Modifier`, `ModifierGroup`, `OrderItemModifier`, `BranchMenuOverride`.
- `OrderType` enum = `DINE_IN, TAKEAWAY, DELIVERY` (+`PICKUP` named in `PosEventPayloads.java:42`).
- Tax: per-item `taxRatePct` / `taxRateCode` on `MenuItem`, applied by
  `service/OrderPricingCalculator.perLineTax`.
- Status: POS/orders/payments/tills `FULL`. **Modifiers `NO_API`** — `Modifier`/`ModifierGroup`
  entities exist and `OrderServiceImpl.java:253-259` writes `OrderItemModifier` rows, but there is
  no modifier CRUD controller and `OrderServiceImpl:257` sets
  `oim.setModifierNameSnapshot(modifierId.toString())` — the snapshot stores a **UUID, not a name**.
  **Table CRUD `NO_API`** — `DiningTableRepository` exposes only `findByBranchId` and
  `findByIdAndBranchId`; tables come from `db/migration/V1__pos_schema.sql`. **Stations `NO_UI`**
  (0 frontend refs to `/api/v1/pos/stations`).

### `services/purchasing-service`
- Controllers (10): purchase orders (POST, GET, GET `/{id}`, submit, withdraw, approve, reject,
  send, close); vendors (GET, POST, PUT); vendor items + **price lists** (`GET|POST
  /vendors/{id}/items`, `PUT /vendor-items/{id}`, archive, `GET|POST /vendor-items/{id}/prices`,
  `GET /vendors/{id}/price-changes`, `GET|PUT /vendors/{id}/categories`); vendor invoices (POST,
  GET, GET `/{id}`, `POST /{id}/override-match`); AP payments (POST); bank-account lookup;
  order suggestions (GET, `POST /drafts`); vendor analytics (`/scorecard`, `/spend`);
  **`MockGrnController`** (`POST /purchase-orders/{poId}/mock-receive`); internal.
- **GRN is a simulator.** The only producer of `GRN_RECEIVED` in the whole repo is
  `service/GrnReceiptSimulator.java` (lines 191-192). `MockGrnController` returns 404 unless
  `InventoryIntegrationProperties.isMockMode()`, and `application.yml:72` defaults
  `integration-mode: mock`. There is no `Grn` entity — only `MockGrnReceipt`.
- Status: PO/vendor/invoice/3-way-match/price-list `FULL`. **GRN `MOCK_ONLY`.**

### `services/reporting-service`
- Controllers (2): `GET /reporting/dashboard/{branchId}/tiles`; `GET /reports`,
  `POST /reports/{code}/run`, `GET /reports/fbr-tax-summary`
- Report catalog (`report/ReportCatalog.java:36-42`) — exactly 7 reports:
  `sales-by-day`, `sales-by-item`, `sales-by-hour`, `sales-by-order-type`, `discount-summary`,
  `till-sessions`, `purchases-by-po`.
- `service/ReportService.java:81`: *"COGS and margin require Inventory (Phase 8) and are not yet available"*
- Status: `FULL` but thin. **No COGS, no food-cost %, no labour-cost %, no P&L, no trial balance.**

### `services/user-service`
- Controllers (3): branches (`POST`, `GET`, `GET /mine`, `GET /{id}`, `PUT`, `DELETE`);
  user admin (`GET`, `GET /{id}`, `POST`, `PATCH`, deactivate, reactivate, reset-password,
  `POST|DELETE /{userId}/branch-roles`, `GET /{userId}/permissions`); internal branches.
- Status: **`NO_UI` for both.** `frontend/lib/repositories/branch.repository.ts` calls only
  `/api/v1/branches/mine`. Nothing calls `/api/v1/users`. `sidebar-nav-items.ts` marks
  `/app/settings/users` and `/app/settings` `comingSoon: true`.

---

## 2. Gap table vs. a standard restaurant-ERP feature set

External baseline used for "what a complete restaurant ERP has":
- Restroworks, *Core Functionalities of Restaurant ERP Systems* — inventory & supply chain, POS
  order taking & fulfillment, menu management & recipe costing, procurement & vendor management,
  multiple-location management, customer engagement & loyalty, analytics & BI, plus payroll &
  scheduling, accounting, multi-entity, forecasting, HACCP.
  https://www.restroworks.com/blog/best-erp-software-for-restaurant/
- PosBytz product page — POS, CRM, KDS, inventory, recipe & production, QR ordering, online
  ordering & delivery with aggregator integration (Uber Eats, Zomato, Swiggy, Careem, Talabat),
  accounting, food costing, multi-outlet, delivery-zone/rider tracking.
  https://posbytz.com/restaurant/

I could not fetch Oracle's MICROS page (HTTP 403), so no Oracle claim appears here.

| # | Module | Status | Owning service | Severity | Evidence |
|---|---|---|---|---|---|
| 1 | POS / order capture | `FULL` | pos-service | — | `pos/web/OrderController.java`, `app/(tenant)/app/pos` |
| 2 | Payments / split / refund | `FULL` | pos-service | — | `pos/web/PaymentController.java` |
| 3 | KDS | `FULL` | kitchen-service | — | `kitchen/web/KdsController.java` |
| 4 | Menu / category management | `FULL` | pos-service | — | `pos/web/MenuController.java`, `app/menu/items` |
| 5 | **Menu modifiers / option groups** | **`NO_API`** | pos-service | **CRITICAL** | `Modifier.java`, `ModifierGroup.java` exist; no controller; `OrderServiceImpl.java:257` snapshots a UUID as the name |
| 6 | Recipe / BOM | `FULL` | inventory-service | — | `inventory/web/RecipeController.java` |
| 7 | Recipe costing + yield + food-cost % | `FULL` | inventory-service | — | `RecipeCostPreviewDto`, `POST /recipes/preview`, `app/inventory/recipes/[menuItemId]` |
| 8 | Ingredients / UoM / categories | `FULL` | inventory-service | — | `IngredientController`, `UnitOfMeasureController`, `ItemCategoryController` |
| 9 | Stock levels / moving-avg cost | `FULL` | inventory-service | — | `StockLevelController`, `MacCalculator.java` |
| 10 | Stock take (post) | `FULL` (write) | inventory-service | — | `StockCountService.postCount`, `StockCountDialog.tsx` |
| 11 | **Stock-count history / re-read** | **`NO_API`** | inventory-service | **IMPORTANT** | `StockCountController.java` has only `@PostMapping` |
| 12 | **Wastage / spoilage** | **`NO_UI`** | inventory-service | **CRITICAL** | `WastageController` POST+GET live; 0 frontend refs |
| 13 | Stock transfers (inter-branch) | `FULL` | inventory-service | — | `TransferController`, `StockTransferDialog.tsx` |
| 14 | Vendors / supplier master | `FULL` | purchasing-service | — | `VendorController.java` |
| 15 | Supplier price lists + price-change tracking | `FULL` | purchasing-service | — | `VendorItemController.java` `/prices`, `/price-changes` |
| 16 | Purchase orders + approval workflow | `FULL` | purchasing-service | — | `PurchaseOrderController.java`, `PoApprovalTier` |
| 17 | **GRN / goods receipt** | **`MOCK_ONLY`** | purchasing-service | **CRITICAL** | only producer of `GRN_RECEIVED` is `GrnReceiptSimulator`; `MockGrnController` 404s unless `integration-mode=mock` (default `mock`, `application.yml:72`); no `Grn` entity |
| 18 | Vendor invoice + 3-way match | `FULL` | purchasing-service | — | `VendorInvoiceController`, `ThreeWayMatchTable.tsx` |
| 19 | AP payments | `FULL` | purchasing-service | — | `ApPaymentController`, `app/purchasing/payments` |
| 20 | GL / chart of accounts / journals | `FULL` | finance-service | — | `GlController`, `JournalEntryController`, `AccountController` |
| 21 | AP aging | `FULL` | finance-service | — | `ApArController`, `app/finance/ap-aging` |
| 22 | AR / house accounts | `FULL` | finance-service | — | `ArController`, `app/finance/house-accounts` |
| 23 | Period close | `FULL` | finance-service | — | `PeriodController` |
| 24 | Expenses + approval | `FULL` | finance-service | — | `ExpenseController` |
| 25 | **Tax engine (multi-rate, jurisdiction, exemptions)** | **partial** | pos-service + reporting-service | **IMPORTANT** | only a flat `taxRatePct`/`taxRateCode` per menu item (`OrderPricingCalculator.perLineTax`); FBR summary report exists (`FbrTaxSummaryService.java`); no tax-code master table, no service charge, no exemption rules |
| 26 | **Financial statements (P&L, balance sheet, trial balance)** | **`ABSENT`** | finance-service | **CRITICAL** | `ReportCatalog.java:36-42` lists 7 reports, none of them statements; only GL balances exist |
| 27 | CRM / customer master | `FULL` | crm-service | — | `CustomerController` |
| 28 | **Loyalty (earn/redeem/tiers)** | **`NO_API`** | crm-service | **CRITICAL** | `LoyaltyService.java` accrues on `ORDER_CLOSED` and debits on refund; **no controller, no redeem method, no UI** |
| 29 | Promotions (define + apply) | write API `FULL`, **admin `NO_UI`** | crm-service | IMPORTANT | `PromotionController` POST/GET; frontend only `GET /crm/promotions` (`crm.repository.ts:41`) |
| 30 | **Customer feedback** | **`NO_UI`** | crm-service | NICE_TO_HAVE | `FeedbackController` live; 0 frontend refs |
| 31 | HR employees | `FULL` | hr-service | — | `EmployeeController`, `app/hr/employees` |
| 32 | Attendance + biometric ADMS ingest | `FULL` | hr-service | — | `AdmsController`, `AttendanceController`, `app/hr/attendance` |
| 33 | Shift scheduling | `FULL` | hr-service | — | `ShiftController`, `app/hr/schedule` |
| 34 | Payroll runs + payslips | `FULL` | hr-service | — | `PayrollRunController`, `app/hr/payroll` |
| 35 | **Leave requests / approval / balances** | **`NO_UI`** | hr-service | **IMPORTANT** | `LeaveController` full API; `hr.repository.ts:185-211` has the client fns; **no page calls them** |
| 36 | **Attendance device management** | **`NO_UI`** | hr-service | NICE_TO_HAVE | `AttendanceDeviceController`; 0 refs to `hr/devices` |
| 37 | Reporting / named reports | `FULL` but thin | reporting-service | IMPORTANT | 7 codes only; `ReportService.java:81` admits COGS/margin missing |
| 38 | Realtime dashboard | `FULL` | reporting-service | — | `DashboardController`, `DashboardWebSocketHandler` |
| 39 | NLQ | `FULL` | nlq-service | — | `NlqController` |
| 40 | Multi-branch (data model + switching) | `FULL` | user-service + auth-service | — | `BranchController`, `BranchSwitchController`, `MyBranchesController` |
| 41 | **Branch CRUD admin UI** | **`NO_UI`** | user-service | **IMPORTANT** | `BranchController` full CRUD; `branch.repository.ts` calls only `/branches/mine` |
| 42 | **User / RBAC admin UI** | **`NO_UI`** | user-service | **CRITICAL** | `UserAdminController` (11 endpoints incl. branch-roles); 0 frontend refs; nav marks `/app/settings/users` `comingSoon: true` |
| 43 | **Platform tenant admin UI** | **`NO_UI`** | platform-admin-service | **IMPORTANT** | 13 endpoints in `PlatformAdminController`; only `platform/dashboard/page.tsx` exists; nav links `/platform/tenants` **without `comingSoon`** → dead link |
| 44 | **Audit-trail viewer** | **`INTERNAL_ONLY` + `NOT_ROUTED`** | audit-service | **IMPORTANT** | only `/internal/audit/events`; no gateway route matches `audit` |
| 45 | Table / floor **view** + status | `FULL` | pos-service | — | `TableController` GET/PATCH, `table-floor-view.tsx` |
| 46 | **Table / floor-plan CRUD** | **`NO_API`** | pos-service | **IMPORTANT** | `DiningTableRepository` has only 2 finders; tables seeded by `V1__pos_schema.sql` |
| 47 | **POS station admin UI** | **`NO_UI`** | pos-service | NICE_TO_HAVE | `StationController` CRUD live; 0 refs to `/api/v1/pos/stations` |
| 48 | Shift / cash (till) management | `FULL` | pos-service | — | `TillController` (9 endpoints), `app/pos/tills`, `till-review.tsx` |
| 49 | **Reservations / waitlist** | **`ABSENT`** | *(would be pos-service or a new `reservation-service`)* | **IMPORTANT** | no entity, service, controller or migration anywhere |
| 50 | **Online ordering / customer-facing storefront** | **`ABSENT`** | *(new `online-order-service`)* | **IMPORTANT** | no public/unauthenticated ordering path in the gateway |
| 51 | **Delivery module (zones, riders, dispatch)** | **`ABSENT`** | *(new service)* | **IMPORTANT** | `OrderType.DELIVERY` enum value exists; nothing else |
| 52 | **Aggregator integration (foodpanda/Uber Eats/Talabat…)** | **`ABSENT`** | *(new `integration-service`)* | **IMPORTANT** | `grep -ril "aggregator\|foodpanda\|deliveroo\|ubereats\|doordash"` → 0 hits |
| 53 | **Franchise / royalty / multi-entity** | **`ABSENT`** | platform-admin-service | NICE_TO_HAVE | tenants + branches exist; no franchisee, royalty or consolidation model |
| 54 | **Notifications (email/SMS/push)** | **`ABSENT`** | notification-service | **CRITICAL** | service directory contains only `README.md` + `pom.xml`; `<packaging>pom</packaging>`; README declares it out of scope (D-31) |
| 55 | **File attachments UI** | **`NO_UI`** | file-service | NICE_TO_HAVE | `FileController` live (upload/list/download/quota); 0 frontend refs |
| 56 | Forecasting / production planning | `ABSENT` | inventory-service | NICE_TO_HAVE | `ReorderSuggestionService` is reorder-point only, not forecast |
| 57 | HACCP / temperature / food-safety logs | `ABSENT` | inventory-service | NICE_TO_HAVE | no entity anywhere |
| 58 | QR / table ordering | `ABSENT` | pos-service | NICE_TO_HAVE | no public menu endpoint |

---

## 3. Gaps grouped by *kind* of gap (the actionable view)

### 3a. Built, live API, **no UI whatsoever** — cheapest wins, highest embarrassment risk
| Endpoint(s) | Service | Severity |
|---|---|---|
| `POST|GET /api/v1/inventory/wastage` | inventory-service | CRITICAL |
| `/api/v1/users/**` (11 endpoints incl. branch-roles) | user-service | CRITICAL |
| `/api/v1/hr/leave/**` (9 endpoints; client fns already written) | hr-service | IMPORTANT |
| `/api/v1/branches` CRUD | user-service | IMPORTANT |
| `/api/v1/platform/tenants/**` (13 endpoints; nav link is live and 404s) | platform-admin-service | IMPORTANT |
| `/api/v1/pos/stations` CRUD | pos-service | NICE_TO_HAVE |
| `/api/v1/hr/devices` | hr-service | NICE_TO_HAVE |
| `/api/v1/crm/feedback` | crm-service | NICE_TO_HAVE |
| `/api/v1/files/**` | file-service | NICE_TO_HAVE |

### 3b. Built domain code, **no API to reach it**
| Domain code | Service | Missing controller | Severity |
|---|---|---|---|
| `LoyaltyService` + 3 entities + 2 consumers | crm-service | `LoyaltyController` (balance, adjust, **redeem**, tier config) | CRITICAL |
| `Modifier` / `ModifierGroup` entities | pos-service | `ModifierController` + order-line modifier selection | CRITICAL |
| `DiningTable` (repo has 2 finders) | pos-service | table/floor CRUD | IMPORTANT |
| `StockCount` / `StockCountLine` (write-only) | inventory-service | `GET /counts`, `GET /counts/{id}` | IMPORTANT |
| `AuditEventEntity` | audit-service | `/api/v1/audit/events` + gateway route | IMPORTANT |

### 3c. **Mock standing in for a real subsystem**
| Subsystem | Service | Severity |
|---|---|---|
| Goods receipt — `GrnReceiptSimulator` is the only `GRN_RECEIVED` producer; there is no `Grn` entity, no partial/over-receipt handling, no receipt reversal | purchasing-service | CRITICAL |

### 3d. **Not built at all**
| Module | Would-be owner | Severity |
|---|---|---|
| Notifications (email/SMS/push) | notification-service (empty stub) | CRITICAL |
| Financial statements — P&L, balance sheet, trial balance | finance-service + reporting-service | CRITICAL |
| COGS / food-cost % / labour-cost % reporting | reporting-service | CRITICAL |
| Reservations / waitlist | new `reservation-service` (or pos-service) | IMPORTANT |
| Online ordering storefront | new `online-order-service` | IMPORTANT |
| Delivery dispatch (zones, riders) | new service | IMPORTANT |
| Aggregator integration | new `integration-service` | IMPORTANT |
| Tax-code master / service charge / exemptions | pos-service + finance-service | IMPORTANT |
| Franchise / royalty / consolidation | platform-admin-service | NICE_TO_HAVE |
| Forecasting / production planning | inventory-service | NICE_TO_HAVE |
| HACCP / temperature logs | inventory-service | NICE_TO_HAVE |
| QR table ordering | pos-service | NICE_TO_HAVE |

### 3e. Route hygiene bugs found while inventorying
- `gateway/.../application.yml:147-150` routes `/api/v1/authorization/**` to authorization-service,
  which has no controller on that path. Dead route.
- `frontend/components/shared/sidebar-nav-items.ts` `platformNavItems` links `/platform/tenants`
  with no `comingSoon` flag; no such page exists → live 404 in the platform sidebar.

---

## 4. What I could not verify

- I did not run the build or start the stack, so "live endpoint" means *the controller is mapped
  and a gateway `Path=` predicate reaches it*, not *it returns 200 at runtime*.
- Permission-catalog completeness (whether every `@PreAuthorize` authority is actually seeded)
  was out of scope here; `sidebar-nav-items.ts` comments claim HR and reporting permissions were
  historically missing from the DB catalog, which I did not independently confirm.
- The Oracle MICROS feature page returned HTTP 403, so the external baseline rests on the two
  sources cited in §2 only.
- I did not audit `frontend/e2e/` or `__tests__/`, so a module could conceivably have test-only
  UI coverage I did not count; every `NO_UI` claim above is based on `frontend/app`,
  `frontend/components`, and `frontend/lib`.
