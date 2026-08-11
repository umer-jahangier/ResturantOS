---
phase: 37-finance-orders-integration
plan: 13
subsystem: ui
tags: [finance, guide, documentation, claims-registry, honesty-gate]
requires:
  - phase: 37-02
    provides: the claim registry, the typed loader and the three-direction honesty gate
  - phase: 37-11
    provides: the Transactions tab this guide explains
  - phase: 37-12
    provides: the Takings tab, its reason vocabulary and the exported finance tab array
provides:
  - "/app/finance/guide — the Guide tab, one section per finance tab"
  - "frontend/lib/finance/guide/tabs.json — the per-tab prose, as data so a test can read it"
  - "GuideTab, GuideSection, ClaimCallout"
  - "guide-coverage.test.tsx — a finance tab with no section fails a test"
  - "eight new registry claims (FIN-GUIDE-0005 … 0012) and their markers"
affects: [37-14]
tech-stack:
  added: []
  patterns:
    - "Prose as data, so a test can compare it against the live tab array"
    - "A rule is rendered by ID from the registry, never as a string a component was handed"
    - "A claim is bound to an assertion that already exists; an unbindable claim is omitted and recorded"
key-files:
  created:
    - frontend/lib/finance/guide/tabs.json
    - frontend/lib/finance/guide/tabs.ts
    - frontend/components/finance/guide/GuideTab.tsx
    - frontend/components/finance/guide/GuideSection.tsx
    - frontend/components/finance/guide/ClaimCallout.tsx
    - frontend/components/finance/guide/__tests__/GuideTab.test.tsx
    - frontend/components/finance/__tests__/guide-coverage.test.tsx
    - frontend/app/(tenant)/app/finance/guide/page.tsx
    - frontend/e2e/journeys/finance-guide.spec.ts
  modified:
    - frontend/lib/finance/guide/claims.json
    - frontend/lib/finance/guide/__tests__/claims-registry.test.ts
    - frontend/app/(tenant)/app/finance/layout.tsx
    - frontend/components/shared/sidebar-nav-items.ts
    - frontend/__tests__/shared/nav-permission-matrix.test.tsx
    - services/finance-service/src/test/java/io/restaurantos/finance/CoaProvisioningIT.java
    - services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryBalanceTriggerIT.java
    - services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryImmutabilityIT.java
    - services/finance-service/src/test/java/io/restaurantos/finance/JournalEntryTraceabilityIT.java
    - shared-lib/src/test/java/io/restaurantos/shared/money/MoneyDisplayAuthorityTest.java
key-decisions:
  - "Two claims LEFT OUT for want of proof — 37-03's and 37-08's — rather than writing a test to make a sentence sayable"
  - "The Guide is gated as widely as Takings: gating the explanation behind the thing it explains is the wrong way round"
  - "The guide's prose lives in JSON so the coverage test can read it against the live tab array"
requirements-completed: [FIN-13]
coverage:
  - id: D1
    description: "A Guide tab explains every finance tab: what it is, when you use it, what a typical entry looks like, what it affects downstream"
    requirement: FIN-13
    verification:
      - kind: unit
        ref: "guide-coverage.test.tsx reads FINANCE_TABS from the layout — 11 tabs, 11 sections, labels matched; each answer asserted longer than a placeholder"
        status: pass
      - kind: e2e
        ref: "playwright A, live stack: every tab in the rendered tab bar has an h2 section; 11 sections on the page"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every behavioural claim is a registry row bound to a live test, and the two-way gate passes"
    verification:
      - kind: automated
        ref: "make verify-guide-claims — claims: 12, markers: 15, PASS: 42, FAIL: 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "A finance tab with no guide section fails a test"
    verification:
      - kind: unit
        ref: "demonstrated: added a Budgets tab to FINANCE_TABS → 2 assertions failed; reverted → 8 passed"
        status: pass
    human_judgment: false
  - id: D4
    description: "A sentence outside the registry has no path to the page"
    verification:
      - kind: unit
        ref: "ClaimCallout takes an id and looks the words up; every rendered callout traces to a row; an unknown id renders a loud role=alert, asserted"
        status: pass
      - kind: e2e
        ref: "playwright A: zero claim-missing elements on the live page"
        status: pass
    human_judgment: false
  - id: D5
    description: "The guide's rules hold when an owner follows them"
    verification:
      - kind: e2e
        ref: "playwright B: the open-till rule read off the page, then followed through the gateway — and it CAUGHT a false sentence (see Deviations)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The plan's full task-3 journey — close a period and attempt a back-dated entry"
    verification: []
    human_judgment: true
    rationale: "NOT DONE. Closing a period on a development database nine workstreams read is destructive and not reversible in a journey. The rule is bound to AccountingPeriodIT, which the gate verifies is live; the surface-level half was not exercised. Stated, not skipped quietly."
  - id: D7
    description: "The NO_OPEN_TILL half of FIN-GUIDE-0001, exercised at the surface"
    verification: []
    human_judgment: true
    rationale: "NOT DONE. Reproducing it means CLOSING the seeded cashier's open till on a shared database. Bound to CashPaymentRequiresTillIT, which the gate verifies is live and not skipped. The permission half — waiting staff refused earlier and for a different reason — IS driven live."
  - id: D8
    description: "The human checkpoint — read the whole guide as an owner and flag any sentence assuming accounting knowledge"
    verification: []
    human_judgment: true
    rationale: "NOT RUN. The jargon test catches the words D-37-03 names, which is a floor, not a substitute for a person reading it."
