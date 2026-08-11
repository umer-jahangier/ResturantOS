---
phase: 35-hr-usability
plan: 01
subsystem: api
tags: [spring, bean-validation, exception-handling, http-422, http-409, rest-contract, testcontainers]

requires:
  - phase: 03-platform-foundations
    provides: "ApiError envelope {error:{code,message,details[],traceId}} and GlobalExceptionHandler"
  - phase: 18b-hr-authz
    provides: "HrAuthorizationService and the nine branch-isolated hr.rego rules these services call"
provides:
  - "FieldValidationException — carries (field, instruction) pairs, maps to 422, available to all 15 services"
  - "DuplicateValueException — carries the colliding field, maps to 409 DUPLICATE_VALUE"
  - "StateInvalidException gains a code-carrying constructor; handleState now emits ex.getCode()"
  - "Fourteen named HR rejection codes with their HTTP statuses and field paths (table below)"
  - "RequestBodyValidationClosureTest — a package scan that fails any future @RequestBody lacking @Valid"
affects: [35-04, 35-09, 35-10, 35-11, 35-12, 35-13, 35-14, all-services-error-handling]

tech-stack:
  added: []
  patterns:
    - "Business-rule refusals reuse the bean-validation envelope rather than inventing a second shape"
    - "422 for a well-formed request refused by a domain rule; 400 stays reserved for bean validation"
    - "A refusal with no single offending field carries an EMPTY details list, never a guessed path"
    - "Closure tests scan a package, not a hand-maintained class list, and assert a non-zero inspection count"

key-files:
  created:
    - shared-lib/src/main/java/io/restaurantos/shared/exception/FieldValidationException.java
    - shared-lib/src/main/java/io/restaurantos/shared/exception/DuplicateValueException.java
    - shared-lib/src/test/java/io/restaurantos/shared/api/FieldErrorContractTest.java
    - services/hr-service/src/test/java/io/restaurantos/hr/HrFieldErrorIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/RequestBodyValidationClosureTest.java
  modified:
    - shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java
    - shared-lib/src/main/java/io/restaurantos/shared/exception/StateInvalidException.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/EmployeeService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/ShiftService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/LeaveService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/PayrollRunService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/controller/ShiftController.java
    - services/hr-service/src/main/java/io/restaurantos/hr/controller/LeaveController.java
    - services/hr-service/src/main/java/io/restaurantos/hr/controller/internal/AttendanceIngestController.java

key-decisions:
  - "422 for domain-rule refusals, keeping 400 for bean validation, so a client can tell a malformed request from a well-formed one refused by a rule"
  - "A backwards leave range is bound to endDate, not startDate — the start date is usually the value the user meant"
  - "A cross-branch shift assignment is bound to shiftId, not employeeId — the employee is what the user just picked deliberately"
  - "Wrong-state refusals carry NO field path; inventing one would send the user to edit something irrelevant"
  - "Overnight shifts (end before start) remain LEGAL; only equal start/end times are refused — the plan's literal rule would have made a closing shift unschedulable"
  - "The nine surviving raw IllegalStateExceptions guard tenant/branch/user context and stay 500 with a logged stack trace, each carrying a comment saying why"

patterns-established:
  - "Instructions carry the numbers: 'Only 3.5 days of Annual remain and this request is 5 days', not 'Insufficient leave balance'"
  - "Error text never contains a table, column or constraint name — asserted by regex in FieldErrorContractTest"

requirements-completed: [XCUT-06, HR-01, HR-02, HR-05]

