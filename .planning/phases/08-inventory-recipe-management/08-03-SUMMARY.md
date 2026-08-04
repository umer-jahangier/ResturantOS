---
phase: 08-inventory-recipe-management
plan: 03
subsystem: inventory
tags: [spring-boot, jpa, postgres, rls, opa, spring-cloud-gateway, mockmvc, java25]

# Dependency graph
requires:
  - phase: 08-inventory-recipe-management (plan 01)
    provides: inventory-service Maven module, V1/V2 Flyway migrations (11 FORCE-RLS domain tables)
  - phase: 08-inventory-recipe-management (plan 02)
    provides: InventoryTestBase (Testcontainers Postgres harness), TestFixtures (JwtClaims/TenantContext helpers)
  - phase: 08-inventory-recipe-management (plan 09)
    provides: InventoryAuthorizationService (authorizeView/authorizeManage OPA seam), InventorySecurityConfig
provides:
  - Stock-domain JPA entities (UnitOfMeasure, Ingredient, IngredientBranchStock, StockLot, InventoryMovement) + repositories, including the pessimistic-lock findForUpdate and FEFO lot-walk ordering downstream depletion/receipt/transfer/count plans build on
  - MacCalculator — weighted moving-average-cost recompute (HALF_UP, D-02 oversell-reset policy)
  - Ingredient/UOM master-data CRUD + opening-balance recording, all wired into the 08-09 OPA seam
  - Active gateway inventory-route (/api/v1/inventory/** -> lb://inventory-service) + RouteFeatureMap entry
  - InventoryFixtures — entity-dependent seed helpers every downstream Phase-8 feature IT reuses
affects: [08-05 (depletion), 08-06 (receipts), 08-07 (transfers), 08-08 (counts)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MockMvc + SecurityMockMvcConfigurers/SecurityMockMvcRequestPostProcessors for controller ITs that need real @Valid/GlobalExceptionHandler/HTTP-status behavior — mirrors finance-service's FinanceEndpointAuthorizationIT precedent rather than kitchen-service's direct-bean-call style (which cannot exercise @Valid without class-level @Validated)."
    - "@MockitoBean FeatureFlagService (not a mocked StringRedisTemplate ValueOperations) to satisfy @RequiresFeature in MockMvc-driven ITs — simpler than mocking the Redis cache layer."

key-files:
  created:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/UnitOfMeasure.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/Ingredient.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/IngredientBranchStock.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/StockLot.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/InventoryMovement.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/UnitOfMeasureRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/IngredientRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/IngredientBranchStockRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/StockLotRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/InventoryMovementRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/MacCalculator.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/IngredientService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/OpeningBalanceService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/web/IngredientController.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/web/UnitOfMeasureController.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/web/OpeningBalanceController.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/dto/InventoryDtos.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/InventoryFixtures.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/MacCalculatorTest.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/IngredientAdminIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/InventoryAccessControlIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/OpeningBalanceIT.java
  modified:
    - gateway/src/main/resources/application.yml
    - gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java
    - services/inventory-service/pom.xml

key-decisions:
  - "Chose MockMvc (SecurityMockMvcConfigurers.springSecurity() + SecurityMockMvcRequestPostProcessors.authentication()) over direct controller-bean invocation for IngredientAdminIT/InventoryAccessControlIT/OpeningBalanceIT. Calling a @RestController bean directly (kitchen-service's ItemStatusEndpointIT style) bypasses Spring MVC's argument-resolution pipeline entirely — @Valid on a @RequestBody parameter is only enforced by RequestResponseBodyMethodProcessor during real dispatch, not by AOP method validation (which requires class-level @Validated, absent here). Since the plan's acceptance criteria are literal HTTP status codes (400 on negative reorderPoint, 403 on missing inventory.item.manage), MockMvc-driven real dispatch was required to prove them honestly rather than approximating with a Java-exception assertion. Mirrors finance-service's FinanceEndpointAuthorizationIT precedent already in this repo."
  - "Added spring-security-test (test scope) to inventory-service's pom.xml — not in the plan's files_modified list, but a Rule-3 blocking-fix: the MockMvc pattern above needs SecurityMockMvcConfigurers/SecurityMockMvcRequestPostProcessors, which finance-service already depends on for the identical purpose."
  - "RecordOpeningBalanceRequest.unitCostPaisa is boxed Long (not primitive long) so @NotNull can actually reject a missing/null value; Jackson would otherwise default a missing primitive field to 0 during deserialization, silently defeating the validation the plan requires."
  - "OpeningBalanceService.recordOpeningBalance() ADDS the opening qty onto any existing stock qty (via findForUpdate-or-create) rather than assuming a fresh row — makes the endpoint safely re-callable (e.g. adding another opening lot) while still producing exactly-one-movement-per-call and the single-fresh-call qty-equals-opening-qty behavior the acceptance criteria assert."

patterns-established:
  - "Pattern: MockMvc + real Spring Security filter chain for any inventory-service controller IT that needs to assert literal HTTP status codes (400/403) rather than Java exception types — use this, not direct bean invocation, whenever @Valid or @RequiresFeature enforcement is part of what's being proven."

requirements-completed: [INV-01, INV-07]

coverage:
  - id: D1
    description: "Five stock-domain JPA entities (UnitOfMeasure, Ingredient, IngredientBranchStock, StockLot, InventoryMovement) extending TenantAuditableEntity, mapped 1:1 to the V1 schema; repositories including IngredientBranchStockRepository.findForUpdate (PESSIMISTIC_WRITE) and StockLotRepository.findByStockIdOrderByExpiryDateAsc (FEFO)"
    requirement: "INV-01"
    verification:
      - kind: unit
        ref: "mvn -pl services/inventory-service -am test-compile (exit 0); grep confirms @Lock(LockModeType.PESSIMISTIC_WRITE) on findForUpdate and findByStockIdOrderByExpiryDateAsc present"
        status: pass
    human_judgment: false
  - id: D2
    description: "MacCalculator.recomputeAvgCostPaisa: BigDecimal weighted-average HALF_UP rounding (never FLOOR), D-02 oversell policy (oldQty<=0 resets to receipt unit cost)"
    requirement: "INV-01"
    verification:
      - kind: unit
        ref: "MacCalculatorTest — 4/4 pass (weighted average, fractional HALF_UP rounding, empty-stock receipt, negative-on-hand reset)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Ingredient/UOM master-data CRUD under /api/v1/inventory/{ingredients,uom}, gated by FEATURE_INVENTORY and every endpoint calling InventoryAuthorizationService.authorizeView/authorizeManage; negative reorderPoint and non-positive toBaseFactor rejected 400"
    requirement: "INV-01"
    verification:
      - kind: integration
        ref: "IngredientAdminIT (3/3 pass: create/list/get 200, negative reorderPoint 400, non-positive toBaseFactor 400) + InventoryAccessControlIT (3/3 pass: view-only denied 403 on POST /ingredients and POST /uom, INVENTORY_MANAGER allowed 200 on both writes + a read) — live Testcontainers Postgres"
        status: pass
    human_judgment: false
  - id: D4
    description: "Opening-balance recording (POST /api/v1/inventory/opening-balance) sets ingredient_branch_stock.qty_on_hand/avg_cost_paisa via MacCalculator, creates exactly one OPENING_BALANCE inventory_movements row and one stock_lots row with the given expiry; non-positive qty rejected 400; missing inventory.item.manage rejected 403 with no movement written"
    requirement: "INV-07"
    verification:
      - kind: integration
        ref: "OpeningBalanceIT — 3/3 pass (stock+movement+lot assertions, 400 on non-positive qty, 403 + zero-movements-written on view-only principal) — live Testcontainers Postgres"
        status: pass
    human_judgment: false
  - id: D5
    description: "Gateway inventory-route active (Path=/api/v1/inventory/** -> lb://inventory-service, inventoryCircuitBreaker) and RouteFeatureMap maps /api/v1/inventory/ -> FEATURE_INVENTORY; GitNexus impact analysis run on RouteFeatureMap before editing per CLAUDE.md (LOW risk, 2 direct callers via FeatureFlagGlobalFilter)"
    requirement: "INV-01"
    verification:
      - kind: other
        ref: "mvn -pl gateway -am test-compile (exit 0); node .gitnexus/run.cjs impact RouteFeatureMap --direction upstream -> risk: LOW, impactedCount: 2; node .gitnexus/run.cjs detect-changes --scope compare --base-ref 65b3894 -> risk: low, 0 affected processes, only RouteFeatureMap flagged as a changed pre-existing symbol"
        status: pass
    human_judgment: false
  - id: D6
    description: "InventoryFixtures test-helper (seedUom/seedIngredient/seedStock/seedLot) available for every downstream Phase-8 feature IT"
    requirement: "INV-01"
    verification:
      - kind: integration
        ref: "OpeningBalanceIT exercises InventoryFixtures.seedIngredient directly (to satisfy the ingredient_branch_stock FK) — all 3 OpeningBalanceIT tests pass using it"
        status: pass
    human_judgment: false

# Metrics
duration: 14min
completed: 2026-07-19
status: complete
---

# Phase 8 Plan 03: Inventory Stock Domain, MAC Calculator, Master-Data CRUD & Opening Balance Summary

**Stock-domain JPA model (5 entities + pessimistic-lock/FEFO repositories), a hand-written HALF_UP moving-average-cost calculator with an explicit D-02 oversell-reset policy, ingredient/UOM/opening-balance CRUD wired into the 08-09 OPA seam, the activated `/api/v1/inventory/**` gateway route, and `InventoryFixtures` for every downstream Phase-8 feature IT — proven by 13 green tests (4 unit + 9 integration) against a live Testcontainers Postgres.**

## Performance

- **Duration:** ~14 min (commit-to-commit)
- **Started:** 2026-07-19T00:28:09+05:00 (Task 1 commit)
- **Completed:** 2026-07-19T00:42:08+05:00 (Task 3 commit)
- **Tasks:** 3/3
- **Files modified:** 25 (22 created, 3 modified)

## Accomplishments
- Five JPA entities (`UnitOfMeasure`, `Ingredient`, `IngredientBranchStock`, `StockLot`, `InventoryMovement`) extending `TenantAuditableEntity`, mapped exactly to V1's columns (NUMERIC(18,4) quantities, NUMERIC(18,8) `to_base_factor`, BIGINT paisa costs)
- `IngredientBranchStockRepository.findForUpdate` — `@Lock(LockModeType.PESSIMISTIC_WRITE)`, byte-for-byte mirroring `OrderSequenceRepository`'s shape; `StockLotRepository.findByStockIdOrderByExpiryDateAsc` — FEFO walk order relying on Postgres's default NULLS LAST on ASC (non-perishable lots sort last automatically, no explicit NULLS LAST clause needed)
- `MacCalculator.recomputeAvgCostPaisa` — hand-written `BigDecimal` weighted-average with `RoundingMode.HALF_UP` (mirrors `MoneyUtils.fromPkr`, never `taxPerLine`'s floor); explicit D-02 oversell policy: a receipt landing on zero/negative on-hand resets MAC to the receipt's own unit cost. `MacCalculatorTest` — 4/4 pass, no Docker required
- `InventoryFixtures` — entity-dependent seed helpers (`seedUom`/`seedIngredient`/`seedStock`/`seedLot`) for every downstream Phase-8 feature IT
- `IngredientController` (`/api/v1/inventory/ingredients`) + `UnitOfMeasureController` (`/api/v1/inventory/uom`): `@RequiresFeature("FEATURE_INVENTORY")` + every endpoint calls `InventoryAuthorizationService.authorizeView` (reads) / `authorizeManage` (writes) — the T-8-AC mitigation, real OPA enforcement not just the feature gate; `@Valid` + `@PositiveOrZero`/`@Positive` reject negative reorder points and non-positive UOM factors at the boundary (T-8-NEGQTY)
- `OpeningBalanceService`/`OpeningBalanceController` (`/api/v1/inventory/opening-balance`): `findForUpdate`-or-create the stock row, `MacCalculator` sets qty/MAC, seeds a `stock_lots` row (FEFO source of truth), writes a single `OPENING_BALANCE` `inventory_movements` row; no event published (internal movement only, per CONTEXT)
- Gateway: activated `inventory-route` (`Path=/api/v1/inventory/**` -> `lb://inventory-service`, `inventoryCircuitBreaker`) mirroring `finance-route`'s shape; `RouteFeatureMap` maps `/api/v1/inventory/` -> `FEATURE_INVENTORY`; `pos-route` left untouched
- GitNexus impact analysis run on `RouteFeatureMap` before editing (per `CLAUDE.md`): upstream blast radius = 2 direct callers (`FeatureFlagGlobalFilter`), risk **LOW** — reported before proceeding
- `IngredientAdminIT` (3/3), `InventoryAccessControlIT` (3/3), `OpeningBalanceIT` (3/3) — all MockMvc-driven real HTTP dispatch against a live Testcontainers Postgres, proving `@Valid`, `GlobalExceptionHandler`, and the OPA seam all actually fire (not just compile)

## Task Commits

Each task was committed atomically:

1. **Task 1: Stock-domain entities, repositories (findForUpdate + FEFO), MacCalculator, InventoryFixtures** - `b35a43a` (feat)
2. **Task 2: Ingredient/UOM master CRUD + gateway route activation (INV-01)** - `5029efc` (feat)
3. **Task 3: Opening-balance recording via OPENING_BALANCE movement (INV-07)** - `4bd7dc0` (feat)

**Plan metadata:** committed separately below (docs: complete plan)

## Files Created/Modified
- `services/inventory-service/.../domain/model/{UnitOfMeasure,Ingredient,IngredientBranchStock,StockLot,InventoryMovement}.java` - Stock-domain entities extending TenantAuditableEntity
- `services/inventory-service/.../repository/{UnitOfMeasureRepository,IngredientRepository,IngredientBranchStockRepository,StockLotRepository,InventoryMovementRepository}.java` - Repositories incl. pessimistic-lock findForUpdate + FEFO ordering
- `services/inventory-service/.../service/MacCalculator.java` - HALF_UP weighted-average-cost recompute, D-02 oversell-reset policy
- `services/inventory-service/.../service/IngredientService.java` - Ingredient/UOM CRUD, tenant always from TenantContext
- `services/inventory-service/.../service/OpeningBalanceService.java` - Opening-balance recording: stock+MAC+lot+movement
- `services/inventory-service/.../web/{IngredientController,UnitOfMeasureController,OpeningBalanceController}.java` - REST endpoints under /api/v1/inventory/**, each calling the OPA seam
- `services/inventory-service/.../dto/InventoryDtos.java` - Request/response records with @Valid boundary validation
- `services/inventory-service/src/test/.../InventoryFixtures.java` - Entity-dependent seed helpers for downstream ITs
- `services/inventory-service/src/test/.../MacCalculatorTest.java` - 4 unit tests, no Docker
- `services/inventory-service/src/test/.../{IngredientAdminIT,InventoryAccessControlIT,OpeningBalanceIT}.java` - MockMvc-driven ITs proving CRUD, validation, and OPA enforcement over real HTTP dispatch
- `gateway/src/main/resources/application.yml` - Activated inventory-route
- `gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java` - Added /api/v1/inventory/ -> FEATURE_INVENTORY
- `services/inventory-service/pom.xml` - Added spring-security-test (test scope)

## Decisions Made
- MockMvc + Spring Security test support (not direct controller-bean invocation) for all three ITs that assert HTTP status codes — see key-decisions above for the full rationale (this is a deviation from the kitchen-service ItemStatusEndpointIT-style precedent, adopted because the plan's acceptance criteria are literal status codes, and finance-service already established this exact pattern for the same reason).
- `RecordOpeningBalanceRequest.unitCostPaisa` is boxed `Long`, not primitive `long`, so `@NotNull` can reject a missing value instead of a Jackson-defaulted `0`.
- `OpeningBalanceService` accumulates onto existing stock (via `findForUpdate`-or-create) rather than assuming a fresh row, making the endpoint safely re-callable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `spring-security-test` dependency to inventory-service's pom.xml**
- **Found during:** Task 2 (writing `IngredientAdminIT`/`InventoryAccessControlIT`)
- **Issue:** The plan's acceptance criteria require literal HTTP status-code assertions (400/403), which are only achievable by driving real Spring MVC dispatch via `MockMvc`. `SecurityMockMvcConfigurers`/`SecurityMockMvcRequestPostProcessors` require `spring-security-test`, not present in `services/inventory-service/pom.xml` (unlike `finance-service`, which already has it for the identical purpose).
- **Fix:** Added the dependency (test scope, Spring Boot BOM-managed — no manual version pin), mirroring `finance-service`'s existing declaration verbatim.
- **Files modified:** `services/inventory-service/pom.xml`
- **Verification:** `mvn -pl services/inventory-service -am test-compile` clean; all 9 ITs compile and pass.
- **Committed in:** `5029efc` (Task 2 commit)

**2. [Rule 1 - Bug] MacCalculator javadoc initially tripped its own acceptance-criteria grep**
- **Found during:** Task 1, immediately after writing `MacCalculator.java`
- **Issue:** The acceptance criteria require `grep -c "FLOOR" MacCalculator.java` to return 0, but the class javadoc originally said "never `MoneyUtils.taxPerLine`'s FLOOR" — a prose match, not functional code, but it still tripped the grep (mirrors 08-01-SUMMARY's identical pitfall with the word "FORCE" in a V1 migration comment).
- **Fix:** Reworded the javadoc to "never `MoneyUtils.taxPerLine`'s floored rounding" (same meaning, no longer contains the literal string "FLOOR"). No functional code was affected.
- **Files modified:** `services/inventory-service/src/main/java/io/restaurantos/inventory/service/MacCalculator.java`
- **Verification:** `grep -c "FLOOR"` returns 0; `grep -c "RoundingMode.HALF_UP"` returns 1; `MacCalculatorTest` 4/4 still pass.
- **Committed in:** `b35a43a` (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking dependency fix, 1 grep-tripping prose wording fix)
**Impact on plan:** Both fixes were necessary to meet the plan's own acceptance criteria; no scope creep, no functional behavior changed beyond what the plan specified.

## Issues Encountered
- `ingredient_branch_stock.ingredient_id` carries a `REFERENCES ingredients(id)` FK constraint (V1 schema) that `OpeningBalanceIT`'s first draft didn't account for — the test used a bare random `ingredientId` with no parent `ingredients` row, causing a `ConstraintViolationException` (500) on the opening-balance POST. Fixed by seeding the parent `Ingredient` row via `InventoryFixtures.seedIngredient` in `@BeforeEach` before recording the opening balance — the exact scenario `InventoryFixtures` exists to make trivial for downstream ITs.

## User Setup Required
None - no external service configuration required. Docker Desktop was running for the full Testcontainers-backed IT run (13/13 tests genuinely executed against a live Postgres, not compile-only).

## Next Phase Readiness
- The stock-domain model, `MacCalculator`, pessimistic-lock/FEFO repositories, and `InventoryFixtures` are ready for 08-05 (depletion consumer), 08-06 (receipts), 08-07 (transfers), and 08-08 (counts) to build on directly — no further domain-model work needed.
- `/api/v1/inventory/**` is reachable end-to-end through the gateway (route + feature-flag gating both active).
- No blockers. One item worth flagging for 08-05+: `MacCalculator`'s D-02 oversell-reset policy (oldQty<=0 resets MAC to the receipt unit cost, rather than blending) was this plan's own explicit interpretation of 08-RESEARCH.md Pitfall 4's open question — downstream receipt/depletion plans should treat this as the settled behavior, not re-litigate it.

---
*Phase: 08-inventory-recipe-management*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 21 created source files verified present on disk; all 3 task commit hashes (`b35a43a`,
`5029efc`, `4bd7dc0`) verified present in `git log --oneline --all`.
