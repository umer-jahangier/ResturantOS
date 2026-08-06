# Phase 11 Plan 12 — Summary: HR frontend (HR-04 + employee/payroll/attendance)

**Status:** Code complete + typecheck-clean. **BLOCKING human-verify checkpoint OUTSTANDING** (autonomous: false).
**Executed:** 2026-08-06 (orchestrator inline)

## Objective

The HR frontend over the four-layer API abstraction + the tenant app router, gated by FEATURE_HR,
including the HR-04 drag-and-drop shift calendar.

## Tasks & commits

| Task | What |
|------|------|
| 1 | `hr.schema.ts` / `hr.model.ts` / `hr.adapter.ts` / `hr.repository.ts` — the four-layer HR data access |
| 2 | `hr/layout.tsx` (FEATURE_HR + PermissionGuard + tabs), `hr/employees`, `hr/payroll`, `hr/attendance` pages; un-hid the HR sidebar entry |
| 3 | `hr/schedule/page.tsx` + `components/hr/shift-calendar.tsx` (native HTML5 drag-drop weekly calendar) |
| 4 | **checkpoint:human-verify (blocking) — NOT executable here; awaiting user UAT** |

## What was built

- **Four-layer** mirrors finance exactly: Zod schemas → domain models via adapters → `HrRepository`
  over `/api/v1/hr/**`. Idempotency-Key on payroll create/calculate; X-TOTP-Verified on approve.
- **Employees:** list (CNIC/bank shown MASKED as returned by the backend), create/deactivate,
  manage actions gated on `hr.employee.manage`.
- **Payroll:** create → calculate → approve (TOTP prompt → header) → pay; expandable payslip table
  showing the deductions breakdown (income tax / EOBI / late-arrival) + a labour-cost % widget.
- **Attendance:** manual clock-in/out + daily late/early summary; leave request/approve/reject;
  quarantine list + resolve (which establishes the durable device_user_ref → employee mapping).
- **Schedule:** drag-and-drop weekly grid (shift × day). Dragging an employee onto a cell assigns;
  dragging an assigned chip moves. Native HTML5 drag — no new dependency (none was present).

## Key decisions

- **Direct-repository pages, not a React-Query hooks layer.** finance wraps the repository in a
  `use-finance` hooks module; to keep this plan tractable the HR pages call `HrRepository` directly via
  `useState`/`useEffect`. The four-layer abstraction (the plan's actual requirement) is fully mirrored.
- **[11-12-A] Backend gap: no "list all leave requests" endpoint.** `LeaveController` exposes
  request/approve/reject/balances/types but no list-all, so the leave UI is request + approve/reject-by-id.
  A `GET /api/v1/hr/leave/requests` should be added for a proper inbox (follow-up).
- **Branch scope:** `GET /shifts/week` and labour-cost derive branch from server-side context, so the
  calendar shows the active branch (no per-branch selector param exists server-side).

## Verification

- `npx tsc --noEmit` — **0 errors in any HR file** (schema/model/adapter/repository, all 5 pages, the
  calendar). The 14 remaining tsc errors are pre-existing in `lib/offline/*` + `__tests__/*`, untouched by this plan.
- **OUTSTANDING — blocking human UAT (Task 4):** start the stack (`start-dev.ps1` with hr-service +
  gateway), log in as an OWNER/MANAGER, and run the checklist in the plan: HR section visible (hidden
  when FEATURE_HR off) → create employee (masked PII) → payroll create/calculate/approve(TOTP)/pay +
  payslip breakdown + labour-cost widget → drag-drop shift assign/move persists → clock in/out → leave
  request+approve → resolve a quarantined punch. Requires a running stack + browser (not available in
  this sandbox), and the deferred Docker CI pass of the backend ITs first.

## Follow-ups

- Add `GET /api/v1/hr/leave/requests` (list) for a real leave inbox.
- Consider a `use-hr` React-Query hooks layer for caching parity with finance.
