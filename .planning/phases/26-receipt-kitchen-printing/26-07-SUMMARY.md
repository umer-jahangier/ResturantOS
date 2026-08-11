---
phase: 26
plan: "07"
subsystem: print
status: complete
tags: [print, kitchen-ticket, dispatch, transactions, after-commit, reconciliation]
requires:
  - 26-01 (PrintDocument and its kitchen-ticket restrictions)
  - 26-03 (print_jobs, uq_print_jobs_revision, PrintJobService)
  - 26-04/26-06 (the agent renderer that will print these)
provides:
  - "`PrintDocument.Ticket` — the kitchen routing block, refused on a customer receipt"
  - "`KitchenTicketAssembler` — one ticket per station, only the newly-fired lines, no money"
  - "`PrintDispatchService` — after-commit dispatch on the fire and the close seams"
  - "`PrintJobService.enqueueKitchenTicket` / `.enqueueReceipt` — the agent-bound write path"
  - "`PrintJobRepository.findFiresWithNoTicket` + `scripts/reconcile-missing-kitchen-tickets.sql`"
affects:
  - shared-lib (PrintDocument gains a component; contracts/print fixture regenerated)
  - print-agent (contract parser + kitchen renderer)
  - frontend (print zod schema — strictObject would otherwise reject every receipt)
  - pos-service (OrderServiceImpl fire and close seams, PrintJobServiceImpl, PrintJobRepository)
tech-stack:
  added: []
  patterns:
    [
      after-commit-dispatch,
      one-transaction-per-ticket,
      the-index-is-the-idempotency-key,
      unrouted-is-a-row-not-a-silence,
      state-the-gap-then-query-for-it,
    ]
key-files:
  created:
    - services/pos-service/src/main/java/io/restaurantos/pos/service/KitchenTicketAssembler.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PrintDispatchService.java
    - services/pos-service/src/test/java/io/restaurantos/pos/KitchenTicketAssemblerIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PrintDispatchIT.java
    - scripts/reconcile-missing-kitchen-tickets.sql
  modified:
    - shared-lib/src/main/java/io/restaurantos/shared/print/PrintDocument.java
    - shared-lib/src/test/java/io/restaurantos/shared/print/PrintDocumentContractTest.java
    - contracts/print/golden-receipt-document.json
    - print-agent/src/contract/print-document.schema.ts
    - print-agent/src/render/escpos-renderer.ts
    - print-agent/test/escpos-renderer.test.ts
    - frontend/lib/api-client/schemas/print.schema.ts
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PrintJobService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PrintJobServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/ReceiptDocumentAssembler.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/PrintJobRepository.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PrintJobIssuanceIT.java
decisions:
  - "Dispatch is an after-commit TransactionSynchronization, never REQUIRES_NEW inline and never same-transaction-with-try/catch"
  - "One transaction PER TICKET, so the hot pass duplicating does not stop the cold pass printing"
  - "The unique index IS the dispatch idempotency key; the guard is the database, not a lookup"
  - "An unrouted station writes a FAILED row naming the station; a branch with no RECEIPT printer writes nothing at all"
  - "PrintDocument gains a Ticket component rather than smuggling chef metadata through Header.addressLines"
  - "The after-commit gap is real, is stated, and is covered by a checked-in reconciliation query"
metrics:
  duration: ~4h
  completed: 2026-08-12
commits:
  - e5330de0 feat(26-07) — task 1, the ticket
  - 89a5b5aa feat(26-07) — task 2, dispatch
---

# Phase 26 Plan 07: Kitchen Ticket Dispatch Summary

Firing an order now writes a durable kitchen ticket per station, and closing one writes the
customer receipt — and **nothing about printing can stop either transition**, proven by forcing a
real database constraint breach rather than a mocked exception.

## Where the calls sit

| Seam | File:line | Registers |
| --- | --- | --- |
| `sendToKds` | `OrderServiceImpl:615`, immediately after the `ORDER_SENT_TO_KDS` publish | `dispatchKitchenTicketsAfterCommit(orderId, branchId, revisionNo, firedItemIds)` |
| `performClose` | `OrderServiceImpl:878`, immediately after the `ORDER_CLOSED` publish | `dispatchReceiptAfterCommit(orderId, branchId)` |

