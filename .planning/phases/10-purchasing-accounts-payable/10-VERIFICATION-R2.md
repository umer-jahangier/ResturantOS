---
phase: 10-purchasing-accounts-payable
status: passed_with_gaps
date: 2026-07-14
method: real stack, real services, real DB, real seeded users — no mocks, no stubs
---

# Phase 10 — Verification Round 2

The phase goal — **procurement runs end-to-end with financial integrity** — is now
demonstrably TRUE. A manager creates a vendor, raises a PO, gets it approved, sends it,
receives it per-line, matches an invoice against it, and pays it; every step posts a
balanced journal entry.

This had **never once worked** before this round, despite 18 plans reporting green.

## Verified end to end (real HTTP, real DB)

| # | Step | Result |
|---|------|--------|
| 1 | Vendor create with bank account | ✅ `bankAccountLast4: "6702"` — **no plaintext anywhere** (PUR-01) |
| 2 | PO create, 2 lines, Rs 49,000.00 | ✅ `DRAFT` |
| 3 | Submit | ✅ `PENDING_APPROVAL` |
| 4 | **Approve** | ✅ `APPROVED`, `tiersApproved 1/1` — **the phase's central failure, now working** (PUR-02) |
| 5 | Send | ✅ `SENT` |
| 6 | **Per-line partial receipt** (60/100 and 50/50 — *different qty per line*) | ✅ `PARTIALLY_RECEIVED` (not FULLY), GR/IR journal entry `POSTED` (PUR-03) |
| 7 | Vendor invoice, 3-way match | ✅ `MATCHED`, Rs 39,000.00 = exactly the received quantities (PUR-04) |
| 8 | AP payment | ✅ `PAID`; JE = `DR 2100 Accounts Payable 3,900,000 / CR 1110 Bank 3,900,000` |
| 9 | Expense create (account 6300) | ✅ `200 PENDING_APPROVAL` — was 400 INVALID_ACCOUNT_CODE **100% of the time** (FIN-05) |
| 10 | RBAC: cashier creates vendor | ✅ **403** |
| 11 | RBAC: cashier approves PO | ✅ **403** |
| 12 | Ledger integrity | ✅ **every journal entry balances** (debits == credits, all rows) |
| 13 | Cashier UI (browser) | ✅ Purchasing hidden from nav; `/app/purchasing` shows honest access-denied |
| 14 | PO detail page (browser) | ✅ loads with live Approve / Reject / Withdraw buttons |

## The four root causes fixed this round

All four were invisible to the test suite — unit, real-Postgres IT, and real-OPA
container IT were all green while the module did not work.

