# Phase 11 Plan 09 — Summary: Late-arrival deduction + labour-cost % (HR-05/HR-06)

**Status:** Complete (compile-proven; LabourCostIT written, deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline)

## Objective

Wire attendance-derived late/early deductions into payroll compute, and compute labour cost as a
% of revenue by shift and by branch (revenue pulled internally).

## Tasks & commits

| Task | What |
|------|------|
| 1 | `AttendancePolicyEntity` + repo, `LateArrivalDeductionService`, wired into `PayrollRunService.calculate` |
| 2 | `LabourCostService`, `PosRevenueClient` (internal revenue seam), `LabourCostController`, `HrInternalController` |
| 3 | `LabourCostIT` |

## Key decisions

- **Config-driven late deduction:** `LateArrivalDeductionService.computeMonthlyDeduction` iterates the
  period's work days, uses `AttendanceService.deriveLateEarly` (11-07) vs the assigned shift, applies the
  branch's `attendance_policies` (grace + PER_MINUTE/PER_OCCURRENCE rate; branch row or tenant-default),
  and totals `late_arrival_paisa`. `PayrollRunService.calculate` now calls it (replaces the 11-06 zero
  placeholder) — one added dependency + call.
- **[11-09-A] Revenue seam via `RestClient`, not OpenFeign.** hr-service has no Feign infra (crm didn't),
  so adding `@EnableFeignClients` + the dependency was avoided; `PosRevenueClient` uses `RestClient` to an
  internal `/internal/pos/revenue` endpoint with the `X-Internal-Service` secret, and **degrades to empty**
  (labour-cost % reports null) when the URL is unset or the call fails. Revenue is NEVER read from the caller.
- **Labour cost** = sum of active employees' pay (by branch, or by shift via `shift_assignments`);
  `labourCostPct = labourCost / revenue × 100`. Public `/api/v1/hr/labour-cost` (hr.payroll.view) +
  internal `/internal/hr/labour-cost` for Phase 12 reporting.

## Verification

- `mvn -q -pl services/hr-service -am compile` / `test-compile` — BUILD SUCCESS.
- **DEFERRED to Docker CI:** `LabourCostIT` (`mvn -q -pl services/hr-service -am verify -Dtest=LabourCostIT`)
  — late deduction 30,000 paisa → net 4,933,000; labour-cost % = 50.0 against mocked revenue 10M.

## Follow-ups

- Phase 12 reporting consumes `/internal/hr/labour-cost`; wire a real POS/finance revenue endpoint for
  `PosRevenueClient` (set `restaurantos.pos.internal-url`).
- Labour cost currently uses base pay as the proxy; a payslip-gross-based figure can replace it once runs exist.
