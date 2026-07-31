---
phase: 08-inventory-recipe-management
verified: 2026-07-19T10:05:00Z
status: passed
score: 5/5 success criteria verified (7/7 requirements code-backed)
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: "4.5/5 success criteria verified"
  gaps_closed:
    - "Expiry alerts fire (ROADMAP Success Criterion 5, INV-06) — D6: ExpirySweepService's nightly @Scheduled cron trigger now discovers tenants via the RLS-exempt inventory_tenant_registry (V3 migration, commit 44a6530) instead of a FORCE-RLS-bound stock_lots query, so it is no longer blind on the real ambient-context-free cron path. Proven live by ExpirySweepCronPathIT in this session."
  gaps_remaining: []
  regressions: []
---

# Phase 8: Inventory & Recipe Management Verification Report — RE-VERIFICATION (D6 gap-closure scope)

**Phase Goal:** Inventory tracks stock and valuation accurately and reacts to sales — versioned recipes drive `ORDER_CLOSED` depletion with moving-average cost, and receipts/transfers/counts keep MAC and quantities correct.
**Verified:** 2026-07-19T10:05:00Z
**Status:** passed
**Re-verification:** Yes — scoped re-verification of the single D6 gap from the 2026-07-19T03:15:00Z initial verification. Success Criteria 1-4 and 6/7 requirements were already independently VERIFIED there and are NOT re-litigated in this pass; their rows below are carried forward unchanged.

**Branch confirmed:** `gsd/phase-08-inventory-recipe-management` (`git rev-parse --abbrev-ref HEAD`). Working tree confirmed clean except the two pre-existing, phase-unrelated dirty files (`.dev-pids.json` deleted, `bugs.md` modified) — left untouched per instructions.

## D6 Gap-Closure Verification

The prior verification's sole gap: `ExpirySweepService`'s nightly `@Scheduled` sweep discovered tenants via a query on `stock_lots` (FORCE ROW LEVEL SECURITY) with no ambient tenant context, so under the production `NOSUPERUSER NOBYPASSRLS` role it found zero tenants and expiry alerts never fired on the real cron path. Fixed by commit `44a6530` (+ docs commit `80f26a3`). Independently re-verified in this session — not trusted from SUMMARY.md claims:

### 1. RLS-exempt tenant registry, isolation untouched

**File:** `services/inventory-service/src/main/resources/db/migration/V3__tenant_registry.sql`

