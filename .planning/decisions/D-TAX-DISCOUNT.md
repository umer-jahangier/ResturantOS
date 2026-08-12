# D-TAX-DISCOUNT — what a discount does to the tax

**Status:** DECIDED and IMPLEMENTED (V27). Decided by the product owner, 2026-08-12.
**Owner:** pos-service pricing path.
**Applies to:** `OrderServiceImpl.recomputeOrderTotals`, `OrderPricingCalculator`, `ReceiptDocumentAssembler`, finance's `AutoPostingRecipeEngine`, reporting's `SalesFactWriter` / `FbrTaxSummaryService`.

---

## The ruling, in one sentence

**Sales tax is charged on the line net of its share of every discount — the same base the service
charge already used — unless the tenant sets `tenant_tax_policy.tax_base = 'GROSS'`, and a tenant
with no row is NET.**

It applies to **LINE scope and ORDER scope identically**. That is the whole point of the ruling:
before V27 the two scopes produced different answers for the same economic event.

## The second question, answered separately

**A discount is computed against the TAX-EXCLUSIVE line amount, never the tax-inclusive one.**

This was already true and is unchanged. `lineDiscountBase` prices against
`unitPriceSnapshot × quantity` less discounts already on the line — explicitly **not**
`lineTotalPaisa`, which INCLUDES tax. Pricing "10% off" against `lineTotalPaisa` charges the guest
10% of the government's money as well. Do not "simplify" this.

The two questions are independent and both matter:

| | base for the DISCOUNT | base for the TAX |
|---|---|---|
| rule | tax-exclusive line (gross of discount, net of tax) | line net of its allocated discount |
| never | `lineTotalPaisa` (tax-inclusive) | — |

## The invariants, in the terms this code actually uses

`orders.subtotal_paisa` is **GROSS** — before discount and before tax. `lineTotalPaisa`
**INCLUDES** tax. Anything of the form "line totals + tax − discount = total" double-counts tax and
is wrong here. The identities that actually hold, and that `ReceiptDocumentAssembler` THROWS rather
than printing when they fail:

```
per line:   lineTotalPaisa   = (gross − allocatedDiscount) + lineTax
            lineTax          = perLineTax(gross − allocatedDiscount, taxRatePct)   [NET,  default]
                             = perLineTax(gross,                     taxRatePct)   [GROSS, opt-in]
            gross            = (unitPriceSnapshot + Σ modifier deltas) × quantity

per order:  subtotal_paisa   = Σ gross                          (GROSS — no discount, no tax)
            tax_paisa        = Σ lineTax                        (from the lines, never beside them)
            discount_paisa   = Σ allocatedDiscount
            service_charge   = ratePct × (subtotal − discount)   (net, pre-tax — unchanged)
            total_paisa      = subtotal − discount + tax + service_charge

receipt:    Σ lineTax                                  == tax_paisa
            Σ(lineTotal + lineDiscount − lineTax)      == subtotal_paisa
            subtotal − discount + tax + serviceCharge  == total_paisa
```

Money is BIGINT paisa. Rates are BigDecimal, HALF_UP, multiplied before dividing. **No float ever
touches money here.**

## Why NET

1. **Pakistani sales tax.** The value of supply is normally the discounted price where the discount
   is shown on the invoice — and this product shows it, on the bill and (since B3) as a reviewable
   row per discount. Taxing the pre-discount price collects output tax on consideration the
   restaurant never received.
2. **The codebase already said so.** `OrderPricingCalculator.perLineTax` is documented and
   implemented as "taxRatePct applied to net line", and `computeItemLine` runs
   subtotal → discount → net → tax(net). That path had **never executed on a real discount**,
   because its only caller passes a hard-coded `0L` discount (`OrderServiceImpl.addItem`) and every
   real discount arrives later as an `order_discounts` row that never re-enters the calculator.
   `order_items.discount_paisa` was `0` on every row this product had ever written. The gross
   behaviour was an artefact of that zero, not a position anyone took.
3. **The service charge already used the net base**, so the two charges on one bill were answering
   opposite rules.

## Why it is also a tenant setting

"Normally" is load-bearing in point 1. Whether a discount reduces the value of supply is a
jurisdiction fact and a question about how a given discount is documented. The person who signs the
return is entitled to answer it. `GROSS` reproduces exactly the arithmetic that shipped before V27.

Tenant-scoped, not branch-scoped: a sales-tax position cannot differ between two dining rooms of
one registration. (Contrast `branch_service_charge`, which is branch-scoped because a service
charge is a commercial decision about one dining room.)

## The violation this ruling names — now fixed

