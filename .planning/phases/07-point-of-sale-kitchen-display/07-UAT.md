---
status: gaps_resolved_pending_human_verification
phase: 07-point-of-sale-kitchen-display
source:
  - 07-01-SUMMARY.md
  - 07-02-SUMMARY.md
  - 07-03-SUMMARY.md
  - 07-04-SUMMARY.md
started: 2026-07-10T00:00:00+05:00
updated: 2026-07-11T00:10:00+05:00
---

## Resolution (Gap Closure — 2026-07-11)

All four blocker-severity code gaps below are now resolved via gap-closure plans 07-05..07-08 plus two follow-up fixes found during phase re-verification (commits `ef0de34` fixing the UAT-Test-1 fixes that were left uncommitted, and `edb87f5` fixing a test-harness regression `ef0de34` introduced). See `07-VERIFICATION.md` for full independent re-verification evidence (all previously-failing automated tests now pass, including a direct re-run with `OPA_URL` unset to match CI conditions).

- Test 1 (cold start): all five sub-bugs fixed — Docker reactor validation (07-08 + post-review correction `7448a60`), OPA config mapping, entity/repository scan, `ORDER_SENT_TO_KDS` payload contract (`ef0de34`), dev-startup tooling (07-08).
- Test 5 (payment/close): fiscal-year provisioning bug fixed (07-05).
- Test 6 (till close): `cashierId`/`tillSessionId` linkage fixed (07-06).
- Test 7 (void order): permission grant seeded (07-07).

**Still open, unchanged in scope — genuinely require a browser and/or Docker environment, not code gaps:**
- Test 4 (KDS ticket lifecycle bump/aging, reverse role-isolation direction) — KITCHEN_STAFF/MANAGER demo users now exist (07-07), unblocking this test, but it has not been re-run since no browser automation is available in this environment.
- Test 9 (offline PWA sync) — artifacts present, browser-only test, deferred per original user instruction.
- Test 10 (sidebar nav visibility, MANAGER/OWNER "sees both") — same browser-automation constraint.
- Test 8 (refund) — code-correct on inspection; requires a CLOSED order to exercise, which was blocked by the now-fixed Test 5 bug, but the end-to-end flow was not re-run this session.

## Current Test

