# D-LOYALTY-LEDGER-SHAPE — where loyalty money is recorded, and why `order_discounts` is the wrong table for most of it

**Status:** proposed
**Date:** 2026-08-12
**Author:** the session that fixed the promotion CHECK-constraint defect (pos V30)
**Applies to:** the CRM rebuild — the product owner's seven loyalty models (points, punch-card,
tiered, cashback, store credit, birthday, referral)
**Related:** `services/pos-service/.../db/migration/V30__order_discount_source.sql`,
`PromotionDiscountPersistsIT`, `CrmPromotionClient.EvaluatePromotionResponse`

---

## Why this document exists

Fixing the promotion path meant deciding what an automatic discount *is*, and that question does
not stop at promotions. `order_discounts` is the only lever in the codebase currently wired from
crm-service into a live bill. The loyalty rebuild will therefore be tempted to route all seven
models through it, because that is the path of least resistance and it appears to work.

For four of the seven it does not work. It produces books that are quietly wrong in a way nobody
notices until someone asks what the loyalty programme cost — and the answer they get is one that
gets the programme cancelled.

The warning is repeated in V30's header, but a migration header is the wrong place for
architecture: the next author reaches for `source = 'REDEMPTION'` in a different file and never
opens the migration. Hence this document.

---

## The core distinction: three events, not one

A loyalty programme moves money in three economically distinct ways. They look similar on a bill
and are completely different in the ledger.

| # | Event | What happens economically | Where it belongs |
|---|-------|---------------------------|------------------|
| 1 | **Price reduction** | The restaurant gives away its own margin. Gross sales fall. | `order_discounts` — this is every row in that table today |
| 2 | **Liability redemption** | The guest spends something the restaurant already owes them. The sale happened at **full price** and was settled with something other than cash. | `order_payments` — it is a **TENDER** |
| 3 | **Liability issuance** | The guest earns credit/points. The restaurant takes on a debt. No effect on this bill. | A CRM ledger + a GL liability. Neither pos table |

### Why a redemption is a tender and not a discount

This is the load-bearing claim, so it is worth stating plainly.

When a guest redeems 500 points for Rs 100 off, the restaurant did **not** discount the meal. It
sold the meal at full price and accepted 500 points as payment for Rs 100 of it — points it had
already issued, already owed, and already (or should have already) recognised as a liability. It
is the same shape as a gift card, and nobody would book a gift card as a discount.

Book it as a discount and four things go wrong at once:

1. **Gross sales are understated.** The revenue line loses Rs 100 that was genuinely earned.
2. **Giveaway is overstated.** The Discount Summary reports Rs 100 of margin sacrificed that was
   not sacrificed on this bill — it was sacrificed when the points were issued, possibly months
   earlier and in a different accounting period.
3. **The liability never clears.** The points were spent, but nothing debited the liability, so
   it sits on the balance sheet forever and grows monotonically.
4. **The owner draws the wrong conclusion.** They open the Discount Summary, see the loyalty
   programme as a column of pure cost with no offsetting drawdown anywhere in the product, and
   conclude it is losing them money. **This is how a working loyalty programme gets cancelled.**

Only (4) is visible from the UI, which is what makes this dangerous: the first three are silent.

---

## Mapping the seven requested models

| Model | Event type(s) | Discount row? | Notes |
|-------|---------------|---------------|-------|
| **Punch-card** ("10th coffee free") | ① reduction (the free item), ③ issuance (the punches) | **Yes**, for the free item | The punches themselves are a counter, not money |
| **Tiered** ("Gold = 10% off") | ① reduction | **Yes** | The one model the current schema fits cleanly — but see the rate-loss gap below |
| **Birthday** ("free dessert") | ① reduction | **Yes** | Same shape as any promotion |
| **Points** | ③ issuance on earn, ② **redemption** on spend | **No** | Redemption is a tender. `loyalty_accounts.points_balance` and `loyalty_transactions` already exist in crm |
| **Cashback** | ③ issuance, then ② redemption | **No** | Earned on bill A, spent on bill B. Nothing about it belongs on bill A's discount list |
| **Store credit** | ② redemption | **No** | Textbook tender. Identical handling to a gift card |
| **Referral** | ③ issuance, then ② redemption | **No** | The reward is credit, not a price cut |

