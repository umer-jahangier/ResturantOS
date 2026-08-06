# Phase 11 Plan 07 — Summary: Scheduling + attendance + leave (HR-04 backend, HR-05)

**Status:** Complete (compile-proven; AttendanceLeaveIT written, deferred to Docker CI)
**Executed:** 2026-08-06 (orchestrator inline)

## Objective

Shifts + assignments per branch, manual clock-in/out into `attendance_punches`, and a leave
workflow (types/accrual/approval/balances). Late-arrival derivation provided here; feeds payroll in 11-09.

## Tasks & commits

| Task | What |
|------|------|
| 1 | `ShiftEntity` (days_of_week int[], TIME), `ShiftAssignmentEntity`, repos, `ShiftService` (CRUD + assign/unassign/move + weekGrid), `ShiftController` |
| 2 | `AttendancePunchEntity`, `AttendanceService` (clock-in/out via synthetic MANUAL device + late/early derivation), `AttendanceController` |
| 3 | Leave entities/repos, `LeaveService` (types/accrual/request/approve/reject/balances), `LeaveController`, `AttendanceLeaveIT` |

## Key decisions

- **Manual + device punches unify in `attendance_punches`.** Manual clock-in/out uses a lazily-created
  synthetic per-branch **MANUAL** device (new `ConnectionMode.MANUAL`) so `device_id` stays NOT NULL,
  and 11-11's device punches share the same table.
- **Late/early derivation** compares the day's first-IN / last-OUT punch to the assigned shift's
  start/end (`deriveLateEarly` → `DailyAttendanceSummary`). Timezone via `ZoneId.systemDefault()`.
- **Leave:** default types Annual (paid, 1.5/mo), Sick (paid, 1.0/mo), Unpaid; `request` balance-checks
  paid types, `approve` decrements the balance, per-year `leave_balances`.
- **[11-07-A] `@Scheduled` cross-tenant accrual deferred.** A scheduled thread has no tenant context,
  so RLS-scoped per-tenant accrual needs registry-driven iteration (same shape as the outbox relay /
  inventory ExpirySweep). Shipped `accrue(int year)` for the current tenant (admin-triggerable +
  IT-testable); the cross-tenant scheduler is a deploy follow-up.
- **[11-07-B] Repositories split into individual files** rather than the plan's single
  `HrScheduleRepositories.java` — Spring Data repos must be public, and one public interface per Java
  file. Functionally identical.

## Verification

- `mvn -q -pl services/hr-service -am compile` / `test-compile` — BUILD SUCCESS.
- **DEFERRED to Docker CI:** `AttendanceLeaveIT` (`mvn -q -pl services/hr-service -am verify`) —
  deterministic 30-min late derivation vs a 09:00 shift; leave accrue (→1.5) → request → approve (→0.5).
  Plus runtime validation of the `days_of_week int[]` array mapping and `numeric` balance columns.

## Follow-ups

- 11-09 consumes `deriveLateEarly` to compute the `late_arrival_paisa` payroll deduction + labour-cost %.
- 11-12 builds the drag-drop shift calendar on `GET /api/v1/hr/shifts/week`.
- Deploy: wire a registry-driven cross-tenant monthly accrual scheduler.
