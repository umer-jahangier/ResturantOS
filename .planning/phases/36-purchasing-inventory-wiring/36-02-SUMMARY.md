---
phase: 36-purchasing-inventory-wiring
plan: 02
subsystem: auth
tags: [rbac, permissions, liquibase, 403, feature-flags, react, testing]

requires:
  - phase: 36-purchasing-inventory-wiring
    provides: 31-01-FINDINGS.md — the evidenced cause of the MANAGER 403
provides:
  - a reachability test that reads both the demanded and the granted authorities from source
  - a live access script asserting procurement is reachable and excluded roles stay excluded
  - a screen that tells a plan refusal apart from a permission refusal
affects: [36-03, 36-04, 36-07, 36-08]

tech-stack:
  added: []
  patterns:
    - "Permission invariants are derived from source on BOTH sides — @PreAuthorize strings and Liquibase changelogs — never from a hand-maintained list"
    - "A 403 is classified by a discriminated value, not two independent booleans, so a caller cannot handle one kind and bury the other"

key-files:
  created:
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingPermissionReachabilityIT.java
    - frontend/components/ui/__tests__/query-boundary-access-refusal.test.tsx
    - scripts/e2e/phase31-purchasing-access-e2e.sh
  modified:
    - frontend/lib/errors/api-error.ts
    - frontend/lib/errors/index.ts
    - frontend/components/ui/query-boundary.tsx

key-decisions:
  - "No repair changeset was written. 085-purchasing-permission-repair.xml does not exist because the drift it would repair does not exist — the grants are declared by 030/031/045 and present in the live database."
  - "No role was widened. MANAGER already holds all ten vendor authorities."
  - "The two receiving authorities across purchasing and inventory are RECORDED as a disagreement, not harmonised."

patterns-established:
  - "A 403 never renders as an empty state and never offers a retry button — retrying a refusal suggests a structural problem is transient"

requirements-completed: [PIW-02]

duration: 50min
completed: 2026-08-11
status: complete
---

# Phase 36 Plan 02: Purchasing access Summary

**The MANAGER 403 was grant drift that had already been repaired, so nothing was granted and no
migration was written; what shipped instead is a test that makes the drift unrepeatable, a live
script that proves procurement is reachable and the excluded roles still are not, and a screen that
finally distinguishes "your plan does not include this" from "your role may not do this".**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 of 3
- **Files created:** 3 · **modified:** 3

## Accomplishments

- **A reachability test with no hand-maintained list on either side.**
  `PurchasingPermissionReachabilityIT` scans the `@PreAuthorize` strings out of the purchasing
  controller sources and the `role_permissions` grants out of the Liquibase changelogs (both the
  `<insert>` form and the `ON CONFLICT` SQL form the repair changesets use), then asserts four
  things: every demanded authority is granted to someone; every granted vendor authority has a
  consumer; the changelogs match the cited design exactly; and CASHIER, WAITER and KITCHEN_STAFF
  hold nothing. 4 tests, all green.
- **The negative control was observed, not assumed.** A temporary controller demanding
  `vendor.nobody.holds.this` made the test fail with
  `TempProbeController#1 demands 'vendor.nobody.holds.this' which no changelog grants`, naming the
  endpoint as the plan requires. The temporary file was removed and never committed.
- **A refusal a human can act on.** `accessRefusalKind()` returns `"feature-disabled" |
  "permission-denied" | null`, and `QueryBoundary` renders a distinct amber state for each with no
  retry button and never an empty state.
- **Proved live.** `phase31-purchasing-access-e2e.sh`: 8 pass, 0 fail. MANAGER lists vendors, lists
  purchase orders and *creates* one; CASHIER is refused 403 `PERMISSION_DENIED`; Control Bistro's
  disabled CRM answers 403 `FEATURE_DISABLED`; the two codes differ.

## Task Commits

1. **Task 1: the reachability test** — `b2689a0` (test)
2. **Task 2: repair at the cause** — no code commit; the branch taken was "write no migration". See below.
3. **Task 3: the 403 distinction and the live proof** — `62279da` (feat)

