---
phase: 08-inventory-recipe-management
plan: 07
subsystem: inventory
tags: [spring-boot, jpa, postgres, rls, opa, rabbitmq, transactional-outbox, java25]

# Dependency graph
requires:
  - phase: 08-inventory-recipe-management (plan 03)
    provides: Stock-domain entities/repositories (findForUpdate PESSIMISTIC_WRITE, FEFO lot-walk ordering), MacCalculator (HALF_UP rounding, D-02 oversell-reset policy)
  - phase: 08-inventory-recipe-management (plan 05)
    provides: DepletionService.walkFefoAndFloor (public static FEFO-floor-at-zero test seam) + the sorted-lock findForUpdate deadlock-avoidance convention (Pitfall 6)
  - phase: 08-inventory-recipe-management (plan 09)
    provides: InventoryAuthorizationService (authorizeManage OPA seam)
  - phase: 08-inventory-recipe-management (plan 01)
    provides: InventoryEventPayloads (TransferShippedPayload/TransferReceivedPayload/TransferVariancePayload/TransferLine/TransferVarianceLine + TRANSFER_* constants + routing keys), transactional-outbox scaffolding, InventoryRabbitConfig.INVENTORY_TOPIC_EXCHANGE
provides:
  - StockTransfer/StockTransferLine entities + StockTransferRepository/StockTransferLineRepository, mapping the V1 stock_transfers/stock_transfer_lines tables
  - TransferService.ship/receive — the INV-05 transfer lifecycle (sorted-lock findForUpdate, FEFO floor-at-zero, destination MAC recompute via MacCalculator, variance detection, transactional-outbox TRANSFER_SHIPPED/RECEIVED/VARIANCE carrying the 1320 in-transit valuation)
  - TransferController (/api/v1/inventory/transfers/{ship,receive}) enforcing inventory.item.manage on both endpoints
affects: [08-08 (counts) — same findForUpdate/outbox shape; Phase 9 (finance) — TRANSFER_SHIPPED/RECEIVED/VARIANCE now live on inventory.topic carrying unit_cost_paisa (the 1320 Inventory-in-Transit valuation) for GL posting]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "TransferService reuses DepletionService.walkFefoAndFloor (the public static FEFO-floor-at-zero test seam from 08-05) directly rather than re-implementing the walk — ship()'s source-side lot depletion is structurally identical to order-close depletion."
    - "Both ship() and receive() accumulate per-ingredient quantities into a TreeMap/sorted list keyed by natural UUID order BEFORE acquiring any findForUpdate lock — the same sorted-lock deadlock-avoidance shape DepletionService established (Pitfall 6), applied here to a single-branch multi-ingredient lock set (ship locks only the source branch's rows, receive only the destination's)."
    - "event_outbox has no RLS (shared infra table) and InventoryTestBase's Flyway clean() runs once per test CLASS (@BeforeAll), not per method — any IT that asserts outbox row counts across multiple methods in the same class MUST additionally filter by tenantId (unique per test), not just eventType, or assertions leak counts across sibling test methods that publish the same event type."

key-files:
  created:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/StockTransfer.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/StockTransferLine.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/StockTransferRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/StockTransferLineRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/dto/TransferDtos.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/TransferService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/web/TransferController.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/TransferLifecycleIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/TransferAccessControlIT.java
  modified: []

