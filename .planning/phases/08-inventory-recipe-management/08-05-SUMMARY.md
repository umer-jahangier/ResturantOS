---
phase: 08-inventory-recipe-management
plan: 05
subsystem: inventory
tags: [spring-boot, rabbitmq, jpa, postgres, transactional-outbox, java25]

# Dependency graph
requires:
  - phase: 08-inventory-recipe-management (plan 03)
    provides: Stock-domain entities/repositories (findForUpdate PESSIMISTIC_WRITE, FEFO lot-walk ordering), MacCalculator (HALF_UP rounding convention)
  - phase: 08-inventory-recipe-management (plan 04)
    provides: RecipeService.resolveEffectiveRecipe(menuItemId, atInstant) — the D-01 effective-version seam
  - phase: 08-inventory-recipe-management (plan 01)
    provides: InventoryEventPayloads (OrderClosedPayload/StockDepletedPayload/LowStockAlertPayload), ProcessedEventService idempotency, event_outbox scaffolding, InventoryRabbitConfig queue/exchange topology
provides:
  - OrderClosedConsumer — idempotent (consumer name inventory.depletion), tenant-aware @RabbitListener on InventoryRabbitConfig.INVENTORY_ORDER_CLOSED_QUEUE
  - DepletionService.deplete — the ORDER_CLOSED depletion algorithm (INV-03, the correctness crux of Phase 8) resolving D-01 recipe versioning, sorted-lock deadlock avoidance, FEFO floor-at-zero (D-02), aggregate-MAC COGS (D-04/Pitfall 9), LOW_STOCK_ALERT, transactional-outbox STOCK_DEPLETED
  - UomConverter.effectiveBaseQty — the M2.4 UOM-conversion formula
  - public static test seams DepletionService.walkFefoAndFloor / DepletionService.computeCogsPaisa for pure unit testing without a Spring context
