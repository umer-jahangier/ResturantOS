---
status: testing
phase: 11-hr-payroll
source: [11-01, 11-04, 11-05, 11-06, 11-07, 11-08, 11-09, 11-10, 11-11, 11-12 SUMMARY.md]
started: 2026-08-06T00:00:00Z
updated: 2026-08-06T00:00:00Z
---

## Current Test

number: 1
name: HR section visibility (FEATURE_HR gating)
expected: |
  Logged in as an OWNER/MANAGER of a tenant with FEATURE_HR ON, an "HR" item appears in the
  sidebar and opens /app/hr (Employees tab). For a tenant with FEATURE_HR OFF, the HR item is
  hidden and the API rejects /api/v1/hr/** with 403 FEATURE_DISABLED.
awaiting: user response

## Tests

### 1. HR section visibility (FEATURE_HR gating)
expected: HR nav appears for a FEATURE_HR-on tenant and opens /app/hr; hidden when the flag is off.
result: [pending]

### 2. Create & list employee (masked PII)
expected: On /app/hr/employees, "New employee" creates a record; the list shows it with CNIC and bank account MASKED (e.g. ****5678), never the raw value.
result: [pending]

### 3. Payroll run lifecycle + payslip breakdown
expected: On /app/hr/payroll, create a run for a month → Calculate generates payslips → Approve prompts for a TOTP code → Mark paid. Expanding the run shows a payslip row per employee with income-tax / EOBI / late-arrival deductions and a net figure.
result: [pending]

### 4. Labour-cost % widget
expected: An expanded payroll run shows a labour-cost figure and a "% of revenue" (or "revenue unavailable" when no POS revenue source is configured).
result: [pending]

### 5. Drag-and-drop shift calendar
expected: On /app/hr/schedule, dragging an employee (left rail) onto a shift/date cell assigns them; dragging an assigned chip to another cell moves it. Assignments persist after a page refresh.
result: [pending]

### 6. Manual clock-in/out + daily summary
expected: On /app/hr/attendance, selecting an employee and clicking Clock in / Clock out records punches; the daily summary reports late / early-leave minutes against the assigned shift.
result: [pending]

### 7. Leave request + approve
expected: Submit a leave request for an employee/type/date range; approving it (with hr.leave.approve) succeeds and the employee's paid-leave balance decrements by the days taken.
result: [pending]

### 8. Biometric device register + quarantine resolve
expected: Registering a device returns a device token shown ONCE. A punch for an unmapped device PIN lands in the quarantine list; resolving it to an employee maps that PIN durably, so subsequent punches for that PIN auto-resolve (no re-quarantine).
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0

## Gaps

[none yet — interactive tests not yet run]

## Notes (verification attempted 2026-08-06)

- **Frontend build VERIFIED:** fixed a pre-existing blocker (`idb` declared in package.json but
  missing from node_modules → `pnpm install --frozen-lockfile` restored `idb` + `fake-indexeddb`,
  no source change). `npx next build` then reports `✓ Compiled successfully` — all HR routes
  (`/app/hr/employees|payroll|schedule|attendance`) compile into the production bundle. The build
  later OOMs in the static-generation phase on this 8GB host (environment limit, not code).
- **BLOCKED here (environment):** the 8 interactive tests below need a running stack; Docker is down
  (no docker/podman CLI), no `opa` binary, and the full backend stack OOMs 8GB. Run the interactive
  tests + `mvn verify` + `opa test policies/` on a Docker-capable machine. Tests 1–8 remain pending.
