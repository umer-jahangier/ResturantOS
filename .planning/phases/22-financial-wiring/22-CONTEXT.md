# Phase 22 — Financial Wiring Audit

**Asked for:** *"check if each thing is properly connected with others"* — end to end, with money.

**Scope:** every path a rupee can travel through this system. Order → payment → close → GL;
inventory depletion → COGS; goods receipt → GR/IR → AP invoice → AP payment; HR payroll → finance;
period close; and whether the reports agree with the ledger. Plus the event bus that carries all of
it: orphaned publishers, orphaned consumers, undrained outboxes, and poison-message handling.

**Owned files this phase may change:** `services/finance-service/**`,
`services/reporting-service/**`, `services/purchasing-service/**`, `services/inventory-service/**`,
and this directory. Four other agents were live in the same repo on pos/kitchen, platform,
users/settings, and dashboards. Anything found outside the owned set is reported, not edited.

---

## Method — and why it is not the usual one

This repository has produced, repeatedly, components that read as correctly wired and are not.
Phase 14 alone found that *every discounted order failed to post revenue* while the code looked
right and the test suite was green. Phase 15's audit found a verification document scoring a phase
"24/24 passed" while citing a controller that does not exist.

So nothing here is concluded from reading code. Every row of the wiring table below was produced by
driving real transactions through the running stack and then asserting on persisted rows:

- Orders created, discounted, sent to KDS, served and paid through the real gateway with real
  seeded credentials, then reconciled against `finance_db.journal_lines`.
- Purchase orders raised, approved, sent, received, invoiced and paid, then reconciled against
  `journal_entries` and `inventory_db.stock_lots`.
- Period closed with a step-up-verified accountant token, then a back-dated entry attempted.
- Queue depths, consumer counts and dead-letter contents read from the live broker.
- A dead-lettered message republished to reproduce its rejection and capture the root cause.

Where a path could not be driven at all, that is stated as such rather than inferred.

### What makes a green test worthless here

Two environment facts shaped the method:

- **Testcontainers runs Postgres as SUPERUSER, which bypasses RLS.** A passing integration test
  says nothing about tenant scoping. All verification below is against the live databases via
  `docker exec restaurantos-postgres psql`, where the service roles are `NOSUPERUSER NOBYPASSRLS`.
- **All RLS tables across the 8 databases are FORCE since phase 17b.** An unscoped query returns
  **zero rows rather than erroring**, so a wiring break presents as "no data" — indistinguishable
  from "nothing happened yet" unless you drive data through and watch for it.

A third fact emerged during the audit and is the single most important lesson in it:
**the artifact on disk is not the artifact that is running.** See D-1.

## Constraints honoured

- Money is BIGINT paisa throughout. No floats were introduced, no decimals put on the wire.
- The `JE_UNBALANCED` deferred trigger was not weakened, disabled or worked around. It is the only
  reason the phase-14 discount defect was survivable rather than silently corrupting the ledger,
  and during this audit it caught the same defect again in the live process (D-1).
- No hand-editing of business data to make a result look better. The one stock row corrupted by the
  defect under test was restored by raising and receiving a real purchase order, not by UPDATE.

## Prior art consulted, and verified rather than trusted

`.planning/research/erp-completion/erp-gap-integration.md` maps publishers to consumers across the
bus. Its structural claims were re-checked against the live broker and the current source. Several
were **already fixed** by phase 14 and are recorded here as confirmed-closed; two were **stale in a
more interesting way** — correct about the source and wrong about the running system.
