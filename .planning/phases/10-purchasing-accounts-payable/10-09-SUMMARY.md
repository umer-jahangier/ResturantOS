---
phase: 10-purchasing-accounts-payable
plan: 09
subsystem: auth
tags: [spring-security, preauthorize, rbac, liquibase, mockmvc, spring-security-test, purchasing]

# Dependency graph
requires:
  - phase: 02-authentication-authorization
    provides: JWT authorities model (permissions claim -> SimpleGrantedAuthority), shared JwtAuthenticationFilter/EnableMethodSecurity pattern
  - phase: 10-07 (gap-closure)
    provides: canonical OPA action vocabulary, vendor.rego close_po rule (needed vendor.po.close permission to exist)
provides:
  - "@PreAuthorize on all 18 public purchasing endpoints (6 controllers), InternalPurchasingController explicitly excluded"
  - "auth-service permission seed 031-purchasing-permissions.xml: vendor.view/po.create/po.close/po.send/grn.receive/invoice.book/invoice.override/payment.create + role grants"
  - "PurchasingEndpointAuthorizationIT: real-filter-chain RBAC proof (Cashier 403 / Manager 200 / viewer partial) + reflection guard against future ungated endpoints"
  - "shared-lib GlobalExceptionHandler AccessDeniedException -> 403 fix (cross-cutting, benefits every service using @PreAuthorize)"
affects: [10-10, finance-service (benefits from AccessDeniedException fix), any future purchasing endpoint work]

# Tech tracking
tech-stack:
  added: [spring-security-test (purchasing-service test scope)]
  patterns:
    - "@PreAuthorize(\"hasAuthority('...')\") per handler method, class-level @RequiresFeature retained (orthogonal gates)"
    - "RBAC IT built via SecurityMockMvcRequestPostProcessors.authentication(UsernamePasswordAuthenticationToken(JwtClaims, authorities)) instead of jwt() or @WithMockUser — mirrors production JwtAuthenticationFilter's exact object model while running the real @EnableMethodSecurity interceptor"
    - "Classpath-scanning reflection guard (ClassPathScanningCandidateComponentProvider + AnnotatedElementUtils) fails the build if any new @RestController handler lacks @PreAuthorize"

key-files:
  created:
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/031-purchasing-permissions.xml
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingEndpointAuthorizationIT.java
  modified:
    - services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/PurchaseOrderController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorInvoiceController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/ApPaymentController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/MockGrnController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorAnalyticsController.java
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/InternalPurchasingController.java
    - services/purchasing-service/pom.xml
    - shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java

key-decisions:
  - "vendor.po.close was referenced by PurchaseOrderService.close + the 10-07 close_po rego rule but was never seeded — added in new changeset 031 (030 already applied everywhere, never edited)"
  - "OWNER/TENANT_ADMIN vendor.* grants added explicitly (mirroring 041-pos-permissions style), not via a SELECT-all-permissions trick, because 030's blanket seed already ran at a point in time before these rows existed"
  - "RBAC IT builds Authentication objects directly with the same JwtClaims principal + SimpleGrantedAuthority list JwtAuthenticationFilter builds in production, injected via SecurityMockMvcRequestPostProcessors.authentication(...) — exercises the real @EnableMethodSecurity interceptor without needing JWKS/signed-JWT test infrastructure"
  - "Found and fixed a cross-cutting shared-lib bug: GlobalExceptionHandler had no handler for Spring Security's AccessDeniedException, so every @PreAuthorize denial fell through to the generic Exception handler and returned 500 instead of 403 across ALL services sharing this class (not just purchasing)"

patterns-established:
  - "Endpoint -> permission map (see below) is the reference for 10-10 to extend consistently when adding list endpoints"

# Metrics
duration: 55min
completed: 2026-07-13
---

# Phase 10 Plan 09: Purchasing RBAC Gating Summary

**All 18 public purchasing endpoints gated with `@PreAuthorize`, missing `vendor.*` permissions seeded, and a real-filter-chain RBAC integration test — which also caught and fixed a cross-cutting shared-lib bug that silently turned every `@PreAuthorize` denial into a 500.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 3
- **Files modified:** 10 (2 created, 8 modified)