duration: 60min
completed: 2026-08-12
status: complete
---

# Phase 37 Plan 13: The Guide Tab Summary

**Finance now explains itself: eleven tabs, four questions each, and every boxed rule bound to a
test that would fail if the product stopped behaving that way. The registry grew from 4 claims to
12, and the journey that reads the guide and then does what it says caught a sentence that was
false.**

## What an owner can now SEE that they could not

`/app/finance/guide` — reachable from the Finance tab bar and from the sidebar. Screenshot:
`37-13-finance-guide.png`.

```
How Finance works
  Jump to:  Takings · Transactions · Accounts · Journal Entries · General Ledger ·
            Periods · Expenses · AP Aging · House Accounts · AR Aging · Guide

  Periods                          Closing a month so its numbers stop moving.
    WHAT IT IS                      WHEN YOU USE IT
    A month at a time, each open    Once a month, after the last of the month's paperwork
    or closed. Closing one is you   is in… Not before — reopening is deliberate and leaves
    saying: this month is           a trace.
    finished, and nothing new may
    be dated into it.

    WHAT A TYPICAL ENTRY LOOKS LIKE WHAT IT AFFECTS ELSEWHERE
    July is closed on the 4th of    Once a month is closed, Journal Entries will refuse
    August. A supplier bill dated   anything dated inside it… That is what makes a report
    the 28th of July arriving on    you printed last week still say the same thing today.
    the 6th goes into August
    instead, with a note.

    RULES WORTH KNOWING BEFORE YOU HIT THEM
    ┃ Once you close an accounting period, the system refuses any new entry dated inside it.
    ┃ Closing a month is a promise that the month's numbers will not move again…
    ┃ Checked by 1 test in this codebase. If the product stopped behaving this way, it would fail.
```

## The journey caught a false sentence — which is the whole point

37-02's `FIN-GUIDE-0001` explained the open-till rule like this:

> *"If a **waiter** takes an order and tries to settle it in cash without opening a till, the payment
> is refused with `NO_OPEN_TILL`…"*

Driven through the gateway as `waiter@terrace.local`, the product answers **403
`PERMISSION_DENIED`**. Waiting staff may not take payments **at all**, so they never reach the till
rule. The headline claim was true and integration-asserted; the illustration described a refusal
nobody would ever see — precisely the kind of sentence that generates the support ticket it was
written to prevent.

The registry now says what the product does, and the journey asserts it:

> *"If a **cashier** tries to settle a bill in cash before opening a till, the payment is refused
> with `NO_OPEN_TILL` and nothing at all is recorded against the order; open the till and the same
> settlement goes through. **Waiting staff are a separate matter — they are not permitted to take
> payments at all, so they are turned away earlier and for a different reason.**"*

No component test could have found this. It needed a real account, hitting the real gateway, doing
what the page told it to.

## The claim register after this plan

