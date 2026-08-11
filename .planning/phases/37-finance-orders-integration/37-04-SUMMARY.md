---
phase: 37-finance-orders-integration
plan: 04
subsystem: api
tags: [finance, journal-entries, traceability, rls, flyway, testcontainers]

requires:
  - phase: 22-financial-wiring
    provides: the populated source_type/source_id columns and posted_source_events index
provides:
  - "GET /api/v1/finance/journal-entries/by-source/{sourceId}?sourceType= — every entry a source produced"
  - "JournalEntryService.listBySource(UUID sourceId, String sourceType)"
  - "JournalEntryRepository.findAllBySourceId / findAllBySourceIdAndSourceType"
  - "finance migration V10 — idx_journal_entries_tenant_source"
  - "scripts/e2e/phase37-journal-traceability-e2e.sh — live RLS verification as the real role"
affects: [37-08, 37-11]

tech-stack:
  added: []
  patterns:
    - "Assert the POLICY in a Testcontainers IT; assert row invisibility live as the non-superuser role"

key-files:
  created:
    - services/finance-service/src/main/resources/db/migration/V10__journal_entry_source_index.sql
    - services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryTraceabilityIT.java
    - scripts/e2e/phase37-journal-traceability-e2e.sh
  modified:
    - services/finance-service/src/main/java/io/restaurantos/finance/repository/JournalEntryRepository.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/JournalEntryService.java
    - services/finance-service/src/main/java/io/restaurantos/finance/service/JournalEntryServiceImpl.java
    - services/finance-service/src/main/java/io/restaurantos/finance/web/JournalEntryController.java
    - services/finance-service/src/test/java/io/restaurantos/finance/FinanceTestBase.java

key-decisions:
  - "Keyed on source_id ALONE, not the (sourceType, sourceId) pair the plan specified"
  - "listBySource is NOT branch-filtered — an order's entries must all be visible when tracing it"
  - "Testcontainers asserts the policy; the live harness asserts invisibility"

patterns-established:
  - "Check the shape of real data before writing a query whose correctness depends on it"

requirements-completed: []

coverage:
  - id: D1
    description: "An order id yields every journal entry it produced, across all source types"
    requirement: FIN-11
    verification:
      - kind: integration
        ref: "JournalEntryTraceabilityIT#orderProducingRevenueAndCostOfSales_returnsBoth (7/7 suite)"
        status: pass
      - kind: e2e
        ref: "GET /journal-entries/by-source/0dc09465… → 2 entries, both balanced"
        status: pass
    human_judgment: false
  - id: D2
    description: "A source that produced nothing returns 200 + empty, not 404"
    verification:
      - kind: e2e
        ref: "GET by-source/00000000-…-0001 → HTTP 200 {\"data\":[]}"
        status: pass
    human_judgment: false
  - id: D3
    description: "Cross-tenant invisibility is enforced by the row-level policy"
    verification:
      - kind: e2e
        ref: "phase37-journal-traceability-e2e.sh 8/8 as finance_user (usesuper=f)"
        status: pass
      - kind: integration
        ref: "JournalEntryTraceabilityIT#journalEntriesIsForceRlsWithATenantPolicy…"
        status: pass
    human_judgment: false
  - id: D4
    description: "The endpoint is refused without finance.journal.view"
    verification:
      - kind: e2e
        ref: "cashier@terrace.local → HTTP 403"
        status: pass
    human_judgment: false
  - id: D5
    description: "Task 2 — a journal entry names its source in words an owner recognises"
    verification: []
    human_judgment: true
    rationale: "NOT STARTED. SourceReferenceResolver, SourceReferenceDto, PosLookupClient and the four-state resolved/unresolvable/failed/absent contract do not exist. 37-11 will render raw UUIDs until this lands."

duration: 50min
completed: 2026-08-11
status: partial
---

# Phase 37 Plan 04: Journal Entry Traceability Summary

**An order id now returns every journal entry it produced — revenue, cost-of-sales and refund — through a permission-guarded, index-backed endpoint, verified live with balanced entries. The human-readable source reference (task 2) is not built.**

## STATUS: PARTIAL — task 1 of 2 complete

Task 1 is done and verified against the live stack. **Task 2 is not started.**

## The plan's query key was wrong, and the plan's own objective says why

The plan specifies a repository query "resolving a `(sourceType, sourceId)` pair". That returns
**exactly one** entry, because `posted_source_events` is `UNIQUE (tenant_id, source_type, source_id)`
— while a closed order posts up to three entries under three *different* types sharing one
`source_id`.

I checked the live ledger before writing the query:

```
source_id                              types                       count
0dc09465-9999-4476-b901-1205cc6b89dd   ORDER_COGS,ORDER_REVENUE      2
cc69fb6e-9fa9-41fc-872d-aa0b33273309   ORDER_REFUND,ORDER_REVENUE    2
fffecf0a-edc8-4304-b6cb-90eafd828e2e   ORDER_COGS,ORDER_REVENUE      2
```

So the lookup is keyed on `source_id` alone, with `sourceType` as an optional narrowing. Following
the plan literally would have shipped precisely the *"plausible partial answer, which is worse,
because it looks complete"* that the plan's own objective warns against.

## The Testcontainers RLS blind spot — measured, not assumed

My first version of behaviour 4 asserted that another tenant's entries are invisible. It **failed**.
That was not a leak. Testcontainers creates `POSTGRES_USER` as a SUPERUSER, and a superuser is
exempt from FORCE row-level security:

```
Testcontainers postgres:16, POSTGRES_USER=finance_user
    select current_user, usesuper …  →  finance_user | t
live dev database, same role name
    select current_user, usesuper …  →  finance_user | f
```

A row-visibility assertion there fails against a *correct* policy and — far worse — proves nothing
when it passes. This repository shipped three RLS defects behind exactly that green suite in phase 13
(13-02, 13-06, 13-08).

So the split is:
- **IT** asserts `relrowsecurity` AND `relforcerowsecurity` are both true and a `pg_policies` row
  exists — the part this context can answer honestly.
- **Live harness** (`phase37-journal-traceability-e2e.sh`) asserts actual row invisibility as the
  real non-superuser role, and **refuses to run as a superuser** rather than reporting a
  meaningless PASS.

## Verification Evidence

### Integration — real Postgres container

```
mvn -pl services/finance-service verify -Dit.test=JournalEntryTraceabilityIT
  Tests run: 7, Failures: 0, Errors: 0 — 9.788 s
  BUILD SUCCESS
```

### Live — finance-service rebuilt, restarted, `check-stale-jars.sh` → `ok finance-service (pid 16928, inode 48425279)`

```
$ bash scripts/e2e/phase37-journal-traceability-e2e.sh
PASS: connected as finance_user, usesuper=f — the policy genuinely applies to this session
PASS: journal_entries: RLS enabled AND forced
PASS: no tenant GUC -> 0 journal entries visible
PASS: tenant A sees 104 entries, tenant B sees 5 — both non-empty, so the next check is real
PASS: source 309e5a8f… is visible to its OWN tenant (1 entries)
PASS: the SAME source id returns 0 entries for a different tenant — the policy, not app code
PASS: idx_journal_entries_tenant_source present
PASS: order 0dc09465… produced 2 entries (ORDER_COGS,ORDER_REVENUE) — a (type,id) PAIR query returns 1 of them
PASS: 8   FAIL: 0
```

### Live — the endpoint through the gateway, as `accountant@terrace.local`

```
GET /api/v1/finance/journal-entries/by-source/0dc09465-9999-4476-b901-1205cc6b89dd
entries returned: 2
  JE-2027-000044  ORDER_REVENUE  debits=  336400  credits=  336400  BALANCED
  JE-2027-000045  ORDER_COGS     debits=   12500  credits=   12500  BALANCED
all entries balanced, and each header total matches the sum of its own lines

  revenue entry lines: 1010 DR 336400 · 4100 CR 290000 · 2200 CR 46400

GET by-source/00000000-0000-0000-0000-000000000001  → HTTP 200 {"data":[],"meta":null,"warnings":[]}
GET by-source/0dc09465…?sourceType=ORDER_COGS       → 1 entry, type=ORDER_COGS
GET by-source/0dc09465…  as cashier@terrace.local   → HTTP 403
```

Debits equal credits on **real persisted rows**, read back over HTTP — not asserted against a mock.

## Deviations from Plan

**1. [Rule 1 – Bug] Query keyed on `source_id`, not the `(sourceType, sourceId)` pair.** See above.

**2. [Rule 1 – Bug] `listBySource` is not branch-filtered,** unlike the sibling list reads. A journal
entry's branch and the caller's current branch scope are different questions; filtering would hide
entries from an owner tracing an order. Tenant isolation is unaffected — it comes from RLS.

**3. [Rule 3 – Blocking] `FinanceTestBase` could not connect to its container.** Added
`sslmode=disable` + `tcpKeepAlive=true`. Committed separately as `161d681` with the environment
correction, since it is the fix that disproved my own false "Testcontainers cannot run here" claim.

## Not done — task 2

`SourceReferenceResolver`, `SourceReferenceDto`, `PosLookupClient`, the four-state
resolved / unresolvable-for-type / lookup-failed / absent contract, the opt-in list flag, and the
degradation-under-unavailable-pos behaviour are **all unbuilt**. Until they land, 37-11 can link a
journal entry to its order id but must render a raw UUID rather than an order number.

## Guide claims this plan makes true

Per 37-02's governing rule — recorded here, NOT written into `claims.json`:

- **Claim:** "Open any entry in your accounts and you can see the order it came from; open an order
  and you can see every entry it created — the sale, the cost of the food, and any refund."
  **Asserted by:** `services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryTraceabilityIT.java`
  → `orderProducingRevenueAndCostOfSales_returnsBoth` and `orderLaterRefunded_returnsTheRefundEntryToo`
  **Literals:** `ORDER_REVENUE`, `ORDER_COGS`, `ORDER_REFUND`
  **Caveat for 37-13:** the "in words an owner recognises" half depends on task 2. Until then the
  claim is true of ids, not of names — do not phrase it as naming the order number.

## Known Stubs

None in what shipped. Task 2's absence is a gap, not a stub — nothing renders a fake reference.

## Threat Flags

None new. The endpoint takes no tenant parameter and carries the seeded `finance.journal.view`.

## Next Phase Readiness

- **37-08 and 37-11 can use `by-source` now**, and the V10 index makes the per-row lookup cheap.
- **37-11 must not render a source reference as a name until task 2 lands** — it has ids only.

---
*Phase: 37-finance-orders-integration*
*Completed: 2026-08-11 (PARTIAL — task 1 of 2)*