Both are the LAST thing in their method and neither changes a byte of the payloads five downstream
services consume. `firedItemIds` is the set `sendToKds` itself just stamped — the ticket consumes
the revision machinery's decision rather than re-deriving it.

## The propagation boundary, and why the two obvious alternatives are wrong

**Same transaction with a try/catch** — an insert that breaches a constraint inside the caller's
transaction marks it **rollback-only**, and catching the Java exception *does not clear the flag*.
The fire would still fail at commit, with a caught exception and no explanation.

**`REQUIRES_NEW` invoked inline, before commit** — the ticket commits independently and then
survives a fire that rolled back. The kitchen cooks an order that does not exist. Under D-26-06 the
cook is in a different building from the database, so nobody notices until the plate arrives.

**What ships: after-commit.** A rollback-only flag cannot reach a transaction that has already
committed, and a callback registered on a rolled-back transaction never runs.

Both rejections are recorded in `PrintDispatchService`'s class comment, not only here, because both
read as correct in review.

## Status values a caller can rely on

| Situation | Row written | status | last_error |
| --- | --- | --- | --- |
| Station routed | one per station | `QUEUED` | null |
| Station has no printer | one per station | `FAILED` | `UNROUTABLE: no kitchen printer configured for station <CODE>` |
| Close, branch has a RECEIPT printer | one | `QUEUED` | null |
| Close, branch has none | **none at all** | — | — |
| Enqueue itself failed (duplicate, serialisation, unreachable settings) | none | — | ERROR log + reconciliation query |

"Prints in the browser" and "printer is broken" are distinguishable in the data: **no row** versus a
**FAILED row**. That distinction is asserted, not just documented.

## The gap this design has, stated rather than hidden

A process death between the fire's COMMIT and the dispatch transaction loses that ticket **with no
row to show for it**. The kitchen display is unaffected — it is event-driven and remains the source
of truth — so the food still gets cooked, but the paper is silently absent.

Closed with detection: `scripts/reconcile-missing-kitchen-tickets.sql` and
`PrintJobRepository.findFiresWithNoTicket`. The test drives it **by killing dispatch between commit
and enqueue** and asserting the missing fire comes back, and that nothing comes back when dispatch
worked. A reconciliation query nobody has watched return a row is one nobody knows works.

## Negative controls — ten, every one verified to land

**Task 1 (four).** Ignore the fired-item set → the revision test red. Real money on the line amounts
→ the generic money scan red. Drop unstationed items → the UNASSIGNED test red. Hide the
order-level instruction → the allergy-line test red.

> **One of these passed first time and it was my patch's fault, not the test's.** The money sabotage
> ran green; the replacement string had 24 spaces of indentation and the file has 16, so it never
> landed. Re-applied with `assert old in s` guarding every subsequent sabotage, it goes red on
> `noMoneyAnywhereOnTheTicket`. This is the second time in this phase a "surviving" sabotage was a
> bad sabotage — the guard is now in the script rather than in my attention.

**Task 2 (six).** Each one landed on exactly the test that should catch it:

| Sabotage | Went red |
| --- | --- |
| revert to same-transaction + try/catch | `aDuplicateRaisedDuringTheFire…`, `anAssemblerFailure…`, `noPrintWorkExecutesBeforeCommit` |
| dispatch inline, before commit | `aRolledBackFireEnqueuesNothing`, `noPrintWorkExecutesBeforeCommit` |
| silently drop an unrouted station | `anUnroutedStationWritesAVisibleRow`, `firingEnqueuesOneQueuedJobPerStation` |
| enqueue a receipt with no printer | `aBranchWithNoReceiptPrinterEnqueuesNothing` |
| reconciliation that finds nothing (`AND 1=0`) | `reconciliationFindsTheLostTicketAndNothingElse` |
| reconciliation that finds everything (drop `NOT EXISTS`) | `reconciliationIsQuietOnTheHappyPath` |

The first row is the one that matters: **reverting to the rejected design turns the real-duplicate
test red.** A mocked throw would have stayed green under it.

