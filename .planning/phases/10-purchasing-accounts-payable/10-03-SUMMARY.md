---
phase: 10-purchasing-accounts-payable
plan: 03
subsystem: purchasing
tags: [purchasing, analytics, vendor-scorecard, spend-analytics, zod, react-query, four-layer]

# Dependency graph
requires:
  - phase: 10-01
    provides: "ThreeWayMatchService's per-line priceRatio math (invoiceUnitPricePaisa/poUnitPricePaisa, BigDecimal scale 6 HALF_UP), VendorAnalyticsService.scorecard() skeleton, GrnDataPort mock/feign seam pattern"
  - phase: 10-02
    provides: "PurchasingRepository/adapter/schema four-layer stack, purchasing MSW handlers (F1-F7), purchasing tenant route group + FeatureGuard"
provides:
  - "GET /api/v1/purchasing/analytics/spend — spend aggregated by vendor AND by category over [from,to] with a prior-period comparison (deltaPaisa/deltaPct per bucket)"
  - "IngredientCategoryResolver / MockIngredientCategoryResolver — mock-first category lookup via classpath spend-category-map.yml, no Phase 8/inventory-service dependency"
  - "VendorScorecardDto.priceVariancePct — PUR-05's previously-unbuilt third scorecard metric (spend-weighted mean price variance)"
  - "/app/purchasing/analytics — spend-by-vendor and spend-by-category tables (current/prior/delta%) plus the vendor scorecard card (on-time/fill-rate/price-variance/total-spend), backend-free against MSW"
  - "SpendAnalyticsIT + VendorScorecardIT (compiled, not runtime-verified — see Issues Encountered)"