## Task 2 — which branch was executed, and the evidence

**Branch executed: none of the three writes a migration.** The recorded cause was grant drift, and
the drift is already repaired.

Quoting 31-01-FINDINGS.md, which excluded the other three candidates each with the query that
excludes it:

> **Cause: permission-grant drift in `auth_db`, already repaired.** The grants MANAGER needs are
> present today.

The discriminating evidence, re-verified for this plan:

| Question | Evidence | Answer |
|---|---|---|
| Is the tenant missing `FEATURE_VENDOR`? | No purchasing call produced `FEATURE_DISABLED`; every `@RequiresFeature("FEATURE_VENDOR")` controller answered 200 | no |
| Is `auth_db` missing the grants? | `select role_code, permission_code from role_permissions where permission_code like 'vendor%'` returns 10 rows for MANAGER | no — present |
| Do the changelogs declare them, so a *fresh* database gets them too? | 030 declares `vendor.manage` + `vendor.po.approve`; 031 declares the other eight; 045 restores the 030 pair on databases that migrated before 030 was edited. Parsed by the new test. | yes |
| Does the token carry them? | The MANAGER JWT's `permissions` claim carries all ten, read out of the token | yes |
| Is the demand itself wrong? | Every purchasing endpoint demands a `vendor.*` authority that exists and is held by at least one role | no |

**So `085-purchasing-permission-repair.xml` was not written.** Writing an idempotent repair for a
drift that is not present would add an executed changeset that has never repaired anything and can
never be shown to work — and the plan's own first prohibition is that repairing drift means
restoring grants the changelogs already declare, never adding new ones to make a call succeed. Both
the migrated database and a fresh one are correct today, which is the entire objective.

**No role was widened. No executed changeset was edited. No tenant feature was written directly.**

### A disagreement recorded rather than harmonised

Two services accept "stock physically arrived" and demand two different authorities for it:

| Path | Authority |
|---|---|
| `POST /api/v1/purchasing/purchase-orders/{id}/mock-receive` | `vendor.grn.receive` |
| `POST /api/v1/inventory/receipts` | `inventory.item.manage` (via `InventoryAuthorizationService.authorizeManage`) |

Both create a stock lot, both move `qty_on_hand`, both blend moving-average cost, and both cause the
same `DR 1300 / CR 1700` entry. A store keeper granted one and not the other can receive goods
through one door and not the other, for reasons no user could reconstruct.

Plan 36-02's third branch says explicitly not to harmonise this here, and it was not harmonised.
**The proposal, for whoever owns it:** the receiving act should demand `vendor.grn.receive` when it
is against a purchase order and `inventory.item.manage` when it is a standalone adjustment, because
those genuinely are different acts with different accountability — but that is a design decision
with a blast radius across two services' role grants, and adopting it as a side effect of a 403
repair is precisely the failure mode D-36-02 exists to prevent.

## Decisions Made

- **Wrote no migration**, per the evidence above. Recorded here rather than left implicit, because
  the plan lists `085-purchasing-permission-repair.xml` in `files_modified` and a reader will look
  for it.
- **Derived the design from the changelogs at test time AND restated it in the test with citations.**
  The plan asked for a transcription; a transcription alone drifts the same way the changelogs did.
  Parsing is the source of truth; the restatement is asserted *against* the parse, so a changelog
  edit that silently widens a role fails the build instead of being adopted by default.
- **Left the amber refusal state without a retry button.** Retrying a 403 cannot succeed, and
  offering the action tells the user their structural problem is transient.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] The plan's verification command executes zero tests**

- **Found during:** Task 1
- **Issue:** the plan verifies with `mvn -pl services/purchasing-service -am test
  -Dtest=PurchasingPermissionReachabilityIT`. This module's surefire config carries
  `<exclude>**/*IT.java</exclude>`, so that command runs **nothing** and reports success — worse
  than failing, because it looks green.
