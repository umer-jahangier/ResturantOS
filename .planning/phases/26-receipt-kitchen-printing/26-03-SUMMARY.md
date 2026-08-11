---
phase: 26
plan: "03"
subsystem: print
status: complete
tags: [print, receipt, pos, rls, migration, assembler, reprint]
requires:
  - 26-01 (PrintDocument, ReceiptAmount, ReceiptMoneyFormatter)
  - 26-02 (the branch printer registry this reads through user-service)
provides:
  - "`print_jobs` — one durable, tenant-isolated row per document this product issues"
  - "`ReceiptDocumentAssembler` — a PrintDocument built from persisted order and payment rows"
  - "`PrintJobService.issue` / `.fetch` and the two endpoints they sit behind"
  - "a reprint that is provably the same bytes as the original"
affects:
  - pos-service (new table, entity, repository, assembler, service, controller, Feign client)
  - services/pos-service/src/test (RlsForcedInvariantIT and ControllerAuthorizationClosureTest extended)
tech-stack:
  added: []
  patterns:
    [
      store-the-rendered-document,
      target-in-the-sequence-key,
      assert-money-identities-before-returning,
      fail-soft-on-settings-fail-closed-on-ledger,
      predicate-in-the-query-as-well-as-the-policy,
    ]
key-files:
  created:
    - services/pos-service/src/main/resources/db/migration/V13__print_jobs.sql
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/PrintJob.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/enums/PrintJobStatus.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/PrintJobRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/ReceiptDocumentAssembler.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PrintJobService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PrintJobServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/feign/UserBranchClient.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/PrintJobController.java
    - services/pos-service/src/test/java/io/restaurantos/pos/ReceiptDocumentAssemblerIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PrintJobIssuanceIT.java
  modified:
    - services/pos-service/src/test/java/io/restaurantos/pos/RlsForcedInvariantIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/web/ControllerAuthorizationClosureTest.java
decisions:
  - "The rendered document is stored on the row; a reprint re-serves those bytes and never re-assembles"
  - "target_printer_id is part of the sequence key, so a multi-station kitchen fire cannot collide with itself"
  - "The assembler asserts both money identities and THROWS rather than printing a bill that does not add up"
  - "The user-service lookup is fail-SOFT (unlike FinancePeriodClient's fail-closed) and records the degradation on the paper"
  - "Branch data is read through the INTERNAL endpoint, because 26-02's public one needs branch.manage and this runs as a cashier"
  - "Issuing is a POST; reprinting carries the order-VIEW permission"
metrics:
  duration: ~2h
  completed: 2026-08-11
commits:
  - 0c69155 feat(26-03) — the migration, entity, repository and RLS canary
  - 21782d6 feat(26-03) — the assembler and the user-service Feign client
  - 2498f85 feat(26-03) — issuance, re-serve, the controller and the ITs
---

# Phase 26 Plan 03: Server-Side Receipt Summary

`grep -rn "[Rr]eceipt" services/pos-service/src/main/java` returned **zero hits** before this plan.
The settlement path now has a document to hand to a printer, a durable row behind every issue of
it, and a reprint that is provably the same paper.

## The two endpoints

| Method | Path                                          | Gate                                  |
| ------ | --------------------------------------------- | ------------------------------------- |
| POST   | `/api/v1/pos/orders/{orderId}/print-jobs?branchId=` | `hasAuthority('pos.order.view')` + `@RequiresFeature("FEATURE_POS")` |
| GET    | `/api/v1/pos/print-jobs/{printJobId}`         | same                                  |

The POST accepts an optional `Idempotency-Key` header. Both return
`ApiResponse<PrintJobService.IssuedDocument>`.

## `PrintJobService` — the signatures 26-05, 26-07, 26-08, 26-09 and 26-11 call

```java
IssuedDocument issue(UUID orderId, UUID branchId, String idempotencyKey);
IssuedDocument fetch(UUID printJobId);

record IssuedDocument(UUID printJobId, String targetPrinterId, PrintDocument document) {}
```

`PrintJobStatus` values: `ISSUED`, `QUEUED`, `CLAIMED`, `PRINTED`, `FAILED`, `DEAD_LETTERED`.
**Only `ISSUED` is written by this plan.** The HTML bill (26-05) consumes an `ISSUED` row and does
not move it — `window.print()` gives the server no way to know whether ink reached paper, and a
status claiming otherwise would be a lie the reprint screen repeats.

## `print_jobs`

Columns: `id, tenant_id, branch_id, terminal_id, order_id, document_type, target_printer_id,
issue_seq, revision_no, status, attempts, last_error, document (jsonb), issued_at,
original_issued_at, idempotency_key` + the standard auditing five.

Indexes:

| Index | Purpose |
| --- | --- |
| `uq_print_jobs_sequence (tenant, order, document_type, target_printer_id, issue_seq)` | the sequence key |
| `uq_print_jobs_revision (…, revision_no) WHERE revision_no IS NOT NULL` | 26-07's after-commit dispatch guard; receipts carry a null revision and are excluded rather than colliding |
| `uq_print_jobs_idempotency (tenant, idempotency_key) WHERE NOT NULL` | the issuance replay guard |
| `idx_print_jobs_agent_work (tenant, branch, status, created_at)` | 26-11's work list |
| `idx_print_jobs_order (tenant, order, document_type, issue_seq)` | 26-08's reprint history |

**`target_printer_id` is in the sequence key, and the two-station case is asserted here rather than
left for 26-07.** A customer receipt has one target, so its sequence is the reprint count. A
kitchen fire writes one row per station — same order, same document type — so a key scoped only to
`(tenant, order, type, seq)` would make a two-station fire collide with itself on the very first
multi-station fire. `PrintJobIssuanceIT.twoStationTickets_forOneOrder_eachStartAtSequenceOne`
proves both halves: two stations both take sequence 1, and a retried dispatch of the *same
revision to the same station* is still refused.

`branches` with no printer configured use the reserved target `"unassigned"` — not NULL, because
NULL in a unique index is never equal to anything, and such a branch would allocate sequence 1
forever.

**RLS: `ENABLE` then policy then `FORCE`, in this migration.** That order matters — forcing a
policy-less table denies the owner everything, which is an outage rather than an isolation. V11
enumerates a fixed table list and is not re-run, so V13 is self-forcing and closes with V11's own
"any unforced table" self-check. `RlsForcedInvariantIT` gains a NOSUPERUSER-owner canary aimed at
`print_jobs` specifically, because these rows hold rendered receipts — line items, totals, tenders
and the customer's change.

## The assembler

Reads the order and its payments through the existing services and the branch through
`GET /internal/users/branches/{id}`. **Not 26-02's public endpoint** — that one is gated on
`branch.manage`, and this call happens while a *cashier* settles. The internal endpoint returns the
whole branch row, which already carries both halves needed: the printed identity and the
`receipt_config` jsonb. One call, not two. (This is deferred item D-2 landing exactly where it was
predicted to.)

**It refuses to print a bill that does not add up.** Two integer identities are checked inside the
assembler, stated in the shape this codebase actually computes rather than the shape a receipt is
usually described in:

