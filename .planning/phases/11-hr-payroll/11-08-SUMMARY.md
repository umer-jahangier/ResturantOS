# Phase 11 Plan 08 — Summary: Payroll GL auto-post (HR-03 consumer)

**Status:** Complete (compile-proven; PayrollAutoPostingIT written, deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline)

## Objective

finance-service auto-posts the payroll journal entries from the HR events, keeping the ledger owned
by finance and balanced by construction. Mirrors the ORDER_CLOSED recipe seam.

## Tasks & commits

| Task | What |
|------|------|
| 1 | `AutoPostingRecipeEngine`: `postPayrollApproved` (DR 6200/CR 2300 gross), `postPayrollPaid` (DR 2300/CR Bank net) + `uuid`/`longVal` map accessors |
| 2 | `PayrollApprovedConsumer`, `PayrollPaidConsumer`; `rabbitmq-definitions.template.json` payroll-paid queue/dlq/bindings |
| 3 | `FinanceRabbitConfig` payroll queue self-declaration + `PayrollAutoPostingIT` |

## Key decisions / plan-vs-reality corrections

- **[11-08-A] The plan's `deploy/init/rabbitmq-definitions.json` does not exist** post prod-merge — the
  actual file is `rabbitmq-definitions.template.json` (rendered by a script), and it already had the
  payroll-**approved** queue/bindings. Added the payroll-**paid** rows there.
- **[11-08-B] finance topology is declared PROGRAMMATICALLY** in `FinanceRabbitConfig.SUBSCRIPTIONS`
  (the plan assumed JSON-only). The existing approved queue relied only on the broker template import,
  so the consumer would fail to start in Testcontainers (no import). Fixed properly: `FinanceRabbitConfig`
  now declares the `hr.topic` exchange + both payroll queues/dlqs/bindings, generalizing the queue→exchange
  source selection to 3 exchanges. The consumers now start in every environment; the template JSON is
  belt-and-suspenders for broker pre-provisioning.
- **HR payload is a generic Map** (hr-service publishes a `Map` payload, not a typed shared contract), so
  the recipes read via `uuid(p,"runId")` / `longVal(p,"totalGrossPaisa")` and the consumers read the
  envelope as `Map` (unchecked cast, isolated to the two consumers).
- **Account codes 6200/2300 are literals** (per CONTEXT/spec §11), consistent with other fixed-code
  recipes; **Bank** via `accountResolver.codeBySystemTag("BANK")`. Both postings guard on `alreadyPosted`.
- **Additive to the recipe engine** — no existing recipe method changed.

## Verification

- `mvn -q -pl services/finance-service -am compile` / `test-compile` — BUILD SUCCESS.
- **DEFERRED to Docker CI:** `PayrollAutoPostingIT` (`mvn -q -pl services/finance-service -am verify -Dtest=PayrollAutoPostingIT`)
  — APPROVED→balanced 6200/2300 gross JE, PAID→2300/Bank net JE, replay→no duplicate.
- **RISK to check in CI:** the JE post resolves account codes `6200`/`2300` against the tenant chart of
  accounts — confirm `ProvisioningService.provision` seeds those codes (else the post fails). finance-service
  also has 3 pre-existing unrelated "Branch context required" IT failures (documented in STATE) — unaffected here.

## Follow-ups

- HR-03 loop is closed in code: approved+paid HR run → two balanced JEs, HR never touches the ledger.
- CI must confirm the 6200/2300 CoA seed and run the IT.
