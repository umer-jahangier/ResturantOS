---
phase: 28-station-pos-profiles
plan: 09
subsystem: frontend
tags: [pos, terminals, catalogue, menu-scope, react-query]

requires:
  - phase: 28-station-pos-profiles
    provides: "28-04's terminal endpoints and the empty-means-everything contract; 28-06's station hook, type labels and the Terminals nav entry"
provides:
  - "terminal.schema / terminal.model / terminal.adapter / terminal.repository — a dedicated module at every layer"
  - "useTerminals (active) and useTerminalCatalogue (retired included), terminalKeys"
  - "MenuScopePicker and StationSetPicker — reusable none-means-all pickers"
  - "/app/terminals — the POS terminal catalogue screen"
affects: [28-12, 28-13, 28-14]

tech-stack:
  added: []
  patterns:
    - "A derived summary boolean is recomputed from the rows it summarises rather than trusted from the wire, so the two cannot disagree"
    - "A dialog's reset is a `key`-driven remount, never an effect copying props into state"

key-files:
  created:
    - frontend/lib/api-client/schemas/terminal.schema.ts
    - frontend/lib/models/terminal.model.ts
    - frontend/lib/adapters/terminal.adapter.ts
    - frontend/lib/repositories/terminal.repository.ts
    - frontend/lib/hooks/pos/use-terminal-admin.ts
    - frontend/components/terminals/menu-scope-picker.tsx
    - frontend/components/terminals/station-set-picker.tsx
    - frontend/components/terminals/terminal-form-dialog.tsx
    - frontend/components/terminals/terminal-list.tsx
    - frontend/app/(tenant)/app/terminals/page.tsx
    - frontend/__tests__/pos/terminal-admin.test.tsx
    - frontend/lib/adapters/__tests__/terminal.adapter.test.ts
    - frontend/e2e/terminal-admin-proof.mjs
  modified: []

key-decisions:
  - "A DEDICATED module at every layer rather than an addition to pos.schema/model/adapter/repository. The codebase already keeps per-domain files, and plan 28-10 edits the shared POS layer files in this same wave — two agents in one module is 19b's collision."
  - "`offersWholeMenu` and `firesToAllStations` are DERIVED in the adapter from the arrays, even though the server sends them. A summary and the rows it summarises are two representations of one fact, and the moment they can disagree a reader cannot tell which is wrong — the same argument 28-04 used to forbid a `serves_all` column."
  - "Both scope arrays are ALWAYS sent on update. Server-side `null` means 'leave alone' and `[]` means 'offer everything'; omitting them would make 'the admin unticked everything' indistinguishable from 'the admin only renamed it', and one of those silently widens a bar terminal to the whole card."
  - "The menu-scope copy says the scope is NOT a permission, in the picker itself. 28-04 declared the category set a filter rather than half-enforce it; a screen that implied a guard would have an owner believe a bar till is prevented from ringing up a biryani. The words are 'offers' and 'shows', never 'can' or 'allowed'."
  - "The conflict message lands INLINE on the form, not in a toast. The field that has to change is on this dialog, and a toast puts the remedy somewhere the eye is not."
  - "No reset effect on the dialog: the page mounts it with a key derived from the form target, so a change of target remounts and the state initialisers are the reset. Copying props into state in an effect is a second mechanism for the same thing, one render behind."
  - "The terminal CODE is upper-cased and immutable after creation. In a browser-reached deployment a till remembers which terminal it is by that handle (plan 28-13), so a rename would silently re-point every screen that stored it."

patterns-established:
  - "Both none-means-all pickers keep their sentence VISIBLE above the list rather than in a tooltip, because the empty state is the confusing one and the sentence is the fix"

requirements-completed: [P28-SC1, P28-SC6]

