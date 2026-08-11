---
phase: 22
plan: "01"
subsystem: finance/inventory/purchasing/reporting
status: complete
date: 2026-08-11
tags: [money-path, event-bus, cogs, gr-ir, period-close, reconciliation]
---

# Phase 22 Plan 01: Financial Wiring Audit — Summary

**Ten money paths driven with live transactions. Six connect. Two were broken and are fixed here.
Two are broken outside this phase's owned files and are reported with reproduction steps.**

The headline is not a code defect. It is that **the live stack was running a four-day-old
finance-service jar**, so the critical phase-14 discount fix — present in source, present in the
built artifact, and covered by tests — **was not running**, and every discounted order on the live
system was still failing to post revenue exactly as phase 14 described. That was found by driving a
discounted order, not by reading anything.

---

## The wiring table

| # | Money path | Connected? | Evidence (persisted rows, real amounts) |
|---|---|---|---|
| 1 | Order → payment → close → revenue JE | **YES** *(after D-1)* | `JE-2027-000044`: DR 1010 336,400 / CR 4100 290,000 + CR 2200 46,400 |
| 1a | …with a 20% order discount | **YES** *(after D-1)* | `JE-2027-000041`: DR 1010 240,000 + DR 4920 50,000 = 290,000; CR 4100 250,000 + CR 2200 40,000 = 290,000 |
| 1b | …with a 100% comp | **YES** *(after D-1)* | `JE-2027-000042`: DR 1010 7,200 + DR 4920 45,000 = 52,200; CR 4100 45,000 + CR 2200 7,200 = 52,200 |
| 2 | Inventory depletion → COGS | **FIXED HERE** | was DR 5100 **12,500,000**; now `JE-2027-000045` DR 5100 **12,500** / CR 1300 12,500 |
| 3 | Goods receipt → GR/IR | **YES** | `JE-2027-000036` DR 1300 2,500,000 / CR 1700 2,500,000 — **once**, not twice |
| 3a | AP invoice → three-way match | **YES** | `JE-2027-000037` DR 1700 2,500,000 + DR 1710 425,000 / CR 2100 2,925,000 |
| 3b | AP payment → bank | **YES** | `JE-2027-000038` DR 2100 2,925,000 / CR 1100 2,925,000. GR/IR nets to **0** for the cycle |
| 3c | Goods receipt for an unknown ingredient | **BROKEN** | D-5 — receipt dead-lettered, PO `CLOSED`, no stock, no ledger entry |
| 4 | HR payroll → finance | **UNREACHABLE** | D-6 — `calculate` 500s on missing `tax_config`; no payroll event can ever be published |
| 5 | Period close locks back-dating | **YES** | close → `LOCKED`; back-dated JE → **423 `PERIOD_LOCKED`** |
| 6a | Reports vs ledger — amounts | **YES** | reporting subtotal/discount/tax == GL 4100/4920/2200 to the paisa, all three days |
| 6b | Reports vs ledger — dates | **BROKEN** | D-7 — 9,492,000 of revenue is `2026-08-06` in the GL and `2026-08-07` in the sales report |
| 6c | COGS / margin reports | **ABSENT** | D-8 — 0 of 115 `sales_item_facts` rows carry `cogs_paisa`; no P&L, trial-balance or margin report exists |
| 6d | Stock valuation vs GL 1300 | **YES** | sub-ledger 11,987,500 == GL 1300 net 11,987,500 |
| 7 | Transactional outbox drain | **YES** | 0 `PENDING` rows across all 12 outbox tables |
| 8 | DLQ bindings | **YES** | all 28 live queues carry `x-dead-letter-exchange` and a bound `.dlq` |
| 9 | Poison-message handling | **PARTIAL** | D-10 — audit-service is the last service still requeuing forever |
| 10 | Orphan queues | **BROKEN** | D-9 — two durable bound queues with no consumer, no TTL, no max-length |

---

## Defects

### D-1 — CRITICAL, FIXED. The live stack ran a stale jar, so phase 14's discount fix was not running

Driving a 20%-discounted order and a 100% comp produced **no journal entry at all**. The finance
log showed the exact phase-14 signature:

```
JE_UNBALANCED: entry bed5b0d3-… DR=290000 CR=240000     ← 20% discount, out by 50,000
JE_UNBALANCED: entry 75899220-… DR=52200  CR=7200       ← 100% comp,   out by 45,000
```

