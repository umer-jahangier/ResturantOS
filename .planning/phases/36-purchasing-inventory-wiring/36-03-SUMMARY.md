---
phase: 36-purchasing-inventory-wiring
plan: 03
subsystem: ui
tags: [rbac, opa, rego, money, paisa, react, approval-limit]

requires:
  - phase: 36-purchasing-inventory-wiring
    provides: 31-01-FINDINGS.md — limits present but written by a script, not the product
provides:
  - policies/tests/approval_gated_actions_test.rego — the fail-closed reading and the amount-gated set, pinned
  - an approval-limit field that keeps money as integer paisa and distinguishes "no authority" from "zero"
  - the limit set on the branch-role assignment the policy engine actually reads
  - a live script proving the gate in four cases
affects: [36-07, 36-08]

tech-stack:
  added: []
  patterns:
    - "Rupees→paisa conversion by string, never Math.round(x*100)"
    - "Which roles need an approval limit is derived from the role's own permission list, never from role codes"
    - "A bulk operation is a loop over the single-item endpoint, so the ceiling check cannot be bypassed by a second write path"

key-files:
  created:
    - policies/tests/approval_gated_actions_test.rego
    - frontend/components/users/approval-limit-field.tsx
    - frontend/components/users/__tests__/approval-limit-field.test.tsx
    - scripts/e2e/phase31-approval-limit-e2e.sh
  modified:
    - frontend/lib/models/user.model.ts
    - frontend/lib/api-client/schemas/user.schema.ts
    - frontend/lib/repositories/user.repository.ts
    - frontend/lib/hooks/use-users.ts
    - frontend/components/users/assign-role-dialog.tsx
    - frontend/components/users/user-detail-panel.tsx
    - scripts/e2e/_phase31-lib.sh

key-decisions:
  - "An absent limit and a limit of zero are different states in the interface even though the policies deny identically."
  - "A role change resets the limit decision rather than carrying it forward."
  - "No bulk endpoint — the bulk apply is a loop over the single-assignment call."

patterns-established:
  - "A screen that changes a token-resolved attribute says when it takes effect, rather than leaving the user to conclude the feature is broken"

requirements-completed: [PIW-03]

duration: 55min
completed: 2026-08-11
status: complete
---

# Phase 36 Plan 03: Approval limits Summary

**An owner now sets a user's approval limit on the branch-role assignment the policy engine actually
reads, from inside the product; the limit is proven live to refuse when absent, allow at a
sufficient amount, refuse by name when insufficient, and to leave an already-issued token carrying
the old value — exactly what the screen promises.**

## Performance

- **Duration:** ~55 min · **Tasks:** 3 of 3 · **Created:** 4 · **Modified:** 7
- **opa test policies:** 149/149 · **frontend:** 786/786 across 86 files · **typecheck + eslint:** clean
- **`phase31-approval-limit-e2e.sh`:** 18 pass / 0 fail

## Accomplishments

- **The fail-closed reading is pinned where it lives.** `approval_gated_actions_test.rego` asserts
  that an absent `approval_limit_paisa` denies at *any* amount **including zero** in all three
  modules. That behaviour was only implicit, and it is the entire reason a NULL column presented for
  months as a permission bug. The next person tempted to "helpfully" default an absent limit now
  breaks a test that explains why.
- **The boundary is asserted per module, not once.** `vendor.rego` and `finance.rego` write
  `amount <= limit`; `pos.rego` writes `limit >= amount`. An inverted comparison in one of them is
  invisible to a reader and catastrophic in production, so equality-allows and one-paisa-over-denies
  are asserted three times.
- **The amount-gated set is proven by construction, not transcribed.** For each of
  `vendor.po.approve`, `finance.expense.approve`, `pos.order.refund`, a principal *with* a
  sufficient limit is allowed and the *same* principal without the attribute is denied — that
  difference is the definition of "amount-gated". And `close_po` and `pos.order.discount.override`
  are asserted *not* to be, so an amount gate added to either fails here.
- **Money never becomes a float.** `parseRupeesToPaisa` splits the string on the decimal point;
  `19.99 * 100` is `1998.9999999999998` in IEEE 754, and "it worked for the values I tried" is
  precisely how this project shipped a 1000×-wrong COGS. The test asserts every produced value is an
  integer, and the request schema is parsed on the way *out* with `z.number().int()` so a float
  cannot reach the wire.
- **"No approval authority" is not "a limit of zero".** The policies refuse every positive amount
  for both; a person means different things by them, and an interface that conflates them lets
  someone believe they granted an authority they did not. The field offers both, and states the
  identity in its help text rather than hiding it.
- **Which roles need a limit comes from permissions, never role codes.** A tenant's custom role
  holding `vendor.po.approve` gets the field exactly as the built-in MANAGER does.
- **A role change resets the limit decision.** The server writes the limit from the request
  unconditionally, so a stale value carried forward is a demoted user keeping spending authority
  nobody re-examined.

## The live proof

```
--- CASE 1: the subject holds vendor.po.approve with NO approval limit ---
PASS: owner clears the limit through the product's own endpoint (200)
PASS: a fresh token carries NO approval_limit_paisa attribute (ABSENT)
      approve -> HTTP 403 APPROVAL_LIMIT_EXCEEDED
PASS: approval with no limit is REFUSED (got 403, not 200)
PASS: no limit: the order is still PENDING_APPROVAL
PASS: no limit: no approval record was written (0)

--- CASE 2: owner sets a limit ABOVE the order total ---
      db: user_branch_roles.approval_limit_paisa = 10000000
PASS: the token minted BEFORE the change still carries the old limit — the screen says so, and it is true (ABSENT)
PASS: a fresh token carries the new limit (10000000)
PASS: the SAME order now approves, with a sufficient limit (200)
PASS: the order advanced to APPROVED
PASS: exactly one approval record was written (1)

--- CASE 3: owner sets a limit BELOW the next order's total ---
      approve -> HTTP 403 APPROVAL_LIMIT_EXCEEDED
      body: {"error":{"code":"APPROVAL_LIMIT_EXCEEDED","message":"This purchase order exceeds your approval limit",...}}
PASS: the refusal names the LIMIT, not a generic permission failure
PASS: insufficient limit: the order is still PENDING_APPROVAL
PASS: insufficient limit: no approval record was written (0)
----------------------------------------
PASS: 18   FAIL: 0
```

