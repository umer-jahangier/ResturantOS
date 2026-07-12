# Deferred Items — Phase 07.3

Out-of-scope discoveries made during plan execution (Scope Boundary — not fixed, logged only).

## 07.3-01

- **OrderRevisionIT.secondFire_sendsOnlyNewlyAddedItem_asIncrementingRevision_priorLinesUntouched
  — `LazyInitializationException` on `Order.items`** (pre-existing, unrelated to this plan).
  `OrderRevisionIT.java:115` calls `orderRepository.findByIdAndBranchId(...)` directly (outside
  any `@Transactional`/service boundary) then accesses the lazy `items` collection with
  `open-in-view: false` configured — the Hibernate session is already closed. Deterministic on
  isolated re-run (not test-order flakiness). Last touched in commit `144b60f` (Phase 07.1-03,
  `sendToKds` rewrite), well before this plan; this plan never edits `sendToKds`,
  `OrderRepository`, or the `Order.items` fetch mapping. Confirmed out of scope — a
  test-harness bug in a phase-7.1 test, not a regression introduced by 07.3-01's payment/close
  changes (`OrderCloseIdempotencyIT`, `PeriodLockCloseIT`, `TableOrderLookupIT`,
  `VoidRefundOpaIT`, `OrderInstructionsIT` — all of which exercise `closeOrder`/`markItemServed`
  — stayed green after the refactor).

## 07.3-04

- **Re-confirmed the same OrderRevisionIT.secondFire_... LazyInitializationException (see
  07.3-01 entry above) is still present and still pre-existing.** This plan's Task 3 acceptance
  criterion requires `mvn ... -Dtest=SendToKdsIdempotencyIT,OrderRevisionIT` to stay green;
  independently verified via `git stash` (reverting this plan's PosEventPayloads.java /
  OrderServiceImpl.java changes) that the SAME test fails identically on the pre-Task-3
  baseline -- confirming the tableNumber payload addition did not cause or worsen it. All 3
  SendToKdsIdempotencyIT tests and the other 3 OrderRevisionIT tests pass. Out of scope for
  this plan (file not in this plan's <files> list); left unfixed per Scope Boundary.

## 07.3-06

- **`KdsController.getTickets` (kitchen-service) — `LazyInitializationException` on
  `KdsTicket.items` when called with NO `stationCode` param.** `KdsController.java:64`
  (`ticketRepository.findAll(pageable).map(ticketService::toDto)`) calls the repository
  directly from the controller, outside any `@Transactional` boundary — `toDto` then
  streams the lazy `items` collection after the Hibernate session has already closed,
  throwing `org.hibernate.LazyInitializationException: Cannot lazily initialize
  collection of role 'io.restaurantos.kitchen.domain.model.KdsTicket.items'`
  (`TicketServiceImpl.java:199`), surfaced as an HTTP 500. Reproduced 100% via direct
  `curl` against kitchen-service (`GET /api/v1/kitchen/kds/tickets?branchId=...` with no
  `stationCode`) and via the gateway (503, circuit-broken from the repeated 500s). The
  station-scoped path (`findByBranchIdAndStationCodeAndStatusIn`, what the live KDS board
  actually calls per-column) does NOT hit this — only the unscoped `findAll` branch does.
  `git log` on `KdsController.java` shows its last touch was `6c9d40d` (07.1-02), well
  before this plan; not caused by 07.3-02's `TicketServiceImpl.markItemStatus` edit (a
  different method). Out of scope (kitchen-service Java; this plan is frontend-only, "no
  backend change" per its own context) — left unfixed per Scope Boundary. Fix shape: wrap
  `getTickets`'s unscoped branch in a `@Transactional(readOnly = true)` service method (or
  give `findAll` a `JOIN FETCH` variant), mirroring `getTicketDetail`'s already-correct
  pattern two lines below.

- **`GET /api/v1/kitchen/kds/tickets` has no explicit sort and Spring's default
  `Pageable` is unsorted + `size=20`.** Independently confirmed live (07.3-06 Task 4,
  `pos-kitchen-live-sync.spec.ts`): this dev branch's GRILL station has accumulated 29
  PENDING tickets from prior test/UAT runs — `kds-board.tsx` never expires/removes stale
  PENDING tickets, so days of automated test runs pile up indefinitely. A direct
  authenticated `GET .../tickets?stationCode=GRILL&size=100` confirmed a freshly-fired
  order's ticket present in the data but at position 29/29 — beyond the frontend's
  (unmodified, default) page-1/size-20 fetch, so it never renders on the live KDS board.
  This is a combination of (a) no server-side stale-ticket cleanup/TTL and (b) no
  explicit `@PageableDefault(sort = "receivedAt")`/larger page size on `KdsController`.
  Out of scope for this frontend-only plan — left unfixed per Scope Boundary. Blocks
  `pos-kitchen-live-sync.spec.ts` (POS-20 Wave-0 E2E) from reaching a live PASS on this
  dev branch until either the stale test tickets are cleaned up or the backend paginates/
  sorts sensibly; the spec correctly classifies this as `BLOCKED` (not `FAIL`) with the
  full diagnostic inline.

