---
phase: 28-station-pos-profiles
plan: 06
subsystem: frontend
tags: [stations, catalogue, react-query, nav, layer-boundary]

requires:
  - phase: 28-station-pos-profiles
    provides: "28-02's StationDto (stationType + displayFamily) and the five-value enum"
  - phase: 19b
    provides: "the dining-table catalogue screen this one mirrors — retire-not-delete, error-before-empty, permission-driven action hiding"
provides:
  - "apiStationSchema / createStationInputSchema / updateStationInputSchema in pos.schema.ts"
  - "Station, StationType, StationDisplayFamily in pos.model.ts"
  - "adaptStation — absent or unknown type degrades to KITCHEN, never throws"
  - "PosRepository.getStations / createStation / updateStation / retireStation"
  - "useStations (active only) and useStationCatalogue (retired included), stationKeys"
  - "/app/stations — the station catalogue screen"
  - "Nav entries for BOTH Stations and POS Terminals (/app/terminals)"
affects: [28-09, 28-10, 28-11, 28-13, 28-14]

tech-stack:
  added: []
  patterns:
    - "A wire enum is typed as a tolerant string in the SCHEMA and narrowed in the ADAPTER, so an unknown value is a mislabel rather than a parse failure that empties the list"
    - "A shared registry that another agent has dirty is not edited; the keys live locally with the reason recorded, following userKeys"

key-files:
  created:
    - frontend/lib/hooks/pos/use-station-admin.ts
    - frontend/components/stations/station-type-select.tsx
    - frontend/components/stations/station-form-dialog.tsx
    - frontend/components/stations/station-list.tsx
    - frontend/app/(tenant)/app/stations/page.tsx
    - frontend/__tests__/pos/station-admin.test.tsx
    - frontend/lib/adapters/__tests__/station.adapter.test.ts
  modified:
    - frontend/lib/api-client/schemas/pos.schema.ts
    - frontend/lib/models/pos.model.ts
    - frontend/lib/adapters/pos.adapter.ts
    - frontend/lib/repositories/pos.repository.ts
    - frontend/components/shared/sidebar-nav-items.ts
    - frontend/__tests__/shared/nav-permission-matrix.test.tsx

key-decisions:
  - "The station CODE is upper-cased on the way in. auth-service upper-cases a user's assignment codes (StationAssignmentAdminService) and pos-service stores a station's code verbatim; the KDS scope compares the two with an `IN`. A station created as `bar` would therefore never match an assignment stored as `BAR`, and the only symptom would be a bartender with a permanently empty board and nothing in any log. Normalising in the browser removes the mismatch for every station this product will now create."
  - "`stationType` is a plain string in the Zod schema and an enum only after the adapter. A `z.enum` on the wire would turn a sixth station type — or a rolling deploy — into a parse failure, and a parse failure on a LIST response empties the whole screen. The tolerance is asserted by two named tests so it is not later 'tightened' into an outage."
  - "Retired stations are filtered CLIENT-side because `GET /api/v1/pos/stations` has no `includeInactive` parameter and never has. The plan assumed symmetry with `/pos/tables`, which does have one. Sending a parameter the server does not declare would have been silently ignored rather than refused, so the filter is where it can actually be relied on."
  - "Restore goes through `PUT` with `active: true`, retire through `DELETE`. pos-service exposes no reactivate endpoint, so the two spellings are hidden behind one `useSetStationActive` hook rather than leaving each caller to know which verb is which."
  - "The nav entry is gated on `pos.menu.manage`, not `pos.menu.view`. The list is readable with the weaker code, but every action on the screen is gated on the stronger one, and a nav entry to a screen whose every control 403s is worse than no entry."
  - "Both nav entries — Stations AND POS Terminals — were added in this plan's single edit, as the plan directed, so 28-09 never opens the shared registry. Phase 19b had two agents in one wave on this exact file."

patterns-established:
  - "The empty-vs-error rule is asserted by its own named behaviour on every catalogue screen, not inherited from QueryBoundary and assumed"

requirements-completed: [P28-SC3, P28-SC6]

