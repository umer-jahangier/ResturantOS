---
phase: 35-hr-usability
plan: 02
subsystem: database
tags: [liquibase, postgres, row-level-security, force-rls, functional-index, testcontainers, check-constraint]

requires:
  - phase: 35-hr-usability
    provides: "35-01's typed exceptions — 35-05 and 35-08 will bind DuplicateValueException to the unique indexes created here"
provides:
  - "departments, designations, salary_components, employee_salary_components — four tenant-managed tables, RLS-forced, unseeded"
  - "Case-insensitive uniqueness enforced by functional unique index on (tenant_id, lower(trim(name|code)))"
  - "A reserved-code CHECK preventing a tenant component from colliding with an engine-computed deduction key"
  - "RlsForcedInvariantIT — hr_db's first RLS invariant guard, with a non-superuser behavioural canary"
affects: [35-05, 35-08, 35-09, 35-11, 35-12]

tech-stack:
  added: []
  patterns:
    - "A tenant-scoped table gets ENABLE + FORCE + policy in the SAME changelog that creates it"
    - "Case-insensitive uniqueness via functional unique index, never a plain UNIQUE(tenant_id, name)"
    - "An invariant test asserts a non-zero inspection count, so a query matching nothing cannot pass green"
    - "Tenant isolation is proven by a NOSUPERUSER NOBYPASSRLS owner, never by the Testcontainers superuser"

key-files:
  created:
    - services/hr-service/src/main/resources/db/changelog/v1.0.0/014-hr-config-tables.xml
    - services/hr-service/src/test/java/io/restaurantos/hr/RlsForcedInvariantIT.java
  modified:
    - services/hr-service/src/main/resources/db/changelog/db.changelog-master.xml

key-decisions:
  - "No branch_id on departments or designations — the list belongs to the tenant; per-branch scoping would make a four-location owner retype it four times and let the copies drift"
  - "designations.department_id is nullable — requiring it would force an owner to invent a department before naming a single job title"
  - "salary_components.code cannot be one of the five deduction-map keys PayrollRunService already writes, enforced by CHECK rather than left for 35-08 to discover"
  - "A CHECK keyed off the calculation discriminator forces exactly one of amount_paisa / rate_pct — an ambiguous component is a payroll defect waiting for a month-end"
  - "Nothing seeded, asserted behaviourally by counting rather than by reading the changelog"

patterns-established:
  - "Mutation-check a security invariant test: remove the control and confirm the test fails, before trusting its green"

requirements-completed: [XCUT-01, HR-01, HR-02]

coverage:
  - id: D1
    description: "Four tenant-managed lookup tables exist in hr_db with RLS enabled and forced"
    requirement: XCUT-01
    verification:
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/RlsForcedInvariantIT.java#everyRlsEnabledTableIsForced"
        status: pass
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/HrContextLoadsIT.java (migration applies; service boots under ddl-auto validate)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Two departments differing only by case or whitespace cannot both exist in one tenant"
    requirement: HR-01
    verification:
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/RlsForcedInvariantIT.java#caseVariantDepartmentNamesCannotCoexist"
        status: pass
    human_judgment: false
  - id: D3
    description: "Tenant isolation on the new tables holds for a role that cannot bypass RLS"
    requirement: XCUT-01
    verification:
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/RlsForcedInvariantIT.java#tableOwnerCannotBypassTenantIsolation"
        status: pass
      - kind: other
        ref: "mutation check — removing one FORCE line fails both the schema test and the canary independently"
        status: pass
    human_judgment: false
  - id: D4
    description: "No row is seeded into any of the four tables by a migration"
    requirement: HR-02
    verification:
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/RlsForcedInvariantIT.java#configurationTablesAreEmptyAfterMigration"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-08-11
status: complete
---

# Phase 35 Plan 02: Tenant-Managed HR Lookup Tables Summary

**Four RLS-forced, unseeded lookup tables in `hr_db` with case-insensitive uniqueness that makes "Waiter"/"waiter"/" Waiter " a single value at the database level — plus hr_db's first RLS invariant guard, whose canary was mutation-checked rather than assumed.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-11T23:31Z
- **Completed:** 2026-08-11T23:52Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- The schema a closed-set field can be backed by. `employees.designation` and `employees.department` were plain TEXT with no lookup behind them; that is how three spellings of one department come to exist and why no report can group them.
- Case-variant duplicates are now impossible at the database level, not merely discouraged in the UI.
- `salary_components` exists at all — its absence is why `PayrollRunService.calculate` sets gross equal to basic and writes an empty allowances map.
- hr_db has the RLS invariant guard its three sibling services already had, plus a behavioural canary that a superuser cannot fake.

## Schema delivered

Plans 35-05, 35-08 and 35-09 map entities and Zod schemas onto these exact names.

### `departments`
`id`, `tenant_id`, `name`, `code` (nullable), `is_active`, `created_at`, `updated_at`, `created_by`, `updated_by`
Unique: `ux_departments_tenant_name` on `(tenant_id, lower(trim(name)))`

### `designations`
As above plus `department_id UUID REFERENCES departments(id)` — **nullable**.
Unique: `ux_designations_tenant_name` on `(tenant_id, lower(trim(name)))`

### `salary_components`
`id`, `tenant_id`, `code`, `name`, `kind`, `calculation`, `amount_paisa BIGINT`, `rate_pct NUMERIC(7,4)`, `is_taxable`, `is_active`, audit columns.
Unique: `ux_salary_components_tenant_code` on `(tenant_id, lower(trim(code)))`

