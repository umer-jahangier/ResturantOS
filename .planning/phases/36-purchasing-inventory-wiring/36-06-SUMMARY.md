---
phase: 36-purchasing-inventory-wiring
plan: 06
subsystem: inventory
tags: [uom, conversion, rabbitmq, dlq, money, bigdecimal]

requires:
  - phase: 36-purchasing-inventory-wiring
    provides: F-31-03 (FURLONG received at face value) and C-1 (the arithmetic was already correct)
  - phase: 14-money-path
    provides: finance posts the receipt entry from the stock lot, not from the GRN message
provides:
  - a GRN receipt that refuses an unresolvable unit instead of receiving at face value
  - the hand-checkable conversion case, as a unit test and on the live receiving path
affects: [36-07, 36-08]

tech-stack:
  added: []
  patterns:
    - "A test that asserts a defect's behaviour is INVERTED, not deleted, and the javadoc records why the reasoning changed"

key-files:
  created:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/exception/GrnUomUnresolvableException.java
    - scripts/e2e/phase31-uom-conversion-e2e.sh
  modified:
    - services/inventory-service/src/main/java/io/restaurantos/inventory/service/GrnUomResolver.java
    - services/inventory-service/src/main/java/io/restaurantos/inventory/consumer/GrnReceivedConsumer.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/GrnReceivedConsumerIT.java
    - services/inventory-service/src/test/java/io/restaurantos/inventory/IngredientUomFactorResolverTest.java

key-decisions:
  - "The arithmetic was NOT touched — 36-01 confirmed it correct. Only the refusal was added."
  - "A blank unit code is still a factor of one; that is not a fallback, it is the absence of a conversion."
  - "The consumer's refusal is the SECOND line of defence; 36-04's API refusal is the first."

patterns-established:
  - "When a documented trade-off stops being true, invert the test and record why rather than deleting the reasoning"

requirements-completed: [PIW-05]

duration: 35min
completed: 2026-08-11
status: complete
---

# Phase 36 Plan 06: The conversion refuses Summary

**A goods receipt whose unit cannot be converted into the ingredient's stock unit is now refused
and writes nothing, instead of being recorded at face value — and the hand-checkable case (two
500 g packs into a KG-stocked ingredient) produces exactly 1.0 KG at exactly PKR 12,400/kg on the
live receiving path, with the money identical before and after.**

## Performance

- **Duration:** ~35 min · **Tasks:** 3 of 3
- `IngredientUomFactorResolverTest`: **13/13** · `GrnReceivedConsumerIT`: **9/9**
- `scripts/e2e/phase31-uom-conversion-e2e.sh`: **15 pass / 0 fail** live

## What this plan did NOT do, and why that matters

**It did not touch the arithmetic.** Plan 36-01 drove the hand-checkable case end to end and found
it exactly right — `qty_on_hand` moved 106.5000 → 110.5000 for a two-pack receipt plus a 3 KG line,
and moving-average cost blended to 115,000.0000 paisa/KG, the number the arithmetic predicts to the
paisa. `IngredientUomFactorResolver` computes the real ratio between the two units and returns empty
across families. That was already correct and was recorded as confirmed-closed precisely so this
plan would not re-derive it.

The gap was the **refusal**, and only the refusal.

## The reasoning that changed

`GrnUomResolver` logged at ERROR and fell back to a factor of one. Its javadoc said why, and the
reason was correct when it was written:

> Throwing would DLQ the whole GRN batch after finance has already posted its GR/IR entry, turning
> a valuation error into a reconciliation gap.

**That stopped being true in phase 14**, when finance began posting the receipt entry from the real
stock lot rather than from the GRN message. A refused receipt now strands nothing, because there is
no entry yet to strand. The trade-off the fallback bought no longer exists — only its cost does, and
36-01 measured that cost: a line whose unit was `FURLONG` was received, and **seven furlongs became
seven kilograms of Basmati Rice**. The receipt succeeded, the entry balanced, the invoice
three-way-matched. Only the numbers were wrong.

Two integration tests **asserted** the old behaviour by name —
`unknownPackUnit_receivesAtFaceValueRatherThanFailingTheBatch` and
`packUnitFromAnotherDimension_isNotConverted`. They were **inverted, not deleted**, and their javadoc
now records what the reasoning was and why it changed. Deleting them would have erased the argument
along with the behaviour, and the argument is the part a future reader needs.