The stale-token assertion is the one worth dwelling on. The assign dialog tells the user *"It
applies the next time that user signs in or their session refreshes."* That sentence is now
**verified**: the token minted before the change still reports `ABSENT` after the database row holds
`10000000`. A promise a screen makes and nothing checks is a promise that quietly stops being true.

The script restores the seed's documented MANAGER limit (30,000,000 paisa) on the way out, because
it runs against a stack three other executors are using and a leftover reduced limit would look like
a regression to the next person.

## Task Commits

1. **Task 1: the policies name the amount-gated actions; the field derives them** — `69cf8e5` (feat)
2. **Tasks 2 and 3: set the limit where the role is assigned, prove the gate live** — `ea38626` (feat)

Tasks 2 and 3 share a commit: task 3's bulk action lives inside the same dialog task 2 rewrites, and
splitting them would have produced a commit whose dialog does not compile.

## Decisions Made

- **No bulk endpoint.** The apply-to-every-holder action is a sequence of calls through
  `UserRepository.assignBranchRole` — the same endpoint a single assignment uses. A second write
  path for one field is how two paths drift, and the role-ceiling check that stops an admin granting
  above their own level lives on the single-assignment path; a bulk endpoint would have to
  re-implement it or skip it.
- **Holders are discovered client-side.** The roster endpoint returns users without their
  assignments, so membership of "holds ROLE at BRANCH" is read per user. N+1 calls against a roster
  the server caps at 200, for an explicit and rare operator action. It is honest: it uses only
  endpoints that already exist rather than inventing a query the server cannot answer.
- **A refused holder is named, never dropped.** Reporting "limits applied" while some managers still
  cannot approve anything is the exact shape of "structurally present, behaviourally absent".
- **No session revocation on a limit change.** Forcing a sign-out is a policy decision with its own
  argument and a change to another team's session model. The screen says when the change lands
  instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] `auth_db` is FORCE row-level security and the harness never set its GUC**

- **Found during:** Task 3, reading back the written limit
- **Issue:** `_phase31-lib.sh` declared *"auth_db is not RLS-scoped by a tenant GUC — it is queried
  without one, deliberately"*. That is half true and dangerously so. `pg_class` shows
  `users`, `user_branch_roles`, `roles`, `refresh_sessions`, `password_history` and
  `password_reset_tokens` are all `rowsecurity=t, forced=t`; only `auth_tenants`, `permissions` and
  `role_permissions` are global. A read of `user_branch_roles` without the GUC returned **zero rows
  and no error** — indistinguishable from "that assignment does not exist", which is the most
  misleading possible answer to "did the write land?".
- **Fix:** `auth_sql` now takes the tenant id first like every other helper, with the split written
  into the library so the next caller cannot make the assumption by accident. The two global-catalogue
  call sites pass an explicit empty string.
- **Verification:** the read-back now prints `10000000`. The library self-test and the full 36-01
  drive both still pass.
- **Committed in:** `ea38626`

**2. [Rule 1 — Bug] The read-back named a column that does not exist**

- **Found during:** Task 3
- **Issue:** `user_branch_roles.active` — the column is `is_active`. Postgres said so with a hint;
  the script printed the error where evidence should have been.
- **Fix:** corrected.
- **Committed in:** `ea38626`

**3. [Rule 3 — Blocking] `PaginatedResult` has no `items`**

- **Found during:** Task 3
- **Issue:** the bulk-apply hook iterated `roster.items`; the shape is `{ data, meta }`. Caught by
  `tsc --noEmit`, not by a test.
- **Fix:** `roster.data`.
- **Committed in:** `ea38626`

**Total deviations:** 3 auto-fixed (2 × Rule 1, 1 × Rule 3). One of them — the `auth_db` RLS
assumption — invalidated a class of evidence rather than one line, and the library comment that
caused it has been replaced with the table of which tables are scoped.

## Issues Encountered

- **`finance-service` went stale mid-plan**, rebuilt by a concurrently running executor. It is not
  in this plan's path (no finance assertion is made here) and the approval-limit run completed
  before it happened, with the gate green. Recorded because the library self-test reports it and a
  reader of that output will see it.
- **The plan lists `frontend/lib/hooks/use-users.ts` under task 3 only.** The bulk-apply hook was
  added there, and the `useAssignableRoles` import needed by task 2's "does this role need a limit"
  decision came from the same file — so the file appears in both tasks' work and in one commit.

## User Setup Required

None.

## Self-Check: PASSED

- `policies/tests/approval_gated_actions_test.rego` — FOUND, `opa test policies` = 149/149
- `frontend/components/users/approval-limit-field.tsx` — FOUND
- `frontend/components/users/__tests__/approval-limit-field.test.tsx` — FOUND, 13 tests pass
- `scripts/e2e/phase31-approval-limit-e2e.sh` — FOUND, 18 pass / 0 fail live, exit 0
- `npx tsc --noEmit` — clean · `npx eslint` on every changed path — clean
- commit `69cf8e5` — FOUND · commit `ea38626` — FOUND