## Accomplishments

- Closed the BLOCKER: any authenticated tenant user (including a Cashier) could previously create vendors + bank details, approve POs, override a 3-way match, and post AP payments — `PurchasingSecurityConfig` declared `@EnableMethodSecurity` but zero controllers used it.
- Seeded the complete `vendor.*` permission catalogue in auth-service, including `vendor.po.close`, which had never been seeded despite being referenced by `PurchaseOrderService.close` and the 10-07 `close_po` rego rule.
- Added `PurchasingEndpointAuthorizationIT`, which proves the gate through the real Spring Security filter chain (not mocks), including a reflection-based guard that fails the build if any future purchasing endpoint ships ungated.
- Discovered and fixed a shared-lib bug (`GlobalExceptionHandler` had no handler for `AccessDeniedException`) that was silently converting every `@PreAuthorize` denial into a 500 across every service using the shared exception handler — this bug was invisible until a real (non-mocked) 403-expecting test exercised it.

## Task Commits

1. **Task 1: Seed the missing purchasing permissions and role grants** - `3139927` (feat)
2. **Task 2: `@PreAuthorize` on all 18 public purchasing endpoints** - `64ac6a9` (feat)
3. **Task 3: `PurchasingEndpointAuthorizationIT` + shared-lib bug fix** - `c2b2ecb` (test)

**Plan metadata:** committed as part of this summary's own commit (see below).

## Files Created/Modified

