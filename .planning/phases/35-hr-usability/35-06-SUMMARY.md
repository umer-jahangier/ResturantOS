---
phase: 35-hr-usability
plan: 06
subsystem: api
tags: [payroll, tax, bigdecimal, liquibase, rls, opa, field-errors, http-409, testcontainers]

requires:
  - phase: 35-hr-usability
    provides: "35-01's FieldValidationException and the empty-details rule for a refusal with no offending input"
  - phase: 35-hr-usability
    provides: "35-03's hr.config.view / hr.config.manage and authorizeConfigView/Manage(tenantId)"
provides:
  - "FiscalYear.forPeriod(month, year) and FiscalYear.current(Clock) — the July rule, once, in Java"
  - "TaxConfigNotConfiguredException — 409 TAX_CONFIG_NOT_CONFIGURED, carries the fiscal year, empty details"
  - "GET/PUT /api/v1/hr/config/tax — list, current, get-by-year, save, activate, draft-from"
  - "TaxSlabTableValidator — gap/overlap/starts-at-zero/open-top, all violations at once, dot-indexed paths"
  - "GlobalExceptionHandler.toClientPath — bean validation's slabs[0].ratePct becomes slabs.0.ratePct, app-wide"
affects: [35-08, 35-09, 35-12, 35-13, 35-14, every-service-with-a-nested-request-body]

tech-stack:
  added: []
  patterns:
    - "A statutory convention gets a named function and an endpoint, never a copy in a second language"
    - "PUT on the identity (tenant, fiscal year) rather than POST to a collection, because the unique constraint already made it an identity"
    - "A carry-forward returns an unsaved draft; the accountant's save is the confirmation"
    - "An indexed field path is dot-indexed on the wire, because that is the only shape the web client can bind"

key-files:
  created:
    - services/hr-service/src/main/java/io/restaurantos/hr/payroll/tax/FiscalYear.java
    - services/hr-service/src/main/java/io/restaurantos/hr/payroll/tax/TaxSlabTableValidator.java
    - services/hr-service/src/main/java/io/restaurantos/hr/exception/TaxConfigNotConfiguredException.java
    - services/hr-service/src/main/java/io/restaurantos/hr/dto/TaxConfigDtos.java
    - services/hr-service/src/main/java/io/restaurantos/hr/controller/TaxConfigController.java
    - services/hr-service/src/test/java/io/restaurantos/hr/TaxConfigIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/payroll/FiscalYearTest.java
  modified:
    - services/hr-service/src/main/java/io/restaurantos/hr/payroll/tax/TaxConfigService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/entity/TaxConfigEntity.java
    - services/hr-service/src/main/java/io/restaurantos/hr/repository/TaxConfigRepository.java
    - services/hr-service/src/main/java/io/restaurantos/hr/exception/HrExceptionHandler.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/PayrollRunService.java
    - services/hr-service/src/test/java/io/restaurantos/hr/payroll/SlabTaxCalculatorTest.java
    - shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java
    - shared-lib/src/main/java/io/restaurantos/shared/exception/FieldValidationException.java
    - shared-lib/src/test/java/io/restaurantos/shared/api/FieldErrorContractTest.java

key-decisions:
  - "409, not 500 and not 422, for an unconfigured year: nothing broke, and there is no offending input to bind a 422's details to"
  - "An entered-but-INACTIVE year is refused exactly as an absent one — a half-entered table must not be applied"
  - "PUT on /{fiscalYear} is create-or-replace, because uk_tax_config_tenant_fy already made (tenant, year) an identity"
  - "Copy-forward is a GET returning an unsaved draft with active=false; it never writes"
  - "A correct slab table typed out of order is ACCEPTED and stored sorted — refusing it would refuse a correct configuration for being untidy"
  - "getActiveConfig is NOT gated on hr.config.view: its caller is payroll, already gated on hr.payroll.run"
  - "The fiscal-year clock is zoned Asia/Karachi by default, not UTC — a UTC clock mislabels the first five hours of every 1 July"

patterns-established:
  - "A decimal-arithmetic test is only evidence if it is constructed to give a DIFFERENT answer under the double it replaced"

requirements-completed: [HR-02, XCUT-03]

