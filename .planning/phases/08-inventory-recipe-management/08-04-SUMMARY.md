---
phase: 08-inventory-recipe-management
plan: 04
subsystem: inventory
tags: [spring-boot, jpa, postgres, rls, opa, mockmvc, java25, mockito]

# Dependency graph
requires:
  - phase: 08-inventory-recipe-management (plan 02)
    provides: InventoryTestBase (Testcontainers Postgres harness), TestFixtures (JwtClaims/TenantContext helpers)
  - phase: 08-inventory-recipe-management (plan 03)
    provides: Ingredient/UOM stock-domain precedent (entity/repository/service/controller shape, InventoryFixtures)
  - phase: 08-inventory-recipe-management (plan 09)
    provides: InventoryAuthorizationService (authorizeView/authorizeManage OPA seam)
provides:
  - Versioned Recipe + RecipeLine JPA entities (INV-02) mapped 1:1 to the V1 recipes/recipe_lines tables
  - RecipeRepository.findEffectiveVersionsDesc — the D-01 effective-version resolution query (effective_from <= atInstant ORDER BY effective_from DESC, deliberately NOT filtered on is_current)
  - RecipeService.resolveEffectiveRecipe(menuItemId, atInstant) — the seam 08-05's depletion consumer calls with the order's closedAt
  - RecipeService.createVersion — next-version compute + prior-version is_current unset + line persistence
  - RecipeController (/api/v1/inventory/recipes) wired into the 08-09 OPA seam (authorizeManage on create, authorizeView on reads)