key-decisions:
  - "unit_cost_paisa on each StockTransferLine is captured from the SOURCE branch's avg_cost_paisa at ship time (not a fixed/negotiated transfer price) — this is the Inventory-in-Transit (account 1320) valuation the plan requires TRANSFER_SHIPPED/RECEIVED/VARIANCE to carry; Phase 9's finance consumer reads unitCostPaisa off TransferLine/TransferVarianceLine directly rather than re-deriving it, so no separate 'glAccount' field was added to the payload records — the valuation number IS the 1320 carry, GL account routing is Phase 9's own mapping table concern."
  - "Claude's-Discretion (08-CONTEXT.md, auto-post threshold vs manual review): publish TRANSFER_VARIANCE for ANY non-zero variance_qty, no suppression threshold — Phase 9 decides whether/how to auto-post small variances."
  - "StockTransferLineRepository was created in addition to StockTransferRepository (not explicitly named in the plan's files_modified list) — the plan's own action text offered 'via a StockTransferLineRepository or a mapped collection'; a real repository was chosen over an @OneToMany mapped collection to match every other Phase-8 service's flat-repository style (IngredientBranchStockRepository/StockLotRepository/InventoryMovementRepository), not a deviation from the plan's own wording."
  - "receive() requires the ReceiveTransferRequest to include EVERY ingredientId shipped on the transfer (throws IllegalArgumentException otherwise) — partial/staggered multi-call receiving of a single transfer is out of this plan's scope (not mentioned in the plan's behavior/action text); a transfer is received in one shot."

patterns-established:
  - "Pattern: when reusing a sibling service's FEFO/COGS pure-logic static seam (DepletionService.walkFefoAndFloor) from a different domain service (TransferService), call it directly rather than duplicating the algorithm — keeps the floor-at-zero behavior byte-identical across depletion and transfer-ship without a second implementation to keep in sync."

requirements-completed: [INV-05]

coverage:
  - id: D1
    description: "StockTransfer/StockTransferLine entities + StockTransferRepository/StockTransferLineRepository mapping V1's stock_transfers/stock_transfer_lines tables exactly"
    requirement: "INV-05"
    verification:
      - kind: unit
        ref: "mvn -pl services/inventory-service test-compile (exit 0); entities map from_branch_id/to_branch_id/status/shipped_at/received_at and transfer_id/ingredient_id/qty_shipped/qty_received/variance_qty/unit_cost_paisa 1:1"
        status: pass
    human_judgment: false
  - id: D2
    description: "TransferService.ship: sorted-lock findForUpdate on source stock, FEFO floor-at-zero walk (reused DepletionService.walkFefoAndFloor), TRANSFER_OUT movement, TRANSFER_SHIPPED published via transactional outbox carrying unit_cost_paisa (1320 valuation, captured from source avg cost at ship time)"
    requirement: "INV-05"
    verification:
      - kind: integration
        ref: "TransferLifecycleIT.shippingDecrementsSourceStock_writesTransferOutMovement_andPublishesTransferShipped — pass (live Testcontainers Postgres)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TransferService.receive: sorted-lock findForUpdate on destination stock, MacCalculator destination MAC recompute, TRANSFER_IN movement, TRANSFER_RECEIVED published; full-qty receive records no variance"
    requirement: "INV-05"
    verification:
      - kind: integration
        ref: "TransferLifecycleIT.receivingFullQty_incrementsDestinationStock_recomputesMac_noVariance — pass (destination MAC recompute (10*300+20*400)/30=367 HALF_UP verified exactly)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Receiving less than shipped records variance_qty = qty_shipped - qty_received on the line and publishes TRANSFER_VARIANCE (no auto-post threshold suppression, per CONTEXT.md discretion)"
    requirement: "INV-05"
    verification:
      - kind: integration
        ref: "TransferLifecycleIT.receivingLessThanShipped_recordsVarianceQty_andPublishesTransferVariance — pass"
        status: pass
    human_judgment: false
  - id: D5
    description: "TransferController enforces inventory.item.manage (InventoryAuthorizationService.authorizeManage) on BOTH POST /ship and POST /receive — a JWT without inventory.item.manage is denied 403 on both, with no TRANSFER_OUT/TRANSFER_IN movement or TRANSFER_SHIPPED/RECEIVED outbox row written; an INVENTORY_MANAGER succeeds on both"
    requirement: "INV-05"
    verification:
      - kind: integration
        ref: "TransferAccessControlIT — 3/3 pass (view-only denied 403 on ship with zero TRANSFER_OUT/TRANSFER_SHIPPED; view-only denied 403 on receive with zero TRANSFER_IN/TRANSFER_RECEIVED; INVENTORY_MANAGER succeeds on both ship and receive)"
        status: pass
    human_judgment: false
  - id: D6
    description: "No synchronous finance posting / Feign client added — TransferService never calls finance-service directly (GL posting from TRANSFER_* events is Phase 9's scope)"
    requirement: "INV-05"
    verification:
      - kind: unit
        ref: "grep -rc 'FeignClient|InternalFinanceClient|journal-entries' TransferService.java == 0"
        status: pass
    human_judgment: false

