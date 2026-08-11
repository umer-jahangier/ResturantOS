---
phase: 28-station-pos-profiles
plan: 11
subsystem: frontend
tags: [users, stations, rbac, forms, react-query]

requires:
  - phase: 28-station-pos-profiles
    provides: "28-01's PUT/GET /api/v1/users/{id}/stations and the attributes.stations claim; 28-06's station list hook; 28-07's kitchen-side scope"
provides:
  - "UserStationScope / BranchStationScope / branchStationScope() — the unrestricted state as a named property and a union arm"
  - "UserRepository.getStationAssignments / replaceStationAssignments"
  - "useUserStations / useReplaceUserStations, userKeys.stations"
  - "StationAssignmentField — the station picker, mounted in the create AND the edit dialog"
  - "A Stations section on the user detail panel"
affects: [28-14]

tech-stack:
  added: []
  patterns:
    - "An editor holds `null` until touched and reads THROUGH to the server's answer, rather than seeding state from a query in an effect"
    - "A destructive-if-wrong default is expressed as a sentence about consequence, never as a count or the word 'none'"

key-files:
  created:
    - frontend/components/users/station-assignment-field.tsx
    - frontend/__tests__/pos/user-station-assignment.test.tsx
    - frontend/e2e/station-scope-proof.mjs
  modified:
    - frontend/lib/api-client/schemas/user.schema.ts
    - frontend/lib/models/user.model.ts
    - frontend/lib/adapters/user.adapter.ts
    - frontend/lib/repositories/user.repository.ts
    - frontend/lib/hooks/use-users.ts
    - frontend/components/users/user-form-dialog.tsx
    - frontend/components/users/user-detail-panel.tsx

key-decisions:
  - "The empty-state sentence is `They will see every station in this branch.` — asserted verbatim by a unit test AND read back off a real browser. It is plain muted text with no `role=\"alert\"`, because every user in the product is in this state and styling the universal default as a problem is how an admin narrows a working kitchen."
  - "The selection is cleared in the branch select's own onChange, not reconciled in an effect. auth-service does not validate station codes against pos-service — it has no route into pos_db and says so — so a carried code is ACCEPTED and filters the user to a station producing no tickets."
  - "The picker offers ONLY the branch the admin is signed in to, and says why. `StationServiceImpl.requireOwnBranch` refuses any other branchId with 403, so a cross-branch picker cannot be populated; rendering an erroring one would read as a defect. This is a real product limitation, stated rather than hidden."
  - "Create is TWO calls: `POST /api/v1/users` then `PUT .../stations`, and the second is skipped entirely when nothing was chosen. 28-01 deliberately did not put stations on the create DTO (the assignment is gated on rbac.role.manage and has its own endpoint), and unrestricted is the do-nothing default all the way to the wire."
  - "If the account is created and the assignment then fails, the toast says exactly that — `The account was created, but its stations were not saved` — because the two halves have different remedies and a generic failure would have an admin re-running the whole thing."
  - "The edit dialog holds `pendingCodes: string[] | null` and reads through to the server until touched. Seeding state from the query in an effect would flash an empty picker, and an editor that opened empty and was then saved would clear an assignment nobody looked at."

patterns-established:
  - "A sentence a plan calls load-bearing is asserted verbatim in a unit test and then read back out of a real browser, so 'the copy is right' is a measurement rather than a claim"

requirements-completed: [P28-SC6]

