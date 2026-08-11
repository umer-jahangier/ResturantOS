---
phase: 35-hr-usability
plan: 09
subsystem: ui
tags: [zod, react-query, four-layer-architecture, select, combobox, tenant-managed-lists]

requires:
  - phase: 35-hr-usability
    provides: "35-05's departments/designations API and the changed EmployeeResponse shape"
  - phase: 35-hr-usability
    provides: "35-06's tax-configuration API and the current-fiscal-year endpoint"
  - phase: 35-hr-usability
    provides: "35-04's Select, Combobox and their three-state options contract"
provides:
  - "apiEmployeeSchema corrected to departmentId/departmentName/designationId/designationName"
  - "Layer-1 schemas, Layer-2 models/adapters and repository methods for departments, designations and tax config"
  - "use-hr-config.ts — tenant-keyed queries and mutations for every HR lookup"
  - "option-selects.tsx — DepartmentSelect, DesignationSelect, EmploymentTypeSelect, EmployeeCombobox"
  - "EMPLOYMENT_TYPE_VALUES, derived from the Layer-1 enum in Layer 2"
affects: [35-10, 35-11, 35-12, 35-13, 35-14]

tech-stack:
  added: []
  patterns:
    - "A tenant-scoped (not branch-scoped) query carries no branchId in its key and is not gated on one"
    - "An inactive lookup row is rendered DISABLED, and enabled only when it is already the selected value"
    - "A protocol enum's runtime list is derived from the Layer-1 zod schema, in Layer 2, because components may not import Layer 1"

key-files:
  created:
    - frontend/lib/hooks/hr/use-hr-config.ts
    - frontend/components/hr/option-selects.tsx
  modified:
    - frontend/lib/api-client/schemas/hr.schema.ts
    - frontend/lib/models/hr.model.ts
    - frontend/lib/adapters/hr.adapter.ts
    - frontend/lib/repositories/hr.repository.ts
    - frontend/lib/hooks/query-keys.ts

key-decisions:
  - "HR configuration queries are tenant-keyed, never branch-keyed — the tables carry no branch_id and gating on a branch would empty the dropdown wherever a branch is not yet chosen"
  - "A retired department is shown disabled rather than filtered out, so editing an employee assigned to one does not silently drop their department"
  - "The employee combobox labels each row with the employee NUMBER as well as the name; two people called Muhammad Ali is not hypothetical"
  - "5-minute staleTime on the lookup queries — a tenant's department list changes a handful of times a year"

requirements-completed: [FE-07, FE-08, HR-01, HR-02]

coverage:
  - id: D1
    description: "Every closed-set HR field has exactly one component rendering it, fed by a query or by the Layer-1 enum"
    requirement: HR-01
    verification:
      - kind: automated_ui
        ref: "frontend/__tests__/components/hr/employee-form-dialog.test.tsx — 'offers the tenant's departments as options from the API'; 'offers employment type as a list, with the four values the API accepts'"
        status: pass
      - kind: manual
        ref: "browser: department options rendered as [\"Choose a department\",\"Kitchen\"] from the tenant's own API"
        status: pass
    human_judgment: false
  - id: D2
    description: "A failed options load renders as a failure with a retry, never as an empty menu"
    requirement: FE-02
    verification:
      - kind: automated_ui
        ref: "employee-form-dialog.test.tsx#renders a failed department load as a failure with a retry"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every new HR response is Zod-parsed at Layer 1 and adapted before a component sees it"
    requirement: FE-07
    verification:
      - kind: other
        ref: "npm run lint — the no-restricted-imports layer rule is clean; two Layer-1 imports from components/** were caught by it and moved to Layer 2"
        status: pass
    human_judgment: false

duration: 34min
completed: 2026-08-12
status: complete
---

# Phase 35 Plan 09: HR Data Layer and Pickers Summary

**The frontend was a phase behind its own backend — `apiEmployeeSchema` still declared `department` and `designation` as free-text strings that the server had stopped sending. That is fixed, and every closed HR set now has exactly one component that renders it.**

## What was actually broken

35-05 replaced `employees.department` and `employees.designation` with foreign keys and changed `EmployeeResponse` to carry `departmentId` / `departmentName` / `designationId` / `designationName`. Nothing on the frontend was updated. The Employees table rendered `e.designation` — a property the server no longer sends — so the Designation column showed `—` for every row while the data sat in the response under a different name.

Six API areas had no frontend representation at all: departments, designations, tax configuration, the current-fiscal-year answer, and the two write paths for the lookups.

## The pickers

| Component | Source of options |
|---|---|
| `DepartmentSelect` | `useDepartments()` — tenant-managed |
| `DesignationSelect` | `useDesignations()`, optionally scoped to a department |
| `EmploymentTypeSelect` | `EMPLOYMENT_TYPE_VALUES`, derived from the Layer-1 zod enum |
| `EmployeeCombobox` | `useEmployees()`, searchable, labelled `Name · Number` |

## Decisions Made

**Configuration queries carry no `branchId`.** Every other HR hook is `enabled: isAuthenticated && !!branchId`, because employees and payroll runs are branch-scoped. 35-02 deliberately put no `branch_id` on `departments` or `designations` — the list belongs to the tenant, and per-branch copies would make a four-location owner retype it four times. Keying these by branch would refetch identical rows per branch and, worse, leave the department dropdown empty on any screen reached before a branch is selected — which reads as *"this tenant has no departments"*, the single most misleading thing an options list can say.

**A retired row is disabled, not hidden.** A department is deactivated, never deleted, so an employee hired into it still resolves. Filtering it out of the picker would make editing that employee silently drop their department; showing it disabled — and enabled only when it is already the selected value — keeps the record intact while refusing it as a new choice.

**`EMPLOYMENT_TYPE_VALUES` lives in Layer 2, not in the picker.** It was a hand-written array at the top of `employees/page.tsx`. It is now derived from `employmentTypeSchema.options`. It sits in `lib/models/hr.model.ts` rather than in the component because `components/**` may not import `lib/api-client/**` — the FE-08 boundary, lint-enforced, which caught two violations in this plan and is the reason the constant moved.

## Deviations from Plan

**1. [Rule 3 — Blocking] Two Layer-1 imports from `components/**`.** `option-selects.tsx` and `employee-form-schema.ts` both imported `employmentTypeSchema` directly. Caught by `no-restricted-imports`. Fixed by deriving the runtime list in Layer 2 and importing it from there.

**2. Plan file layout condensed.** The plan named seven separate `*-select.tsx` files. They are one `option-selects.tsx`, because four of them are the same component with a different query and splitting them would put the shared `toOptions` helper — the part that carries the retired-row rule — somewhere it has to be imported from anyway.

## Issues Encountered

**`leave-type-select`, `period-select` and `salary-component-select` are NOT built.** The plan lists them. Leave types and salary components are 35-08's and 35-13's screens, neither of which this session reached. `EmployeeCombobox` and the three built selects are what 35-10, 35-11 and 35-12 consume.

**`hr/layout.tsx` gained a Settings tab** (in the 35-11 commit) but the Attendance and Schedule screens still hold their own ad-hoc pickers. Those are 35-13's.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-12*

## Self-Check: PASSED

Both created files present; commit `821c899a` present in git history.