coverage:
  - id: D1
    description: "A rejected HR write names the offending field in a machine-readable path the client can bind to an input"
    requirement: XCUT-06
    verification:
      - kind: unit
        ref: "shared-lib/src/test/java/io/restaurantos/shared/api/FieldErrorContractTest.java#singleViolationProduces422WithTheCallersCodeAndExactlyOneNamedField"
        status: pass
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/HrFieldErrorIT.java (8 tests, real Postgres + OPA)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every foreseeable HR rejection answers with its own code and HTTP status, never the catch-all 500"
    requirement: HR-05
    verification:
      - kind: integration
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/HrFieldErrorIT.java#payrollStateRefusals_are409_eachWithItsOwnCode"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every @RequestBody in hr-service is bean-validated, and a future one cannot skip it"
    verification:
      - kind: unit
        ref: "services/hr-service/src/test/java/io/restaurantos/hr/RequestBodyValidationClosureTest.java#everyRequestBodyParameterIsBeanValidated"
        status: pass
      - kind: other
        ref: "mutation check — removing one @Valid fails the test naming LeaveController#request(RequestLeave req)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No error body leaks database vocabulary or a stack frame to the caller (T-29-01-A)"
    verification:
      - kind: unit
        ref: "shared-lib/src/test/java/io/restaurantos/shared/api/FieldErrorContractTest.java#noResponseBodyEchoesDatabaseVocabularyOrAStackFrame"
        status: pass
    human_judgment: false
  - id: D5
    description: "The 14 codes below render as actionable messages in a real browser rather than as toasts"
    verification: []
    human_judgment: true
    rationale: "No frontend consumes these codes yet — 35-04 builds the binding layer and 35-10..35-13 the screens. Browser proof belongs to 35-14, which is where the phase's own plan puts it."

duration: 14min
completed: 2026-08-11
status: complete
---

# Phase 35 Plan 01: Field-Path Error Contract Summary

**Fourteen HR refusals moved off the catch-all 500 onto their own status, code and field path, in the envelope the web client already parses — plus a package-scanning test that stops the next `@RequestBody` from skipping `@Valid`.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-08-11T23:16:31+05:00
- **Completed:** 2026-08-11T23:30:24+05:00
- **Tasks:** 3 (TDD: 1 RED commit + 3 GREEN commits)
- **Files modified:** 14 (5 created, 9 modified)

## Accomplishments

- Business-rule refusals now populate `details[].field`, which `ApiError.fieldErrors` on the client has parsed since phase 3 but which almost nothing populated. No second envelope, no second parser.
- Every foreseeable HR rejection has its own status and code. Before this, a duplicate employee number, a leave range typed backwards and a genuine server crash were all `500 INTERNAL_ERROR — "An unexpected error occurred"`.
- Seven `@RequestBody` parameters that took an unvalidated body now validate, and a closure test makes that permanent.
- The contract lives in shared-lib, so the other 14 services inherit it with no edit to their own handler — this is the app-wide half of D-35-03.

## The code table

This is the contract plans 35-04, 35-09, 35-10, 35-11, 35-12 and 35-13 bind to. Field paths match the request DTO's own field names, so no translation table is needed.

| Situation | Status | `error.code` | `details[].field` |
|---|---|---|---|
| Employee number already exists in tenant | 409 | `DUPLICATE_VALUE` | `employeeNo` |
| Payroll run already exists for period | 409 | `DUPLICATE_VALUE` | `periodMonth` |
| Employee already on that shift on that date | 409 | `DUPLICATE_VALUE` | `employeeId` |
| Leave end date precedes start date | 422 | `LEAVE_RANGE_INVALID` | `endDate` |
| Leave request exceeds remaining balance | 422 | `LEAVE_BALANCE_INSUFFICIENT` | `leaveTypeId` |
| Employee and shift at different branches | 422 | `SHIFT_BRANCH_MISMATCH` | `shiftId` |
| Shift start time equals end time | 422 | `SHIFT_TIMES_INVALID` | `endTime` |
| Accrual month outside 1–12 | 422 | `ACCRUAL_MONTH_INVALID` | `month` |
| Approve/reject a non-PENDING leave request | 409 | `LEAVE_NOT_PENDING` | *(none)* |
| Calculate a run that is not DRAFT/CALCULATED | 409 | `PAYROLL_RUN_NOT_CALCULABLE` | *(none)* |
| Calculate a run with no branch | 409 | `PAYROLL_RUN_NO_BRANCH` | *(none)* |
| Payslip net would be negative | 409 | `PAYSLIP_NET_NEGATIVE` | *(none)* |
| Approve a run that is not CALCULATED | 409 | `PAYROLL_RUN_NOT_CALCULATED` | *(none)* |
| Pay a run that is not APPROVED | 409 | `PAYROLL_RUN_NOT_APPROVED` | *(none)* |
| Employee / shift / assignment / leave / run absent | 404 | `NOT_FOUND` | *(none)* |
| Bean-validation failure on any body | 400 | `VALIDATION_FAILED` | one per violation |