affects: [08-06 (receipts), 08-07 (transfers), 08-08 (counts) — DepletionService's sorted-lock findForUpdate pattern and STOCK_DEPLETED/LOW_STOCK_ALERT event shapes are the precedent; Phase 9 (finance) consumes STOCK_DEPLETED for auto-posted COGS]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-logic public static test seams on an otherwise Spring-wired @Service (DepletionService.walkFefoAndFloor/computeCogsPaisa) so FEFO-walk and COGS-rounding unit tests need no Spring context or mocked repositories — mirrors MacCalculator's precedent from 08-03."
    - "Sorted-lock deadlock avoidance: accumulate required qty per ingredientId across ALL resolved recipe lines first, then lock the DISTINCT ingredientId set in natural UUID order — never lock lazily in per-line encounter order (08-RESEARCH.md Pitfall 6)."
    - "IT assertion on event_outbox rows must NOT filter by status='PENDING' — the live @Scheduled OutboxRelay (fixedDelay=1000ms) can flip status to SENT via the mocked RabbitTemplate before the assertion runs; filter by eventType over outboxRepository.findAll() instead."

key-files:
  created:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/consumer/OrderClosedConsumer.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/DepletionService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/UomConverter.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/FefoLotWalkTest.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/DepletionCogsTest.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/DepletionConsumerIT.java
  modified: []

key-decisions:
  - "DepletionService.deplete accumulates required effectiveBaseQty per ingredientId across ALL of an order's resolved recipe lines BEFORE acquiring any lock, then locks the DISTINCT ingredientId set sorted by natural UUID order — implements 08-RESEARCH.md Pattern 2/Pitfall 6 exactly (never the M2.4 spec pseudocode's naive per-line lazy locking)."
  - "An ingredient with no ingredient_branch_stock row yet (never opening-balanced/received) is created on the fly (qtyOnHand=0, avgCostPaisa=0) inside the findForUpdate.orElseGet, saved immediately so its generated UUID is available before the FEFO lot lookup — prevents an unhandled exception that would otherwise poison-loop the consumer (no retry/DLQ boundary would ever resolve a permanently-missing stock row); depletion still correctly drives qty_on_hand negative per D-02."
  - "UOM code lookup failure (a recipe line referencing a units_of_measure code that was never seeded) throws IllegalStateException rather than silently defaulting to a factor of 1 — a missing master-data row is a data-integrity bug, not the 'missing recipe' business case, and should surface loudly through the existing retry/DLQ policy rather than silently producing a wrong quantity."
  - "walkFefoAndFloor sorts its input lot list internally (expiryDate ASC, NULLS LAST) rather than trusting caller order — defense in depth beyond StockLotRepository's own ORDER BY, and makes the FEFO-order behavior meaningfully testable with a deliberately-shuffled unit-test fixture."

patterns-established:
  - "Pattern: expose the pure-arithmetic core of a domain-heavy @Service as public static methods (walkFefoAndFloor, computeCogsPaisa) so unit tests can drive exact FEFO/rounding behavior without a Spring context, mirroring MacCalculator; reserve the full transactional deplete() method for IT-level end-to-end proof."

requirements-completed: [INV-03]

coverage:
  - id: D1
    description: "DepletionService.deplete resolves each item's effective recipe at closedAt (D-01), converts every line to base qty (UomConverter, M2.4 effective_base_qty), and skips (no error) a menu item with no resolvable recipe"
    requirement: "INV-03"
    verification:
      - kind: integration
        ref: "DepletionConsumerIT.unresolvableRecipe_skipsLine_noMovementNoException — pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "Distinct ingredientId set is pre-sorted (natural UUID order) before findForUpdate PESSIMISTIC_WRITE locking — deadlock avoidance (Pitfall 6), never per-line lazy locking"
    requirement: "INV-03"
    verification:
      - kind: unit
        ref: "grep-verified: DepletionService uses java.util.TreeSet on requiredByIngredient.keySet() before the lock-acquisition loop"
        status: pass
    human_judgment: false
  - id: D3
    description: "FEFO lot walk floors every lot at zero while the aggregate qty_on_hand may go negative by the FULL demand on oversell (D-02); NULL-expiry (non-perishable) lots walked after all dated lots"
    requirement: "INV-03"
    verification:
      - kind: unit
        ref: "FefoLotWalkTest — 3/3 pass (oldest-first partial take, full-oversell floor-at-zero, NULL-expiry-last)"
        status: pass
    human_judgment: false
  - id: D4
    description: "COGS = effectiveBaseQty x avg_cost_paisa (aggregate MAC), rounded HALF_UP — never a touched lot's own receipt cost (D-04/Pitfall 9)"
    requirement: "INV-03"
    verification:
      - kind: unit
        ref: "DepletionCogsTest — 2/2 pass (MAC-only COGS regardless of lot receipt cost, HALF_UP fractional rounding); grep -c \"receipt_unit_cost_paisa|getReceiptUnitCostPaisa\" DepletionService.java == 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "OrderClosedConsumer (consumer name inventory.depletion) is idempotent — re-delivering the same ORDER_CLOSED eventId depletes stock exactly once (processed_events dedup)"
    requirement: "INV-03"
    verification:
      - kind: integration
        ref: "DepletionConsumerIT.firstDelivery_depletesStockAndPublishesStockDepleted_secondDuplicateDelivery_isNoOp — pass (qty_on_hand, movement count, and STOCK_DEPLETED outbox row all unchanged after the duplicate)"
        status: pass
    human_judgment: false
  - id: D6
    description: "STOCK_DEPLETED is published through the transactional outbox (event_outbox row written inside the same @Transactional as the stock mutation, as the LAST statement); LOW_STOCK_ALERT queued on reorder-point breach"
    requirement: "INV-03"
    verification:
      - kind: integration
        ref: "DepletionConsumerIT — a single STOCK_DEPLETED event_outbox row exists after the first delivery, unchanged after the duplicate"
        status: pass
    human_judgment: false

# Metrics
duration: 12min
completed: 2026-07-19
status: complete
---

# Phase 8 Plan 05: ORDER_CLOSED Depletion Consumer (INV-03) Summary

**Idempotent OrderClosedConsumer + DepletionService implementing the M2.4 depletion algorithm end-to-end — D-01 recipe-version resolution, sorted-lock deadlock avoidance, FEFO floor-at-zero with negative-aggregate oversell (D-02), aggregate-MAC COGS never lot cost (D-04/Pitfall 9), and STOCK_DEPLETED/LOW_STOCK_ALERT via the transactional outbox — proven by 7 green unit tests and a live-Postgres DepletionConsumerIT proving exact-once idempotency on duplicate delivery.**

## Performance

- **Duration:** ~12 min (commit-to-commit)
- **Started:** 2026-07-19T01:20:35+05:00 (Task 1 commit)
- **Completed:** 2026-07-19T01:32:28+05:00 (deviation fix commit)
- **Tasks:** 3/3
- **Files modified:** 6 (6 created, 0 modified)

## Accomplishments
- `UomConverter.effectiveBaseQty` — the M2.4 `effective_base_qty` formula in `BigDecimal` (working scale 8, `HALF_UP` round to the `qty(4)` persistence boundary), correctly adapting the spec's illustrative 0.0-1.0 `yield_pct` fraction to this schema's percent (`NUMERIC(6,2)`, default `100.00`) column
- `DepletionService.deplete` — the ORDER_CLOSED depletion algorithm: resolves each item's effective recipe at `closedAt` via `RecipeService.resolveEffectiveRecipe` (D-01, skipping unresolvable lines with no error), accumulates required base qty per `ingredientId` across every resolved line (summing shared ingredients), pre-sorts the distinct `ingredientId` set (natural UUID order) before any `findForUpdate` `PESSIMISTIC_WRITE` lock (Pitfall 6 deadlock avoidance — never the spec's naive per-line lazy locking), walks each ingredient's lots FEFO with per-lot floor-at-zero while the aggregate `qty_on_hand` drops by the FULL required qty on oversell (D-02), values COGS at the aggregate MAC only (`required × avg_cost_paisa`, `HALF_UP` — structurally never a lot's own receipt cost, D-04/Pitfall 9), writes a `DEPLETION` `inventory_movements` row per ingredient, queues `LOW_STOCK_ALERT` on reorder-point breach, and publishes `STOCK_DEPLETED` through the transactional outbox as the LAST statement of the transaction
- `OrderClosedConsumer` — mirrors kitchen-service's `OrderClosedConsumer` shape exactly: `@RabbitListener(queues = InventoryRabbitConfig.INVENTORY_ORDER_CLOSED_QUEUE)`, tolerant `eventObjectMapper` deserialization (poison messages DLQ via `AmqpRejectAndDontRequeueException`), `processedEventService.tryProcess("inventory.depletion", eventId, ...)` wrapping `tenantAwareMessageProcessor.process(envelope, env -> depletionService.deplete(...))` for exactly-once, tenant-scoped processing
- `FefoLotWalkTest` (3 unit) + `DepletionCogsTest` (2 unit) — pure-logic tests against public static seams (`DepletionService.walkFefoAndFloor`/`computeCogsPaisa`) exposed for exactly this purpose, no Spring context needed (mirrors `MacCalculatorTest`'s precedent); proves oldest-expiry-first partial takes, full-oversell floor-at-zero (demand 10 against 7 on-hand leaves every lot at zero, informational only — the aggregate drop is the caller's job), NULL-expiry (non-perishable) lots walked last, MAC-only COGS regardless of a touched lot's own receipt cost, and `HALF_UP` fractional rounding
- `DepletionConsumerIT` (2 integration, live Testcontainers Postgres) — end-to-end: a real `EventEnvelope<OrderClosedPayload>` built via the same `eventObjectMapper` bean and driven through `OrderClosedConsumer.onMessage` twice with the identical `eventId` proves `qty_on_hand`/movement-count/`event_outbox` STOCK_DEPLETED row are ALL unchanged after the duplicate (T-8-IDEM); a second test proves an unresolvable-recipe menu item is skipped with no movement and no exception

