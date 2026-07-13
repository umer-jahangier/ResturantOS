---
status: gaps_found
phase: 07-point-of-sale-kitchen-display
source:
  - 07-01-SUMMARY.md
  - 07-02-SUMMARY.md
  - 07-03-SUMMARY.md
  - 07-04-SUMMARY.md
started: 2026-07-10T00:00:00+05:00
updated: 2026-07-11T01:30:00+05:00
---

## Browser Automation Session (Playwright — 2026-07-11)

First real browser-driven pass over Phase 7, as both CASHIER (`cashier@demo.local`) and
KITCHEN_STAFF (`chef@demo.local`), using an ad-hoc Playwright script (no MCP browser tool
available; drove `@playwright/test`'s `chromium` directly against the live dev stack).
This superseded all of the "browser automation not available, deferred" caveats from the
prior session for Tests 2, 3, 4, 9, 10.

**Environment repair required before any browser testing could start:**
- auth-service was wedged with a stale Hikari connection pool (`Connection is not
  available, request timed out` → every request 500'd with a bare NPE). Restarted.
- auth-service's Liquibase seed migration (changesets 902/903 adding
  `chef@demo.local`/`manager@demo.local`) had never actually completed — a stray,
  untracked `kitchen@demo.local` user occupied the same hardcoded UUID from an earlier,
  abandoned seeding attempt, causing a `duplicate key` Liquibase failure on every
  auth-service boot (service never came up). User approved deleting the stray row; the
  real seed then applied cleanly.
- pos-service and kitchen-service processes had died and needed rebuilding/restarting.

**New bugs found via actual browser interaction (all backend/frontend contract bugs that
only manifest when a real browser calls these endpoints — the prior session's direct-API
curl testing happened to avoid every one of them):**

1. **[BLOCKER, FIXED]** `GET /api/v1/pos/menu/categories` threw
   `LazyInitializationException` on `MenuCategory.items` — the controller returned the
   raw JPA entity (with a lazy `@OneToMany`) instead of a DTO, and Jackson serialized it
   after the transaction/session closed. The POS menu grid could never load a single
   category. Fixed: added `MenuCategoryDto`, updated `MenuServiceImpl`/`MenuController` to
   map to DTOs inside the transactional service method (same pattern already used for
   `MenuItemDto`).
2. **[BLOCKER, FIXED]** `MenuController`, `OrderController`, and `TableController` all
   returned raw, unwrapped JSON (bare arrays / bare DTOs), but the frontend's generic
   `get()`/`post()` request helpers unconditionally unwrap the shared `{data, meta,
   warnings}` `ApiResponse` envelope (`response.data.data`) — the contract every other
   controller (`PaymentController`, `TillController`, and every other service) follows.
   Net effect: the entire POS menu/table/order-lifecycle UI silently received `undefined`
   for every list (menu items, tables) and threw Zod parse errors for every order mutation
   (create/get/addItem/removeItem/applyDiscount/sendToKds/void/refund) — the cashier could
   never see a table, see a menu item, or create an order through the real UI, though raw
   curl testing (bypassing the frontend's envelope-unwrap layer) never surfaced this.
   Fixed: wrapped all affected endpoints in `ApiResponse.ok(...)` /
   `ApiResponse.paginated(...)`, matching the sibling controllers' existing pattern.
3. **[BLOCKER, FIXED]** `DiningTable`'s JPA field is `tableNumber`, but the frontend's
   `apiDiningTableSchema` (and `TableFloorView`'s `table.tableName` usage) expects
   `tableName` — a `.parse()` on real table data would have thrown even after fixing #2.
   Fixed: added `DiningTableDto` (mirroring the `tableName` contract) and updated
   `TableController` to return it.
4. **[BLOCKER, FIXED]** `PosTerminal.handleItemSelect`: the `useAddItem(activeOrderId ??
   "")` mutation hook is bound to `activeOrderId` at render time. On the very first menu
   tap (order doesn't exist yet), the handler creates the order and calls
   `setActiveOrderId(...)`, then immediately calls `addItem.mutateAsync(...)` — but
   `addItem` is still the *stale* instance bound to `""` from the render before the state
   update landed, so it POSTed to `/api/v1/pos/orders//items` (empty order id), which the
   browser blocked as a bad CORS preflight. Result: the very first item tap always created
   an empty DRAFT order and silently dropped the item; only the *second* tap (after a
   re-render) actually added anything. Fixed: the first-item path now calls
   `PosRepository.addItem`/`enqueue` (offline-aware) directly with the freshly-known
   order id instead of going through the stale hook instance.
5. **[BLOCKER, FIXED]** `KdsTicketRepository.findByBranchIdAndStationCodeAndStatusIn`
   declared its `statuses` parameter as `List<String>`, but `KdsTicket.status` is a
   `TicketStatus` enum column — every single KDS ticket-list call (the KDS board fetches
   per-station, always with a status filter) threw
   `QueryArgumentException: ... is not assignable to TicketStatus`. The board had *never*
   been able to show a ticket, ever, regardless of role. Fixed: changed the repository
   signature (and `countByOrderIdAndStatusNot`) to `TicketStatus`, parsing the
   comma-separated query param to enum values in the controller.
6. **[BLOCKER, FIXED]** Same class of bug as #1: `KdsController.getTickets` mapped
   `Page<KdsTicket>` → DTO *after* the repository call's session had closed, and
   `KdsController.bumpItem` did its own `ticketRepository.findById(...).getItems()...`
   peek outside any transaction — both threw `LazyInitializationException` on
   `KdsTicket.items` once #5 was fixed. Fixed: added `@EntityGraph(attributePaths =
   "items")` to the ticket-list query, and moved the bump status-transition logic
   (`current -> next`) into a new transactional `TicketServiceImpl.bumpItem(...)` /
   `TicketService.bumpItem(...)` method instead of the controller peeking at a detached
   entity.

**After the fixes above, verified end-to-end through the real browser UI:**
- **Test 2 (create order)** — PASS. Cashier login → POS terminal → menu grid renders
  all 10 seeded items across 4 categories → tapping an item creates a DRAFT order that
  correctly flips to OPEN with the tapped item present and correct running totals
  (subtotal/tax/total all matched expected math) → tapping a second item accumulates
  correctly.
- **Test 3 (send to kitchen)** — PASS. "Send to Kitchen" button enabled once items are
  present, click transitions the order to `SENT_TO_KDS` in the order panel (confirmed in
  UI, not just API).
- **Test 4 (KDS ticket lifecycle)** — PASS (previously blocked, no KITCHEN_STAFF seed
  user). Logged in as `chef@demo.local`. KDS board renders always-dark with 4 station
  columns (Grill/Fryer/Drinks/Default). All 7 real tickets appeared (including the one
  just created above), correctly grouped by station with item notes/modifiers visible.
  **Aging colors visually confirmed exactly per spec**: fresh (<10min) tickets green
  border, 10-15min amber border + pulse, 15min+ red border + bounce (screenshot evidence:
  a genuinely 21-hour-old seed ticket was still red/bouncing, a 12-minute one was
  amber/pulsing, a fresh one was green). Bump PENDING→COOKING→READY worked per-item via
  the START/DONE buttons, with the item disappearing its button once READY.
- **Test 10 (role isolation)** — PASS, both directions now confirmed (previously only
  the CASHIER→KDS direction was tested). CASHIER sidebar shows only "POS" (no Kitchen
  Display); KITCHEN_STAFF sidebar shows only "Kitchen Display" (no POS), and
  `chef@demo.local` navigating directly to `/app/pos` is blocked in the UI ("You do not
  have permission to access the POS terminal"). MANAGER/OWNER "sees both" still untested
  (OWNER blocked by TOTP step-up; MANAGER wasn't driven through the UI this pass, only
  confirmed to hold both permissions via JWT).
- **Test 9 (offline PWA)** — PARTIAL. Offline banner correctly appears
  ("Offline — Orders will sync when connection returns") when the browser goes offline.
  However: the sync-status badge (`sync-badge` testid) never appeared after creating an
  order while offline, in this implementation or the original design — `enqueue()` (in
  both `useCreateOrder` and `useAddItem`) writes to IndexedDB but never calls
  `emitProgress()`; the badge only refreshes on mount or after a `replay()` call
  (mount-time or on the `online` event), so there's a real UX gap where offline actions
  give no visible confirmation until reconnect. Order panel also showed "No active order"
  the whole time offline (the optimistic DRAFT stub returned by `useCreateOrder` is never
  written into the `useOrder` query cache, so the UI has nothing to render until back
  online). Did not have time this session to independently confirm the reconnect→replay→
  exactly-once-server-side-order path end-to-end; flagging as a genuine, not-yet-verified
  gap rather than a pass.

**Still not independently re-verified as fully working through the UI this session**
(distinct from the above — these are pre-existing findings from the prior session,
reconfirmed unchanged):
- **Test 7 (void)** — reconfirmed still broken: `POST .../void` as CASHIER on their own
  order still returns `403 "Not permitted: pos.void"` even though the cashier's JWT now
  carries `pos.order.void.own` (the `043-cashier-void-own-permission` changeset did run).
  The error message references a different permission string (`pos.void`) than what's
  granted — same class of OPA/permission-code mismatch as originally diagnosed, not a
  regression from this session's fixes.
- **Tests 5 & 6 (payment / till)** — **new finding this session**: even setting aside the
  previously-diagnosed finance-period and `tillSessionId` backend bugs, the
  `PaymentPanel`, `TillSessionBar`, and `VoidRefundDialog` React components (which
  implement the full split-tender charge, till open/close, and void/refund UI) are
  **never imported or rendered by any page** — `grep` confirms zero non-test references
  outside their own files. `OrderPanel`'s "CHARGE NOW" button is a permanently
  `disabled` stub with the title "Payment processing available in next phase"; there is
  no till bar and no void button anywhere in the actual running app. This means Tests 5,
  6, and 7 are blocked in the browser not only by the backend bugs already on file, but
  by a **missing frontend integration** — the components exist and (per source read) look
  correct, but a cashier cannot reach payment, till management, or void from the UI at
  all today.

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
  Re-verified end-to-end through the real browser (Playwright + chromium) as CASHIER,
  after fixing 4 blocker bugs this session that were silently breaking this exact flow
  (menu-categories LazyInitializationException; Menu/Order/Table controller response
  envelope mismatch vs. the frontend's API client; DiningTable tableNumber/tableName
  field mismatch; a stale-closure bug dropping the very first item added to a new order).
  Menu grid renders all 10 seeded items across 4 category tabs (Mains/Starters/
  Beverages/Desserts). Tapping the first item creates the order and correctly shows it
  OPEN with the item present and correct running totals; a second item accumulates
  correctly (visually confirmed subtotal/tax/total math in the order panel). Floor View
  tab renders all 8 seeded tables with AVAILABLE/OCCUPIED status. Table-to-order linkage
  (tapping a table before ordering) was not separately exercised — `PosTerminal` doesn't
  currently pass a table selection into `createOrder` (no `tableId` reaches the request),
  a pre-existing scope gap not touched this session.

### 3. Send Order to Kitchen
expected: With items in the order, sending the order to the kitchen transitions it to SENT_TO_KDS. The Kitchen Display board (on the kitchen-service frontend, always-dark) shows a new ticket within a couple seconds via WebSocket push, grouped by station (e.g. GRILL/DRINKS/DEFAULT), including item notes and modifiers.
result: pass
reported: |
  Re-verified through the real browser. Clicking "Send to Kitchen" (enabled once items
  are present) transitioned the order panel's status pill to SENT_TO_KDS immediately.
  Switching to the KITCHEN_STAFF session confirmed the corresponding ticket appeared on
  the Grill station column, correctly grouped, with the right order number and item
  names. Did not independently time the "within a couple seconds" WebSocket push latency
  claim (ticket was already present by the time the KDS board was loaded/polled) or
  confirm the live push specifically (vs. a fetch-on-load) — timing/push-specific
  verification still outstanding.

### 4. Bump Ticket Through Kitchen Lifecycle
expected: On the KDS board, a ticket can be progressed PENDING → COOKING → READY. Ticket cards visually age (green under 10 min, amber+pulse 10-15 min, red+bounce past 15 min). When all tickets for an order are READY, the originating order in POS shows status READY (or PARTIAL_READY if only some stations are done).
result: pass
reported: |
  Previously blocked (no KITCHEN_STAFF seed user existed); unblocked once `chef@demo.local`
  was confirmed seeded and could log in without TOTP. Two further blocker bugs found and
  fixed via actual browser use before this could pass: (a) the KDS ticket-list query
  compared a `List<String>` against the `TicketStatus` enum column, throwing a Hibernate
  `QueryArgumentException` on every single board load — the board could never show a
  ticket, for any user, ever; (b) after fixing that, both the ticket-list and bump-item
  endpoints threw `LazyInitializationException` on `KdsTicket.items` (DTO mapping /
  status-transition logic touched the lazy collection outside its Hibernate session).
  After fixes: KDS board renders always-dark with Grill/Fryer/Drinks/Default columns; all
  7 real tickets appeared, correctly grouped by station with notes/modifiers visible.
  **Aging colors visually confirmed exactly per spec** — a ~21-hour-old seed ticket was
  red-bordered and bouncing, a 12-minute ticket was amber-bordered and pulsing, and a
  fresh (<10min) ticket was green-bordered, matching the <10/10-15/15+ minute thresholds
  exactly. Bump PENDING→COOKING (START button) and COOKING→READY (DONE button) both
  worked via direct clicks, with each item's button disappearing once READY. Did NOT
  verify the order-level READY/PARTIAL_READY rollup back in the POS view this session
  (ran out of time after the two backend fixes above) — that specific rollup remains
  unverified, though the per-item bump mechanics are now confirmed working end-to-end.

blocked_by_prior: |
  (Historical — now resolved) Cannot obtain a test credential with `pos.kds.view`/
  `pos.kds.update` permission to call the KDS API at all. Per
  `services/auth-service/.../042-kds-permissions-kitchen-role.xml`, those permissions
  are granted ONLY to KITCHEN_STAFF, MANAGER (view-only), TENANT_ADMIN, and OWNER —
  explicitly excluded for CASHIER, ACCOUNTANT, FINANCE_VIEWER, INVENTORY_MANAGER
  (working as intended for CASHIER — see Test 10). But: (a) no KITCHEN_STAFF or MANAGER
  seed user existed in `900-seed-auth-dev-data.xml` (only cashier/owner/accountant/
  finance_demo were seeded, despite `Docs/agent-specs/11-seed-data-specification.md`
  describing a `chef@demo.local` / `manager@demo.local`), and (b) OWNER login requires
  TOTP step-up (`AuthServiceImpl.requiresTotpStepUp` — OWNER has `rbac.manage`), which
  cannot be completed headlessly since the seeded owner has `totp_enabled: false` (never
  enrolled). This also blocks browser-based KDS board testing later unless a KITCHEN_STAFF
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
new_finding_2026_07_11: |
  Browser session confirmed this is ALSO blocked at the UI layer independent of the
  finance-period bug: `PaymentPanel` (the component implementing this exact split-tender
  CHARGE NOW flow) is never imported/rendered by any page. `OrderPanel`'s real "CHARGE
  NOW" button is a hardcoded `disabled` stub ("Payment processing available in next
  phase"). Even after the backend bug is fixed, a cashier has no way to reach this UI
  today.

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
new_finding_2026_07_11: |
  Browser session confirmed `TillSessionBar` (the component implementing till open/close
  and the variance preview) is never imported/rendered by any page — there is no till bar
  visible anywhere in the running app. Blocked at the UI layer independent of the backend
  bugs above.

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
reconfirmed_2026_07_11: |
  Re-tested via direct API call this session (fresh order, cashier's own order, valid
  reason, correct Idempotency-Key header): still `403 "Not permitted: pos.void"` —
  unchanged from the original finding despite the `043-cashier-void-own-permission`
  changeset having run (cashier's JWT now does carry `pos.order.void.own`). The 403
  message references a different permission string (`pos.void`) than what was granted,
  suggesting the OPA/authorization code path checks a different code than the one seeded
  — not re-diagnosed further this session. Also newly confirmed: `VoidRefundDialog` (the
  component implementing the void UI) is never imported/rendered by any page — no void
  button exists anywhere in the running app, so this is blocked at the UI layer as well
  as the permission layer.

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
result: issue
severity: minor
reported: |
  Browser automation tooling is now available and was used (Playwright + chromium,
  `context.setOffline()`). Offline banner: PASS — "Offline — Orders will sync when
  connection returns" correctly appears when the browser goes offline. Creating an order
  while offline: PARTIAL — the create-order/add-item calls correctly took the offline
  (IndexedDB outbox `enqueue`) path rather than throwing, but the order panel kept
  showing "No active order" the entire time offline, because the optimistic DRAFT stub
  `useCreateOrder` returns when offline is never written into the `useOrder` query cache
  — there's nothing for the UI to render until the real order exists server-side. Sync
  badge: FAIL to show — `enqueue()` (used by both `useCreateOrder` and `useAddItem`'s
  offline branches) never calls `emitProgress()`; the badge only refreshes on mount or
  after a `replay()` call, so a user gets no visible confirmation that their offline
  action was queued until the next reconnect/reload. Did not get to independently
  confirm the reconnect→replay→exactly-once-server-side-order path or "no duplicates"
  claim this session. Not treated as a blocker (existing e2e scaffold at
  `frontend/e2e/pos-offline.spec.ts` targets this same gap and is itself marked as
  not-yet-a-phase-4-deliverable), but a real, now-verified UX gap rather than an
  untested one.

### 10. Role Isolation — Kitchen Staff vs Cashier
expected: Logging in as a KITCHEN_STAFF user shows only the Kitchen Display in the sidebar (no POS nav item); attempting to access the POS page or API directly is rejected (403). Logging in as a CASHIER shows only POS in the sidebar; attempting to access the Kitchen Display page or API directly is rejected (403). A MANAGER/OWNER sees both.
result: pass
reported: |
  Fully re-verified through the real browser this session (previously only the
  CASHIER→KDS API-layer direction had been checked). Logged in as `cashier@demo.local`:
  sidebar shows "POS" under Orders, no "Kitchen Display" entry anywhere. Logged in as
  `chef@demo.local` (KITCHEN_STAFF, newly unblocked once the seed user was confirmed
  present): sidebar shows only "Kitchen Display", no "POS" entry; navigating directly to
  `/app/pos` renders "You do not have permission to access the POS terminal." (blocked in
  the UI, not just the API). `GET /api/v1/kitchen/kds/tickets` as CASHIER still correctly
  403s ("Not permitted: kds.pos.kds.view"), consistent with CASHIER being excluded from
  `pos.kds.*` permissions. MANAGER/OWNER "sees both" was NOT driven through the browser
  this session (only confirmed via JWT that `manager@demo.local` holds both
  `pos.order.view` and `pos.kds.view`); OWNER remains blocked by the TOTP step-up gap.

## Summary

total: 10
passed: 4
issues: 5
pending: 0
skipped: 0
blocked: 1

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
    - "NEW (2026-07-11, browser session): PaymentPanel is never imported/rendered by any page — OrderPanel's real CHARGE NOW button is a hardcoded disabled stub. Needs wiring into the POS terminal UI (e.g. a payment step/dialog reachable once an order is OPEN/SENT_TO_KDS) independent of the backend fix above."

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
    - "NEW (2026-07-11, browser session): TillSessionBar is never imported/rendered by any page — there is no till bar anywhere in the running app. Needs wiring into the POS layout/terminal independent of the backend fixes above."

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
    - "NEW (2026-07-11, browser session): reconfirmed still 403 (\"Not permitted: pos.void\" — a different permission string than what's seeded/granted) even after the 043-cashier-void-own-permission changeset ran; the OPA/authz code path likely checks a mismatched permission code. VoidRefundDialog is also never imported/rendered by any page — no void button exists in the running app."

- truth: "RESOLVED 2026-07-11 (browser session): a KITCHEN_STAFF user can log in and access the Kitchen Display board; ticket bump PENDING->COOKING->READY works and aging colors render correctly"
  status: passed
  reason: "chef@demo.local (KITCHEN_STAFF) seed user confirmed present and working. Two further blocker bugs found and fixed via actual browser use: (1) KdsTicketRepository.findByBranchIdAndStationCodeAndStatusIn compared List<String> against the TicketStatus enum column, throwing QueryArgumentException on every board load — fixed by changing the signature to List<TicketStatus> and parsing the query param to enum in KdsController; (2) both the ticket-list and bump-item endpoints then threw LazyInitializationException on KdsTicket.items — fixed via @EntityGraph(attributePaths = \"items\") on the repository query, and by moving the bump status-transition logic into a new transactional TicketServiceImpl.bumpItem(...)/TicketService.bumpItem(...) method instead of the controller peeking at a detached entity. After fixes: KDS board renders correctly, all 7 real tickets shown grouped by station, aging colors (green <10min / amber+pulse 10-15min / red+bounce 15min+) visually confirmed exactly per spec, and PENDING->COOKING->READY bump confirmed via UI clicks. Order-level READY/PARTIAL_READY rollup back in the POS view was NOT independently re-verified this session (ran out of time)."
  severity: major
  test: 4
  artifacts:
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/repository/KdsTicketRepository.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/web/KdsController.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/service/TicketService.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/service/TicketServiceImpl.java
  missing:
    - "Order-level READY/PARTIAL_READY rollup in the POS order panel still not independently re-verified through the browser"

- truth: "Offline order creation, PWA sync badge, and full KDS/sidebar UI behavior render and work correctly in the browser"
  status: partial
  reason: "Browser automation tooling became available this session and was used. Sidebar/role-isolation and KDS board rendering/aging-colors are now CONFIRMED PASSING (see Tests 4 and 10). Offline PWA (Test 9) remains a genuine partial: offline banner works, but the sync-status badge never appears after an offline action (enqueue() never calls emitProgress()) and the order panel shows no optimistic state while offline (the offline DRAFT stub isn't written into the useOrder query cache). Receipt confirmation and CHARGE NOW enable/disable are still unverified because PaymentPanel is never wired into any page (see Test 5's new finding) — there is no real CHARGE NOW UI to test yet."
  severity: minor
  test: 9
  artifacts:
    - frontend/lib/offline/outbox.ts
    - frontend/lib/offline/sync-engine.ts
    - frontend/lib/hooks/pos/use-orders.ts
    - frontend/components/pos/sync-status-badge.tsx
  missing:
    - "enqueue() (or its callers in useCreateOrder/useAddItem) should call emitProgress() after writing to the outbox so the sync badge appears immediately, not just on mount/replay"
    - "useOrder's query cache should be seeded with the optimistic offline stub (e.g. via queryClient.setQueryData) so the order panel shows the DRAFT order while offline instead of \"No active order\""
    - "Reconnect -> replay -> exactly-once server-side order still not independently re-confirmed this session"
