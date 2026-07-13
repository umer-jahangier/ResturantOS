---
phase: 10-purchasing-accounts-payable
plan: 18
subsystem: finance
tags: [accounts-receivable, journal-entries, postgresql-rls, rbac, internal-seam, nextjs, react-hook-form, msw, testcontainers]

# Dependency graph
requires:
  - phase: 10-17
    provides: "Decision 10-17-A — AR is IN scope, sourced from corporate/house accounts, split Phase 10 (10-18) / Phase 7 (07-05)"
  - phase: 10-10
    provides: "the (non-universal) non-paginated ApiResponse<List<Dto>> list contract for PO/invoice/expense"
  - phase: 10-14
    provides: "the finance.* frontend four-layer files (schema/adapter/repository/hooks/handlers/layout/ApAgingTable) this plan extends"
  - phase: 10-09
    provides: "the @PreAuthorize reflection-guard IT pattern (PurchasingEndpointAuthorizationIT), ported to finance-service here"
provides:
  - "AR sub-ledger (customer_accounts + ar_transactions), RLS-forced, Flyway V6"
  - "ArService: house-account create/list, charge/settle (credit-limit invariant, idempotent), aging, statement"
  - "Public AR API under /api/v1/finance/ar/*, every method @PreAuthorize'd, no OPA gate (10-18-B)"
  - "THE PHASE 7 SEAM: POST /internal/finance/ar/charges — idempotent, X-Internal-Service guarded"
  - "finance.ar.view / finance.ar.manage permissions seeded and role-mapped"
  - "FinanceEndpointAuthorizationIT — finance-service's first @PreAuthorize reflection guard"
  - "House Accounts + AR Aging frontend pages, real AR writer a human can drive today"
