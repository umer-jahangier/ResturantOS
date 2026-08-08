---
phase: 11-hr-payroll
status: human_needed
verified_at: 2026-08-06
verified_by: orchestrator (inline; subagent gsd-verifier blocked by platform content filter)
score: 12/12 plans code-verified · 0/8 ITs run · 0 opa suites run · UAT outstanding
---

# Phase 11 — HR & Payroll — Verification

## Method

Runtime verification was **not possible in this environment** (no Docker daemon → no Testcontainers ITs,
no `opa` binary, no running stack/browser for UAT). This report is a **code-level goal-backward check**:
each plan's must-have artifacts were confirmed present in the committed tree, and every module was
compile/typecheck-verified. It is NOT a runtime pass.

## Code-level checks — ALL PASS (12/12)

| Plan | Must-have artifact verified | Result |
|------|-----------------------------|--------|
| 11-01 | hr-service module + FORCE ROW LEVEL SECURITY on 14 tenant tables + 3 shared-infra | ✅ |
| 11-04 | `EmployeeEntity` `@Convert(EncryptedStringConverter)` cnic/bank; `hr.rego` + `hr_test.rego` | ✅ |
| 11-05 | `SlabTaxCalculator.computeAnnualTax` + EOBI off wage base; FY2025-26 seed (unit tests GREEN) | ✅ |
| 11-06 | payroll lifecycle + `PAYROLL_RUN_APPROVED/PAID`; TOTP-gated approve | ✅ |
| 11-07 | shifts + `AttendanceService.clockIn` + leave workflow | ✅ |
| 11-08 | `postPayrollApproved/Paid` recipes + consumers + `finance.payroll-paid.queue` | ✅ |
| 11-09 | `late_arrival_paisa` deduction wired to payroll; `labourCostPct` | ✅ |
| 11-10 | `DeviceAuthResolver` sets tenant/branch from registry; gateway `/iclock` JWT-exempt | ✅ |
| 11-11 | `PunchIngestService` ON CONFLICT + ATTENDANCE_PUNCHED + quarantine; USB-bridge contract doc | ✅ |
| 11-12 | HR four-layer repo over `/api/v1/hr/**` + native drag-drop shift calendar (tsc clean) | ✅ |

Build: `mvn -pl services/hr-service,services/finance-service -am test-compile` BUILD SUCCESS;
`npx tsc --noEmit` 0 errors in any HR file. Payroll math unit tests (`SlabTaxCalculatorTest`,
`EobiCalculatorTest`) ran GREEN (10/10).

## Human verification / runtime checks REQUIRED before this phase is `passed`

### 1. Docker CI (automated, no browser)
```
mvn -q -pl services/hr-service,services/finance-service -am verify   # 8 ITs
opa test policies/                                                    # hr_test.rego
```
ITs: HrContextLoads, Employee, PayrollRun, AttendanceLeave, LabourCost, DeviceAuthResolver,
AdmsIngest, PayrollAutoPosting. **Known runtime risks to confirm:** 6200/2300 CoA seed for the payroll
JE; `resolve_device()` SECURITY DEFINER ownership vs FORCE RLS under the non-superuser prod role;
Hibernate JSON/`int[]`/enum mappings under `ddl-auto=validate`.

### 2. 11-12 blocking UAT (browser)
Start the stack, log in as OWNER/MANAGER, and run the 11-12 checklist: HR section gated by FEATURE_HR;
create employee (masked PII); payroll create→calculate→approve(TOTP)→pay + payslip breakdown +
labour-cost widget; drag-drop shift assign/move persists; clock in/out; leave request+approve;
resolve a quarantined punch.

## Gaps / follow-ups (non-blocking, recorded from SUMMARYs)

- No `GET /api/v1/hr/leave/requests` list endpoint (leave UI is request + approve-by-id) — 11-12-A.
- `@Scheduled` cross-tenant leave accrual not wired (per-tenant iteration) — 11-07-A.
- `hr-route` has no gateway resilience4j time-limiter entry.
- `FIELD_ENCRYPTION_KEY` must be set in the environment before employee/device PII is written.

## Verdict

**human_needed** — the codebase delivers every Phase 11 must-have at the code level, but the phase
CANNOT be marked `passed` (and HR-01..HR-08 must NOT be marked Complete) until the Docker CI pass and
the 11-12 UAT are green. Re-run this verification after those complete.