**Three more in the print agent**: no routing block rendered, no order instructions rendered, and
the receipt-side refusal removed. All red.

## Real command output

```
$ mvn -pl services/pos-service verify          # twice, consecutively
pos-service ITs: 216 tests, 0 failures, 0 errors, 0 skipped across 34 classes
[INFO] Tests run: 216, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS

$ mvn -pl shared-lib test -Dtest=PrintDocumentContractTest
Tests run: 12, Failures: 0, Errors: 0, Skipped: 0

$ cd print-agent && npx tsc --noEmit && npm test
TYPECHECK: clean
      Tests  88 passed (88)

$ git diff --quiet HEAD -- gateway/  &&  echo "gateway/ UNCHANGED"
gateway/ UNCHANGED
```

### Live, against the running stack (pos-service rebuilt and restarted, jar 107 MB / 446 BOOT-INF entries)

A cashier fired a real order through the gateway on `floating-terrace`:

```
$ curl -X POST .../api/v1/pos/orders/{id}/send-to-kds
orderNo= ORD-20260812-0001 status= SENT_TO_KDS
  item rev= 1 station= None firedAt= 2026-08-11T19:32:26.955808Z

$ psql pos_db -c "SELECT document_type, target_printer_id, issue_seq, revision_no, status, last_error
                  FROM print_jobs WHERE order_id='322b2cdd-…'"
 document_type  | target_printer_id | issue_seq | revision_no | status |               last_error
----------------+-------------------+-----------+-------------+--------+------------------------------------------
 KITCHEN_TICKET | unassigned        |         1 |           1 | FAILED | UNROUTABLE: no kitchen printer configured
                                                                        for station UNASSIGNED
```

That row is the plan's point in one line: Floating Terrace has **no kitchen printer configured and
no station on any menu item**, and instead of silence there is a durable, queryable record saying
exactly which station had nowhere to send its ticket.

The stored document (abridged — full `jsonb_pretty` output was inspected):

```json
"ticket": { "stationCode": "UNASSIGNED", "orderTypeLabel": "DINE_IN", "coverCount": 2,
            "revisionNo": 1, "firedAt": "2026-08-11T19:32:26.955808Z",
            "serverName": null, "serverRef": "eb2ee67e-…",
            "orderInstructions": ["No nuts on this table"] },
"lines":  [ { "name": "Chicken Karahi", "quantity": 2, "note": "extra spicy",
              "lineTotal": { "paisa": 0, "formatted": "Rs 0.00" }, "stationCode": "UNASSIGNED" } ],
"totals": null, "tenders": [], "fiscal": null, "drawer": null, "cut": { "mode": "FULL" }
```

The same order was then served and paid; it went to `CLOSED` and **no receipt row was written**,
because that branch has no `RECEIPT` printer configured. That is behaviour 10 live: the
browser-bill branch of D-26-01 produces no row at all, not a stream of unroutable ones.

The reconciliation query, run live, returned **the 17 orders fired yesterday before this code
existed** and did **not** return `ORD-20260812-0001`. It works, and it has been watched working.

## Deviations from Plan

### 1. [Rule 2 — missing functionality] `PrintDocument` gained a `Ticket` component

The plan requires each ticket to carry "the order number, the table or order type, the cover count,
the revision number, the fired timestamp and the server or cashier identity". The document schema
had nowhere to put any of it: `Header` is the branch identity block, and the agent's kitchen
renderer did not render `Header` at all.

The cheap option was to push "Table 12" into `Header.addressLines`. That works exactly once, until
somebody reads the field name and believes it. So `Ticket` was added as a nullable component,
**refused on a `CUSTOMER_RECEIPT`** by the compact constructor — the symmetric restriction to the
one that already keeps the customer's money off a kitchen printer.

Cost, paid in full: shared-lib, the print-agent's hand-rolled parser and renderer, the frontend's
`strictObject` zod mirror (which would otherwise have rejected **every** receipt the moment the
server started sending `"ticket": null`), and a regenerated golden fixture — one file read by three
suites.