affects: [10-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IngredientCategoryResolver mock/feign seam mirrors GrnDataPort — Phase 8 swaps MockIngredientCategoryResolver for a feign-backed resolver keyed on restaurantos.inventory.integration-mode without changing the API contract"
    - "SpendBucketDto.deltaPct is null (not a sentinel) when prior-period spend for a bucket is 0"

key-files:
  created:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/SpendBucketDto.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/SpendAnalyticsDto.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/IngredientCategoryResolver.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/MockIngredientCategoryResolver.java
    - services/purchasing-service/src/main/resources/spend-category-map.yml
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/SpendAnalyticsIT.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/VendorScorecardIT.java
    - frontend/app/(tenant)/app/purchasing/analytics/page.tsx
    - frontend/components/purchasing/SpendAnalyticsTable.tsx
    - frontend/components/purchasing/VendorScorecardCard.tsx
    - frontend/__tests__/lib/purchasing-spend-analytics.test.ts
  modified:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/VendorAnalyticsService.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorAnalyticsController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/repository/VendorInvoiceRepository.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/VendorScorecardDto.java
    - frontend/lib/api-client/schemas/purchasing.schema.ts
    - frontend/lib/adapters/purchasing.adapter.ts
    - frontend/lib/repositories/purchasing.repository.ts
    - frontend/lib/hooks/purchasing/use-purchasing.ts
    - frontend/mocks/purchasing.handlers.ts
    - frontend/app/(tenant)/app/purchasing/layout.tsx
    - .planning/phases/10-purchasing-accounts-payable/10-MOCK-FIXTURES.md

key-decisions:
  - "deltaPct is null (not a 100.0 sentinel) when a bucket's prior-period spend is 0 — 'new spend' has no meaningful percent change"
  - "Category resolution reads a classpath spend-category-map.yml via snakeyaml (already on the classpath transitively via spring-boot-starter) rather than adding a new dependency"
  - "Price variance is a spend-weighted mean (weight = lineTotalPaisa), reusing ThreeWayMatchService's exact priceRatio math verbatim rather than re-deriving tolerance logic — it is a metric, not a match-tolerance check"
  - "Purchasing tab strip (Vendors | Analytics) added to purchasing/layout.tsx since the only existing nav surface was a bare redirect with no chrome — cheapest option that benefits every purchasing page"
  - "Fixed several purchasing MSW mock ids (VENDOR_ID/PO_ID/LINE_ID) that used non-hex letter prefixes (v/p/l) and silently failed z.string().uuid() — no prior test exercised the purchasing repository against MSW, so this bug was latent until the new vitest exercised it (Rule 1 auto-fix)"

patterns-established:
  - "Mock-first backend seam for a not-yet-built Phase 8 integration: interface + @Service mock impl reading a classpath YAML fixture, documented with a Phase-8-swap javadoc pointer — same shape as GrnDataPort"

# Metrics
duration: ~1h10min
completed: 2026-07-12
---

# Phase 10 Plan 03: Spend Analytics + Vendor Price Variance Summary

**Closed both halves of ROADMAP Phase 10 SC#5 — added the vendor spend-analytics API/UI (PUR-06, by vendor and by category with period-over-period deltas) and the scorecard's silently-unbuilt third metric, price variance per vendor (PUR-05) — entirely on mock invoice/PO data with no Phase 8/inventory-service dependency.**

## Performance

- **Duration:** ~1h10min
- **Completed:** 2026-07-12
- **Tasks:** 4/4
- **Files modified:** 22 (11 created, 11 modified)

## Accomplishments

- `SpendBucketDto`/`SpendAnalyticsDto` records + `VendorAnalyticsService.spendReport()`: aggregates MATCHED/PAID vendor-invoice line totals by vendor and by category over `[from,to]`, against an explicit or defaulted prior-period window (`compareTo = from - 1 day`, `compareFrom = compareTo - DAYS.between(from,to)`), producing `deltaPaisa`/`deltaPct` per bucket (`deltaPct` is `null` when prior spend is 0)
- `IngredientCategoryResolver` / `MockIngredientCategoryResolver`: resolves `invoiceLine.poLineId -> PurchaseOrderLine.ingredientId -> category label` via a classpath `spend-category-map.yml` (the 3 fixed seed ingredient UUIDs from `10-MOCK-FIXTURES.md`, mapped to Meat/Produce/Dairy); unmapped ingredients resolve to "Uncategorized"
- New `GET /api/v1/purchasing/analytics/spend` endpoint, additive and separate from the existing `/scorecard` endpoint (PUR-06 ≠ PUR-05, per plan constraint)
- `VendorScorecardDto.priceVariancePct` + `VendorAnalyticsService.computePriceVariancePct()`: spend-weighted mean of per-line `(invoiceUnitPricePaisa/poUnitPricePaisa - 1) * 100`, reusing `ThreeWayMatchService`'s exact `priceRatio` computation (BigDecimal scale 6, HALF_UP); lines with PO price 0 are skipped; 0.0 (never NaN) for vendors with no qualifying MATCHED/PAID lines
- `SpendAnalyticsIT` (F8 fixture: 2 vendors, 3 categories, Jun-2026 vs May-2026) and `VendorScorecardIT` (a +5% line and a much-larger 0%-variance line proving the weighted mean is real, not a naive average) — both compile cleanly; see Issues Encountered for runtime status
- Full four-layer frontend stack (`apiSpendBucketSchema`/`apiSpendAnalyticsSchema`/`apiVendorScorecardSchema` -> adapters -> `PurchasingRepository.getSpendAnalytics`/`getVendorScorecard` -> `useSpendAnalytics`/`useVendorScorecard` hooks) + `/app/purchasing/analytics` page rendering `SpendAnalyticsTable` (by vendor, by category) and `VendorScorecardCard`, all backend-free against MSW
- F8 MSW fixture (`/analytics/spend`) plus `priceVariancePct` added to the existing `/analytics/scorecard` MSW handler
- A small `Vendors | Analytics` tab strip added to `purchasing/layout.tsx` so the new page is actually reachable (the prior nav surface was a bare `redirect()` with no chrome)
- `grep -rn "priceVariancePct" services/purchasing-service/src/main/java/` now returns real hits (was zero before this plan)

## Task Commits

Each task was committed atomically:

1. **Task 1: Spend analytics API + mock category resolver (backend)** - `f0d93db` (feat)
2. **Task 2: SpendAnalyticsIT with mock invoice fixtures (F8)** - `0206390` (test)
3. **Task 3: Frontend analytics page + MSW F8** - `08e10a0` (feat)
4. **Task 4: PUR-05 price variance per vendor on the scorecard** - `df71d1e` (feat)

Plan-metadata commit (this SUMMARY + STATE.md) follows as a separate `docs(10-03)` commit.

## Files Created/Modified

- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/SpendBucketDto.java`, `SpendAnalyticsDto.java` - PUR-06 response records
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/IngredientCategoryResolver.java`, `MockIngredientCategoryResolver.java` - mock-first category seam
- `services/purchasing-service/src/main/resources/spend-category-map.yml` - ingredientId -> category fixture
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/repository/VendorInvoiceRepository.java` - added `findForSpendReport` (MATCHED/PAID, date range, lines fetched eagerly)
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/VendorAnalyticsService.java` - added `spendReport()` and `computePriceVariancePct()`, extended `scorecard()`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorAnalyticsController.java` - added `GET /spend`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/dto/VendorScorecardDto.java` - added `priceVariancePct`
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/SpendAnalyticsIT.java`, `VendorScorecardIT.java` - new integration tests
- `.planning/phases/10-purchasing-accounts-payable/10-MOCK-FIXTURES.md` - documented fixture F8
- `frontend/lib/api-client/schemas/purchasing.schema.ts`, `lib/adapters/purchasing.adapter.ts`, `lib/repositories/purchasing.repository.ts`, `lib/hooks/purchasing/use-purchasing.ts` - four-layer additions for spend analytics + scorecard
- `frontend/mocks/purchasing.handlers.ts` - F8 fixture + scorecard `priceVariancePct` + hex-UUID id fix
- `frontend/app/(tenant)/app/purchasing/analytics/page.tsx`, `components/purchasing/SpendAnalyticsTable.tsx`, `VendorScorecardCard.tsx` - new UI
- `frontend/app/(tenant)/app/purchasing/layout.tsx` - Vendors|Analytics tab strip
- `frontend/__tests__/lib/purchasing-spend-analytics.test.ts` - vitest proving the F8/scorecard MSW payloads parse via the real repository

## Decisions Made

- `deltaPct` is `null` (not a `100.0` sentinel) for buckets whose prior-period spend is 0 — documented in `VendorAnalyticsService.spendReport()` javadoc; both `SpendAnalyticsIT` and the F8 MSW fixture encode this
- Category resolution reads `spend-category-map.yml` via `org.yaml.snakeyaml.Yaml` (already on the classpath transitively through `spring-boot-starter`, confirmed present in `~/.m2`) rather than adding a new Maven dependency
- Price variance aggregation is spend-weighted (weight = `lineTotalPaisa`), reusing `ThreeWayMatchService`'s `priceRatio` computation verbatim instead of re-deriving the math — per plan fact #9, it's a metric, not a tolerance check, so no `LineMatchStatus` is involved
- Nav: added a minimal `Vendors | Analytics` tab strip to `purchasing/layout.tsx` (plan's "preferred" option) rather than a one-off link on the vendors page, since it benefits every purchasing page and the layout already wraps all of them
- Fixed (Rule 1 — bug) several pre-existing MSW mock ids (`VENDOR_ID`/`PO_ID`/`LINE_ID` in `purchasing.handlers.ts`) that used non-hex letter prefixes (`v`/`p`/`l`), which fail `z.string().uuid()` in `apiVendorSchema`/`apiPurchaseOrderSchema`/`apiPoLineSchema`. This was a latent bug — no earlier test exercised `PurchasingRepository` against MSW with real Zod parsing — caught only when the new `purchasing-spend-analytics.test.ts` vitest exercised the repository for the first time. Replaced with valid hex UUIDs (`c…`/`d…`/`e…`); no behavior change to any handler logic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Non-hex MSW mock UUIDs silently broke Zod `.uuid()` validation**
- **Found during:** Task 3, while writing the new parse-before-adapt vitest
- **Issue:** `VENDOR_ID = "v0000001-..."`, `PO_ID = "p0000001-..."`, `LINE_ID = "l0000001-..."` in `frontend/mocks/purchasing.handlers.ts` are not valid hex UUIDs (`v`/`p`/`l` aren't hex digits), so any schema calling `.uuid()` on these fields would throw at parse time. No prior test caught this because no test previously ran a real `PurchasingRepository` call against MSW with Zod parsing.
- **Fix:** Replaced the three ids with valid hex-prefixed UUIDs (`c0000001-...`, `d0000001-...`, `e0000001-...`); added `VENDOR_B_ID = "f0000002-..."` for the new F8 fixture using the same valid pattern.
- **Files modified:** `frontend/mocks/purchasing.handlers.ts`, `frontend/__tests__/lib/purchasing-spend-analytics.test.ts`
- **Commit:** `08e10a0`

Otherwise the plan executed exactly as written. All 10 `<critical_codebase_facts>` (VendorInvoiceLine→PurchaseOrderLine hop, InvoiceStatus values, VendorAnalyticsService's single `scorecard()` method, no test-resources dir, ApiResponse envelope + `@RequiresFeature`, paisa/deltaPct math, the pre-Task-4 zero-hit `priceVariance` grep, and the exact `ThreeWayMatchService` priceRatio shape) held up against the live source and were followed as specified.

## Issues Encountered

**Docker/Testcontainers unavailable in this execution sandbox** (same environment limitation already logged by the parallel 10-05 plan). `mvn -pl services/purchasing-service -Dtest=SpendAnalyticsIT test` was attempted and failed at `PurchasingTestBase`'s static Testcontainers init:

```
Could not find a valid Docker environment... UnixSocketClientProviderStrategy: failed... NoSuchFileException (/var/run/docker.sock)
```

No `docker`/`colima`/`podman` binary is on `PATH` in this sandbox. This blocks the plan's own runtime verification step (`mvn ... failsafe:integration-test failsafe:verify`) for **both** new ITs, and for every other purchasing-service IT — it is an environment limitation, not something introduced by this plan.

What WAS verified instead:
- `mvn -pl services/purchasing-service test-compile` — passes cleanly (all Task 1/2/4 backend changes plus both new IT files)
- `grep -rn "priceVariancePct" services/purchasing-service/src/main/java/` — returns real hits (`VendorScorecardDto`, `VendorAnalyticsService` x2) — required by the plan's success criteria
- Frontend: `pnpm tsc --noEmit` — zero new errors (3 pre-existing errors in `frontend/lib/api-client/errors.ts`, unrelated to this plan's `files_modified` list and present on a clean git-stash of all frontend changes — confirmed pre-existing, not touched)
- Frontend: `npx eslint` on every touched/created file — zero errors (2 pre-existing unused-var warnings on `TENANT`/`PO_ID` constants in `purchasing.handlers.ts`, unrelated to this plan's logic)
- Frontend: `npx vitest run` — 62/62 tests pass across all 8 test files, including the two new assertions in `purchasing-spend-analytics.test.ts` that exercise the real `PurchasingRepository` -> Zod `.parse()` -> adapter path against the F8 MSW fixture and the extended scorecard MSW fixture

**What could NOT be executed/confirmed in this environment:**
- `SpendAnalyticsIT` (byVendor/byCategory aggregation + deltaPct assertions) — cannot run without Postgres via Testcontainers
- `VendorScorecardIT` (weighted price-variance assertions, on-time%/fill-rate% no-regression assertions) — same blocker
- The plan's full verification line: `mvn -pl services/purchasing-service test-compile failsafe:integration-test failsafe:verify — all ITs green including SpendAnalyticsIT and VendorScorecardIT; no regression in existing purchasing ITs`

**Recommendation:** re-run `mvn -pl services/purchasing-service -Dtest=SpendAnalyticsIT,VendorScorecardIT test` (or the full `failsafe` verify) on a Docker-capable machine/CI runner before considering this plan's success criteria fully closed. The math and seeding were hand-traced against the F8 fixture table in `10-MOCK-FIXTURES.md` (Produce 50k/40k -> +25%, Dairy 30k/25k -> +20%, Meat 20k/0 -> null; scorecard weighted mean ≈0.05% vs a naive 2.5% average) but have not been machine-verified.

## User Setup Required

None — no external service configuration required. The analytics page renders fully against MSW with no backend running.

## Next Phase Readiness

- ROADMAP Phase 10 SC#5 is now code-complete on both halves: PUR-05 (lead-time adherence + fill rate + price variance per vendor) and PUR-06 (spend by vendor and category with period comparison). Integration-level proof for the two new ITs is still pending a Docker-capable environment (see Issues Encountered) — same caveat already flagged for 10-05's `ExpenseApprovalIT`.
- Ran fully in parallel with plan 10-05 (finance-service) without touching `services/finance-service/**`; `git diff 9709dae -- services/purchasing-service frontend` shows only this plan's 22 files. `.planning/REQUIREMENTS.md` was intentionally not touched — 10-06 reconciles all requirement docs once, after 10-03/10-04/10-05 have landed.
- Phase 8 swap checklist item added implicitly: replace `MockIngredientCategoryResolver` with a feign-backed resolver keyed on `restaurantos.inventory.integration-mode` when inventory-service ships (documented in the resolver's javadoc and `10-MOCK-FIXTURES.md`).
- Follow-up for whoever verifies with Docker available: also re-run `ThreeWayMatchIT`, `PurchaseOrderApprovalIT`, `VendorIT`, `GrnReceiptSimulatorIT`, `PurchasingMockE2EIT` to confirm no regression from the `VendorAnalyticsService` constructor signature change (added `PurchaseOrderLineRepository`, `VendorRepository`, `IngredientCategoryResolver` dependencies) or the `VendorInvoiceRepository`/`VendorScorecardDto` changes.

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-12*