1. `subtotal` is **gross** — before line discounts and before tax — so it equals
   `Σ(lineTotal + lineDiscount − lineTax)`, **not** `Σ lineTotal`. (This is
   `OrderPricingCalculator.aggregateOrderTotals`'s own formula; see the deviation below.)
2. `subtotal − discount + tax + serviceCharge == total`.

Plus `Σ line tax == order tax`, and a re-parse of every rendered string back to its own paisa
before the document is returned. A one-paisa corruption of the order row is a test, and it throws.

**Fail-soft in exactly one direction.** Unlike `FinancePeriodClient`, which is fail-*closed*
because closing into an unknown accounting period corrupts the ledger, a failure to read the branch
degrades the document and never fails it: no drawer instruction, `CutMode.NONE`, and a note on the
**footer** so a support engineer reading a reprint six weeks later can tell why the drawer did not
open. Two tests cover it — an unreachable service, and a branch with no printer at all
(definition-of-done item 6).

**The fiscal region is present and entirely null.** D-26-03 reserves it; Phase 27 fills it.

## Real command output

```
$ mvn -pl services/pos-service -am verify -Dit.test=RlsForcedInvariantIT
Tests run: 3, Failures: 0, Errors: 0, Skipped: 0 -- in io.restaurantos.pos.RlsForcedInvariantIT
BUILD SUCCESS
   (flyway.clean() + flyway.migrate() from empty runs in PosTestBase @BeforeAll, so
    V13 migrating cleanly from an empty database is exercised on every IT run)

$ mvn -pl services/pos-service -am verify -Dit.test=ReceiptDocumentAssemblerIT
Tests run: 11, Failures: 0, Errors: 0, Skipped: 0 -- in io.restaurantos.pos.ReceiptDocumentAssemblerIT

$ mvn -pl services/pos-service -am verify -Dit.test=PrintJobIssuanceIT -Dtest=ControllerAuthorizationClosureTest
Tests run: 2, Failures: 0, Errors: 0, Skipped: 0 -- in io.restaurantos.pos.web.ControllerAuthorizationClosureTest
Tests run: 8, Failures: 0, Errors: 0, Skipped: 0 -- in io.restaurantos.pos.PrintJobIssuanceIT
BUILD SUCCESS

$ mvn -pl services/pos-service -am verify           # everything
Tests run: 60, Failures: 0, Errors: 0, Skipped: 0   (pos-service unit)
BUILD SUCCESS
$ # aggregated from services/pos-service/target/failsafe-reports/*.txt
pos-service ITs: 158 tests, 0 failures, 0 errors, 0 skipped across 30 classes

$ # the divide-by-100 gate on the assembler
gate: 0

$ # every PrintJobRepository finder names the tenant
tenantId occurrences: 11   query methods: 5
```

## Deviations from Plan

### 1. [Rule 1 — Correctness] The plan's stated money identity does not hold in this codebase

The plan's behaviour 2 says: *"The sum of the document's line totals plus service charge plus tax
minus discount equals the document's total."* That would **double-count tax**, because
`OrderItem.lineTotalPaisa` already includes the line's tax
(`OrderPricingCalculator.lineTotal = lineNet + tax`), and because `orders.subtotal_paisa` is gross
— `subtotal += lineTotal + lineDiscount − lineTax`.

Asserting the plan's paraphrase would have meant either a failing test or an assertion loosened
until it passed. What is asserted instead is the pair of identities the calculator actually
establishes and that `ORDER_CLOSED` carries to finance (listed above). This is **stronger**, not
weaker: it pins the receipt to the same arithmetic the journal entry was posted from.

### 2. [Rule 3 — Blocking] The plan's verify commands cannot run these tests

`-Dtest='RlsForcedInvariantIT'` etc. cannot work: pos-service's surefire **excludes `**/*IT.java`**.
The equivalent that runs them is failsafe:

```bash
mvn -pl services/pos-service -am verify -Dit.test=<ITName> \
    -Dfailsafe.failIfNoSpecifiedTests=false -Dsurefire.failIfNoSpecifiedTests=false
```

### 3. [Rule 3 — Blocking] `ControllerAuthorizationClosureTest` had to be edited

It asserts `CONTROLLERS.hasSize(6)` and requires every listed class to be a `@RestController` in
the package. A new controller therefore **fails the build until it is registered** — which is the
test working as designed. `PrintJobController` was added and the size bumped to 7. The file is
named in the plan's `read_first` but not in `files_modified`; recorded here rather than left as a
surprise.

### 4. [Rule 3 — Blocking] macOS duplicate `" 2".class` files broke the Spring Boot repackage

`Unable to find a single main class from the following candidates [PosServiceApplication 2,
PosServiceApplication 3, PosServiceApplication]`. Deleted them once; **they regenerated**, and a
fourth appeared. Test runs therefore use `-Dspring-boot.repackage.skip=true`, which is correct
anyway — these runs need tests, not a bootable jar. Whatever is creating them (a sync client
touching `target/`) is outside this phase's scope; logged as an environment note.

### 5. Scope note: files touched beyond `files_modified`

`RlsForcedInvariantIT` and `ControllerAuthorizationClosureTest` are both named in the plan's task
bodies. `MenuItemRepository` was **read** but not modified — the tax-breakdown lookup reuses the
existing tenant-predicated `findByIdAndTenantId` rather than adding a batch finder, which keeps the
tenant in the query as 26-CONTEXT requires at the cost of N small reads on an order with
single-digit line counts.

## Hardware sign-off (U3)

**Nothing.** The drawer instruction is produced and asserted as *data*; whether a drawer physically
opens is settled in 26-06 and 26-12.

## Known stubs

- `PrintJobStatus` declares six values and this plan writes only `ISSUED`. That is deliberate and
  documented on the enum: the remaining five are written by the agent path (26-06/26-09/26-11), and
  declaring them now keeps the migration's CHECK constraint from needing a change per plan.
- `PrintJob.terminalId` is declared and never populated by this plan. 26-02's registry reaches
  terminal granularity (D-26-05) but nothing routes by terminal yet; 28 owns multi-terminal
  routing.

## Threat flags

None new. The plan's register is fully mitigated: T-26-03-A (no client money), -B (tenant predicate
in every query plus the forced policy plus a NOSUPERUSER canary), -C and -D (every issue is a row;
reprints are stored bytes, proven by byte identity *and* by an assembler call-count), -E (fail-soft
settings lookup), -F (order-view gate, enforced by the closure test), -G (pessimistic lock plus
unique index, with a concurrency test).

## Notes for the plans that build on this

- **26-05** should `POST` the issuance endpoint once on settle and render the returned
  `IssuedDocument.document`. Do not re-issue on every render — that inflates the reprint count.
- **26-07** writes `KITCHEN_TICKET` rows into this same table. `revision_no` is its idempotency
  key and the partial unique index is already in place; the two-station case is already proven.
- **26-08** reads `PrintJobRepository.findHistoryForOrder`, which is ordered by `issued_at`.
- **26-09/26-11** walk `idx_print_jobs_agent_work` and move `ISSUED → QUEUED → CLAIMED → PRINTED`.
- The assembler is `@Transactional(readOnly = true)` and allocates nothing; `PrintJobService.issue`
  is the only writer.
