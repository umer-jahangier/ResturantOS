---
phase: 35-hr-usability
plan: 11
subsystem: ui
tags: [settings, tenant-managed-lists, tax, forms, empty-states, field-array]

requires:
  - phase: 35-hr-usability
    provides: "35-09's use-hr-config hooks and DepartmentSelect"
  - phase: 35-hr-usability
    provides: "35-06's tax API, TAX_CONFIG_NOT_CONFIGURED and the slabs.N.* field paths"
provides:
  - "/app/hr/settings — a configuration area reachable from the HR tabs"
  - "Departments and Job titles screens: list, create, rename, retire, restore"
  - "Tax & EOBI screen: a banded editor bound to the server's per-row slab violations"
affects: [35-12, 35-13, 35-14]

tech-stack:
  added: []
  patterns:
    - "A day-one-empty list screen renders an INSTRUCTION, not a blank table"
    - "A 409 that is a normal first visit is rendered as a blank form with a sentence, not as an error banner"
    - "A paisa/rupees field-name mismatch is resolved with applyServerFieldErrors' fieldMap, never by renaming a field"

key-files:
  created:
    - frontend/components/hr/lookup-form-dialog.tsx
    - frontend/components/hr/lookup-list-screen.tsx
    - frontend/components/hr/tax-config-form.tsx
    - frontend/app/(tenant)/app/hr/settings/layout.tsx
    - frontend/app/(tenant)/app/hr/settings/page.tsx
    - frontend/app/(tenant)/app/hr/settings/departments/page.tsx
    - frontend/app/(tenant)/app/hr/settings/designations/page.tsx
    - frontend/app/(tenant)/app/hr/settings/tax/page.tsx
  modified:
    - frontend/app/(tenant)/app/hr/layout.tsx

key-decisions:
  - "The settings area is gated on hr.config.VIEW, with write actions gated on manage — a reader sees the lists without the buttons, which answers 'what departments do we have?' rather than showing a locked door"
  - "No delete on either list, matching the API; 'Retire' and 'Restore' are the actions"
  - "The tax screen opens on the year GET /config/tax/current names — never on a TypeScript copy of the July rule"
  - "An empty upper limit on a band is sent as null, not 0: 0 would make it a band that ends where it starts, refused for a different reason than the accountant would look for"
  - "Rates are sent exactly as typed — no client-side rounding or scaling on a value the server applies through BigDecimal"

requirements-completed: [HR-01, HR-02, FE-02, FE-08]

coverage:
  - id: D1
    description: "An owner configures departments and job titles in the UI with no SQL and nothing pre-seeded"
    requirement: HR-01
    verification:
      - kind: manual
        ref: "browser: /app/hr/settings/departments lists the tenant's departments; the New department dialog creates one"
        status: pass
    human_judgment: false
  - id: D2
    description: "A case-variant name is refused with the message bound to the name input"
    requirement: FE-08
    verification:
      - kind: manual
        ref: "browser: saving '  kitchen  ' when 'Kitchen' exists renders 'A department called \"Kitchen\" already exists. Names are matched ignoring case and spacing, so \"kitchen\" would be the same department. Choose a different name.' on the Name field"
        status: pass
    human_judgment: false
  - id: D3
    description: "An owner configures the tax table in the UI, and a bad slab table names each offending row"
    requirement: HR-02
    verification:
      - kind: manual
        ref: "browser: a table with a gap and no open top returned BOTH violations on their own rows — 'There is a gap: no band covers income between Rs 600,000.00 and Rs 700,000.00. Start this band at Rs 600,000.00.' and 'The highest band must have no upper limit...'"
        status: pass
    human_judgment: false
  - id: D4
    description: "An unconfigured current fiscal year is stated as a blocker with the year named, on a screen that can fix it"
    requirement: HR-02
    verification:
      - kind: manual
        ref: "browser: 'Payroll cannot run yet. FY2027 (2026-07-01 to 2027-06-30) has no tax table in force. Fill this in and tick “In force”.'"
        status: pass
    human_judgment: false
  - id: D5
    description: "The settings screens are legible and correctly proportioned"
    verification: []
    human_judgment: true
    rationale: "The dialogs are not — see the app-wide DialogContent defect in deferred-items.md, reproduced on a dialog this phase never wrote. The list and tax screens themselves render correctly."