# Metrics
duration: 20min
completed: 2026-07-19
status: complete
---

# Phase 8 Plan 07: Inter-Branch Stock Transfers (INV-05) Summary

**TransferService ship/receive lifecycle — sorted-lock findForUpdate, FEFO floor-at-zero on the source branch (reusing DepletionService's walk), destination MAC recompute via MacCalculator, and variance-on-shortfall detection — publishing TRANSFER_SHIPPED/RECEIVED/VARIANCE through the transactional outbox with the source branch's unit cost at ship time as the Inventory-in-Transit (1320) valuation for Phase 9's GL consumer, proven by 6 green integration tests against a live Testcontainers Postgres (52/52 full-module regression, no failures).**

## Performance

- **Duration:** ~20 min (start-of-context-read to task commit)
- **Started:** 2026-07-19T01:58:00+05:00 (approx.)
- **Completed:** 2026-07-19T02:14:48+05:00 (Task 1 commit)
- **Tasks:** 1/1
- **Files modified:** 9 (9 created, 0 modified)

## Accomplishments
- `StockTransfer`/`StockTransferLine` entities extending `TenantAuditableEntity`, mapped exactly to V1's `stock_transfers`/`stock_transfer_lines` columns (`from_branch_id`/`to_branch_id`/`status`/`shipped_at`/`received_at`; `transfer_id`/`ingredient_id`/`qty_shipped`/`qty_received`/`variance_qty`/`unit_cost_paisa`); `StockTransferRepository` (tenant-scoped `findByIdAndTenantId` + `findByStatus`) and `StockTransferLineRepository` (`findByTransferId`)
- `TransferService.ship` — for each transfer line: sorted-lock `findForUpdate` on the SOURCE branch's stock (natural UUID order across the distinct ingredient set, Pitfall-6 deadlock avoidance mirroring `DepletionService`), captures `unit_cost_paisa` from the source's `avg_cost_paisa` at ship time, walks source lots FEFO floor-at-zero (reuses `DepletionService.walkFefoAndFloor` directly — same algorithm, not reimplemented), decrements the aggregate on-hand by the full shipped qty, writes a `TRANSFER_OUT` movement (`referenceType='TRANSFER'`, `referenceId=transferId`), persists the `StockTransfer`(`SHIPPED`)/lines, and publishes `TRANSFER_SHIPPED` (lines carrying `ingredientId`/`qty`/`unitCostPaisa` — the 1320 in-transit valuation) as the LAST statement of the transaction
- `TransferService.receive` — loads the tenant-scoped `StockTransfer` + its lines, matches each line against the request's receive lines by `ingredientId` (throws if any shipped line is missing from the request — a transfer is received in one shot, not staggered), sorted-lock `findForUpdate` on the DESTINATION branch's stock, recomputes destination `avg_cost_paisa` via `MacCalculator.recomputeAvgCostPaisa` (HALF_UP), increments destination on-hand, creates a destination `StockLot`, writes a `TRANSFER_IN` movement, sets `qty_received`/`variance_qty = qty_shipped - qty_received` on each line, marks the transfer `RECEIVED`, publishes `TRANSFER_RECEIVED`, and — for ANY line with non-zero variance (no auto-post threshold suppression, per 08-CONTEXT.md's explicit Claude's-Discretion) — also publishes `TRANSFER_VARIANCE` carrying `varianceQty`/`varianceCostPaisa` per line
- `TransferController` (`POST /api/v1/inventory/transfers/{ship,receive}`, `@RequiresFeature("FEATURE_INVENTORY")`): both endpoints call `InventoryAuthorizationService.authorizeManage` before touching data (T-8-AC), mirroring `ReceiptController`/`KdsController`; `@Valid` + `@Positive`/`@PositiveOrZero` reject non-positive ship/receive quantities at the boundary (T-8-NEGQTY)
- `TransferLifecycleIT` (3 integration, bean-level, live Testcontainers Postgres — mirrors `MacRecomputeIT`'s precedent): full ship → decrements source, writes `TRANSFER_OUT`, publishes `TRANSFER_SHIPPED`; full receive → increments destination, recomputes MAC exactly ((10×300+20×400)/30=366.67→367 HALF_UP), writes `TRANSFER_IN`, publishes `TRANSFER_RECEIVED`, zero variance; partial receive → `variance_qty` recorded and `TRANSFER_VARIANCE` published
- `TransferAccessControlIT` (3 integration, MockMvc + real Spring Security — mirrors `ReceiptAccessControlIT`'s precedent): view-only JWT denied 403 on `/ship` (zero `TRANSFER_OUT`/`TRANSFER_SHIPPED`) and on `/receive` (zero `TRANSFER_IN`/`TRANSFER_RECEIVED`, seeding the SHIPPED transfer bean-level first so the receive attempt proves the OPA denial fires before any mutation, not that the `transferId` lookup itself fails); `INVENTORY_MANAGER` succeeds on both ship and receive end-to-end over real HTTP

## Task Commits

Each task was committed atomically:

1. **Task 1: StockTransfer model + TransferService ship/receive/variance + events** - `e17ff3a` (feat)

**Plan metadata:** committed separately below (docs: complete plan)

## Files Created/Modified
- `services/inventory-service/.../domain/model/{StockTransfer,StockTransferLine}.java` - Transfer header + line entities extending TenantAuditableEntity
- `services/inventory-service/.../repository/{StockTransferRepository,StockTransferLineRepository}.java` - Tenant-scoped transfer repository + line-by-transferId lookup
- `services/inventory-service/.../dto/TransferDtos.java` - CreateTransferRequest/TransferLineRequest/ReceiveTransferRequest/ReceiveLineRequest/TransferDto/TransferLineDto records
- `services/inventory-service/.../service/TransferService.java` - ship/receive lifecycle: sorted-lock findForUpdate, FEFO floor-at-zero (reused), destination MAC recompute, variance detection, transactional-outbox TRANSFER_SHIPPED/RECEIVED/VARIANCE
- `services/inventory-service/.../web/TransferController.java` - REST endpoints under /api/v1/inventory/transfers/{ship,receive}, both calling authorizeManage
- `services/inventory-service/src/test/.../TransferLifecycleIT.java` - 3 bean-level integration tests, ship/receive/variance lifecycle
- `services/inventory-service/src/test/.../TransferAccessControlIT.java` - 3 MockMvc integration tests, OPA 403/2xx enforcement on both endpoints

## Decisions Made
- `unit_cost_paisa` on each transfer line is the SOURCE branch's `avg_cost_paisa` at ship time — the 1320 Inventory-in-Transit valuation Phase 9 needs; no separate GL-account field was added to the event payloads since the valuation number itself is the carry, and account/GL-code mapping is Phase 9's own concern.
- TRANSFER_VARIANCE publishes for ANY non-zero variance (no auto-post threshold) — explicit Claude's-Discretion call per 08-CONTEXT.md, deferring the auto-post-vs-manual-review decision to Phase 9's finance consumer.
- `StockTransferLineRepository` (a real flat repository, not a mapped `@OneToMany` collection) was added alongside `StockTransferRepository` — the plan's own action text offered either shape; a flat repository matches every other Phase-8 repository's style.
- `receive()` requires all shipped ingredientIds to be present in the receive request in one call — partial/staggered receiving across multiple calls is out of this plan's scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Outbox-count assertions in both new IT classes initially filtered only by `eventType`, leaking counts across sibling test methods in the same class**
- **Found during:** First `mvn verify -Dit.test=TransferLifecycleIT,TransferAccessControlIT` run, immediately after writing both test classes
- **Issue:** `event_outbox` has no RLS (a shared infra table, confirmed in `V2__shared_infra_tables.sql`) and `InventoryTestBase`'s Flyway `clean()` runs once per test **class** (`@BeforeAll`), not per test method. Since every test method in `TransferLifecycleIT`/`TransferAccessControlIT` calls `ship()` (and some call `receive()`), an `outboxRepository.findAll().stream().filter(eventType-only)` assertion in one test method counted rows published by OTHER test methods in the same class that ran earlier (JUnit5's default random method ordering means this surfaced non-deterministically) — `TransferLifecycleIT.shippingDecrementsSourceStock...` expected exactly 1 `TRANSFER_SHIPPED` row but found 2 (from a sibling test's own `ship()` call), and `TransferAccessControlIT.viewOnlyPrincipal_isDeniedOnReceive...` expected 0 `TRANSFER_RECEIVED` rows but found 1 (from the `inventoryManager_succeedsOnShipAndReceive` sibling test).
- **Fix:** Added an additional `tenantId.equals(e.getTenantId())` filter (each test method randomizes its own `tenantId` in `@BeforeEach`) alongside every outbox `eventType` filter in both new IT classes, scoping each assertion to only the rows that test method itself produced.
- **Files modified:** `services/inventory-service/src/test/java/io/restaurantos/inventory/TransferLifecycleIT.java`, `services/inventory-service/src/test/java/io/restaurantos/inventory/TransferAccessControlIT.java`
- **Verification:** Re-ran `mvn -pl services/inventory-service verify -Dit.test=TransferLifecycleIT,TransferAccessControlIT -DfailIfNoTests=false` — 6/6 pass; full-module `mvn -pl services/inventory-service verify` — 52/52 pass (16 unit + 36 integration), no regressions.
- **Committed in:** `e17ff3a` (Task 1 commit — caught and fixed before commit, not a separate follow-up commit)

---

**Total deviations:** 1 auto-fixed (a test-isolation bug caught by actually running the full module suite, not a production-code defect)
**Impact on plan:** No production-code behavior changed by this fix; both new IT classes now correctly prove per-test isolation regardless of JUnit5 method-execution order. No scope creep.

## Issues Encountered
- The pre-existing `relation "event_outbox" does not exist` background-scheduler log noise (flagged harmless in 08-05/08-06-SUMMARY, from `OutboxRelay`'s `@Scheduled` poller racing a test context's Flyway migration timing) recurred during this plan's full-module run too — confirmed cosmetic again, did not affect any assertion; all 52 module tests passed.

## User Setup Required
None - no external service configuration required. Docker Desktop was running for the full Testcontainers-backed IT run (`TransferLifecycleIT` 3/3 + `TransferAccessControlIT` 3/3 genuinely executed against a live Postgres, not compile-only; full-module re-run confirmed 52/52 green with no regressions — 16 unit + 36 integration).

## Next Phase Readiness
- `TRANSFER_SHIPPED`/`TRANSFER_RECEIVED`/`TRANSFER_VARIANCE` are now live on `inventory.topic` (`inventory.transfer.shipped`/`inventory.transfer.received`/`inventory.transfer.variance`) with every line carrying `unitCostPaisa` — the 1320 Inventory-in-Transit valuation — for Phase 9's finance consumer to post GL entries from (Phase 8 never posts synchronously; confirmed via the `FeignClient|InternalFinanceClient|journal-entries` grep returning 0 on `TransferService.java`).
- `TransferService`'s sorted-lock `findForUpdate` + reused `DepletionService.walkFefoAndFloor` + `MacCalculator` recompute shape is the direct precedent for 08-08 (counts), which mutates the same `ingredient_branch_stock`/`stock_lots` rows under the identical locking discipline.
- No blockers. 08-08 (stock counts + variance posting, low-stock/expiry alerts) is the last plan needed to close out Phase 8's remaining INV requirements.

---
*Phase: 08-inventory-recipe-management*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 9 created source files verified present on disk; the task commit hash (`e17ff3a`) verified
present in `git log --oneline --all`.
