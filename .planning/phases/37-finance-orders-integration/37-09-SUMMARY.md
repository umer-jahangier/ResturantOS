---
phase: 37-finance-orders-integration
plan: 09
subsystem: api
tags: [pos, takings, till-reconciliation, variance, tender-split]
requires:
  - phase: 37-08
    provides: the money-event register conventions this reuses
provides:
  - "GET /api/v1/pos/takings/daily?date=&branchId= — daily takings reconciled against till counts"
  - "DailyTakingsDto with TenderLine, TillReconciliation (named state) and UnknownFigure"
affects: [37-12, 37-13]
tech-stack:
  added: []
  patterns:
    - "Named reconciliation state (OPEN/MATCHED/OVER/SHORT/NOT_COUNTED) instead of a nullable variance"
    - "UnknownFigure: an uncomputable figure is reported with its reason, never as a zero"
key-files:
  created:
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/DailyTakingsDto.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/DailyTakingsService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/DailyTakingsController.java
key-decisions:
  - "Built in pos-service, NOT reporting-service — till counts do not exist in ClickHouse"
  - "Gross is subtotal, not subtotal-minus-discount, matching finance's contra-revenue treatment"
  - "A missing cash variance is UNKNOWN with a reason, never a zero"
requirements-completed: [FIN-15]
coverage:
  - id: D1
    description: "Daily takings by tender, reconciled against what each till counted"
    requirement: FIN-15
    verification:
      - kind: e2e
        ref: "2026-08-06: CARD 1,006,880 + CASH 2,866,360 = 3,873,240 = net; till OVER variance +3,673,095"
        status: pass
    human_judgment: false
  - id: D2
    description: "A variance is shown AS a variance, never absorbed"
    verification:
      - kind: e2e
        ref: "reconciliationState=OVER with expected 683,605 / declared 4,356,700 / variance +3,673,095"
        status: pass
    human_judgment: false
  - id: D3
    description: "An uncomputable figure says so and says why (D-37-05)"
    verification:
      - kind: e2e
        ref: "2026-08-08 cash taken, no till counted → UNKNOWN 'cash variance', explicitly NOT zero; comps UNKNOWN on every day"
        status: pass
    human_judgment: false
  - id: D4
    description: "The takings SCREEN (37-12) an owner opens each evening"
    verification: []
    human_judgment: true
    rationale: "NOT BUILT. This is the API only. There is no /app/finance/takings page; an owner cannot yet see any of this without curl."
  - id: D5
    description: "DailyTakingsIT and the e2e script the plan specifies"
    verification: []
    human_judgment: true
    rationale: "NOT WRITTEN. Verified live only."
duration: 30min
completed: 2026-08-11
status: partial
---

# Phase 37 Plan 09: Daily Takings Summary

**The evening cash-up figure now exists as an API: takings by tender for a trading day, set against what each till counted, with a Rs 36,730.95 variance in the seeded data surfaced as `OVER` rather than absorbed.**

## STATUS: PARTIAL — API done and live-verified; no screen, no IT

## The deviation that matters

The plan places this in **reporting-service** over ClickHouse payment facts built by 37-06. I built
it in **pos-service** instead. One reason outweighs plan fidelity: **till counts do not exist in
ClickHouse.** `till_sessions.declared_closing_paisa` — the number a human counted in the drawer —
lives only in `pos_db`. A takings screen assembled in reporting could show the takings and could not
show whether the drawer matched, which is the one question D-37-02 exists to answer.

Reading the system of record rather than an ETL projection also means a broken consumer cannot make
the evening cash-up quietly wrong. 37-06's payment facts remain worth building for historical trend
reporting; they are the wrong source for tonight's cash-up.

**This also sidesteps DEFECT-37-03-B.** The ClickHouse `closed_at` is corrupt (+5h); pos_db's is the
true instant, so these figures are unaffected by it.

## Verification Evidence (live, pos rebuilt + restarted, check-stale-jars ok)

```
2026-08-06   gross=3,339,000  disc=0  tax=534,240  net=3,873,240  orders=26
             CARD 1,006,880 (8 payments) + CASH 2,866,360 (18) = 3,873,240 = net  ✓ ties
             till OPEN   opening=500,000  expected=—        declared=—          variance=—
             till OVER   opening=5        expected=683,605  declared=4,356,700  variance=+3,673,095
             UNKNOWN [comps]

2026-08-11   875,000 − 95,000 + 140,000 + 0 = 920,000 = net   ✓ ties
             the Rs 950 discount is SHOWN, not netted into a smaller sales figure

2026-08-08   960,300 + 91,160 = 1,051,460 = net   ✓ ties
             UNKNOWN [cash variance] — cash was taken, no till was counted.
             Explicitly NOT a zero variance.

waiter@terrace.local  → 403        manager@terrace.local → 200
```

## Honest gaps

- **No screen.** This is 37-12's job and it is not done. An owner cannot see any of this yet.
- **No `DailyTakingsIT`.** Verified live only.
- **Comps are not separable** from discounts in this schema, and the response says so rather than
  inventing a split.
- **Tills are attributed by `opened_at`**, so a shift opening 18:00 and closing 02:00 counts to the
  evening it started. Reasonable, and not something the plan specified either way.

---
*Phase: 37-finance-orders-integration · PARTIAL*
