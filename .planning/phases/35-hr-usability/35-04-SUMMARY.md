---
phase: 35-hr-usability
plan: 04
subsystem: ui
tags: [react-hook-form, zod, forms, validation, accessibility, aria, select, combobox, design-system]

requires:
  - phase: 35-hr-usability
    provides: "35-01's field-path error contract — the fourteen HR codes and their details[].field values this binder consumes"
  - phase: 20-design-system
    provides: "input.tsx's border-interactive contrast fix and aria-invalid treatment, reused verbatim by the new controls"
  - phase: 34-visual-design-language
    provides: "the richness-zone and glass/depth contract these primitives inherit rather than restyle"
provides:
  - "useStandardForm — mode onTouched + reValidateMode onChange, plus a derived submitState"
  - "applyServerFieldErrors — binds ApiError.fieldErrors to the inputs they name"
  - "Select and Combobox — the first shared closed-set controls in the app"
  - "FormHint and FormSubmitButton"
  - "Docs/conventions/form-standard.md — the D-35-06 convention with an honest adoption ledger"
affects: [35-07, 35-09, 35-10, 35-11, 35-12, 35-13, 35-14, every-future-form]

tech-stack:
  added: []
  patterns:
    - "mode onTouched + reValidateMode onChange is the app's validation timing"
    - "Server field errors bind to inputs; an unmatched path surfaces rather than being dropped"
    - "A shared control takes its options as a required prop, so no hardcoded set can hide inside it"
    - "An options list has three states — loading, failed, loaded-and-empty — and a failed load never renders as empty"
    - "A disabled submit states its reason in aria-describedby text, never a title attribute"

key-files:
  created:
    - frontend/lib/forms/standard-form.ts
    - frontend/lib/forms/server-field-errors.ts
    - frontend/lib/forms/index.ts
    - frontend/components/ui/select.tsx
    - frontend/components/ui/combobox.tsx
    - frontend/__tests__/lib/forms/server-field-errors.test.ts
    - frontend/__tests__/lib/forms/standard-form.test.tsx
    - Docs/conventions/form-standard.md
  modified:
    - frontend/components/ui/form.tsx

key-decisions:
  - "onTouched, not onChange — pure onChange argues with a user who is mid-way through complying"
  - "Native select rather than a Radix listbox for the default case; Combobox is the escape hatch, not a second styling"
  - "Options are a required prop with no default, so a hardcoded list cannot be smuggled into a shared control"
  - "A failed options load renders an error with retry, never an empty dropdown"
  - "An unmatched server field path becomes a form-level error naming the path, never a silent drop"
  - "No debounce on synchronous rules; use-debounced-value is reserved for network rules"

patterns-established:
  - "A form test types into the form and asserts the rendered message — asserting mode === 'onTouched' proves only that a string was passed to useForm"

requirements-completed: [FE-02, FE-08, DS-04]

coverage:
  - id: D1
    description: "A form validates a field as the user works, before any submit, and states the rule while the field is still empty"
    requirement: FE-02
    verification:
      - kind: automated_ui
        ref: "frontend/__tests__/lib/forms/standard-form.test.tsx#reports a field's error after the user leaves it, with no submit"
        status: pass
      - kind: automated_ui
        ref: "frontend/__tests__/lib/forms/standard-form.test.tsx#clears the error on the keystroke that makes the field valid"
        status: pass
    human_judgment: false
  - id: D2
    description: "A 400/422 carrying a field path lands on that field's input, not in a toast"
    requirement: FE-08
    verification:
      - kind: unit
        ref: "frontend/__tests__/lib/forms/server-field-errors.test.ts (8 tests, real useForm instance)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A disabled submit control says why, in words naming what is unfinished"
    requirement: FE-02
    verification:
      - kind: automated_ui
        ref: "frontend/__tests__/lib/forms/standard-form.test.tsx#disables submit while the form is invalid AND says why in associated text"
        status: pass
    human_judgment: false
  - id: D4
    description: "A closed set is rendered by one shared select or combobox"
    requirement: DS-04
    verification:
      - kind: automated_ui
        ref: "frontend/__tests__/lib/forms/standard-form.test.tsx#takes its options from the caller; #renders a placeholder that is not a selectable value"
        status: pass
      - kind: automated_ui
        ref: "frontend/__tests__/lib/forms/standard-form.test.tsx#renders a failed options load as an error with retry"
        status: pass
    human_judgment: false
  - id: D5
    description: "The standard feels right to a real user filling a real form in a browser"
    verification: []
    human_judgment: true
    rationale: "No screen consumes the kit yet — 35-07 converts the first non-HR form and 35-10..35-13 the HR ones. Browser proof is 35-14's job."

