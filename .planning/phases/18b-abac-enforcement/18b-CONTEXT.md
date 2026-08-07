# Phase 18b: ABAC Enforcement — Context

**Gathered:** 2026-08-07
**Status:** Executed (18b-01)
**Source:** `.planning/research/authz-audit/RESEARCH.md` (2026-08-07) + user direction
**Branch:** `phase-13-access-repair`

<domain>
## Phase Boundary

ResturantOS has a complete, correct, exhaustively tested ABAC layer that mostly does not run.
Measured at the start of this phase:

```
$ docker run openpolicyagent/opa:1.17.1 test /policies
PASS: 139/139                            ← every rule correct
coverage: 100 | covered 781 | not covered 0   ← every rule tested

$ grep -rl "OpaClient\|AuthorizationService" services/hr-service/src/main
(no output)                              ← every hr.rego rule unreachable
```

**6 of 22 policy rules were reachable from running code. 16 were dead letters** — written,
reviewed, merged, tested to 100 % coverage, and evaluated by nothing. Four modules were entirely
dead (`hr`, `rbac`) or nearly so (`finance` 6/7, `vendor` 1/3).

The distinguishing property of this defect class is that **no existing signal can see it**.
`opa test` passes, because the policy is correct. Coverage reads 100 %, because policy coverage
measures the policy and not the system. No Java test fails, because no Java code references the
rule. The endpoint the rule was written to guard keeps working — at the weaker, RBAC-only level —
so nobody notices. It is only visible by comparing two vocabularies that live in different
languages in different directories.

The concrete cost, and this phase's headline: `hr.rego` requires `same_tenant_and_branch` on all
nine HR actions and has 28 passing tests. `EmployeeService.load(id)` used `findByIdAndTenantId` —
tenant-scoped, branch-blind. A manager at Branch A could read and modify `basicSalaryPaisa` at
Branch B. The policy forbidding it had existed, correct and tested, the whole time.

**In scope:** making every policy rule reachable or explicitly deferred; the build-time control that
keeps it that way; the OPA client's missing timeouts; a timeout test that tests a timeout; and two
catalogue repairs (`file.*`, `FINANCE_VIEWER`) from the same audit.

**Out of scope (deliberately):**
- Audit pipeline (RESEARCH Wave 1) — concurrent workstream, phase 15
- `@PreAuthorize` for inventory/kitchen (W2-7) — pure addition, no behaviour change, deferred
- Frontend nav/permission drift (RESEARCH Wave 3, N1–N8)
- The unified `restaurantos/authz/allow` entry-point refactor (RESEARCH §3.3 item 5) — a rewrite of
  all 8 policy files and all 139 tests, and an architectural preference rather than a discovery
- `user-service` — concurrent work, and the only service this phase wanted to touch there is the
  `rbac.rego` decision below
</domain>

<decisions>
## Implementation Decisions

### D-1 (LOCKED) — Reachability is a build failure, and it is checked in both directions

`PolicyReachabilityTest` (authorization-service) parses every `allow if { … }` rule out of
`policies/restaurantos/*.rego` and every `authorize("m","a",…)` / `AuthorizePayload("m","a",…)` out
of `services/*/src/main`, and fails on any mismatch. It is the sibling of
`PermissionCatalogClosureTest`, which ended the equivalent defect class for permission codes after
five outages, and it is modelled on it deliberately.

Three assertions, not one:

1. **No dead letters** — every `(module, action)` the bundle defines has a caller.
2. **No phantom call sites** — every `(module, action)` the Java code evaluates is implemented by a
   rule. OPA answers an undefined rule with `result: false`, so a phantom call site denies
   *everyone, always*: fail-closed, and a completely broken feature whose 403 is indistinguishable
   from a legitimate refusal. This is the shape of the `pos.order.void.any` outage.
3. **Every rule carries an explicit `input.action` guard** — see D-2.