affects: ["phase-07 (07-05 consumes the internal seam contract below verbatim)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AR charge/settle funnels manual and internal-seam callers into ONE private postCharge() so writers cannot drift apart"
    - "Credit-limit invariant checked BEFORE any write, not relied on transactional rollback"
    - "Branch-scoped InternalTenantContextHelper.activate(tenantId, branchId) overload for internal seams whose request body carries a branchId"
    - "@PreAuthorize reflection-guard IT with a PATH-based (not just class-based) internal-endpoint exclusion"

key-files:
  created:
    - services/finance-service/src/main/resources/db/migration/V6__accounts_receivable.sql
    - services/finance-service/src/main/java/io/restaurantos/finance/service/ArService.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/ArAgingCalculator.java
    - services/finance-service/src/main/java/io/restaurantos/finance/web/ArController.java
    - services/finance-service/src/test/java/io/restaurantos/finance/ArLedgerIT.java
    - services/finance-service/src/test/java/io/restaurantos/finance/InternalArChargeSeamIT.java
    - services/finance-service/src/test/java/io/restaurantos/finance/FinanceEndpointAuthorizationIT.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/038-finance-ar-permissions.xml
    - frontend/app/(tenant)/app/finance/house-accounts/page.tsx
    - frontend/app/(tenant)/app/finance/ar-aging/page.tsx
  modified:
    - services/finance-service/src/main/java/io/restaurantos/finance/web/InternalFinanceController.java
    - services/finance-service/src/main/java/io/restaurantos/finance/config/InternalTenantContextHelper.java
    - services/finance-service/src/main/java/io/restaurantos/finance/exception/FinanceGlobalExceptionHandler.java
    - frontend/lib/api-client/schemas/finance.schema.ts
    - frontend/lib/repositories/finance.repository.ts
    - frontend/lib/hooks/finance/use-finance.ts
    - frontend/app/(tenant)/app/finance/layout.tsx

key-decisions:
  - "10-18-A: AR aging ages by charge txn_date with AP's exact bucket boundaries (0-30/31-60/61-90/91+); settlements allocated FIFO oldest-charge-first"
  - "10-18-B: AR is NOT OPA-gated — credit limit is a domain invariant, not an approval workflow; no new rego verb"
  - "10-18-C: customer_accounts contact fields are unencrypted (business-contact class, not vendor-bank-account class); no bank-account field added"
  - "GET /api/v1/finance/ar/customer-accounts is PAGINATED (ApiResponse.paginated, matching AccountController), not 10-10's non-paginated PO/invoice/expense contract"
  - "ArAgingTable is a separate component, not a fork of ApAgingTable — ApAgingTable is typed directly to ApAging (totalApPaisa), not generic over its DTO"

patterns-established:
  - "Internal seams that need JournalEntryService.autoPostInternal's branch-scoped create() path must activate TenantContext WITH a branchId — InternalTenantContextHelper.activate(tenantId, branchId) overload is the reusable fix"

# Metrics
duration: 105min
completed: 2026-07-13
---

# Phase 10 Plan 18: Accounts Receivable (House/Corporate Accounts) Summary

**AR sub-ledger + house/corporate customer-account entity + AR aging + the internal POS-charge seam, with two real writers (manual UI charge, internal seam) both posting balanced journal entries against the seeded `1200 Accounts Receivable` — closing FIN-05's AR half.**

## Performance

- **Duration:** ~105 min
- **Tasks:** 3/3 completed
- **Files modified/created:** 39 (24 backend, 15 frontend)

## Accomplishments

- `customer_accounts` (the house/corporate account) and `ar_transactions` (the AR sub-ledger) tables, RLS FORCEd, with the DB-level idempotency unique index `(tenant_id, source_type, source_id)` that makes the POS retry contract real — proven by direct-INSERT negative controls plus `ArLedgerIT`'s tenant-isolation test.
- `ArService`: `createAccount`/`listAccounts`/`charge`/`chargeFromOrder`/`settle`/`getStatement`/`getAging`. `charge()` (manual) and `chargeFromOrder()` (POS seam) funnel into one private `postCharge()` so the two writers cannot drift apart. Credit-limit invariant checked BEFORE any write. Every charge posts `DR 1200 / CR 4100` (or an explicit override, never the non-postable `4400`); every settlement posts `DR 1110 / CR 1200` — both via the existing idempotent `JournalEntryService.autoPostInternal`.
- Public API `/api/v1/finance/ar/*`, every method `@PreAuthorize`'d against the newly seeded `finance.ar.view`/`finance.ar.manage` permissions (auth-service changeset `038-finance-ar-permissions.xml`, registered in `db.changelog-master.xml`).
- **THE PHASE 7 SEAM**, added to the existing `InternalFinanceController` (see verbatim contract below), guarded by `FinanceInternalServiceFilter`'s `X-Internal-Service` secret, idempotent on `(tenantId, POS_ORDER, orderId)`.
- `FinanceEndpointAuthorizationIT` — finance-service's first `@PreAuthorize` reflection guard (ported from 10-09's `PurchasingEndpointAuthorizationIT`), which found and (correctly) flagged one PRE-EXISTING ungated endpoint.
- `ArLedgerIT` (real Postgres, Testcontainers): balanced-JE assertions read back from the DB (not mocks), balance math, aging buckets, and three negative controls (credit limit, RLS/tenant isolation, period lock).
- `InternalArChargeSeamIT` (real HTTP through the real Spring Security filter chain): valid-secret 200, missing-secret 403, same-`orderId`-twice idempotent (exactly 1 row, 1 JE).
- Frontend: House Accounts page (create/charge/settle/live balance) and AR Aging page, extending 10-14's four-layer Finance data layer. 8-test MSW journey suite, `tsc`/`eslint`/`next build` clean, 134/134 vitest green stack-wide.

## Task Commits

1. **Task 1: AR data layer — Flyway V6 + entities + permissions** - `ce326c9` (feat)
2. **Task 2: ArService + public AR API + internal POS seam + real-DB ITs** - `f24fa0d` (feat)
3. **Task 3: AR UI — house accounts + AR aging page** - `8699b91` (feat)

_No separate TDD red/green commits — this was a straight `type="auto"` plan; negative controls were verified interactively (inverted → watched RED → reverted → watched GREEN) rather than committed as a RED-phase commit, matching how sibling plans 10-08/10-09 handled their negative controls._

## THE PHASE 7 SEAM — verbatim contract (07-05 is written against this)