duration: 26min
completed: 2026-08-12
status: complete
---

# Phase 35 Plan 04: The App-Wide Form Standard Summary

**Live field validation, server errors bound to the inputs they name, and the app's first shared select — built entirely out of parts that were already installed, because the stack was never what was missing.**

## Performance

- **Duration:** 26 min
- **Started:** 2026-08-12T00:04Z
- **Completed:** 2026-08-12T00:30Z
- **Tasks:** 2
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments

This is the plan that answers the user's sentence directly. Three complaints, three mechanisms:

- **"no form validations on run-time"** — `useStandardForm` sets `mode: "onTouched"` with `reValidateMode: "onChange"`. **Not one `useForm` call in the codebase set `mode` before this**, so every form in the product validated only on submit.
- **"do not give exact errors"** — `applyServerFieldErrors` binds `ApiError.fieldErrors` to the input each entry names. That array has been parsed since phase 3 and **nothing anywhere read it**; every `onError` collapsed to a toast.
- **"need drop-downs rather than manual input"** — `components/ui/` had **no `select.tsx` at all**. Each screen wrote its own `<select>` with a copy of the same class string.

That is this project's failure mode in miniature: structurally present, behaviourally absent.

## The kit

```ts
import { useStandardForm, applyServerFieldErrors } from "@/lib/forms";
```

| Export | What it does |
|---|---|
| `useStandardForm({ schema, defaultValues })` | `useForm` + `createZodResolver`, `mode: "onTouched"`, `reValidateMode: "onChange"`, plus `submitState` |
| `form.submitState` | `{ canSubmit, reason, invalidFields }` — derived from react-hook-form's own `formState`, so it cannot drift from the resolver |
| `applyServerFieldErrors(form, error, fieldMap?)` | Binds each `fieldErrors` entry to its path; focuses the first offender; returns `{ boundFields, unmatchedFields, hasFieldErrors }` |
| `<Select options={…} placeholder isLoading error onRetry>` | Native select. Options required, no default. |
| `<Combobox options={…}>` | Searchable equivalent, popover + cmdk, announces its result count |
| `<FormHint>` | The rule, rendered persistently — visible before it can be broken |
| `<FormSubmitButton submitState={…}>` | Disabled with its reason in `aria-describedby` text |

## Task Commits

1. **Task 1 RED → GREEN: `useStandardForm` + `applyServerFieldErrors`** — `03c9be9e` (feat)
2. **Task 2: Select, Combobox, FormHint, FormSubmitButton, the convention doc** — `a7e86ca8` (feat)

## Decisions Made

**`onTouched`, not `onChange`.** Pure `onChange` validates from the first keystroke: typing the "A" of a name shows *"Name is required"* and then clears it — a form arguing with someone who is in the middle of complying with it. `onTouched` waits for the first blur; `reValidateMode: "onChange"` then makes every subsequent keystroke live.

**A native `<select>`, not a Radix listbox.** Keyboard- and screen-reader-correct for free, works on touch with the platform's own picker, and cannot get stuck open inside the scroll containers this app already fights. `Combobox` is the escape hatch for long or searchable sets — deliberately not a second styling of the same control.

**Options are a required prop with no default.** This is the mechanism, not a style preference: it is what stops a hardcoded department list being smuggled into a shared component and re-creating D-35-01's problem inside the fix for it.

**A failed options load is not "empty".** An empty dropdown reads as *"there are none"*, which is a different and far more damaging statement than *"this did not load"* — particularly on day one, when every tenant-managed list genuinely **is** empty.

