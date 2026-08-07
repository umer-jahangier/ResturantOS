# Phase 14 — Money Path Repair: Context & Decisions

**Branch:** `phase-13-access-repair`
**Scope:** `services/finance-service`, `services/crm-service`, `services/reporting-service`, `services/purchasing-service`
**Trigger:** Three defects on the order-to-ledger and procure-to-pay money paths, reported and independently re-confirmed against the working tree before any edit.

---

## Why these three are one phase

They are not three unrelated bugs. They compound into a single failure mode:

- **Defect 1** makes every discounted order's journal entry unbalanced, so the deferred
  `JE_UNBALANCED` trigger rejects it at COMMIT and the consumer throws.
- **Defect 2** means a consumer that throws has its message requeued immediately and
  indefinitely.
- Together: a discounted order does not merely fail to post — it pins a consumer in a hot loop
  and blocks every later message queued behind it.

Measured on the real stack: three deliberately-unbalanced `ORDER_CLOSED` events produced
**11,228 rejected posting attempts in a single ~20 second run**. Defect 1 supplies the poison;
Defect 2 supplies the loop.

**Defect 3** is independent of those two but sits on the same ledger, in the same recipe engine.

---

## Decisions

### D-1 — Credit revenue GROSS, not net (Defect 1)

The discount is debited to `4920 Discounts Given` as contra-revenue. Crediting revenue at
`subtotal - discount` books the same discount a second time on the opposite side, so debits
exceed credits by exactly `discountPaisa`.

**Decision:** credit revenue at gross `subtotalPaisa`.

**Rejected alternative — drop the `4920` debit and keep netting.** It balances too, and it was
the smaller diff. Rejected because it destroys information: discounts given would become
invisible in the ledger, and `4920` exists precisely so gross sales and discount are separately
reportable. Gross-revenue-plus-contra is also the standard treatment.

Verified to be a no-op for undiscounted orders: at `discount == 0`, `subtotal - discount` and
`subtotal` are the same number and no `4920` line is emitted either way. This changes **only**
orders that previously failed outright — it cannot alter any entry already in the ledger,
because no discounted entry ever reached the ledger.

### D-2 — Set the listener block in YAML, mirror it in the IT base (Defect 2)

`spring.rabbitmq.listener.simple.default-requeue-rejected` defaults to `true`. Four services
never set it. Copied the block that `pos-service` and `inventory-service` already carry.

**Dead-letter exchanges already exist** in finance, crm and reporting (`x-dead-letter-exchange`
plus a *bound* DLQ per queue, declared in code). Nothing was invented. See "Recommendation" below
for purchasing.

**Decision:** mirror the same properties into `AutoPostingITBase` via `@DynamicPropertySource`
rather than into `src/test/resources/application.yml`. That test YAML *shadows* the main one on
the test classpath (Spring Boot resolves `classpath:/application.yml` to the first match;
`target/test-classes` precedes `target/classes`, and the two are never merged), so the ITs had
never run production consumer semantics. `@DynamicPropertySource` is the mechanism that file
already uses for the datasource and broker, and it sidesteps the shadowing question entirely.

### D-3 — Remove purchasing's direct GR/IR post, keep finance's (Defect 3)

One goods receipt posted `DR 1300 / CR 1700` **twice**, under two idempotency keys that could not
see each other:

| # | Posted by | sourceType / sourceId | Path |
|---|-----------|----------------------|------|
| 1 | `GrnReceiptSimulator` → Feign | `GRN` / `grnId` | synchronous |
| 2 | `AutoPostingRecipeEngine.postStockReceipt` | `STOCK_RECEIPT` / `lotId` | `GRN_RECEIVED` → inventory → `STOCK_RECEIVED` |

The vendor invoice debits `1700` once, so GR/IR kept a permanent credit balance of one whole
receipt and inventory was overstated by the same amount.

**Decision:** delete side 1.

**Rejected alternative — delete side 2 instead.** Rejected because `postStockReceipt` is also the
only ledger entry for a **manual** stock receipt, which never goes through purchasing at all.
Removing it would silently stop posting those.

Side 1 is also the *wrong number*: purchasing computed `receivedQty × unitPricePaisa` in the
vendor's **order** unit, before inventory applies the UOM/pack-factor conversion and recomputes
moving-average cost. Inventory owns stock valuation; its lot cost is authoritative. Posting from
the lot additionally ties every entry to stock that demonstrably exists.

### D-4 — Fix the pre-existing test-config breakage blocking verification

`spring.application.name` is defined only in `src/main/resources/application.yml`, which the test
YAML shadows (see D-2). Without it, `SharedAutoConfiguration`'s `domainEventPublisher` fails on an
unresolvable `${spring.application.name}` and **every** `@SpringBootTest` in finance-service dies at
context startup.

This is pre-existing and unrelated to the three defects — confirmed by running the untouched
`OrderCloseAutoPostingIT`, which fails identically. It was masked by stale classes in `target/`;
the first `mvn clean` exposes it. Fixed by repeating the property in the test YAML, because
otherwise none of Defect 1's proof can be run.

---

## Guardrails honoured

- Money stays **BIGINT paisa**. The Defect 3 fix *removes* the only `BigDecimal`/`HALF_UP`
  rounding on that path; no rounding was introduced anywhere.
- The `JE_UNBALANCED` trigger was **not** weakened, disabled or worked around. It is what caught
  Defect 1, and it is still what proves the fix — the "after" evidence is that it stops firing.
- `PosEventContract` was **not** changed. Defect 1 is a consumer-side arithmetic fix; the wire
  shape other services depend on is untouched.

---

## Recommendation, not applied

**purchasing-service has no dead-letter exchange — because it has no consumers at all.** It
declares no queues and has zero `@RabbitListener`s; it is producer-only. The listener block was
added there for future-proofing and is **inert today** — this is stated plainly rather than
reported as a live fix.

Recommended when the first consumer is added to purchasing: declare an `x-dead-letter-exchange`
**and a bound DLQ** for its queue, following `FinanceRabbitConfig` / `ReportingRabbitConfig`. With
requeue disabled and no *bound* DLQ, a rejected message is discarded silently instead of looping —
trading an infinite loop for silent data loss. A note to that effect is in the YAML.

---

## Environment note (not a code defect)

The working tree is under `~/Documents` and a file-sync daemon is actively duplicating build
output as `ClassName 2.class`, `ClassName 3.class`, … inside `target/`. Surefire's default
includes match `Test*`, so `TestPrincipal 2.class` gets scanned and the forked JVM aborts with
`wrong name: io/restaurantos/finance/opa/TestPrincipal`. These are untracked build artifacts —
never source — and had to be purged immediately before each run. Excluding `target/` from the sync
daemon would remove a recurring, confusing build failure.
