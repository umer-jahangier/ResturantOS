# Phase 32 — Finance ↔ Orders Integration, Transactions & Guide · CONTEXT

**Depends on:** 14 (money path, landed), 22b (financial wiring audit, landed)

## Why

The user: *"Financial system is not properly integrated with daily orders, like there was no
system to see all the orders transactions in the app, and add a complete guide tab in Financial
system which will explain how this module is working, what each tab/module is and how it
functions."*

The plumbing largely works — phase 22b traced ten money paths with real transactions and proved
order → payment → close → balanced journal entry, including discounts and comps. What is missing
is **the window into it**. An owner cannot see today's takings, cannot open a transaction and see
what it produced in the ledger, and cannot understand what any of the finance tabs are for.

## Locked decisions

**D-37-01 — A transactions view is the centrepiece, and it must be traceable end to end.**
Every order, every payment, every refund, every void — filterable by date, branch, terminal,
cashier, tender and status. From any row an owner can open the order AND the journal entry it
produced. **From the ledger side, the reverse must work too**: a journal entry links back to its
source order. A finance screen that cannot answer *"where did this number come from?"* is not
finished.

**D-37-02 — Daily takings, reconciled, as the finance landing screen.**
Gross sales, discounts, comps, tax, service charge, net, split by tender, against what each till
counted. A cash variance is shown as a variance, **never silently absorbed**. This is the number
a restaurant owner looks at first, every single day.

**D-37-03 — The guide is a first-class tab, written for a restaurant owner, not an accountant.**
The user asked for it explicitly. Every finance tab gets: what it is, when you use it, what a
typical entry looks like, and what it affects downstream. Plain language — *"Chart of Accounts is
the list of buckets your money moves between"* — not *"a normalised ledger account hierarchy"*.

It must include the things this system does that will otherwise generate support tickets:
- Why a cash settlement needs an open till (`409 NO_OPEN_TILL`) and card does not.
- What closing a period does, and why a back-dated entry is refused afterwards (`423`).
- What a discount does to the ledger (contra-revenue, gross revenue credited).
- Why some actions ask for a TOTP code.

**The guide must be generated from or verified against real behaviour**, not hand-written prose
that drifts. Where it states a rule, a test asserts that rule still holds. A guide that lies is
worse than no guide.

**D-37-04 — Fix the integration gaps 22b found and could not fix in its lane.**
- COGS/margin reports are **absent**: 0 of 115 fact rows carry `cogs_paisa`.
- Report dates disagree with the ledger: a value posted `08-06` in the GL appears under `08-07`
  in the report — a day boundary defect that makes daily takings wrong at exactly the moment an
  owner checks them.
- `finance.invoice-matched.queue` is bound, durable, growing and **declared by no code in the
  repository**.

**D-37-05 — Never invent a number.** If a figure cannot be computed, say so and say why. The
SuperAdmin console set this precedent: metering had zero producers, so it rendered "Not metered"
with the reason rather than a plausible zero. A finance screen showing a fabricated total is
worse than a blank one, because decisions get made on it.

## Constraints

- Money is **BIGINT paisa** end to end; convert only at display. Phase 26 found `MoneyUtils.formatPkr`
  uses `setMaximumFractionDigits(0)` while the frontend's `toMoney` uses two — **they already
  disagree**. Reconcile or state which is authoritative for display; do not add a third.
- Do not weaken the `JE_UNBALANCED` trigger. It is the only reason the discount defect was survivable.
- Period close must keep refusing back-dated entries (`423 PERIOD_LOCKED`) — verified working in 22b.
- All `finance_db` tables are FORCE RLS; Testcontainers' superuser bypasses it, so verify against
  the live database as the real service role.

## Definition of done

1. An owner opens Finance and sees today's takings by tender, reconciled against till counts,
   with variances shown as variances.
2. Any transaction opens to its order **and** its journal entry; any journal entry links back to
   its source.
3. COGS and margin report real figures, from populated fact rows.
4. Report dates agree with the ledger to the day — asserted across a day boundary.
5. The guide tab explains every finance tab in plain language, and each behavioural claim it makes
   is covered by a test.
6. The orphan queue is either owned by code or removed, with the choice recorded.
