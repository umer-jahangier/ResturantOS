# Phase 11 Plan 05 — Summary: Pakistan payroll math (slab tax + EOBI)

**Status:** Complete (calculators unit-tested green; seed-load IT deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline — subagent delegation blocked by platform content filter, see 11-01-SUMMARY)

## Objective

TDD the config-driven Pakistan payroll math (HR-02 core): `SlabTaxCalculator` + `EobiCalculator`
reading `tax_config`, plus the `TaxConfig` entity/service and the FY2025-26 seed row.

## Tasks & commits

| Task | Commit | What |
|------|--------|------|
| A (RED→GREEN) | `92ef022` | `TaxSlab` record, `SlabTaxCalculator` (slab walk + surcharge), `EobiCalculator` (wage-base only) + `SlabTaxCalculatorTest` (7) + `EobiCalculatorTest` (3) |
| B | `d794e97` | `TaxConfigEntity` (JSONB→`List<TaxSlab>`), `TaxConfigRepository`, `TaxConfigService.getActiveConfig`, `900-seed-tax-config.xml`, master include; `010` fiscal_year TEXT→INTEGER fix |

## TDD evidence

Stubs returned `0`; first run was **RED** — `SlabTaxCalculatorTest` 4 failures, `EobiCalculatorTest`
3 failures (all `expected: … but was: 0`). After implementing the slab walk + percentage math, the
rerun was **GREEN**: `SlabTaxCalculatorTest` 7/7, `EobiCalculatorTest` 3/3 (surefire reports,
0 failures/errors). Boundary cases (paisa): 600k→0, 1.2M→6k, 2.2M→116k, 5M→931k PKR; +9% surcharge
over Rs 1 crore; EOBI Rs 370 / Rs 1,850 on the Rs 37,000 wage base.

## Key decisions

- **Salary-independent EOBI enforced by signature** — `employeeContribution`/`employerContribution`
  take only the wage base; there is no salary parameter to pass (Pitfall 4). A test documents it.
- **No rates in Java** — the calculators take slabs/rates as arguments; `TaxConfigService` sources
  them from `tax_config` and throws (`IllegalStateException`) if no active row exists — never a
  hardcoded fallback.
- **[11-05-A] `tax_config.fiscal_year` changed TEXT → INTEGER** in `010-create-hr-tables.xml` to
  match `getActiveConfig(int)` and the RESEARCH DDL. Safe: `hr_db` has never been migrated anywhere
  (no Docker in any session so far), so no existing database is affected.
- **JSONB mapping** — `income_tax_slabs` maps directly to `List<TaxSlab>` via Hibernate
  `@JdbcTypeCode(SqlTypes.JSON)`, so the service consumes typed slabs with no manual Jackson parsing.
- **All figures VERIFY-WITH-ACCOUNTANT** (post Finance Act 2025); they live in `tax_config` so a
  tenant can correct them without a deploy. Sources cross-validated in 11-RESEARCH (MEDIUM confidence;
  no primary FBR/EOBI PDF fetch succeeded).

## Verification

- `mvn -q -pl services/hr-service test -Dtest=SlabTaxCalculatorTest,EobiCalculatorTest` — GREEN (RED first).
- `mvn -q -pl services/hr-service -am compile` — BUILD SUCCESS (entity/repo/service).
- `900-seed-tax-config.xml` well-formed; contains `income_tax_slabs` + `eobi_wage_base_paisa`.
- **DEFERRED — seed-load assertion** (`getActiveConfig(2026)` returns 6 slabs + `eobiWageBasePaisa=3700000`
  under `contexts=seed`) and **runtime `ddl-auto=validate` of the JSONB mapping** need a Docker-capable
  run: `mvn -q -pl services/hr-service -am verify`. No daemon in this sandbox.

## Follow-ups

- 11-06 (payroll run) consumes `TaxConfigService` + the two calculators to compute payslips.
- Confirm the Rs 37,000 minimum-wage figure and the slab bands with an accountant before production payroll.
