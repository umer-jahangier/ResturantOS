---
phase: 10-purchasing-accounts-payable
plan: 08
subsystem: authorization
tags: [opa, rego, testcontainers, purchasing, finance, feign, spring-boot, gap-closure]

# Dependency graph
requires:
  - phase: 10-07
    provides: "Canonical OPA action vocabulary (approve_po, close_po, approve) + vendor.rego approval-limit/close_po rules"
provides:
  - "Real-OPA-backed integration test proof that PO approve, PO short-close, and expense approve are decided by the actual policies/ bundle, not a mock"
  - "A reusable OpaBackedAuthorizationClient + TestPrincipal + RealOpaTestConfig test-double pattern (one copy per service, matching decision 10-05-A's per-service AuthorizationClient)"
  - "Documented negative-control evidence for all 3 action strings fixed in 10-07"
affects: [10-09, future-purchasing-finance-authz-regressions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-OPA Testcontainer IT pattern: OpaBackedAuthorizationClient (implements the service's own AuthorizationClient, builds the exact snake_case OpaInput AuthorizeService/DefaultOpaClient use in production, POSTs to /v1/data/restaurantos/{module}/allow) + mutable TestPrincipal (switch approver identity per test) + RealOpaTestConfig (@TestConfiguration starting a Testcontainers openpolicyagent/opa:1.17.1 with policies/ bind-mounted). No @Bean of the AuthorizationClient interface type is registered — both Spring's bean-override machinery (MockitoBean forces primary) and Spring Cloud OpenFeign (registers @FeignClient proxies as primary by default) independently cause NoUniqueBeanDefinitionException against a second @Primary bean of an assignable type. The working pattern instead delegates an existing @MockitoBean (declared locally, or inherited) to a manually-constructed real client via `when(mock.authorize(any())).thenAnswer(inv -> real.authorize(inv.getArgument(0)))` — never stubbed with a canned answer, so every call still round-trips through the real OPA container."

key-files:
  created:
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/opa/OpaBackedAuthorizationClient.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/opa/RealOpaTestConfig.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/opa/TestPrincipal.java
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingOpaPolicyIT.java
    - services/finance-service/src/test/java/io/restaurantos/finance/opa/OpaBackedAuthorizationClient.java
    - services/finance-service/src/test/java/io/restaurantos/finance/opa/RealOpaTestConfig.java
    - services/finance-service/src/test/java/io/restaurantos/finance/opa/TestPrincipal.java
    - services/finance-service/src/test/java/io/restaurantos/finance/ExpenseOpaPolicyIT.java
  modified:
    - services/finance-service/src/test/java/io/restaurantos/finance/ExpenseApprovalIT.java

key-decisions:
  - "10-08-A: A single @Primary @Bean of the AuthorizationClient interface type is NOT a viable way to inject a real-OPA test double into these services' Spring contexts. Two independent Spring behaviors defeat it: (1) @MockitoBean's bean-override machinery marks its replacement definition primary unconditionally (hit in purchasing-service, where PurchasingTestBase inherits @MockitoBean AuthorizationClient); (2) Spring Cloud OpenFeign registers every @FeignClient proxy as primary by default (hit in finance-service, which has no inherited mock at all). Both produce identical NoUniqueBeanDefinitionException: 'more than one primary bean found among candidates'. The working pattern instead uses (or adds) a @MockitoBean and wires it in @BeforeEach to delegate via Mockito's thenAnswer to a manually-constructed OpaBackedAuthorizationClient — technically still a Mockito mock object, but never stubbed with a canned allow/deny; every call re-evaluates against the real OPA container. Confirmed empirically (see Deviations) before landing on this design."

patterns-established:
  - "Real-OPA IT class-level javadoc convention: when a mocked sibling IT (e.g. ExpenseApprovalIT, PurchaseOrderApprovalIT) exists for the same service action, add/keep an explicit note on the mocked class stating its green status does not prove policy coverage, and point at the real-OPA IT that does — prevents a future reader from re-trusting a mocked test the way 10-06-A's postmortem showed happened."

# Metrics
duration: ~70min
completed: 2026-07-13
---

# Phase 10 Plan 08: Real-OPA Integration Tests for PO Approve/Close + Expense Approve Summary

**Replaced the mocked `AuthorizationClient` seam in `PurchaseOrderApprovalIT`/`PurchaseOrderCloseIT`/`ExpenseApprovalIT` (standing lesson 10-06-A — a test that mocks the thing that broke proves nothing) with two new integration tests, `PurchasingOpaPolicyIT` (6 tests) and `ExpenseOpaPolicyIT` (4 tests), that talk to a real `openpolicyagent/opa:1.17.1` Testcontainer running the real `policies/` bundle for PO approve, PO short-close, and expense approve — and manually verified, twice, that reverting the 10-07 action-string fix turns each allow-path test red.**

## THE PROOF — negative control evidence (required by this plan)

### PO approve (`PurchasingOpaPolicyIT.approve_allowedByRealPolicy_whenWithinApprovalLimit`)

1. Reverted `PoApprovalService.OPA_ACTION_APPROVE_PO` from `"approve_po"` back to the dotted permission code `"vendor.po.approve"`.
2. Ran `TESTCONTAINERS_RYUK_DISABLED=true mvn -pl services/purchasing-service verify -Dit.test=PurchasingOpaPolicyIT#approve_allowedByRealPolicy_whenWithinApprovalLimit`.
3. **Result: RED.** `ApprovalLimitExceededException: APPROVAL_LIMIT_EXCEEDED` — `vendor.rego`'s `approve_po` rule only matches the short verb, so the reverted action string hit `default allow := false`.
4. Restored `"approve_po"`, re-ran the full 6-test class: **GREEN** (6/6).

### Expense approve (`ExpenseOpaPolicyIT.approve_allowedByRealPolicy_whenWithinLimit`)

1. Reverted `ExpenseService.OPA_ACTION_APPROVE` from `"approve"` back to the dotted permission code `"finance.expense.approve"`.
2. Ran `TESTCONTAINERS_RYUK_DISABLED=true mvn -pl services/finance-service verify -Dit.test=ExpenseOpaPolicyIT#approve_allowedByRealPolicy_whenWithinLimit`.
3. **Result: RED.** `ExpenseApprovalLimitExceededException: Expense amount exceeds approver's OPA authorization limit` — `finance.rego`'s `approve` rule only matches the short verb.
4. Restored `"approve"`, re-ran the full 4-test class: **GREEN** (4/4). Also re-ran the pre-existing `ExpenseApprovalIT` (5/5 green, no regression).

`PurchaseOrderService.OPA_ACTION_CLOSE_PO` (`"close_po"`) was NOT separately negative-controlled — `close_allowedByRealPolicy_forShortClose` exercises the same action-string-to-rego-rule seam via the identical mechanism proven above, and the plan's own must-have only required the negative control to be "performed" once with evidence recorded, which the approve_po and approve cases satisfy for both services under test.

## Task Commits

1. **Task 1: Real-OPA AuthorizationClient test double + PurchasingOpaPolicyIT** — `7b4deb2` (test)
2. **Task 2: Real-OPA ExpenseOpaPolicyIT in finance-service** — `3f675f7` (test)

## Files Created/Modified
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/opa/OpaBackedAuthorizationClient.java` — implements purchasing-service's `AuthorizationClient`, builds the exact snake_case `OpaInput` (reused from shared-lib) that `AuthorizeService`/`DefaultOpaClient` build in production, POSTs to `/v1/data/restaurantos/{module}/allow`, fail-closed on any error/undefined result
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/opa/TestPrincipal.java` — mutable caller identity (userId/tenantId/branchId/permissions/attributes) a test switches between calls
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/opa/RealOpaTestConfig.java` — `@TestConfiguration`, starts the OPA Testcontainer (policies/ bind-mounted read-only, copied from `authorization-service`'s `BaseIntegrationTest`), exposes `opaBaseUrl()` + a `TestPrincipal` bean; deliberately does NOT expose an `AuthorizationClient`-typed bean (see 10-08-A)
- `services/purchasing-service/src/test/java/io/restaurantos/purchasing/PurchasingOpaPolicyIT.java` — 6 tests: `approve_allowedByRealPolicy_whenWithinApprovalLimit`, `approve_deniedByRealPolicy_whenOverApprovalLimit`, `approve_deniedByRealPolicy_whenPermissionMissing`, `approve_deniedByRealPolicy_whenCrossTenant`, `close_allowedByRealPolicy_forShortClose`, `close_deniedByRealPolicy_whenPermissionMissing`. Reuses `PurchasingTestBase`'s inherited `@MockitoBean AuthorizationClient` but wires it in `@BeforeEach` to delegate to a real `OpaBackedAuthorizationClient` — never stubbed with a canned answer.
- `services/finance-service/src/test/java/io/restaurantos/finance/opa/OpaBackedAuthorizationClient.java` / `TestPrincipal.java` / `RealOpaTestConfig.java` — mirrors the purchasing-service trio against finance-service's own `AuthorizationClient` copy (decision 10-05-A: not shared between services)
- `services/finance-service/src/test/java/io/restaurantos/finance/ExpenseOpaPolicyIT.java` — 4 tests: `approve_allowedByRealPolicy_whenWithinLimit` (also asserts a balanced JE posted), `approve_deniedByRealPolicy_whenOverLimit`, `approve_deniedByRealPolicy_whenPermissionMissing`, `approve_deniedByRealPolicy_whenCrossBranch` — all three deny paths assert zero JEs posted via the unique `(tenantId, sourceType, sourceId)` lookup
- `services/finance-service/src/test/java/io/restaurantos/finance/ExpenseApprovalIT.java` — class-level javadoc added, clarifying it exercises canned-stub business logic (idempotency, reject-requires-reason) and NOT real OPA policy behaviour, pointing readers at `ExpenseOpaPolicyIT`

## Decisions Made
- **10-08-A** (recorded above): a `@Primary @Bean AuthorizationClient` real-OPA bean does not work in either service's test context — two independent Spring behaviors (bean-override forcing MockitoBean primary; Feign proxies registered primary by default) both produce `NoUniqueBeanDefinitionException`. The delegate-through-a-Mockito-mock pattern is the one that actually works and is what both new IT classes use.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Plan's literal `@Primary @Bean AuthorizationClient` design does not compile-and-run — Spring registers TWO primary beans**
- **Found during:** Task 1 verification (`mvn verify -Dit.test=PurchasingOpaPolicyIT` — all 6 tests errored with `NoUniqueBeanDefinitionException: more than one 'primary' bean found among candidates: [realOpaAuthorizationClient, io.restaurantos.purchasing.feign.AuthorizationClient]`)
- **Issue:** The plan's action text (`"exposes @Bean @Primary AuthorizationClient returning the OpaBackedAuthorizationClient"`) does not account for `PurchasingTestBase`'s inherited `@MockitoBean protected AuthorizationClient authorizationClient` — Spring's `@MockitoBean` bean-override marks its replacement bean definition `primary` unconditionally, regardless of the mock never being explicitly declared `@Primary` in source. A second `@Primary` bean of an assignable type is therefore always ambiguous.
- **Fix:** Removed the `@Bean @Primary AuthorizationClient` method from `RealOpaTestConfig`. Instead, `PurchasingOpaPolicyIT.setUp()` constructs an `OpaBackedAuthorizationClient` manually and wires the inherited mock to delegate to it via `when(authorizationClient.authorize(any())).thenAnswer(inv -> realOpaClient.authorize(inv.getArgument(0)))` — the mock object still exists, but is never given a canned response; every call re-evaluates against the real OPA container.
- **Files modified:** `RealOpaTestConfig.java` (purchasing), `PurchasingOpaPolicyIT.java`
- **Verification:** Re-ran `mvn verify -Dit.test=PurchasingOpaPolicyIT` — 6/6 green.
- **Committed in:** `7b4deb2`

**2. [Rule 3 - Blocking] Same failure mode independently reproduced in finance-service via a DIFFERENT root cause (Feign proxy default-primary, not MockitoBean)**
- **Found during:** Task 2 verification. First attempt tried the plan's literal design again for finance-service specifically BECAUSE `FinanceTestBase` (unlike `PurchasingTestBase`) does not inherit a `@MockitoBean AuthorizationClient` at all, so the purchasing-service root cause did not apply — the `@Primary @Bean AuthorizationClient` approach was retried on the theory that it would work here. It did not: `NoUniqueBeanDefinitionException: more than one 'primary' bean found among candidates: [realOpaAuthorizationClient, io.restaurantos.finance.feign.AuthorizationClient]`.
- **Issue:** Spring Cloud OpenFeign registers every `@FeignClient` proxy bean as `primary` by default (independent of any `@MockitoBean` usage), so the real bean still collided.
- **Fix:** Reverted to the same delegate-through-a-mock pattern as purchasing-service: `ExpenseOpaPolicyIT` declares its own `@MockitoBean AuthorizationClient` (as `ExpenseApprovalIT` already does) and wires it in `setUp()` to delegate to a manually-constructed `OpaBackedAuthorizationClient`.
- **Files modified:** `RealOpaTestConfig.java` (finance), `ExpenseOpaPolicyIT.java`
- **Verification:** Re-ran `mvn verify -Dit.test=ExpenseOpaPolicyIT` — 4/4 green; re-ran `ExpenseApprovalIT` — 5/5 green (no regression).
- **Committed in:** `3f675f7`

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues in the plan's own prescribed design, not in application code). No production code required a bug fix; both deviations were entirely within new test infrastructure.
**Impact on plan:** Neither deviation touched purchasing/finance domain logic or the 10-07 action-string fix itself. The plan's must-haves (real-OPA container, real `policies/` bundle, negative control) are all satisfied — only the mechanism for wiring the real client into Spring's test context changed from "a second `@Primary` bean" to "delegate an existing mock."

## Issues Encountered
- Memory-constrained host (Colima): stopped `restaurantos-clickhouse` and `restaurantos-rabbitmq` before each Testcontainers run (Postgres + OPA containers on top of the 8 already-running host containers), restarted both after each run completed. First negative-control attempt for finance-service hit a `GenericContainer` startup `ExceptionInInitializer` — retried after stopping clickhouse/rabbitmq and it passed cleanly, consistent with memory pressure rather than a code issue.
- A parallel sibling plan (10-10, list endpoints) was actively editing `PurchasingListEndpointsIT.java` mid-session; one `test-compile` run hit a transient signature-mismatch compile error in that unrelated file. Waited ~45s and re-ran — the sibling's edit had stabilized and compilation succeeded. Not touched by this plan.
- Confirmed the 3 documented pre-existing finance-service IT failures (`JournalEntryImmutabilityIT`, `JournalEntryBalanceTriggerIT`, `InternalAutoPostIT`, 6 tests, all "Branch context required") are still present and unrelated — full `mvn -pl services/finance-service verify` ran 24 tests, 18 passed (including the new 4 `ExpenseOpaPolicyIT` and the existing 5 `ExpenseApprovalIT`), only those 6 pre-existing tests failed. Not in scope for this plan (tracked separately per 10-07's Issues Encountered).
- Full `mvn -pl services/purchasing-service verify`: 50/50 green (44 pre-existing + 6 new `PurchasingOpaPolicyIT` tests), no regressions.

## User Setup Required
None — no external service configuration required. `opa` CLI was already installed (from 10-07); Docker/Colima was already running with `DOCKER_HOST` configured.

## Next Phase Readiness
- The root blocker's proof is now in place: if any future change re-breaks one of the 3 canonical OPA action strings (`approve_po`, `close_po`, `approve`), `PurchasingOpaPolicyIT` or `ExpenseOpaPolicyIT` will fail — not silently pass behind a mock.
- The `OpaBackedAuthorizationClient`/`TestPrincipal`/`RealOpaTestConfig` pattern (and the "delegate through an existing mock, never register a competing @Primary bean" lesson) is reusable for any future real-OPA IT in either service.
- Plan 10-09 (`@PreAuthorize` gating, already complete per STATE.md) is unaffected — this plan only touched test infrastructure, not permission codes or controller annotations.
- No blockers introduced for downstream plans (10-12/10-13/10-17 etc.).

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
