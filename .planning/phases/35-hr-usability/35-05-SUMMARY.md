---
phase: 35-hr-usability
plan: 05
subsystem: api
tags: [liquibase, data-migration, backfill, jpa, rls, tenant-managed-lists, opa]

requires:
  - phase: 35-hr-usability
    provides: "35-02's four tables; 35-03's hr.config.* permissions and authorizeConfig* methods; 35-01's DuplicateValueException and FieldValidationException"
provides:
  - "GET/POST/PUT /api/v1/hr/config/departments and /designations — tenant-managed CRUD, no delete"
  - "employees.department_id / designation_id foreign keys, with the old free-text values carried across"
  - "Four new field-pathed codes: DEPARTMENT_NOT_FOUND, DEPARTMENT_INACTIVE, DESIGNATION_NOT_FOUND, DESIGNATION_INACTIVE"
  - "EmployeeResponse carries both ids and resolved names"
affects: [35-08, 35-09, 35-10, 35-11, 35-14]

tech-stack:
  added: []
  patterns:
    - "A data migration deduplicates on lower(trim(...)) and keeps the FIRST spelling, so the tenant sees a value they typed"
    - "A backfill touching a FORCE-RLS table sets the tenant GUC per tenant inside the loop"
    - "Lookup lists deactivate, never delete — the row stays resolvable so existing references still render"
    - "A service resolves a foreign key itself so the refusal carries a field path, instead of letting a FK violation surface as a 409 with empty details"

key-files:
  created:
    - services/hr-service/src/main/java/io/restaurantos/hr/entity/DepartmentEntity.java
    - services/hr-service/src/main/java/io/restaurantos/hr/entity/DesignationEntity.java
    - services/hr-service/src/main/java/io/restaurantos/hr/repository/DepartmentRepository.java
    - services/hr-service/src/main/java/io/restaurantos/hr/repository/DesignationRepository.java
    - services/hr-service/src/main/java/io/restaurantos/hr/dto/HrConfigDtos.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/HrConfigService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/controller/HrConfigController.java
    - services/hr-service/src/main/resources/db/changelog/v1.0.0/015-employee-department-designation-fk.xml
    - services/hr-service/src/test/java/io/restaurantos/hr/HrConfigListsIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/EmployeeLookupMigrationIT.java
  modified:
    - services/hr-service/src/main/java/io/restaurantos/hr/entity/EmployeeEntity.java
    - services/hr-service/src/main/java/io/restaurantos/hr/dto/EmployeeDtos.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/EmployeeService.java
    - services/hr-service/src/main/resources/db/changelog/db.changelog-master.xml

key-decisions:
  - "No delete endpoint for either list; deactivation keeps the row resolvable so an existing employee still renders"
  - "The backfill keeps the first spelling seen per tenant rather than a lowercased canonical form"
  - "A blank or null old value stays NULL — no invented placeholder department"
  - "An inactive department is refused on assignment rather than silently accepted, or the deactivation means nothing"
  - "Reads gated on hr.config.view so a manager filling an employee form can populate the dropdown"

patterns-established:
  - "Verify a data migration by running the SHIPPED SQL against a database seeded with the exact defect, not by reading it"

requirements-completed: [HR-01, XCUT-01, XCUT-02]