coverage:
  - id: D1
    description: "An admin picks a user's stations in the same form as the branch and the role, at creation and at edit"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "user-station-assignment.test.tsx — #shows no station field until a branch has been chosen, #creates a user with a branch, a role and two stations, #loads the user's current stations into the edit dialog and saves a changed selection"
        status: pass
      - kind: manual
        ref: "screenshots/05-user-form-bar-selected.png — the Add-a-user dialog showing Branch, Role and a Stations checkbox list with Main bar ticked"
        status: pass
    human_judgment: true
  - id: D2
    description: "An empty selection reads as 'sees everything', never as a restriction"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "#says, with nothing selected, that the user will see EVERY station in the branch (asserts the sentence AND the absence of role=alert); #says an unassigned user sees every station, rather than showing a blank"
        status: pass
      - kind: manual
        ref: "browser read-back: 'They will see every station in this branch.' / after selection 'They will see Main bar only.'"
        status: pass
    human_judgment: true
  - id: D3
    description: "A station code is never carried across a branch change"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "#clears a station selection when the branch changes, rather than carrying codes across"
        status: pass
    human_judgment: false
  - id: D4
    description: "The admin is told when the change reaches a user who is already signed in"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "#states when the change reaches a user who is already signed in — matches /already signed in.*15 minutes/i"
        status: pass
      - kind: manual
        ref: "browser read-back of the notice, verbatim"
        status: pass
    human_judgment: true
  - id: D5
    description: "The assignment written from the screen reaches the database, the token and the KDS scope"
    requirement: P28-SC6
    verification:
      - kind: manual
        ref: "GET /api/v1/users/{id}/stations after the browser create → [{branchId, stationCodes:[\"BAR\"]}]; that account's access token carries attributes.stations = [\"BAR\"]; GET /api/v1/kitchen/kds/stations returns a NARROWER set for it than for an unassigned kitchen account"
        status: pass
    human_judgment: true
  - id: D6
    description: "A failed station list renders as a failure with a retry, never as an empty picker"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "#renders a failed station list as a failure with a retry, never as an empty picker"
        status: pass
      - kind: manual
        ref: "observed for real during the proof run while pos-service was restarting — the field showed the failure and no summary, exactly as designed"
        status: pass
    human_judgment: true

duration: 71min
completed: 2026-08-12
status: complete
---

# Phase 28 Plan 11: The capacity the user said was missing — Summary

**An administrator can now choose a person's stations in the same dialog where they choose the branch and the role, and that choice reaches the database, the access token and the kitchen's board — proven in a real browser, not asserted.**

The user's words this plan exists for: *"they should be able to add specific screen (or station) or
dedicated POS which should be selecting respective menu … don't have the exact capacity to select
the specific screen/station for that account he is creating."*

## Performance

- **Duration:** ~71 min
- **Tasks:** 2 of 2
- **Files modified:** 10 (3 created, 7 modified)
- **Commits:** `2fbe349e`, `2988534c`, `067f0b50`

## The copy, verbatim — plan 28-14 asserts these

```
test id: station-assignment-field           the checkbox list, one row per ACTIVE station
test id: station-assignment-summary         "They will see every station in this branch."
                                            "They will see Main bar only."
                                            "They will see Main bar and Hot line only."
test id: station-assignment-delay-notice    "If they are already signed in, the change reaches them
                                             when their session next refreshes — within 15 minutes,
                                             or straight away if they sign out and back in."
test id: station-assignment-cross-branch    "Stations are listed for the branch you are signed in
                                             to. Switch to <branch> to choose its stations…"
test id: user-station-scope                 the detail panel section; unassigned reads
                                            "Sees every station in every branch they work."
```

The summary sentence is **plain muted text and carries no `role="alert"`**, and a test asserts the
absence. That is the single most consequential decision in this plan: every user in every tenant is
unassigned today, so the empty state is the product's universal default. A form that presented it
as a problem would have administrators ticking boxes to fix nothing and narrowing working kitchens
into screens nobody is watching.

## What was proven in a browser

Signed in as `admin@terrace.local` at `floating-terrace`, against the live gateway. Screenshots in
`screenshots/`.

| Step | Result |
|---|---|
| `/app/stations` reachable from the sidebar | ✅ — the nav shows **Stations** and **POS Terminals** |
| Create a BAR station, typing the code as `bar` | ✅ stored as `BAR` — the normalisation from 28-06 holds |
| Create a KITCHEN station `GRILL` | ✅ |
| The user dialog offers a **Stations** field below Role | ✅ `04-user-form-station-picker.png` |
| Nothing ticked | ✅ *"They will see every station in this branch."* |
| Tick **Main bar** | ✅ *"They will see Main bar only."* — `05-user-form-bar-selected.png` |
| The delay notice | ✅ read back verbatim |
| Create the account | ✅ `06-account-created.png` |
| The detail panel, without opening an editor | ✅ **Stations → Floating Terrace HQ → Main bar** (`07-user-detail-stations.png`) |
| `GET /api/v1/users/{id}/stations` | ✅ `[{branchId: …, stationCodes: ["BAR"]}]` |
| That account's own access token | ✅ `attributes: {"stations": ["BAR"]}` |
| `GET /api/v1/kitchen/kds/stations` as that account vs. an unassigned kitchen account | ✅ different sets — the bartender's is narrower; the unassigned account still sees everything |

### What was NOT proven, stated plainly

