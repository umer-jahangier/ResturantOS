---
phase: 10-purchasing-accounts-payable
plan: 05
subsystem: finance
tags: [finance, opa, authorization, expenses, journal-entry, feign, flyway, rls]

# Dependency graph
requires:
  - phase: 10-02
    provides: "finance-service AP aging (ApAgingService), JournalEntryService.autoPostInternal idempotent auto-post, ChartOfAccount/AccountingPeriod provisioning"
  - phase: 10-01
    provides: "purchasing-service's Feign-to-authorization-service OPA pattern (AuthorizationClient + PoApprovalService.assertOpaAllows), mirrored here"
provides:
  - "Expense entity + V5 migration (expenses table, RLS, finance_user grants)"
  - "POST /api/v1/finance/expenses (create), /{id}/approve, /{id}/reject, GET /{id}"
  - "finance.feign.AuthorizationClient — first OPA/authorization-service consumer in finance-service"
  - "OPA-gated expense approval: RBAC (finance.expense.approve authority) + OPA approval-limit check; deny -> 403 EXPENSE_APPROVAL_LIMIT_EXCEEDED"
  - "Balanced JE auto-post on expense approval (DR expense account / CR bank 1110), sourceType=EXPENSE, idempotent via existing autoPostInternal dedup"
  - "ExpenseApprovalIT proving the above"
affects: [11-hr-payroll, 12-reports-owner-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "finance-service now has its own Feign AuthorizationClient to authorization-service (copied verbatim from purchasing-service), NOT shared-lib's conditional OpaClient bean"

key-files:
  created:
    - services/finance-service/src/main/resources/db/migration/V5__expenses.sql
    - services/finance-service/src/main/java/io/restaurantos/finance/domain/model/Expense.java
    - services/finance-service/src/main/java/io/restaurantos/finance/domain/enums/ExpenseStatus.java
    - services/finance-service/src/main/java/io/restaurantos/finance/repository/ExpenseRepository.java
    - services/finance-service/src/main/java/io/restaurantos/finance/dto/CreateExpenseRequest.java
    - services/finance-service/src/main/java/io/restaurantos/finance/dto/ExpenseDto.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/ExpenseService.java
    - services/finance-service/src/main/java/io/restaurantos/finance/web/ExpenseController.java
    - services/finance-service/src/main/java/io/restaurantos/finance/feign/AuthorizationClient.java
    - services/finance-service/src/main/java/io/restaurantos/finance/exception/ExpenseApprovalLimitExceededException.java
    - services/finance-service/src/test/java/io/restaurantos/finance/ExpenseApprovalIT.java
  modified:
    - services/finance-service/src/main/java/io/restaurantos/finance/exception/FinanceGlobalExceptionHandler.java

key-decisions:
  - "Create endpoint @PreAuthorize uses finance.journal.post (the only existing finance write permission) — no finance.expense.create permission exists in auth-service's seed, and plan explicitly said not to invent one"
  - "Expense not-found and status-guard violations reuse the existing generic IllegalStateException -> 400 handler rather than adding a new not-found exception type (kept files_modified scope tight)"
  - "ExpenseApprovalIT sets TenantContext.set(tenantId, branchId, userId, null) directly (not just the tenantId-only InternalTenantContextHelper.activate used by InternalAutoPostIT) so JournalEntryServiceImpl.requireBranchId() resolves a non-null branch context during the auto-post call inside approve()"

patterns-established:
  - "OPA approval-limit gate = Feign AuthorizationClient.authorize(module, action, Resource) + fail-closed on null response body -> throw a dedicated *LimitExceededException mapped to 403 in the service's RestControllerAdvice (mirrors purchasing-service's PoApprovalService/ApprovalLimitExceededException 1:1)"

# Metrics
duration: ~30min
completed: 2026-07-12
---

# Phase 10 Plan 05: OPA-Gated Expense Approval Summary

**Minimal Expense entity + finance-service's first OPA/authorization-service Feign client, closing FIN-05's "expense approvals respect OPA approval limits" gap with RBAC + OPA double-gated approval and idempotent balanced JE auto-post.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-12
- **Tasks:** 3/3
- **Files modified:** 12 (11 created, 1 modified)

## Accomplishments
- `expenses` table (V5 migration) with RLS (`NULLIF(current_setting(...),'')::UUID` pattern from V4) and explicit `finance_user` grants
- `finance.feign.AuthorizationClient` — finance-service's first call path to authorization-service's OPA gateway, copied verbatim from `purchasing-service` per the plan's explicit instruction (shared-lib's `OpaClient` bean is `@ConditionalOnProperty("restaurantos.opa.url")`, which finance-service does not set)
- `ExpenseService.approve()`: RBAC gate (`finance.expense.approve` authority, enforced by `@PreAuthorize` in `ExpenseController`) + OPA approval-limit gate (fail-closed on null response body) — deny throws `ExpenseApprovalLimitExceededException` → 403 `EXPENSE_APPROVAL_LIMIT_EXCEEDED`; allow → `APPROVED` + a balanced JE (DR expense account / CR `1110` bank) auto-posted via the already-idempotent `JournalEntryService.autoPostInternal` (`sourceType=EXPENSE`)
- `ExpenseService.reject()`: mandatory non-blank reason → `REJECTED`, no JE
- `ExpenseController`: `POST /api/v1/finance/expenses`, `/{id}/approve`, `/{id}/reject`, `GET /{id}` under `FEATURE_FINANCE`
- `ExpenseApprovalIT` covering all four required scenarios (approve within limit, OPA deny, idempotent double-approve, reject reason validation)
- `grep -rn "finance.expense.approve" services/finance-service/src/main/java/` now returns real consumers — the auth-service permission seeded with zero consumers finally has one

