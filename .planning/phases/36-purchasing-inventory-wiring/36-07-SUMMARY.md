---
phase: 36-purchasing-inventory-wiring
plan: 07
subsystem: testing
tags: [seed, credentials, rls, idempotency, purchasing]

requires:
  - phase: 36-purchasing-inventory-wiring
    provides: 36-04's line gate (which the old seed would now fail), 36-05's unit registry, 36-06's conversion
provides:
  - a seed that creates vendors, catalog items, purchase orders, receipts and invoices for every tenant
  - a seed that asserts stock arrived rather than trusting the 200
  - a credentials document that no longer warns about a closed gap
  - a README whose cross-tenant leak section is re-measured rather than remembered
affects: [36-08]

tech-stack:
  added: []
  patterns:
    - "A seed reads its references back from the product rather than minting them"
    - "A seed asserts the effect of a write, not just its status code"

key-files:
  created: []
  modified:
    - scripts/seed_restaurantos.py
    - scripts/CREDENTIALS.md
    - scripts/README-seed.md

key-decisions:
  - "The whole chain is skipped when its invoice number already exists — reconciling only the invoice was silently inflating stock on every run."
  - "The README's leak section was corrected and re-measured, not deleted."

patterns-established:
  - "A stale warning is worse than none: it trains the reader to disbelieve the next one. Correct it in place and show the measurement."

requirements-completed: [PIW-01, PIW-04]

duration: 40min
completed: 2026-08-12
status: complete
---

# Phase 36 Plan 07: The seed tells the truth Summary

**The seed now creates a complete purchasing chain for every tenant out of ingredients it read back
from inventory in units it read from the registry — asserting after each receipt that stock actually
moved — and `CREDENTIALS.md` no longer warns that purchasing is empty, because it is not.**

## Performance

- **Duration:** ~40 min · **Tasks:** 3 of 3 · **Files modified:** 3
- Seed run: **17 of 17 principals authenticated**, purchasing seeded for both tenants, **no
  purchasing gap** in the gap list
- Gated drive: `PHASE31_GATE=1 … ` → **exit 0**, 49 pass / 0 fail

## The defect the seed was carrying

```python
ingredient = det(t.tenant_id, "po-ingredient", str(n))   # a MINTED id
... "uom": "kg"                                          # hand-typed
```

That generated id is not merely unseeded data — it is the exact identifier phase 22 traced through
a dead-lettered goods receipt to a purchase order that closed as `FULLY_RECEIVED` and produced no
stock row, no inventory movement and no journal entry. Plan 36-04 now refuses it at the API with
`422 INGREDIENT_NOT_FOUND`, so this plan was not optional: the seed would have begun failing loudly
on its own defect.

Both are gone. Ingredients are read back from the listing the seed's own inventory step created and
chosen by sorted position so re-runs stay stable; unit codes are read from the tenant's registry.

## What a seeded tenant now has

```
✓ floating-terrace: 6 vendor invoice(s) matched through PO → approve → send → GRN → invoice,
  dated across 6 business date(s); one raised from a 500 G catalog pack
✓ control-bistro-isolation-test-tenant: 1 vendor invoice(s) … one raised from a 500 G catalog pack
```

| per tenant | |
|---|---|
| Vendor | 1, reconciled on a `seed:<tenantId>` marker |
| Vendor catalog item | 1 — a 500 g pack, priced per pack |
| Purchase orders | 6 (Floating Terrace) · 1 (Control Bistro) |
| Goods receipts | one per order, **each asserted to have moved stock** |
| Vendor invoices | one per order, across that many business dates |

The **first** order of each tenant is raised from the catalog item rather than as a hand-typed line,
because that is the only shape that exercises the two-step pack conversion — purchasing divides out
the pack units per order unit, inventory converts the pack unit into the ingredient's stock unit. A
hand-typed line has a factor of one on step one and proves nothing about step two.

## The assertion that matters most

After every receipt the seed reads the stock level back and asserts the quantity moved:

```
GAPS.append(f"{t.slug}: goods receipt for {invoice_no} reported success but no stock movement
             reached ingredient {ordered.get('sku')} — this is defect D-5's shape and must not
             be treated as a seeded receipt")
```

A receipt that answers 200 and produces no stock is precisely what plan 36-01 measured. The seed is
the one place that can catch it on **every run** rather than during a demo, and it now does.

## An idempotency defect found while proving idempotency

The acceptance criterion is "a second run reconciles and creates no duplicates". It did not.

Only the **invoice** was reconciled — the create returned 409 on a duplicate invoice number and was
counted as reconciled. Everything before it ran again: a new purchase order, a new approval, a new
dispatch, a new goods receipt. Measured: **29 seed-marked purchase orders behind 7 invoices**, and
every one of those receipts had moved real stock. A seed that quietly inflates inventory every time
it runs is a seed nobody can measure against.

Fixed by checking the invoice numbers the tenant already has **before** raising anything:

```
BEFORE fix:  run 1 → 29 orders / 7 invoices     run 2 → 36 orders / 7 invoices
AFTER  fix:  run 1 → 36 orders / 7 invoices     run 2 → 36 orders / 7 invoices
```