**Discriminator values** — these are the strings the entity enums and Zod schemas must use:

| Column | Values |
|---|---|
| `kind` | `EARNING`, `DEDUCTION` |
| `calculation` | `FIXED`, `PERCENT_OF_BASIC` |

**Reserved codes.** `lower(trim(code))` may not be any of these five, enforced by `salary_components_code_not_reserved_ck`:

```
income_tax_paisa   eobi_employee_paisa   advances_paisa   late_arrival_paisa   other
```

`PayrollRunService.calculate()` writes these keys into `payslips.deductions_json` directly. A tenant component sharing one would be merged into — or silently overwrite — an engine-computed deduction once 35-08 folds components into the payslip. Refused at the only place that can refuse it for every writer at once.

**CHECK constraints:** `kind` and `calculation` are enumerated; `FIXED` requires `amount_paisa` and forbids `rate_pct`, `PERCENT_OF_BASIC` the reverse; both amounts are non-negative.

### `employee_salary_components`
`id`, `tenant_id`, `employee_id`, `salary_component_id`, `effective_from DATE`, `effective_to DATE` (nullable = open-ended), `override_amount_paisa`, `override_rate_pct`, audit columns.
Unique: `(tenant_id, employee_id, salary_component_id, effective_from)`
CHECKs: at most one override populated; both non-negative; `effective_to >= effective_from`.

## Task Commits

1. **Task 1: four tenant-managed lookup tables, RLS-forced at creation** — `37b9cd45` (feat)
2. **Task 2: the RLS invariant guard and a non-superuser canary** — `920aa75e` (test)

## Decisions Made

**No `branch_id` on `departments` or `designations`.** A department list is a property of the tenant. Scoping it per branch would make an owner with four locations retype the same list four times, and would let the four copies drift apart — the same defect one level up from the one being fixed.

**`designations.department_id` is nullable.** A tenant that wants job titles grouped under departments can have that; one that does not can leave every row unattached. Requiring it would force an owner to invent a department before they can name a single job title.

**Money stays `BIGINT` paisa, rates stay `NUMERIC(7,4)`.** The phase constraint is absolute: `tax_config` mapping `NUMERIC` as a Java `double` is what stopped hr-service booting, and a float column here would reproduce that class of defect one table over.

## Deviations from Plan

None on the schema. Two defects were found **in the test being written**, both fixed before the commit:

**1. [Rule 1 — Bug] The unseeded assertion was order-dependent.**
`caseVariantDepartmentNamesCannotCoexist` inserts two departments, and JUnit gives no guaranteed method order, so the emptiness assertion saw 2 rows and failed for a reason unrelated to what it was checking. Snapshotted the counts in a once-guarded `@BeforeEach` instead. **Not** `@BeforeAll`: Spring loads the ApplicationContext lazily, so at `@BeforeAll` time Liquibase has not run and the tables do not exist — the first attempt failed with `relation "departments" does not exist`.

**2. [Rule 1 — Bug] The canary cleanup could not drop its own role.**
`GRANT ALL ON SCHEMA public` records a dependency on the grantee, and PostgreSQL refuses `DROP ROLE` while it stands. Unhandled, the cleanup threw, ownership of `departments` was never restored, and every later test class sharing the static container would have failed on a table it could not write. Revoke before drop. **The same latent bug exists in `pos-service`'s copy of this test** — noted, not fixed here, as it is outside this phase's scope.

## Issues Encountered

**The canary was mutation-checked, not trusted.** T-29-02-B is explicitly about a canary that reports green over an inert policy, so the control was removed to see whether the test noticed. Deleting the single line `ALTER TABLE departments FORCE ROW LEVEL SECURITY;` from `014` produced:

```
RlsForcedInvariantIT.everyRlsEnabledTableIsForced:142        FAILED
RlsForcedInvariantIT.tableOwnerCannotBypassTenantIsolation:279  FAILED
  "The owning role saw another tenant's departments. FORCE ROW LEVEL SECURITY is
   missing or was removed — tenant isolation is inert for the application and
   this is a live cross-tenant data leak."
```

Both proofs fire independently. The line was restored and the suite re-run green.

**What this plan did NOT do:** no entity, repository, service or endpoint touches these tables yet — that is 35-05 (departments, designations) and 35-08 (salary components). The tables are reachable only by SQL until then, which is why `EmployeeEntity.department` is still a TEXT column: the FK migration is 35-05's `015-employee-department-designation-fk.xml`, not this plan's.

## User Setup Required

None. The tables are created by Liquibase on the next hr-service start. **They will be empty**, which is the intended first experience — 35-11 owns the empty state that tells an owner what to do about it.

## Next Phase Readiness

- **35-05** — map `DepartmentEntity` / `DesignationEntity` onto these columns; the case-insensitive unique index is what `DuplicateValueException` should bind to on `name`.
- **35-08** — `SalaryComponentEntity` must use the enum strings `EARNING`/`DEDUCTION` and `FIXED`/`PERCENT_OF_BASIC` exactly, and must not emit a component whose code is one of the five reserved keys.
- **35-09** — Zod schemas mirror the same discriminator strings.

**Concern:** `ddl-auto: validate` means the moment 35-05 adds an entity, any column-name or type mismatch stops hr-service booting rather than failing a test. That is the intended design of `HrTestBase` and it is a good property, but it makes the column names above load-bearing — they are recorded here precisely so the next plan does not have to guess them.

## Self-Check: PASSED

Both created files present on disk; both task commits present in git history.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-11*
