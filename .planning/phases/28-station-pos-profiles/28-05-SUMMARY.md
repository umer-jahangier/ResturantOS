---
phase: 28-station-pos-profiles
plan: 05
subsystem: database
tags: [flyway, rls, routing, menu, stations, data-integrity]

requires:
  - phase: 28-station-pos-profiles
    provides: "28-02's typed stations and tenant-scoped StationRepository finders"
  - phase: 3-station-routing-refactor
    provides: "menu_items.station_id, the free-text kds_station mirror, and the add-time snapshot invariant"
provides:
  - "menu_item_station_routes and menu_category_station_routes — destination per (tenant, branch, entity)"
  - "StationRoutingResolver — the ONE place an item's destination is decided, unit-testable without an order"
  - "PUT /api/v1/pos/menu/categories/{id}/station — category-level routing for a branch"
  - "MenuItemDto.effectiveStationId / effectiveStationCode / effectiveStationName"
affects: [28-08, 28-10, 28-14]

tech-stack:
  added: []
  patterns:
    - "A resolution rule lives in one standalone service so its edge cases can be asserted without six layers of setup"
    - "A legacy value is made SAFE (scoped) rather than removed, so the unconfigured path stays byte-identical"

key-files:
  created:
    - services/pos-service/src/main/resources/db/migration/V16__menu_station_routes.sql
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuItemStationRoute.java
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/MenuCategoryStationRoute.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/StationRoutingResolver.java
    - services/pos-service/src/test/java/io/restaurantos/pos/StationRoutingResolverTest.java
    - services/pos-service/src/test/java/io/restaurantos/pos/MenuStationRoutingIT.java
  modified:
    - services/pos-service/src/main/java/io/restaurantos/pos/service/MenuServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/MenuItemDto.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/MenuController.java

key-decisions:
  - "The branch check on the legacy station_id IS the bug fix, not a fallback nicety. A tenant-wide column that applies regardless of branch is how one admin's assignment re-points another branch's routing. With the check, the legacy value stops APPLYING to the wrong branch instead of mis-routing it — the failure mode becomes 'unconfigured' rather than 'wrong kitchen', and only one of those is visible on a screen."
  - "addItem does NOT fall back to menuItem.getStationId() after the resolver returns empty. The resolver already considered that column and deliberately refused it; re-adding it as a fallback would reinstate the cross-branch mis-route one line below the code preventing it."
  - "Category-level routes are not a convenience. 'All drinks go to the bar' is how this is configured in a real restaurant; per-item rows would be two hundred clicks that then drift as items are added. Item-level overrides it, so the exception stays expressible."
  - "The legacy columns are still written, with a comment naming the TWO conditions under which they may be removed (no consumer reads kds_station; a migration has backfilled per-branch routes). Otherwise they become permanent by forgetting."
  - "Clearing an assignment clears only THIS BRANCH's route and deliberately does not clear the shared legacy column — clearing it would do to the other branches exactly what this plan exists to stop."

patterns-established:
  - "A two-branch independence claim is asserted in BOTH directions — asserting only that B changed proves nothing about whether A moved, and A moving is the bug"
  - "Snapshot invariants are asserted by reading the stored columns with SQL, which is a more direct statement of the claim than walking an entity graph"

requirements-completed: [P28-SC3]

coverage:
  - id: D1
    description: "A tenant-scoped menu item routes to a different station in each branch, and neither branch's assignment disturbs the other"
    requirement: P28-SC3
    verification:
      - kind: unit
        ref: "StationRoutingResolverTest#twoBranchesRouteTheSameItemIndependently_andNeitherDisturbsTheOther"
        status: pass
      - kind: integration
        ref: "MenuStationRoutingIT#assigningAtBranchB_leavesBranchAsRoutingExactlyWhereItWas"
        status: pass
    human_judgment: false
  - id: D2
    description: "A category-level route exists, so 'everything in Drinks goes to the bar' is one row; an item-level route overrides it"
    requirement: P28-SC3
    verification:
      - kind: unit
        ref: "StationRoutingResolverTest#anItemWithNoItemRoute_fallsToItsCategorysRouteForThisBranch, #anItemLevelRouteWinsOverTheCategoryRouteForTheSameBranch"
        status: pass
      - kind: integration
        ref: "MenuStationRoutingIT#aCategoryRouteRoutesEveryItemInItThatHasNoItemLevelRoute, #clearingAnAssignmentFallsThroughToTheCategoryRoute"
        status: pass
    human_judgment: false
  - id: D3
    description: "One resolver decides an item's station and is unit-testable without an order"
    requirement: P28-SC3
    verification:
      - kind: unit
        ref: "StationRoutingResolverTest — 9 tests, no Spring context, no order, no HTTP"
        status: pass
    human_judgment: false
  - id: D4
    description: "A tenant who configures no routes gets byte-identical behaviour to today, and the add-time snapshot invariant is intact"
    requirement: P28-SC3
    verification:
      - kind: integration
        ref: "MenuStationRoutingIT#anItemWithNoRouteAnywhere_behavesExactlyAsItAlwaysHas, #aRouteChangedAfterALineWasAdded_doesNotReRouteThatLine, #aRouteChangedAfterALineWasAdded_doesApplyToTheNextLineAddedToTheSameOrder"
        status: pass
      - kind: integration
        ref: "pos-service full suite 193/193 — no order, fire or menu test modified"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-08-12