coverage:
  - id: D1
    description: "A tenant owner creates, renames and deactivates departments and designations over the API with no SQL and nothing pre-seeded"
    requirement: HR-01
    verification:
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/HrConfigListsIT.java (8 tests, real OPA)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Case- and whitespace-variant names collide, and the refusal names the name field"
    requirement: HR-01
    verification:
      - kind: integration
        ref: "HrConfigListsIT#caseVariantNameIsRefusedWithAFieldPath"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing free-text values are preserved; distinct spellings deduplicate to one row and every employee keeps pointing at the right one"
    requirement: XCUT-02
    verification:
      - kind: integration
        ref: "scratch-database replay of the shipped 015 backfill SQL against seeded 'Waiter'/'waiter'/'  Waiter  '/blank/null across two tenants — 1 row per tenant, 3 employees on one id, 0 unlinked"
        status: pass
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/EmployeeLookupMigrationIT.java (6 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "An unknown, cross-tenant or inactive department id is refused with a field path rather than a 500 or an unbindable 409"
    requirement: XCUT-01
    verification:
      - kind: integration
        ref: "EmployeeLookupMigrationIT#unknownDepartmentIsRefusedWithAFieldPath, #crossTenantDepartmentIsRefusedWithAFieldPath, #deactivatedDepartmentIsRefused"
        status: pass
    human_judgment: false
  - id: D5
    description: "An owner maintains these lists from the HR settings screen"
    verification: []
    human_judgment: true
    rationale: "No screen exists yet — 35-11 builds it. Only the API is proven here."

duration: 48min
completed: 2026-08-12
status: complete
---

# Phase 35 Plan 05: Departments and Designations as Tenant-Managed Lists Summary

**The two worst free-text fields in the product become rows an owner maintains — and the migration carries every existing value across, collapsing three spellings of one department onto a single row instead of throwing the data away.**

## Performance

- **Duration:** 48 min
- **Started:** 2026-08-12T00:31Z
- **Completed:** 2026-08-12T01:19Z
- **Tasks:** 2
- **Files modified:** 14 (10 created, 4 modified)

## Accomplishments

- `employees.department` and `employees.designation` are no longer TEXT. That is the direct cause of the user's complaint: two text boxes on the Employees screen, and "Waiter"/"waiter"/"Wtr" as three departments no report can group.
- **The existing data was repaired, not discarded.** Every pre-existing employee keeps their department, and the deduplication is the repair.
- Four new field-pathed refusal codes, so an unknown or retired department lands on the select the user just used.

## API delivered

| Method | Path | Permission |
|---|---|---|
| `GET` | `/api/v1/hr/config/departments` | `hr.config.view` |
| `POST` | `/api/v1/hr/config/departments` | `hr.config.manage` |
| `PUT` | `/api/v1/hr/config/departments/{id}` | `hr.config.manage` |
| `PUT` | `/api/v1/hr/config/departments/{id}/active` | `hr.config.manage` |
| — | *(same four for `/designations`)* | |

**There is no `DELETE`, deliberately**, and the reason is in the controller javadoc so nobody adds one for symmetry: a department referenced by an employee cannot be removed without orphaning that employee or rewriting their record.

### New codes (wave-5 forms bind to these)

| Situation | Status | `error.code` | `details[].field` |
|---|---|---|---|
| Duplicate department/designation name | 409 | `DUPLICATE_VALUE` | `name` |
| Department id unknown | 422 | `DEPARTMENT_NOT_FOUND` | `departmentId` |
| Department deactivated | 422 | `DEPARTMENT_INACTIVE` | `departmentId` |
| Designation id unknown | 422 | `DESIGNATION_NOT_FOUND` | `designationId` |
| Designation deactivated | 422 | `DESIGNATION_INACTIVE` | `designationId` |

`EmployeeResponse` now carries `departmentId` + `departmentName` and `designationId` + `designationName`, so a table renders without a second request per row.

## Task Commits

1. **Task 1: departments and designations as a tenant-managed API** — `78f76938` (feat)
2. **Task 2: employees move onto the lists, carrying their values across** — `e048ad66` (feat)

## The backfill, and how it was actually verified

This is the part of the plan that could silently destroy a tenant's data, so it was verified by **running the shipped SQL** — extracted verbatim from the changelog — against a scratch database seeded with the exact defect:

```
tenant 1: 'Waiter' | 'waiter' | '  Waiter  ' | NULL | '   '
tenant 2: 'Waiter'
```

Result:

```
departments:  tenant 1 -> "Waiter"   tenant 2 -> "Waiter"      (2 rows, not 4)
E1 'Waiter'      -> Waiter      E2 'waiter'   -> Waiter
E3 '  Waiter  '  -> Waiter      E4 NULL       -> (none)
E5 '   '         -> (none)      E6 (tenant 2) -> Waiter
distinct department_id across E1,E2,E3 = 1
employees with a real department left unlinked = 0
```

Three spellings became one row, all three employees landed on it, blank and null got nothing invented for them, and the two tenants stayed separate.

**`DISTINCT ON` keeps the first spelling seen**, ordered by `created_at, id` — so the tenant keeps a value they actually typed rather than a lowercased canonical form they never chose.

## Decisions Made

**Deactivate, never delete.** An inactive row stays resolvable by id, so an existing employee still renders with a real department name, while dropping out of the assignable options. `EmployeeLookupMigrationIT` asserts both halves.

**An inactive department is refused on assignment.** Silently accepting it would make the deactivation meaningless. The message names the department and offers both ways out — choose another, or reactivate it.

**Reads gated on `hr.config.view`, writes on `hr.config.manage`.** Gating the list on manage would empty the dropdown for exactly the people who use it most.

## Deviations from Plan

**1. [Rule 1 — Bug] The changelog was not well-formed XML.**
- **Found during:** Task 2 verification, by running the migration.
- **Issue:** The backfill SQL uses `<>` (not-equals). Liquibase failed with `SAXParseException: The content of elements must consist of well-formed character data or markup` at line 71, and **hr-service would not boot**.
- **Fix:** Wrapped the `DO` block in `<![CDATA[ … ]]>`.
- **Why it matters:** the scratch-database replay had already proven the SQL correct. Only executing the changelog caught the XML.

**2. [Rule 1 — Bug] Removing the two String fields orphaned an `@Enumerated`.**
- **Issue:** `@Enumerated(EnumType.STRING)` sat above `designation`/`department`; deleting those fields left it attached to the new `departmentId`, and Hibernate refused the entity: *"Property `EmployeeEntity.departmentId` is annotated `@Enumerated` but its type `java.util.UUID` is not an enum"*.
- **Fix:** Moved the annotation back onto `employmentType`.

Both defects were invisible to compilation and to the SQL-level test. They only appeared because the migration was executed against a real database — which is the argument for `HrContextLoadsIT` existing.

---

**Total deviations:** 2 auto-fixed, both self-inflicted and both caught by running rather than reading.

## Issues Encountered

**`ShiftEntity.role_designation` is a second free-text designation column, and it is still there.** The plan asked for a finding either way, so: **it is a designation by another name.** `shifts.role_designation TEXT` describes which job title a shift is for ("Waiter", "Chef"), which is exactly what `designations` now holds. Leaving it invites the same defect one table over — a tenant will end up with "Waiter" as a designation row and "waiter" as a shift's role string. **Not migrated here**, because the plan explicitly says not to expand scope, and because the shift form is 35-11's screen. **Recommended for 35-11 or a follow-up:** make it `designation_id UUID REFERENCES designations(id)` with the same backfill shape as 015.

**Blocked twice by sibling agents' in-flight work.** `PunchRetentionIT` (untracked, another agent's) broke test-compile for the whole module — javac compiles all test sources together, so no hr-service test could run regardless of which file it lived in. Waited rather than touching their files. Separately, `shared-lib`'s own integration tests (`TenantFilterPropagationIT`, `ConsumerRlsGucPropagationIT`) fail with `NoClassDefFoundError: Could not initialize class BaseIntegrationTest` — **pre-existing and unrelated to this phase**; worked around by `mvn -pl shared-lib install -DskipITs` and running hr-service alone. Flagged, not fixed: it is outside this phase's scope but it means `mvn verify` at the root is currently red for reasons nothing here caused.