## Task Commits

Each task was committed atomically:

1. **Task 1: V5 migration + Expense entity/repository + finance AuthorizationClient** - `78316f9` (feat)
2. **Task 2: ExpenseService (OPA-gated approve + JE auto-post) + ExpenseController** - `7df056a` (feat)
3. **Task 3: ExpenseApprovalIT** - `e504550` (test)

_No plan-metadata commit yet — see "Next Phase Readiness" for the pending STATE.md/docs commit produced right after this SUMMARY._

## Files Created/Modified
- `services/finance-service/src/main/resources/db/migration/V5__expenses.sql` - expenses table + RLS + finance_user grants
- `services/finance-service/src/main/java/io/restaurantos/finance/domain/model/Expense.java` - entity extending TenantAuditableEntity
- `services/finance-service/src/main/java/io/restaurantos/finance/domain/enums/ExpenseStatus.java` - PENDING_APPROVAL/APPROVED/REJECTED
- `services/finance-service/src/main/java/io/restaurantos/finance/repository/ExpenseRepository.java` - plain JpaRepository
- `services/finance-service/src/main/java/io/restaurantos/finance/dto/CreateExpenseRequest.java`, `ExpenseDto.java` - request/response DTOs
- `services/finance-service/src/main/java/io/restaurantos/finance/feign/AuthorizationClient.java` - OPA authorize Feign client (mirrors purchasing-service's)
- `services/finance-service/src/main/java/io/restaurantos/finance/exception/ExpenseApprovalLimitExceededException.java` - OPA-deny exception
- `services/finance-service/src/main/java/io/restaurantos/finance/exception/FinanceGlobalExceptionHandler.java` - added 403 EXPENSE_APPROVAL_LIMIT_EXCEEDED handler
- `services/finance-service/src/main/java/io/restaurantos/finance/service/ExpenseService.java` - create/approve/reject with OPA gate + JE auto-post
- `services/finance-service/src/main/java/io/restaurantos/finance/web/ExpenseController.java` - REST endpoints
- `services/finance-service/src/test/java/io/restaurantos/finance/ExpenseApprovalIT.java` - integration test proving the OPA gate

## Decisions Made
- Reused `finance.journal.post` for the create-expense `@PreAuthorize` authority (no `finance.expense.create` permission exists in `030-create-roles-permissions.xml`; plan explicitly forbade inventing one)
- Expense not-found / invalid-status-transition guards throw `IllegalStateException` (already mapped to 400 `INVALID_OPERATION` by the existing generic handler) instead of introducing a new not-found exception type, keeping the change surface to exactly the files listed in the plan
- Test seeds `TenantContext` with an explicit `branchId` (not just `tenantId` via the tenantId-only `InternalTenantContextHelper.activate` some other finance ITs use), because `JournalEntryServiceImpl.requireBranchId()` requires a non-null branch in `TenantContext` before it will create the auto-posted JE — production traffic gets this from the JWT via `TenantFilterInterceptor`/`TenantAwareDataSource`, but a direct service-layer IT has to set it explicitly

## Deviations from Plan

None — plan executed exactly as written. All facts in `<critical_codebase_facts>` (Feign-not-shared-lib OPA, autoPostInternal's existing idempotency, V4's RLS GUC pattern, FinanceGlobalExceptionHandler's explicit-handler-only style) held up against the live source and were followed as specified.

## Issues Encountered

**Docker/Testcontainers unavailable in this execution sandbox.** `mvn -pl services/finance-service -Dtest=ExpenseApprovalIT test` could not be run: no `docker`/`colima`/`podman` binary on `PATH`, and `/var/run/docker.sock` is a symlink to a target that doesn't exist (Docker Desktop installed but not running/reachable from this sandbox). This blocks the plan's own verification step (`mvn ... failsafe:integration-test failsafe:verify`) for **all** finance ITs, not just this plan's new one — it is an environment limitation, not something introduced by this plan.

What WAS verified instead:
- `mvn -pl services/finance-service test-compile` — passes (Task 1, Task 2, Task 3 all individually, and the full module together with 10-03's parallel changes merged in)
- `mvn -pl services/finance-service -Dtest=JournalEntryServiceUnitTest,PeriodCloseServiceUnitTest test` — the two finance unit tests that don't require Testcontainers both pass, confirming no regression to `JournalEntryServiceImpl`/`PeriodCloseService` compilation or behavior visible without a database
- `grep -rn "finance.expense.approve" services/finance-service/src/main/java/` — returns real `@PreAuthorize` + OPA-call consumers (both required by verification)
- Manual code-path review of `ExpenseService.approve()`/`reject()` against `PoApprovalService`'s equivalent (same fail-closed-on-null-body shape) and against `JournalEntryServiceImpl.autoPostInternal`'s dedup lookup

**What could NOT be executed/confirmed in this environment:**
- `ExpenseApprovalIT` itself (all 4 test methods) — cannot run without Postgres via Testcontainers
- The plan's full verification line: `mvn -pl services/finance-service test-compile failsafe:integration-test failsafe:verify — all finance ITs green including ExpenseApprovalIT; AccountingPeriodIT / InternalAutoPostIT / JournalEntry* unregressed`
- "Approving an expense over the user's OPA limit returns 403 EXPENSE_APPROVAL_LIMIT_EXCEEDED and posts no JE" as a live, executed assertion (only proven at the source-code/compile level, not runtime)

**Recommendation:** re-run `mvn -pl services/finance-service test-compile failsafe:integration-test failsafe:verify` on a machine/CI runner with a working Docker daemon before considering this plan's success criteria fully closed.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness
- FIN-05 is now code-complete: AP aging (10-02) + OPA-limited expense approval (this plan). ROADMAP Phase 10 SC#4's second clause ("expense approvals respect OPA approval limits") is implemented and unit/compile-verified; **integration-level proof is still pending** a Docker-capable environment (see Issues Encountered).
- No frontend was added for expenses, matching the plan's explicit scope decision (FIN-05's requirement text is API-level; no expense UI in the Phase 10 roadmap or §8.4 route list).
- Ran fully in parallel with plan 10-03 (purchasing-service + frontend) without touching any file outside `services/finance-service/**`; `git diff 9709dae -- services/finance-service` shows only this plan's 12 files plus the two pre-existing unrelated modifications (`PurchasingInternalClient.java`, `JournalLineRepository.java`) that were already in the working tree before this plan started and were left untouched.
- Follow-up for whoever verifies with Docker available: also re-run `AccountingPeriodIT`, `InternalAutoPostIT`, and the `JournalEntry*` test family to confirm no regression from the new V5 migration or the new `@ExceptionHandler`.

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-12*