- `services/auth-service/src/main/resources/db/changelog/v1.0.0/031-purchasing-permissions.xml` - new permission catalogue (`vendor.view`, `vendor.po.create`, `vendor.po.close`, `vendor.po.send`, `vendor.grn.receive`, `vendor.invoice.book`, `vendor.invoice.override`, `vendor.payment.create`) + role grants (MANAGER full set, ACCOUNTANT AP subset, INVENTORY_MANAGER procurement subset, OWNER/TENANT_ADMIN full set, CASHIER nothing)
- `services/auth-service/src/main/resources/db/changelog/db.changelog-master.xml` - registers 031 after 030
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorController.java` - `list`->`vendor.view`, `create`/`update`->`vendor.manage`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/PurchaseOrderController.java` - `create`/`submit`/`withdraw`->`vendor.po.create`, `get`->`vendor.view`, `approve`/`reject`->`vendor.po.approve`, `send`->`vendor.po.send`, `close`->`vendor.po.close`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorInvoiceController.java` - `create`->`vendor.invoice.book`, `get`->`vendor.view`, `overrideMatch`->`vendor.invoice.override`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/ApPaymentController.java` - `create`->`vendor.payment.create`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/MockGrnController.java` - `mockReceive`->`vendor.grn.receive`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/VendorAnalyticsController.java` - `scorecard`/`spend`->`vendor.view`
- `services/purchasing-service/src/main/java/io/restaurantos/purchasing/web/InternalPurchasingController.java` - class-level javadoc explaining deliberate exclusion (service-to-service, X-Internal-Service secret, no user principal)
- `services/purchasing-service/pom.xml` - added `spring-security-test` (test scope)
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingEndpointAuthorizationIT.java` - 15 tests: 12-way parameterized Cashier-403, Manager-201, viewer partial-access, reflection every-endpoint-is-gated guard
- `shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java` - added `@ExceptionHandler(AccessDeniedException.class)` returning 403/`ACCESS_DENIED`

## Endpoint -> Permission Map (reference for 10-10)

| Controller | Method | Route | Permission |
|---|---|---|---|
| VendorController | list | GET /vendors | vendor.view |
| VendorController | create | POST /vendors | vendor.manage |
| VendorController | update | PUT /vendors/{id} | vendor.manage |
| PurchaseOrderController | create | POST /purchase-orders | vendor.po.create |
| PurchaseOrderController | get | GET /purchase-orders/{id} | vendor.view |
| PurchaseOrderController | submit | POST /purchase-orders/{id}/submit | vendor.po.create |
| PurchaseOrderController | withdraw | POST /purchase-orders/{id}/withdraw | vendor.po.create |
| PurchaseOrderController | approve | POST /purchase-orders/{id}/approve | vendor.po.approve |
| PurchaseOrderController | reject | POST /purchase-orders/{id}/reject | vendor.po.approve |
| PurchaseOrderController | send | POST /purchase-orders/{id}/send | vendor.po.send |
| PurchaseOrderController | close | POST /purchase-orders/{id}/close | vendor.po.close |
| VendorInvoiceController | create | POST /invoices | vendor.invoice.book |
| VendorInvoiceController | get | GET /invoices/{id} | vendor.view |
| VendorInvoiceController | overrideMatch | POST /invoices/{id}/override-match | vendor.invoice.override |
| ApPaymentController | create | POST /payments | vendor.payment.create |
| MockGrnController | mockReceive | POST /purchase-orders/{poId}/mock-receive | vendor.grn.receive |
| VendorAnalyticsController | scorecard | GET /analytics/scorecard | vendor.view |
| VendorAnalyticsController | spend | GET /analytics/spend | vendor.view |

`InternalPurchasingController` (`/internal/purchasing/**`) deliberately excluded — guarded by `PurchasingInternalServiceFilter` (X-Internal-Service secret), no user JWT/principal.

## Decisions Made

- `vendor.po.close` seeded for the first time in `031-purchasing-permissions.xml` — it was referenced by code (`PurchaseOrderService.close`) and by the 10-07 `close_po` rego rule but never existed as a permission row.
- OWNER/TENANT_ADMIN vendor.* grants added as explicit `<insert>` rows (mirroring `041-pos-permissions.xml`'s style), not via a `SELECT code FROM permissions` wildcard, because 030's blanket OWNER/TENANT_ADMIN seed changeset already executed historically against the permissions table as it existed at that point — it does not retroactively pick up rows a later changeset inserts.
- `PurchasingEndpointAuthorizationIT` builds `Authentication` objects directly (`UsernamePasswordAuthenticationToken` + `JwtClaims` principal + `SimpleGrantedAuthority` list) via `SecurityMockMvcRequestPostProcessors.authentication(...)`, mirroring exactly what `JwtAuthenticationFilter` builds in production, rather than using `jwt()`'s `JwtAuthenticationToken` model. This still runs the real `@EnableMethodSecurity`/`MethodSecurityInterceptor` through `@AutoConfigureMockMvc` without needing to stand up JWKS/signed-JWT test infrastructure.
- `spring-security-test` added as a test-scope dependency to `purchasing-service/pom.xml` — it existed in auth-service/authorization-service/gateway but not here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `GlobalExceptionHandler` swallowed `AccessDeniedException` as a 500**

- **Found during:** Task 3 (first real run of `PurchasingEndpointAuthorizationIT`) — all 13 tests expecting 403 got 500 instead.
- **Issue:** `shared-lib`'s `@RestControllerAdvice GlobalExceptionHandler` has an `@ExceptionHandler(Exception.class)` catch-all but no dedicated handler for Spring Security's `org.springframework.security.access.AccessDeniedException` (thrown by `MethodSecurityInterceptor` around `@PreAuthorize` checks). Because Spring MVC's `DispatcherServlet` resolves exceptions via registered `@ControllerAdvice` resolvers *before* they can propagate up to `ExceptionTranslationFilter` (which normally converts `AccessDeniedException` to 403), the generic handler intercepted it first and returned 500. This silently defeated `@PreAuthorize` on every endpoint in every service sharing this handler class — not only the ones added in this plan, but also `ExpenseController.approve`/`reject` in finance-service (added in 10-05).
- **Fix:** Added `@ExceptionHandler(AccessDeniedException.class)` returning `403 FORBIDDEN` / `ACCESS_DENIED`, positioned before the generic handler.
- **Files modified:** `shared-lib/src/main/java/io/restaurantos/shared/api/GlobalExceptionHandler.java`
- **Verification:** Rebuilt shared-lib (`mvn -pl shared-lib install -DskipTests`), recompiled auth-service/finance-service/purchasing-service/pos-service/kitchen-service/gateway against the new jar (all compile clean); reran `PurchasingEndpointAuthorizationIT` — 15/15 green; reran the full purchasing-service suite (`mvn verify`, 38 tests total across 9 IT classes) — all green; reran auth-service + finance-service `mvn verify` — auth-service 0 failures, finance-service's only failures are the 6 pre-existing `Branch context required` tests already documented in STATE.md as out-of-scope (unrelated to this change — those tests fail during entity persistence, before any `@PreAuthorize` check runs).
- **Committed in:** `c2b2ecb` (part of Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix was necessary for Task 3's own verification to pass and is squarely a correctness/security bug (Rule 1) — every `@PreAuthorize` annotation across the codebase was non-functional at the HTTP-response level until this fix, even though the authorization decision itself (403 vs allow) was being computed correctly internally. No scope creep: the fix is a single `@ExceptionHandler` method plus one import.

## Negative Control (required by plan)

Per the plan's explicit instruction, `@PreAuthorize("hasAuthority('vendor.payment.create')")` was temporarily removed from `ApPaymentController.create`, and `PurchasingEndpointAuthorizationIT` was rerun:

- **Before removal:** 15/15 green.
- **After removal:** 13/15 green, 2 failures as required:
  - `everyPublicEndpointIsGated` — `AssertionFailedError: [ApPaymentController.create() is a public request-mapped handler with no @PreAuthorize ...] Expecting value to be true but was false`
  - `cashier_isForbidden_onEveryMutatingEndpoint[12]` (the `POST /payments` case) — `AssertionError: Status expected:<403> but was:<500>` (with no `@PreAuthorize`, the Cashier's request reaches `ApPaymentService.create` and fails on an unmapped resource, producing the generic 500 — not a false-positive 403, and not part of the RBAC gate under test).
- **Restored** the annotation; reran — 15/15 green again; `git diff` on the file shows zero net changes.

This confirms the RBAC IT actually detects an ungated endpoint rather than passing vacuously (the standing lesson from decision 10-06-A).

## Issues Encountered

- The first two IT run attempts hit a Testcontainers startup timeout unrelated to this plan's changes (transient Docker resource contention on a constrained host — ~3.9GB total memory available to Docker Desktop). A third attempt succeeded; no code change was needed. Not logged as a deviation since it wasn't a code issue.
- GitNexus MCP tools (mentioned in CLAUDE.md for pre-edit impact analysis) were not available as registered tools in this execution session. Impact analysis on `VendorController`/`PurchaseOrderController`/etc. was performed manually instead: reviewed direct callers via the existing IT suite (`VendorIT`, `PurchaseOrderApprovalIT`, `PurchaseOrderCloseIT`, `ThreeWayMatchIT`, `GrnReceiptSimulatorIT`, `SpendAnalyticsIT`, `VendorScorecardIT`) and confirmed all 38 purchasing-service tests plus auth-service's full suite still pass after the changes. `detect_changes()` was likewise unavailable; the equivalent check performed was a full `mvn verify` across the affected modules plus a targeted `git diff --stat` review before each commit.

## User Setup Required

None - no external service configuration required. The new permission seed applies automatically via Liquibase on next auth-service startup/migration.

## Next Phase Readiness

- ROADMAP SC#1 ("Managers manage vendors") is now true in the authorization sense — a Cashier cannot create vendors, approve POs, override a 3-way match, or post AP payments; only permission-holders can, proven against the real Spring Security filter chain.
- `vendor.po.close` now exists as a real, granted permission, so the 10-07 `close_po` OPA policy rule can actually match in production.
- A future ungated purchasing endpoint will fail the build via `everyPublicEndpointIsGated`.
- The endpoint -> permission map above is ready for 10-10 (list endpoints) to extend consistently.
- The `GlobalExceptionHandler` fix benefits finance-service's `ExpenseController.approve`/`reject` (`@PreAuthorize("hasAuthority('finance.expense.approve')")`, added in 10-05) for free — those endpoints were also silently returning 500 instead of 403 on denial before this fix, though this was outside 10-09's own scope to test.
- No blockers for 10-10.

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