status: complete
---

# Phase 28 Plan 05: Per-branch routing, and a shipped data bug closed — Summary

**An item's destination is now a per-branch fact decided by one resolver — and the tenant-wide `station_id` that let a manager at one branch silently re-point another branch's dish can no longer answer for a branch it does not belong to.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 of 2
- **Files modified:** 13 (7 created, 6 modified)
- **Commits:** `9eb8f81c`

## The resolution order, for plans 28-08, 28-10 and 28-14

```
1. menu_item_station_routes     (tenant, branch, item)      most specific wins
2. menu_category_station_routes (tenant, branch, category)  "all drinks go to the bar"
3. menu_items.station_id        ONLY IF that station is in THIS branch   ← the fix
4. menu_items.kds_station       matched against a code in THIS branch
5. nothing                      → caller renders DEFAULT, exactly as today
```

`MenuItemDto` now carries `effectiveStationId` / `effectiveStationCode` / `effectiveStationName` for the requested branch, so 28-10's picker can show what a dish currently does without reimplementing steps 1–5 in TypeScript.

New endpoint: `PUT /api/v1/pos/menu/categories/{id}/station?branchId=` body `{stationId}` (null clears), gated `pos.menu.manage`.

## The bug, and why it was invisible

`menu_items` has **no branch** — it hangs off a tenant-unique category. A two-branch tenant has one row for "Chicken Karahi" and one `station_id` on it. An admin at Branch B assigning it to B's grill silently re-pointed the same dish for Branch A *and* overwrote the free-text mirror with B's code, after which A's tickets routed to a code that may not exist there and fell through to DEFAULT.

Each write passed its own branch guard. Nothing guarded against **the last writer winning across branches**, because the row was not branch-scoped in the first place. `V7__stations.sql` names this in its own comment and defers it. It has bitten nobody only because no UI calls the endpoint — the feature being dead is the sole reason the bug is invisible, and plan 28-10 is about to build that UI.

## Accomplishments

- **Step 3's branch predicate is the fix, and it changes the failure mode rather than adding a guard.** The legacy value stops *applying* to the wrong branch instead of mis-routing it. Branch A falls through to DEFAULT — which is where an unconfigured item was always going to land — instead of firing biryani at a grill in another building. "Unconfigured" is recoverable by looking at a screen; "wrong kitchen" is not.
- **The near-miss worth recording.** The first version of `addItem` ended `…orElseGet(menuItem::getStationId)`. That single fallback would have reinstated the exact cross-branch mis-route *one line below* the resolver that refuses it, and every test in `StationRoutingResolverTest` would still have passed because the resolver itself was correct. It is now `orElse(null)` with a comment saying why.
- **The snapshot invariant survived the edit intact,** and now has two tests that exist solely to fail if resolution ever moves to fire time: a line already on the grill does not jump to the tandoor because a manager edited a menu, while the *next* line added to the same order does carry the new destination.
- **`sendToKds` was not touched.** It already resolves the canonical code from the snapshot with the right fallbacks; changing the fire path to achieve a routing change would have put a second resolution rule in the system.
- **The resolver is a standalone service with no Spring context in its test.** Nine behaviours, mocked repositories, no order, no HTTP. A routing rule reachable only through `addItem` is one whose edge cases get asserted through six layers of setup, which is how they stop being asserted.

## Deviations from Plan

**1. [Rule 3 — Blocking] Migration number.** Plan names `V15__menu_station_routes.sql`; V15 is 28-04's `pos_terminals`. This is **`V16`**.

**2. [Rule 1 — Bug, caught in review of my own edit] The `addItem` legacy fallback.** Described above; fixed before the first test run.

**3. [Addition beyond the plan] `MenuService.assignCategoryStation` and its controller endpoint.** The plan's behaviour list requires category-level routing to be reachable ("assigning a category-level route routes every item in that category"), but its file list stops at the repositories. Added, gated identically to item assignment.

## Threat Flags

None beyond the plan's register. One new endpoint on an existing controller behind an existing permission; two new tables, both FORCE-isolated from their first migration.

## Self-Check: PASSED

All seven created files present; commit `9eb8f81c` resolves.

## Verification

| Check | Result |
|---|---|
| `StationRoutingResolverTest` (9 behaviours) | 9/9 pass |
| `MenuStationRoutingIT` (9 behaviours) | 9/9 pass |
| `RlsForcedInvariantIT` — unmodified | 3/3 pass |
| `StationAdminIT`, `PosTerminalAdminIT`, `TableCatalogueIT` | unmodified, pass |
| pos-service full suite | 193/193 pass |