1. **`990026a` — the caller never forwarded the user's JWT.**
   `/internal/authorize` is dual-gated: the X-Internal-Service secret proves the *caller*
   is a trusted service; the JWT proves the *subject* is a real user (the endpoint reads
   `JwtClaims` off the SecurityContext to decide on that user's permissions/tenant/branch).
   purchasing-service and finance-service sent the secret but **not the Authorization
   header**, so authorize was rejected and purchasing surfaced it as a 503.
   **No PO could be approved by anyone.** Expense approve/reject shared the defect.
   *The OPA ITs stub `AuthorizationClient` — they exercise the policy, never the call path.*

2. **`2099ac0` — the RLS tenant GUC was discarded before `BEGIN`.**
   `TenantAwareDataSource` set `app.current_tenant_id` with `set_config(..., true)`
   (**transaction-local**) at connection checkout. Spring checks the connection out of the
   pool *before* issuing `BEGIN`, so the setting landed in its own implicit transaction and
   vanished. Every `@Transactional` write then ran **tenant-blind** and RLS hid every row.
   Proven from the Postgres statement log:
   ```
   SELECT set_config($1,$2,true)   <- local GUC, no txn open -> discarded
   BEGIN                            <- starts with no tenant
   select ... from chart_of_accounts where tenant_id=$1 and code=$2   -> 0 rows
   ROLLBACK                         -> INVALID_ACCOUNT_CODE
   ```
   A **shared-lib bug affecting every service's RLS write path**, not a finance quirk.
   Fixed session-scoped + reset-on-close; isolation re-verified (no GUC → 0 rows; demo
   cannot see dev's rows; 0 pooled connections retain a tenant).

3. **`d36f8fa` — internal auto-post never received a branch.**
   `InternalFinanceController.autoPost` activated tenant context *without* a branch, but
   `requireBranchId()` reads it off `TenantContext` → `"Branch context required"` (400). So
   **a GRN receipt could never post its GR/IR entry**. The `branchId` was on the request
   body all along, and plan 10-18 had already added the `activate(tenantId, branchId)`
   overload — its javadoc even names this as the root cause of the three failing ITs.
   Nobody wired it up.

   > **Those three ITs — `InternalAutoPostIT`, `JournalEntryImmutabilityIT`,
   > `JournalEntryBalanceTriggerIT` — were dismissed across this entire phase as
   > "pre-existing test noise, do not chase". They were reporting a real production bug in
   > the order-to-ledger path.**

4. **`2fda589` / `56bada9` — frontend.** Purchasing had no `PermissionGuard` and its nav
   entries never set `permission:` (a cashier saw the whole module with a live "Add vendor"
   button). PO/invoice detail pages used the pre-Next-15 sync `params`, so `params.id` was
   `undefined` and the pages hung on "Loading…" forever — no action button ever rendered.

Also fixed: `4b75579` (demo tenant had **no feature flags at all**, so the module was
invisible to every user), and a seeded-UUID collision with the Phase 7 KDS users that
stopped auth-service booting entirely.

## Still open — stated plainly

| Gap | Why |
|-----|-----|
| **Distinct-approver 409** (10-07) | Needs a PO above the single-tier limit; not exercised. The rule ships and is unit-tested, but no human has driven it. |
| **Expense approve/reject** | Create is verified; approve/reject goes through the same authorize path as PO approve (now fixed) but was not driven end-to-end. |
| **AR write path** (10-18) | **Never exercised.** No usable seeded persona holds `finance.ar.manage` — only OWNER/TENANT_ADMIN/ACCOUNTANT do, and OWNER/ACCOUNTANT are permanently TOTP-locked. `manager1` gets 200 on AR read, 403 on AR write. FIN-05's AR half remains unverified. |
| **POS "charge to account"** | Phase 7 item `07-09`, still open. Until it lands, AR has a seam but no writer. |
| **Analytics period/vendor pickers** | Wired and unit-tested; not re-driven in the browser this round. |
| **Vendor create idempotency** | A transient 503 that had succeeded, retried, creates a duplicate vendor. `IdempotencyService` exists in shared-lib and is unused here. |

## Standing blocker (Phase 2 scope, not Phase 10)

**OWNER and ACCOUNTANT accounts are permanently bricked.** `requiresTotpStepUp()` forces TOTP
for any holder of `rbac.manage` or `finance.period.close`, but enrolment requires an
authenticated session and neither has an enrolled secret. Any real tenant promoting a user to
those permissions before they enrol 2FA is locked out identically. Needs an enrolment-gated
token state.

## The lesson, sharpened

Round 1's lesson (10-06-A) was *"verify the real path, not mocks."* Every plan obeyed it — at
the backend layer — and the module still didn't work.

Backend integration tests verify the **callee**. Nothing verified the **caller**, the
**browser**, or the **persona**. Three of the four blockers lived precisely in those seams:
a Feign interceptor that didn't forward a header, a DataSource that set a GUC one statement too
early, a controller that dropped a field on the way through. Every one of them is invisible to a
test that stubs the boundary it crosses.

And the codebase *told us*: three ITs failed with the exact error, and a javadoc named the exact
fix. Both were fenced off as noise.

**A phase is not done until a real user completes the journey against the real stack.**
