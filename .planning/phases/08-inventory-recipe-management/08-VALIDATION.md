---
phase: 8
slug: inventory-recipe-management
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `08-RESEARCH.md` § Validation Architecture (HIGH confidence, grounded in existing kitchen/pos/finance-service test suites).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | JUnit 5 + Testcontainers (PostgreSQL, RabbitMQ) + AssertJ + Awaitility (mirrors `BaseIntegrationTest` from `10-test-architecture-guide.md §10.1` and every existing service) |
| **Config file** | none yet — Wave 0 creates `services/inventory-service/src/test/java/io/restaurantos/inventory/BaseIntegrationTest.java` + `TestFixtures.java` (copy kitchen-service's, rename package) |
| **Quick run command** | `mvn -pl services/inventory-service -am test` (unit `*Test.java` only; excludes `*IT.java` per surefire config) |
| **Full suite command** | `mvn -pl services/inventory-service -am verify -Dtestcontainers.reuse.enable=false` (runs `*IT.java` via failsafe; requires Docker) |
| **Estimated runtime** | unit ~20–40s; full IT suite ~3–6 min (Testcontainers spin-up) |

---

## Sampling Rate

- **After every task commit:** Run `mvn -pl services/inventory-service -am test` (fast unit tests: MAC math, FEFO walk, recipe-version resolution — no Docker needed)
- **After every plan wave:** Run `mvn -pl services/inventory-service -am verify` (full Testcontainers IT suite)
- **Before `/gsd-verify-work`:** Full suite green + `mvn -pl services/inventory-service verify -Pcoverage` **≥75% line coverage** (inventory CI gate, forward-declared in `.github/workflows/coverage-gates.json`)
- **Max feedback latency:** ~40 seconds (unit tier)

---

## Per-Task Verification Map

Task IDs firm up when PLAN.md files exist; rows below are requirement-anchored and assigned to the ROADMAP plan that owns them (08-01 masters/recipes/opening, 08-02 depletion, 08-03 receipts/transfers/counts/alerts).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-* | 01 | 1 | INV-01 | T-8-AC | Reject negative receipt/count qty at API boundary; RLS on ingredient/UOM tables | integration | `mvn -pl services/inventory-service test -Dtest=IngredientAdminIT` | ❌ W0 | ⬜ pending |
| 08-01-* | 01 | 1 | INV-02 | — | Recipe version resolved by `closedAt` window, not `is_current` | unit + integration | `mvn -pl services/inventory-service test -Dtest=RecipeVersionResolutionTest,RecipeVersionResolutionIT` | ❌ W0 | ⬜ pending |
| 08-01-* | 01 | 1 | INV-07 | — | Opening stock recorded as `OPENING_BALANCE` movement | integration | `mvn -pl services/inventory-service test -Dtest=OpeningBalanceIT` | ❌ W0 | ⬜ pending |
| 08-02-* | 02 | 2 | INV-03 | T-8-IDEM / T-8-RACE | Depletion `SELECT FOR UPDATE`, MAC maintained, idempotent on duplicate `ORDER_CLOSED` | integration | `mvn -pl services/inventory-service test -Dtest=DepletionConsumerIT` | ❌ W0 | ⬜ pending |
| 08-02-* | 02 | 2 | INV-03 (neg stock) | T-8-AC | Oversell allows negative aggregate; lots floor at zero (D-02) | unit | `mvn -pl services/inventory-service test -Dtest=FefoLotWalkTest` | ❌ W0 | ⬜ pending |
| 08-03-* | 03 | 3 | INV-04 | T-8-RACE | Receipt updates MAC (HALF_UP, BigDecimal); `STOCK_RECEIVED` via outbox | unit + integration | `mvn -pl services/inventory-service test -Dtest=MacCalculatorTest,ReceiptServiceIT` | ❌ W0 | ⬜ pending |
| 08-03-* | 03 | 3 | INV-05 | — | Transfer ship/receive, in-transit (`1320`) accounting, variance-on-receive | integration | `mvn -pl services/inventory-service test -Dtest=TransferLifecycleIT` | ❌ W0 | ⬜ pending |
| 08-03-* | 03 | 3 | INV-06 | — | Count variance posting; low-stock threshold; nightly expiry sweep | integration | `mvn -pl services/inventory-service test -Dtest=StockCountIT,ExpirySweepIT,LowStockAlertIT` | ❌ W0 | ⬜ pending |
| 08-06-* | 06 | 4 | finance seam | T-8-SPOOF | `GET /internal/grn/pending-count` returns bare `long`, `X-Internal-Service` guarded | integration | `mvn -pl services/inventory-service test -Dtest=GrnPendingCountIT` | ❌ W0 | ⬜ pending |
| 08-09-* | 09 | 2 | INV-01 (access ctrl) | T-8-AC | `inventory.rego` grants on `inventory.item.view`/`manage`; per-service `AuthorizationService` bean + JWT filter chain wired | policy + unit | `opa test policies/ --coverage` (100%); `mvn -pl services/inventory-service test -Dtest=InventoryAuthorizationServiceTest` | ❌ W0 | ⬜ pending |
| 08-03/04/06/07/08-* | 03,04,06,07,08 | 3–4 | INV-01/02/04/05/06 (access ctrl) | T-8-AC (high) | Write endpoint denies (403) a JWT lacking `inventory.item.manage`; read denies without `.view` | integration | `mvn -pl services/inventory-service test -Dtest=InventoryAccessControlIT,RecipeAccessControlIT,ReceiptAccessControlIT,TransferAccessControlIT,StockCountAccessControlIT` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `services/inventory-service/src/test/java/io/restaurantos/inventory/BaseIntegrationTest.java` — copy kitchen-service's, adjust package + DB name (`inventory_db`/`inventory_user`)
- [ ] `services/inventory-service/src/test/java/io/restaurantos/inventory/TestFixtures.java` — copy verbatim (JWT-building is service-agnostic), add an `INVENTORY_MANAGER` role JWT builder variant
- [ ] `InventoryFixtures` helper — seed ingredient + stock + recipe + lot rows for tests (referenced by `10-test-architecture-guide.md §10.3`, does not exist yet)
- [ ] Framework install: **none** — Testcontainers/JUnit5/AssertJ/Awaitility all resolve from the parent POM's managed versions already used by kitchen/finance/pos-service
- [ ] Access-control harness (plan 08-09, Wave 2): `InventoryAuthorizationService` + `InventorySecurityConfig` (per-service `AuthorizationService` bean + JWT filter chain) + `inventory.rego`/`inventory_test.rego` — a prerequisite for the `*AccessControlIT` 403 tests in the Wave 3–4 controller plans

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

*All phase behaviors have automated verification. The nightly `@Scheduled` expiry sweep is tested by invoking the sweep method directly in `ExpirySweepIT` (fixed clock) rather than waiting on cron, so no manual-only step remains.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — confirmed by plan-checker re-verification (every task carries an `mvn -pl services/inventory-service test -Dtest=...` / `opa test` command)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (BaseIntegrationTest, TestFixtures, InventoryFixtures via 08-02; access-control harness via 08-09)
- [x] No watch-mode flags
- [x] Feedback latency < 40s (unit tier)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-14 (plan-phase verification loop, iteration 2 — VERIFICATION PASSED). `wave_0_complete` flips true once 08-02 + 08-09 harness land during execution.