## The hand-checkable case, live

```
--- the hand-checkable answer ---
      qty_on_hand      = 1.0000          (expected 1.0000 — 2 x 500 G = 1000 G = 1 KG, NOT 1000)
      avg_cost_paisa   = 1240000.0000    (expected 1240000.0000 paisa/KG — PKR 12,400/kg)
      on-hand x MAC    = 1240000 paisa   (expected 1240000 — exactly what two packs cost)
      inventory control (1300) moved by 1240000 paisa (expected 1240000)
PASS: two 500 G packs are ONE kilogram
PASS: the cost per kilogram is the pack price scaled by the same factor
PASS: value survives the conversion exactly
PASS: the ledger was debited the money that was actually spent
PASS: exactly one movement row

--- an unresolvable unit is refused before it can become stock ---
PASS: the API refuses first — a person sees this, not a dead letter (422)
PASS: on-hand is untouched — 7 FURLONG did not become 7 KG (1.0000)
PASS: nothing was published, so nothing dead-lettered (8)
----------------------------------------
PASS: 15   FAIL: 0
```

The value invariant is the one worth dwelling on: **a unit conversion must not create or destroy
money.** 1000 g × 12.4 paisa/g and 1.0 kg × 12,400 paisa/kg are the same 12,400 paisa, and the
ledger was debited that exact figure. A conversion that gets the quantity right and the rate wrong
looks fine on a stock screen and is a 1000×-wrong COGS three steps later — which is how this project
shipped one.

## Where the refusal sits in the chain

Two lines of defence, and the order matters:

1. **36-04, at the API.** A PO line with an unresolvable unit is refused at creation and at receipt
   with a 422 naming the unit and listing what would work. A person is present and can fix it.
2. **36-06, in the consumer.** A message that reaches inventory some other way now dead-letters
   instead of creating stock nobody ordered at a cost nobody paid.

The second is loud but late, and it is only an acceptable outcome *because* the first exists. The
live script asserts the ordering explicitly: the `FURLONG` probe answers 422 and the dead-letter
depth does not move, because nothing was ever published.

The handler is transactional, so a refusal on line three of a batch does not leave lines one and two
received.

## Task Commits

All three tasks in one commit, `9e4af4e` (fix) — the resolver change, the inverted tests and the
live script are one behavioural change and splitting them would have committed a red suite.

## Decisions Made

- **A blank or absent unit code is still a factor of one, and that is not a fallback.** Nothing was
  stated, so the quantity is already in the ingredient's own unit and there is nothing to convert.
  It is the one remaining `ONE` in the resolver and it is commented as such, so it is not mistaken
  for the behaviour that was removed.
- **Never across families, under any circumstance** — including when the two codes look
  interchangeable to a reader. `acrossFamiliesIsAlwaysEmpty` asserts litre→kg, kg→litre, each→gram
  and dozen→millilitre. There is no ratio between a litre and a kilogram and inventing one is how a
  wrong-family unit becomes a wrong number nobody sees.
- **The unbalanced-entry trigger and the GR/IR posting were not touched**, and purchasing still does
  not post a ledger entry at receipt time. The live script asserts account 1300 moved by exactly the
  money spent, which is the check that would catch a regression there.

## Deviations from Plan

None of substance. The plan anticipated changing `IngredientUomFactorResolver`; it did not need
changing, because 36-01 had already proven it correct — so this plan added the hand-checkable case
as a test of it rather than a repair to it, which is what the plan's own `key_links` describe.

## Issues Encountered

- **Testcontainers refused a connection on the first run** of `GrnReceivedConsumerIT` (deferred item
  D-3), and succeeded on the retry. Recorded because a reader of that first output would otherwise
  attribute a whole-class failure to this change.
- **The stack went stale twice more mid-plan**; inventory-service and purchasing-service were both
  rebuilt, verified bootable and restarted before the live run, and the gate confirmed clean.

## User Setup Required

None.

## Self-Check: PASSED

- `GrnUomUnresolvableException.java` — FOUND
- `scripts/e2e/phase31-uom-conversion-e2e.sh` — FOUND, 15/0 live
- `IngredientUomFactorResolverTest` — 13/13 · `GrnReceivedConsumerIT` — 9/9
- commit `9e4af4e` — FOUND
- inventory-service rebuilt (BOOT-INF 417), restarted, gate clean before the live run
