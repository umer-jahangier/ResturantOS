---
phase: 35-hr-usability
plan: 10
subsystem: ui
tags: [react-hook-form, zod, forms, validation, pii-masking, dialog, employees]

requires:
  - phase: 35-hr-usability
    provides: "35-04's useStandardForm, applyServerFieldErrors, FormHint, FormSubmitButton"
  - phase: 35-hr-usability
    provides: "35-09's DepartmentSelect / DesignationSelect / EmploymentTypeSelect and the corrected employee shape"
  - phase: 35-hr-usability
    provides: "35-01's DUPLICATE_VALUE on employeeNo and 35-05's DEPARTMENT_NOT_FOUND on departmentId"
provides:
  - "EmployeeFormDialog — one dialog serving create and edit, on the app form standard"
  - "employee-form-schema.ts — the employee rules and the ONE rupees-to-paisa conversion"
  - "An Employees screen with search, department filter, a former-staff toggle, and an edit path"
affects: [35-14]

tech-stack:
  added: []
  patterns:
    - "A masked PII field starts EMPTY on edit, with the mask shown as a hint; blank means unchanged"
    - "A toast on a mutation failure ONLY when no field error could be bound"
    - "A client rule is never stricter than the server's — where they disagree, the server is the contract"

key-files:
  created:
    - frontend/components/hr/employee-form-dialog.tsx
    - frontend/components/hr/employee-form-schema.ts
    - frontend/__tests__/components/hr/employee-form-dialog.test.tsx
  modified:
    - frontend/app/(tenant)/app/hr/employees/page.tsx

key-decisions:
  - "The employee number and join date are shown READ-ONLY on edit rather than hidden — someone looking for them should find them and see why they cannot change"
  - "cnic and bankAccountNo default to empty on edit; submitting the mask back would overwrite the real encrypted value with it"
  - "Changing department clears the chosen job title, rather than leaving a title from another department selected"
  - "basicSalaryRupees is a STRING in the form schema — an empty numeric input yields NaN, and 'NaN' is not a message anyone can act on"
  - "A future join date is refused: it is almost always a typed year, and it silently breaks every attendance and payroll period the employee should appear in"

patterns-established:
  - "A form test clicks the real submit button with fireEvent.click — userEvent's synthesised pointer sequence does not reach jsdom's button activation behaviour, so a user.click on a submit button fires no submit event"

requirements-completed: [HR-01, FE-02, FE-08, DS-04]

coverage:
  - id: D1
    description: "Creating an employee uses a select for every closed-set field and free text only where the value genuinely is free"
    requirement: HR-01
    verification:
      - kind: automated_ui
        ref: "employee-form-dialog.test.tsx — 3 tests under 'closed sets are lists, not text boxes'"
        status: pass
      - kind: manual
        ref: "browser: Department tag=SELECT options=[Choose a department, Kitchen]; Job title tag=SELECT options=[Choose a job title, bcugh78, Chef, test]"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every rule is stated before it is broken and checked as the user works, with submit disabled and a reason given"
    requirement: FE-02
    verification:
      - kind: automated_ui
        ref: "employee-form-dialog.test.tsx — 7 tests under 'rules are shown before they are broken'"
        status: pass
      - kind: manual
        ref: "browser: a future join date and a comma'd salary each named; submit disabled reading 'Fix join date and basic salary rupees to continue'"
        status: pass
    human_judgment: false
  - id: D3
    description: "A server rejection lands on the field it names"
    requirement: FE-08
    verification:
      - kind: automated_ui
        ref: "employee-form-dialog.test.tsx — DUPLICATE_VALUE on employeeNo, DEPARTMENT_NOT_FOUND on departmentId"
        status: pass
      - kind: manual
        ref: "browser: 'Employee number 1 is already used by another employee. Choose a different number.' rendered against the employee-number input"
        status: pass
      - kind: other
        ref: "mutation check — removing applyServerFieldErrors fails both tests"
        status: pass
    human_judgment: false
  - id: D4
    description: "A masked CNIC returned by the API is never submitted back as if it were the real value"
    verification:
      - kind: automated_ui
        ref: "employee-form-dialog.test.tsx#never preloads a masked CNIC or account number; #omits an untouched CNIC from the update"
        status: pass
      - kind: other
        ref: "mutation check — preloading the mask fails both"
        status: pass
    human_judgment: false
  - id: D5
    description: "The dialog is legible and correctly proportioned on screen"
    verification: []
    human_judgment: true
    rationale: "FAILS today, and not because of this plan. Every dialog in the product renders as a ~30px column — the untouched Users dialog measures max-width 24px. Recorded with measurements in deferred-items.md."