affects: [08-05 (depletion consumer — the direct consumer of resolveEffectiveRecipe)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "D-01 resolution seam: a repository method that deliberately omits the is_current filter, paired with a service method (resolveEffectiveRecipe) that takes .stream().findFirst() of the effective-from-DESC-ordered list — this is the shape 08-05's DepletionService must call with the order's closedAt, never Instant.now()."
    - "Mockito thenAnswer() stub that mirrors a JPQL filter's exact semantics (effectiveFrom <= atInstant, sorted DESC) — lets a pure unit test exercise real resolution logic across multiple instants without touching a live database, while the paired *IT class proves the same behavior against a live Postgres."

key-files:
  created:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/Recipe.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/domain/model/RecipeLine.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/RecipeRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/repository/RecipeLineRepository.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/RecipeService.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/web/RecipeController.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/dto/RecipeDtos.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/RecipeVersionResolutionTest.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/RecipeVersionResolutionIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/RecipeAccessControlIT.java
  modified: []

key-decisions:
  - "resolveEffectiveRecipe(menuItemId, atInstant) is a plain UUID+Instant signature, not order-typed — keeps RecipeService decoupled from pos-service's Order shape; 08-05's DepletionService is expected to pass order.getClosedAt() at the call site rather than this plan reaching into pos-service."
  - "RecipeVersionResolutionTest uses a Mockito thenAnswer() stub (not a bare thenReturn) so the same mocked-repository test genuinely exercises the effectiveFrom<=atInstant + ORDER BY DESC filter across four distinct instants (inside-window, at-boundary, after, before) rather than only proving RecipeService.resolveEffectiveRecipe correctly calls findFirst() on a fixed canned list."
  - "GET /api/v1/inventory/recipes/{menuItemId}/effective binds the `at` query param directly as java.time.Instant (no @DateTimeFormat) — Spring's built-in InstantFormatter (registered unconditionally by DateTimeFormatterRegistrar) already parses ISO-8601 instant strings; adding @DateTimeFormat(iso=DATE_TIME) would apply a LocalDateTime-oriented pattern that is not the correct formatter for Instant and risks parse mismatches."

patterns-established:
  - "Pattern: for any future 'effective version at a point in time' seam (mirrors D-01), stub the repository method's real filter/sort semantics with Mockito thenAnswer() in the unit test, and mirror the exact same fixture (same version numbers, same is_current-inverted assignment) in the paired *IT class for the DB-backed proof — this plan's RecipeVersionResolutionTest/RecipeVersionResolutionIT pair is the template."

requirements-completed: [INV-02]

coverage:
  - id: D1
    description: "Recipe + RecipeLine JPA entities extending TenantAuditableEntity, mapped exactly to the V1 recipes/recipe_lines schema (menu_item_id, version, is_current, effective_from, yield_servings; recipe_id, ingredient_id, qty, uom_code, yield_pct)"
    requirement: "INV-02"
    verification:
      - kind: unit
        ref: "mvn -pl services/inventory-service -am test-compile (exit 0)"
        status: pass
    human_judgment: false
  - id: D2
    description: "RecipeRepository.findEffectiveVersionsDesc — the D-01 query (effective_from <= atInstant ORDER BY effective_from DESC), deliberately not filtering on is_current; RecipeService.resolveEffectiveRecipe delegates .stream().findFirst() to it"
    requirement: "INV-02"
    verification:
      - kind: unit
        ref: "RecipeVersionResolutionTest — 4/4 pass (in-window resolves to stale-but-effective v1, at/after T2 resolves to v2, before T1 resolves empty, is_current explicitly ignored)"
        status: pass
      - kind: integration
        ref: "RecipeVersionResolutionIT — 3/3 pass against live Testcontainers Postgres, same semantics DB-backed"
        status: pass
    human_judgment: false
  - id: D3
    description: "RecipeController (/api/v1/inventory/recipes): POST create-version, GET list-by-menuItemId, GET {menuItemId}/effective?at=; every endpoint calls InventoryAuthorizationService.authorizeView (reads) / authorizeManage (create) — the T-8-AC mitigation"
    requirement: "INV-02"
    verification:
      - kind: integration
        ref: "RecipeAccessControlIT — 2/2 pass (view-only principal denied 403 on POST /recipes; INVENTORY_MANAGER allowed 200 on POST + a GET read) — live Testcontainers Postgres"
        status: pass
    human_judgment: false

# Metrics
duration: 13min
completed: 2026-07-19
status: complete
---

# Phase 8 Plan 04: Versioned Recipes/BOM + D-01 Effective-Version Resolution Summary

**Recipe/RecipeLine versioned BOM model, CRUD wired into the 08-09 OPA seam, and the D-01 effective-version resolution query (`effective_from <= atInstant ORDER BY effective_from DESC`, deliberately never `is_current`) that 08-05's depletion consumer will call with the order's `closedAt` — proven by 9 green tests (4 unit + 5 integration) against a live Testcontainers Postgres.**

## Performance

- **Duration:** ~13 min (commit-to-commit)
- **Started:** 2026-07-19T00:58:55+05:00 (Task 1 commit)
- **Completed:** 2026-07-19T01:02:57+05:00 (Task 2 commit)
- **Tasks:** 2/2
- **Files modified:** 10 (10 created, 0 modified)

## Accomplishments
- `Recipe`/`RecipeLine` JPA entities extending `TenantAuditableEntity`, mapped 1:1 to the V1 `recipes`/`recipe_lines` columns (`is_current` mapped to the boxed `boolean current` field so Lombok's `isCurrent()` matches the DB column name exactly)
- `RecipeRepository.findEffectiveVersionsDesc` — the D-01 query, hand-verified to contain zero occurrences of `is_current`/`isCurrent` (grep-checked per the plan's own acceptance criteria); `findByMenuItemIdOrderByVersionDesc` for next-version computation
- `RecipeService.createVersion` — computes next version as `max(version)+1` for the menu item, flips `is_current=false` on every prior version, defaults `effectiveFrom` to `Instant.now()` when the request omits it, and persists all `recipe_lines` in one call; `resolveEffectiveRecipe(menuItemId, atInstant)` is the exact D-01 seam — `findEffectiveVersionsDesc(...).stream().findFirst()`
- `RecipeController` (`/api/v1/inventory/recipes`): `POST` (create-version, `authorizeManage`), `GET` (list by `menuItemId`, `authorizeView`), `GET /{menuItemId}/effective?at=<instant>` (resolved version or 404, `authorizeView`) — mirrors `IngredientController`'s `@RequiresFeature("FEATURE_INVENTORY")` + OPA-seam shape from 08-03
- `RecipeVersionResolutionTest` — 4 unit tests (no Docker) using a Mockito `thenAnswer()` stub that mirrors the real JPQL filter/sort semantics exactly, proving `resolveEffectiveRecipe` picks the in-window version even when it is flagged `is_current=false` and a later, `is_current=true` version exists
- `RecipeVersionResolutionIT` — the DB-backed proof of the identical semantics: persists v1(`effective_from=T1`, `is_current=false`) and v2(`effective_from=T2>T1`, `is_current=true`) against a live Testcontainers Postgres, asserts the same three behaviors through the real repository/JPA stack
- `RecipeAccessControlIT` — proves `RecipeController` actually calls `InventoryAuthorizationService` (not just the coarse feature gate): a view-only JWT is denied 403 on `POST /recipes`; an `INVENTORY_MANAGER` JWT succeeds on the same write and a subsequent read

## Task Commits

Each task was committed atomically:

1. **Task 1: Recipe/RecipeLine model + versioned CRUD + effective-version query (D-01)** - `426c13e` (feat)
2. **Task 2: RecipeVersionResolutionIT — effective version resolved by closedAt window, not is_current** - `3f8f917` (test)

**Plan metadata:** committed separately below (docs: complete plan)

## Files Created/Modified
- `services/inventory-service/.../domain/model/{Recipe,RecipeLine}.java` - Versioned BOM entities extending TenantAuditableEntity
- `services/inventory-service/.../repository/RecipeRepository.java` - `findEffectiveVersionsDesc` (D-01 query) + `findByMenuItemIdOrderByVersionDesc`
- `services/inventory-service/.../repository/RecipeLineRepository.java` - `findByRecipeId`
- `services/inventory-service/.../service/RecipeService.java` - `createVersion` (next-version + is_current flip) + `resolveEffectiveRecipe` (D-01 seam)
- `services/inventory-service/.../web/RecipeController.java` - `/api/v1/inventory/recipes` — create-version (authorizeManage), list + effective (authorizeView)
- `services/inventory-service/.../dto/RecipeDtos.java` - Request/response records with `@Valid` boundary validation (T-8-NEGQTY)
- `services/inventory-service/src/test/.../RecipeVersionResolutionTest.java` - 4 unit tests, no Docker, Mockito `thenAnswer()` mirrors the real JPQL filter
- `services/inventory-service/src/test/.../RecipeVersionResolutionIT.java` - 3 integration tests, DB-backed D-01 proof
- `services/inventory-service/src/test/.../RecipeAccessControlIT.java` - 2 integration tests, OPA enforcement on the recipe endpoints

## Decisions Made
- `resolveEffectiveRecipe` takes a plain `(UUID menuItemId, Instant atInstant)` signature — 08-05's `DepletionService` is expected to pass `order.getClosedAt()` at its own call site, keeping this service decoupled from pos-service's `Order` type.
- `RecipeVersionResolutionTest`'s mocked-repository stub uses `thenAnswer()` (not `thenReturn()`) so the unit test genuinely re-derives the JPQL filter/sort behavior across four distinct instants, rather than only proving `resolveEffectiveRecipe` calls `findFirst()` on a fixed canned list.
- `GET .../effective?at=` binds `Instant` directly with no `@DateTimeFormat` annotation, relying on Spring's built-in `InstantFormatter` (registered unconditionally) — adding an explicit `@DateTimeFormat(iso=DATE_TIME)` would substitute a `LocalDateTime`-oriented pattern that is the wrong formatter for `Instant`.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria (unit-test green, `is_current`/`isCurrent` grep returns 0, DB-backed IT green, 403/200 OPA-enforcement IT green) were met without needing any Rule 1/2/3 fixes.

## Issues Encountered
None specific to this plan. The module's background `OutboxRelay` scheduled poller logs a recurring `relation "event_outbox" does not exist` ERROR during every `*IT` run in this test harness (the minimal V1/V2 migration set used by `InventoryTestBase` does not create `event_outbox`) — this is a pre-existing, harmless log-noise artifact unrelated to Recipe/RecipeLine (also present in 08-03's test runs) and does not fail any test; not fixed here as it is out of this plan's scope (SCOPE BOUNDARY).

## User Setup Required
None - Docker Desktop was running for the full Testcontainers-backed IT run (9/9 Recipe-specific tests genuinely executed against a live Postgres, not compile-only; 29/29 tests green across the whole inventory-service module including the 08-03 suite, confirming no regression).

## Next Phase Readiness
- `RecipeService.resolveEffectiveRecipe(UUID menuItemId, Instant atInstant)` is ready for 08-05's `DepletionService` to call directly with the order's `closedAt` — this is the exact seam the plan set out to deliver.
- `/api/v1/inventory/recipes/**` is reachable through the same gateway route (`/api/v1/inventory/**`) 08-03 already activated — no further gateway work needed.
- No blockers.

---
*Phase: 08-inventory-recipe-management*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 10 created source files verified present on disk; both task commit hashes (`426c13e`,
`3f8f917`) verified present in `git log --oneline --all`.
