---
phase: 07-point-of-sale-kitchen-display
plan: 07
subsystem: auth
tags: [liquibase, seed-data, rbac, bcrypt, auth-service, kds, pos]

# Dependency graph
requires:
  - phase: 07-point-of-sale-kitchen-display
    provides: pos.rego void.own design (plan 07-02), KITCHEN_STAFF/MANAGER role+permissions (plan 07-04), Order.cashierId linkage (plan 07-06)
provides:
  - CASHIER role granted pos.order.void.own permission
  - chef@demo.local (KITCHEN_STAFF) and manager@demo.local (MANAGER) demo/test users seeded with known dev credentials
affects: [07-UAT (Tests 4/7/10), pos-service void endpoint testing, kitchen-service role-isolation testing]

# Tech tracking
tech-stack:
  added: []
  patterns: [Liquibase append-only gap-closure changesets (never edit already-applied changesets, follow 042's precedent of new files)]

key-files:
  created:
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/043-cashier-void-own-permission.xml
    - services/auth-service/src/test/java/io/restaurantos/auth/KdsDemoUserSeedIT.java
  modified:
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/900-seed-auth-dev-data.xml
    - services/auth-service/src/test/java/io/restaurantos/auth/AuthInternalBranchRoleIT.java
    - services/auth-service/src/test/java/io/restaurantos/auth/integration/TestFixtures.java
    - user.md

key-decisions:
  - "New changeset 043 (not editing 030/041) grants CASHIER pos.order.void.own — permission code already existed, was only missing the CASHIER role grant."
  - "New changesets 902/903 appended to 900-seed-auth-dev-data.xml (not editing 900/901) seed chef@demo.local/manager@demo.local — both already-applied changesets left untouched."
  - "Bcrypt hashes for the two new demo users independently verified via BCryptPasswordEncoder.matches() using the runtime's actual spring-security-crypto jar before committing, rather than trusting the plan's supplied hashes blindly."

patterns-established:
  - "Gap-closure Liquibase changesets always append new files/changesets; never edit a changeset with runOnChange=false that has already run against dev/CI databases."

requirements-completed: [POS-04, KDS-01, KDS-02]

coverage:
  - id: D1
    description: "CASHIER role's resolved permissions (via GET /internal/auth/users/{id}/permissions) now include pos.order.void.own"
    requirement: "POS-04"
    verification:
      - kind: integration
        ref: "AuthInternalBranchRoleIT#getUserPermissions_forCashier_includesVoidOwn"
        status: pass
    human_judgment: false
  - id: D2
    description: "chef@demo.local (KITCHEN_STAFF) demo user seeded, resolves pos.kds.view+update only, no pos.order.*"
    requirement: "KDS-01"
    verification:
      - kind: integration
        ref: "KdsDemoUserSeedIT#chefUser_resolvesKitchenStaffPermissionsOnly"
        status: pass
    human_judgment: false
  - id: D3
    description: "manager@demo.local (MANAGER) demo user seeded, resolves pos.kds.view but not pos.kds.update"
    requirement: "KDS-02"
    verification:
      - kind: integration
        ref: "KdsDemoUserSeedIT#managerUser_resolvesKdsViewButNotUpdate"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-10
status: complete
---

# Phase 07 Plan 07: Auth Seed-Data Gap Closure (CASHIER void.own + KDS Demo Users) Summary

**Granted CASHIER the pre-existing pos.order.void.own permission and seeded chef@demo.local (KITCHEN_STAFF) / manager@demo.local (MANAGER) demo users with bcrypt-verified credentials, unblocking UAT Tests 4, 7, and 10.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-10T17:37:00Z
- **Completed:** 2026-07-10T17:48:00Z
- **Tasks:** 2
- **Files modified:** 7 (2 created, 5 modified)

## Accomplishments
- CASHIER role now has `pos.order.void.own` (proven at the auth-service API boundary, not just the seed table) — closes the root-cause half of UAT Test 7's 403-on-own-order-void gap (the other half, `Order.cashierId` population, was fixed by companion plan 07-06).
- `chef@demo.local` (KITCHEN_STAFF, password `Chef#2026`) and `manager@demo.local` (MANAGER, password `Manager#2026`) demo users now exist with Main Branch role grants, unblocking all Kitchen Display login-based testing (UAT Tests 4/10) and the reverse-direction role-isolation check.
- Both bcrypt password hashes independently verified against their plaintext passwords using the project's actual `spring-security-crypto` 7.0.6 jar (`BCryptPasswordEncoder.matches()`) before committing — not trusted blindly from the plan text.

## Task Commits

Each task was committed atomically:

1. **Task 1: Grant CASHIER pos.order.void.own via a new changeset** - `bba177c` (feat)
2. **Task 2: Seed chef@demo.local (KITCHEN_STAFF) and manager@demo.local (MANAGER) demo users** - `782bb58` (feat)

**Plan metadata:** (this commit, following SUMMARY)

## Files Created/Modified
- `services/auth-service/src/main/resources/db/changelog/v1.0.0/043-cashier-void-own-permission.xml` - New changeset granting CASHIER `pos.order.void.own`
- `services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml` - Registers 043 after 042
- `services/auth-service/src/test/java/io/restaurantos/auth/AuthInternalBranchRoleIT.java` - New `getUserPermissions_forCashier_includesVoidOwn` test
- `services/auth-service/src/main/resources/db/changelog/v1.0.0/900-seed-auth-dev-data.xml` - New changesets 902 (users) and 903 (branch roles) seeding chef@demo.local/manager@demo.local
- `services/auth-service/src/test/java/io/restaurantos/auth/integration/TestFixtures.java` - New `KITCHEN_STAFF_USER_ID`/`MANAGER_USER_ID`/email/password constants
- `services/auth-service/src/test/java/io/restaurantos/auth/KdsDemoUserSeedIT.java` - New IT proving both demo users' resolved permissions match their role's isolation contract
- `user.md` - Documents the two new dev credentials

## Decisions Made
- Followed the exact append-only precedent established by changeset 042 (new file, not editing already-applied 030/041) for the CASHIER grant, and the same precedent for 900-seed-auth-dev-data.xml (new changesets 902/903, not editing already-applied 900/901).
- Independently verified both new bcrypt password hashes via `BCryptPasswordEncoder.matches()` against the project's actual spring-security-crypto jar before seeding, rather than trusting the plan-supplied hashes on faith — both confirmed correct (`Chef#2026` / `Manager#2026`).

## Deviations from Plan

None - plan executed exactly as written. GitNexus MCP tools referenced in CLAUDE.md were not available in this execution session's toolset (no `mcp__gitnexus__*` tools present); this plan's work was purely additive (new Liquibase files + one new appended test method + two new test files), so Grep/Glob-based review of all precedent files (`030-create-roles-permissions.xml`, `041-pos-permissions.xml`, `042-kds-permissions-kitchen-role.xml`) substituted for impact analysis before writing any new code.

## Issues Encountered
- `mvn -Dtest=... verify` failed at the unrelated `spring-boot-maven-plugin:repackage` goal (Windows file-lock renaming `auth-service-1.0.0.jar`) — a pre-existing environment quirk unrelated to this change. Verified actual test results via `mvn -Dtest=... test` (skips repackage) and directly inspected `target/surefire-reports/*.txt`: all 9 relevant tests (7 in `AuthInternalBranchRoleIT`, 2 in `KdsDemoUserSeedIT`) passed with 0 failures/errors.
- `python3`/system `java`/`javac` were not directly runnable via PATH aliases on this Windows host; resolved by invoking `$JAVA_HOME/bin/java`/`javac` directly with an explicit classpath (spring-security-crypto + commons-logging jars from the local `.m2` cache) to run the bcrypt hash verification.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both auth-service seed-data gaps closed; companion plan 07-06 (Order.cashierId/tillSessionId linkage) already completed — together these two plans should unblock UAT Tests 4, 7, and 10 on re-run.
- Plan 07-08 (Dockerfiles/dev scripts) can proceed independently; no file overlap.
- No new blockers introduced.

---
*Phase: 07-point-of-sale-kitchen-display*
*Completed: 2026-07-10*

## Self-Check: PASSED

All created/modified files verified present on disk; all task commits (`bba177c`, `782bb58`) and the SUMMARY commit (`149387d`) verified present in git log.
