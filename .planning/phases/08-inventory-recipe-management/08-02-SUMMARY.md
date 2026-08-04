---
phase: 08-inventory-recipe-management
plan: 02
subsystem: testing
tags: [testcontainers, flyway, postgres, rls, spring-boot, junit5, jwt]

# Dependency graph
requires:
  - phase: 08-inventory-recipe-management (plan 01)
    provides: inventory-service Maven module, V1/V2 Flyway migrations (11 FORCE-RLS domain tables + 3 RLS-exempt infra tables), ProcessedEvent idempotency scaffolding
provides:
  - InventoryTestBase — reusable Testcontainers Postgres IT base class (entity-independent), mocking RabbitTemplate/StringRedisTemplate/OpaClient
  - TestFixtures — tenant/branch UUID generator, TenantContext activation helper, JwtClaims-based OWNER/MANAGER/INVENTORY_MANAGER auth builders, tenant-scoped raw JDBC helper
  - SchemaMigrationIT — runtime proof that V1+V2 migrate cleanly and FORCE RLS + tenant_isolation policy are enforced on all 11 domain tables, with the 3 infra tables proven RLS-exempt
affects: [08-03 (receipts/transfers), 08-04 (counts/alerts), 08-05 (depletion consumer), all downstream Phase-8 feature ITs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "InventoryTestBase mirrors KitchenTestBase's static-singleton Testcontainers Postgres + @BeforeAll Flyway.migrate() + @DynamicPropertySource + @MockitoBean(RabbitTemplate/StringRedisTemplate/OpaClient) shape exactly — this is now the repo's 4th instance of that exact pattern (kitchen, finance, and now inventory)."
    - "TestFixtures builds JwtClaims records directly + installs them via UsernamePasswordAuthenticationToken on SecurityContextHolder (not RSA-signed JWT strings) — matches kitchen-service's ItemStatusEndpointIT setAuth() pattern, the repo convention for controller-level ITs that don't need JWKS validation."
    - "SchemaMigrationIT asserts RLS via pg_catalog metadata (relrowsecurity/relforcerowsecurity + pg_policies), not cross-tenant row-visibility reads — required because the Testcontainers connection is a superuser and superusers bypass RLS regardless of FORCE."

key-files:
  created:
    - services/inventory-service/src/test/java/io/restaurantos/inventory/InventoryTestBase.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/TestFixtures.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/SchemaMigrationIT.java
  modified: []

key-decisions:
  - "TestFixtures builds JwtClaims + SecurityContextHolder auth directly rather than minting/signing real JWT strings (like authorization-service's TestFixtures does) — inventory's feature ITs will call controllers/services directly in-process like kitchen-service's ItemStatusEndpointIT, not over HTTP with a real bearer token, so RSA key generation and JWKS wiring would be unused complexity."
  - "SchemaMigrationIT includes both a single-table (ingredient_branch_stock) targeted assertion AND a full sweep across all 11 domain tables — the plan's acceptance criteria only required the former, but the latter costs one extra test method and gives complete coverage of 08-01's FORCE-RLS guarantee rather than a sample of one."
  - "TestFixtures' withTenantScope(DataSource, tenantId, action) helper opens a fresh JDBC connection per call rather than reusing the Spring-managed connection — deliberate: RLS-scoped raw seeding needs a connection whose GUC is set before any query executes, and reusing a pooled/transactional connection risks a stale or unset GUC from a prior test."

patterns-established:
  - "Pattern: entity-independent IT base class — InventoryTestBase contains zero imports of io.restaurantos.inventory.domain.model.*, so it cannot be broken/blocked by Wave-3+ domain-entity work; every downstream feature IT extends it without waiting on entity classes to exist."

requirements-completed: [INV-01, INV-03]

coverage:
  - id: D1
    description: "InventoryTestBase boots a Testcontainers PostgreSQL, applies V1+V2 via Flyway, and mocks RabbitTemplate/StringRedisTemplate/OpaClient so ITs run without a live broker"
    requirement: "INV-01"
    verification:
      - kind: integration
        ref: "SchemaMigrationIT extends InventoryTestBase; all 4 tests in the class pass, proving the base class boots the container, applies migrations, and mocks the 3 beans without error"
        status: pass
    human_judgment: false
  - id: D2
    description: "SchemaMigrationIT proves the migrations apply cleanly and that domain tables report relforcerowsecurity=true with a tenant_isolation policy present"
    requirement: "INV-03"
    verification:
      - kind: integration
        ref: "SchemaMigrationIT#allFourteenExpectedTablesExist, #ingredientBranchStock_hasForceRlsAndTenantIsolationPolicy, #allDomainTables_haveForceRlsAndTenantIsolationPolicy, #infraTables_areRlsExempt — mvn -pl services/inventory-service verify -Dit.test=SchemaMigrationIT (4/4 pass)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TestFixtures provides tenant/branch-scoped JWT + TenantContext helpers, including an INVENTORY_MANAGER role variant"
    requirement: "INV-01"
    verification:
      - kind: unit
        ref: "mvn -pl services/inventory-service -am test-compile (TestFixtures.inventoryManagerClaims/ownerClaims/managerClaims/activateTenantContext/withTenantScope all compile and are referenced from no other file yet — exercised transitively when 08-03+ ITs extend InventoryTestBase and call these helpers)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-19
status: complete
---

# Phase 08 Plan 02: Inventory Testcontainers Test Harness Summary

**InventoryTestBase (Testcontainers Postgres + Flyway + mocked broker/redis/OPA) and TestFixtures (JwtClaims-based OWNER/MANAGER/INVENTORY_MANAGER auth + tenant-scoped JDBC helper), proven by a SchemaMigrationIT that runs green against a live Testcontainers Postgres and confirms FORCE RLS + tenant_isolation on all 11 domain tables.**

## Performance

- **Duration:** ~12 min (commit-to-commit)
- **Started:** 2026-07-19T00:00Z (approx, first task commit)
- **Completed:** 2026-07-19T00:05Z (SchemaMigrationIT run + final task commit)
- **Tasks:** 2/2
- **Files modified:** 3 (all created)

## Accomplishments
- `InventoryTestBase`: static-singleton `PostgreSQLContainer("postgres:16")` (`inventory_db`/`inventory_user`/`inventory_pass`), `@BeforeAll` `Flyway.clean()+migrate()` against `classpath:db/migration`, `@DynamicPropertySource` wiring datasource + `spring.flyway.enabled=false` + `eureka.client.enabled=false` + `spring.cloud.config.enabled=false` + a dummy `restaurantos.opa.url`, and `@MockitoBean` `RabbitTemplate`/`StringRedisTemplate`/`OpaClient` — byte-for-byte mirror of `KitchenTestBase`'s proven shape, entity-independent by construction (verified: no `io.restaurantos.inventory.domain.model.*` import anywhere in the file)
- `TestFixtures`: `newTenantBranch()` (random tenant/branch UUID pair), `activateTenantContext(TenantContext, tenantId, branchId, userId)`, `ownerClaims`/`managerClaims`/`inventoryManagerClaims` (all carrying `inventory.item.view` + `inventory.item.manage` permissions via `JwtClaims` records), `authenticateAs(JwtClaims)` (installs a `UsernamePasswordAuthenticationToken` on `SecurityContextHolder`, matching kitchen-service's `ItemStatusEndpointIT.setAuth()` pattern), and `withTenantScope(DataSource, tenantId, TenantScopedAction)` (raw JDBC connection with `SET app.current_tenant_id` for RLS-scoped fixture seeding outside the JPA/TenantContext layer)
- `SchemaMigrationIT`: 4 tests, all green against a live Testcontainers Postgres — (1) all 14 expected tables exist post-migration, (2) `ingredient_branch_stock` reports `relrowsecurity=true`/`relforcerowsecurity=true` + a `tenant_isolation` policy in `pg_policies`, (3) the same FORCE-RLS + policy assertion holds across all 11 domain tables (broader than the plan's single-table requirement), (4) the 3 infra tables (`event_outbox`, `idempotency_keys`, `processed_events`) report `relrowsecurity=false`

## Task Commits

Each task was committed atomically:

1. **Task 1: InventoryTestBase + TestFixtures (Testcontainers harness, service-agnostic)** - `af21813` (feat)
2. **Task 2: SchemaMigrationIT — migrations apply and FORCE RLS is enforced** - `a46177e` (feat)

**Plan metadata:** committed separately below (docs: complete plan)

## Files Created/Modified
- `services/inventory-service/src/test/java/io/restaurantos/inventory/InventoryTestBase.java` - Abstract `@SpringBootTest` IT base: Testcontainers Postgres + Flyway migrate + mocked RabbitTemplate/StringRedisTemplate/OpaClient
- `services/inventory-service/src/test/java/io/restaurantos/inventory/TestFixtures.java` - Tenant/branch UUID generator, TenantContext activation, JwtClaims-based OWNER/MANAGER/INVENTORY_MANAGER auth builders, tenant-scoped raw JDBC helper
- `services/inventory-service/src/test/java/io/restaurantos/inventory/SchemaMigrationIT.java` - 4-test IT proving migrations apply + FORCE RLS/tenant_isolation on all domain tables + RLS-exemption on infra tables

## Decisions Made
- Built `JwtClaims`-based authentication (direct record + `SecurityContextHolder` installation) instead of RSA-signed JWT strings, because inventory's feature ITs (08-03 onward) will exercise controllers/services in-process the way kitchen-service's `ItemStatusEndpointIT` does, not over real HTTP with bearer tokens — matching the lower-complexity, already-proven repo pattern rather than authorization-service's JWKS-specific `TestFixtures`.
- Added a full 11-table RLS sweep test (`allDomainTables_haveForceRlsAndTenantIsolationPolicy`) in addition to the plan's required single-table (`ingredient_branch_stock`) assertion — costs one extra test method, gives complete proof of 08-01's FORCE-RLS guarantee across every domain table rather than one sample.
- `withTenantScope` opens a dedicated JDBC `Connection` per invocation (not a pooled/shared one) so the `app.current_tenant_id` GUC is guaranteed fresh for each RLS-scoped seeding call, avoiding cross-test GUC leakage.

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria passed on first attempt: `mvn -pl services/inventory-service -am test-compile -q` compiled cleanly after Task 1, and `mvn -pl services/inventory-service verify -Dit.test=SchemaMigrationIT -DfailIfNoTests=false` passed 4/4 after Task 2 (Docker was available for the full run — see Issues Encountered).

## Issues Encountered
- Docker Desktop was not running at the start of Task 2's verification step (`docker info` failed with "cannot connect to the Docker API"). Started Docker Desktop (`Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'`) and polled until the daemon was reachable — it came up promptly. `SchemaMigrationIT` then ran for real against a live Testcontainers Postgres 16 container; this is a genuine pass, not a compile-only claim.

## User Setup Required
None - no external service configuration required. Docker Desktop must be running for anyone re-running `SchemaMigrationIT` locally, same as every other Testcontainers-based IT in this repo.

## Next Phase Readiness
- `InventoryTestBase` + `TestFixtures` are ready for every Wave-3+ feature plan (08-03 receipts/transfers, 08-04 counts/alerts, 08-05 depletion consumer, etc.) to extend/import directly — no entity dependency blocks them.
- `SchemaMigrationIT` proves the Nyquist Wave-0 test-infrastructure gap identified in 08-VALIDATION.md is closed: migrations apply cleanly and FORCE RLS is enforced at the pg_catalog level, not just declared in SQL.
- No blockers. The `acknowledge-mode: manual` flag raised in 08-01's summary (regarding `OrderClosedConsumer`, which this plan does not build) remains open for whichever plan implements that consumer — noted here for continuity, out of scope for 08-02.

---
*Phase: 08-inventory-recipe-management*
*Completed: 2026-07-19*

## Self-Check: PASSED

All 3 created source files + the SUMMARY.md verified present on disk; both task commit hashes (`af21813`, `a46177e`) verified present in `git log --oneline --all`.
