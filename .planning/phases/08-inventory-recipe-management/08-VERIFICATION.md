---
phase: 08-inventory-recipe-management
verified: 2026-07-19T03:15:00Z
status: gaps_found
score: 4.5/5 success criteria verified (7/7 requirements code-backed; 1 requirement partially/functionally incomplete)
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Expiry alerts fire (ROADMAP Success Criterion 5, INV-06)"
    status: partial
    reason: >
      ExpirySweepService's per-tenant alert-generation logic (expiry-window + qty>0 filtering,
      EXPIRY_ALERT publish) is correctly implemented and proven by ExpirySweepIT — but only when
      an ambient TenantContext is pre-activated before sweep() runs (exactly what the IT does).
      In the REAL @Scheduled cron trigger path (nightlySweep() -> sweep()), there is no ambient
      tenant context on the background scheduler thread. sweep()'s first statement is
      StockLotRepository.findDistinctTenantIdsWithExpiringLots(cutoff), a query against
      stock_lots which carries FORCE ROW LEVEL SECURITY; inventory-service's DB role is
      NOSUPERUSER NOBYPASSRLS. With no tenant GUC set, this discovery query is bound by the same
      RLS policy as every other query on the table and returns zero tenant IDs — so in production,
      across a cold multi-tenant fleet, the nightly sweep silently does nothing for any tenant,
      every night, forever (not a rare edge case — this is the sweep's ONLY real invocation path).
      Source-verified directly (services/inventory-service/.../ExpirySweepService.java lines 92-99):
      no tenant/GUC activation precedes the discovery query. The gap is self-documented by the 08-08
      executor as coverage item D6 (human_judgment: true) and again as a "Known Limitation" section
      in 08-08-SUMMARY.md, requesting a future architectural decision (BYPASSRLS service account or
      a cross-tenant registry) that is out of this plan's scope. No later ROADMAP phase addresses
      this gap (checked Phase 9/10 and beyond — no cross-tenant scheduled-job or BYPASSRLS-role item
      exists), so it is not a deferred/scheduled item, it is an open gap.
    artifacts:
      - path: "services/inventory-service/src/main/java/io/restaurantos/inventory/service/ExpirySweepService.java"
        issue: "sweep()'s tenant-discovery query runs before any TenantContext/RLS-GUC activation, so it is blind to every tenant on the real (ambient-context-free) @Scheduled cron path; per-tenant logic is only proven under an artificially pre-seeded test context."
    missing:
      - "A tenant-discovery mechanism for the nightly sweep that does not depend on FORCE RLS visibility (e.g., a narrowly-scoped BYPASSRLS service role for this one query, or a cross-tenant registry table queried via a system-level connection) — OR an explicit product decision to trigger the sweep per-tenant from an external multi-tenant scheduler/orchestrator instead of Spring's in-process @Scheduled."
human_verification:
  - test: "Confirm whether the expiry-alert production gap (D6) is acceptable as documented deferred scope, or must be closed before Phase 8 ships"
    expected: "A human/product decision: either (a) accept via an override entry in this file with a tracked follow-up ticket, since low-stock alerts (the other half of SC5) and all count-variance posting work correctly and are proven, or (b) require a follow-up plan/phase to add a BYPASSRLS service role or cross-tenant registry so the nightly sweep can discover tenants in the real cron path."
    why_human: "This is an architecture-level trade-off (a new DB role or registry, touching deploy/init role provisioning shared by every service) explicitly flagged by the executor as outside Phase 8's scope — not something a verifier can resolve unilaterally."
---

> **D6 gap-closure update (2026-07-19):** The gap below (expiry-sweep cross-tenant discovery) has
> been **RESOLVED** by a targeted fix on `gsd/phase-08-inventory-recipe-management` — see
> `08-08-SUMMARY.md`'s "D6 Gap-Closure (2026-07-19)" section for the full approach (RLS-exempt
> `inventory_tenant_registry` registry, no BYPASSRLS, no domain-table FORCE-RLS relaxation) and
> test proof (`ExpirySweepCronPathIT`, full module regression 18 IT + 5 unit classes green). This
> report's original findings below are left unmodified as the historical audit record.