coverage:
  - id: D1
    description: "A tenant admin can create a named terminal, choose the categories it offers and the stations it fires to, and retire it — entirely in the UI"
    requirement: P28-SC1
    verification:
      - kind: unit
        ref: "terminal-admin.test.tsx#creates a bar terminal scoped to drinks, sending both scope arrays explicitly; #asks for confirmation before retiring, and offers no delete anywhere"
        status: pass
      - kind: manual
        ref: "browser: a terminal created at /app/terminals with a category and the Main bar station; screenshots 08-10"
        status: pass
    human_judgment: true
  - id: D2
    description: "No category selection reads as 'offers the whole menu', in words, on the picker and on the row"
    requirement: P28-SC1
    verification:
      - kind: unit
        ref: "#summarises a terminal with NO category scope as offering the whole menu, in words; #states in the menu scope picker that ticking nothing offers the whole menu"
        status: pass
      - kind: unit
        ref: "terminal.adapter.test.ts — the two empty-set cases and the derive-don't-trust case"
        status: pass
      - kind: manual
        ref: "browser read-back: 'Tick nothing and this terminal offers the whole menu.' / 'This terminal shows Starters only.' / row: 'Offers Starters · fires to Main bar'"
        status: pass
    human_judgment: true
  - id: D3
    description: "The screen shows what a terminal currently offers without opening an edit dialog"
    requirement: P28-SC1
    verification:
      - kind: unit
        ref: "#summarises a scoped terminal by NAMING its categories and stations"
        status: pass
    human_judgment: false
  - id: D4
    description: "A failed load renders the failure with a retry and never the empty state; a user without pos.terminals.admin sees no management actions"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "#renders the FAILURE state with a retry, never the empty state, when the load fails; #shows no management actions to a user without pos.terminals.admin"
        status: pass
    human_judgment: false
  - id: D5
    description: "The Terminals route registered in the navigation by plan 28-06 now exists"
    requirement: P28-SC6
    verification:
      - kind: manual
        ref: "browser: /app/terminals renders, heading 'POS Terminals'; the sidebar entry 28-06 registered resolves"
        status: pass
    human_judgment: true

duration: 34min
completed: 2026-08-12
status: complete
---

# Phase 28 Plan 09: The POS terminal catalogue gets a screen — Summary

**A restaurant owner can now create a named till, decide which part of the menu it offers and which stations it fires to, and retire it — without a developer. `POST /api/v1/pos/terminals` had nineteen integration tests and no caller.**

## Performance

- **Duration:** ~34 min
- **Tasks:** 2 of 2
- **Files modified:** 13 (13 created, 0 modified)
- **Commits:** `4c508ba4`, `8e4e76ea`

## The contract, for plans 28-12, 28-13 and 28-14

```ts
// hooks — frontend/lib/hooks/pos/use-terminal-admin.ts
useTerminals()            // ACTIVE terminals. This is what a till's own picker (28-13) reads.
useTerminalCatalogue()    // includes retired. Requires pos.terminals.admin — the server refuses
                          // includeInactive without it, gated INSIDE the service (19b/28-04).
useCreateTerminal() / useUpdateTerminal() / useSetTerminalActive()

terminalKeys.all(branchId)        // ["pos", branchId, "terminals"]
terminalKeys.catalogue(branchId)  // ["pos", branchId, "terminals", "catalogue"] — a CHILD

// model — frontend/lib/models/terminal.model.ts
PosTerminal { id, branchId, code, name, serviceModel, defaultOrderType, printerRef, active,
              categoryIds, stationIds, offersWholeMenu, firesToAllStations }
ServiceModel      = "COUNTER" | "TABLE_SERVICE" | "SELF_SERVE"
TerminalOrderType = "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "PICKUP"
```

`MenuScopePicker` and `StationSetPicker` are standalone and reusable — plan 28-13 should mount the
first one nowhere and read `offersWholeMenu` instead, and plan 28-10 should reuse
`stationTypeLabel` / `stationTypeScreen` from `components/stations/station-type-select.tsx` rather
than re-listing the five types a third time.

Test ids: `menu-scope-picker`, `menu-scope-summary`, `station-set-picker`, `station-set-summary`,
`terminal-row`, `terminal-menu-summary`, `terminal-form-error`.

