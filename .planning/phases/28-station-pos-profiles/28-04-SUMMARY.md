---
phase: 28-station-pos-profiles
plan: 04
subsystem: api
tags: [flyway, rls, pos, terminals, permissions, crud]

requires:
  - phase: 28-station-pos-profiles
    provides: "28-01's pos.terminals.admin permission; 28-02's typed stations"
  - phase: 19b
    provides: "the catalogue-vs-runtime permission split and the gate-inside-the-service pattern"
provides:
  - "pos_terminals, pos_terminal_categories, pos_terminal_stations — all ENABLEd AND FORCEd from their first migration"
  - "PosTerminal / PosTerminalCategory / PosTerminalStation / ServiceModel"
  - "PosTerminalService(Impl) and PosTerminalController — list, get, create, update, deactivate, reactivate"
  - "PosAuthorizationService.requireTerminalsAdmin()"
  - "The empty-means-everything contract, with a test that forbids a flag being added later"
affects: [28-09, 28-12, 28-13, 28-14]

tech-stack:
  added: []
  patterns:
    - "A scope set has THREE states on update: null (leave alone), empty (everything), populated (exactly these)"
    - "Scope validation is all-or-nothing before any write — a partial application leaves the admin's screen disagreeing with the database"
    - "A prohibition is enforced by a test that queries information_schema, not by a comment"

key-files:
  created:
    - services/pos-service/src/main/resources/db/migration/V15__pos_terminals.sql
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/PosTerminal.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/PosTerminalCategory.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/PosTerminalStation.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/ServiceModel.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/PosTerminalServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/PosTerminalController.java
    - services/pos-service/src/test/java/io/restaurantos/pos/PosTerminalAdminIT.java
  modified:
    - services/pos-service/src/main/java/io/restaurantos/pos/authz/PosAuthorizationService.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/MenuCategoryRepository.java

key-decisions:
  - "Empty scope is the ONLY encoding of 'everything', and there is a test asserting no serves_all-shaped column exists. A flag and the rows it summarises can disagree; on the day they do, one is wrong and no reader can tell which."
  - "On UPDATE a null scope list means 'leave it alone' while an empty list means 'offer everything'. Both spellings are needed — a rename-only update that widened a bar terminal to the whole card would be a silent misconfiguration."
  - "The category scope is a menu FILTER. Nothing reads it to refuse an add-item, and the DDL, the entity and the controller all say so, because a half-enforced guard is worse than a declared filter."
  - "includeInactive is gated inside the service. A controller annotation would have to name the WEAKER permission for a cashier's terminal picker to keep working, which leaves the flag itself as an unguarded escalation — 19b's exact finding."
  - "The terminal code is immutable and is not on the update request. A device remembers which terminal it is by that handle; renaming it would silently re-point every screen that stored it."
  - "printer_ref is an opaque nullable string. Thermal printing is phase 26's and it owns the identifier scheme; modelling an address here would duplicate or contradict that."

patterns-established:
  - "Every new tenant table gets tenant_isolation + ENABLE + FORCE in its OWN migration, never deferred to a sweep"
  - "A uniqueness rule is asserted twice — once as a clean service-level conflict, once as a raw INSERT the database refuses"

requirements-completed: [P28-SC1, P28-SC6]

coverage:
  - id: D1
    description: "A POS terminal is a named, coded, branch-scoped profile a tenant admin can create, rename, re-scope, retire and restore"
    requirement: P28-SC1
    verification:
      - kind: integration
        ref: "PosTerminalAdminIT#aTerminalPersistsAndReadsBackUnchanged, #anAdminRenamesRetypesAndReplacesBothScopes, #aTerminalIsDeactivatedAndReactivated_andThereIsNoDelete"
        status: pass
    human_judgment: false
  - id: D2
    description: "A terminal with NO category rows offers the whole menu; with no station rows it fires to every station"
    requirement: P28-SC1
    verification:
      - kind: integration
        ref: "PosTerminalAdminIT#aTerminalWithNoCategoryRows_offersTheWholeMenu, #aTerminalWithNoStationRows_firesToEveryStation, #replacingTheCategorySetWithAnEmptySet_returnsTheTerminalToOfferingEverything, #noServesAllFlagExistsAnywhereInTheSchemaOrTheEntity"
        status: pass
    human_judgment: false
  - id: D3
    description: "A category from another tenant and a station from another branch are both refused, and a partially-valid scope is rejected wholesale"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "PosTerminalAdminIT#aForeignTenantsCategory_isRefused, #aStationFromAnotherBranch_isRefused, #aPartiallyValidScopeIsRejectedWholesale_leavingNothingHalfApplied"
        status: pass
    human_judgment: false
  - id: D4
    description: "Writes and the retired-terminal view require pos.terminals.admin; the ordinary read does not; a foreign branch is refused"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "PosTerminalAdminIT#aCallerWithoutTheTerminalPermission_isRefusedEveryWriteAndTheRetiredView, #aCallerFromAnotherBranch_isRefused"
        status: pass
      - kind: unit
        ref: "auth-service PermissionCatalogClosureTest — proves pos.terminals.admin is defined and held"
        status: pass
    human_judgment: false
  - id: D5
    description: "All three tables are tenant-isolated for real — ENABLEd AND FORCEd — without modifying the invariant test"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "RlsForcedInvariantIT 3/3, unmodified; PosTerminalAdminIT#everyFinderReturnsNothingForATenantThatDoesNotOwnTheRow_evenWithThePolicyInert"
        status: pass
    human_judgment: false