7,198 of those in one log file, and `finance.order-closed.queue` sitting at 2 messages with the
DLQ empty — the redelivery hot loop, exactly as documented.

But the source is correct, and so is the built artifact: `javap` on the jar shows
`postOrderRevenue` crediting `subtotalPaisa` (gross), and the packaged `application.yml` carries
`default-requeue-rejected: false`. The running JVM was not using it:

```
finance-service PID 93364, started Fri Aug  7 03:31
  open jar inode 47074233   ← deleted file, still held by the JVM
  on-disk jar   inode 47496165  (built 07:24 the same morning, with the fix)
```

The process had held an open descriptor on the pre-fix jar for four and a half days. Restarting
finance-service on the current jar drained both stuck messages and posted them correctly on the
first attempt — rows 1a and 1b above are those two messages.

**Two other services are in the same state right now** and are outside this phase's owned files:

| Service | on-disk jar inode | inode the JVM is using |
|---|---|---|
| kitchen-service | 47546977 | 47073876 |
| audit-service | 47423181 | 47418837 |

Kitchen also has a 10-message backlog on `kitchen.order-sent.queue`. Audit is covered in D-10.

**This invalidates "we fixed it" as a claim anywhere in this repo unless the service was
restarted.** A build-freshness check exists (`scripts/build-freshness.ps1`) but compares
timestamps, which cannot see this: the jar's mtime is newer than the source and still not loaded.
The check that works is inode identity, and it is four lines:

```bash
pid=$(pgrep -f "$svc-service-1.0.0.jar")
[ "$(stat -f '%i' services/$svc-service/target/$svc-service-1.0.0.jar)" \
  = "$(lsof -p $pid | grep -m1 "$svc-service-1.0.0.jar" | awk '{print $(NF-1)}')" ] \
  || echo "STALE: $svc is running a deleted jar"
```

### D-2 — CRITICAL, FIXED. Recipe→stock unit conversion was wrong by the UOM family factor (1000× for anything stocked in KG)

`units_of_measure.to_base_factor` converts a unit into its **family's canonical base** —
KG→1000 G, L→1000 ML, DOZEN→12 EACH. It does **not** convert into the ingredient's own stock unit,
and an ingredient may be stocked in any unit of its family. Three call sites applied it raw.

Proven live. 100 KG of Basmati Rice received at 25,000 paisa/KG, then two plates sold whose recipe
calls for 0.25 KG each:

| | before | expected |
|---|---|---|
| `inventory_movements.qty` | **−500.0000** | −0.5 |
| `ingredient_branch_stock.qty_on_hand` | **−400** (from 100) | 99.5 |
| COGS journal entry | DR 5100 **12,500,000** | 12,500 |
| food cost against 290,000 of revenue | **4,310 %** | 4.3 % |

Nothing failed. The depletion succeeded, the event balanced, the journal entry balanced,
`JE_UNBALANCED` had nothing to catch. Only the numbers were wrong.

The same arithmetic drives the live plate-cost panel, which reported `portionCostPaisa` 6,250,000
and a 4,310.3 % food cost for a PKR 62.50 plate.

**Fix.** New `IngredientUomFactorResolver` computes the ratio the conversion actually is —
`to_base_factor(lineUom) / to_base_factor(ingredientStockUom)` — valid only inside one family and
returning `Optional.empty()` across families rather than a guessed 1. Wired into all three sites:

- `DepletionService` — an unresolvable line is skipped and reported through the existing
  `DEPLETION_INCOMPLETE` channel rather than depleting on a guess or dead-lettering an order
  finance has already taken revenue for.
- `RecipeCostPreviewService` — an unresolvable line keeps the existing per-line warning. Its old
  `dimensionMatches` guard is deleted: it correctly identified KG↔KG as compatible and then applied
  1000 anyway, so it was checking the right thing and doing the wrong thing.
