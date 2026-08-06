---
phase: 13-platform-tenant-access-repair
plan: 16
subsystem: pos-till-settlement
tags: [pos, till, settlement, cash, waiter, reconciliation, rbac]
status: complete
requires:
  - 13-02 (WAITER role seeded with pos.order.create + pos.order.send_to_kds, no till permission)
provides:
  - "order creation binds a till opportunistically (null when the creating user has none)"
  - "PaymentServiceImpl.recordPayment refuses PaymentMethod.CASH without an OPEN till for the paying user"
  - "an end-to-end waiter persona 13-15's seed script can drive"
  - services/pos-service/src/test/java/io/restaurantos/pos/WaiterOrderNoTillIT.java
  - services/pos-service/src/test/java/io/restaurantos/pos/CashPaymentRequiresTillIT.java
affects:
  - "POST /api/v1/pos/orders — no longer returns 409 NO_OPEN_TILL"
  - "POST /api/v1/pos/orders/{id}/payments — NEW 409 NO_OPEN_TILL for CASH tenders (behaviour break, intended)"
  - "13-15's seed script (unblocked: the waiter persona can now complete an order)"
tech-stack:
  added: []
  patterns:
    - state a financial invariant at the point where the money physically moves, not upstream of it
    - a guard that only fires when a userId is present does not establish the invariant it claims
    - reuse the status-filtered query rather than adding one that could drift off the filter
    - when a comment's rationale stops being true of its method, rewrite it — a stale rationale misleads harder than none
key-files:
  created:
    - services/pos-service/src/test/java/io/restaurantos/pos/WaiterOrderNoTillIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/CashPaymentRequiresTillIT.java
  modified:
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PaymentServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/exception/PosExceptions.java
    - services/pos-service/src/test/java/io/restaurantos/pos/TillReconciliationIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/SettlementSemanticsIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OverTenderIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PeriodLockCloseIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/OrderRevisionIT.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PosTestBase.java
decisions: [D-30]
requirements: [USER-02, POS-01]
metrics:
  duration: ~1h
  completed: 2026-08-06
  tasks: 4
  commits: 3
---

# Phase 13 Plan 16: Till Binds at Cash Settlement, Not at Order Creation — Summary

The WAITER role that 13-02 granted correctly is now actually usable, and the change that made it
usable also closed a hole through which cash could be taken with no drawer behind it.

`PosGlobalExceptionHandler` was not modified: `NoOpenTillException` already mapped to
409 `NO_OPEN_TILL`, which is the right answer for a business-rule refusal at the new call site.
Task 3 asked for that to be verified rather than assumed — it was, at
`PosGlobalExceptionHandler.java:83-89`.

## The problem, precisely

13-02 seeded WAITER with `pos.order.create` and `pos.order.send_to_kds` and deliberately no till
permission. That is right for table service: the waiter takes the order and a cashier settles it.
But `OrderServiceImpl.createOrder` required the **creating** user to hold an OPEN till and threw
`NoOpenTillException` otherwise. A waiter cannot open a till by design, so a correctly-permissioned
waiter was authorized to take an order and then refused by the service with 409 `NO_OPEN_TILL`. The
grants were right and the workflow was impossible.

## Why moving the requirement is stricter, not looser

This is the part worth being explicit about, because "we removed a financial guard" reads badly
until you look at what the guard actually did.

**The create-time guard never established its own invariant.** It was scoped to a present userId —
`if (cashierId.isPresent())`. Every path without one (service-to-service, internal flows, the
service-layer test fixtures) already created orders with `till_session_id = null`. So the claim in
its comment, "never silently persist an untracked order with tillSessionId = null", was false as
written on the same screen as the code that made it false.

**Settlement was the leak, and it was best-effort.** `recordPayment` backfilled the till with
`.ifPresent(...)`. A CASH payment by a user with no open till was **accepted**, and the order stayed
unlinked. `TillServiceImpl.closeTill` computes expected closing by summing CASH payments on orders
bound to that till — so that money was invisible to reconciliation. That is exactly the "charged but
the drawer shows 0" gap the old comment described as already fixed.

After this plan the invariant is stated once, where the cash physically moves: **no CASH payment
without an OPEN till for the paying user.** Strictly more orders are blocked from cash settlement
than before, and strictly fewer can be settled with a null till — zero, now, versus "any of them,
if the cashier had not opened a drawer".

Counter service is unchanged: a cashier who opens the till before taking orders still gets the
create-time binding, and `cashPayment_byCashierWithOpenTill_isAccepted_andOrderBoundToThatTill` was
the one test of the seven that **passed before the implementation**, which is how that is known
rather than argued.