**Why some rows have no field.** A wrong-state refusal is caused by the record, not by anything the user typed. The plan forbids inventing a path there, and it is right to: a field path is an instruction to go and edit that box, and there is no box that would help.

**Why the field is the one it is.** A backwards leave range blames `endDate` because the start date is usually the one the user meant. A cross-branch assignment blames `shiftId` because the employee is what the user just picked on purpose. Naming the other field in either case sends someone to change a correct value.

## Task Commits

1. **Task 1 RED: pin the contract before it exists** — `eae372b` (test)
2. **Task 1 GREEN: two shared exceptions that name the field** — `7e5cf19` (feat)
3. **Task 2: HR refuses with a code and a field, not a 500** — `522850fc` (feat)
4. **Task 3: close the @Valid hole and keep it closed** — `bbe3e4eb` (feat)

## Files Created/Modified

- `shared-lib/.../exception/FieldValidationException.java` — (field, instruction) pairs, 422
- `shared-lib/.../exception/DuplicateValueException.java` — colliding field, 409
- `shared-lib/.../exception/StateInvalidException.java` — code-carrying constructor added
- `shared-lib/.../api/GlobalExceptionHandler.java` — two new handlers; `handleState` emits `ex.getCode()`
- `services/hr-service/.../service/{Employee,Shift,Leave,PayrollRun}Service.java` — typed refusals
- `services/hr-service/.../controller/{Shift,Leave}Controller.java`, `internal/AttendanceIngestController.java` — `@Valid` + constraints
- `shared-lib/src/test/.../FieldErrorContractTest.java` — 7 tests, all six plan behaviours
- `services/hr-service/src/test/.../HrFieldErrorIT.java` — 8 tests against real Postgres + OPA
- `services/hr-service/src/test/.../RequestBodyValidationClosureTest.java` — the permanent guard

## Decisions Made

See `key-decisions` in the frontmatter. The two worth restating:

**`ApiError` is unmodified.** The envelope was already sufficient — `details: List<FieldError>` and a four-argument factory existed and were used by bean validation. Asserted by the acceptance criteria and by `git diff --quiet`.

**`handleState` now emits `ex.getCode()` instead of the literal `"STATE_INVALID"`.** Behaviour-preserving by construction: all 42 pre-existing throw sites use the one-argument constructor, which sets the code to `STATE_INVALID`. Only the new two-argument constructor differs. This is what lets the payroll screen offer a different next action for "not calculated" than for "no branch".

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Maven ran on the wrong JDK**
- **Found during:** Task 1 verification
- **Issue:** `maven-enforcer-plugin` refused the build — the project targets Java 25 and Maven's runtime was a different JDK.
- **Fix:** `export JAVA_HOME=$(/usr/libexec/java_home -v 25)` for every Maven invocation. No file changed.
- **Verification:** Build proceeds.

**2. [Rule 3 — Blocking] Testcontainers Ryuk could not start**
- **Found during:** Task 2 verification
- **Issue:** Ryuk failed with `error while creating mount source path '/Users/…/.colima/default/docker.sock': operation not supported`. `~/.testcontainers.properties` already carries `ryuk.disabled=true` but it was not honoured, and `HrTestBase` sets the system property from inside its own static initializer, which is too late for the `DockerClientFactory` Ryuk uses.
- **Fix:** `export TESTCONTAINERS_RYUK_DISABLED=true TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2` before Maven. No file changed.
- **Verification:** 22 hr-service integration tests run against real Postgres + OPA containers. **Testcontainers works here** — restating this because STATE.md records a previous executor wrongly claiming otherwise.

**3. [Rule 1 — Bug] The plan's shift-time rule would have banned overnight shifts**
- **Found during:** Task 3
- **Issue:** The plan asked that "a shift whose end time is not after its start time" be refused. `22:00–06:00` is the most ordinary shift a restaurant runs; the literal rule makes a closing shift unschedulable, removing behaviour that works today.
- **Fix:** Refuse only `startTime == endTime` (a zero-length shift, always a typo), bound to `endTime` with code `SHIFT_TIMES_INVALID`. An end before a start is documented as an overnight shift and explicitly allowed.
- **Files modified:** `ShiftService.java` (`validateTimes`, applied by both create and update so the rule is expressed once)
- **Verification:** `HrFieldErrorIT` creates a 17:00–23:00 shift; the DTO javadoc states the rule.
- **⚠ Downstream:** **35-11 must implement `end != start`, not `end > start`.** The plan text for 35-11 says "a shift whose end precedes its start" — that wording is superseded.