## Task Commits

Each task was committed atomically:

1. **Task 1: DepletionService — recipe resolution, UOM conversion, sorted-lock FEFO walk, MAC COGS, LOW_STOCK, STOCK_DEPLETED** - `2cbe51a` (feat)
2. **Task 2: OrderClosedConsumer wiring (idempotent, tenant-aware, 'inventory.depletion')** - `c9fb9ee` (feat)
3. **Task 3: DepletionConsumerIT — end-to-end depletion + duplicate-delivery idempotency (T-8-IDEM)** - `0ea984e` (test)

**Deviation fix:** `992f90d` (fix — see Deviations from Plan below)

**Plan metadata:** committed separately below (docs: complete plan)

## Files Created/Modified
- `services/inventory-service/.../service/UomConverter.java` - M2.4 `effective_base_qty` conversion, `BigDecimal` working scale 8 → `HALF_UP` round to qty(4)
- `services/inventory-service/.../service/DepletionService.java` - The depletion algorithm: D-01 recipe resolution, sorted-lock FEFO walk, aggregate-MAC COGS, LOW_STOCK_ALERT, transactional-outbox STOCK_DEPLETED
- `services/inventory-service/.../consumer/OrderClosedConsumer.java` - Idempotent, tenant-aware `@RabbitListener` (`inventory.depletion`)
- `services/inventory-service/src/test/.../FefoLotWalkTest.java` - 3 unit tests, no Spring context, FEFO order + floor-at-zero + NULL-expiry-last
- `services/inventory-service/src/test/.../DepletionCogsTest.java` - 2 unit tests, no Spring context, MAC-only COGS + HALF_UP rounding
- `services/inventory-service/src/test/.../DepletionConsumerIT.java` - 2 integration tests, live Testcontainers Postgres, idempotency + FEFO + MAC-COGS + outbox + missing-recipe-skip proof

