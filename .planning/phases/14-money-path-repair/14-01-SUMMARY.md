---
phase: 14-money-path-repair
plan: 01
subsystem: finance-autoposting
tags: [finance, ledger, journal-entry, rabbitmq, poison-message, gr-ir, purchasing, money-path]
status: complete
requires:
  - docker (Testcontainers: postgres:16, rabbitmq:3.12-management)
  - JDK 25 as Maven's runtime
provides:
  - balanced ORDER_REVENUE journal entry for discounted orders (gross revenue + contra-discount)
  - default-requeue-rejected=false on finance, crm, reporting, purchasing
  - single GR/IR posting per goods receipt
  - production listener semantics in finance auto-posting ITs
affects:
  - every discounted order closed through pos-service (previously posted nothing)
  - every goods receipt raised through purchasing (previously double-posted)
  - all 15 RabbitMQ consumers across finance (10), reporting (3) and crm (2)
tech-stack:
  added: []
  patterns:
    - gross revenue + contra-revenue discount, never netted on both sides
    - one ledger entry per economic event, owned by the service that owns the valuation
    - IT config mirrors production listener semantics via @DynamicPropertySource
key-files:
  created:
    - services/finance-service/src/test/java/io/restaurantos/finance/autopost/DiscountedOrderRevenuePostingIT.java
  modified:
    - services/finance-service/src/main/java/io/restaurantos/finance/autopost/AutoPostingRecipeEngine.java
    - services/finance-service/src/main/resources/application.yml
    - services/finance-service/src/test/java/io/restaurantos/finance/autopost/AutoPostingITBase.java
    - services/finance-service/src/test/resources/application.yml
    - services/purchasing-service/src/main/java/io/restaurantos/purchasing/service/GrnReceiptSimulator.java
    - services/purchasing-service/src/main/resources/application.yml
    - services/purchasing-service/src/test/java/io/restaurantos/purchasing/GrnReceiptSimulatorIT.java
    - services/crm-service/src/main/resources/application.yml
    - services/reporting-service/src/main/resources/application.yml
decisions:
  - credit revenue GROSS because the discount is already debited as contra-revenue (D-1)
  - remove purchasing's direct GR/IR post, keep finance's, because inventory owns stock valuation (D-3)
  - mirror listener config in the IT base rather than the shadowed test YAML (D-2)
metrics:
  tests_run: 243
  tests_failed: 0
  services_verified: 4
---

# Phase 14 Plan 01: Money Path Repair Summary

Discounted orders now post a balanced entry to the ledger (they previously posted **nothing**), poison messages dead-letter after 3 retries instead of requeuing forever, and one goods receipt produces one GR/IR entry instead of two.

---

## Defect 1 (CRITICAL) — every discounted order failed to post revenue

**File:** `services/finance-service/.../autopost/AutoPostingRecipeEngine.java`, `postOrderRevenue`

### Arithmetic verified independently before changing anything

The contract (`PosEventContract:38-39`) fixes `total == subtotal - discount + tax + serviceCharge`
and `sum(payments) == total`. Working through the entry the recipe built:

| Scenario | total | BEFORE DR | BEFORE CR | delta | AFTER DR | AFTER CR | delta |
|---|---|---|---|---|---|---|---|
| undiscounted | 89600 | 89600 | 89600 | **0** | 89600 | 89600 | **0** |
| discounted | 77600 | 89600 | 77600 | **12000** | 89600 | 89600 | **0** |
| 100% comp | 9600 | 89600 | 9600 | **80000** | 89600 | 89600 | **0** |

`delta == discountPaisa` in every case, exactly as reported. **Undiscounted orders are identical
before and after** — at `discount == 0` the old `subtotal - discount` and the new `subtotal` are the
same number and no `4920` line is emitted either way. This changes only orders that previously
failed entirely, so it cannot alter anything already in the ledger.

### The fix

The discount is debited to `4920 Discounts Given` as contra-revenue, so crediting revenue at
`subtotal - discount` books it a second time on the opposite side. Revenue is now credited at
**gross** `subtotalPaisa`, making both sides `subtotal + tax + serviceCharge` for any discount.

