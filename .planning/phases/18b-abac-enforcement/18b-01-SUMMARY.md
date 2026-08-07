---
phase: 18b-abac-enforcement
plan: 01
subsystem: authorization-abac
status: complete
tags: [abac, opa, rego, policy-reachability, branch-isolation, fail-closed, timeouts, closure-test, liquibase]
requires:
  - running dev stack (postgres, opa, rabbitmq, redis)
  - ".planning/research/authz-audit/RESEARCH.md (2026-08-07)"
  - "shared-lib: AuthorizationService, DefaultOpaClient, OpaInput, JwtClaims"
  - "13-02/13-07: RoleCeiling, the rbac.* authority split"
provides:
  - "PolicyReachabilityTest — a Rego rule with no runtime caller is now a BUILD FAILURE"
  - "HrAuthorizationService — hr.rego's 9 actions, live for the first time"
  - "FinanceAuthorizationService — finance.rego's 6 dead-letter rules, live"
  - "vendor.rego manage + pos.rego discount.override/split_bill, live"
  - "branch isolation on employees, payroll runs and journal entries, enforced BY POLICY"
  - "2s connect+read timeout on the SHARED OpaClient (pos, inventory, kitchen, hr, authz)"
  - "SharedAutoConfiguration.authorizationService — one bean, not four hand-copied ones"
  - "OpaTimeoutFailClosedIT — a stalled stub, so it tests an actual timeout"
  - "file.view / file.upload / file.manage (changeset 082) + 5 gated file-service endpoints"
  - "RoleCatalogClosureTest — role_permissions.role_code closure"
  - "explicit input.action guards on all 22 rules (closes RESEARCH A6)"
affects:
  - "BEHAVIOUR CHANGE: cross-branch employee/payroll/journal reads and writes now 403 — see below"
  - "hr-service requires OPA_URL to start (as pos/inventory/kitchen already did)"
  - "authorization-service now resolves the shared OpaClient; its @Primary OpaConfig is deleted"
  - "file-service endpoints require file.* — KITCHEN_STAFF/CASHIER/WAITER lose file access they should never have had"
tech-stack:
  added: []
  patterns:
    - "closure test over two vocabularies parsed from the repository tree (PermissionCatalogClosureTest)"
    - "deferral registry checked in both directions — a suppression cannot rot or hide a deletion"
    - "authorize on the RESOURCE's branch, never the caller's"
    - "gated public entry point + ungated internal path for service-to-service seams"
    - "test doubles stubbed per-action, never blanket-allow"
key-files:
  created:
    - services/authorization-service/src/test/java/io/restaurantos/authz/PolicyReachabilityTest.java
    - services/hr-service/src/main/java/io/restaurantos/hr/authz/HrAuthorizationService.java
    - services/hr-service/src/test/java/io/restaurantos/hr/EmployeeBranchIsolationIT.java
    - services/finance-service/src/main/java/io/restaurantos/finance/authz/FinanceAuthorizationService.java
    - services/auth-service/src/test/java/io/restaurantos/auth/RoleCatalogClosureTest.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/082-file-permissions-and-finance-viewer-role.xml
  modified:
    - policies/restaurantos/{pos,rbac}.rego
    - shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java
    - services/authorization-service/src/test/java/io/restaurantos/authz/integration/OpaTimeoutFailClosedIT.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/{EmployeeService,PayrollRunService,LeaveService,AttendanceService}.java
    - services/hr-service/src/{main/resources/application.yml,test/java/io/restaurantos/hr/HrTestBase.java}
    - services/finance-service/src/main/java/io/restaurantos/finance/service/{JournalEntryServiceImpl,PeriodCloseService}.java
    - services/finance-service/src/main/java/io/restaurantos/finance/web/AccountController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/VendorService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/{authz/PosAuthorizationService,service/OrderServiceImpl,web/PaymentController}.java
    - services/file-service/src/main/java/io/restaurantos/file/controller/FileController.java
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
  deleted:
    - services/authorization-service/src/main/java/io/restaurantos/authz/config/OpaConfig.java
decisions: [D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9, D-10, D-11]
metrics:
  policy_rules_reachable_before: 6
  policy_rules_reachable_after: 21
  policy_rules_deferred: 1
  rego_tests: 139
  rego_coverage_pct: 100
  rego_covered_lines_before: 781
  rego_covered_lines_after: 787
---

# Phase 18b Plan 01: ABAC Enforcement Summary

**ResturantOS's OPA policies now actually enforce: 6 of 22 rules were reachable at runtime, now 21 are, and a new build-time test makes a dead-letter rule a compile-time failure rather than an invisible one.**

## The headline, with evidence

`hr.rego` demanded `same_tenant_and_branch` on all nine HR actions and had 28 passing tests.
hr-service had no OPA client at all, and `EmployeeService.load(id)` resolved employees by tenant
only. A manager at Branch A could read and modify `basicSalaryPaisa` at Branch B.

`EmployeeBranchIsolationIT` was written to fail first. Against the pre-fix `EmployeeService` (policy
calls removed, everything else identical):