| ID | Surface | Bound to | Added by |
|---|---|---|---|
| 0001 | cross-cutting | `CashPaymentRequiresTillIT` ×2 | 37-02 (prose corrected here) |
| 0002 | periods | `AccountingPeriodIT.postToLockedPeriod_returns423` | 37-02 |
| 0003 | journal | `DiscountedOrderRevenuePostingIT` ×2 | 37-02 |
| 0004 | cross-cutting | `step-up-totp.spec.ts` | 37-02 |
| 0005 | journal | `JournalEntryBalanceTriggerIT` ×2 | **37-13** |
| 0006 | journal | `JournalEntryImmutabilityIT` ×3 | **37-13** |
| 0007 | transactions | `JournalEntryTraceabilityIT` ×2 | **37-13** (37-04's claim) |
| 0008 | coa | `CoaProvisioningIT` ×2 | **37-13** |
| 0009 | takings | `DailyTakings.test.tsx` ×2 | **37-13** (37-12's claim) |
| 0010 | takings | `DailyTakings.test.tsx` ×2 | **37-13** |
| 0011 | takings | `DailyTakings.test.tsx` ×2 | **37-13** |
| 0012 | cross-cutting | `MoneyDisplayAuthorityTest` ×2 + `money-display-authority.test.ts` | **37-13** (37-01's work) |

`make verify-guide-claims` → **claims: 12 · markers: 15 · PASS: 42 · FAIL: 0**.

**Not one test was written to satisfy a claim.** Every binding is to an assertion that already
existed for its own reasons and would fail if the behaviour regressed for any reason at all.

## Claims LEFT OUT for want of proof

This is the correct outcome, and both were left out on the explicit instruction of the plan that
made the work true:

1. **37-03 — "A sale belongs to the trading day it was closed on, and your reports and your accounts
   always name the same day for it."** Its own summary says: *"Do not add this claim until the
   migration is applied — it is not yet true of the 73 historic rows."* The migration is blocked
   awaiting the user. **Adding this claim would make the guide lie about historic data.**
2. **37-08 — "Transactions shows every payment, refund and void — one line per payment, so a bill
   split between cash and card appears twice."** Its summary: *"Asserted by: not yet — no IT exists.
   Do not add this claim until one does."* `TransactionRegisterIT` is still unwritten.

Both should be added the moment their proof lands. Neither is in `tabs.json`, so the guide does not
gesture at them either.

## Tab-to-section map

| Tab | Anchor | Rules shown |
|---|---|---|
| Takings | `#takings` | 0009, 0010, 0011, 0001, 0003 |
| Transactions | `#transactions` | 0007, 0012 |
| Accounts | `#accounts` | 0008 |
| Journal Entries | `#journal-entries` | 0005, 0006, 0002, 0003 |
| General Ledger | `#gl` | 0003, 0012 |
| Periods | `#periods` | 0002, 0004 |
| Expenses | `#expenses` | — |
| AP Aging | `#ap-aging` | — |
| House Accounts | `#house-accounts` | — |
| AR Aging | `#ar-aging` | — |
| Guide | `#guide` | 0001, 0004 |

D-37-03's four support-ticket rules are placed **where an owner meets them**, and that placement is
asserted rather than assumed: the open-till rule on Takings, the period lock on Periods **and**
Journal Entries, the discount rule on Takings **and** General Ledger, the second-factor rule on
Periods, which is where the step-up actually fires.

## Deviations from plan

### [Plan defect] `ClaimCallout` does not narrow at compile time

The plan says: *"Type `ClaimCallout` to accept only a claim id from the union the loader exports…
That is what makes an unregistered sentence a compile error rather than a review catch."*

**TypeScript widens JSON string fields to `string`**, so `FinanceGuideClaimId` — derived as
`(typeof registry.claims)[number]["id"]` — resolves to `string`, not a literal union. `tsc` will not
catch a mistyped id. The structural half of the promise is intact and is the more important half:
the component accepts an **id**, not prose, so free text has no path onto the page under any
circumstances. The id check moved to runtime (a loud `role="alert"`, never a silent blank) and to
two tests. Recorded in `ClaimCallout.tsx`'s header rather than left as an unnoticed hole.

### [Deviation] 37-02's exact-list assertion was loosened

`claims-registry.test.ts` asserted `claims.map(c => c.id)` **equals** exactly the four seed ids.
That was right while the registry was a seed and wrong the moment 37-13 collected the phase's
claims — which is the job 37-02's own `_readme` assigns to this plan. It now asserts what it was
actually protecting: the four D-37-03 names are present **by name**, and the ids are unique and
contiguously numbered so a marker can never point at a gap.

### [Rule 2] The Guide is gated as widely as Takings

Gating the explanation of the module behind `finance.journal.view` — the permission that lets you
into the parts being explained — is the wrong way round. The person most likely to need this page is
the one who has seen the least of the module. Same three codes as Takings; a cashier still sees
neither.

### [Deviation] Task 3's period-lock half was not driven

The plan asks the journey to close a period and attempt a back-dated entry. Closing a period on a
development database nine workstreams read is destructive and not undoable inside a test. The rule
stays bound to `AccountingPeriodIT`, which the gate verifies is live and not skipped.

## An incident, and what it cost

Mid-verification, `pos-service` went **stale** — a sibling agent rebuilt its jar under the running
JVM — and the gateway returned 503 for every POS route while `curl` straight to `:8084` returned
200. `check-stale-jars.sh` named it; the process was replaced and the journeys re-run green. This is
the fourth time this session's stack has been misread this way.

While probing the open-till rule I applied a **Rs 1.00 cash payment** to a probe order
(`ORD-20260812-0003`). It is **voided**; the Rs 1.00 payment remains on the record as a void event,
which is the correct and honest outcome but is litter I created in seeded data. Three empty DRAFT
orders from the same probing were also left; they carry no money and no items.

## Honest gaps

- **No human has read the guide end to end.** The jargon test catches the words D-37-03 names by
  name; it cannot tell you whether a paragraph explains anything. That check is the plan's blocking
  checkpoint and it has not been run.
- **`NO_OPEN_TILL` and `PERIOD_LOCKED` are proven by integration test, not at the surface.** Both
  need destructive state changes on a shared database.
- **Four tabs have no rules** — Expenses, AP Aging, House Accounts, AR Aging. Not an oversight: no
  claim about them is currently bound to a test, and inventing one would defeat the mechanism.
- **The prose describes House Accounts and AR Aging from the code's shape, not from driving them.**
  Those two sections are the likeliest to contain an inaccuracy of the kind the waiter sentence
  turned out to be, and nothing here has tested them the way the open-till rule was tested.
- **GitNexus is stale**; caller analysis was by grep and is stated as such.

---
*Phase: 37-finance-orders-integration*