coverage:
  - id: D1
    description: "A tenant owner creates and edits their own tax configuration for a fiscal year through the API, with no SQL and no seeding"
    requirement: HR-02
    verification:
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/TaxConfigIT.java#savedConfigurationRoundTrips, #savingTwiceIsAnEdit, #listIsNewestFirstAndTenantScoped"
        status: pass
    human_judgment: false
  - id: D2
    description: "An unconfigured fiscal year is a named, actionable refusal naming the year — never a 500, never a fallback"
    requirement: XCUT-03
    verification:
      - kind: integration
        ref: "TaxConfigIT#payrollReadOfAnUnconfiguredYearIsNamed, #thereIsNoFallbackToAnotherYear, #anInactiveYearIsRefused, #theMessageIsAnInstruction"
        status: pass
      - kind: other
        ref: "mutation check — reverting getActiveConfig to IllegalStateException fails 3 of them"
        status: pass
    human_judgment: false
  - id: D3
    description: "One function decides which fiscal year a period belongs to, and both callers use it"
    verification:
      - kind: unit
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/payroll/FiscalYearTest.java (6 tests, both sides of the June/July boundary)"
        status: pass
      - kind: other
        ref: "mutation check — `>= 7` to `> 7` fails 4 of 6"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every rate is applied exactly as entered — no binary floating point in the payroll tax path"
    verification:
      - kind: unit
        ref: "SlabTaxCalculatorTest#aThreeDecimalRateIsAppliedExactly_notAsItsNearestDouble, #theBaseTaxIsAddedOnTopOfTheDecimalRateApplication"
        status: pass
      - kind: other
        ref: "mutation check — reverting the slab walk to Math.round(excess * rate / 100.0) fails both (2312 vs 2311)"
        status: pass
      - kind: integration
        ref: "TaxConfigIT#aThreeDecimalRateSurvivesTheRoundTrip — 11.500 out of JSONB and NUMERIC(6,3)"
        status: pass
      - kind: other
        ref: "grep gate — zero float/double declarations in payroll/tax/*.java"
        status: pass
    human_judgment: false
  - id: D5
    description: "A malformed slab table names each offending row, all at once, in a path the form can bind"
    verification:
      - kind: integration
        ref: "TaxConfigIT — 7 tests: firstBandMustStartAtZero, aGapNamesTheBandAfterIt, anOverlapNamesTheOverlappingBand, noOpenTopIsRefused, twoOpenTopsAreRefused, anInvertedBandIsRefused, everyViolationIsReportedAtOnce, slabPathsAreDotIndexedNotBracketed"
        status: pass
      - kind: other
        ref: "mutation check — removing the three structural rules fails 7 of them"
        status: pass
    human_judgment: false
  - id: D6
    description: "The tax-configuration screen renders these codes and paths usefully in a browser"
    verification: []
    human_judgment: true
    rationale: "35-13 builds the screen. No frontend consumes /api/v1/hr/config/tax as of this plan."

duration: 78min
completed: 2026-08-12
status: complete
---

# Phase 35 Plan 06: Tax Configuration Summary

**Payroll could not run for any real tenant, and the reason came back as `500 — An unexpected error occurred`. Both halves are fixed: a tenant can now type their own tax table over the API, and an unconfigured year answers by name with the year in it.**

## Performance

- **Duration:** 78 min
- **Tasks:** 3 (all TDD)
- **Files:** 16 (7 created, 9 modified)

## What was actually wrong

`hr_db.tax_config` held **one row** — Liquibase-seeded, for the placeholder tenant
`00000000-0000-0000-0000-000000000001`, for fiscal year 2026. `PayrollRunService.calculate` derived
the fiscal year as `periodMonth >= 7 ? periodYear + 1 : periodYear`, so a run for August 2026 asked
for **FY2027**, for a real tenant, and there was no such row for anybody. `TaxConfigEntity` had a
protected constructor and not one setter; there was no controller and no screen. The only remedy was
an INSERT typed by a developer — the exact thing D-35-05 forbids.

The failure mode was as bad as the failure. `TaxConfigService` threw `IllegalStateException`, the
shared catch-all turned it into a 500, and the Payroll screen rendered it as a two-word toast. The
single most predictable condition in the subsystem — a fiscal year nobody has entered rates for yet
— reached the operator as an unexplained server fault, on the first of July, on a screen offering no
way to fix it.

## The contract 35-09, 35-12 and 35-13 bind to

| Endpoint | Method | Permission | Notes |
|---|---|---|---|
| `/api/v1/hr/config/tax` | GET | `hr.config.view` | Every configured year, newest first, active marked |
| `/api/v1/hr/config/tax/current` | GET | `hr.config.view` | `{fiscalYear, startsOn, endsOn, configured}` |
| `/api/v1/hr/config/tax/{fy}` | GET | `hr.config.view` | 409 if that year has none |
| `/api/v1/hr/config/tax/{fy}` | PUT | `hr.config.manage` | Create-or-replace |
| `/api/v1/hr/config/tax/{fy}/active` | PUT | `hr.config.manage` | Body `{active}` |
| `/api/v1/hr/config/tax/{fy}/draft-from?sourceFiscalYear=N` | GET | `hr.config.manage` | Unsaved draft; writes nothing |