**Three of seven are discounts. Four are not.** The four that are not are precisely the four the
product owner is most likely to consider the heart of a loyalty programme.

---

## What this means concretely

### DO NOT add `source = 'REDEMPTION'` to `order_discounts`

V30 introduced `order_discounts.source` with `CHECK (source IN ('MANUAL','PROMOTION'))`. It is a
closed set, so adding a third value is one small migration — which is exactly the trap. The
column distinguishes *who decided a price reduction*, not *how a bill was settled*. A redemption
is not a price reduction that a machine decided; it is not a price reduction at all.

### DO add a tender method to `order_payments`

Redemption needs `PaymentMethod` values (`LOYALTY_POINTS`, `STORE_CREDIT`) and a reference to the
CRM ledger entry that was debited, so the two sides can be reconciled. The existing split-tender
machinery in pos already handles "this bill was settled by more than one instrument", which is
the hard part and is done.

### DO give issuance its own ledger

`loyalty_transactions` exists in crm and is the natural home. What is missing is the GL side:
issuance creates a liability, redemption clears it, and finance-service needs both postings or
the balance sheet drifts. This is the piece with no code at all today.

---

## A second gap found while fixing the promotion path

`CrmPromotionClient.EvaluatePromotionResponse` is:

```java
record EvaluatePromotionResponse(long discountPaisa, List<UUID> appliedPromotionIds) {}
```

It returns **money and nothing else**, and `appliedPromotionIds` is **discarded entirely** by
`OrderServiceImpl.applyPromotions` — it is never read, never persisted, never reported.

Two consequences:

1. **The rule shape is lost.** A tiered "10% off for Gold" is resolved to a paisa figure inside
   crm and arrives at pos as an amount, so pos records it as `FLAT`. That is truthful — it *is* a
   flat Rs X off this bill — but it means the Discount Summary can only ever say "Rs 90.00 off".
   The owner tuning the programme wants to ask **"what is Gold costing me, as a rate?"** and the
   data to answer it was thrown away one service earlier.
2. **Spend cannot be attributed to a campaign.** The promotion ids are right there in the
   response. Persisting them would let the report say "the birthday offer cost Rs 42,000 last
   month across 310 checks" — which is the question that decides whether an offer is renewed.

**In my judgement this is the single change that would turn the current promotion plumbing into a
foundation the loyalty rebuild can actually stand on.** The CHECK-constraint fix made promotions
work at all; carrying the *rule* alongside the *money* is what makes them measurable, and a
loyalty programme that cannot be measured will be judged on anecdote. It is a small change —
widen the response record, persist the ids and the rule shape beside the discount row, surface
them in the Discount Summary — and it is far cheaper now than after seven models are built on
top of the current shape.

---

## What was already done under this reasoning

- `order_discounts.type` was kept as `FLAT|PERCENT` rather than widened to admit `PROMOTION`,
  because `type` is the unit discriminator for `value` (rupees for FLAT, a rate for PERCENT) and
  the promotion path was writing paisa — a silent third unit. See V30.
- Provenance moved to `order_discounts.source` (`MANUAL|PROMOTION`), so the Discount Summary can
  separate automatic giveaway from manager giveaway on a real column instead of by string-matching
  a free-text reason.
- The redemption warning is embedded in V30's header for the author who never reads this file.
- `PromotionDiscountPersistsIT` asserts that a promotion is always ORDER scope, which keeps it
  clear of the LINE-scope tax defect (a comped line still charging tax) owned by the tax session.

## Open questions for whoever owns the rebuild

1. Does finance-service post issuance and redemption to the GL today? (Believed: no.)
2. Should points be valued at issue time or redeem time? This determines whether the liability is
   fixed or floating and is an accounting decision, not an engineering one.
3. Do redeemed points participate in the tax base? A tender does not change tax; a discount does.
   This is a further reason the distinction has to be settled before the models are built, and it
   interacts with `D-TAX-DISCOUNT`.