**An unmatched server path surfaces rather than drops.** A message the server took the trouble to produce and the client silently discards is worse than no message, because nobody ever learns it exists.

## Deviations from Plan

**1. [Rule 2 — Missing accessibility] `role="combobox"` lacked `aria-controls`.**
- **Found during:** Task 2 lint
- **Issue:** `eslint jsx-a11y/role-has-required-aria-props` flagged the combobox trigger. Without `aria-controls` assistive technology cannot follow the relationship between the trigger and the listbox it opened.
- **Fix:** `React.useId()` on the `Command.List`, referenced from the trigger.
- **Verification:** `npx eslint components/ui/combobox.tsx` clean; 17/17 tests still pass.

**2. [Rule 3 — Blocking] `npm run lint` crashed on a missing gitignored directory.**
- **Issue:** `ESLint: ENOENT ... scandir 'frontend/test-results'`. The ESLint config globs `test-results/`, which is gitignored and was absent.
- **Fix:** `mkdir -p frontend/test-results`. No tracked file changed. Worth knowing for anyone else who hits it — the error names ESLint's internals and reads like a config fault rather than a missing directory.

**3. [Test harness] The first binder test run failed for the wrong reason.**
Six of eight tests failed with `expected undefined`. The cause was not the implementation: react-hook-form's `formState` is a Proxy that only re-renders for slices a component actually **read** during render, so a `renderHook` that never touches `formState.errors` is never re-rendered by `setError` and `result.current` stays stale. Added the subscription in the harness with a comment explaining it, because this will bite the next person writing a form test.

---

**Total deviations:** 2 auto-fixed (1 accessibility, 1 blocking-environment), 1 test-harness correction.

## Issues Encountered

**`npx tsc --noEmit` reports two errors that are not mine.** `lib/adapters/__tests__/station.adapter.test.ts` (untracked, a sibling agent's WIP) references `apiStationSchema` and `adaptStation`, which do not exist yet in the files that agent is mid-way through editing. **No error in any file this plan touched** — verified by filtering tsc output to `lib/forms`, `components/ui/{select,combobox,form}` and `__tests__/lib/forms`. Recorded so the next plan does not mistake it for a regression from here.

**What this plan did NOT do — and this is the important caveat:**

The kit is **built and tested, and adopted by nothing.** Seventeen tests prove the behaviours in isolation; zero real screens use them. `Docs/conventions/form-standard.md` says so explicitly in its adoption ledger rather than implying broader coverage. The claim "the app now validates as you type" would be false today — the correct claim is "the app now *can*, and the first screen to prove it is 35-07".

**Two known duplications deliberately left in place:** `components/shared/catalog-item-combobox.tsx` and `components/shared/uom-select.tsx` each predate `Combobox` and carry their own popover-plus-cmdk assembly. Both are expressible with the shared primitive. Migrating them changes purchasing and inventory screens, each with its own regression surface, so it is not done here — recorded in the module comment and the convention doc so it is visible rather than forgotten.

## User Setup Required

None. No new dependency — `frontend/package.json` is unchanged, asserted by `git diff --quiet -- package.json`.

## Next Phase Readiness

**Unblocks every remaining frontend plan in the phase.**

- **35-07** — converts the first non-HR forms and adds the ESLint rule that enforces adoption for *new* forms. It must also update the adoption ledger in `form-standard.md`; the doc is structured for that.
- **35-09** — the HR pickers wrap `<Select>`/`<Combobox>` with tenant-managed option queries. Pass `isLoading`/`error`/`onRetry` through; the three-state contract is the point.
- **35-10 … 35-13** — use `applyServerFieldErrors` against the 35-01 code table. Where a form collects rupees and the API takes paisa, use the `fieldMap` argument rather than renaming a field.

**Concern:** `submitState.reason` humanizes the raw field path (`employeeNo` → "employee no"), which is serviceable but not a label. A form with genuinely awkward field names will produce an awkward sentence. A per-field label registry would fix it properly; that is a real follow-up, not a defect worth blocking on.

## Self-Check: PASSED

All 8 created files present on disk; both task commits present in git history.

---
*Phase: 35-hr-usability*
*Completed: 2026-08-12*