coverage:
  - id: D1
    description: "A tenant admin can create, rename, retype, retire and restore a station entirely from the UI, with no curl and no SQL"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "__tests__/pos/station-admin.test.tsx — lists, creates (conflict path), retires with confirmation, restores via the show-retired toggle"
        status: pass
      - kind: manual
        ref: "browser: a BAR station and a KITCHEN station created as TENANT_ADMIN at http://localhost:3000/app/stations — screenshots/01..03; the code was typed as `bar` and stored as `BAR`, so the normalisation holds end to end"
        status: pass
    human_judgment: true
  - id: D2
    description: "A station's type is chosen from a fixed control, never typed"
    requirement: P28-SC3
    verification:
      - kind: unit
        ref: "station-admin.test.tsx#offers the type as a fixed set of options that cannot be typed into freely — asserts the control is a SELECT and enumerates its five values"
        status: pass
    human_judgment: false
  - id: D3
    description: "A failed station load renders as a failure with a retry, never as 'no stations configured'"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "station-admin.test.tsx#renders the FAILURE state with a retry, and never the empty state, when the request fails"
        status: pass
    human_judgment: false
  - id: D4
    description: "There is no delete affordance anywhere on the screen, and a user without the managing permission sees the list and no actions"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "station-admin.test.tsx#offers no delete control anywhere on the screen, #shows the list but no management actions…, #is still refused by the server when the hidden action is reached another way"
        status: pass
    human_judgment: false
  - id: D5
    description: "The navigation carries an entry for Stations and an entry for Terminals, gated so a cashier sees neither"
    requirement: P28-SC6
    verification:
      - kind: unit
        ref: "station-admin.test.tsx#registers a Stations entry and a POS Terminals entry; nav-permission-matrix.test.tsx 11/11 — the OWNER/TENANT_ADMIN/MANAGER sets gain both, the ACCOUNTANT/CASHIER/KITCHEN_STAFF sets gain neither"
        status: pass
    human_judgment: false

duration: 38min
completed: 2026-08-12
status: complete
---

# Phase 28 Plan 06: The station CRUD gets a user — Summary

**`/api/v1/pos/stations` has had complete CRUD since phase 3 and, until this plan, zero frontend callers — creating a station required curl. It now has a screen, a fixed type control, and a nav entry, which is the first two steps of this phase's definition of done.**

## Performance

- **Duration:** ~38 min
- **Tasks:** 2 of 2
- **Files modified:** 13 (7 created, 6 modified)
- **Commits:** `e36edd9a`, `2453223f`

## The contract, for plans 28-09, 28-10, 28-11 and 28-13

```ts
// hooks — frontend/lib/hooks/pos/use-station-admin.ts
useStations()           // ACTIVE stations at the signed-in branch. What a picker offers.
useStationCatalogue()   // every station including retired. What the catalogue screen shows.
useCreateStation() / useUpdateStation() / useSetStationActive()

// query keys (local, NOT in query-keys.ts — see below)
stationKeys.all(branchId)        // ["pos", branchId, "stations"]
stationKeys.catalogue(branchId)  // ["pos", branchId, "stations", "catalogue"]  — a CHILD, so
                                 // invalidating `all` refreshes both

// model — frontend/lib/models/pos.model.ts
Station { id, branchId, code, name, stationType, displayFamily, active }
StationType          = "KITCHEN" | "BAR" | "PANTRY" | "EXPO" | "DESSERT"
StationDisplayFamily = "KITCHEN" | "BAR" | "EXPO"

// route registered in the nav by THIS plan, built by 28-09
/app/terminals   permission: pos.terminals.admin
```

`STATION_TYPE_OPTIONS` and `stationTypeLabel()` are exported from
`components/stations/station-type-select.tsx` — plan 28-09's station-set picker and plan 28-10's
routing picker should reuse them rather than re-listing the five values.

## Accomplishments

