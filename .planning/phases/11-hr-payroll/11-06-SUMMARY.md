# Phase 11 Plan 06 — Summary: Payroll run lifecycle (HR-02/03 producer)

**Status:** Complete (compile-proven; PayrollRunIT written, deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline)

## Objective

Payroll run lifecycle: create → calculate payslips (config-driven tax + EOBI) → TOTP-gated approve
→ pay, publishing PAYROLL_RUN_APPROVED then PAYROLL_RUN_PAID for finance to auto-post (11-08).

## Tasks & commits

| Task | What |
|------|------|
| 1 | `PayrollRunEntity` (status enum), `PayslipEntity` (allowances/deductions JSONB→Map), repos, `PayrollDtos` |
| 2 | `PayrollRunService` (create/calculate/approve/pay + compute), `TotpRequiredException` |
| 3 | `PayrollRunController` (Idempotency-Key), `PayrollRunIT` |

## Compute (per active employee, paisa)

gross = basic (+ allowances/overtime placeholder 0); annualTaxable = **basic × 12** (annualize the
regular monthly rate — RESEARCH Pitfall 5); monthly income tax = (`SlabTaxCalculator.computeAnnualTax`
+ `computeSurcharge`) ÷ 12 from the active `tax_config`; EOBI = `EobiCalculator.employeeContribution`
off the **wage base**; net = gross − income_tax − eobi − advances(0) − late_arrival(0, wired in 11-09).
`deductions_json` = {income_tax_paisa, eobi_employee_paisa, advances_paisa, late_arrival_paisa, other}.

## Key decisions

- **HR writes no ledger** — approve/pay only publish events; finance auto-posts in 11-08. Payloads:
  APPROVED carries `totalGrossPaisa` (DR 6200 / CR 2300 gross); PAID carries `totalNetPaisa` (DR 2300 / CR Bank net).
- **TOTP step-up** uses the finance trust model: controller reads `X-TOTP-Verified`; service throws
  `TotpRequiredException` (401) if false. (No direct auth-service call — mirrors PeriodCloseService.)
- **Idempotency** on create + calculate via shared `IdempotencyService` (getCompletedResponse →
  checkAndLock → markComplete), response cached as JSON.
- **calculate is idempotent** by construction (`deleteAllByRunId` then regenerate).
- **`payroll_runs` uniqueness kept `(tenant, month, year)`** per spec — no per-branch need surfaced,
  so RESEARCH Open Question 1 was NOT triggered; the run's branch is taken from context.
- **fiscal year** derived from the period: `month >= 7 ? year+1 : year` (FBR Tax Year).

## Verification

- `mvn -q -pl services/hr-service -am compile` / `test-compile` — BUILD SUCCESS.
- `PayrollRunService` references `computeAnnualTax`, `EobiCalculator`, `PAYROLL_RUN_APPROVED/PAID`, `TotpRequired`.
- **DEFERRED to Docker CI:** `PayrollRunIT` (`mvn -q -pl services/hr-service -am verify`) — compute
  correctness (EOBI 37,000, net=gross−deductions, total gross 25M for the two seeded employees),
  TOTP-gated approval, and the two outbox events with paisa totals; plus runtime validation of the
  `deductions_json`/`allowances_json` JSONB↔Map mappings.

## Follow-ups

- 11-08 consumes PAYROLL_RUN_APPROVED/PAID in finance-service to post the GL.
- 11-09 wires `late_arrival_paisa` from attendance into the deduction.
