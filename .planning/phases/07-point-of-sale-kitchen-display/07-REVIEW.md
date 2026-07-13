---
phase: 07-point-of-sale-kitchen-display
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 23
files_reviewed_list:
  - config-server/Dockerfile
  - eureka-server/Dockerfile
  - gateway/Dockerfile
  - scripts/restart-service.ps1
  - scripts/start-dev.ps1
  - services/audit-service/Dockerfile
  - services/auth-service/Dockerfile
  - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
  - services/auth-service/src/main/resources/db/changelog/v1.0.0/043-cashier-void-own-permission.xml
  - services/auth-service/src/main/resources/db/changelog/v1.0.0/900-seed-auth-dev-data.xml
  - services/auth-service/src/test/java/io/restaurantos/auth/AuthInternalBranchRoleIT.java
  - services/auth-service/src/test/java/io/restaurantos/auth/KdsDemoUserSeedIT.java
  - services/auth-service/src/test/java/io/restaurantos/auth/integration/TestFixtures.java
  - services/authorization-service/Dockerfile
  - services/file-service/Dockerfile
  - services/finance-service/Dockerfile
  - services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodServiceImpl.java
  - services/finance-service/src/main/java/io/restaurantos/finance/web/InternalProvisioningController.java
  - services/finance-service/src/test/java/io/restaurantos/finance/AccountingPeriodIT.java
  - services/pos-service/Dockerfile
  - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/TillSession.java
  - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
  - services/pos-service/src/test/java/io/restaurantos/pos/TillReconciliationIT.java
  - services/pos-service/src/test/java/io/restaurantos/pos/VoidRefundOpaIT.java
  - services/user-service/Dockerfile
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
critical_fixed: 1
status: issues_found_warnings_only
---

# Phase 07: Code Review Report

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 23
**Status:** issues_found

## Summary

Reviewed the four gap-closure plans (07-05 through 07-08) that closed UAT blockers from Phase 07's test pass. Two of the three core logic fixes are correct and well-designed:

- **Fiscal-year self-heal fix** (`AccountingPeriodServiceImpl.getPeriodStatus`, `InternalProvisioningController`): Verified against `PakistanFiscalYear`'s Jul–Jun boundary math. The root cause (provisioning used `java.time.Year.now().getValue()` — a calendar year — instead of the true Pakistan fiscal year) is correctly fixed, and the added self-heal fallback in `getPeriodStatus` will always resolve a matching period for any date going forward, including for tenants whose historical data was seeded under the old, buggy calendar-year label. The `@Transactional(readOnly = true)` → `@Transactional` change on `getPeriodStatus` was correctly caught (needed since it can now write). No correctness bug found here.

- **CASHIER `void.own` permission grant** (`043-cashier-void-own-permission.xml`): Correctly scoped. It only inserts `pos.order.void.own`, and the OPA policy (`policies/restaurantos/pos.rego`) independently enforces `created_by == input.user.id` AND `status == "OPEN"` AND same tenant/branch before allowing the void — so the DB grant alone cannot let a cashier void someone else's order or a closed order. `pos.order.void.any` is untouched. Not overly broad.

However, two significant problems were found:

1. **Most of the Dockerfile changes in this phase are incomplete and leave 6 of the 10 touched Dockerfiles unable to build at all** (verified by reproducing Maven's reactor-validation behavior locally — see CR-01). This directly contradicts the stated goal of "Dockerfile fixes for local cold-start."
2. **The new cashierId/tillSessionId linkage in `OrderServiceImpl.createOrder` has a code path that leaves both fields `null` with no validation, logging, or downstream guard** — an order can be created and later closed (accepting cash) without ever being attached to a till session, meaning that cash never appears in any till reconciliation (see WR-01).

## Critical Issues

### CR-01: Six of ten Dockerfiles touched in this phase are missing required module POMs and will fail to build

**File:** `gateway/Dockerfile`, `services/auth-service/Dockerfile`, `services/authorization-service/Dockerfile`, `services/audit-service/Dockerfile`, `services/file-service/Dockerfile`, `services/user-service/Dockerfile`

**Issue:** The root `pom.xml` declares 14 `<module>` entries. Maven's multi-module reactor parses **every** declared module's `pom.xml` to build the reactor graph before applying `-pl`/`-am` filtering — even when building a single module. If any declared module's `pom.xml` is missing from the build context, the build fails immediately with `Child module ... does not exist`, regardless of which module was actually targeted.

I reproduced this behavior locally with a minimal 2-module reactor (one module's `pom.xml` withheld): `mvn -pl moduleA -am validate` fails with exactly this error, confirming the comment already present in `config-server/Dockerfile` ("Maven's reactor validates every `<module>`... or the build fails") is accurate.

This phase's diff only added `COPY services/pos-service/pom.xml` and `COPY services/kitchen-service/pom.xml` to each Dockerfile (to account for the two new modules), but several Dockerfiles were already missing other, unrelated module POMs *before* this diff and remain broken after it:

| Dockerfile | Missing module POM `COPY` lines |
|---|---|
| `gateway/Dockerfile` | `services/user-service`, `services/platform-admin-service`, `services/notification-service`, `services/audit-service`, `services/file-service` |
| `services/auth-service/Dockerfile` | `services/authorization-service`, `gateway`, `services/user-service`, `services/platform-admin-service`, `services/notification-service`, `services/audit-service`, `services/file-service` |
| `services/authorization-service/Dockerfile` | `gateway`, `services/user-service`, `services/platform-admin-service`, `services/notification-service`, `services/audit-service`, `services/file-service` |
| `services/audit-service/Dockerfile` | `services/file-service` |
| `services/file-service/Dockerfile` | `services/notification-service`, `services/audit-service` |
| `services/user-service/Dockerfile` | `services/platform-admin-service`, `services/notification-service`, `services/audit-service`, `services/file-service` |

`config-server/Dockerfile`, `eureka-server/Dockerfile`, `services/finance-service/Dockerfile`, and `services/pos-service/Dockerfile` are complete (all 14 module POMs present) and are fine.

Since `deploy/docker-compose.yml` builds every service with `context: ..` and `dockerfile: <service>/Dockerfile` from the repo root, `docker compose build auth-service` (and gateway, authorization-service, audit-service, file-service, user-service) will currently fail outright. `auth-service` in particular is a hard dependency for every other service's cold start (JWKS, RBAC), so this blocks the entire "local cold-start" goal this phase set out to fix.

**Fix:** Add the missing `COPY services/<module>/pom.xml services/<module>/pom.xml` (and `COPY gateway/pom.xml gateway/pom.xml` where applicable) lines to each Dockerfile listed above so every Dockerfile copies all 14 module POMs, matching the already-correct pattern in `config-server/Dockerfile` / `eureka-server/Dockerfile`:
```dockerfile
# services/auth-service/Dockerfile — add before the dependency:go-offline step
COPY services/authorization-service/pom.xml services/authorization-service/pom.xml
COPY gateway/pom.xml gateway/pom.xml
COPY services/user-service/pom.xml services/user-service/pom.xml
COPY services/platform-admin-service/pom.xml services/platform-admin-service/pom.xml
COPY services/notification-service/pom.xml services/notification-service/pom.xml
COPY services/audit-service/pom.xml services/audit-service/pom.xml
COPY services/file-service/pom.xml services/file-service/pom.xml
```
Repeat analogously for `gateway/Dockerfile`, `services/authorization-service/Dockerfile`, `services/audit-service/Dockerfile`, `services/file-service/Dockerfile`, `services/user-service/Dockerfile` using the missing-module table above. Consider generating this COPY block from the module list (e.g. a small script) to prevent this class of drift recurring every time a module is added.

**Status: FIXED** — commit `7448a60` added the missing `COPY services/<module>/pom.xml` lines to all six Dockerfiles. Verified: every one of the ten in-scope Dockerfiles (all except `services/kitchen-service/Dockerfile`, already correct, and `services/platform-admin-service/Dockerfile`, different build pattern, both out of scope) now copies all 14 module `pom.xml` files declared in the root `pom.xml`.

## Warnings

### WR-01: `createOrder` can silently produce orders with no cashier/till linkage, and nothing downstream requires or flags it

**File:** `services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java:117-126`

**Issue:**
```java
Order newOrder = order;
tenantContext.getUserId().ifPresent(userId -> {
    newOrder.setCashierId(userId);
    tillSessionRepository.findByCashierIdAndStatus(userId, TillStatus.OPEN)
            .ifPresent(till -> newOrder.setTillSessionId(till.getId()));
});
order = orderRepository.save(order);
```
Two code paths leave the order unlinked with no error, warning, or audit trail:

1. `tenantContext.getUserId()` empty → `cashierId` and `tillSessionId` both stay `null`. Since `orders.cashier_id` and `orders.till_session_id` are nullable columns, `orderRepository.save(order)` succeeds silently.
2. `getUserId()` present but the cashier has no `OPEN` till session (e.g. they haven't opened a till yet) → `cashierId` is set but `tillSessionId` stays `null`.

Neither `closeOrder` (lines 390-487) nor any other code path in this file validates that `order.getTillSessionId()` is non-null before accepting payment and transitioning to `CLOSED`. This means cash collected on such an order is never attributable to any till session and will never appear in `TillReconciliationIT`-style variance calculations — the exact class of bug ("missing cashierId/tillSessionId linkage") this gap-closure phase set out to fix can still occur, just for a narrower trigger (no open till at order-creation time, or a caller with no user context) instead of unconditionally as before.

**Fix:** At minimum, log a warning (with orderId) when `tenantContext.getUserId()` is empty or no open till is found, so these orders are discoverable in ops. Better: decide and enforce a business rule — either require an open till to create an order (fail fast with a clear `TillNotOpenException`), or require a linked till session before allowing `closeOrder` to accept cash payments:
```java
tenantContext.getUserId().ifPresentOrElse(userId -> {
    newOrder.setCashierId(userId);
    tillSessionRepository.findByCashierIdAndStatus(userId, TillStatus.OPEN)
            .ifPresentOrElse(
                till -> newOrder.setTillSessionId(till.getId()),
                () -> log.warn("Order {} created with no open till session for cashier {}", request.clientOrderId(), userId));
}, () -> log.warn("Order {} created with no authenticated cashier context", request.clientOrderId()));
```

### WR-02: `AccountingPeriodServiceImpl.seedForTenant` check-then-insert is not race-safe under concurrent requests

**File:** `services/finance-service/src/main/java/io/restaurantos/finance/service/AccountingPeriodServiceImpl.java:52-76`, invoked from the `getPeriodStatus` self-heal path at line 131.

**Issue:** `seedForTenant` checks `existsByTenantIdAndFiscalYearAndPeriodNo(...)` then inserts if absent, all inside the same transaction opened by `getPeriodStatus` (`@Transactional`, default `REQUIRED` propagation). If two requests for the same tenant race to close orders for dates in a not-yet-seeded fiscal year at the same time (plausible immediately after a new fiscal year rolls over and multiple branches close orders concurrently), both transactions can pass the `existsBy...` check before either commits, and both attempt to insert the same `(tenant_id, fiscal_year, period_no)` row. The `uq_period_tenant_fy_no` unique constraint (`V1__finance_schema.sql:48`) will reject the second insert, and this exception is not caught anywhere in the call chain — the second concurrent `closeOrder`/`getPeriodStatus` call will fail with an unhandled `DataIntegrityViolationException` instead of gracefully finding the now-committed period.

**Fix:** Catch the constraint violation in `seedForTenant` (or in the `getPeriodStatus` `orElseGet` branch) and retry the lookup once, treating a unique-violation as "another transaction already seeded it":
```java
.orElseGet(() -> {
    try {
        seedForTenant(tid, PakistanFiscalYear.forDate(date));
    } catch (DataIntegrityViolationException ignored) {
        // lost the race to another concurrent seed — fall through to re-query
    }
    return periodRepo
            .findByTenantIdAndStartDateLessThanEqualAndEndDateGreaterThanEqual(tid, date, date)
            .orElseThrow(() -> new PeriodNotFoundException(null));
});
```

### WR-03: `tillSessionRepository.findByCashierIdAndStatus` linkage ignores order/till branch mismatch

**File:** `services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java:124-125`

**Issue:** The till lookup used to populate `tillSessionId` is scoped only by `cashierId` + `TillStatus.OPEN` — it does not check that the till's `branchId` matches `order.getBranchId()` (which itself comes directly from the client-supplied `request.branchId()` with no server-side validation against the caller's actual branch context anywhere in `createOrder`). In the current system this is only safe because till sessions are enforced unique per `(tenant_id, cashier_id)` while `OPEN` (`uq_open_till_per_cashier`, not branch-scoped) — so today a cashier can have at most one open till, system-wide. But that also means the invariant "an order's linked till belongs to the same branch as the order" is not enforced anywhere: if a cashier opens a till at Branch A and then (whether by a UI bug, stale client state, or a multi-branch cashier role) creates an order with `branchId` = Branch B, the order will be silently linked to the Branch A till, corrupting that till's cash reconciliation with a Branch B order.

**Fix:** Either validate `till.getBranchId().equals(order.getBranchId())` before linking (and warn/skip linkage on mismatch), or explicitly document why cross-branch till linkage is acceptable if that is intentional:
```java
tillSessionRepository.findByCashierIdAndStatus(userId, TillStatus.OPEN)
        .filter(till -> till.getBranchId().equals(order.getBranchId()))
        .ifPresent(till -> newOrder.setTillSessionId(till.getId()));
```

## Info

### IN-01: `db.changelog-master.xml` include order is non-numeric (pre-existing, not introduced here)

**File:** `services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml:13-16`

**Issue:** `041-pos-permissions.xml`, `042-kds-permissions-kitchen-role.xml`, and the newly-added `043-cashier-void-own-permission.xml` all run *before* `040-create-user-branch-roles.xml` in the include order, despite having higher changeset numbers. This predates this diff (041/042 were already before 040) and 043 was simply appended consistently with that existing pattern, so it is not a regression — but the numbering no longer reflects execution order, which will keep confusing future contributors who assume changelog files run in numeric order. No functional bug: 043 only touches `role_permissions`/`permissions` (created in `030`), so it doesn't depend on `040`.

**Fix:** Consider renumbering the physical files to reflect actual run order in a future cleanup, or add a comment at the top of `db.changelog-master.xml` noting that include order — not filename number — is authoritative.

### IN-02: Hardcoded `-1.0.0.jar` artifact version suffix in dev scripts

**File:** `scripts/restart-service.ps1:70,95`, `scripts/start-dev.ps1:126`

**Issue:** Both scripts construct the expected jar path as `"$artifact-1.0.0.jar"`, hardcoding the parent POM's current version. This is pre-existing (not introduced by this diff, which only added `pos-service`/`kitchen-service` entries following the same pattern) but is worth flagging since any future version bump in `pom.xml` (`<version>1.0.0</version>`) will silently break every dev script's boot-jar detection with a non-obvious "Missing boot jar" error.

**Fix:** Read the version from `pom.xml` once (e.g. via a small `mvn help:evaluate -Dexpression=project.version -q -DforceStdout` call cached in a variable) instead of repeating the literal `1.0.0` in three places.

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
