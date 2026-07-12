# Deferred Items — Phase 07.3

Out-of-scope discoveries made during plan execution (Scope Boundary — not fixed, logged only).

## 07.3-01

- **OrderRevisionIT.secondFire_sendsOnlyNewlyAddedItem_asIncrementingRevision_priorLinesUntouched
  — `LazyInitializationException` on `Order.items`** (pre-existing, unrelated to this plan).
  `OrderRevisionIT.java:115` calls `orderRepository.findByIdAndBranchId(...)` directly (outside
  any `@Transactional`/service boundary) then accesses the lazy `items` collection with
  `open-in-view: false` configured — the Hibernate session is already closed. Deterministic on
  isolated re-run (not test-order flakiness). Last touched in commit `144b60f` (Phase 07.1-03,
  `sendToKds` rewrite), well before this plan; this plan never edits `sendToKds`,
  `OrderRepository`, or the `Order.items` fetch mapping. Confirmed out of scope — a
  test-harness bug in a phase-7.1 test, not a regression introduced by 07.3-01's payment/close
  changes (`OrderCloseIdempotencyIT`, `PeriodLockCloseIT`, `TableOrderLookupIT`,
  `VoidRefundOpaIT`, `OrderInstructionsIT` — all of which exercise `closeOrder`/`markItemServed`
  — stayed green after the refactor).
