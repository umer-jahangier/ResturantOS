---
phase: 12-reporting-dashboards-nlq
plan: 06
subsystem: reporting
tags: [websocket, redis, clickhouse, rabbitmq, dashboard, throttle, real-time]

requires:
  - phase: 12-03
    provides: OrderClosedConsumer/TillClosedConsumer, SalesFactWriter/TillSessionFactWriter, BusinessDay, BranchTimeZoneResolver, clickhouse_analytics.sales_order_facts/till_session_facts
  - phase: 12-11
    provides: reporting.dashboard.view permission (seeded + granted)
provides:
  - Realtime dashboard WebSocket at /api/v1/reporting/dashboard/{branchId} pushing KPI tiles within 5s of ORDER_CLOSED/TILL_CLOSED
  - Per-tile throttle (leading-push + trailing-flush) that coalesces bursts without dropping the final state
  - GET /api/v1/reporting/dashboard/{branchId}/tiles REST snapshot for a freshly-connected client
affects: [12-08, 12-09, 12-10]

tech-stack:
  added: []
  patterns:
    - "Leading-edge-push + trailing-edge-flush throttle: tryAcquire grants immediately if the window elapsed, else marks dirty; a @Scheduled(fixedDelay=1000) sweep drains due dirty keys and force-recomputes — guarantees convergence within ~2s even under a sustained burst, unlike a pure drop-the-tail throttle."
    - "A service-level per-branchId 'last known (tenantId, businessDate)' map lets a throttle (which only knows opaque tileKeys) trigger a full, context-aware recompute from a scheduled sweep with no fresh event."
    - "Dashboard-push failures are caught and logged at WARN inside the SAME tenantAwareMessageProcessor block as the fact write — never allowed to escape and roll back the processed_events idempotency guard."

key-files:
  created:
    - services/reporting-service/src/main/java/io/restaurantos/reporting/ws/DashboardWebSocketHandler.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/ws/TilePushThrottle.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/config/WebSocketConfig.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/dto/DashboardTileDto.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/service/DashboardTileService.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/controller/DashboardController.java
    - services/reporting-service/src/test/java/io/restaurantos/reporting/ws/TilePushThrottleTest.java
    - services/reporting-service/src/test/java/io/restaurantos/reporting/ws/DashboardPushIT.java
  modified:
    - services/reporting-service/src/main/java/io/restaurantos/reporting/consumer/OrderClosedConsumer.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/consumer/TillClosedConsumer.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/ReportingServiceApplication.java

key-decisions:
  - "open-tills tile DROPPED, not faked: till_session_facts (12-03) is populated ONLY by TILL_CLOSED — there is no fact for a till being opened, so 'tills currently open' is not computable from data this service has. Rendering 0 would be a lie an owner could act on."
  - "TilePushThrottle constructor needed an explicit @Autowired on the production (long minIntervalMs) constructor — with a second package-private (Clock, long) test constructor present, Spring's ambiguous-constructor resolution picked the test one and failed to start with 'No default constructor found'. Found by actually running DashboardPushIT's Spring context, not by the unit test (which constructs the class directly, bypassing DI)."
  - "DashboardWebSocketHandler and DashboardTileService both inject the unqualified (Primary) ObjectMapper — the SAME bean sharedObjectMapper serializes tile pushes AND is what an IT/frontend parses; eventObjectMapper (FAIL_ON_UNKNOWN_PROPERTIES disabled) is reserved for RabbitMQ envelope decoding only, per 12-03's established convention."

patterns-established:
  - "Trailing-flush sweep pattern: a throttle that only tracks opaque keys/timing hands off convergence to a service-level per-key 'last context' map + @Scheduled sweep, rather than the throttle itself trying to own domain recomputation."

duration: ~50min
completed: 2026-07-18
---

# Phase 12 Plan 06: Realtime Dashboard WebSocket Summary