## Accomplishments

- **The sentence is the feature.** *"Tick nothing and this terminal offers the whole menu."* stays visible above the list, and the row summary says *"Offers the whole menu"* rather than showing an empty cell. An empty checkbox list and "offers nothing" are opposites that otherwise look identical, and the second reading would put a cashier in front of an empty grid with no error anywhere to explain it.
- **The scope is declared a filter, in the picker.** 28-04 chose to make the category set a menu filter rather than half-enforce it as a guard, and said so in the DDL, the entity and the controller. This screen says it too: *"It is not a permission — it does not stop anyone ringing up an item, it decides which ones are on the grid in front of them."* An owner who believed otherwise would be relying on a control that does not exist.
- **The summary booleans are derived, not trusted.** `PosTerminalDto` sends `offersWholeMenu` and `firesToAllStations`, computed from the very lists beside them. The adapter recomputes both from the arrays anyway, and a test feeds it a response where the flag and the list disagree to prove which one wins.
- **Three states on update, honoured.** Both scope arrays are always sent explicitly, because the form always shows the current selection — so "unticked everything" and "renamed only" are different requests, which is exactly what 28-04's three-state update exists to distinguish.

## Deviations from Plan

**1. [Rule 3 — Blocking] The dialog's reset effect failed the lint gate**
`react-hooks/set-state-in-effect` refuses `setState` inside an effect body. Removed entirely: the
page already mounts the dialog with a `key` derived from the form target, so a change of target
remounts it and the `useState` initialisers are the reset. Better behaviour as well as a passing
lint — the effect was a second mechanism for the same thing, one render behind.

**2. [Scope note] The plan's file list names `frontend/lib/adapters/__tests__/terminal.adapter.test.ts` and the component test; both were written. No file outside this plan's list was modified — in particular `sidebar-nav-items.ts` was NOT touched, because plan 28-06 owns it for the phase and had already registered `/app/terminals`.**

## What this screen still does not do

Nothing on a till reads a terminal profile yet. Binding a browser session to one — the "dedicated
POS" half of the user's request — is **plan 28-13**, and the menu grid does not narrow until it
lands. The profile is now creatable and readable; it is not yet consumed.

## Known Stubs

None. Every control calls an endpoint pos-service has served since 28-04, and the create path was
driven end to end against the live gateway.

## Threat Flags

None. No new endpoint, no new package, no new trust boundary — a browser client for endpoints that
already exist behind `pos.terminals.admin`.

## Self-Check: PASSED

All 13 created files present; both commits (`4c508ba4`, `8e4e76ea`) resolve in `git log`.

## Verification

| Check | Result |
|---|---|
| `lib/adapters/__tests__/terminal.adapter.test.ts` | 7/7 pass |
| `__tests__/pos/terminal-admin.test.tsx` | 11/11 pass |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every file this plan touched | 0 errors, 0 warnings |
| Full frontend unit suite | 1090/1090 pass, 107 files |
| Real browser, live gateway | see below |

Browser run (`node e2e/terminal-admin-proof.mjs`), signed in as `admin@terrace.local`:

```
heading: POS Terminals
menu scope BEFORE: Tick nothing and this terminal offers the whole menu.
station set BEFORE: Tick nothing and this terminal fires to every station in the branch.
categories offered: ["Starters","Mains","Drinks","Soft Drinks"]
stations offered: ["Main bar\nBar — Bar screen","Hot line\nKitchen — Kitchen screen"]
menu scope AFTER : This terminal shows Starters only.
station set AFTER: This terminal fires to Main bar only.
terminal rows: 1
row summaries: ["Offers Starters · fires to Main bar"]
```

Screenshots `08-terminals-empty.png`, `09-terminal-form-scoped.png`, `10-terminals-created.png`.
The station picker is showing the two stations plan 28-06's screen created earlier in the same
session, with 28-06's type labels — which is the two plans agreeing in a browser rather than in a
test double.