**Existing tests were updated, not deleted.** `EmployeeIT`, `EmployeeBranchIsolationIT` and `HrFieldErrorIT` passed `"Chef"`/`"Kitchen"` positionally into the DTO. They now pass `null` for both ids, which keeps every assertion those tests actually make. Worth noting a trap: `mvn test-compile` reported CLEAN against stale `target/test-classes` and only failed after `rm -rf`, so an incremental build can hide a DTO break entirely.

## User Setup Required

None. The migration runs on the next hr-service start and backfills automatically.

**Note for anyone with a running hr-service:** rebuild, RESTART, then `bash scripts/check-stale-jars.sh`. The entity and the schema must move together — that is why the migration and the entity change are one commit.

## Next Phase Readiness

- **35-09** — the department/designation pickers read `GET /api/v1/hr/config/departments`; filter `active` for the picker, show both in settings.
- **35-10** — the employee form sends `departmentId`/`designationId` and binds the five codes above.
- **35-11** — owns the settings screens; please also consider `shifts.role_designation` (above).

**Concern:** the uniqueness check races. Two simultaneous creates of the same name both pass the service check and the loser gets a 409 from `handleDataIntegrity` with an **empty** details list — correct status, no field path. Rare and self-correcting on retry, but it is the one path where the guarantee this plan makes does not hold. Closing it properly means catching the constraint violation and re-throwing as `DuplicateValueException`, which is a small follow-up.

## Self-Check: PASSED

All 10 created files present on disk; both task commits present in git history.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-12*