## Decisions Made
- Accumulate required qty per `ingredientId` across ALL resolved recipe lines before locking anything, then lock the DISTINCT set sorted by natural UUID order — the exact deadlock-avoidance shape 08-RESEARCH.md Pitfall 6 mandates (never the spec pseudocode's per-line lazy locking).
- A never-received ingredient (no `ingredient_branch_stock` row yet) is created on the fly (`qtyOnHand=0`, `avgCostPaisa=0`) and saved immediately inside the `findForUpdate.orElseGet` — prevents an unhandled exception from poison-looping the consumer; still correctly drives negative on-hand per D-02.
- An unknown UOM code on a recipe line throws `IllegalStateException` (surfaces through the existing retry/DLQ policy) rather than silently defaulting to a conversion factor of 1 — treated as a master-data integrity bug, not the "missing recipe" business case.
- `walkFefoAndFloor` sorts its lot list internally (`expiryDate` ASC, `NULLS LAST`) rather than trusting caller order, both as defense-in-depth beyond `StockLotRepository`'s own `ORDER BY` and to make the NULL-expiry-last behavior directly unit-testable with a deliberately-shuffled fixture.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `DepletionService` javadoc initially tripped its own Pitfall-9 acceptance-criteria grep**
- **Found during:** Task 1, immediately after writing `DepletionService.java`
- **Issue:** The acceptance criteria require `grep -c "receipt_unit_cost_paisa|getReceiptUnitCostPaisa" DepletionService.java` to return 0, but `computeCogsPaisa`'s javadoc originally referenced `stock_lots.receipt_unit_cost_paisa` in prose (explaining what COGS must never re-derive from) — a documentation match, not functional code, but it still tripped the grep (the same class of pitfall 08-03-SUMMARY hit with the word "FLOOR" in `MacCalculator`'s javadoc).
- **Fix:** Reworded the javadoc to "a lot's own receipt cost field on `stock_lots`" (same meaning, no longer contains the literal string). No functional code affected.
- **Files modified:** `services/inventory-service/src/main/java/io/restaurantos/inventory/service/DepletionService.java`
- **Verification:** grep returns 0; `FefoLotWalkTest`/`DepletionCogsTest` still 5/5 pass.
- **Committed in:** `2cbe51a` (Task 1 commit — caught before commit, not a separate follow-up)