- Adds `inventory_tenant_registry (tenant_id UUID PRIMARY KEY, first_seen TIMESTAMPTZ)` — **no `ENABLE`/`FORCE ROW LEVEL SECURITY` statement present** (read the migration in full; it mirrors V2's non-RLS shared-infra convention exactly).
- `GRANT SELECT, INSERT ON inventory_tenant_registry TO inventory_user;` — no `BYPASSRLS` grant anywhere in this migration.
- Confirmed **no `BYPASSRLS` grant exists anywhere in the repo** for `inventory_user`: `grep -rn BYPASSRLS deploy/init/` shows `inventory_user` still created `NOSUPERUSER NOBYPASSRLS` in `deploy/init/02-create-roles.sql` line 18, unchanged.
- Confirmed **domain-table RLS is completely untouched**: `git diff 41efd24 44a6530 -- .../V1__inventory_schema.sql .../V2__shared_infra_tables.sql` is **empty** (zero changes to either file) and `V1__inventory_schema.sql` still has `FORCE ROW LEVEL SECURITY` on all 11 domain tables (`grep -c` = 11, same as initial verification). No `NO FORCE`/`DISABLE ROW LEVEL SECURITY` statement exists anywhere in the migration directory.
- **Verdict: VERIFIED.** Isolation model for every domain table is unchanged; the registry is a narrow, non-sensitive existence-only side table.

### 2. Sweep discovers tenants from the registry, per-tenant RLS loop unchanged

**File:** `services/inventory-service/src/main/java/io/restaurantos/inventory/service/ExpirySweepService.java`

- `sweep(today, leadDays)` now calls `tenantRegistryRepository.findAllTenantIds()` (source-read, line 103) — a plain JPQL `SELECT r.tenantId FROM InventoryTenantRegistryEntity r` against the RLS-exempt registry, needing no ambient `TenantContext`.
- The old `StockLotRepository.findDistinctTenantIdsWithExpiringLots` (the broken FORCE-RLS-bound discovery query) was **removed entirely** — confirmed via `git diff` on `StockLotRepository.java`: the `@Query` method and its javadoc explaining the RLS constraint are deleted; only the legitimate per-tenant lot query (`findByTenantIdAndExpiryDateLessThanEqualAndQtyGreaterThan`) remains, now re-documented as scoped to "an already-active TenantContext/RLS GUC."
- The per-tenant loop (`sweepTenant`) is unchanged in shape: `tenantContext.set(...)` -> `TenantGucHelper.apply(entityManager, tenantContext)` -> `session.enableFilter("tenantFilter")` -> per-tenant lot query -> `EXPIRY_ALERT` publish -> context restore/clear in a `finally` block (with an explicit `clear()` branch to avoid leaking a tenant context onto the pooled scheduler thread when there was no ambient context to restore — a correct and non-obvious detail, source-read in full).
- **Verdict: VERIFIED.** Discovery no longer depends on RLS visibility; per-tenant enforcement is unchanged.

### 3. Tenant registration hooked into every stock-creation write path

**Files:** `OpeningBalanceService.java`, `ReceiptService.java`, `TransferService.java` (`receive`), `StockCountService.java`

- All four call `tenantRegistryService.registerTenant(tenantId)` as the first statement inside their `@Transactional` method, immediately after resolving `tenantId` from `TenantContext`, before any stock read/write — confirmed by direct source read of all four call sites (`OpeningBalanceService` lines 46-52, `ReceiptService` lines 56-62, `StockCountService` lines 77-83, `TransferService.receive` lines 158-164).
- `TenantRegistryService.registerTenant` deliberately carries **no `@Transactional` of its own** (source-read, javadoc explicit about this) — it joins the caller's already-open transaction via Spring's default `REQUIRED` propagation, so registration and the stock write commit or roll back atomically. `InventoryTenantRegistryRepository.upsertTenant` uses a native `INSERT ... ON CONFLICT (tenant_id) DO NOTHING`, confirmed idempotent.
- **Verdict: VERIFIED.** All four write paths that first create tenant-scoped stock register the tenant in the same transaction, atomically and idempotently.

### 4. Behavioral proof — cron-path IT run live (not code-inspected only)

Docker/Testcontainers was unavailable at the start of this session (`docker info` failed — Docker Desktop was not running); it was started and became ready before the run, so this was **executed live, not code-inspected as a fallback**.

```
mvn -pl services/inventory-service verify -Dit.test=ExpirySweepCronPathIT,ExpirySweepIT -DfailIfNoTests=false
```

**Result — both green, confirmed via `target/failsafe-reports/` (report timestamps checked against the run's wall-clock time to confirm freshness — reports written 15:02, run completed 15:03 local):**

| Test class | Tests run | Failures | Errors | Result |
|---|---|---|---|---|
| `ExpirySweepCronPathIT` | 1 | 0 | 0 | **PASS** |
| `ExpirySweepIT` | 2 | 0 | 0 | **PASS** |

`ExpirySweepCronPathIT.nightlySweep_withNoAmbientTenantContext_discoversAllTenantsViaRegistry_andAlertsEachOne` (source read in full) is designed specifically to avoid the false-positive risk of Testcontainers' superuser Postgres connection masking the production RLS-role bug: it seeds two tenants through the **real application write path** (`ReceiptService.receive`, not a direct-repository fixture), asserts `inventory_tenant_registry` contains both tenants **before** calling `sweep()`, then calls `sweep(today, leadDays)` with `tenantContext.getTenantId()` asserted empty (no ambient context) — i.e. the exact real cron shape. It asserts tenant A (lot inside the expiry window) gets exactly 1 `EXPIRY_ALERT` in the outbox and tenant B (lot outside the window) gets zero, and that the tenant context is empty again afterward (no thread-local leak onto the scheduler's pooled thread). This test passing is direct proof that `EXPIRY_ALERT` fires across multiple tenants with zero ambient tenant context — the exact production failure mode the original gap described.

`ExpirySweepIT` (updated in the same commit to register its fixture-seeded tenant explicitly, since it bypasses the app services) also passes, confirming the pre-existing per-tenant alert-window/qty-filter logic still works under registry-driven discovery.

- **Verdict: VERIFIED (behaviorally proven, not just presence-checked).**

### Residual limitation (assessed, non-blocking)

`inventory_tenant_registry` is populated only by the four write paths above — a tenant whose stock rows were created **before** this fix landed (e.g. via direct DB seed/migration outside the app, or in a deployment window prior to `44a6530`) would not appear in the registry until its next opening-balance/receipt/transfer-receive/count write touches that write path again. This is a real edge case in general, but assessed as **non-blocking for this phase**: Phase 8 is a newly-shipped module with a fresh schema — there is no pre-existing production inventory data predating this fix to backfill — and the same four write paths are the only way any tenant acquires stock in the first place, so every tenant that will ever have inventory data necessarily passes through one of them. No backfill migration is required for this phase's goal to be met.

## Goal Achievement (carried forward from initial verification — unchanged, not re-litigated this pass)

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Managers manage ingredients, UOM, and reorder points; opening stock recorded via `OPENING_BALANCE` movement | ✓ VERIFIED | Unchanged from initial verification (2026-07-19T03:15:00Z) — not re-checked this pass. |
| 2 | Recipes/BOM versioned; depletion uses the recipe version effective at order time | ✓ VERIFIED | Unchanged from initial verification — not re-checked this pass. |
| 3 | On `ORDER_CLOSED`, consumer depletes stock with `SELECT FOR UPDATE`, maintains MAC, idempotent on duplicate delivery | ✓ VERIFIED | Unchanged from initial verification — not re-checked this pass. |
| 4 | Stock receipts update MAC and publish `STOCK_RECEIVED`; transfers ship/receive with in-transit accounting and variance handling | ✓ VERIFIED | Unchanged from initial verification — not re-checked this pass. `ReceiptService`/`TransferService` were additionally re-read in this pass (for the D6 tenant-registration hook) with no regression observed. |
| 5 | Stock counts post variances; low-stock and expiry alerts fire | ✓ **VERIFIED (upgraded from ⚠️ PARTIAL)** | Count-variance posting and low-stock alerts: previously VERIFIED, unchanged. Expiry alerts: **the D6 gap is closed** — see "D6 Gap-Closure Verification" above. `ExpirySweepCronPathIT` proves `EXPIRY_ALERT` fires across multiple tenants via the real `sweep()` entry point with zero ambient tenant context, run live in this session. |

**Score:** 5/5 success criteria fully verified.

### Requirements Coverage (INV-06 updated, all others carried forward)

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| INV-01 through INV-05, INV-07 | (see initial verification) | (unchanged) | ✓ SATISFIED | Unchanged from initial verification — not re-checked this pass. |
| INV-06 | 08-08 (+ D6 gap-closure fix, `44a6530`/`80f26a3`) | Stock counts with variance posting; low-stock and expiry alerts | ✓ **SATISFIED (upgraded from ⚠️ PARTIALLY SATISFIED)** | Count-variance posting and low-stock alerts: previously satisfied, unchanged. Expiry alerts: the production no-op gap is closed — tenant discovery now sources from `inventory_tenant_registry` (RLS-exempt, V3), registered idempotently in-transaction by every stock-creation write path, and `ExpirySweepCronPathIT` proves `EXPIRY_ALERT` fires for the correct tenant/lot with zero ambient context, live-run in this session. |

No orphaned requirements (unchanged from initial verification — all seven IDs INV-01..INV-07 match REQUIREMENTS.md).

### Anti-Patterns Found (D6 fix files, this pass)

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the fix's files (`V3__tenant_registry.sql`, `InventoryTenantRegistryEntity.java`, `InventoryTenantRegistryRepository.java`, `TenantRegistryService.java`, `ExpirySweepService.java`, `ExpirySweepCronPathIT.java`, and the four service call sites) — all read in full during this pass.

### Independent Re-Verification Performed This Session (D6 scope)

- Read `V3__tenant_registry.sql`, `ExpirySweepService.java`, `TenantRegistryService.java`, `InventoryTenantRegistryEntity.java`, `InventoryTenantRegistryRepository.java`, `ExpirySweepCronPathIT.java` in full.
- `git diff 41efd24 44a6530` on `V1__inventory_schema.sql`/`V2__shared_infra_tables.sql` -> empty (domain-table RLS untouched); on `StockLotRepository.java` -> confirmed the broken discovery query was removed cleanly, the legitimate per-tenant query kept.
- `grep -rn BYPASSRLS deploy/init/` -> `inventory_user` still `NOSUPERUSER NOBYPASSRLS`, unchanged.
- Read the tenant-registration call sites in `OpeningBalanceService`, `ReceiptService`, `TransferService.receive`, `StockCountService` — all four correctly placed inside the transactional method, before the stock write, using the resolved `tenantId`.
- Started Docker Desktop (was not running at session start), waited for the daemon to become ready, then ran:
  `mvn -pl services/inventory-service verify -Dit.test=ExpirySweepCronPathIT,ExpirySweepIT -DfailIfNoTests=false` — **exit code 0**; `target/failsafe-reports/` confirms `ExpirySweepCronPathIT` 1/1 pass, `ExpirySweepIT` 2/2 pass, both with fresh timestamps matching this session's run (not stale reports from a prior run).
- Confirmed clean working tree apart from the two pre-existing, phase-unrelated dirty files (`.dev-pids.json`, `bugs.md`), left untouched.

## Gaps Summary

**None remaining.** The single gap from the initial verification (D6 — expiry-sweep cross-tenant discovery blind on the real `@Scheduled` cron path under `FORCE RLS` + `NOSUPERUSER NOBYPASSRLS`) is closed by commit `44a6530`, independently confirmed in this session via source inspection (not SUMMARY.md claims) and a live Testcontainers run of `ExpirySweepCronPathIT` (which specifically proves the real cron shape — no ambient tenant context — discovers and alerts across multiple tenants) and `ExpirySweepIT` (regression-proven under registry-driven discovery). Tenant isolation is unchanged: no `BYPASSRLS` grant was added anywhere, and no domain table's `FORCE ROW LEVEL SECURITY` was relaxed — the fix only replaces the discovery mechanism with a narrow, non-sensitive, RLS-exempt existence registry, exactly as the fix's own documentation claims and as independently verified here.

One residual limitation was assessed and judged non-blocking: tenants are registered only via the four stock-creation write paths, so any tenant with stock predating this fix (outside the scope of this newly-shipped phase) would need one further write-path touch to appear in the registry. This does not block Phase 8's goal since the phase ships with a fresh schema and no pre-existing data.

**Phase 8 is now fully verified: 5/5 success criteria, 7/7 requirements satisfied.**

---

*Verified: 2026-07-19T10:05:00Z*
*Verifier: Claude (gsd-verifier)*