## Scope decisions, each pinned by a test rather than a comment

| Decision | Where it is asserted |
|---|---|
| CASH requires an OPEN till | `cashPayment_withNoTillAtAll_isRefused_andNothingIsApplied` |
| A CLOSED till does not satisfy it | `cashPayment_whenOnlyTillSessionIsClosed_isRefused` |
| Non-cash tenders are exempt | `cardPayment_withNoTill_isAccepted_andLeavesTillNull` |
| A waiter's order settles into the settling cashier's drawer | `cashPayment_onWaiterOrder_backfillsPayingCashiersTill` |
| Order creation binds nothing when there is no till | `WaiterOrderNoTillIT.waiterOrder_persistsWithNullTill_andWaiterAsCashier` |
| Counter service is byte-identical to before | `cashPayment_byCashierWithOpenTill_isAccepted_andOrderBoundToThatTill` |

Card and wallet tenders stay exempt deliberately. They never pass through the drawer and never reach
`closeTill`'s sum, so requiring a till for them would refuse legitimate counter-less service for no
reconciliation benefit. Non-cash keeps the pre-existing best-effort backfill.

Two smaller choices inside the implementation:

- **An order already bound at creation keeps its till.** The new code binds only when
  `order.getTillSessionId() == null`. Re-pointing a bound order at the settling user's drawer would
  move cash that a second cashier never physically received.
- **`findByCashierIdAndStatus(uid, TillStatus.OPEN)` is reused, not re-implemented.** The status
  filter carries as much weight as the lookup — a CLOSED session is a drawer already counted and
  signed off. A parallel query would be free to drift off the filter, and
  `cashPayment_whenOnlyTillSessionIsClosed_isRefused` exists precisely because a status-less
  `findByCashierId` would wrongly admit that case.

## Guardrails held

- **Over-tender, change and applied-amount capping:** untouched. The new block sits above the
  capping section and returns nothing into it. `OverTenderIT` passes with its assertions unmodified.
- **The close-till guard:** untouched. `TillReconciliationIT.closeTill_withNonClosedOrder_throws409`
  and `closeTill_withOrderCreatedViaOrderService_linksTillSessionAndCashier_blocksClose` both pass
  as written.
- **Order creation never binds another user's till:** `createOrder` still looks up only
  `tenantContext.getUserId()`'s own session.

## Deviations from plan

**[Rule 1 — Misleading operator-facing message] `NoOpenTillException`'s message and javadoc.**
After Task 2, `PaymentServiceImpl` is the exception's *only* thrower (verified by grep across
`services/`). Its message still read "open a till before taking **orders**", which at the settlement
call site tells a cashier to abandon the order when what they need to do is open the drawer — a 409
detail that is surfaced to a real operator. Reworded to "open a till before taking **cash**", and
the javadoc's "no order without an open drawer" invariant restated as "no cash without an open
drawer". The plan's instruction not to change code "for the existing call site's sake" was read as
covering the **409 status mapping**, which Task 3 named explicitly and which was left alone. No test
asserts on this message; all assert the exception type.

**[Rule 3 — Compile blocker] Lambda capture in `createOrder`.** The natural
`.ifPresent(openTill -> order.setTillSessionId(...))` does not compile: `order` is reassigned by the
`orderRepository.save(order)` below and so is not effectively final. Written as an explicit
`Optional<TillSession>` + `isPresent()`, with a comment saying why, so the next reader does not
"simplify" it back into a compile error.

## Existing tests updated, and why each new assertion is the correct one

14 ITs failed on the first full run. **One** of them was asserting the rule that moved; the other 13
were not asserting it at all.

### The one genuine inversion

`TillReconciliationIT.createOrder_withNoOpenTill_isRejected` →
`createOrder_withNoOpenTill_isAllowed_andLeavesTillUnbound`.

This test asserted the create-time guard directly. The new assertion is correct because what the old
one protected — an order reaching cash settlement with no drawer behind it — is now blocked at the
point of settlement by `CashPaymentRequiresTillIT`, and blocked more completely: before this plan,
a cash payment against a null-till order was accepted outright, so the old test was guarding a door
next to an open window. What must still hold at creation is only that no arbitrary till gets bound,
which is what the replacement asserts (`tillSessionId` null, `cashierId` still the creator).

### The 13 that were dodging the guard, not asserting it

`SettlementSemanticsIT` (6), `OverTenderIT` (4), `PeriodLockCloseIT` (2), `OrderRevisionIT` (1).