```
[ERROR] Tests run: 4, Failures: 3, Errors: 0 -- in io.restaurantos.hr.EmployeeBranchIsolationIT
[ERROR] managerAtBranchA_cannotReadEmployeeAtBranchB       Expecting code to raise a throwable.
[ERROR] managerAtBranchA_cannotModifySalaryAtBranchB       Expecting code to raise a throwable.
[ERROR] managerAtBranchA_cannotDeactivateEmployeeAtBranchB Expecting code to raise a throwable.
```

Three cross-branch operations *succeeded*. The fourth test — same-branch access — passed, confirming
the suite is not simply denying everything.

After wiring, against a real OPA container running the repository's own `policies/` bundle:

```
[INFO] Tests run: 4, Failures: 0, Errors: 0 -- in io.restaurantos.hr.EmployeeBranchIsolationIT
```

The refusal is a 403 produced by `hr.rego` itself, not by a `WHERE` clause — see D-3 for why that
distinction was worth preserving.

## ⚠ Behaviour change — state this to users

**A manager who could previously read or modify another branch's employees will now be refused.**
That is the point of the phase, and it is not limited to employees:

| Operation | Before | After |
|---|---|---|
| `GET/PUT/DELETE /api/v1/hr/employees/{id}` on another branch's employee | succeeded | **403** |
| Payroll run read / calculate / approve / pay on another branch's run | succeeded | **403** |
| `GET /api/v1/finance/journal-entries/{id}` on another branch's JE | succeeded | **403** |
| Attendance punch / read for another branch's employee | succeeded | **403** |
| Leave approve / reject for another branch's employee | succeeded | **403** |
| file-service upload/list/download/delete/quota as CASHIER, WAITER, KITCHEN_STAFF | succeeded | **403** |

`PayrollRunService.load` and `JournalEntryServiceImpl.getById` had the identical branch-blind
`findById` shape as `EmployeeService.load` — found while wiring, not reported in the research.

Anyone legitimately needing cross-branch HR or finance access needs a token for that branch. There
is no cross-branch permission today, and adding one would be a product decision.

## Reachability: 6 → 21 of 22

`PolicyReachabilityTest` written first and confirmed failing against the pre-fix tree, reproducing
the audit's list exactly:

```
Expecting empty but was: ["finance/close_period", "finance/manage_coa", "finance/post_journal",
  "finance/reverse_journal", "finance/view_coa", "finance/view_journal", "hr/attendance_manage",
  "hr/attendance_view", "hr/employee_manage", "hr/employee_view", "hr/leave_approve",
  "hr/leave_view", "hr/payroll_approve", "hr/payroll_run", "hr/payroll_view",
  "pos/pos.order.discount.override", "pos/pos.order.split_bill", "rbac/manage", "vendor/manage"]
```

After wiring:

```
[INFO] Tests run: 3, Failures: 0, Errors: 0 -- in io.restaurantos.authz.PolicyReachabilityTest
```

| Module | Rules | Before | After |
|---|---:|---:|---:|
| `pos` | 5 | 2 | 5 |
| `inventory` | 2 | 2 | 2 |
| `kds` | 2 | 2 | 2 |
| `vendor` | 3 | 2 | 3 |
| `finance` | 7 | 1 | 7 |
| `hr` | 9 | 0 | 9 |
| `rbac` | 4 (1 action) | 0 | **0 — deferred, D-6** |

`rbac.rego` is the one remaining dead letter. RESEARCH W2-5 marks it `[Needs user decision]` and it
was not decided unilaterally: its real enforcement point is role grant/revoke in `user-service`,
which has no OPA client and is under concurrent edit. It sits in an explicit `DEFERRED` registry
that is checked **both ways** — an entry that becomes reachable fails as a stale suppression, and an
entry naming a deleted rule fails too. Every *new* dead letter is still a build failure.

**Open question for the user (D-6): wire `rbac.rego` into user-service, or delete it and record that
`@PreAuthorize` + `RoleCeiling` is the chosen control?**

## Timeouts: the test now tests a timeout

`SharedAutoConfiguration.opaClient` had **no timeouts at all**; only authorization-service set a
budget, in a `@Primary` override. `OpaTimeoutFailClosedIT` pointed at `http://127.0.0.1:1` — a
closed port, which refuses *instantly* and therefore cannot detect a missing timeout.

The rewritten test uses a stalled `HttpServer` (10 s sleep) and asserts two-sided. Proof it catches
the real regression — timeout removed from `SharedAutoConfiguration`, everything else unchanged:

```
[ERROR] OpaTimeoutFailClosedIT.hungOpaDeniesWithinTheTwoSecondBudget -- Time elapsed: 10.49 s
[must give up on the 2 s budget rather than wait out the 10000 ms stall]
```

It waited out the full stall. With the shared timeout restored:

```
[INFO] Tests run: 2, Failures: 0, Errors: 0 -- in io.restaurantos.authz.integration.OpaTimeoutFailClosedIT
```

The budget now lives in shared-lib and `authorization-service/config/OpaConfig.java` is deleted, so
authorization-service exercises the same client pos, inventory, kitchen and hr do.

