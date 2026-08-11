# Phase 29 — HR Usability & App-Wide Form Standard · CONTEXT

## Why

The user: *"create a professional easy to use HR system, current one is very bad, need a lot of
manual input rather than drop-downs, no form validations on run-time and do not give exact errors,
**same for the whole app**."*

Two problems in one sentence. HR is the worst offender, but the form standard is app-wide — so
this phase fixes HR **and** establishes the pattern every other screen adopts.

## Locked decisions

**D-29-01 — Anything with a known set of values is a select, not a text field.**
Employment type, department, designation, leave type, shift, branch, manager, salary component,
attendance status, marital status, blood group. If the value must match something the system
already knows, typing it by hand is a defect: it produces "Waiter", "waiter" and "Wtr" as three
departments and no report can group them.

Where the set is tenant-defined (departments, designations), the tenant manages the list in the
UI — a dropdown backed by a table the owner maintains, **not** a hardcoded enum and **not** free
text. Per the user: nothing may require a developer to seed.

**D-29-02 — Validation is live, on the field, as the user types — not on submit.**
Field-level, debounced, showing the rule before it is broken (*"8–12 digits"*) rather than after.
A form that accepts input for two minutes and then rejects the whole thing is the specific
experience being complained about. Submit stays disabled with a stated reason while invalid.

**D-29-03 — Errors name the field, the rule and the fix. Server errors are mapped, never raw.**
Not *"An unexpected error occurred"*, not *"Bad Request"*, not a stack trace. `422` and `400`
responses must carry a field path, and the form must bind them to the offending input. Where the
backend does not yet return a field path, **add it** — this is a backend job as much as a frontend
one. Phase 19 found a wrong-password error rendering *"Please sign in again."*, which sent users
to do the one thing that could not help; that class of message is the target.

**D-29-04 — One shared form stack, not a per-screen reinvention.**
Whatever the frontend already uses (check `react-hook-form` + `zod` before choosing) becomes the
single documented pattern: schema-driven, one `<FormField>` primitive, one error renderer, one
submit-state hook. Reuse the Layer-2 schemas so client and server rules cannot drift.

**D-29-05 — HR must be operable end to end without SQL.**
The financial audit found `hr_db.tax_config` has **one row, for a placeholder tenant, for FY2026
when the current year is FY2027**, with no controller, screen or seeder — so payroll cannot run
at all. Tax configuration becomes a real, tenant-managed screen. Employees, departments,
designations, shifts, leave types, salary components and tax config are all CRUD from the UI.

**D-29-06 — The pattern is documented and adopted, not just built.**
This phase converts HR fully and at least one non-HR form (menu item or user creation) to prove
the pattern generalises. Later phases adopt it. A standard nobody else uses is not a standard.

## Constraints

- `hr_db` is FORCE RLS; Testcontainers runs as superuser and bypasses it, so a green IT proves
  nothing about tenant scoping — follow `RlsForcedInvariantIT` and the non-superuser canary.
- `HrTestBase` runs `ddl-auto: validate` deliberately (it caught `tax_config` mapping `NUMERIC` as
  `double`, which stopped hr-service booting). Do not weaken it.
- Money is **BIGINT paisa**; rates are `NUMERIC`, applied through `PercentOfPaisa` with explicit
  HALF_UP rounding. No floats in payroll.
- hr-service now enforces `hr.rego` (phase 18b) — branch isolation is live. A manager at one
  branch must not read another branch's employees.

## Definition of done

1. Creating an employee uses selects for every closed-set field; no free-text where a list exists.
2. Every validation fires as the user types, with the rule stated before it is broken.
3. Every server error binds to its field and reads as an instruction — no raw codes, no
   "unexpected error" for a foreseeable condition.
4. An owner configures departments, designations, shifts, leave types and **tax config** in the UI.
5. Payroll runs end to end for the current fiscal year with no SQL.
6. The pattern is documented and adopted by at least one non-HR form.