```java
-        long netRevenue = p.subtotalPaisa() - p.discountPaisa();
-        if (netRevenue > 0) {
-            lines.add(line(tag("REVENUE"), "Sales revenue", 0, netRevenue));
+        if (p.subtotalPaisa() > 0) {
+            lines.add(line(tag("REVENUE"), "Sales revenue", 0, p.subtotalPaisa()));
```

### Proof — real output, asserted on the PERSISTED entry

**BEFORE** (fix reverted, from the Postgres trigger itself — note it never reached `POSTED`):

```
JE_UNBALANCED: entry <id> DR=89600 CR=77600    ← discounted,  delta 12000
JE_UNBALANCED: entry <id> DR=89600 CR=9600     ← 100% comp,   delta 80000
```

**AFTER** — `DiscountedOrderRevenuePostingIT`, read back from `journal_lines`:

```
[UAT] discounted   je=beafc7e4... PERSISTED debits=89600 credits=89600 delta=0
[UAT]   1010 DR=77600   CR=0            (cash tendered)
[UAT]   4920 DR=12000   CR=0            (discount, contra-revenue)
[UAT]   4100 DR=0       CR=80000        (revenue at GROSS)
[UAT]   4910 DR=0       CR=4000         (service charge)
[UAT]   2200 DR=0       CR=5600         (output tax)

[UAT] undiscounted je=45da1a20... PERSISTED debits=89600 credits=89600 delta=0
[UAT]   1010 DR=89600   CR=0
[UAT]   4100 DR=0       CR=80000
[UAT]   4910 DR=0       CR=4000
[UAT]   2200 DR=0       CR=5600         ← no 4920 line, identical to before

[UAT] 100% comp    je=b3aeaf76... PERSISTED debits=89600 credits=89600 delta=0
[UAT]   1010 DR=9600    CR=0            (tax + service charge only)
[UAT]   4920 DR=80000   CR=0
[UAT]   4100 DR=0       CR=80000        (revenue still gross)
[UAT]   4910 DR=0       CR=4000
[UAT]   2200 DR=0       CR=5600

Tests run: 3, Failures: 0, Errors: 0   |   JE_UNBALANCED occurrences: 0
```

Assertions are on the entry read back from Postgres, including `status == POSTED` — a builder-level
test cannot observe this failure at all, since the trigger only fires at COMMIT. That is exactly how
it survived a green suite.

---

## Defect 2 (CRITICAL) — poison messages requeued forever

`spring.rabbitmq.listener.simple.default-requeue-rejected` defaults to `true`. finance, crm,
reporting and purchasing never set it. Copied the block `pos-service` and `inventory-service`
already carry (auto ack, requeue off, 3 retries with backoff).

### Measured, not asserted

Defect 1 supplies a real poison message, so the two were measured against each other on the same
three events:

| `default-requeue-rejected` | Rejected posting attempts in one ~20 s run |
|---|---|
| `true` (the defect) | **11,228** |
| `false` (the fix) | **8** — 4 per message: initial + 3 retries, then DLQ |

This is the hot loop, captured. It also shows why Defect 1 was more than "some entries missing": a
discounted order pinned a consumer and blocked every message queued behind it.

### Dead-letter exchanges — checked, not invented

| Service | Consumers | DLX + bound DLQ | Effect of this fix |
|---|---|---|---|
| finance | 10 | **Yes** (`FinanceRabbitConfig`) | live |
| reporting | 3 | **Yes** (`ReportingRabbitConfig`) | live |
| crm | 2 | **Yes** (`CrmRabbitConfig`) | live |
| purchasing | **0** | **No** — and no queues either | **inert today** |

**Stated plainly: purchasing-service is producer-only.** It has no `@RabbitListener` and declares no
queues, so the block there changes nothing at runtime. It was added so the first consumer inherits
the safe default rather than acquiring this defect the same way the others did.

**Recommendation (not applied):** when purchasing gains its first consumer, declare an
`x-dead-letter-exchange` *and a bound DLQ* for its queue. With requeue off and no bound DLQ a
rejected message is discarded silently — trading an infinite loop for silent data loss. A note to
that effect sits in the YAML.