[testing complete — see Summary/Gaps]

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running pos-service/kitchen-service/frontend processes. Clear ephemeral state (temp DBs, caches, lock files). Start docker-compose and both services from scratch. Flyway V1/V2/V3 migrations complete without errors on pos-service and kitchen-service, both boot cleanly, and loading the POS terminal page returns live menu/table data.
result: issue
severity: blocker
reported: |
  A genuine cold start (fresh `mvn package` + `docker compose up --build`, not reusing
  stale pre-built jars) fails for pos-service and kitchen-service. Root-caused via direct
  API testing + temporary diagnostic logging (docker not available for browser UI testing
  in this environment; verified via curl/API + log/DB inspection instead). Four distinct
  source bugs found, ALL FIXED in the working tree (uncommitted, not yet reviewed/tested
  by a human):

  1. [BLOCKER] `docker compose up --build` fails entirely (not just for pos/kitchen) —
     eureka-server/Dockerfile and config-server/Dockerfile (and likely others) COPY a
     fixed list of module pom.xml files that predates phase 7; they never added
     `services/pos-service/pom.xml` / `services/kitchen-service/pom.xml`, but root
     pom.xml declares both as `<module>`s. Maven's reactor validates every declared
     module even with `-pl`, so the Docker build aborts with "Child module ... does not
     exist" for EVERY service's Docker image build, not just POS/KDS. NOT YET FIXED —
     worked around by using already-built target/*.jar directly instead of rebuilding
     Docker images.
  2. [BLOCKER] pos-service and kitchen-service application.yml never mapped
     `restaurantos.opa.url` from the `OPA_URL` env var (every other OPA-dependent service,
     e.g. authorization-service, has this mapping). `PosSecurityConfig`/
     `KitchenSecurityConfig` unconditionally require an `OpaClient` bean, which only
     exists if that property is set — so a fresh build can never start either service.
     FIXED: added `restaurantos.opa.url: ${OPA_URL}` to both application.yml files.
  3. [BLOCKER] Neither `PosServiceApplication` nor `KitchenServiceApplication` declared
     entity-scan/repository-scan base packages wide enough to find everything they need.
     pos-service's `@EntityScan` missed `io.restaurantos.pos.entity` (home of
     `ProcessedEventEntity`, used for idempotent event consumption) — "Not a managed
     type" at boot. kitchen-service had NO `@EntityScan`/`@EnableJpaRepositories` at all,
     so it could never resolve `io.restaurantos.shared.event.OutboxRepository` —
     "No qualifying bean of type OutboxRepository". FIXED: added the missing package to
     pos-service's `@EntityScan`; added both annotations (with correct base packages,
     matching the pattern used by every other service) to kitchen-service.
  4. [BLOCKER] Core feature break: kitchen-service's `KitchenEventPayloads.OrderSentToKdsPayload`
     only declared `orderId`+`items`, but pos-service's real `ORDER_SENT_TO_KDS` payload
     also includes `tenantId`, `branchId`, `orderNo`. Jackson's default
     FAIL_ON_UNKNOWN_PROPERTIES rejected every real message — every order sent to the
     kitchen was silently dropped ("could not deserialize message — skipping", no ticket
     ever created). The kitchen-service integration tests never caught this because they
     construct `OrderSentToKdsPayload` directly in Java, bypassing real JSON
     deserialization entirely — a test-coverage gap, not just a code gap. Also found:
     `OrderSentToKdsConsumer` hardcoded `orderNo` to `null` when calling
     `TicketRoutingService.route(...)`, so even a successfully-deserialized ticket would
     have shown a blank order number on the KDS board. FIXED: added the three missing
     fields to the payload record (updated 4 IT test call sites to match); consumer now
     passes the real `orderNo` from the payload.
  5. [MAJOR] pos-service and kitchen-service are not wired into any dev-startup tooling.
     `scripts/start-dev.ps1` and `scripts/restart-service.ps1` only know about
     auth/authorization/user/platform-admin/audit/file/finance-service + gateway +
     frontend — pos-service and kitchen-service must be started manually
     (`mvn -pl services/pos-service spring-boot:run` per a stale comment in
     `deploy/docker-compose.yml`). There is no single supported command for a
     phase-7-inclusive cold start. NOT FIXED — scoped as tooling work, not a phase-7
     code defect; flagging for follow-up.

  Separately (not a bug, a design observation): shared-lib's `GlobalExceptionHandler`
  generic `Exception` handler logged nothing server-side before returning
  `INTERNAL_ERROR` — bug #4 above was fully invisible without adding logging first. Kept
  the added `log.error(...)` line as a permanent fix (silently swallowing 500s with zero
  trace is a real production debugging hazard), not reverted.

  After fixes 2-4, verified end-to-end via direct API calls (login → create order → add
  item → send-to-kds) that pos-service boots clean, serves live menu/table data, creates
  orders, and kitchen-service now correctly consumes ORDER_SENT_TO_KDS and creates a
  correctly-routed (GRILL station) ticket with the right order number in `kds_tickets`.
  Browser-based UI verification (login screen, POS terminal rendering, KDS board) was NOT
  performed — no browser automation tool was available in this session; only backend/API
  verification was done. Frontend integration (whether the Next.js POS/KDS pages
  correctly render this now-working backend data) is UNVERIFIED.

  6. [MINOR] `CreateOrderRequest.coverCount` is a primitive `int` (not `Integer`) with no
     `@NotNull`/default, so a request that legitimately omits it 500s
     ("Cannot map `null` into type `int`") instead of defaulting to 1 like
     `OrderServiceImpl.createOrder` clearly intends (`Math.max(1, request.coverCount())`).
     Only reproduces when a client omits the field; the frontend's Zod schema likely
     always sends it, so real UI usage probably never hits this. NOT FIXED — flagged for
     follow-up, low priority.

### 2. Create an Order on the POS Terminal
expected: Opening the POS page shows a touch-first menu grid and a table floor view. Selecting a table and tapping menu items adds them to the order panel with running totals (MoneyDisplay format). The order is created as DRAFT and moves to OPEN once the first item is added.
result: pass
reported: |
  Verified backend contract via direct API calls (browser UI rendering itself not
  verified — no browser automation available, deferred). Logged in as CASHIER.
  `POST /api/v1/pos/orders` with a table selected created the order as `status: DRAFT`,
  `totalPaisa: 0`, correct `tableId`/`coverCount`. `POST .../items` (Chicken Karahi x2)
  transitioned the order to `status: OPEN` on the very first item add, with
  `subtotalPaisa`/`taxPaisa`/`totalPaisa` correctly recomputed (240000/31200/271200 paisa).
  A second item add (Doodh Patti Chai x2, different KDS station) correctly accumulated
  into running totals (298320 paisa total). Matches expected DRAFT→OPEN-on-first-item
  contract exactly.

### 3. Send Order to Kitchen
expected: With items in the order, sending the order to the kitchen transitions it to SENT_TO_KDS. The Kitchen Display board (on the kitchen-service frontend, always-dark) shows a new ticket within a couple seconds via WebSocket push, grouped by station (e.g. GRILL/DRINKS/DEFAULT), including item notes and modifiers.
result: pass
reported: |
  Order transition verified via API: `POST /api/v1/pos/orders/{id}/send-to-kds` correctly
  moved the order to `status: SENT_TO_KDS` with `sentToKdsAt` populated, order items
  retained their per-station `kdsStation` (GRILL/DRINKS) and notes ("no salt") intact.
  Ticket creation itself (kitchen-service consuming ORDER_SENT_TO_KDS and creating a
  routed `kds_tickets` row) was root-caused and fixed under Test 1 and previously verified
  end-to-end for a prior test order. For THIS session's new orders, ticket creation could
  NOT be independently re-confirmed via the KDS API — see Test 4 (role/permission
  blocker) — nor could the live WebSocket board push or "within a couple seconds"
  timing be observed, since no browser automation is available this session. Deferred:
  live KDS board rendering + WebSocket push timing (browser-only, to be checked when
  automation tooling is integrated).

### 4. Bump Ticket Through Kitchen Lifecycle
expected: On the KDS board, a ticket can be progressed PENDING → COOKING → READY. Ticket cards visually age (green under 10 min, amber+pulse 10-15 min, red+bounce past 15 min). When all tickets for an order are READY, the originating order in POS shows status READY (or PARTIAL_READY if only some stations are done).
result: blocked
blocked_by: other
reason: |
  Cannot obtain a test credential with `pos.kds.view`/`pos.kds.update` permission to call
  the KDS API at all. Per `services/auth-service/.../042-kds-permissions-kitchen-role.xml`,
  those permissions are granted ONLY to KITCHEN_STAFF, MANAGER (view-only), TENANT_ADMIN,
  and OWNER — explicitly excluded for CASHIER, ACCOUNTANT, FINANCE_VIEWER,
  INVENTORY_MANAGER (working as intended for CASHIER — see Test 10). But: (a) no
  KITCHEN_STAFF or MANAGER seed user exists in `900-seed-auth-dev-data.xml` (only
  cashier/owner/accountant/finance_demo are seeded, despite
  `Docs/agent-specs/11-seed-data-specification.md` describing a `chef@demo.local` /
  `manager@demo.local`), and (b) OWNER login requires TOTP step-up
  (`AuthServiceImpl.requiresTotpStepUp` — OWNER has `rbac.manage`), which cannot be
  completed headlessly since the seeded owner has `totp_enabled: false` (never enrolled).
  Ticket bump, aging visuals, and READY/PARTIAL_READY order status rollup are entirely
  UNTESTED. This also blocks browser-based KDS board testing later unless a KITCHEN_STAFF
  (or similar) seed user is added, or OWNER TOTP is enrolled.

### 5. Take Payment (Split-Tender) and Close Order
expected: On a READY/open order, the payment panel lets you split payment across methods. The "CHARGE NOW" button stays disabled until the entered amounts sum exactly to the order total, then becomes enabled. Confirming charges the order, shows a receipt confirmation, and closes the order (table returns to AVAILABLE).
result: issue
severity: blocker
reported: |
  Split-tender sum validation works correctly: `POST /api/v1/pos/orders/{id}/close` with a
  payment sum that doesn't match the order total is correctly rejected
  (`422 PAYMENT_MISMATCH`, "Payment sum mismatch: expected 298320 but got 100000").
  However, closing an order with the CORRECT exact split-tender sum
  (CASH 150000 + CARD 148320 = 298320) fails with `423 PERIOD_LOCKED`:
  "Finance service unreachable — treating period as locked: [404] ... GET
  .../internal/finance/periods/status...". Root cause: `OrderServiceImpl.closeOrder`
  calls `FinancePeriodClient.assertPeriodOpen`, which is fail-closed by design (any
  exception, including a 404, is treated as LOCKED — see the class javadoc). The 404 is
  legitimate: `AccountingPeriodServiceImpl.getPeriodStatus` throws
  `PeriodNotFoundException` because finance-service has NO accounting period row covering
  today's date for this tenant/branch. Checked `finance-service`'s `PeriodController` and
  service layer exhaustively — there is NO REST endpoint, seed data, or scheduled job
  anywhere in the codebase that creates/opens an accounting period. Only
  `list`/`get`/`close` exist; nothing opens one. Net effect: on a fresh tenant (exactly
  the cold-start scenario from Test 1), it is IMPOSSIBLE to ever close a single POS order
  — the entire payment/charge flow is non-functional out of the box, regardless of role.
  Table-returns-to-AVAILABLE and receipt confirmation could not be tested as a
  consequence.

### 6. Open and Close a Till Session
expected: A cashier can open a till session (declaring a starting float) from the till bar before taking payments. Attempting to open a second till while one is already open for that cashier is rejected. Closing the till requires all orders in the session to be CLOSED/VOIDED first, and shows a variance preview (declared vs. expected cash) on close.
result: issue
severity: blocker
reported: |
  Till open works correctly: `POST /api/v1/pos/tills` opened a session with the declared
  float. A second open attempt for the same cashier was correctly rejected
  (`409 TILL_ALREADY_OPEN`). However, the "closing requires all orders in the session
  CLOSED/VOIDED first" gate does NOT function: with two orders still OPEN/SENT_TO_KDS
  under this cashier/branch, `POST /api/v1/pos/tills/{id}/close` succeeded immediately
  (`status: CLOSED`) instead of being rejected. Root cause (read
  `TillServiceImpl.closeTill`): the open-orders check is
  `orderRepository.findByTillSessionId(tillId).stream().anyMatch(...)` — but
  `OrderServiceImpl` (checked exhaustively) NEVER sets `tillSessionId` on any order at
  creation or anywhere else in the order lifecycle. Every order's `tillSessionId` is
  always null, so `findByTillSessionId` always returns an empty list and the gate is
  permanently a no-op — a cashier can close their till with any number of open orders
  outstanding, silently orphaning them from till reconciliation. Separately: the response
  also returned `variancePaisa: null` even though `expectedClosingPaisa` (500000) and
  `declaredClosingPaisa` (500000) were both populated (variance should be 0, not null) —
  the "variance preview on close" contract is not being honored in the response DTO.

### 7. Void an Order
expected: An open/unpaid order can be voided with a required reason via the void dialog. Voiding an order also cancels any associated kitchen tickets on the KDS board automatically.
result: issue
severity: blocker
reported: |
  `POST /api/v1/pos/orders/{id}/void` with a reason, as CASHIER, on an order this same
  cashier created and sent to KDS, was rejected: `403 FORBIDDEN`,
  "Not permitted: pos.void". Investigated the authorization wiring end-to-end:
  `PosAuthorizationService.authorizeVoid` calls OPA with package `pos`, action `void`.
  `policies/restaurantos/pos.rego` defines the void rules against permission codes
  `pos.order.void.own` (cashier voiding their own OPEN order) and `pos.order.void.any`
  (manager-level, any order). Neither `pos.order.void.own` nor `pos.order.void.any`
  appears ANYWHERE in `services/auth-service/.../041-pos-permissions.xml` — they were
  never inserted into the `permissions` table, let alone granted via `role_permissions`
  to CASHIER, MANAGER, TENANT_ADMIN, or OWNER. The void feature is implemented end-to-end
  in code (controller, service, OPA policy) but is completely non-functional for every
  role because the permission rows that would grant access were never seeded. Cascading
  kitchen-ticket cancellation could not be tested as a consequence.

### 8. Refund a Closed Order
expected: A closed/paid order can be refunded (full or partial) via the refund dialog. Refunds above a manager's approval threshold are blocked/require escalation; within-threshold refunds succeed and reduce the recorded payment total.
result: blocked
blocked_by: prior-phase
reason: |
  Refund requires a CLOSED (paid) order as a precondition, and Test 5 established that no
  order can ever reach CLOSED status (payment/close is fully blocked by the missing
  accounting-period bug). Untestable until Test 5's gap is fixed. Separately confirmed via
  code read that the `pos.order.refund` permission IS correctly seeded and granted only to
  MANAGER (not CASHIER) in `041-pos-permissions.xml`, and the rego rule checks
  `approval_limit_paisa >= resource.amount_paisa` — that part of the design looks sound on
  inspection, just unexercised end-to-end.

### 9. Offline Order Creation and Auto-Sync
expected: Disconnecting the network (or using browser devtools offline mode) while on the POS terminal shows an offline indicator banner. Creating an order and adding items while offline still works locally (optimistic DRAFT order). Reconnecting triggers automatic sync — the order appears server-side exactly once (no duplicates), and the sync status badge disappears once fully synced.
result: blocked
blocked_by: other
reason: "Inherently a browser/PWA/IndexedDB test (offline banner, optimistic local state, devtools network throttling) — no browser automation tool available this session. Per user instruction, deferred until automation tooling is integrated."

### 10. Role Isolation — Kitchen Staff vs Cashier
expected: Logging in as a KITCHEN_STAFF user shows only the Kitchen Display in the sidebar (no POS nav item); attempting to access the POS page or API directly is rejected (403). Logging in as a CASHIER shows only POS in the sidebar; attempting to access the Kitchen Display page or API directly is rejected (403). A MANAGER/OWNER sees both.
result: blocked
blocked_by: other
reason: |
  Partially verified at the API layer: logged in as CASHIER and confirmed
  `GET /api/v1/kitchen/kds/tickets` correctly returns `403` ("Not permitted:
  kds.pos.kds.view") — the CASHIER→KDS isolation direction works as intended, consistent
  with CASHIER being explicitly excluded from `pos.kds.*` permissions in the seed data.
  Could NOT test the reverse direction (KITCHEN_STAFF blocked from POS API) because no
  KITCHEN_STAFF seed user exists (same gap as Test 4). Sidebar nav visibility (frontend)
  and the MANAGER/OWNER "sees both" case are entirely untested — sidebar requires
  browser automation (deferred), and OWNER is blocked by the TOTP step-up gap noted in
  Test 4. Full verification needs: (a) a seeded KITCHEN_STAFF test user, (b) browser
  automation for sidebar checks.

## Summary

total: 10
passed: 2
issues: 4
pending: 0
skipped: 0
blocked: 4

## Gaps

- truth: "A genuine cold start (fresh build, not stale jars) boots pos-service and kitchen-service cleanly and serves live data"
  status: failed
  reason: "User reported: cold start required 4 source fixes (missing OPA config, missing entity/repository scan packages in both services, and a broken ORDER_SENT_TO_KDS event payload contract that silently dropped every kitchen ticket) plus 1 confirmed but unfixed Docker build break (Dockerfiles missing COPY of pos-service/kitchen-service pom.xml) and 1 unfixed tooling gap (pos-service/kitchen-service not wired into start-dev.ps1/restart-service.ps1/docker-compose.yml)"
  severity: blocker
  test: 1
  artifacts:
    - eureka-server/Dockerfile
    - config-server/Dockerfile
    - services/pos-service/src/main/resources/application.yml
    - services/kitchen-service/src/main/resources/application.yml
    - services/pos-service/src/main/java/io/restaurantos/pos/PosServiceApplication.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/KitchenServiceApplication.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/event/KitchenEventPayloads.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderSentToKdsConsumer.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/CreateOrderRequest.java
    - scripts/start-dev.ps1
    - scripts/restart-service.ps1
  missing:
    - "Dockerfile module COPY lists for eureka-server/config-server/others don't include pos-service/kitchen-service pom.xml (Docker build still broken, not yet fixed)"
    - "pos-service/kitchen-service have no entry in start-dev.ps1 or restart-service.ps1 (no single-command cold start)"
    - "CreateOrderRequest.coverCount should be boxed Integer or defaulted, not primitive int (minor)"

- truth: "Closing an order with an exact split-tender payment succeeds and closes the order"
  status: failed
  reason: "User reported (via direct API testing): POST /orders/{id}/close with a payment sum exactly matching the order total fails with 423 PERIOD_LOCKED because finance-service has no accounting period covering the current date, and no mechanism anywhere in the codebase (endpoint, seed, scheduled job) ever creates one. FinancePeriodClient.assertPeriodOpen is fail-closed by design, treating the resulting 404 as LOCKED. Payment/close is completely non-functional on any fresh tenant."
  severity: blocker
  test: 5
  root_cause: "No accounting-period bootstrap mechanism exists in finance-service; PeriodController only exposes list/get/close, never create/open. AccountingPeriodServiceImpl.getPeriodStatus throws PeriodNotFoundException (404) for any date with no period row, which pos-service's fail-closed FinancePeriodClient converts to a permanent PERIOD_LOCKED for every close attempt."
  artifacts:
    - services/pos-service/src/main/java/io/restaurantos/pos/feign/FinancePeriodClient.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/finance-service/src/main/java/io/restaurantos/finance/web/PeriodController.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodServiceImpl.java
  missing:
    - "No REST endpoint, seed data, or scheduled job creates/opens accounting periods anywhere in finance-service"
    - "Auto-open-current-period-if-missing fallback (or an explicit provisioning step wired into tenant/branch onboarding) needed so a fresh tenant can process payments"

- truth: "Closing the till requires all orders in the session to be CLOSED/VOIDED first"
  status: failed
  reason: "User reported (via direct API testing): till close succeeded immediately with two OPEN/SENT_TO_KDS orders outstanding for the same cashier/branch. Root cause: OrderServiceImpl never sets tillSessionId on any order, so TillServiceImpl.closeTill's orderRepository.findByTillSessionId(tillId) always returns empty and the open-orders gate is a permanent no-op."
  severity: blocker
  test: 6
  root_cause: "Order entity's tillSessionId field is never populated anywhere in OrderServiceImpl's create/update flow, so the till-close validation query against it can never find a match."
  artifacts:
    - services/pos-service/src/main/java/io/restaurantos/pos/service/TillServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
  missing:
    - "OrderServiceImpl must set tillSessionId on order creation (or on first payment) from the cashier's currently open till session"
    - "TillServiceImpl.closeTill response should surface a non-null variancePaisa (currently null even when expectedClosingPaisa and declaredClosingPaisa are both populated)"

- truth: "An open/unpaid order can be voided with a required reason"
  status: failed
  reason: "User reported (via direct API testing): void request as CASHIER on their own OPEN order rejected with 403 'Not permitted: pos.void'. Root cause: OPA policy (pos.rego) checks permissions pos.order.void.own / pos.order.void.any, but neither permission code exists in the auth-service permission seed data (041-pos-permissions.xml) nor is granted to any role — void is unusable by any role including MANAGER/OWNER."
  severity: blocker
  test: 7
  root_cause: "pos.order.void.own and pos.order.void.any permission rows (and their role_permissions grants) were never added to the auth-service seed changelog, despite the OPA policy and pos-service code already depending on them."
  artifacts:
    - policies/restaurantos/pos.rego
    - services/pos-service/src/main/java/io/restaurantos/pos/authz/PosAuthorizationService.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/041-pos-permissions.xml
  missing:
    - "pos.order.void.own permission seeded + granted to CASHIER (own orders only)"
    - "pos.order.void.any permission seeded + granted to MANAGER/TENANT_ADMIN/OWNER"

- truth: "A KITCHEN_STAFF user can log in and access the Kitchen Display board; ticket bump PENDING->COOKING->READY and order READY/PARTIAL_READY rollup work"
  status: failed
  reason: "No KITCHEN_STAFF (or other pos.kds.*-permitted, non-TOTP) seed user exists to test with. CASHIER is correctly denied (403) confirming that half of role isolation, but KDS bump/aging/rollup and the reverse role-isolation direction are entirely untested this session."
  severity: major
  test: 4
  artifacts:
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/900-seed-auth-dev-data.xml
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/042-kds-permissions-kitchen-role.xml
  missing:
    - "Seed a KITCHEN_STAFF (and ideally MANAGER) demo user with a known password and totp_enabled: false, matching the CASHIER/OWNER pattern already in 900-seed-auth-dev-data.xml, per Docs/agent-specs/11-seed-data-specification.md's already-documented (but unimplemented) chef@demo.local/manager@demo.local"

- truth: "Offline order creation, PWA sync badge, and full KDS/sidebar UI behavior render and work correctly in the browser"
  status: failed
  reason: "No browser automation tool was available this session. Per explicit user instruction, all browser-only checks (offline PWA flow, KDS board visual rendering/aging colors, sidebar role-based nav, receipt confirmation UI, CHARGE NOW button enable/disable) are deferred until automation tooling is integrated, not treated as failures."
  severity: minor
  test: 9
  artifacts: []
  missing:
    - "Browser automation tool (e.g. Playwright MCP) needs to be available in a future session to complete Test 9 and the deferred UI portions of Tests 3, 4, 5, 10"