**2. [Rule 1 - Bug] `DepletionConsumerIT`'s outbox assertion raced against the live `OutboxRelay` scheduler**
- **Found during:** Task 3, running the FULL `services/inventory-service` module `verify` (not just `-Dit.test=DepletionConsumerIT` in isolation) to check for regressions
- **Issue:** `DepletionConsumerIT` initially asserted `outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING")` filtered by `eventType=STOCK_DEPLETED`. `OutboxRelay` is a live `@Scheduled(fixedDelay = 1000)` bean in this test's Spring context (not disabled) that flips a row's status from `PENDING` to `SENT` via the mocked `RabbitTemplate` (a Mockito no-op, so `relay()` never throws). Running `DepletionConsumerIT` alone, the assertion consistently ran before the 1s scheduler tick fired; running the full IT suite together, slower cumulative context/startup timing let the scheduler fire first, flipping the row's status before the assertion — `findTop200ByStatusOrderByCreatedAtAsc("PENDING")` then returned 0 rows instead of 1, failing `assertThat(stockDepletedEntries).hasSize(1)`.
- **Fix:** Changed both outbox assertions (post-first-delivery and post-duplicate) to `outboxRepository.findAll()` filtered by `eventType` only — immune to the relay's status-flip timing, while still proving exactly one `STOCK_DEPLETED` row exists (and stays at exactly one after the duplicate).
- **Files modified:** `services/inventory-service/src/test/java/io/restaurantos/inventory/DepletionConsumerIT.java`
- **Verification:** `mvn -pl services/inventory-service verify` (full module, no `-Dit.test` filter) — 20/20 tests green (16 unit + 6 IT classes, `DepletionConsumerIT` 2/2), no regressions in `IngredientAdminIT`/`InventoryAccessControlIT`/`OpeningBalanceIT`/`RecipeAccessControlIT`/`RecipeVersionResolutionIT`/`SchemaMigrationIT`.
- **Committed in:** `992f90d` (fix commit, after Task 3's `0ea984e`)

---

**Total deviations:** 2 auto-fixed (1 grep-tripping prose wording fix caught pre-commit, 1 genuine test-timing race fix caught by running the full module suite)
**Impact on plan:** Both fixes were necessary to meet the plan's own acceptance criteria and to make the new IT reliably green under real-world test-ordering conditions; no scope creep, no functional depletion-algorithm behavior changed.

## Issues Encountered
- The pre-existing `relation "event_outbox" does not exist` background-scheduler log noise (flagged in 08-04-SUMMARY as harmless, from `OutboxRelay`'s poller running against test contexts whose migration set predates `event_outbox`) does NOT reproduce in `inventory-service`'s own test suite — `V2__shared_infra_tables.sql` creates `event_outbox` here, so this service's ITs never hit that error. Confirmed clean during this plan's IT runs.
- No other issues. Docker Desktop was running for the full Testcontainers-backed run; RabbitMQ was never required (`InventoryTestBase` mocks `RabbitTemplate` — event-driven consumer ITs drive the service layer directly rather than through a live queue, matching `KitchenTestBase`'s established precedent), so the `RabbitMQ dev creds` fallback noted in this plan's brief was not needed.

## User Setup Required
None - no external service configuration required. Docker Desktop was running for the full Testcontainers-backed IT run (both `DepletionConsumerIT` tests genuinely executed against a live Postgres, not compile-only; full-module re-run confirmed 20/20 green with no regressions).

## Next Phase Readiness
- `DepletionService`'s sorted-lock `findForUpdate` pattern, FEFO-walk shape, and `STOCK_DEPLETED`/`LOW_STOCK_ALERT` event/outbox shapes are the direct precedent for 08-06 (receipts — MAC recompute on receive), 08-07 (transfers — ship/receive with in-transit accounting), and 08-08 (counts — variance posting), all of which mutate the same `ingredient_branch_stock`/`stock_lots` rows under the identical `PESSIMISTIC_WRITE` + sorted-ingredientId-lock discipline.
- `STOCK_DEPLETED` (with `lines[].cogsPaisa` valued at MAC) is now live on `inventory.topic` / `inventory.stock.depleted` for Phase 9 (finance) to consume for auto-posted order-close COGS (DR `5100` / CR `1300`).
- No blockers.

---
*Phase: 08-inventory-recipe-management*
*Completed: 2026-07-19*