duration: 41min
completed: 2026-08-11
status: complete
---

# Phase 28 Plan 04: The POS terminal profile — Summary

**A POS terminal is now a first-class row — a name, a code, a branch, the stations it fires to and the categories it offers — created and scoped entirely over HTTP behind its own permission, with "no scope rows" meaning *everything* so that a tenant who never opens the screen keeps today's behaviour byte for byte.**

## Performance

- **Duration:** ~41 min
- **Tasks:** 2 of 2
- **Files modified:** 17 (15 created, 2 modified)
- **Commits:** `5b2a1199`

## The contract, for plans 28-09, 28-12 and 28-13

```
POST   /api/v1/pos/terminals?branchId=                  pos.terminals.admin
PUT    /api/v1/pos/terminals/{id}?branchId=             pos.terminals.admin
POST   /api/v1/pos/terminals/{id}/deactivate            pos.terminals.admin
POST   /api/v1/pos/terminals/{id}/reactivate            pos.terminals.admin
GET    /api/v1/pos/terminals?branchId=&includeInactive= pos.menu.view | pos.kds.view | pos.terminals.admin
GET    /api/v1/pos/terminals/{id}?branchId=             (same)
```

`PosTerminalDto` carries `categoryIds`, `stationIds` **and** the derived `offersWholeMenu` / `firesToAllStations` booleans — so plan 28-09 can render "offers the whole menu" in those words rather than showing an empty list an admin has to interpret, and plan 28-13 can filter without re-deriving the rule.

`ServiceModel`: `COUNTER` | `TABLE_SERVICE` | `SELF_SERVE`. Not a security control; its javadoc says so.

## Accomplishments

- **Empty means everything, and a test now forbids the "fix".** `noServesAllFlagExistsAnywhereInTheSchemaOrTheEntity` queries `information_schema.columns` for anything shaped like `serves_all`, `all_categories` **or `requires_till`** and asserts zero. The first two protect the empty-means-all rule from a later reader who finds it ambiguous; the third makes D-28-06's cash-till prohibition enforceable rather than merely written down.
- **Three states on update, not two.** `null` scope = leave alone; `[]` = offer everything; populated = exactly these. Without the distinction, a rename-only PUT would silently widen a bar terminal to the whole card. Its own named test.
- **Scope writes are all-or-nothing.** Every category and station id is validated *before any row is written*, and the test asserts the database is untouched after a submission whose second id is bogus. An admin who submitted one intention must not receive half of it — no error message repairs that.
- **The isolation is real, and the test that proves it does not need the policy.** All three tables get `tenant_isolation` + `ENABLE` + `FORCE` in this migration rather than a later sweep, and `RlsForcedInvariantIT` passes **unmodified**. Because Testcontainers runs as a superuser (so the policy is inert in CI), every repository finder also carries an explicit tenant predicate, and a test drives a foreign tenant through the service to prove the predicate alone holds.

## What this plan deliberately did not do

`OrderServiceImpl` untouched. `till_sessions` untouched. No `requires_till`, no order attribution, no device pairing, **no DELETE mapping** — the last one is stated in the controller javadoc with its reason so the omission is not read as an oversight.

## Deviations from Plan

**1. [Rule 3 — Blocking] Migration number.** The plan names `V14__pos_terminals.sql`; V14 is this phase's own `station_type` (28-02, itself displaced from V13 by phase 26's `print_jobs`). This is **`V15__pos_terminals.sql`**. 28-05 and 28-12 shift correspondingly.

**2. [Rule 2 — Missing critical functionality] `MenuCategoryRepository` had no tenant-scoped finder.** Validating a category id "inside the caller's tenant" was not expressible. Added `findByIdAndTenantId`, with the same explicit-predicate reasoning the other repositories in this phase carry.

**3. [Addition beyond the plan] `PosTerminalStationRepository`.** The plan's file list names only the terminal and category repositories, but `pos_terminal_stations` needs one too and the station scope is half of D-28-03. Created with the same shape.

## Threat Flags

None beyond the plan's register. New endpoints are gated by a permission that already exists and is held; no new trust boundary; no new package.

## Self-Check: PASSED

All 15 created files present; commit `5b2a1199` resolves.

## Verification

| Check | Result |
|---|---|
| `PosTerminalAdminIT` (10 planned behaviours + 8 task-1 behaviours, 19 tests) | 19/19 pass |
| `RlsForcedInvariantIT` — unmodified | 3/3 pass |
| `StationAdminIT`, `TableCatalogueIT` — unmodified | 17/17 · 16/16 pass |
| pos-service full suite | 184/184 pass |
| auth-service `PermissionCatalogClosureTest` | pass |
| DELETE mappings on `PosTerminalController` | none |