It is nullable on a kitchen ticket too, deliberately: 26-04's and 26-06's fixtures construct
kitchen tickets without one, and forcing it on them would be a schema change dressed up as a
guarantee. A test asserts a ticket with no routing block still renders.

### 2. [Rule 3 — blocking] A Spring circular dependency, cut at the one new edge

`OrderServiceImpl → PrintDispatchService → PrintJobServiceImpl → ReceiptDocumentAssembler →
OrderService`. The context refused to start.

Two cuts, both minimal: `KitchenTicketAssembler` reads the order through `OrderRepository` +
`OrderMapper` instead of `OrderService` (with the tenant predicate in the query, as 26-CONTEXT
requires), and `OrderServiceImpl`'s new dependency is `@Lazy`. The assembler's own dependency on
`OrderService` is 26-03's, on the receipt read path; narrowing it would mean reworking a shipped
plan to accommodate this one. The `@Lazy` reference is dereferenced only after a transaction
commits, so the laziness costs nothing and encodes the right constraint: printing depends on
orders, not the other way round.

### 3. [Rule 1 — regression] Closing now auto-enqueues the receipt, which broke 26-03's tests

Found by running the **whole** suite, not the new file. `PrintJobIssuanceIT` asserts "the first
issue is sequence one" — but the close had already taken sequence 1, so the explicit `issue()` came
back stamped `REPRINT #2`, and `findHistoryForOrder` returned three rows instead of one.

The behaviour is the plan's (behaviour 9) and is correct. The fixture now **asserts both dispatched
rows exist and then hard-deletes them**, with a comment saying why — so it cannot quietly paper
over a dispatch regression, and the dispatch behaviour itself is proved in `PrintDispatchIT`. A
hard delete because `lockSlotForSequence` and `findFirstIssue` do not filter `deletedAt`, so a
soft-deleted row would still occupy sequence 1.

Worth carrying forward to **26-08 and 26-12**: on a branch WITH a receipt printer, the first
customer-receipt row is now written by the close, so the browser's Print bill is genuinely
sequence 2 and prints as a reprint. That is honest (the agent printed the original) but it is a
visible change to what a cashier sees.

### 4. An unexplained flake, recorded rather than dressed up

One full-suite run showed the two `PrintDispatchIT` reconciliation tests failing. The same two
passed in isolation and in **four** subsequent full runs, including two consecutive clean 216-test
runs after the deviation-3 fix. The root cause I *did* find and fix was deviation 3; I could not
tie that earlier `PrintDispatchIT` failure to a cause and it has not recurred. Stated because a
flake nobody wrote down is a flake somebody rediscovers at 2am.

## Hardware sign-off (U3)

1. Whether an 80 mm kitchen ticket at the configured column count is legible across a hot pass at
   arm's length.
2. Whether the kitchen printer's cut behaviour separates consecutive tickets cleanly when two
   stations fire within seconds. `CutMode.FULL` is chosen for kitchen tickets specifically so two
   tickets come off the roll as two pieces of paper; only paper confirms it.

**Explicitly NOT requiring U3:** the grouping, the revision filtering, the unroutable record, and
the guarantee that a print failure cannot block a fire. All integration-tested.

## Known stubs

- **`Ticket.serverName` is never populated.** pos-service has no user-name lookup and adding one is
  a user-service change this plan does not make. `serverRef` (the cashier id) is carried and the
  renderer prints `Srv <first 8>` — enough to match against a shift roster, not enough to be good.
  Logged as **deferred item D-7**.
- `Ticket.stationName` resolves only when the station catalogue has the code. Every seeded menu item
  currently has a null station, so in practice today it is null and the code prints.

## Threat flags

None new. The plan's register is mitigated: T-26-07-A (after-commit + real duplicate insert),
-H (rollback leaves the table empty, asserted), -I (accepted, stated, and queryable), -B (the schema
refuses money; the test scans generically by reflection), -C (the unique index), -D (the ticket
consumes the revision machinery's set), -E (FAILED row naming the station), -F (tenant predicate in
the assembler's query plus forced RLS on `print_jobs`), -G (`gateway/` untouched, asserted by
`git diff --quiet`), -SC (no package added to any manifest).