# Phase 8: Inventory & Recipe Management Verification Report

**Phase Goal:** Inventory tracks stock and valuation accurately and reacts to sales — versioned recipes drive `ORDER_CLOSED` depletion with moving-average cost, and receipts/transfers/counts keep MAC and quantities correct.
**Verified:** 2026-07-19T03:15:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

**Branch confirmed:** `gsd/phase-08-inventory-recipe-management` (matches expected). Working tree confirmed clean except the two pre-existing unrelated dirty files (`.dev-pids.json` deleted, `bugs.md` modified) — ignored per instructions.

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Managers manage ingredients, UOM, and reorder points; opening stock recorded via `OPENING_BALANCE` movement | ✓ VERIFIED | `IngredientController`/`UnitOfMeasureController`/`OpeningBalanceController` exist, call `InventoryAuthorizationService`; `OpeningBalanceService` writes stock+MAC+lot+movement. Code read directly; `mvn -pl services/inventory-service -am test-compile -q` succeeded. |
| 2 | Recipes/BOM versioned; depletion uses the recipe version effective at order time | ✓ VERIFIED | `RecipeRepository.findEffectiveVersionsDesc` — grep-confirmed zero `is_current`/`isCurrent` references; `DepletionService.deplete` calls `recipeService.resolveEffectiveRecipe(item.menuItemId(), payload.closedAt())` (source-read, line ~97-99). `RecipeVersionResolutionTest` re-run independently: PASS. |
| 3 | On `ORDER_CLOSED`, consumer depletes stock with `SELECT FOR UPDATE`, maintains MAC, idempotent on duplicate delivery | ✓ VERIFIED | `IngredientBranchStockRepository.findForUpdate` is `@Lock(PESSIMISTIC_WRITE)` (source-read); `MacCalculator.recomputeAvgCostPaisa` uses `HALF_UP`, zero `FLOOR` occurrences (source-read + independently re-run `MacCalculatorTest`: PASS); `OrderClosedConsumer` wraps `depletionService.deplete` in `processedEventService.tryProcess(CONSUMER_NAME="inventory.depletion", envelope.eventId(), ...)` (source-read). **`DepletionConsumerIT` independently re-run against a live Testcontainers Postgres in this session: BUILD SUCCESS** (proves duplicate-delivery idempotency end-to-end, not just claimed). |
| 4 | Stock receipts update MAC and publish `STOCK_RECEIVED`; transfers ship/receive with in-transit accounting and variance handling | ✓ VERIFIED | `ReceiptService.receive` (source-read) recomputes MAC via `MacCalculator`, creates a `StockLot`, writes `RECEIPT` movement, publishes `STOCK_RECEIVED`. `TransferService.ship/receive` (source-read) locks source/destination stock, recomputes destination MAC, detects variance, publishes `TRANSFER_SHIPPED/RECEIVED/VARIANCE`. Both artifacts exist, compile, and follow the identical transactional-outbox shape already proven live for depletion. SUMMARY-recorded IT results (`MacRecomputeIT`, `ReceiptServiceIT`, `TransferLifecycleIT`, access-control ITs) not independently re-run in this session (time-boxed to depletion + schema as the highest-risk paths) but code inspection shows no deviation from the proven pattern. |
| 5 | Stock counts post variances; low-stock and expiry alerts fire | ⚠️ PARTIAL — see Gap below | Count-variance posting: ✓ VERIFIED (`StockCountService.postCount`, source-read, mirrors proven depletion/receipt shape). Low-stock alerts: ✓ VERIFIED — wired into `DepletionService` and `StockCountService` (both source-read; fire on real, request/consumer-scoped transactions that already carry an ambient tenant context, so no RLS-discovery problem applies to them). Expiry alerts: ✗ **the real nightly `@Scheduled` cron trigger is a self-documented no-op across a multi-tenant fleet** — see Gaps section. |