- `GrnUomResolver` — same rule, keeping its never-throw contract. It had the mirror-image bug: a
  gram-priced pack received into a KG-stocked ingredient fell into its "different families" branch
  (gram's `base_unit_code` is null, so it never equalled `'KG'`) and was received at face value,
  1000× short.

Verified after the fix on the live stack: depletion −0.5000, on-hand 99.5, `JE-2027-000045`
DR 5100 12,500 / CR 1300 12,500, preview `portionCostPaisa` 6,250 at 4.3 %.

10 unit tests in `IngredientUomFactorResolverTest` pin every direction — same-unit, derived→base,
base→derived, derived→derived, count family, cross-family, case-insensitivity, unknown stock unit,
nulls, and a degenerate zero factor.

### D-3 — CONFIRMED CLOSED. The goods-receipt double-post is genuinely gone

Phase 14 reported one receipt posting `DR 1300 / CR 1700` twice under two idempotency keys. A fresh
receipt now produces exactly one entry (`JE-2027-000036`), and `GrnReceiptSimulator` no longer posts
directly — the comment where the Feign call used to be explains why finance owns the entry.

The GR/IR account does carry a −9,500,000 credit balance, and it is **not** the double-post: it is
two receipts from 2026-08-08 (9,000,000 + 500,000) for which no vendor invoice was ever booked.
That is a normal open GR/IR position. The cycle driven in this audit closed out to zero.

### D-4 — CONFIRMED CLOSED. Finance no longer requeues poison messages forever

`services/finance-service/src/main/resources/application.yml` now carries
`default-requeue-rejected: false` with three attempts and backoff. Six of the seven consuming
services now have it (see D-10 for the seventh).

### D-5 — HIGH. A goods receipt for an ingredient inventory has never heard of is silently lost

`inventory.grn-received.queue.dlq` holds a GRN from 2026-08-08. Republished to reproduce it:

```
GrnUomResolver : GRN b8b7632b-…: ingredient 62017f86-7890-5995-ac06-a7c0d9b76e5f
                 not found in tenant d108c2e6-…; receiving kg at face value
ERROR: insert or update on table "ingredient_branch_stock"
       violates foreign key constraint "ingredient_branch_stock_ingredient_id_fkey"
```

Purchasing accepted a PO line for an ingredient id that does not exist in `inventory_db.ingredients`
— there is no referential check across that service boundary, and the id's version nibble (`5`)
says it was minted deterministically by a seeder rather than read from a real row. The resulting
three-way divergence, all still true right now:

| | |
|---|---|
| `purchase_orders.status` | `CLOSED` |
| `inventory.ingredients` rows for that id | **0** |
| `journal_entries` for that GRN or PO | **0** |

Goods received on paper, no stock, no ledger. The message dead-lettered correctly — and then sat
there, because **only pos and kitchen have DLQ monitors**. Finance (10 DLQs), inventory (3), crm,
reporting and audit have none, so nothing anywhere reports a dead letter.

Not fixed here: the durable fix is a validity check at the purchasing→inventory boundary (either
purchasing resolving ingredient ids against inventory when a PO line is created, or inventory
answering a validation call), and purchasing's PO-line entry point is where it belongs. Flagged
rather than patched inside the consumer, because making inventory tolerate an unknown ingredient
would convert a loud failure into a silent one — the exact trade this codebase keeps losing.

### D-6 — HIGH, outside owned files. HR payroll cannot be run at all, so the HR→finance path is dead

`POST /api/v1/hr/payroll-runs/{id}/calculate` returns 500:

```
java.lang.IllegalStateException: No active tax_config for tenant d108c2e6-… fiscal year 2027
```

`hr_db.tax_config` contains exactly one row: tenant `00000000-0000-0000-0000-000000000001`,
fiscal year **2026**. The live tenant has none and the current fiscal year is **2027**. There is no
controller, no admin screen and no seeder for `tax_config` — it appears only in a repository, an
entity and two services. So a run can be created but never calculated, never approved, never paid.

`PAYROLL_RUN_APPROVED` and `PAYROLL_RUN_PAID` therefore cannot be published by any product surface.
Finance's two payroll consumers are correctly bound and idle with zero messages ever delivered, and
`finance_db` contains zero `PAYROLL_*` journal entries. The phase-11 contract
(`11-CONTEXT.md`: *"HR posts to Finance … finance-service auto-posts the JE on consumption"*) is
implemented on the consumer side and unreachable from the producer side.

**Not a defect (checked and withdrawn):** payroll approve returning 403 `TOTP_REQUIRED` for a
step-up-verified owner. `X-TOTP-Verified` is injected by the gateway from the signed `totp_verified`
claim and stripped from inbound requests; the 403 was an artifact of calling hr-service directly on
:8088 during this audit. The same mechanism was exercised through the gateway for period close and
worked (path 5).

### D-7 — MEDIUM-HIGH, outside owned files (producer side). The GL and the sales report disagree on which day an order belongs to

| business/entry date | reporting `sales_order_facts` | GL 4100 / 4920 / 2200 |
|---|---|---|
| 2026-08-06 | — | 9,492,000 / 0 / 1,518,720 |
| **2026-08-07** | **73 orders, 9,492,000 / 0 / 1,518,720** | — |
| 2026-08-08 | 960,300 / 0 / 91,160 | 960,300 / 0 / 91,160 |
| 2026-08-11 | 875,000 / 95,000 / 140,000 | 875,000 / 95,000 / 140,000 |

The amounts are identical to the paisa — the revenue wiring is sound. The **date is off by one for
73 orders**. pos derives `businessDate` as `BusinessDay.of(closedAt)` = UTC−4h and puts it on the
event; reporting ignores that field and re-derives it as branch-local−4h. For a UTC+5 branch the two
disagree for anything closed in the early-morning window. A P&L for 2026-08-06 and a sales report
for the same date will never tie, and no test compares them.

The fix belongs in `reporting/consumer/OrderClosedConsumer` (owned) — it should honour the
`businessDate` already on the payload rather than re-deriving, which is what finance does and why
finance agrees with pos. Not applied in this phase: re-dating existing facts is a backfill with its
own correctness argument, and doing it while another agent owns the dashboards that read those facts
would be reckless. Reported with the reconciliation query that proves it.

### D-8 — MEDIUM-HIGH, owned. There is no COGS, margin, P&L or stock-valuation report

The ledger has COGS. Nothing surfaces it:

- `sales_item_facts`: **0 of 115** rows have `cogs_paisa`; 0 have `gross_margin_paisa`. The catalog
  comment calls them "Phase-8-deferred NULLs".
- `ReportCatalog` defines seven reports — sales by day/item/hour/order-type, discount summary, till
  sessions, purchases by PO. **No P&L, no trial balance, no COGS, no margin, no stock valuation.**
- finance exposes `/api/v1/finance/gl/balances`, which is the raw material for a trial balance and
  is the only place the numbers can be seen at all.

So "do the reports agree with the ledger?" is partly unanswerable: for revenue they agree exactly,
and for cost of sales there is nothing to compare. This is a real gap rather than a bug, and the
1000× COGS error in D-2 is precisely the kind of thing a margin report would have made obvious on
day one.

Reconciliation that *is* possible and does pass: **GL 1300 net 11,987,500 == inventory sub-ledger
Σ(qty_on_hand × avg_cost) 11,987,500.** Worth stating plainly — that tie held *while COGS was
1000× wrong*, because the over-depletion and its journal entry mirrored each other faithfully. It
proves the wiring, not the arithmetic, which is exactly how D-2 survived.

### D-9 — HIGH, partly owned. Two durable queues are bound to live routing keys with no consumer, no TTL and no max-length

| Queue | Depth | Bound to | Consumer |
|---|---|---|---|
| `notification.low-stock.queue` | 24 (grew by 1 during this audit) | `inventory.topic` ← `inventory.stock.low` | none — `services/notification-service/` has no `src/` |
| `finance.invoice-matched.queue` | 1 (created by this audit's vendor invoice) | `purchasing.topic` ← `purchasing.invoice.matched` | **none — and no code anywhere declares this queue** |

The second is the more interesting find and is not in the prior research. It exists only in the
broker, bound and durable, left behind by a version of finance that once consumed
`VENDOR_INVOICE_MATCHED`. `grep -rn "finance.invoice-matched"` across the entire repo returns
nothing — not the definitions file, not `FinanceRabbitConfig`, not any consumer. **Every vendor
invoice matched from now on leaks one message into it forever.** `reporting.invoice-matched.queue`
is the live consumer of that key and is healthy.

Both grow without bound for the life of the broker. Neither is fixable in code alone — the queue has
to be deleted from the broker (`finance.invoice-matched.queue`) or given a consumer / TTL
(`notification.low-stock.queue`, tracked as D-31, email delivery out of scope). Left in place rather
than deleted mid-audit because deleting a bound durable queue on a shared stack while four other
agents are working is not a change to make unilaterally.

### D-10 — CRITICAL, outside owned files. The audit trail has ingested nothing for four days

```
audit.all-events.queue     1,805 messages, 1 consumer, not draining (1794 → 1803 → 1805)
audit_db.audit_events      2,600 rows, newest occurred_at 2026-08-07 02:05
```

audit-service is:

1. the only remaining service with **no `spring.rabbitmq.listener` block**, so Spring's default
   `default-requeue-rejected=true` applies and a business exception is nacked back onto the head of
   the same queue with no delay, forever;
2. the `#` catch-all bound to all nine topic exchanges, so one un-ingestable event stalls **the
   entire compliance trail** behind it;
3. running a stale jar (D-1), so whatever fix its source may contain is not loaded.

Every event this system has published since 2026-08-07 — including all four orders, the goods
receipt, the vendor invoice and the AP payment driven in this audit — is queued and unrecorded. The
remedy is the same three-line listener block the other six services already have, plus a restart;
`services/audit-service/**` is not in this phase's owned files.

---

## What is genuinely well wired

Stated because it narrows where to look next, and because most of it was verified with money moving
through it rather than by reading:

- **Procure-to-pay closes out.** PO → approve → send → receive → invoice → pay produced four
  balanced entries across three services and left GR/IR at zero for the cycle. Three-way matching
  set the invoice to `MATCHED` on the first attempt.
- **Period close genuinely locks.** A back-dated entry into a locked period is refused with
  423 `PERIOD_LOCKED` at creation, not at post, and the step-up requirement is enforced through the
  gateway's signed-claim header rather than a client-assertable flag.
- **The transactional outbox is fully drained** — zero `PENDING` rows in all 12 outbox tables,
  including `auth_db`'s 3,289 rows.
- **Every one of the 28 live queues has an `x-dead-letter-exchange` and a bound DLQ.** Nothing
  dead-letters into the void.
- **Revenue reconciles to the paisa** between the reporting star schema and the general ledger, on
  every day tested.
- **`JE_UNBALANCED` earns its keep.** It caught the same defect in production that it caught in
  phase 14, and it is the only reason four days of discounted orders failed loudly instead of
  posting a plausible wrong number.

---

## Files changed

| File | Change |
|---|---|
| `services/inventory-service/src/main/java/io/restaurantos/inventory/service/IngredientUomFactorResolver.java` | new — the one conversion rule, with the live failure recorded in its javadoc |
| `services/inventory-service/src/main/java/io/restaurantos/inventory/service/DepletionService.java` | uses the resolver; unresolvable lines skip and report `DEPLETION_INCOMPLETE` |
| `services/inventory-service/src/main/java/io/restaurantos/inventory/service/RecipeCostPreviewService.java` | uses the resolver; `dimensionMatches` deleted; stock units batched into the same lookup; case-insensitive UOM map |
| `services/inventory-service/src/main/java/io/restaurantos/inventory/service/GrnUomResolver.java` | uses the resolver, keeping its never-throw contract; fixes the mirror-image receipt bug |
| `services/inventory-service/src/test/java/io/restaurantos/inventory/IngredientUomFactorResolverTest.java` | new — 10 tests, all directions |

Operational actions taken on the live stack: finance-service and inventory-service restarted onto
their current jars; purchasing-service started (it was not running at all); one dead-lettered GRN
republished once to capture its rejection reason and left in the DLQ where it was found. One
purchase order raised and received to restore the stock the D-2 defect destroyed during its own
proof — via the real product path, not an UPDATE.

## Handoff — not mine to fix

| Owner | Item |
|---|---|
| audit-service | D-10. Add the listener block, restart. The compliance trail is four days stale and growing. |
| kitchen / audit | D-1. Both are running deleted jars. Restart, then adopt the inode check. |
| pos / reporting | D-7. One `businessDate` rule, honoured by every consumer. Reporting's re-derivation is the outlier. |
| purchasing | D-5. Validate `ingredientId` at PO-line creation against inventory, or the receipt silently vanishes. |
| ops | D-9. Delete `finance.invoice-matched.queue` from the broker; it is bound, durable, growing, and declared by no code. |
| hr-service | D-6. `tax_config` has no provisioning path. Until it does, payroll is unrunnable and the HR→finance seam is untestable. |
