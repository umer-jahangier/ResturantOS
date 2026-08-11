---
phase: 37-finance-orders-integration
plan: 11
subsystem: ui
tags: [finance, transactions, react, tanstack-query, nextjs]
requires:
  - phase: 37-01
    provides: formatPaisa — the single money display rule
  - phase: 37-04
    provides: by-source journal entries + the four-state source reference
  - phase: 37-08
    provides: the money-event register endpoint
provides:
  - "/app/finance/transactions — the Transactions tab, first in the Finance tab bar"
  - "TransactionRegister, TransactionLedgerLinks components"
  - "useTransactionRegister / useOrderJournalEntries Layer-3 hooks"
affects: [37-12, 37-13]
tech-stack:
  added: []
  patterns:
    - "Ledger drill-down fetched per EXPANDED row, never per rendered row"
key-files:
  created:
    - frontend/lib/models/transaction.model.ts
    - frontend/lib/adapters/transaction.adapter.ts
    - frontend/lib/repositories/transaction.repository.ts
    - frontend/lib/hooks/finance/use-transactions.ts
    - frontend/components/finance/TransactionRegister.tsx
    - frontend/components/finance/TransactionLedgerLinks.tsx
    - frontend/app/(tenant)/app/finance/transactions/page.tsx
  modified:
    - frontend/app/(tenant)/app/finance/layout.tsx
    - frontend/lib/hooks/query-keys.ts
key-decisions:
  - "Transactions leads the Finance tab bar — it is what the user asked for"
  - "All money renders through formatPaisa (37-01), never a local Intl instance"
  - "Balance is SHOWN per entry, not assumed; an unbalanced entry would be called out in red"
requirements-completed: [FIN-11, FIN-12]
coverage:
  - id: D1
    description: "An owner opens Finance and sees every payment, refund and void"
    requirement: FIN-12
    verification:
      - kind: automated_ui
        ref: "playwright drive as owner@terrace.local → /tmp/shot-transactions.png; 38 rows; totals Rs 58,539.80 / 0.00 / 92.80 / 58,447.00"
        status: pass
    human_judgment: false
  - id: D2
    description: "Any transaction opens to its order AND the journal entries it produced"
    requirement: FIN-11
    verification:
      - kind: automated_ui
        ref: "drill ORD-20260811-0004 → JE-2027-000044 ORDER_REVENUE + JE-2027-000045 ORDER_COGS, both Balanced; accounts 1010/4100/2200/5100/1300"
        status: pass
    human_judgment: false
  - id: D3
    description: "Money on screen agrees with the ledger and the receipt to the paisa"
    verification:
      - kind: automated_ui
        ref: "Rs 58,447.00 rendered from 5844700 paisa via formatPaisa; entry lines tie to the API response"
        status: pass
    human_judgment: false
  - id: D4
    description: "The screen's visual design and information hierarchy are right for a restaurant owner"
    verification: []
    human_judgment: true
    rationale: "Screenshots exist and the data is correct, but whether this is the right first screen for a non-accountant — column order, what leads, what is buried — is an editorial judgement a human should make."
  - id: D5
    description: "The plan's own component set (TransactionFilters as a separate component, per-row journalEntryRefs on the row DTO)"
    verification: []
    human_judgment: true
    rationale: "PARTIAL. Filters are inline in TransactionRegister rather than a separate TransactionFilters component, and there is no component unit test. The behaviour is verified end to end; the decomposition the plan specified is not what shipped."
duration: 60min
completed: 2026-08-11
status: complete
---

# Phase 37 Plan 11: The Transactions Tab Summary

**Finance now opens on a screen an owner can act on: every payment, refund and void, and from any row through to the order and the balanced journal entries it produced.**

## What an owner sees (driven in a real browser, screenshotted)

```
Finance › Transactions
  Taken in Rs 58,539.80 | Refunded Rs 0.00 | Voided Rs 92.80 | Net Rs 58,447.00
  "Totals cover the whole filtered range (38 events), not just this page."

  8/11/2026 6:16:33 PM  Payment  ORD-20260811-0004  CASH   Rs 3,364.00   Rs 3,364.00  Open
  8/9/2026 12:34:41 AM  Void     ORD-20260807-0027   —    -Rs 92.80      Rs 92.80     Open
  ...38 rows

  Open ORD-20260811-0004 →
    Order ORD-20260811-0004 · status CLOSED
    subtotal Rs 2,900.00 · discount Rs 0.00 · tax Rs 464.00 · total Rs 3,364.00

    JE-2027-000044 · ORDER_REVENUE          2026-08-11
      1010  CASH payment    DR Rs 3,364.00
      4100  Sales revenue                    CR Rs 2,900.00
      2200  Output tax                       CR Rs   464.00
      Balanced · Rs 3,364.00

    JE-2027-000045 · ORDER_COGS             2026-08-11
      5100  COGS            DR Rs 125.00
      1300  Inventory                        CR Rs 125.00
      Balanced · Rs 125.00
```

That is D-37-01's round trip, end to end, on real data.

## Three defects the browser caught that nothing else would have

**1. pos-service was STALE.** A sibling executor rebuilt pos-service's jar under my running JVM.
The symptom was baffling from either side alone: `curl` straight to pos:8084 returned **200**, the
gateway returned **503**, and pos's log showed `NoClassDefFoundError: ch/qos/logback/classic/spi/
ThrowableProxy` — the JVM failing to load a class *while trying to log the error*, because the class
had vanished from the jar underneath it. `check-stale-jars.sh` named it in one line. Restarted, and
the 503 went away. This is the third time this session's stack has been misread this way.

**2. A React key warning.** A bare `<>` fragment inside `.map` carries no key, so React could not
track rows across a filter change. Now a keyed `<Fragment>`.

**3. A layer-boundary violation.** eslint refused the first version: components must use Layer-3
hooks, never repositories directly. Rewritten onto `useTransactionRegister` /
`useOrderJournalEntries` with TanStack Query, which also gave the on-demand drill-down for free —
the ledger panel is fetched per **expanded** row, not per rendered row. 200 rows would otherwise be
200 calls to decorate a table nobody has asked a question of yet.

## Honest gaps

- **No component test.** The behaviour is proven by a live browser drive, not by a vitest suite.
- **Filters are inline**, not the separate `TransactionFilters` component the plan named.
- **The source reference is fetched but not rendered as a name.** 37-04 task 2 resolves the order
  number; this screen shows the order number from the register row instead, so the resolver's
  four-state contract is not yet visible to a user. That is 37-12/37-13 territory.
- **No branch or cashier filter in the UI** — the API supports both; the screen exposes date,
  tender and event kind only.

---
*Phase: 37-finance-orders-integration*