`recomputeOrderTotals` did `tax += item.getTaxPaisa()` — the per-item **stored** figure, which only
ever accounted for the menu-level `item.discountPaisa` (always `0`). LINE-scope `OrderDiscount`
rows were summed at order level and reduced the total only, never the tax base. Measured live
2026-08-12, Floating Terrace F-7, order ORD-20260812-0356: a Rs 49.90 line discount moved the
service charge and left the tax at Rs 12.80 where the discounted base gives Rs 12.01. Comped
further, the charge page read `Subtotal Rs 809.00 | Discounts Rs 579.00 | Taxes Rs 12.80 |
Total Rs 254.30` — output tax on Rs 809.00 of food when Rs 230.00 was sold.

Independently confirmed by the discount sibling: `PERCENT 100` on `OrderLifecycleIT`'s Rs 850.00
line at 5% produced a total of **4250** — the dish comped, the guest still billed Rs 42.50 of tax.

**Under this ruling that case is now 0.** A fully comped line has a net of zero, so its tax is zero.

## What changed in code (V27)

- `tenant_tax_policy` table + `order_items.tax_base` snapshot (`V27__tenant_tax_policy.sql`),
  backfilled `GROSS` — a statement of fact about existing rows, not a default.
- `GET/PUT /api/v1/pos/tax-policy`, gated `pos.menu.view` / `pos.tax.manage`.
- `OrderPricingCalculator.allocateProRata` — an ORDER-scope discount carries no tax rate but the
  lines do, and a check may carry several, so the discount is attributed to lines pro-rata by
  remaining net, largest-remainder, before anything is taxed. Pro-rata rather than a waterfall
  because a waterfall makes the tax relief depend on the order the cashier rang the dishes in.
- `recomputeOrderTotals` now stamps `discountPaisa`, `taxPaisa`, `taxBase` and `lineTotalPaisa` on
  each line and takes the order's tax **from** the lines.
- Pre-F16 lines (`taxPaisa > 0` with `taxRatePct == 0`, rate genuinely unknown) are left alone —
  re-deriving from a zero rate would silently wipe a real charge.

## ⚠️ Coupling — read this if you touch discount bounds

`effectiveDiscount` itself is **UNCHANGED**: `min(requested, base)`.

But the **base passed to it changed.** `lineDiscountBase` and `orderDiscountBase` no longer add
`item.getDiscountPaisa()` to the "already discounted" sum. They must not: that field is now
`recomputeOrderTotals`'s **output**, not an input. Reading it back was:

- **double-counting** the line-scope rows it already summed; and
- worse, because `applyDiscount` is **replace-never-stack**, subtracting a discount that had
  *already been removed* — so replacing "Rs 100 off" with "10% off" priced the replacement against
  Rs 900 instead of Rs 1,000 and silently short-changed the guest.

**Net effect for anyone bounding a discount: the headroom is now LARGER (and correct) whenever a
line already carried a discount or the check carries an ORDER-level discount.** A bound expressed
in terms of `effectiveDiscount`'s clamp follows automatically. A bound that recomputes headroom
independently will drift — express it in terms of the clamp.

## Verification

`DiscountedTaxBaseIT` — 9 tests, driven over HTTP, asserting on rows **read back over HTTP** after
commit, not on the return value of the call that wrote them. Covers: the line-discount case; the
GROSS tenant; both receipt identities plus an actual `assembleReceipt` that would throw; pro-rata
across two rate buckets; an indivisible three-way split summing exactly; both discount-base
regressions; and the journal.

**On the journal:** debits and credits balance under **either** base, because tax appears
identically on both sides of the revenue entry —
`DR tenders + DR discount == CR gross revenue + CR service charge + CR output tax`. The balance
assertion is a regression guard, **not** evidence for the tax base. What actually moves is the
credit to Output Tax, which is asserted separately.

Full pos-service suite green: **395 ITs + 81 unit tests, 0 failures**, including
`ReceiptDocumentAssemblerIT`, `ServiceChargeAndTipIT`, `DiscountOnFiredCheckIT`, `OrderLifecycleIT`,
`TaxClassInheritanceIT` and `RlsForcedInvariantIT`.

## Out of scope, still open

- **Is the service charge itself taxable?** Still undecided, still documented as undecided in
  `OrderPricingCalculator.serviceCharge`. Not changed here.
- **`cancelItem` has no terminal-status guard** — the only order mutator missing one, so a CLOSED
  or VOIDED check can be silently re-priced. Pre-existing; V27 makes what it restates real money
  rather than a rounding artefact. Needs its own fix.
- **No screen.** The setting is reachable by API only; no sales-tax configuration screen exists
  anywhere in the product yet.
- **History is not restated.** `recomputeOrderTotals` runs only on mutation, so closed checks keep
  the tax they settled at and ClickHouse `sales_order_facts` rows do not move. Expect a step-change
  in effective tax rate for discount-heavy tenants at the deploy boundary; period-over-period
  comparisons spanning it are comparing two rules.