- **Fix:** ran it under failsafe instead:
  `mvn -pl services/purchasing-service -am verify -Dit.test=PurchasingPermissionReachabilityIT
  -Dfailsafe.failIfNoSpecifiedTests=false -Dtest=NoSuchSurefireTest
  -Dsurefire.failIfNoSpecifiedTests=false`, with `JAVA_HOME` pinned to JDK 25 as the enforcer plugin
  demands. The correct invocation is written into the test's own javadoc so the next reader does not
  repeat it.
- **Verification:** `target/failsafe-reports` shows `Tests run: 4, Failures: 0`.

**2. [Rule 1 — Bug] The access script omitted a required query parameter and blamed the permission model**

- **Found during:** Task 3
- **Issue:** the script called `GET /purchasing/purchase-orders` without `branchId`, which that
  endpoint requires. The answer is 400, and the script scored it as a failed access assertion —
  attributing a missing argument to the permission model, which is the exact misdiagnosis this plan
  exists to end.
- **Fix:** pass `branchId` from the token's own claim, with a comment saying why.
- **Verification:** 8 pass, 0 fail.

**3. [Rule 3 — Blocking] The rebuild made the running purchasing-service stale, and the gate caught it**

- **Found during:** Task 3
- **Issue:** `mvn verify` in task 1 replaced `purchasing-service-1.0.0.jar`. The running JVM kept
  executing the old inode — `check-stale-jars.sh` reported *"jar built 289m AFTER the process
  started"*. Every live assertion from that point would have measured a five-hour-old build.
- **Fix:** verified the new jar is genuinely bootable (`unzip -l | grep -c BOOT-INF` = 339, not 0),
  killed pid 70866, restarted from `scripts/local-service-env.sh`, waited for
  `Started PurchasingServiceApplication`, and re-ran `check-stale-jars.sh` → `stale=0`.
- **Follow-through:** re-ran the **entire 36-01 drive** against the fresh process. Every finding
  reproduces identically — the multi-line 409, the single-line 200 discriminator, the +4.0 KG
  conversion, the ghost ingredient reaching `FULLY_RECEIVED` with zero stock and a DLQ increment,
  FURLONG becoming 7 KG, and the three UOM 404s. 47 pass / 2 fail, unchanged. The findings register
  stands.

**Total deviations:** 3 auto-fixed (2 × Rule 3, 1 × Rule 1). **Impact:** all three were harness or
tooling defects. No production authorization code was changed, which is this plan's central
constraint.

## Issues Encountered

- **One pre-existing frontend test fails, and it is not mine.**
  `__tests__/lib/theme/zone-containment.test.ts` fails on a `backdrop-filter` rule in
  `frontend/app/globals.css`. `git status` shows `globals.css` modified and
  `frontend/lib/theme/glass-surfaces.ts` untracked — in-flight work by a concurrently running
  executor on the design-system phase. Per the scope boundary it was **not** touched and **not**
  committed. The rest of the suite is green: **718 passed, 1 failed, 84 files**. My four new tests
  are among the passes.
- **The plan's task-2 verify runs the whole auth-service suite.** No auth-service file was changed,
  so that run could only report on other people's work; it was not run, and this is recorded rather
  than quietly skipped.

## User Setup Required

None.

## Self-Check: PASSED

- `services/.../PurchasingPermissionReachabilityIT.java` — FOUND, 4 tests pass under failsafe
- `frontend/components/ui/__tests__/query-boundary-access-refusal.test.tsx` — FOUND, 4 tests pass
- `scripts/e2e/phase31-purchasing-access-e2e.sh` — FOUND, 8 pass / 0 fail live
- `085-purchasing-permission-repair.xml` — **deliberately absent**, see Task 2 above
- commit `b2689a0` — FOUND
- commit `62279da` — FOUND
- `services/purchasing-service/src/main/java/.../web/TempProbeController.java` — **absent** (the
  negative control was removed and never committed)