## 07.3-07

- **`__tests__/lib/eslint-boundary.test.ts` > "flags a component importing a repository
  directly" — 5000ms test timeout, reproducible in isolation.** This test programmatically
  runs ESLint (`eslint.lintText`) against an inline code snippet to assert the FE-08
  layer-boundary rule fires; it consistently exceeds Vitest's default 5s timeout on this
  session's host (`Duration 7.19s` observed vs. a 5000ms limit), independent of any other
  test running before/after it (reproduced with `vitest run eslint-boundary` alone). Last
  touched in `c5f2e5c` (Phase 04-01), well before this plan; this plan never edits
  `.eslintrc`/`eslint.config.*`, the layer-boundary rule, or `__tests__/lib/**`. Not caused
  by any 07.3-07 file (payment-status-badge, pos.model/schema/adapter/repository/hooks,
  charge-summary, the charge route, settlement-actions, or their tests — all confirmed
  green independently via `vitest run pos`). Out of scope — an environment-timing-sensitive
  pre-existing test, left unfixed per Scope Boundary. Fix shape: raise this specific test's
  timeout (`it(..., { timeout: 15000 })`) or the file's local `testTimeout`.

## 07.3-09

- **`POST /api/v1/pos/orders/{id}/items` (pos-service `addItem`) intermittently hangs with
  NO HTTP response ever delivered to the client — reproduced 5x live this session across
  two pos-service restarts and one gateway restart.** `pos-modal-revamp.spec.ts`'s
  create-order-and-fire flow (the same `handleSendToKitchen` chain
  `pos-terminal.tsx:94-129` already exercises successfully elsewhere — `pos-settlement.spec.ts`
  S3/S4, `pos-add-existing-revision.spec.ts`) got stuck on the `addItem` POST: Playwright's
  network log shows the request WAS sent (`REQ POST .../orders/{id}/items`) but no `RES`
  arrived within 90s. DB-level inspection (`pg_stat_activity` on `pos_db`) during the hang
  showed ZERO active/blocked queries — the write itself completes near-instantly
  server-side (confirmed via direct row inspection: `order_items.created_at` and
  `orders.sent_to_kds_at` both land within ~200ms of `orders.opened_at` for the one attempt
  that DID eventually surface as `SENT_TO_KDS` in the DB), but the HTTP response is never
  relayed back through the gateway to the browser. Later in the same session, freshly
  createdorders were observed stuck in `DRAFT` (the pre-`addItem` state per
  `OrderServiceImpl.addItem`'s DRAFT→OPEN transition, 07-01-D) — i.e. `addItem` never even
  reached that transition on those attempts — which is also why Order Management's "No
  active orders" empty state appeared (07.3-04's `!isTerminal(s) && s != DRAFT` default
  filter correctly excludes stuck-DRAFT rows). Restarting `pos-service`
  (`restart-service.ps1 pos-service -SkipBuild`) did not resolve it; restarting `gateway`
  fixed one occurrence (login/route relay recovered) but the `addItem` hang recurred on the
  next attempt. Gateway's own `/actuator/health` independently returns 503 throughout this
  session due to a known, already-documented RabbitMQ credential mismatch (see
  Dev-stack-rebuild-gotchas memory: `RABBITMQ_USERNAME=restaurantos` /
  `RABBITMQ_PASSWORD=dev_rabbit_2026`), but that indicator failure doesn't itself explain
  the response-relay hang (login/branches/feature-flags/till/menu/createOrder all routed
  correctly through the SAME gateway instance in the SAME test run). Not caused by this
  plan's files: `void-refund-dialog.tsx`/`till-session-bar.tsx`/`use-online-status.ts` are
  pure frontend UI with no relationship to the `addItem` endpoint, and `OrderServiceImpl
  .addItem` (pos-service Java) is untouched by any 07.3-09 file. Out of scope (backend/
  infra, this plan is frontend-only) — left uninvestigated further per Scope Boundary.
  Blocks `pos-modal-revamp.spec.ts` from reaching a live PASS on the void/refund stage on
  this dev-stack session; the spec correctly classifies this as `BLOCKED` (exit code 0,
  matching every other blocked-but-passing E2E spec in this phase) with the full
  diagnostic (last network events + console errors) inline in the skip reason. The
  till-only stage of the SAME spec (no `addItem` dependency) reaches a live PASS every run,
  producing `e2e/__screenshots__/pos25-till.png`. `e2e/__screenshots__/pos25-void-refund.png`
  could not be captured live this session as a result — the void/refund panel's correctness
  was instead confirmed via `tsc --noEmit`, `eslint`, `settlement-actions.test.tsx` (green,
  unchanged trigger-button assertions), and code review (identical panel-conversion pattern
  to the till surface, which DID render correctly live).