**It reports rather than skips.** A call site whose arguments it cannot resolve to literals is a
failure, not a silent omission; silently dropping is how a scanner starts lying. This fired
immediately and usefully: the first implementation of `HrAuthorizationService` routed all nine
actions through one private `authorize(String action, …)` dispatcher, and the test refused it. Both
wrappers were restructured so each method names its action as a literal at the call site. That is
now a documented invariant in both classes — the enforced pair must be greppable out of the source,
because that is what the guarantee rests on.

Written first, and confirmed failing against the pre-fix tree with exactly the audit's list:

```
Expecting empty but was: ["finance/close_period", "finance/manage_coa", "finance/post_journal",
  "finance/reverse_journal", "finance/view_coa", "finance/view_journal", "hr/attendance_manage",
  "hr/attendance_view", "hr/employee_manage", "hr/employee_view", "hr/leave_approve",
  "hr/leave_view", "hr/payroll_approve", "hr/payroll_run", "hr/payroll_view",
  "pos/pos.order.discount.override", "pos/pos.order.split_bill", "rbac/manage", "vendor/manage"]
```

### D-2 (LOCKED) — Every rule guards on an explicit action (closes RESEARCH assumption A6)

`pos.rego`'s two void rules and all four `rbac.rego` rules had **no `input.action` test**, so they
matched *any* action routed to their module. Latent only while each module had a single caller: the
day a second `pos` action was added, a holder of `pos.order.void.any` would have been allowed it
outright — including the refund action, bypassing the `approval_limit_paisa` comparison that the
refund rule exists to apply.

This phase adds `input.action == "void"` and `input.action == "manage"` respectively. Both actions
were already what the existing tests passed, so **139/139 and 100 % coverage held with no test
changes** (781 → 787 covered lines, the six new guards).

The guard is also what makes `(module, action)` a total identity for a rule, which D-1's other two
assertions depend on — an unguarded rule cannot be matched to a caller at all.

### D-3 (LOCKED) — OPA decides branch isolation; the repository query stays tenant-scoped

The obvious fix for the headline defect was to change `EmployeeService.load` to
`findByIdAndTenantIdAndBranchId`. **Rejected.**

It refuses the same requests, but it refuses them as a 404 from a `WHERE` clause, and it makes the
policy check unreachable in the only case that matters — OPA would never again see a cross-branch
resource, so `hr.rego` could be deleted tomorrow with no test failing. That is the state this whole
phase exists to end.

**Decision:** load the record tenant-scoped, then hand the record's **own** tenant and branch to the
policy. The refusal is a 403 produced by `hr.rego`, and `EmployeeBranchIsolationIT` proves the
policy is what produced it. Applied identically to `PayrollRunService.load` and
`JournalEntryServiceImpl.getById`, both of which had the same branch-blind `findById`.

The corollary is written into both wrapper classes: **every method takes the resource's branch,
never the caller's.** Passing `tenantContext.getBranchId()` would compare the caller's branch
against itself, satisfy `same_tenant_and_branch` unconditionally, and produce a call site that looks
enforced and denies nothing — a dead letter with extra steps.

### D-4 (LOCKED) — The 2-second budget moves into shared-lib; the per-service override is deleted

`SharedAutoConfiguration.opaClient` built its `RestClient` with **no timeouts at all**. pos,
inventory and kitchen resolve that bean. Only authorization-service set a budget, in its own
`@Primary` `OpaConfig`.

Fail-closed has two halves and only one was implemented: `DefaultOpaClient` denies on any exception,
but a *hung* OPA produces no exception. An unbounded `RestClient` waits for it forever, holding a
Tomcat worker per request until the pool is exhausted.

**Decision:** the 2 s connect + read budget lives in `SharedAutoConfiguration`, where a direct-OPA
service cannot be built without it, and `authorization-service/config/OpaConfig.java` is **deleted**
rather than left as a second source of truth. authorization-service now resolves the same shared
client every other service does — which is also why the timeout test below covers it.

`SharedAutoConfiguration` also now provides the `AuthorizationService` bean
(`@ConditionalOnMissingBean`), so the four hand-copied per-service definitions stop being four
opportunities to diverge. Additive: any service still declaring its own is unchanged.