### Plan inaccuracies corrected (no code impact)

**4. `files_modified` named the wrong DTO files.** The plan listed `EmployeeDtos.java`, `PayrollDtos.java` and `DeviceDtos.java` as needing constraints. The DTOs that actually needed them are records nested inside `ShiftService`, `LeaveService`, `ShiftController` and `AttendanceIngestController`. `EmployeeDtos` and `PayrollDtos` were already fully constrained and already `@Valid`-bound. **`DeviceDtos.java` was not touched** — see Issues below.

**5. The `<verify>` blocks use `-Dtest=` on `*IT` classes.** Confirmed against `services/hr-service/pom.xml`: surefire excludes `**/*IT.java`, failsafe includes them. `-Dtest=` does override the exclude, but it runs the IT under surefire's configuration, where all 8 tests errored on container startup. The correct invocation, used for every integration result reported here:

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 25)
export TESTCONTAINERS_RYUK_DISABLED=true TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2
mvn -pl services/hr-service -am verify -Dit.test='HrFieldErrorIT' \
    -Dfailsafe.failIfNoSpecifiedTests=false
```

---

**Total deviations:** 3 auto-fixed (2 blocking-environment, 1 bug) + 2 plan corrections.
**Impact on plan:** No scope creep. The overnight-shift fix is the only behavioural difference from the plan as written, and it prevents a regression rather than causing one.

## Issues Encountered

**A sibling agent's uncommitted work sat in the same files.** Five other agents commit to this repository concurrently. During Task 2, `shared-lib` stopped compiling because an untracked `TestContainerPorts.java` had appeared in `main/` sources referencing docker-java; it resolved itself minutes later when that agent added the `docker-java-api` dependency to `shared-lib/pom.xml`. Nothing was done to their files.

`services/hr-service/.../dto/DeviceDtos.java` is currently modified-uncommitted by that agent's ADMS work. **It was deliberately not touched**, and no constraint was added to it. Nothing in this plan required it — `IngestRequest` turned out to live inside `AttendanceIngestController.java`, not `DeviceDtos.java`. Every commit here used explicit pathspecs; `git add -A` would have swept up that agent's half-finished refactor **including a file deletion** (`AdmsRegistrationDefectsIT.java`).

**Two things this plan did NOT prove:**

1. **`PAYROLL_RUN_NO_BRANCH` has no test.** Constructing a branchless run requires bypassing the `create()` guard that prevents one, and doing so via the repository would have routed through OPA with a null branch and failed for the wrong reason. The code path is a two-line guard reviewed by eye. Honest status: implemented, not test-covered.
2. **Nothing yet renders these codes.** The web client parses the envelope, but no screen binds a field error to an input. That is 35-04's job, and browser proof is 35-14's.

**Stale frontend mock noted:** `frontend/__tests__/auth/payroll-step-up-prompt.test.tsx:105` mocks an approve failure as `STATE_INVALID`. The server now sends `PAYROLL_RUN_NOT_CALCULATED`. The test still passes (it mocks the server), but it now documents a code the server no longer emits. 35-12 owns the payroll screen and should correct it.

## User Setup Required

None.

## Next Phase Readiness

**Unblocks the whole phase.** Every frontend plan in phase 35 binds server errors to inputs, and none could before this landed.

- **35-04** — build `server-field-errors.ts` against the code table above.
- **35-05, 35-06, 35-08** — throw `FieldValidationException` / `DuplicateValueException` for their new endpoints; the handler already routes them.
- **35-11** — use `end != start` for shift times (deviation 3).
- **35-12** — bind `PAYROLL_RUN_*` codes to distinct next actions; fix the stale mock noted above.

**Concern:** the codes are a contract now, and nothing prevents a later plan inventing a fifteenth spelling. A code-catalog closure test would fix that; it is not in this phase's plans.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-11*

## Self-Check: PASSED

All 5 created files present on disk; all 4 task commits present in git history.