---

## Defect 3 — GR/IR double posting: CONFIRMED, then fixed

**Confirmed before changing anything**, as required. One receipt posted `DR 1300 / CR 1700` twice
under two idempotency keys that could not see each other:

| # | Posted by | sourceType / sourceId |
|---|---|---|
| 1 | `GrnReceiptSimulator` → Feign → finance | `GRN` / `grnId` |
| 2 | `AutoPostingRecipeEngine.postStockReceipt` | `STOCK_RECEIPT` / `lotId` |

Path 2 arrives via `GRN_RECEIVED` → inventory `ReceiptService` (creates the lot) → `STOCK_RECEIVED`
→ finance. The vendor invoice debits `1700` once, so GR/IR held a permanent credit balance of one
whole receipt and inventory was overstated by the same amount.

### Reproduction — RED before the fix

```
[UAT] GR/IR postings for ONE receipt: purchasing-direct=1, via GRN_RECEIVED->STOCK_RECEIVED=1, total=2
Tests run: 4, Failures: 2
```

### After

```
[UAT] GR/IR postings for ONE receipt: purchasing-direct=0, via GRN_RECEIVED->STOCK_RECEIVED=1, total=1
Tests run: 4, Failures: 0
```

**Side 1 removed, side 2 kept.** Keeping finance's is correct because `postStockReceipt` is also the
only ledger entry for a **manual** stock receipt, which never touches purchasing — removing it would
silently stop posting those. Side 1 was also the wrong number: purchasing computed
`receivedQty × unitPricePaisa` in the vendor's *order* unit, before inventory applies the
UOM/pack-factor conversion and recomputes moving-average cost. Inventory owns stock valuation.

Removing it also deleted the only `BigDecimal`/`HALF_UP` rounding on that path, and dropped the now-unused `FinanceInternalClient` from `GrnReceiptSimulator`. Purchasing still posts the vendor invoice and AP payment itself — those are genuinely its own events.

---

## Impact analysis (CLAUDE.md requirement)

| Symbol | Direction | Risk | Impacted | Direct callers |
|---|---|---|---|---|
| `postOrderRevenue` | upstream | **LOW** | 1 | `OrderClosedConsumer.onMessage` |
| `postStockReceipt` | upstream | **LOW** | 1 | `StockReceivedConsumer.onMessage` |
| `simulateReceive` | upstream | **HIGH** | 13 | 11 direct, 0 processes |

### HIGH-risk warning — `simulateReceive`

Per CLAUDE.md this is flagged explicitly. Blast radius: `MockGrnController.mockReceive` (the only
production caller) plus `GrnReceiptSimulatorIT` ×3, `PurchaseOrderCloseIT` ×4,
`PurchasingMockE2EIT` ×2 (`f1_fullFlow`, `f6_priceDrift_mismatchedUntilOverride`),
`PurchasingOpaPolicyIT` ×3. **All 13 were run and all pass**, including the full procure-to-pay
E2E flow. `detect_changes` reports risk `low` / 0 affected execution flows.

The constructor signature changed (one fewer parameter). Verified no manual construction exists
anywhere — it is `@Service` constructor injection only.

---

## Deviations from Plan

### [Rule 3 — Blocking] Pre-existing test-config breakage blocked all verification

`spring.application.name` is defined only in `src/main/resources/application.yml`, which
`src/test/resources/application.yml` **shadows** on the test classpath (Spring Boot resolves
`classpath:/application.yml` to the first match; `target/test-classes` precedes `target/classes`,
and they are never merged). Without it, `SharedAutoConfiguration`'s `domainEventPublisher` fails on
an unresolvable `${spring.application.name}` and **every** `@SpringBootTest` in finance-service dies
at startup.

**Pre-existing and unrelated to these three defects** — confirmed by running the untouched
`OrderCloseAutoPostingIT`, which fails identically. It was masked by stale classes in `target/`; the
first `mvn clean` exposes it. Fixed by repeating the property in the test YAML, because otherwise
none of Defect 1's proof can be run.

