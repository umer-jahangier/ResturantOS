# Phase 37 — status after the third execution session (2026-08-12)

Three executors have now worked this phase; the first two exhausted their budgets. This file is the
single place that says what is true, so a fourth does not have to reconstruct it from fourteen
plans and eleven summaries.

**The phase is NOT complete.** Four plans are unstarted, two integration tests are unwritten, one
migration is blocked on the user, and both of the phase's blocking human checkpoints are
outstanding.

## Definition of Done — measured, not assumed

| # | Definition-of-Done item | State | Evidence |
|---|---|---|---|
| 1 | Owner sees today's takings by tender, reconciled against till counts, variances as variances | **DONE** | 37-09 API + 37-12 screen, verified in a real browser; seeded overage renders +Rs 36,730.95 |
| 2 | Any transaction opens to its order **and** its journal entry; any journal entry links back | **DONE (not asserted end to end)** | 37-04, 37-08, 37-11 shipped and driven live; no single run asserts the round trip |
| 3 | COGS and margin report real figures from populated fact rows | **NOT DONE** | `sales_item_facts`: 12 rows, **0** with `cogs_paisa`. Writer still writes NULL by design until 37-06/37-07 land |
| 4 | Report dates agree with the ledger to the day | **BLOCKED** | 37-03's code landed; its historic-data migration awaits the user and MUST NOT be run by an agent |
| 5 | Guide explains every finance tab, each behavioural claim covered by a test | **PARTIAL** | 11 sections shipped; `make verify-guide-claims` green (12 claims, 42 checks, 0 fail). Four sections still carry **no test-bound claims** |
| 6 | The orphan queue is owned by code or removed, with the choice recorded | **NOT DONE** | `finance.invoice-matched.queue`: **26 messages, 0 consumers**, still growing and declared by no code. (reporting's own queue is healthy: 0 messages, 1 consumer) |

## The two blocking human checkpoints — NEITHER HAS BEEN RUN

Both are `autonomous: false`. No agent may run them, and no agent has.

1. **Gross has never been tied to the GL by hand.** Every reconciliation asserted so far compares
   numbers the product produced. Nobody has independently added up a day's takings and agreed it
   to the ledger.
2. **Nobody has read the guide end to end as an owner.** The jargon test catches the words D-37-03
   names; it cannot tell you whether a paragraph explains anything. Given that **three false
   sentences have now been found in this guide by driving it, and zero by reading it**, this
   checkpoint is not a formality.

## Closed this session

- **DEFECT-37-03-B — live data corruption. FIXED AND BACKFILLED.** Every analytics fact sat exactly
  +5h. All three ETL writers, four columns, 44 rows. See `37-DEFECT-37-03-B-SUMMARY.md`. **Its
  recorded diagnosis was wrong and the fix it implied was also wrong** — read the corrected entry
  in STATE.md before touching the ETL writers.
- **37-08's missing indexes** — landed as `V19__transaction_register_indexes.sql` (not V13; V13–V18
  were taken). No speedup claimed at 38 rows; verified applicable, not merely plausible.
- **Two more false guide sentences** — Expenses' approval threshold (does not exist; every expense
  needs approval) and AP Aging's bucket list (three named, four exist).

## Still open, in the order the last brief put them

| Item | Notes for whoever takes it |
|---|---|
| **37-10** | The orphan queue. Measured above: 26 messages, 0 consumers. Decide own-or-remove and record the choice |
| **37-05, 37-06, 37-07** | COGS/margin. 37-06/07 rewrite `SalesFactWriter` — it now routes through `AnalyticsInstant.utc()`; **keep that seam**, do not reintroduce a `java.sql.Timestamp` |
| **37-08 `TransactionRegisterIT`** | Not written. Six of its eight behaviours were driven live; the cross-branch case and the plan-shape assertion remain unverified. Its guide claim stays out until this exists |
| **37-09 `DailyTakingsIT`** | Not written |
| **37-03's migration** | BLOCKED on the user. Its guide claim stays out until applied |
| **37-14** | `autonomous: false`. Cannot pass today — DoD 3, 4 and 6 are open |

## Litter, declared

Carried forward from the previous session and still true: a Rs 1.00 probe payment on
`ORD-20260812-0003`, **voided** — the payment survives as a void event, which is correct history and
must not be "cleaned"; plus three empty DRAFT orders carrying no money.

Added this session: **none that persists.** The live ETL probe wrote one synthetic fact row under a
throwaway tenant and deleted it (verified 0 remaining). Four indexes were applied to `pos_db` by
hand ahead of Flyway; the migration is `IF NOT EXISTS` throughout, so Flyway will record it without
error on the next `pos-service` restart.

## Environment notes

- `reporting-service` was rebuilt and restarted this session and is running its current jar.
- `check-stale-jars.sh` reports **crm-service, file-service and pos-service stale** — sibling
  agents' rebuilds under running JVMs, not this session's. Any POS assertion made right now is
  measuring the old build.