```
POST /internal/finance/ar/charges
Headers: X-Internal-Service: <restaurantos.internal.secret>   (403 INTERNAL_AUTH_REQUIRED without it)
         X-Tenant-Id: <uuid>
Body (InternalArChargeRequest):
  { branchId: UUID, customerAccountId: UUID, orderId: UUID, chargeDate: LocalDate,
    amountPaisa: long, reference: String?, revenueAccountCode: String? /* default "4100" */ }
Response 200 (ApiResponse<ArTransactionDto>):
  { id, customerAccountId, txnType: "CHARGE", amountPaisa, dueDate, journalEntryId, balanceAfterPaisa }
Semantics:
  - sourceType = "POS_ORDER", sourceId = orderId.
  - IDEMPOTENT on (tenantId, POS_ORDER, orderId): a retry returns the SAME ArTransactionDto and posts NO
    second JE. POS may retry freely on timeout.
  - 422 CREDIT_LIMIT_EXCEEDED / CUSTOMER_ACCOUNT_SUSPENDED, 404 CUSTOMER_ACCOUNT_NOT_FOUND,
    423 PERIOD_LOCKED. POS must surface these to the cashier as a tender failure and NOT close the order
    on that tender.
  - Bracket with tenantHelper.activate(tenantId) / clear() in a try/finally, exactly like autoPost().
```

**Implementation note beyond the plan's prose:** the seam actually calls `tenantHelper.activate(tenantId, req.branchId())` — a new *branch-scoped* overload of `InternalTenantContextHelper.activate()` — not the existing branchId-less `activate(tenantId)`. `JournalEntryService.autoPostInternal → create()` requires a branch in `TenantContext` (`requireBranchId`), and the branchId-less overload is the root cause of the pre-existing "Branch context required" failures in `InternalAutoPostIT`/`JournalEntryImmutabilityIT`/`JournalEntryBalanceTriggerIT`. The AR seam needed a *working* branch context to actually post JEs, so it uses the new overload; the pre-existing internal callers (period-status, generic auto-post) are untouched and remain pre-existing-broken. Phase 7's `07-05` inherits a WORKING seam because of this — no action needed on Phase 7's side.

## Files Created/Modified

**Backend (finance-service + auth-service):**
- `V6__accounts_receivable.sql` — `customer_accounts` + `ar_transactions`, RLS FORCEd, idempotency index
- `CustomerAccount`/`ArTransaction` entities, `CustomerAccountStatus`/`ArTxnType` enums
- `CustomerAccountRepository`/`ArTransactionRepository`
- `ArService`, `ArAgingCalculator`
- `ArController` (`/api/v1/finance/ar/*`)
- `InternalFinanceController` +`arCharge()` — the Phase 7 seam
- `InternalTenantContextHelper` + branch-scoped `activate(tenantId, branchId)` overload
- `FinanceGlobalExceptionHandler` +4 handlers: `CREDIT_LIMIT_EXCEEDED`(422), `CUSTOMER_ACCOUNT_SUSPENDED`(422), `CUSTOMER_ACCOUNT_NOT_FOUND`(404), `AR_SETTLEMENT_EXCEEDS_BALANCE`(422)
- `038-finance-ar-permissions.xml` — `finance.ar.view`/`finance.ar.manage`, registered in master changelog
- `pom.xml` — added `spring-security-test` (finance-service had none before this plan)
- Tests: `ArAgingCalculatorUnitTest`(6), `ArLedgerIT`(7), `InternalArChargeSeamIT`(3), `FinanceEndpointAuthorizationIT`(6)

**Frontend:** `finance.schema.ts`/`finance.adapter.ts`/`finance.repository.ts`/`use-finance.ts`/`finance.model.ts`/`query-keys.ts` (extended), `finance.handlers.ts` (extended), `finance/layout.tsx` (2 new tabs), `house-accounts/page.tsx`, `ar-aging/page.tsx`, `CustomerAccountFormDialog.tsx`, `ArChargeDialog.tsx`, `ArSettlementDialog.tsx`, `ArAgingTable.tsx`, `finance-ar-journey.test.ts` (8 tests)