### [Rule 2 — Missing critical] ITs never ran production listener semantics

Because of the same shadowing, the auto-posting ITs ran with `default-requeue-rejected=true` while
production was being fixed to `false`. Mirrored the production block into `AutoPostingITBase` via
`@DynamicPropertySource` — the mechanism that file already uses for the datasource and broker, which
sidesteps the shadowing question entirely. This is what made the 11,228-vs-8 measurement possible.

### Existing test updated — called out explicitly, as required

`GrnReceiptSimulatorIT.simulateReceive_postsFinanceOnce` asserted
`verify(financeInternalClient, times(1)).autoPost(...)`. **It encoded the double-posting defect as
expected behaviour** — it pinned "purchasing posts to finance exactly once", never noticing that
finance also posts a second entry for the same receipt via `STOCK_RECEIVED`.

Its *real* intent was idempotency: a repeated key must not receive twice. That intent is preserved
in `repeatedIdempotencyKey_doesNotReceiveTwice`, now asserted against the effects that still exist
(received qty, and exactly one `GRN_RECEIVED` published). The name
`oneReceipt_producesExactlyOneGrIrPosting` states the actual ledger invariant.

**No finance test encoded the wrong balance** — all 87 finance tests passed unmodified.

### Environment note (no code change)

The tree sits under `~/Documents` and a file-sync daemon actively duplicates build output as
`ClassName 2.class`, `ClassName 3.class`, … inside `target/`. Surefire's default includes match
`Test*`, so `TestPrincipal 2.class` is scanned and the forked JVM aborts with
`wrong name: io/restaurantos/finance/opa/TestPrincipal`. These are untracked build artifacts, never
source (`git ls-files` confirms none are tracked), and had to be purged immediately before each run.
Excluding `target/` from the sync daemon would remove a recurring, confusing build failure.

---

## Verification — real command output

All runs with `JAVA_HOME=openjdk@25`, `TESTCONTAINERS_RYUK_DISABLED=true`,
`TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`. Per-module only; no root reactor build.

| Service | Unit | IT | Total | Result |
|---|---|---|---|---|
| finance-service | 24 | 63 | **87** | BUILD SUCCESS |
| purchasing-service | 18 | 104 | **122** | BUILD SUCCESS |
| crm-service | 0 | 3 | **3** | BUILD SUCCESS |
| reporting-service | 11 | 20 | **31** | BUILD SUCCESS |
| | | | **243** | **0 failures, 0 errors** |

crm and reporting have no code changes — only the YAML block — so their suites confirm the
listener config does not break context startup. Both services' ITs boot the real containers.

---

## Guardrails honoured

- Money stays **BIGINT paisa**. No floats. The Defect 3 fix *removes* the only rounding on that path.
- `JE_UNBALANCED` was **not** weakened, disabled or worked around. It caught Defect 1, and the
  "after" evidence is that it stops firing.
- `PosEventContract` **unchanged** — Defect 1 is a consumer-side arithmetic fix.
- Stayed inside the four assigned services plus `.planning/phases/14-money-path-repair/`. No files
  touched in `pos-service`, `platform-admin-service` or `scripts/`.

---

## Follow-ups

1. **Backfill.** Discounted orders posted nothing historically. `posted_source_events` has no
   `ORDER_REVENUE` row for them, so a replay of `ORDER_CLOSED` will post them correctly and the
   existing idempotency guard will skip anything already posted. Needs a decision on the replay
   window and on which accounting periods may be reopened.
2. **GR/IR correction.** Existing double-posted receipts leave a standing credit in `1700` and an
   overstatement in `1300`. Quantify per tenant and post a correcting entry; the ledger is immutable
   by trigger, so it must be a reversal, not an edit.
3. **Free-text PO lines.** `GrnReceivedConsumer` skips lines with a null `ingredientId` (logged as a
   warning), so those now produce no receipt entry at all where purchasing's blanket post previously
   made one. Pre-existing coverage hole in the procurement catalog, now more visible. Not fixed here
   — inventory-service was out of scope and a blanket re-add would reintroduce the double post.
4. **Purchasing DLQ** — see Defect 2 recommendation.