**A JWT-authenticated dashboard WebSocket that pushes KPI tiles within ~1-2s of ORDER_CLOSED/TILL_CLOSED (well under the 5s RPT-02 budget), using a leading-push-plus-trailing-flush throttle proven (via a fake Clock and a real-container IT) to coalesce a 100-event burst into a handful of frames while still converging to the exact final total — plus a REST snapshot endpoint so a freshly-connected client isn't blank.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3/3 complete
- **Files created:** 8, modified: 3

## Accomplishments

- `DashboardWebSocketHandler` — a structural clone of kitchen-service's proven `KdsWebSocketHandler`
  (JWT-in-query-param auth, `CloseStatus(1008, ...)` policy-violation close, `CopyOnWriteArrayList`
  subscriber registry guarded by `session.isOpen()`), adapted for the single-`branchId` path
  `/api/v1/reporting/dashboard/{branchId}` and the `reporting.dashboard.view` permission (seeded +
  granted by 12-11).
- `TilePushThrottle` — the net-new piece KDS never needed: `tryAcquire(tileKey)` grants a push
  immediately if `minIntervalMs` (default 1000ms) has elapsed since the last granted push for that
  tile, else marks it dirty; `drainDueTileKeys()` (polled by a `@Scheduled(fixedDelay=1000)` sweep
  in `DashboardTileService`) force-flushes any dirty tile whose window has since elapsed. Proven
  by `TilePushThrottleTest` (5 cases, fake `Clock`, no sleeping) and by `DashboardPushIT`'s burst
  test on a real event loop.
- `DashboardTileService` — computes `todays-revenue`/`todays-orders`/`todays-tax`/
  `average-order-value` from `sales_order_facts` on the branch's business date (LocalDate-bound,
  never `java.sql.Date.valueOf`, per 12-05's proven gotcha), caches the result in Redis
  (`dashboard:tiles:{tenantId}:{branchId}:{businessDate}`, 10s TTL) so the REST snapshot and the WS
  push always agree, and drives both the immediate push (`recomputeAndPush`, called by the
  consumers) and the trailing flush (`flushDueTiles`, tracking each branch's last known
  tenantId/businessDate so the scheduled sweep can recompute without fresh event data).
- `DashboardController` — `GET /api/v1/reporting/dashboard/{branchId}/tiles`,
  `@PreAuthorize("hasAuthority('reporting.dashboard.view')")`, tenantId server-derived.
- `OrderClosedConsumer`/`TillClosedConsumer` — call `dashboardTileService.recomputeAndPush(...)`
  immediately after their existing fact write, INSIDE the same `tenantAwareMessageProcessor` block,
  wrapped in a try/catch that logs at WARN and swallows: a dashboard-push failure must never roll
  back the `processed_events` idempotency guard and cause infinite ORDER_CLOSED/TILL_CLOSED
  redelivery. `EtlPipelineIT` (6/6) confirms this wiring did not regress the existing ETL.

## Verification — `mvn -pl services/reporting-service verify` → BUILD SUCCESS (26 tests)

`BusinessDayTest` 6, `TilePushThrottleTest` 5, `EtlPipelineIT` 6, `ReportServiceIT` 4,
`FbrTaxSummaryIT` 4, `DateBindingDiagnosticIT` 1, **`DashboardPushIT` 6** (new, real containers:
Postgres + RabbitMQ + ClickHouse 25.9 + Redis, service on a random port, a REAL
`StandardWebSocketClient` — not a mocked handler):

| Test | must_have |
|---|---|
| `orderClosed_pushesWithinFiveSeconds` | explicit `Duration.between(t0, received).isLessThan(5s)` + tile content check |
| `tillClosed_pushesWithinFiveSeconds` | same, TILL_CLOSED |
| `burstOfOrders_isThrottledButConverges` | 100 events -> <15 frames AND the final frame's `todays-revenue` equals the exact sum |
| `noToken_isRejected` | WS closes 1008 |
| `insufficientPermission_isRejected` | valid JWT lacking the permission -> 1008 |
| `crossBranch_isolation` | branch-1 subscriber sees nothing from a branch-2 event |

## Task Commits