## Catalogue repairs

**`file.*`** — file-service had five endpoints behind `.authenticated()` and nothing else: no
`@PreAuthorize`, no OPA, and no `file.*` code in the catalogue. A KITCHEN_STAFF token holding
exactly `pos.kds.view`/`pos.kds.update` could delete any file in the tenant. Changeset 082 adds
`file.view`/`file.upload`/`file.manage` with explicit grants; all five endpoints are gated.

**`FINANCE_VIEWER`** — the research's cause was wrong and the correction changed the fix. It
attributed the orphan to `context="seed"`; live, the seed context *ran*:

```
auth_db=# SELECT id, contexts, dateexecuted FROM databasechangelog WHERE id LIKE '%035%';
 auth-1.0.0-035-seed-system-roles | seed | 2026-06-24 00:34:12
```

`035` ran on 2026-06-24; `FINANCE_VIEWER` was added to it on 2026-06-27 (`b63074a`) and
`runOnChange="false"` meant the edit never re-applied. Because the *repository* is correct and only
the *rows* are wrong, no repository-reading test can catch it — so the repair is a migration that
verifies itself. Dry-run against the live `auth_db` (rolled back):

```
BEGIN
DELETE 2
DO
 orphan grants after repair: 0
ROLLBACK
```

## Test results — every suite run in the state reported

| Module | Result |
|---|---|
| `opa test policies/` | **PASS: 139/139**, coverage **100 %** (781 → 787 covered lines) |
| hr-service | 12 unit + **22 IT** — BUILD SUCCESS (incl. 4 new `EmployeeBranchIsolationIT`) |
| finance-service | 24 unit + **63 IT** — BUILD SUCCESS |
| purchasing-service | **107** — BUILD SUCCESS (incl. 3 new `vendor.manage` policy tests) |
| pos-service | 60 unit + **120 IT** — BUILD SUCCESS (incl. 3 new discount/split tests) |
| auth-service | **166** — BUILD SUCCESS (incl. new `RoleCatalogClosureTest`) |
| authorization-service | unit + **9 IT** — BUILD SUCCESS (incl. `PolicyReachabilityTest`, rewritten timeout IT) |
| file-service | BUILD SUCCESS |
| kitchen-service | **29** — BUILD SUCCESS |
| inventory-service | **201** — BUILD SUCCESS |

hr-service tests run against a **real OPA container** with the repository's own policy bundle, not a
stub — the whole point of the phase was that the policy was already correct and merely unasked.

## Bugs found and fixed while wiring

1. **`autoPostInternal` would have been gated on a user permission** (D-8). Wiring `post_journal`
   into `create`/`post` broke 27 auto-posting tests, correctly: the internal seam POS, HR, inventory
   and purchasing post the ledger through has a system identity, not a user's
   `finance.journal.post`. Split into gated public entry points and ungated internals.
2. **The gate reordered an error path.** Hoisting it above the period check made a post to a LOCKED
   period with no branch context report "Branch context required" instead of 423 PERIOD_LOCKED. Gate
   moved next to the branch it needs.
3. **Six rules had no `input.action` guard** (RESEARCH A6), so they matched *any* action in their
   module — a holder of `pos.order.void.any` would have been allowed a refund without the
   `approval_limit_paisa` check the day a second pos action appeared. `PolicyReachabilityTest` now
   fails on an unguarded rule.
4. **`PayrollRunService.load` and `JournalEntryServiceImpl.getById`** had the same branch-blind
   `findById` as `EmployeeService.load`. Not in the research; found by wiring.
5. **`RoleCatalogClosureTest` reported WAITER as an orphan** — a scanner blind spot, not drift. 055
   inserts it with `SELECT … WHERE NOT EXISTS` rather than a `VALUES` tuple. Fixed to read both
   forms; a scanner that invents drift is worse than one that misses it.
6. **My own first `PolicyReachabilityTest` had a greedy-regex bug** that made every Feign call site
   match twice. Caught because the test reports unresolvable call sites instead of skipping them.

## Deviations from plan

- **`rbac.rego` deferred rather than wired** (D-6). The user's instruction was to wire "the rest";
  this is the one exception, and it is registered, justified and checked both ways rather than
  silently skipped. It needs a decision, not an implementation choice.
- **`@PreAuthorize` for inventory/kitchen (W2-7) not done** — out of the stated scope, deferred as
  W-18b-02.
- **Two pre-existing repo defects worked around, not fixed** (out of scope, logged):
  stale `target/` artefacts (`FinanceServiceApplication 2.class` etc.) break `repackage` on
  incremental builds — `mvn clean` clears it; and `AccountController.java` has `\r\r\n` line
  terminators, so it was edited byte-exactly to avoid a whole-file diff colliding with concurrent
  finance work.

## Self-Check: PASSED

All 6 created files verified present on disk; all modified files verified to contain the changes
described; `OpaConfig.java` verified deleted. Every test result above was produced by a command run
in the state reported — the before/after pairs for the branch-isolation fix and the timeout fix were
each produced by temporarily reverting the specific change and re-running.