duration: 38min
completed: 2026-08-12
status: complete
---

# Phase 35 Plan 11: HR Settings and the Tax Table Summary

**The departments/designations API had existed since 35-05 with no UI calling it, and the tax write API since 35-06 with no UI calling it. Both are now reachable from an HR → Settings tab. That is the difference between built and usable.**

## What an HR user can now do that they could not

- **Create, rename, retire and restore departments and job titles** — the lists the employee form picks from. Before this there was no screen at all; the only way to populate them was a `curl`.
- **Enter this fiscal year's income-tax bands, surcharge and EOBI rates**, in rupees and percentages, and see the screen say *"Payroll cannot run yet. FY2027 (2026-07-01 to 2027-06-30) has no tax table in force"* until they do. Before this, payroll refused with a two-word toast and there was nothing anywhere in the product that could fix it.
- **See which row of the slab table is wrong**, with the amounts spelled out: *"There is a gap: no band covers income between Rs 600,000.00 and Rs 700,000.00. Start this band at Rs 600,000.00."*

## Decisions Made

**The empty state is the most important state on the lookup screens.** 35-02 seeds nothing, deliberately — the user ruled out anything needing a developer. So *every* tenant sees these screens empty on their first day, and a blank table reads as a screen that failed. It says what the list is for, gives three examples, and offers one button, because at that moment adding a row is the only correct action.

**An unconfigured tax year is not an error state.** `GET /config/tax/{year}` answers `409 TAX_CONFIG_NOT_CONFIGURED`, which arrives as a react-query error. On this screen that is the normal first visit, and the response is a blank form with a sentence — not a red banner suggesting something broke. Every *other* failure still shows as a failure, because an accountant must never be shown an empty tax table that is empty because the network dropped.

**Rates are never touched by the client.** Amounts are collected in rupees and converted once at submit; rates are sent as typed. `TaxSlab.ratePct` was a Java `double` until recently and the slab rate is the largest deduction on a payslip — doing client-side arithmetic on it would put the defect back on the other side of the wire.

**An empty upper limit is `null`, not `0`.** Zero would make the top band end where it starts, which the server refuses — correctly, but for a different reason than the accountant would be looking for.

## Deviations from Plan

**1. Leave types and shifts are NOT built.** The plan lists `settings/leave-types/page.tsx`, `settings/shifts/page.tsx`, `leave-type-form-dialog.tsx`, `shift-form-dialog.tsx` and `days-of-week-field.tsx`. None exists. This session ran out of budget after departments, designations and tax. **The `1,2,3,4,5` days-of-week text box on the Schedule page is still there**, still parsed with `split(",").map(Number).filter(n => !Number.isNaN(n))`, still silently discarding anything it cannot parse. That is unfixed and it is the single most valuable remaining item in the plan.

**2. The tax screen is here, not in 35-12.** The plan assigns it to 35-12 alongside the Payroll screen rewrite. It is built here because it belongs in the settings area with the other tenant-managed configuration, and because the Payroll screen rewrite was not reached. **The Payroll screen still reports every mutation failure with `toast.error("Action failed")`** — so a fresh tenant pressing Calculate still gets two words, even though the screen that fixes the cause now exists and could be linked to. That link is 35-12's and it is not made.

**3. `LookupFormDialog` and `LookupListScreen` serve both lists.** The plan named four files. Departments and designations differ by one optional field and one query; two components with a `kind` prop keeps the retire-not-delete rule and the empty-state copy in one place.

## Issues Encountered

**No unit tests were written for these screens.** The employee form has 16; these have none. They were verified in a real browser instead — every claim in the coverage table above was read off the rendered page — but a browser run is not a regression gate, and the next person to touch `lookup-form-dialog.tsx` has nothing catching them. This is the most significant gap in the plan and it is a deliberate budget trade, not an oversight.

**The dialogs render as a ~48px column.** App-wide, pre-existing, reproduced on the untouched Users dialog at `max-width: 24px`. See `deferred-items.md`.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-12*

## Self-Check: PASSED

All 8 created files present; commit `b1ebe9a0` present in git history.