**Score:** 4.5/5 success criteria fully verified (SC5 is half-verified: count-variance + low-stock genuinely work; expiry-alert production dispatch does not).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/inventory-service/src/main/resources/db/migration/V1__inventory_schema.sql` | 11 domain tables, FORCE RLS + NULLIF-guarded policy | ✓ VERIFIED | `grep -c "FORCE ROW LEVEL SECURITY"` = 11 (independently re-run, matches acceptance criteria exactly). |
| `services/inventory-service/.../V2__shared_infra_tables.sql` | RLS-exempt infra tables, granted to `inventory_user` | ✓ VERIFIED | `grep -c "ENABLE ROW LEVEL SECURITY"` = 0; `grep -c "inventory_user"` = 3 (independently re-run). |
| `MacCalculator.java` | HALF_UP weighted-average MAC, no FLOOR | ✓ VERIFIED | Source read in full — HALF_UP present, no FLOOR/taxPerLine reference; oversell-reset (oldQty<=0) policy present exactly as documented. |
| `IngredientBranchStockRepository.java` | `findForUpdate` PESSIMISTIC_WRITE | ✓ VERIFIED | Source read — `@Lock(LockModeType.PESSIMISTIC_WRITE)` on the exact JPQL query described. |
| `StockLotRepository.java` | FEFO ordering | ✓ VERIFIED | `findByStockIdOrderByExpiryDateAsc` present; NULLS LAST relies on Postgres default (documented, correct). |
| `DepletionService.java` | Sorted-lock, FEFO floor-at-zero, MAC-only COGS, transactional outbox | ✓ VERIFIED | Full source read — `TreeSet` sort before locking; `walkFefoAndFloor` floors each lot but decrements aggregate by full demand (D-02); `computeCogsPaisa` takes only `avgCostPaisa`, never a lot's cost; `STOCK_DEPLETED` publish is the last statement. |
| `OrderClosedConsumer.java` | Idempotent, tenant-aware, `inventory.depletion` | ✓ VERIFIED | Source read — `CONSUMER_NAME = "inventory.depletion"`; `tryProcess` wraps `tenantAwareMessageProcessor.process`. |
| `RecipeRepository.java` | `findEffectiveVersionsDesc`, no `is_current` filter | ✓ VERIFIED | Source read — JPQL matches D-01 exactly, zero `is_current` reference. |
| `ReceiptService.java`, `TransferService.java`, `StockCountService.java`, `ExpirySweepService.java` | Present, compile, follow the transactional-outbox pattern | ✓ VERIFIED (existence/pattern) / ⚠️ (ExpirySweepService — see gap) | All exist, all compile as part of the whole-module `test-compile` run. `ExpirySweepService`'s per-tenant logic is correct; its cross-tenant discovery is not. |
| `policies/restaurantos/inventory.rego` + `inventory_test.rego` | Default-deny, view/manage on seeded codes, 100% coverage | ✓ VERIFIED | **Independently re-run in this session**: `docker run openpolicyagent/opa:1.17.1 test /policies/ -v` → `PASS: 104/104`; `--coverage --format json` → inventory.rego coverage 100, 0 not-covered lines. |
| `InventoryAuthorizationService.java` | `authorizeView`/`authorizeManage` seam, fail-closed | ✓ VERIFIED | Source read + independently re-run `InventoryAuthorizationServiceTest`: PASS. |
| Gateway route + `RouteFeatureMap` | `/api/v1/inventory/**` active, mapped to `FEATURE_INVENTORY` | ✓ VERIFIED | `gateway/src/main/resources/application.yml` has an active `inventory-route` (`Path=/api/v1/inventory/**` → `lb://inventory-service`); `RouteFeatureMap.java` line 46 maps `/api/v1/inventory/` → `FEATURE_INVENTORY`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `OrderClosedConsumer` | `DepletionService.deplete` | `tryProcess` + `tenantAwareMessageProcessor.process` | ✓ WIRED | Source-confirmed; DepletionConsumerIT re-run proves it end-to-end (duplicate delivery → single depletion). |
| `DepletionService` | `RecipeService.resolveEffectiveRecipe(menuItemId, closedAt)` | direct call | ✓ WIRED | Source-confirmed — passes `payload.closedAt()`, never `Instant.now()`. |
| Every inventory controller | `InventoryAuthorizationService.authorizeView`/`authorizeManage` | direct call at top of endpoint | ✓ WIRED | `grep` across all 8 controller files shows every read endpoint calls `authorizeView` and every write endpoint calls `authorizeManage` — no controller skips the seam. |
| `IngredientBranchStock`/`StockLot`/`InventoryMovement` mutations | `EventPublisher.publish(...)` (transactional outbox) | last statement of each `@Transactional` method | ✓ WIRED | Confirmed in `DepletionService` (source read in full) and consistent pattern in `ReceiptService`/`TransferService`/`StockCountService` (source read). |
| `ExpirySweepService.sweep` | `StockLotRepository.findDistinctTenantIdsWithExpiringLots` | direct call, no prior tenant-context activation | ⚠️ PARTIAL | WIRED at the code level, but the call is made before any RLS/tenant-context activation — functionally blind on the real cron path (see gap). |
| gateway `inventory-route` | `RouteFeatureMap` | `/api/v1/inventory/` prefix | ✓ WIRED | Confirmed in both files. |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| INV-01 | 08-01 (claimed), 08-03 (implements), 08-09 (OPA) | Manager can manage ingredients, UOM, reorder points | ✓ SATISFIED | Genuinely code-backed: `IngredientController`/`UnitOfMeasureController`/`IngredientService` exist and compile; OPA seam wired. The concern that INV-01 was marked complete by 08-02 before 08-03 landed is resolved — 08-03 landed later in the same execution run and the code now exists and compiles. |
| INV-02 | 08-04 | Versioned recipes/BOM; depletion uses effective version at order time | ✓ SATISFIED | `Recipe`/`RecipeLine`/`RecipeRepository`/`RecipeService` exist; D-01 query verified by source read + independently re-run unit test. |
| INV-03 | 08-01 (claimed), 08-05 (implements) | `ORDER_CLOSED` consumer depletes with `SELECT FOR UPDATE`, MAC maintained | ✓ SATISFIED | Same early-marking concern as INV-01, now resolved: `DepletionService`/`OrderClosedConsumer` exist, and **`DepletionConsumerIT` was independently re-run in this session against a live Postgres and passed**, proving the idempotent depletion algorithm for real, not just per the SUMMARY's claim. |
| INV-04 | 08-06 | Stock receipts update MAC; `STOCK_RECEIVED` published | ✓ SATISFIED | `ReceiptService`/`ReceiptController`/`InternalGrnController` exist, compile, follow the proven transactional pattern. |
| INV-05 | 08-07 | Transfers ship/receive with in-transit accounting + variance | ✓ SATISFIED | `TransferService`/`TransferController` exist, compile, reuse `DepletionService.walkFefoAndFloor` and `MacCalculator` directly (source-confirmed). |
| INV-06 | 08-08 | Stock counts with variance posting; low-stock and expiry alerts | ⚠️ PARTIALLY SATISFIED | Count-variance posting and low-stock alerts are genuinely implemented and wired. **Expiry alerts are not functionally live in production** — see Gaps. The artifact (`ExpirySweepService`) exists and its algorithm is correct in isolation, but the real invocation path (nightly cron, no ambient tenant context) cannot discover any tenant under this codebase's FORCE-RLS + NOSUPERUSER-NOBYPASSRLS design, so it fires zero alerts, always, for every tenant, in the deployed system. |
| INV-07 | 08-01 (claimed), 08-03 (implements) | Opening stock recorded via `OPENING_BALANCE` movement | ✓ SATISFIED | `OpeningBalanceService`/`OpeningBalanceController` exist, compile, follow the transactional-outbox-free (by design — internal movement only) pattern documented in the plan. |

No orphaned requirements — all seven IDs (INV-01..INV-07) declared across the nine plans' frontmatter match REQUIREMENTS.md exactly.

### Anti-Patterns Found

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any inventory-service main source file during source reads of the correctness-critical classes (`MacCalculator`, `DepletionService`, `OrderClosedConsumer`, `RecipeRepository`, `ExpirySweepService`, `IngredientBranchStockRepository`, `StockLotRepository`). The one self-documented "Known Limitation" in `ExpirySweepService`'s javadoc and 08-08-SUMMARY.md is treated as the gap above, not a hidden stub — it was proactively and honestly disclosed by the executor, which is exactly the behavior the process wants, but the underlying functional gap still needs a human decision per the escalation-gate pattern.

### Independent Re-Verification Performed This Session

- `mvn -pl services/inventory-service -am test-compile -q` — **PASS** (whole module + test sources compile cleanly).
- `mvn -pl services/inventory-service test -Dtest=MacCalculatorTest,FefoLotWalkTest,DepletionCogsTest,RecipeVersionResolutionTest,InventoryAuthorizationServiceTest` — **PASS** (all 5 pure-unit-test classes, no Docker required).
- `mvn -pl services/inventory-service verify -Dit.test=SchemaMigrationIT,DepletionConsumerIT -DfailIfNoTests=false` — **BUILD SUCCESS** against a live Testcontainers Postgres (Docker was reachable this session) — independently proves FORCE RLS + tenant_isolation policy assertions (SchemaMigrationIT) and duplicate-ORDER_CLOSED idempotency + FEFO + MAC-COGS + outbox (DepletionConsumerIT), not merely SUMMARY-claimed.
- `docker run openpolicyagent/opa:1.17.1 test /policies/ -v` — **PASS: 104/104**; `--coverage` — **100%, 0 not-covered lines** for `inventory.rego` and the whole `policies/` tree.
- Full-module IT suites for 08-03/06/07/08 (`IngredientAdminIT`, `MacRecomputeIT`, `TransferLifecycleIT`, `StockCountIT`, `ExpirySweepIT`, etc.) were **not** independently re-run in this session (time-boxed to the highest-risk depletion/schema/OPA paths per the task's own suggestion that Testcontainers might not bootstrap — it did bootstrap, but re-running all ~52+ IT classes was judged unnecessary given consistent code-level correctness across every service in the same proven pattern). Relying on source inspection + the SUMMARY-recorded results for those, as explicitly permitted by the task brief.

## Gaps Summary

Nine of Phase 8's ten claimed capabilities (all correctness-critical claims specifically called out for scrutiny — pessimistic locking, MAC, idempotency, FEFO, transactional outbox, versioned-recipe resolution) are genuinely implemented, wired, and — for the highest-risk depletion/idempotency/RLS path — independently proven to work against a live database and a live OPA evaluation in this verification session, not merely asserted by the executors' SUMMARYs.

The one real gap: **`ExpirySweepService`'s nightly `@Scheduled` cross-tenant discovery is architecturally broken for its actual production trigger path.** The per-tenant alert logic is correct and IT-proven, but only because the IT pre-activates a tenant context that the real cron trigger never has. In production, on a cold multi-tenant fleet, the nightly sweep will discover zero tenants, every night, and never publish a single `EXPIRY_ALERT` — directly contradicting ROADMAP Success Criterion 5 ("...expiry alerts fire") and part of INV-06. This was self-disclosed by the 08-08 executor as `human_judgment: true` and flagged as needing an architectural decision (a BYPASSRLS service role or a cross-tenant registry) outside this plan's scope. No later phase in ROADMAP.md addresses this gap, so it cannot be treated as deferred scope without an explicit human decision.

**This looks like a legitimate scope trade-off, not a hidden defect** — the executor was honest about it, and low-stock alerts (the other alerting half of SC5) work correctly since they run inside already-tenant-scoped request/consumer transactions. If the team judges the expiry-sweep gap acceptable pending a fast-follow architectural fix, add an override:

```yaml
overrides:
  - must_have: "Expiry alerts fire (ROADMAP Success Criterion 5 / INV-06)"
    reason: "ExpirySweepService's per-tenant alert logic is correct and proven; the cross-tenant discovery gap under FORCE RLS is a known architectural constraint requiring a BYPASSRLS role or tenant registry, tracked as a follow-up outside Phase 8's original scope."
    accepted_by: "<name>"
    accepted_at: "<ISO timestamp>"
```

Absent that override, this phase should not be considered fully shipped until either (a) the override above is recorded, or (b) a follow-up plan closes the tenant-discovery gap (e.g., a scoped BYPASSRLS service account for this one query, or an external per-tenant scheduler trigger via a new `/internal/inventory/expiry-sweep?tenantId=...` endpoint mirroring the existing internal-service pattern).

---

*Verified: 2026-07-19T03:15:00Z*
*Verifier: Claude (gsd-verifier)*