The bartender's KDS station list came back **empty**, not "the bar tile only". That is correct
behaviour and not a defect: `kds_stations` is a **projection**, and a station only gets a row there
once a ticket has been fired to it. No bar item has ever been fired at this branch because routing a
menu item to a station is **plan 28-10's screen, which is not built**. So the differential is
proven — the scope demonstrably filters, and the unassigned account is demonstrably unaffected — but
"the bartender sees bar tickets and the cook does not" needs 28-10 plus an order that spans both,
which is 28-14's job.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] The Branch field had no accessible name**
- **Found during:** Task 2
- **Issue:** `<FormLabel>Branch</FormLabel>` generates `htmlFor` from the `FormItem`'s id, but the `<select>` beneath it carries a hardcoded `id="create-user-branch"` that overrides it. The label therefore pointed at nothing: `getByLabelText("Branch")` finds no control, and neither does a screen reader.
- **Fix:** `htmlFor="create-user-branch"` on the label — the same fix the Role label beside it already had.
- **Files modified:** `frontend/components/users/user-form-dialog.tsx`
- **Commit:** `2988534c`

**2. [Rule 2 — Missing critical functionality] Cross-branch stations cannot be listed at all**
- **Found during:** Task 2
- **Issue:** The plan assumes the picker follows whichever branch is chosen. `StationServiceImpl.requireOwnBranch` refuses a `branchId` that is not the caller's JWT branch with 403, so the list for any other branch cannot be fetched.
- **Fix:** The field renders for any chosen branch (the plan's gating rule is kept) but shows a named notice for a branch other than the signed-in one, saying which branch it can offer and that the assignment can be set later. The alternative — a picker that 403s — would look like a defect and teach an admin to distrust the screen.
- **Files modified:** `frontend/components/users/station-assignment-field.tsx`
- **Commit:** `2988534c`

**3. [Rule 3 — Blocking] `form.watch()` and `setState` in an effect both fail the lint gate**
- `form.watch()` returns a function the React Compiler cannot memoize (it skips compiling the whole component); replaced with `useWatch`. The edit dialog's seed-from-query effect was replaced with a read-through `pendingCodes ?? serverCodes`, which is also strictly better behaviour — no empty flash, and no chance of an untouched editor clearing a scope on save.

### Blocked and worked around — NOT this plan's

The live-stack verification could not run at first: **six services were running code that was not on
disk** (`scripts/check-stale-jars.sh`: auth 56m, user 46m, pos 10m, plus crm, file, reporting). A
stale user-service answered every `POST /api/v1/users` with a 503 whose real cause was masked by
`NoClassDefFoundError: ch.qos.logback.classic.spi.ThrowableProxy` — the signature of a JVM reading a
jar that was replaced underneath it. auth-service, user-service and pos-service were restarted;
crm, file and reporting were left alone. See `deferred-items.md` §3 and §4.

pos-service could not simply be restarted, because **its working tree does not boot**: an
uncommitted `PrintAgentCredentialFilter` creates a bean cycle with `PrintAgentEnrolmentService` and
a modified `PosSecurityConfig`. It was rebuilt from a clean detached worktree at `HEAD` instead, so
nobody's in-flight source was touched. Recorded in `deferred-items.md` §4 — it belongs to whoever
owns phase 26's print agent.

## Known Stubs

None. Every control on both surfaces calls a real endpoint, and the write path was driven end to end
against the live stack.

## Threat Flags

None beyond the plan's own register. No new endpoint, no new package, no new trust boundary — a
browser client for two endpoints 28-01 already shipped and already gated.

## Self-Check: PASSED

All three created files present; all three commits (`2fbe349e`, `2988534c`, `067f0b50`) resolve in
`git log`.

## Verification

| Check | Result |
|---|---|
| `__tests__/pos/user-station-assignment.test.tsx` | 19/19 pass (5 client-layer, 12 form, 2 detail panel) |
| Existing `__tests__/users/**` — unmodified | pass |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every file this plan touched | 0 errors, 0 warnings |
| Full frontend unit suite | 1033/1035 pass |
| Real browser, live gateway | the table above |

The two failing tests are in `__tests__/components/state-character.test.tsx`, an **untracked** file
another agent added while this plan was executing; it fails on `globals.css: --sm is not defined in
scope dark`, a token that does not exist yet. No file this plan touched is involved. Recorded in
`deferred-items.md` §5.