### D-5 (LOCKED) — A timeout test must exercise a timeout

`OpaTimeoutFailClosedIT` pointed OPA at `http://127.0.0.1:1` — a closed port, which fails
**connection-refused instantly**. It proved fail-closed on connection failure, which was never in
doubt, and could not detect D-4's defect at all: a closed port produces an exception in microseconds
whether a timeout is configured or not.

**Decision:** a real `HttpServer` stub that accepts the connection and then sleeps 10 s. Assertions
are two-sided — deny well before the stub would answer (it gave up), *and* materially slower than a
connection refusal (it really was a read timeout, so nobody can quietly revert to a dead port). It
also asserts the stub was actually reached, since a bind failure would satisfy both timing bounds
while testing nothing.

Verified to catch the real regression: with the timeout removed from `SharedAutoConfiguration`, the
request took **10.49 s** and failed. The old test passed in that same state.

### D-6 (OPEN — needs user decision) — `rbac.rego` is deferred, visibly

`rbac.rego`'s four rules (one action, `manage`) are the phase's one remaining dead letter, and
RESEARCH W2-5 marks it `[Needs user decision]`. It was **not** decided unilaterally here.

The real enforcement point is role grant/revoke in `user-service`, which has no OPA client. Wiring
it means adding a hard OPA dependency (and an `OPA_URL` in every environment) to a service under
concurrent edit; deleting it means retiring 11 passing tests and recording that `@PreAuthorize` +
`RoleCeiling.requireAssignable` is the chosen control. Today that pair is a real control — it
recomputes the acting user's permissions server-side on both read and write paths — but it does not
apply `rbac.rego`'s tenant/branch isolation clause.

**Decision:** a single entry in `PolicyReachabilityTest.DEFERRED`, carrying the reason in prose. The
registry is checked in **both** directions — an entry that has since been wired fails as a stale
suppression, and an entry naming a rule that no longer exists fails too — so a deferral cannot rot
quietly and cannot be used to hide a rule someone later deletes. Every *new* dead letter is still a
build failure. This is a visible, reviewable omission rather than a hole.

### D-7 (LOCKED) — `discount.override` gates ORDER-scope discounts only

`pos.rego`'s `pos.order.discount.override` is held by OWNER, MANAGER and TENANT_ADMIN — the same set
as `pos.order.discount.order`, and **not** CASHIER, who holds `pos.order.discount.line`. Calling the
rule on every discount would have stopped cashiers applying line discounts, which is a working
feature.

**Decision:** bind it to whole-order discounts. This adds the policy's tenant/branch and resource
test to the manager-level action without withdrawing anything anyone can do today.
`lineScopeDiscount_doesNotConsultThePolicy` is the guard on that boundary — if the gate is ever
widened, it fails.

### D-8 (LOCKED) — The internal auto-posting seam is not gated on a user permission

Wiring `post_journal` into `JournalEntryServiceImpl.create/post` broke 27 auto-posting tests, and
correctly so: `autoPostInternal` — the seam POS, HR, inventory and purchasing post the ledger
through — calls both. It arrives on `/internal/**` behind the shared-service secret carrying a
system identity, and asking OPA whether "the caller" holds `finance.journal.post` denies every
automatic posting in the platform.

**Decision:** the gate sits on the user-facing entry points; `createInternal`/`postInternal` carry
the mechanics and no authorization. A second, smaller correction came out of the same work: hoisting
the gate to the top of `create` changed the *order* in which it fails, so a post to a LOCKED period
with no branch context reported "Branch context required" instead of 423 PERIOD_LOCKED. The gate now
sits next to the branch it needs, after the period check. Neither answer is a security decision, and
the caller has already cleared `@PreAuthorize`.

### D-9 (LOCKED) — `file.*` is three codes, and delete is its own

file-service had **five endpoints behind `.authenticated()` and nothing else** — no
`@PreAuthorize`, no OPA, and no `file.*` code in the 65-permission catalogue. A KITCHEN_STAFF token
holding exactly `pos.kds.view` and `pos.kds.update` could `DELETE /api/v1/files/{id}` and succeed on
any file in the tenant.