| Situation | Status | `error.code` | `details[].field` |
|---|---|---|---|
| No configuration for the fiscal year (any read, and payroll's) | 409 | `TAX_CONFIG_NOT_CONFIGURED` | *(none)* |
| Slab table has a gap / overlap / non-zero first band / bad open top / inverted band | 422 | `TAX_SLABS_INVALID` | `slabs.{n}.minPaisa` or `slabs.{n}.maxPaisa` |
| Bean-validation failure on the body | 400 | `VALIDATION_FAILED` | one per violation, `slabs.{n}.ratePct` etc. |

**The slab field-path format is `slabs.{index}.{field}` — dot-indexed, never `slabs[0].ratePct`.**

`FiscalYear.forPeriod(int month, int year) -> int` and `FiscalYear.current(Clock) -> int`. July
through December map to `year + 1`; January through June to `year`. Pakistan's fiscal year is named
for the calendar year it *ends* in.

## Task Commits

1. **Task 1 — one fiscal-year function, decimal tax path** — `9c210d44` (feat)
2. **Cross-cutting fix — indexed field paths** — `d75ec626` (fix, shared-lib)
3. **Tasks 2+3 — the writable configuration, the named refusal, the slab rules** — `9528e4af` (feat)
4. **Payroll adopts `FiscalYear`** — `85524f03` (refactor)

## Decisions Made

**409, not 500 and not 422.** Not 500 because nothing broke and a 500 tells the client to retry
something that cannot succeed, while burying real faults in alerting. Not 422 because in this
codebase 422 means "a rule looked at your input and refused it" and carries per-field details a form
binds — there is no offending input here. 409 puts it alongside the `PAYROLL_RUN_*` state refusals
from 35-01 that the Payroll screen already switches on.

**An entered-but-inactive year is refused exactly as an absent one.** A table can be entered in
advance and left inactive; payroll refuses it until it is activated. A half-entered table silently
applied is the same class of harm as a missing one, minus the warning.

**Copy-forward returns an unsaved draft.** Retyping six slabs, two EOBI rates and a surcharge every
July is how a wrong slab gets in — so carrying them forward is worth doing. But *silently* creating
next year's table from last year's rates is how a rate superseded by a Finance Act survives into a
year it does not apply to, invisibly, because nobody was shown it. It comes back `active: false` for
the same reason.

**A correct slab table typed out of order is accepted.** Contiguity is checked against the table
sorted by lower bound and violations reported against the original row index. Once there are no gaps
and no overlaps, exactly one bracket matches any income, so `SlabTaxCalculator`'s `findFirst` cannot
pick a different one. Refusing it would be refusing a correct configuration for being untidy.

**`getActiveConfig` is not gated on `hr.config.view`.** Its caller is payroll, already gated on
`hr.payroll.run`. Requiring the config permission too would mean a payroll operator could not run
payroll without also being able to read the tax table through the settings API. RLS still scopes it.

**The fiscal-year clock is zoned, and the default is `Asia/Karachi`.** The year turns over when the
*local* date does. A UTC clock calls the first five hours of every 1 July the old year — one morning
a year when the screen and payroll disagree about which year needs configuring. Configurable via
`restaurantos.hr.fiscal-year-zone`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] An indexed field path came back in a spelling no form could bind. (shared-lib, app-wide)**
- **Found during:** Task 3, designing the slab field paths
- **Issue:** Spring's `BindingResult` writes `slabs[0].ratePct`. `frontend/lib/forms/server-field-errors.ts` splits a path on `"."` and walks the form's values, so the first segment is the literal `"slabs[0]"`, matches no key, and the message is demoted to a form-level sentence above the table. For a six-row slab editor that is one error and no indication which row — precisely the experience this phase exists to remove. Flat paths were unaffected, which is why no existing test caught it: none contains a bracket. `FieldValidationException`'s own javadoc asserted the *bracket* form was what a form binds, which is backwards.
- **Fix:** `GlobalExceptionHandler.toClientPath` normalises `[n]` → `.n` once, for all 15 services. Javadoc corrected.
- **Verification:** `FieldErrorContractTest#anIndexedPathIsEmittedInTheDottedFormTheClientBinds`. Mutation-checked — removing the normalisation fails it.
- **Commit:** `d75ec626`

**2. [Rule 3 — Blocking] Two constructors made Spring refuse to build the bean.**
- **Issue:** `TaxConfigService` gained a clock-injecting constructor for testability, and Spring reported `No default constructor found` — a message naming neither constructor and sending you looking for a no-arg one that should not exist. The whole hr-service context failed.
- **Fix:** explicit `@Autowired` on the property-injecting constructor, with a comment saying why.

### Plan text superseded

