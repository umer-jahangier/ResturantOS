---
phase: 10-purchasing-accounts-payable
plan: 07
subsystem: authorization
tags: [opa, rego, authorization-service, purchasing, finance, feign, spring-boot]

# Dependency graph
requires:
  - phase: 10-05
    provides: "purchasing-service and finance-service Feign AuthorizationClient calling authorization-service /internal/authorize (decision 10-05-A)"
  - phase: 10-04
    provides: "PO short-close reason-mandated state transition semantics (decision 10-04-A)"
provides:
  - "Canonical OPA action vocabulary (rego short verbs) used consistently by every real OPA call site in purchasing-service and finance-service"
  - "vendor.rego approve_po rule enforces amount_paisa <= approval_limit_paisa (fail-closed on missing attribute)"
  - "vendor.rego close_po rule (previously nonexistent)"
  - "Distinct-approver constraint on multi-tier PO approval (DuplicateApproverException, 409)"
  - "kds.rego view rule action guard (unrelated pre-existing bug fixed to unblock the 100% opa test gate)"
affects: [10-08, 10-09]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "OPA_ACTION_* private static final String constants at each call site, with a comment pointing at the owning rego rule — makes the action-string <-> rego-rule seam greppable from both sides"
    - "Rego action vocabulary is always the short verb (approve_po, close_po, approve); the dotted permission code (vendor.po.approve, etc.) is a distinct concept checked inside the policy via common.has_permission and used for @PreAuthorize/RBAC"

key-files:
  created:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/exception/DuplicateApproverException.java
  modified:
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PoApprovalService.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PurchaseOrderService.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/repository/PoApprovalRecordRepository.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/ExpenseService.java
    - policies/restaurantos/vendor.rego
    - policies/restaurantos/kds.rego
    - policies/tests/vendor_test.rego
    - policies/tests/finance_test.rego
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchaseOrderApprovalIT.java

key-decisions:
  - "10-07-A: canonical OPA action vocabulary is the rego short verb (approve_po, close_po, approve), not the dotted permission code. The dotted string (vendor.po.approve, vendor.po.close, finance.expense.approve) remains the permission code checked via common.has_permission and used in @PreAuthorize — a clean action-vs-permission split. Rationale: 5 rego modules + test suites already use short verbs; changing 3 Java call sites is lower blast radius than rewriting rego."

patterns-established:
  - "A short-close (PO close_po) is a reason-mandated state transition, not a spend decision — no amount comparison in rego for it (reaffirms 10-04-A)."

# Metrics
duration: 25min
completed: 2026-07-13
---

# Phase 10 Plan 07: OPA Action-String Mismatch + vendor.rego Hardening Summary

**Fixed the root blocker making every real PO approval, PO close, and expense approval return OPA DENY — purchasing-service/finance-service now send the rego short-verb action vocabulary (`approve_po`, `close_po`, `approve`) instead of dotted permission codes; `vendor.rego` gained an approval-limit comparison and the previously-nonexistent `close_po` rule; and a 2-tier PO can no longer be approved twice by the same user.**

## Canonical action vocabulary (read this before writing plan 10-08's real-OPA ITs)

| Call site | OPA `action` sent | rego module | rego rule |
|---|---|---|---|
| `PoApprovalService.assertOpaAllows` | `"approve_po"` | `restaurantos.vendor` | `allow if input.action == "approve_po"` (now includes `amount_paisa <= approval_limit_paisa`) |
| `PurchaseOrderService.assertOpaAllowsClose` | `"close_po"` | `restaurantos.vendor` | `allow if input.action == "close_po"` (new rule, no amount check) |
| `ExpenseService.assertOpaAllows` | `"approve"` | `restaurantos.finance` | `allow if input.action == "approve"` (pre-existing rule, unchanged) |

The dotted permission codes (`vendor.po.approve`, `vendor.po.close`, `finance.expense.approve`) were **not** renamed — they remain what `common.has_permission` checks inside each rego rule and what `@PreAuthorize`/auth-service permission seeds use. Plan 10-08's real-OPA integration tests should assert `allow=true`/`false` against these exact action strings.

## Performance

- **Duration:** ~25 min (git commit span; excludes brew-install-opa wait)
- **Started:** 2026-07-13T02:34Z (approx, first task commit)
- **Completed:** 2026-07-13T02:45Z (last task commit)
- **Tasks:** 3/3
- **Files modified:** 10 (9 modified/tracked + 1 new)

## Accomplishments
- Every real OPA call in purchasing-service and finance-service now sends an action string a rego rule actually matches — PO approval, PO short-close, and expense approval are no longer silently DENYed in production.
- `vendor.rego`'s `approve_po` rule now enforces `amount_paisa <= approval_limit_paisa`, fail-closed when the attribute is missing (mirrors `finance.rego`).
- `vendor.rego` gained a `close_po` rule — it previously had none, so `PurchaseOrderService.close`'s short-close path was denied by `default allow := false` regardless of action string.
- A 2-tier PO can no longer be approved twice by the same user (`DuplicateApproverException`, HTTP 409 `DUPLICATE_APPROVER`).
- `opa test policies/` is 100% green (92/92 tests, 100% coverage) — found and fixed two pre-existing, unrelated coverage/correctness gaps blocking that CI gate (see Deviations).

## Task Commits

1. **Task 1: Adopt the rego short-verb action vocabulary in the three calling services** - `ac63925` (fix)
2. **Task 2: Harden vendor.rego — approval-limit comparison + close_po rule — with rego tests** - `4e7b061` (fix, includes a kds.rego bugfix and finance_test.rego coverage additions as deviations)
3. **Task 3: Enforce distinct approvers per tier in PoApprovalService** - `625b1fd` (feat)

_No separate metadata commit created yet — this SUMMARY + STATE.md update will be committed together after this document is written._