- **The station code is normalised, and that is a real bug closed rather than a nicety.** auth-service upper-cases a user's assignment codes; pos-service stores a station's code exactly as typed; kitchen-service compares the two with an `IN` clause. A station created as `bar` and assigned as `bar` would have been stored as `BAR` on the assignment and `bar` on the station, matched nothing, and presented as a bartender whose board is permanently empty — with no error anywhere in the stack. The form upper-cases on keystroke and the schema upper-cases again on the way out, so both the display and the payload agree.
- **Tolerance is in the adapter, not the schema, and it is tested.** `stationType` crosses the wire as a string; `adaptStation` narrows it and maps anything absent or unrecognised to `KITCHEN` — which is what every station in the product already is (V14's `DEFAULT 'KITCHEN'`). Two named tests cover absent and unknown. A `z.enum` here would have made a rolling deploy blank the catalogue screen, and an empty catalogue reads as "you have no stations" rather than as version skew.
- **Error before empty, asserted rather than inherited.** The failure case has its own behaviour that forces a 500 and asserts both the error notice *and* the absence of "No stations yet". This screen's entire job is to answer "which stations exist"; answering it wrongly during an outage is GA-001 exactly.
- **Both nav entries in one edit.** Stations and POS Terminals were registered together, as the plan directed, so plan 28-09 never opens `sidebar-nav-items.ts`. `nav-permission-matrix.test.tsx` — the regression gate that freezes what each role sees — was updated in the same commit: `pos.terminals.admin` joins the OWNER/TENANT_ADMIN/MANAGER fixtures (28-01 grants it to exactly those three) and is absent from ACCOUNTANT, CASHIER and KITCHEN_STAFF, which is what makes the gate an assertion rather than a listing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `GET /api/v1/pos/stations` has no `includeInactive` parameter**
- **Found during:** Task 1
- **Issue:** The plan's behaviour "the list hook requests only active stations by default / retired only when asked" assumes symmetry with `/api/v1/pos/tables`, which takes `includeInactive`. `StationController.listStations` takes only `branchId` and an optional `stationType`, and `StationServiceImpl` returns every row for the branch regardless of `active`.
- **Fix:** Two hooks over one request — `useStations` applies a TanStack `select` that filters to active, `useStationCatalogue` does not. Sending an undeclared query parameter would have been silently ignored by Spring rather than refused, which is the worse failure: the screen would look filtered and not be.
- **Files modified:** `frontend/lib/hooks/pos/use-station-admin.ts`
- **Commit:** `e36edd9a`

**2. [Rule 2 — Missing critical functionality] The station code was not normalised anywhere in the stack**
- **Found during:** Task 2
- **Issue:** Described above — auth-service upper-cases assignment codes, pos-service does not upper-case station codes, and the KDS station scope compares them exactly.
- **Fix:** Upper-cased in the form control and again in `createStationInputSchema`, with the reason written at both sites. A character-class check refuses spaces and punctuation for the same reason.
- **Files modified:** `frontend/lib/api-client/schemas/pos.schema.ts`, `frontend/components/stations/station-form-dialog.tsx`
- **Commits:** `e36edd9a`, `2453223f`

**3. [Expected consequence] `nav-permission-matrix.test.tsx` needed updating**
- Two new nav entries change the frozen per-role sets that test exists to freeze. Updated deliberately, with `pos.terminals.admin` added to the three fixtures that hold it, so the new entries are gate-tested rather than merely listed.

### Deliberate skip

`frontend/lib/hooks/query-keys.ts` was **not** touched: `git status` showed it dirty with another
agent's six uncommitted lines, and committing it by path would have swept them into this plan's
commit. `stationKeys` lives in the hook module instead, following the precedent `userKeys` and
`use-inventory.ts` already set, with the reason recorded in the file.

## Known Stubs

None. Every control on this screen calls a real endpoint that pos-service has served since phase 3.

## Threat Flags

None. No new endpoint, no new package, no new trust boundary — a browser client for endpoints that
already existed and are already gated.

## Self-Check: PASSED

All seven created files present on disk; both commits (`e36edd9a`, `2453223f`) resolve in `git log`.

## Verification

| Check | Result |
|---|---|
| `lib/adapters/__tests__/station.adapter.test.ts` | 5/5 pass |
| `__tests__/pos/station-admin.test.tsx` | 10/10 pass |
| `__tests__/shared/nav-permission-matrix.test.tsx` | 11/11 pass |
| `npx tsc --noEmit` | clean |
| `npx eslint` on every file this plan touched | 0 errors, 0 warnings |
| Full frontend unit suite | 972/972 pass, 99 files |

`npx eslint .` across the whole tree reports 11 warnings, all in files this plan did not touch
(`components/ui/data-table.tsx`, five inventory dialogs, two purchasing dialogs, two test/e2e
files). Pre-existing and out of scope; recorded in `deferred-items.md` §6.

**Browser check (done, not deferred):** signed in as `admin@terrace.local` against the live
gateway, `/app/stations` rendered from the sidebar, two stations were created through the form —
`BAR / Main bar / Bar` and `GRILL / Hot line / Kitchen` — and both read back through
`GET /api/v1/pos/stations` with the codes upper-cased. Screenshots `01-stations-empty.png`,
`02-station-form.png`, `03-stations-created.png`. Note that the run required restarting three
services whose jars had been rebuilt underneath them; see `deferred-items.md` §3.
