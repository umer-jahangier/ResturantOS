---
phase: 37-finance-orders-integration
plan: 08
subsystem: api
tags: [pos, register, money-events, union-query, rls]
requires:
  - phase: 37-04
    provides: the by-source journal-entry endpoint the register links to
provides:
  - "GET /api/v1/pos/transactions — the money-event register, filtered, paged, with range totals"
  - "TransactionRowDto (money-event grain), TransactionFilterRequest, TransactionRegisterPage"
affects: [37-11, 37-09, 37-12]
tech-stack:
  added: []
  patterns:
    - "Money-event grain: a split-tender order is two rows, and the order's totals ride along non-summable"
key-files:
  created:
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/TransactionRowDto.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/TransactionFilterRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/TransactionRegisterPage.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/TransactionRegisterRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/TransactionRegisterService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/TransactionRegisterController.java
key-decisions:
  - "A row is a MONEY EVENT, not an order — the central grain decision"
  - "Gate is pos.order.view.all OR finance.journal.view; the plan's pos.report.view does not exist"
  - "No terminal filter: this schema has no terminal column"
  - "Totals aggregate the whole filtered range, never the page"
requirements-completed: [FIN-12]
coverage:
  - id: D1
    description: "Every money event — tender, refund, void — queryable together for the first time"
    requirement: FIN-12
    verification:
      - kind: e2e
        ref: "GET /api/v1/pos/transactions 2026-08-01..12 → 38 rows, tendered 5853980, voided 9280, net 5844700"
        status: pass
    human_judgment: false
  - id: D2
    description: "Filters narrow correctly and the range is bounded"
    verification:
      - kind: e2e
        ref: "tenderMethod=CASH → 27 rows/4497800; eventKinds=VOID → 1/9280; 955-day range → 422 naming the 92-day limit"
        status: pass
    human_judgment: false
  - id: D3
    description: "The gate admits owner/manager/accountant and refuses a waiter"
    verification:
      - kind: e2e
        ref: "owner 200, accountant 200, waiter 403"
        status: pass
    human_judgment: false
  - id: D4
    description: "An integration test (TransactionRegisterIT) covering the eight plan behaviours"
    verification: []
    human_judgment: true
    rationale: "NOT WRITTEN. Verified live against the running stack instead. The IT the plan specifies — including the index/query-plan assertion and the cross-branch access case — does not exist, and V13__transaction_register_indexes.sql was not created."
duration: 45min
completed: 2026-08-11
status: partial
---

# Phase 37 Plan 08: Transaction Register Summary

**Every money event — tender, refund, void — is queryable together for the first time, at money-event grain, bounded and permission-gated. Verified live: 38 events, Rs 58,447.00 net.**

## STATUS: PARTIAL — query and endpoint shipped; the IT and the index migration are not written

## The grain decision, recorded

A row is a **money event, not an order**. A bill settled half cash and half card is TWO rows,
because "what came in by card today" has to be answerable and an order-grain register cannot answer
it without the caller doing arithmetic the product should have done — and doing it wrong, because a
split-tender order belongs partly to two different answers.

The order's own totals ride on each row prefixed `order*Paisa` and are **not summable**; summing
them down the column double-counts every split-tender order. `eventAmountPaisa` is the only
summable money on the row, and refunds and voids are negative so a plain sum is a net.

## The plan named a permission that does not exist

The plan specified `pos.report.view`. Checked against the seeded catalogue first — it is not there.
The plan's own reading list warns about exactly this ("a permission code appearing only in tests and
rego is NOT seeded, and guarding an endpoint with one produces an endpoint nobody in the product can
call"). What is actually seeded:

```
pos.order.view        ACCOUNTANT, CASHIER, MANAGER, OWNER, TENANT_ADMIN, WAITER
pos.order.view.all    MANAGER, OWNER, TENANT_ADMIN
finance.journal.view  ACCOUNTANT, OWNER, TENANT_ADMIN
```

`pos.order.view` is far too broad — a waiter would see every tender the business took.
`pos.order.view.all` alone excludes the ACCOUNTANT, the persona the register exists for. So either
code opens it.

## Verification Evidence (live, pos rebuilt + restarted, check-stale-jars ok)

```
GET /api/v1/pos/transactions?from=2026-08-01&to=2026-08-12
  totalRows=38  tendered=5853980  refunded=0  voided=9280  net=5844700
  (5,853,980 − 9,280 = 5,844,700 — ties)
  TENDER 2026-08-11T13:16:33 ORD-20260811-0004 CASH  336400  orderTotal=336400
  VOID   2026-08-08T19:34:41 ORD-20260807-0027  —     -9280  orderTotal=9280

?tenderMethod=CASH        → 27 rows, 4,497,800
?eventKinds=VOID          → 1 row, 9,280
?from=2024-01-01          → HTTP 422 "Date range of 955 days exceeds the maximum of 92 days"
waiter@terrace.local      → HTTP 403
accountant@terrace.local  → HTTP 200
```

## Not done

- **`TransactionRegisterIT` was not written.** The plan specifies eight behaviours as an IT,
  including a query-plan assertion and a cross-branch access case. Verified live instead, which
  covers six of the eight; the cross-branch case and the plan-shape assertion are unverified.
- **`V13__transaction_register_indexes.sql` was not created.** The register currently has no
  supporting index on `(branch_id, recorded_at)` / `(order_id)`. At 38 rows this is invisible; it
  will not be at 38,000.

## Guide claims this plan makes true

- **Claim:** "Transactions shows every payment, refund and void — one line per payment, so a bill
  split between cash and card appears twice, once for each."
  **Asserted by:** not yet — no IT exists. **Do not add this claim until one does.**

---
*Phase: 37-finance-orders-integration · PARTIAL*
