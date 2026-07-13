# Phase 8: Inventory & Recipe Management - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-13
**Phase:** 8-inventory-recipe-management
**Areas discussed:** Recipe version at order time, Oversell / negative stock, Depletion-failure & COGS books, Expiry & lot tracking scope

---

## Recipe version at order time (INV-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Resolve by order timestamp | Pick the version effective at the order's time via `effective_from`; honors INV-02, no POS change | ✓ |
| Always use current recipe | Simplest; ignores mid-service recipe edits | |
| Stamp version onto the order | Most precise; requires pos-service + event-contract change | |

**User's choice:** Resolve by order timestamp.
**Notes:** The `ORDER_CLOSED` event carries no recipe ref (only `menuItemId`+`qty`+`closedAt`), so timestamp resolution against the recipe's `effective_from` is the no-cross-service-change path. Stamp-on-order deferred.

---

## Oversell / negative stock (INV-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Allow negative + alert | Sale already happened; let stock go negative and fire low-stock alert | ✓ |
| Clamp at zero | Never go below zero; under-records real consumption | |
| Deplete available + flag shortage | Subtract what's on hand, record shortfall separately | |

**User's choice:** Allow negative + alert.
**Notes:** Aggregate `qty_on_hand` may go negative; lot rows floor at zero. Matches the spec's plain-subtract depletion sample.

---

## Depletion-failure & COGS books (INV-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-retry, then park + alert | House DLQ pattern (3 retries, backoff), dead-letter + notify; self-heals | ✓ |
| Require manual resolution each time | Every failure waits for a person | |

**User's choice:** Auto-retry, then park + alert.
**Notes:** COGS *ledger posting* is Phase 9; Phase 8 concern is reliable depletion + `STOCK_DEPLETED` publish. Consumer idempotent via `processed_events`.

---

## Expiry & lot tracking scope (INV-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Nightly sweep + lightweight lots | Per-receipt lots + scheduled expiry sweep; aggregate MAC depletion (no FEFO) | |
| Full lot tracking + FEFO depletion | Per-batch lots + oldest-expiry-first depletion; MAC valuation retained | ✓ |
| Defer expiry to a later phase | Low-stock alerts only now | |

**User's choice:** Full lot tracking + FEFO depletion.
**Notes:** User proposed a scheduler that triggers on batch expiry dates and asked whether it's the enterprise standard. Confirmed: yes, but implemented as ONE nightly sweep query (not per-batch timers), which is how Toast / Lightspeed / Restaurant365 / Oracle Simphony do shelf-life alerting. This implies per-receipt lot rows. User then elevated to full FEFO. Reconciled the FEFO-vs-MAC tension explicitly: **FEFO governs physical lot-quantity rotation; MAC governs COGS valuation (INV-03 mandate retained).** True FIFO/actual-lot costing rejected. User confirmed "Lock it in: FEFO rotation + MAC valuation."

---

## Claude's Discretion

- UOM conversion + effective-qty rounding (spec M2.4 formula; BigDecimal → HALF_UP for cost→paisa).
- Missing-recipe handling (skip line per spec default; optional manager-review flag).
- Transfer in-transit variance auto-post threshold vs manual review.
- Which inventory internal-endpoint paths ship (only `GET /internal/grn/pending-count` is required).
- Whether count-variance / transfer / wastage JEs post synchronously vs via events.

## Deferred Ideas

- Stamp recipe version onto the order at order-open time (pos-service + event change) — future.
- Finance revenue+COGS ledger auto-posting from `ORDER_CLOSED` — Phase 9.
- True FIFO/actual-lot COGS costing — rejected (contradicts INV-03 MAC).
- Purchasing / PO / GRN 3-way match — Phase 10.