**Decision:** `file.view` (read), `file.upload` (write), `file.manage` (delete). Delete is kept
apart deliberately: it is the only irreversible operation of the five, and folding it into
`file.upload` hands it to every role that attaches an invoice scan. ACCOUNTANT and
INVENTORY_MANAGER get view + upload; CASHIER, WAITER and KITCHEN_STAFF get none.

No Rego module for files. Tenant isolation already comes from RLS + `TenantContext`; these codes
answer "may this role touch files at all", which is the question nothing was asking. A resource-
scoped file policy (per-branch document ownership) remains open — see W-18b-03.

### D-10 (LOCKED) — `FINANCE_VIEWER`'s orphan grants are deleted, and the reason is corrected

RESEARCH L1 reported `FINANCE_VIEWER` as a `role_code` with 2 grants and no `roles` row, which is
correct. Its inferred cause was not, and the difference matters for what fixes it.

The audit attributed it to `context="seed"`. Checked live, that is wrong — the seed context ran:

```
auth_db=# SELECT id, contexts, dateexecuted FROM databasechangelog WHERE id LIKE '%035%';
 auth-1.0.0-035-seed-system-roles | seed | 2026-06-24 00:34:12
```

`035` executed on 2026-06-24 with the six roles it declared *then*. `FINANCE_VIEWER` was added to
that changeset on 2026-06-27 in commit `b63074a`, and `runOnChange="false"` meant the edit never
re-applied. The same mechanism changeset 057 documents one table over.

**Consequence for the fix:** no repository-reading test can catch this, because the repository is
correct — only the deployed rows are wrong. So the repair must be a migration (082), and it verifies
itself with a `RAISE` over *every* `role_code`, in the shape 056 and 057 use.
`RoleCatalogClosureTest` covers the other half — a grant naming a role the changelog never declares
— and its javadoc says plainly that it does not cover this one, rather than implying coverage it
does not have.

The grants are deleted rather than the role created: `035`'s own comment calls `FINANCE_VIEWER`
"Dev-only", ACCOUNTANT covers the real capability, and creating the role in every production
database to satisfy a foreign-key-shaped invariant would ship a dev affordance to customers.

### D-11 (LOCKED) — Test fallout is fixed by narrowing stubs, never by blanket allows

Wiring live policy into four services broke 40 tests that used a now-gated call as a *fixture*.
The tempting fix — `when(client.authorize(any())).thenReturn(allow)` in each test base — would also
have satisfied `approve_po`, `close_po` and expense `approve`, whose **deny paths several ITs assert
against real approval limits**. Those assertions would have gone green while proving nothing.

**Decision:** every default stub is matched on the specific action it enables
(`"manage"` in purchasing; the six ledger actions in finance), leaving every pre-existing
expectation exactly as it was. Where a test narrows its own principal, the fixture grants itself the
permission and restores it, so what the test asserts is still decided entirely by the permissions it
chose. `PurchaseOrderApprovalIT.approve_deniedByOpa`'s blanket deny was likewise narrowed to
`approve_po` — it was refusing the test its own vendor fixture.
</decisions>

<constraints>
## Constraints Honoured

- **Fail closed everywhere.** Unreachable, slow, or unparseable OPA denies. The Feign wrappers
  translate transport exceptions into `PermissionDeniedException` rather than letting them surface
  as 5xx — closed either way, but an authorization outcome should not report a server fault.
- **No currently-enforced rule weakened.** The six live rules are untouched; `@PreAuthorize` is
  added to file-service and removed nowhere.
- **`opa test policies/` stays at 139/139 and 100 % coverage.** Held (781 → 787 covered lines).
- **shared-lib edits small, additive, rebuilt early** (coordination with the concurrent audit-repair
  agent): one timeout constant, one `@ConditionalOnMissingBean` bean, installed before any dependent
  service was touched.