1. **Task 1: Dashboard WebSocket handler + the per-tile throttle KDS lacks** — `31c5e8b` (feat)
2. **Task 2: Tile computation + REST snapshot + wiring the push into the ETL consumers** — `bcb8163` (feat)
3. **Task 3: DashboardPushIT — prove the sub-5-second criterion with a real clock** — `b484901` (feat, also fixes the `TilePushThrottle` constructor bug below)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `TilePushThrottle` constructor ambiguity crashed the app on startup**

- **Found during:** Task 3, first `DashboardPushIT` run (the whole Spring context failed to
  boot — `orderClosedConsumer` -> `dashboardTileService` -> `tilePushThrottle`: "No default
  constructor found"). `TilePushThrottleTest` (Task 1) never caught this because it constructs
  `TilePushThrottle` directly with `new TilePushThrottle(clock, ms)`, bypassing Spring's DI
  entirely.
- **Issue:** With two constructors present — the intended production one
  (`@Value long minIntervalMs`) and a package-private test-only one (`Clock clock, long
  minIntervalMs`) — Spring's ambiguous-constructor autowiring picked the (wrong) 2-arg
  constructor as the "most greedy" candidate and failed because `Clock` isn't a bean.
- **Fix:** Added `@Autowired` to the production constructor so Spring's selection is explicit,
  not inferred.
- **Files modified:** `TilePushThrottle.java`
- **Commit:** `b484901`

## Findings / Open Items

- **`open-tills` tile does not exist.** `till_session_facts` (12-03) is populated exclusively by
  TILL_CLOSED — there is no fact for a till session being *opened*. "Tills currently open" is not
  computable from this data; the tile was dropped rather than rendered as a false 0. If a future
  phase needs it, `TillServiceImpl` would need to publish a `TILL_OPENED` event (or the fact table
  would need an `opened_at`/`is_open` column populated some other way).
- No live gateway/frontend click-path was exercised here (12-08/12-09 own the frontend hook; the
  WS URL shape and `DashboardTileDto` JSON below are the pinned contract for that work).

## Pinned Contract for 12-08 (frontend)

- **WS URL:** `ws://<gateway>/api/v1/reporting/dashboard/{branchId}?token={jwt}` — same
  JWT-in-query-param pattern as the existing KDS socket (`use-kds-socket.ts` is the frontend
  precedent to mirror). Closes with code `1008` on missing/invalid JWT or missing
  `reporting.dashboard.view`.
- **Frame payload:** a JSON array of `DashboardTileDto`, pushed on every throttle-granted
  recompute (immediate or trailing-flush):
  ```json
  [
    { "tileId": "todays-revenue", "title": "Today's Revenue", "valuePaisa": 123456, "valueNumber": null, "unit": "PKR", "businessDate": "2026-07-18", "computedAt": "2026-07-18T09:15:30.123Z" },
    { "tileId": "todays-orders", "title": "Today's Orders", "valuePaisa": null, "valueNumber": 42, "unit": "count", "businessDate": "2026-07-18", "computedAt": "2026-07-18T09:15:30.123Z" },
    { "tileId": "todays-tax", "title": "Today's Tax", "valuePaisa": 4500, "valueNumber": null, "unit": "PKR", "businessDate": "2026-07-18", "computedAt": "2026-07-18T09:15:30.123Z" },
    { "tileId": "average-order-value", "title": "Average Order Value", "valuePaisa": 2940, "valueNumber": null, "unit": "PKR", "businessDate": "2026-07-18", "computedAt": "2026-07-18T09:15:30.123Z" }
  ]
  ```
  Exactly one of `valuePaisa`/`valueNumber` is populated per tile; the other is `null` (never 0 —
  0 is a real value, `null` means "not applicable").
- **Tile ids (4, stable):** `todays-revenue`, `todays-orders`, `todays-tax`,
  `average-order-value`. `average-order-value` is `null` (not 0) when `todays-orders` is 0.
  **`open-tills` does NOT exist** — see Findings above.
- **REST snapshot:** `GET /api/v1/reporting/dashboard/{branchId}/tiles` ->
  `ApiResponse<List<DashboardTileDto>>`, same shape as the WS frame's array — call once on
  socket-connect to avoid a blank first paint, then let the socket keep it live.