The first attempt at the fix did nothing, because `GET /api/v1/purchasing/invoices` requires
`branchId` and answers 400 without it — the set came back empty and the reconciliation silently
skipped. That is written into the code comment, because it is the same class of mistake as the
original: a call that fails quietly and leaves the caller believing it looked.

## The documents

**`CREDENTIALS.md`** — the caveat is deleted:

> ~~**Purchasing is empty for Floating Terrace.** … purchasing answered **403 for the MANAGER**, so
> no vendor, purchase order or goods receipt was created.~~

and the counts table carries purchasing rows from a real run. **Every other caveat is untouched** —
that section earns its credibility from being accurate, and thinning it opportunistically is how it
stops being read.

**`README-seed.md`** — the "leak the seed works around" section described a live cross-tenant leak.
It is **corrected in place and re-measured**, not deleted, because a stale warning trains the reader
to disbelieve the next one. Measured against the live databases as the service roles rather than
read off the migration — a migration establishes what was intended, a query establishes what the
database does:

```
pg_class, as the owning service role
  pos_db:        menu_items | t | t   menu_categories | t | t   orders | t | t
  purchasing_db: vendors    | t | t   purchase_orders | t | t   vendor_invoices | t | t

the listings themselves, through the gateway as a floating-terrace MANAGER
  GET /api/v1/pos/menu/items/admin  -> 13 rows;  that tenant has 13   (all: 85 across 15 tenants)
  GET /api/v1/purchasing/vendors    -> 17 rows;  that tenant has 17   (all: 30 across 14 tenants)
```

Both listings return exactly their own tenant's rows. The seed's marker-based reconciliation is kept
anyway — belt-and-braces now rather than a workaround, and the right property for a script whose job
is to detect a regression rather than rely on one not happening.

**The seed's own RLS comment needed no change.** It had already been corrected and re-measured on
2026-08-07 and matches my canary exactly. Verified rather than rewritten.

## The gate that closes the phase

The measurement that opened phase 36 is the measurement that closes it — the same script, unchanged
assertions:

| | plan 36-01 | now |
|---|---|---|
| `M-09` / `O-09` receive both lines in one call | **FAIL 409** | **PASS 200** |
| `P1` PO for an ingredient inventory never saw | accepted → `FULLY_RECEIVED`, no stock, DLQ +1 | **422 `INGREDIENT_NOT_FOUND`**, nothing written |
| `P2` PO with unit `FURLONG` | accepted → 7 furlongs became 7 KG | **422 `PACK_UOM_INVALID`**, nothing written |
| `MD-UOM-UPDATE` | **404** | **200** |
| `MD-UOM-ARCHIVE` | **404** | **200** |
| conversion probe | +4.0 KG (already correct) | +4.0 KG |
| **tally** | **47 pass / 2 fail** | **49 pass / 0 fail** |

```
PHASE31_GATE=1 bash scripts/e2e/phase31-procure-to-pay-e2e.sh   →   exit 0
```

**No assertion was weakened, removed or made conditional.** The two that failed are the two that
now pass, and the probes that previously reported success-then-nothing now report a refusal.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The seed's idempotency was broken beyond the invoice**

- **Found during:** Task 1, verifying the second-run criterion
- **Issue:** described above — 29 orders behind 7 invoices, each run moving real stock.
- **Fix:** reconcile the whole chain on the invoice number before raising anything.
- **Why not deferred:** the plan's own acceptance criterion is that a second run creates no
  duplicates, and it did not. Leaving it would have made the criterion a claim rather than a check.

**2. [Rule 1 — Bug] Two list endpoints require `branchId` and answer 400 without it**

- **Issue:** both `GET /purchasing/invoices` and `GET /inventory/stock` require it. Omitting it
  produced an empty set that looked like "nothing exists" — which would have made the
  reconciliation skip silently and the stock assertion raise a false gap.
- **Fix:** both calls pass it, with the reason in a comment at each site.

**Total deviations:** 2, both Rule 1, both in the seed.

## Issues Encountered

- **The purchasing counts in the live database exceed what the seed produces**, because the phase's
  own e2e drives created data too (17 vendors for Floating Terrace, most of them from
  `phase31-*-e2e.sh`). The credentials table reports **what the seed produces per tenant**, which is
  the reproducible number a reader can compare against, rather than the current row count.
- `hr-service`, `kitchen-service` and `reporting-service` are running stale jars. None is in this
  phase's path; the gate reported and did not block on them.

## User Setup Required

None. `python3 scripts/seed_restaurantos.py` — idempotent, re-runnable.

## Self-Check: PASSED

- `scripts/seed_restaurantos.py` — no `det(...)`-minted ingredient id on any PO line; syntax OK
- `scripts/CREDENTIALS.md` — the plan's own verifier prints "credentials document is current"
- `scripts/README-seed.md` — leak section corrected, purchasing seed documented
- seed run — 17/17 principals, purchasing seeded for both tenants, no purchasing gap
- second run — 36/7 unchanged, no duplicates
- `PHASE31_GATE=1 bash scripts/e2e/phase31-procure-to-pay-e2e.sh` — **exit 0**, 49/0
- commit `3880e91` — FOUND, exactly 3 files