**3. Task 1's premise was already half-true.** The plan says `TaxSlab.ratePct` is a `double` and
`SlabTaxCalculator` uses `Math.round(excess * ratePct / 100.0)`. Both had already been fixed in
commit `9d511b0d` before this session. What was genuinely missing was `FiscalYear` and any test that
could *tell the difference* — the six existing slab assertions all use whole-percent rates, which are
exact in binary too, which is exactly why the double survived unnoticed. Two new assertions are
constructed to diverge: 2.300% of 100,500 paisa is exactly 2311.5, which IEEE-754 computes as
2311.4999999999995 and `Math.round` takes *down* to 2311.

**4. "Activating one deactivates any other for that year" is moot.** `uk_tax_config_tenant_fy` is
UNIQUE on `(tenant_id, fiscal_year)`, so a year has at most one row by construction. There is nothing
to deactivate, and a loop pretending otherwise would be dead code implying a second row can exist.

**5. `PercentOfPaisa` needed no visibility widening.** The plan expected it; `SlabTaxCalculator` is in
the same package.

## Verification

- **23 `TaxConfigIT` tests** against real Postgres + OPA containers, plus 6 `FiscalYearTest` and 3 new
  `SlabTaxCalculatorTest`.
- **Mutation-checked, four separate controls, each watched fail:**
  - Slab walk reverted to `Math.round(excess * ratePct.doubleValue() / 100.0)` → 2 unit tests fail (2311 vs 2312).
  - `FiscalYear`'s `>= 7` → `> 7` → 4 of 6 `FiscalYearTest` fail.
  - The three structural slab rules removed **and** `getActiveConfig` reverted to `IllegalStateException` → **10 of 23** `TaxConfigIT` fail.
  - `toClientPath` removed from `GlobalExceptionHandler` → the new shared-lib test fails.
- **Grep gate:** zero `float`/`double` declarations in `payroll/tax/*.java`.
- **Full hr-service suite:** 42 unit + 137 integration. Everything green **except** two
  `RlsForcedInvariantIT` failures that are not this plan's — see below.

## Issues Encountered

**Two `RlsForcedInvariantIT` failures belong to a sibling agent, not to this plan.**

1. `everyRlsEnabledTableIsForced` reports `attendance_quarantine` as ENABLED-but-not-FORCED. That
   agent's own changelog `035-restore-force-rls-attendance-quarantine.xml` says in its comment that
   they dropped FORCE in `034` for a backfill and did not restore it; they are fixing it now. Nothing
   in this plan touches that table.
2. `configurationTablesAreEmptyAfterMigration` reports 14 departments and 2 designations. **This is a
   real order-dependence defect in that test, and adding `TaxConfigIT` is what exposed it.** The test
   asserts the configuration tables are empty "after migration", but failsafe shares one Postgres
   container across every IT class in the JVM, and `HrConfigListsIT` / `EmployeeLookupMigrationIT`
   create departments before it runs. Adding a class changed the class order enough for those to run
   first. **Honest status: not caused by this plan's code, exposed by this plan's file, not fixed
   here** — the correct fix is for the assertion to run against a pristine schema rather than a
   shared one, that file belongs to 35-02, and a sibling agent is actively editing hr changelogs in
   the same directory. Logged to `deferred-items.md`.

**Sibling-agent churn blocked the hr-service build three times** during this plan: a mid-edit XML
comment in `015-employee-department-designation-fk.xml` (stray text under `databaseChangeLog`), and
twice a malformed comment in `035-restore-force-rls-attendance-quarantine.xml` (`--` inside an XML
comment). Both resolved themselves within minutes. Neither file was touched here. Every commit used
explicit pathspecs.

**What this plan did NOT prove:** nothing renders these codes. There is no tax-configuration screen —
that is 35-13. No browser verification was attempted, because there is nothing to point a browser at.

## User Setup Required

None. `restaurantos.hr.fiscal-year-zone` defaults to `Asia/Karachi`.

## Next Phase Readiness

**Payroll is unblocked for the API path.** A tenant with `hr.config.manage` can `PUT` this year's
table and calculate a run, with no SQL at any point. It is not unblocked for a *user*, because there
is no screen.

- **35-13** builds the tax screen against the table above. The slab editor binds
  `slabs.{n}.minPaisa` / `.maxPaisa` / `.ratePct`; use `applyServerFieldErrors` with no `fieldMap`.
- **35-12** should offer `TAX_CONFIG_NOT_CONFIGURED` a link to that screen rather than a toast — the
  code exists precisely so the Payroll screen can distinguish it from the `PAYROLL_RUN_*` refusals.
- **35-08** salary components: reuse `TaxSlabTableValidator`'s "report every violation at once, with
  an indexed path" shape rather than inventing a second one.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-12*

## Self-Check: PASSED

All 7 created files present on disk; all 4 task commits present in git history.