## Files Created/Modified
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PoApprovalService.java` - `OPA_ACTION_APPROVE_PO = "approve_po"` constant; distinct-approver check before recording a new tier approval
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/PurchaseOrderService.java` - `OPA_ACTION_CLOSE_PO = "close_po"` constant used in `assertOpaAllowsClose`
- `services/finance-service/src/main/java/io/restaurantos/finance/service/ExpenseService.java` - `OPA_ACTION_APPROVE = "approve"` constant
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/repository/PoApprovalRecordRepository.java` - `existsByPurchaseOrderIdAndApproverIdAndAction`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/exception/DuplicateApproverException.java` - new, `@ResponseStatus(CONFLICT)`, message `DUPLICATE_APPROVER`
- `policies/restaurantos/vendor.rego` - `approve_po` gained the amount/limit clause; new `close_po` rule
- `policies/restaurantos/kds.rego` - added missing `input.action == "pos.kds.view"` guard on the view rule (pre-existing bug, see Deviations)
- `policies/tests/vendor_test.rego` - `base_user`/`base_resource` now carry `attributes`/`amount_paisa`; 6 new tests (within/over/missing-limit approve_po, close_po allow/missing-permission/cross-tenant)
- `policies/tests/finance_test.rego` - added `manage_coa` and `view_journal` allow/deny tests (pre-existing coverage gap, see Deviations)
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchaseOrderApprovalIT.java` - 2 new tests: same-approver-twice → `DuplicateApproverException`; distinct approvers → `APPROVED`/`tiersApproved==2`

## Decisions Made
- **10-07-A** (recorded above): canonical OPA action vocabulary is the rego short verb; dotted strings stay as permission codes. See table above for the exact mapping plan 10-08 should assert against.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `kds.rego`'s view rule was missing an `input.action` guard**
- **Found during:** Task 2 verification (`opa test policies/ -v` run to confirm the new vendor tests)
- **Issue:** `policies/restaurantos/kds.rego`'s first `allow` rule granted `pos.kds.view`-only users ANY action (not just `pos.kds.view`) because it never checked `input.action`, contradicting `test_manager_denied_update` (a MANAGER with only `pos.kds.view` should be denied `pos.kds.update`). This is a real authorization bug — unrelated to this plan's OPA action-string mismatch — in the Phase-5 kitchen/KDS module, not touched by any wave-1 sibling plan. It pre-dates this session (confirmed failing at base commit `964446c` via a throwaway `git worktree`).
- **Fix:** Added `input.action == "pos.kds.view"` to the view rule's conjunction.
- **Files modified:** `policies/restaurantos/kds.rego`
- **Verification:** `opa test policies/ -v` — `test_manager_denied_update` now passes; all other kds tests unaffected.
- **Committed in:** `4e7b061` (part of Task 2 commit)

**2. [Rule 3 - Blocking] `finance.rego`'s `manage_coa` and `view_journal` rules had zero test coverage**
- **Found during:** Task 2 verification (`opa test policies/ --coverage` reported 98.88%, not the required 100%)
- **Issue:** `policies/tests/finance_test.rego` never exercised the `manage_coa` or `view_journal` `allow` rules, leaving those lines uncovered and blocking the plan's own required `opa test policies/` 100%-coverage gate. Pre-existing gap, unrelated to the action-string mismatch, but `finance_test.rego` is in this plan's declared `files_modified` list.
- **Fix:** Added `test_manage_coa_allow`, `test_manage_coa_missing_permission_deny`, `test_view_journal_allow`, `test_view_journal_cross_branch_deny`.
- **Files modified:** `policies/tests/finance_test.rego`
- **Verification:** `opa test policies/ --coverage --format=json` → `coverage: 100`.
- **Committed in:** `4e7b061` (part of Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking/coverage-gate)
**Impact on plan:** Both were necessary to satisfy this plan's own verification requirement (`opa test policies/ -v` green at 100% coverage). Neither touches purchasing/finance/vendor domain logic; no scope creep into sibling wave-1 plans' files.

## Issues Encountered
- `opa` CLI was not installed locally; installed via `brew install opa` (1.18.2, close to CI's pinned 1.17.0) to run `opa test`/`opa eval` for real verification rather than trusting the edit alone.
- Discovered (but did **not** fix, out of scope) a pre-existing, unrelated finance-service test failure: `JournalEntryImmutabilityIT`, `JournalEntryBalanceTriggerIT`, and `InternalAutoPostIT` all fail with `IllegalStateException: Branch context required` in `JournalEntryServiceImpl.create`. Confirmed via a throwaway `git worktree` at base commit `964446c` that this failure pre-dates this session and is unrelated to `ExpenseService`/`OPA_ACTION_APPROVE` (this plan's `ExpenseApprovalIT`, which exercises the same `autoPostInternal` code path via a properly-branch-scoped `tenantContext`, passes cleanly at 4/4). This is a gap in a different area of finance-service (branch-context propagation into JE auto-post from certain test setups) and should be tracked as its own gap-closure item, not folded into 10-07.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 10-08 can now write real-OPA (non-mocked `AuthorizationClient`) integration tests asserting `allow=true`/`false` against the canonical action strings documented in the table above — `opa test policies/` is green at 100% coverage as a precondition.
- Plan 10-09 (adds `@PreAuthorize` to purchasing controllers) is unaffected — permission codes (`vendor.po.approve`, `vendor.po.close`) were not renamed.
- **Blocker for a future gap-closure plan (not 10-08/10-09):** `JournalEntryImmutabilityIT`, `JournalEntryBalanceTriggerIT`, `InternalAutoPostIT` in finance-service fail with `Branch context required` — pre-existing, unrelated to this plan, needs its own investigation (see Issues Encountered).

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