Every one of these ran with `tenantContext.set(tenantId, branchId, null, null)` — no userId. That is
exactly how they avoided the create-time till guard, since it only fired when a userId was present.
They then settled in CASH, which now requires the paying user's OPEN till. Each `setUp` gained a
`cashierId` and an `openTillForCashier(branchId)` call; **no assertion in any of the four classes was
changed.** A real cash settlement always has an authenticated cashier with an open drawer
(`PaymentController.recordPayment` is `@PreAuthorize("hasAuthority('pos.order.close')")`, so there is
no production path without a principal), which makes the new fixture the faithful one rather than a
workaround.

`PeriodLockCloseIT` is where this is load-bearing rather than cosmetic. Its two failures were
`Failures`, not `Errors`: the till refusal preempted the period refusal, so the test caught
`NoOpenTillException` where it asserted `PeriodLockedException`. With a drawer open, the period check
fires exactly as before. This is the intended ordering — the till check runs before any amount is
applied, per Task 3.

`PosTestBase.openTillForCashier`'s javadoc no longer claims `createOrder` requires it, and now names
`closeViaServeAndPay` (which settles in cash) as the reason callers still need it.

## Verification — real output

RED, before Tasks 2 and 3:

```
Tests run: 7, Failures: 0, Errors: 6, Skipped: 0
  6 x NoOpenTillException at OrderServiceImpl.createOrder
  1 passing: cashPayment_byCashierWithOpenTill_... (counter service, unchanged)
```

GREEN, the two new ITs after Tasks 2 and 3:

```
Tests run: 2, Failures: 0, Errors: 0 -- WaiterOrderNoTillIT
Tests run: 5, Failures: 0, Errors: 0 -- CashPaymentRequiresTillIT
```

Full suite after Task 4 — `mvn -pl services/pos-service verify`:

```
Tests run: 60,  Failures: 0, Errors: 0, Skipped: 0   (unit)
Tests run: 117, Failures: 0, Errors: 0, Skipped: 0   (integration, 32 IT classes)
BUILD SUCCESS
```

The jacoco `check` bound to `verify` passed on that run; nothing was skipped to get green.

**One anomaly, chased and dismissed.** `BranchIsolationGuardIT` logged `Time elapsed: 383.9 s` in the
full run. Re-run alone it took `5.919 s`. The class contains no sleeps, no `Awaitility`, no HTTP port
and no timing constructs of any kind — it was a Docker/colima stall on this machine while it happened
to be the first IT class to boot the shared Testcontainers Postgres. Not a code path, and not caused
by this change.

## Blast radius (impact analysis)

`.gitnexus/run.cjs` is absent from this checkout, so this was taken from the call graph by grep over
`services/**/*.java` rather than from the GitNexus index (which is also stale at `5fba4a9`).

| Symbol | Production callers | Risk |
|---|---|---|
| `OrderServiceImpl.createOrder` | `OrderController.createOrder` only | MEDIUM — signature unchanged; a 409 path is removed |
| `PaymentServiceImpl.recordPayment` | `PaymentController.recordPayment` only | **HIGH** — signature unchanged, but a NEW rejection path on a money endpoint |

The HIGH rating on `recordPayment` is accurate and is the point of the plan: any client that today
settles cash without an open till starts getting 409 `NO_OPEN_TILL`. That is D-30's intent, and the
only in-repo callers doing so were four test fixtures that were not modelling a real cashier.

## What this does not do

Making "orders require a till at creation" a **per-POS-profile** setting — a combined food+drink
counter versus a separate food POS and bar — is Phase 16 work, per D-30 and the plan's context. This
plan establishes the correct default so the seed script and the waiter persona work; it builds no
configuration surface, and none was added.

## For 13-15

The waiter persona is unblocked. A user with `pos.order.create` + `pos.order.send_to_kds` and no till
can create an order and fire it to the KDS. To **settle** that order the seed script needs a second
persona holding `pos.order.close` **and an open till** — a cash settlement will now be refused with
409 `NO_OPEN_TILL` if the script skips `POST /api/v1/pos/tills`. A card tender needs no till.

## Commits

- `8cb3b29` `test(pos):` specify the waiter order path and the cash-till rule before moving either
- `9f3fa4b` `fix(pos):` require the till where cash changes hands, not where the order is taken (D-30)
- `39e9081` `test(pos):` move the existing suite off the create-time till assumption

## Self-Check: PASSED

Both artifacts exist on disk; all three commits are in `phase-13-access-repair`. Interleaved commits
from 13-05 (`d26c2aa`, `a90228e`, `dbe108a`) touch auth-service / platform-admin-service only — no
file in this summary was staged by or shared with that agent.