## Decisions Made

- **10-18-A** (recorded in frontmatter): AR aging ages by charge `txn_date` with AP's exact bucket boundaries (0-30/31-60/61-90/91+); settlements allocated FIFO oldest-charge-first. `due_date` is stored/shown but bucketing mirrors AP.
- **10-18-B**: AR is NOT OPA-gated. A credit limit is a domain invariant on the customer account, not an approval workflow. No new rego action verb was introduced (10-07-A's vocabulary untouched). RBAC via `@PreAuthorize` still applies.
- **10-18-C**: `customer_accounts` carries `contact_name`/`contact_phone`/`contact_email` UNENCRYPTED — business-contact fields, same class as a vendor's contact (only vendor *bank accounts* go through `EncryptionService`, per 02-02/10-16). No bank-account field was added to `customer_accounts` in this plan; if one is ever added it MUST go through `EncryptionService`.
- **Pagination contract**: `GET /api/v1/finance/ar/customer-accounts` follows `AccountController`'s existing `ApiResponse.paginated` shape (`PageMeta` + `List<Dto>` in `data`), NOT 10-10's PO/invoice/expense non-paginated `ApiResponse<List<Dto>>` contract. 10-10's decision was scoped explicitly to those three list endpoints; customer-accounts is a new resource type analogous to the existing paginated CoA-accounts list, not to a PO/invoice/expense list, so it follows the sibling pattern it's closest to. Documented here per the plan's explicit instruction to record and justify this choice.
- **`ArAgingTable` was added as a new component, not `ApAgingTable` reused.** `ApAgingTable.tsx` is hard-typed to the `ApAging` domain model (`aging.totalApPaisa`), not generic over its DTO shape — reusing it for `ArAging` (`totalArPaisa`) would have required forking its prop type into a union or adding a generic parameter, which is a bigger, riskier change to a file 10-14 owns than adding one small, near-identical sibling component.
- **`FinanceEndpointAuthorizationIT` found one PRE-EXISTING ungated finance endpoint**: `PeriodController.getCurrentPeriod()`, mapped to `/internal/periods/current`. This is a genuine internal, no-user-principal, service-to-service call (guarded by `FinanceInternalServiceFilter`'s `X-Internal-Service` secret, exactly like `InternalFinanceController`/`InternalProvisioningController`) that was mistakenly declared inside `PeriodController` — a class that is otherwise a public, RBAC-gated controller. `@PreAuthorize` would be *wrong* here (no `Authentication`/authorities exist on an internal call). Rather than allowlisting the whole class (which would silently exempt any future genuinely-public method added to `PeriodController`), the reflection guard was made **path-aware**: any method mapped under `/internal/**`, in any controller, is excluded — the same principle already used for `InternalFinanceController`/`InternalProvisioningController`, generalized. No production code was changed for this pre-existing gap; only the test's exclusion logic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `InternalTenantContextHelper` needed a branch-scoped `activate()` overload**
- **Found during:** Task 2, writing `InternalArChargeSeamIT`
- **Issue:** `ArService.chargeFromOrder → autoPostInternal → create()` calls `requireBranchId()`, which throws `IllegalStateException("Branch context required")` whenever `TenantContext.getBranchId()` is empty. The existing `InternalFinanceController` pattern activates tenant context via `tenantHelper.activate(tenantId)` (branchId-less) — the exact root cause already documented as the pre-existing "Branch context required" bug affecting `InternalAutoPostIT` and two other ITs. Using that same branchId-less pattern for the new AR seam would have made `InternalArChargeSeamIT` permanently fail, defeating the whole point of pinning the Phase 7 contract with a real, green test.
- **Fix:** Added a new overload `InternalTenantContextHelper.activate(UUID tenantId, UUID branchId)` that also sets the branch, and used it ONLY in the new `arCharge()` controller method. Every pre-existing internal caller (`autoPost`, `periodStatus`) is untouched and still uses the original branchId-less `activate(tenantId)` — their pre-existing "Branch context required" failures are unchanged, confirmed by the full `mvn verify` run below.
- **Files modified:** `InternalTenantContextHelper.java`, `InternalFinanceController.java`
- **Verification:** `InternalArChargeSeamIT` 3/3 green (valid charge posts a balanced JE; missing secret 403; retry idempotent — 1 row, 1 JE)
- **Committed in:** `f24fa0d` (Task 2 commit)

**2. [Rule 3 - Blocking] `spring-security-test` was missing from finance-service's `pom.xml`**
- **Found during:** Task 2, writing `FinanceEndpointAuthorizationIT`/`InternalArChargeSeamIT` (both need `SecurityMockMvcRequestPostProcessors`/`SecurityMockMvcConfigurers`)
- **Issue:** finance-service had no `@PreAuthorize` reflection-guard IT before this plan (unlike purchasing-service, which got one in 10-09 and already carries the dependency — see decision 10-09-C). Compilation failed with "package does not exist".
- **Fix:** Added `spring-security-test` as a `test`-scoped dependency to `services/finance-service/pom.xml`, mirroring purchasing-service's.
- **Files modified:** `services/finance-service/pom.xml`
- **Verification:** `mvn test-compile` succeeds; both new IT classes run.
- **Committed in:** `f24fa0d` (Task 2 commit)

**3. [Rule 1 - Bug] `FinanceEndpointAuthorizationIT.everyPublicEndpointIsGated` initially flagged a real gap**
- Documented above under Decisions Made (`PeriodController.getCurrentPeriod()`). Fixed by making the guard path-aware rather than by adding `@PreAuthorize` to an endpoint that structurally cannot carry one (no user principal). No production code changed; only the new test's exclusion logic.
- **Committed in:** `f24fa0d` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (2 blocking, 1 bug/test-gap). All necessary to make the plan's own required tests pass for real; no scope creep beyond what the plan's own acceptance criteria demanded.

## Negative Controls — watched RED, then reverted

Per the standing lesson (10-06-A), MSW-green and "the test passed" are not accepted as proof on their own. Two independent negative controls were deliberately inverted and watched fail:

1. **Credit limit** (`ArLedgerIT.negativeControl_creditLimitExceeded_...`): temporarily short-circuited the credit-limit check in `ArService.postCharge` with `if (false && ...)`. Re-ran the single test — it failed with `Expecting code to raise a throwable` (i.e., the charge that should have been rejected silently succeeded). Reverted; re-ran — green again (7/7 in `ArLedgerIT`).
2. **RBAC gate** (`FinanceEndpointAuthorizationIT`): temporarily removed `@PreAuthorize` from `ArController.createAccount`. Re-ran the class — BOTH `everyPublicEndpointIsGated` (the reflection guard) AND `posOnlyUser_isForbidden_onEveryArMutatingEndpoint[1]` (the RBAC negative control, `POST /customer-accounts`) failed as expected (`Status expected:<403> but was:<200>`). Reverted; re-ran — green again (6/6).

Both controls are real: a control that never fails when it should is not a control, and both of these demonstrably do.

## Issues Encountered

**Real-stack click-path — attempted, NOT completed. Say-so, per the plan's explicit honesty requirement:**

The shared dev stack (gateway 8080, finance-service 8086, auth-service, etc.) is UP as local `java -jar` processes (repaired by a concurrent stack-repair agent working in parallel this session — `docker ps` confirms `restaurantos-rabbitmq` was restarted ~30 min prior). I did NOT stop this shared stack. I made real progress beyond MSW:

1. **Direct-to-service calls hang** (`curl` to `localhost:8086/api/v1/...` times out after 10s with 0 bytes, even though `/actuator/health` on the same port responds 200 instantly) — this appears to be a pre-existing infra quirk unrelated to my code (health checks pass; only proxied API routes hang when hit directly, not through the gateway).
2. **Through the gateway, real auth works**: `POST /api/v1/auth/login` with the seeded `cashier@demo.local` / `Cashier#2026` / `demo` credentials (documented in `scripts/DEV-STACK-RUNBOOK.md`) returned a real 200 with a real signed JWT.
3. **The AR route is real and reachable through the gateway**: `POST /api/v1/finance/ar/customer-accounts` with that real JWT reached finance-service (not a 404) but was rejected with **`403 FEATURE_DISABLED`** at the gateway's feature-flag layer.
4. **This is confirmed to be a PRE-EXISTING, stack-wide problem, not caused by this plan**: the SAME `403 FEATURE_DISABLED` response was reproduced on `GET /api/v1/finance/expenses` (a 10-14 endpoint that shipped and was verified working weeks ago) AND on `GET /api/v1/purchasing/vendors` (an unrelated module). Every module is currently gated off for the demo tenant at the gateway's feature-flag resolution layer — a problem with the shared dev stack's tenant-feature-flag state (likely Redis cache / `tenant_features` seeding, possibly mid-repair by the concurrent stack-repair agent's uncommitted `gateway/src/.../FeatureFlagGlobalFilter.java` changes visible in `git status`), not with my AR code or routes.
5. The privileged demo accounts that actually hold `finance.ar.manage` (`accountant@demo.local`, `owner@demo.local`) both require TOTP step-up at login (ACCOUNTANT holds `finance.period.close`, which per decision 02-02 triggers step-up) — I have no TOTP secret/code for either, so I could not obtain a JWT with AR-manage authority even once `FEATURE_DISABLED` is fixed.

**What this proves and what it does not:** the AR routes exist, are reachable through the real gateway with a real signed JWT, and the RBAC/feature-flag gates that ran ahead of my controller logic behaved exactly as designed (deny, not crash, not silently allow). It does NOT prove the full click-path (create → charge → see balance move → see the JE in `/app/finance/journal-entries` → over-limit rejection → aging → settle). That remains unverified against a live browser this session. The backend proof for AR-specific correctness is `ArLedgerIT`/`InternalArChargeSeamIT` (real Postgres, real HTTP through the real Spring Security filter chain, Testcontainers) — genuinely independent of the shared dev stack's health, and both green. The frontend proof is the 8-test MSW journey suite plus clean `tsc`/`eslint`/`next build`, which is explicitly NOT accepted as click-path proof per 10-06-A, and is not claimed as such here.

**Recommended follow-up** (not performed, out of this plan's scope): fix the stack-wide `tenant_features`/Redis feature-flag resolution for the `demo` tenant (or coordinate with whoever is mid-repair on `FeatureFlagGlobalFilter`), then re-run the plan's Task 3 manual click-path steps with `accountant@demo.local` (obtaining a TOTP code via whatever mechanism the seeded `totp_enabled=false` accounts are meant to use — note the seed data shows `totp_enabled: false` for all four demo users, which is inconsistent with the 401 `TOTP_REQUIRED` actually observed for `accountant@demo.local`; this inconsistency itself may be worth a follow-up investigation, separate from this plan).

## User Setup Required

None — no external service configuration required. `services/finance-service/pom.xml` gained one new test-scoped dependency (`spring-security-test`), already committed; no action needed.

## Next Phase Readiness

- **FIN-05's AR half is code-complete and backend-proven**: a corporate/house account can be created, charged, settled, and aged, with balanced journal entries against the seeded `1200 Accounts Receivable`, a credit limit that provably rejects (negative control watched RED), and tenant isolation that provably holds — all proven against a real Postgres via Testcontainers, not mocks.
- **Phase 7's seam is real and ready to consume**: `POST /internal/finance/ar/charges` is implemented, tested (idempotency + missing-secret 403 both proven), and its exact contract is reproduced verbatim above for `07-05`'s planner to read and build against without renegotiation.
- **Blocker for a full human-in-browser demo**: the shared dev stack's tenant-feature-flag resolution is currently broken for ALL modules (not just AR) — see Issues Encountered. This needs to be fixed independently before ANY module's Task-3-style click-path can be completed by a future session, and is out of this plan's scope to fix.
- REQUIREMENTS.md FIN-05 should flip from `In Progress` back to `Complete` once a future verification pass confirms this (that document update was not made by this plan — 10-17 already flipped it to `In Progress`; a phase-level verification/UAT pass, not this execution plan, owns re-closing it).

---
*Phase: 10-purchasing-accounts-payable*
*Completed: 2026-07-13*