- **No root-level reactor build.** Every module built and verified individually.
- **GitNexus `impact` before editing**, per CLAUDE.md: `SharedAutoConfiguration.opaClient` (MEDIUM —
  three services resolve it by bean graph; the change only narrows behaviour) and
  `EmployeeService.load` (LOW — three callers, all in-class). Neither HIGH nor CRITICAL.
</constraints>

<deferred>
## Deferred

| ID | Item | Why |
|---|---|---|
| **W-18b-01** | `rbac.rego`: wire into user-service or delete | D-6 — needs a user decision; registered in `DEFERRED` and checked both ways |
| **W-18b-02** | `@PreAuthorize` on inventory (39) + kitchen (6) endpoints | RESEARCH W2-7/M6. Pure addition, no behaviour change — the Rego rules already test the same codes. Defence in depth is one layer deep there until then |
| **W-18b-03** | Resource-scoped file policy (branch/ownership of uploaded documents) | D-9 — needs a product decision on whether documents are branch-scoped |
| **W-18b-04** | `pos.till.reconcile.override` — granted to 3 roles, referenced by zero lines | RESEARCH L2. Delete or implement the endpoint it was meant to gate |
| **W-18b-05** | Stale `target/` artefacts (`FinanceServiceApplication 2.class`, `HrServiceApplication 2.class`, `TestFixtures 2.class`) break `repackage` on an incremental build | Pre-existing, not introduced here; `mvn clean` clears it. Worth a CI guard |
| **W-18b-06** | `AccountController.java` has `\r\r\n` line terminators | Pre-existing corruption; normalising it would produce a whole-file diff and collide with concurrent finance work. Edited byte-exactly instead |
</deferred>

---

## D-18b-01 — `rbac.rego` is RETIRED, not wired (decided 2026-08-07)

18b correctly declined to decide this and left it in the deferral registry. Decision: **delete
`rbac.rego` and record `@PreAuthorize` + `RoleCeiling` as the chosen control for role
grant/revoke.**

### Why not wire it into user-service

Because a second control over the same decision is the exact defect that produced this
phase's worst finding.

The privilege escalation closed in 13-11 existed because role assignment had **two places**
that could decide it and only one of them checked: `GET /api/v1/roles` filtered the picker by
the caller's ceiling, while `POST /api/v1/users/{id}/branch-roles` had no check at all. A
TENANT_ADMIN could assign itself OWNER and receive 200. The fix was explicitly to make
`RoleCeiling.permits` **the single shared rule**, used by the picker and the write path alike,
so the two cannot drift.

Adding an OPA rule for the same decision reintroduces exactly what was just removed: two
authorities over one question, in two languages, in two repositories' worth of test suites,
which agree today and are one edit away from disagreeing silently.

### Why `RoleCeiling` is the right survivor

- It is enforced **server-side in auth-service**, which owns `user_branch_roles` and
  `role_permissions` — the data the decision is about. OPA would have to be told the ceiling;
  auth-service already knows it.
- It **recomputes the caller's permissions from the database on every call**. The acting user's
  identity crosses the internal seam as an identity, never as an entitlement, so a forged
  header buys nothing.
- It is **fail-closed and measured**: acting as MANAGER, granting OWNER returns
  `403 ROLE_CEILING_EXCEEDED` with zero rows written; a missing acting-user header returns
  `403 ACTING_USER_REQUIRED`; and the OWNER→MANAGER control still returns 200, proving it
  enforces a ceiling rather than blocking everything.
- ABAC earns its place where a decision depends on **attributes the service does not own** —
  tenant, branch, ownership, time. `hr.rego`'s `same_tenant_and_branch` is the model case, and
  wiring it closed a live cross-branch salary leak. A role ceiling is not that shape: it is a
  pure function of two permission sets auth-service already holds.

### What must be true for this decision to stand

The reachability registry must record `rbac.rego` as **deliberately retired**, not merely
absent, so its deletion cannot later read as an oversight — and `PolicyReachabilityTest` keeps
failing the build for any OTHER rule that becomes a dead letter. If role assignment ever needs
a time-of-day, device or location attribute, this decision is revisited and ABAC is the right
answer then.