duration: 41min
completed: 2026-08-12
status: complete
---

# Phase 35 Plan 10: The Employee Form Summary

**The screen the user's complaint was about, rebuilt: nine unlabelled placeholder inputs and one fixed failure toast, replaced by labelled selects, live rules, and server errors that land on the input they name.**

## What it replaced

Nine `<Input placeholder="…">` elements in a two-column grid, held in a single `useState` object, **with no labels at all** — the placeholder was the label and it disappeared the moment anyone typed. Designation was free text. Department was not on the form at all, despite existing in the API and the database. No validation of any kind before submit. And the failure handler was one line:

```ts
onError: () => toast.error("Failed to create employee")
```

so a duplicate employee number, a mistyped date and a server outage were indistinguishable to someone who had just typed nine fields. There was no edit path — only create and deactivate — although the API has had an update endpoint since phase 11.

## What an HR user can now do that they could not

- **Pick** a department and a job title from the tenant's own lists instead of typing them.
- **Be told, while typing**, that a join date is in the future or a salary has a comma in it — not after pressing Save.
- **See why Save is disabled**, in a sentence naming the unfinished fields, in text a screen reader announces.
- **Read the server's actual objection on the actual input**: *"Employee number 1 is already used by another employee. Choose a different number."*
- **Edit an employee.** There was no way to do this at all.
- **Search and filter the roster** by name, number and department, and see former staff on request.

## Decisions Made

**A masked CNIC is never preloaded.** The API returns `cnicMasked` — literally `*******-*******-4`. Preloading it into the edit form and submitting it would overwrite the real, encrypted value with its own mask, destroying the data while looking like a save that worked. Both PII fields start empty, the current mask is shown as a hint beside them, and blank means *leave it as it is*.

**Changing department clears the job title.** Leaving a title from another department selected is how a record ends up internally inconsistent without anyone being told.

**Employee number and join date are read-only on edit, not hidden.** Someone looking for them should find them and see why they cannot change, rather than conclude the screen forgot them.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The employee-number rule was stricter than the server's, and it locked a user out of their own record.**
- **Found during:** browser verification, against real data
- **Issue:** the schema required 3–20 characters. The tenant has an employee whose number is `1` — a row the server accepted, because the server's rule is `@NotBlank`. The form refused to let that employee be edited and told the user their own data was invalid.
- **Fix:** `min(1, "Enter the employee number")`. A client rule stricter than the server's protects nothing; where the two disagree, the server is the contract.
- **Verification:** new test `accepts a one-character employee number, because the server does`.
- **This was only findable in a browser.** Every unit test used a well-formed fixture.

**2. [Test harness] `userEvent.click` on a submit button fires no submit event in jsdom.**
Three tests failed with the mutation never called. The button's own click listener fired (verified), but jsdom runs a button's activation behaviour from the `MouseEvent` that `fireEvent.click` dispatches, and user-event's synthesised pointer sequence does not reach it. `fireEvent.click` on the same enabled button; every test still goes through `handleSubmit`, the resolver and the mutation. Recorded in the test file, because this will bite the next person.

## Verification

- **16 tests** that type into the form and assert rendered text. No test inspects configuration.
- **Mutation-checked:** removing `applyServerFieldErrors` and preloading the PII mask fails 4 of the 16.
- **Browser, against the running stack**, signed in as `owner@terrace.local` through the real login form with TOTP — see `evidence/` and `e2e/verify-35-hr.mjs`. Every claim above was re-read off the rendered page.

## Issues Encountered

**The dialog renders as a ~48px column.** This plan's forms are behaviourally correct and visually unusable, and the cause is not here: the Users dialog, which phase 35 never touched, measures `max-width: 24px` in the same browser session. `DialogContent`'s `max-w-[calc(100%-2rem)]` resolves to a couple of dozen pixels with no transform ancestor and no matching stylesheet rule. Full measurements, and the one fix attempted and reverted, are in `deferred-items.md`. **Do not read the screenshots in `evidence/` as this phase's visual design** — read them for the text.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-12*

## Self-Check: PASSED

All 3 created files present; commit `85c04f9c` present in git history.
