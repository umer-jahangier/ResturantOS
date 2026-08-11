---
phase: 28-station-pos-profiles
plan: 02
subsystem: database
tags: [flyway, enum, events, kds, projection, rls, stations]

requires:
  - phase: 3-station-routing-refactor
    provides: "the canonical stations table, the kds_stations projection, and the two mirrored event payload records"
  - phase: 17b
    provides: "FORCE row-level security across pos_db and kitchen_db"
provides:
  - "StationType — a closed enum of five values with a three-family display mapping, in pos-service and mirrored in kitchen-service"
  - "stations.station_type and kds_stations.station_type, NOT NULL DEFAULT 'KITCHEN' with a CHECK constraint"
  - "KdsItemPayload.stationType / OrderSentToKdsItem.stationType — one appended field, both sides, one commit"
  - "GET /api/v1/pos/stations?stationType= and GET /api/v1/kitchen/kds/stations?stationType="
  - "StationRepository queries all carry an explicit tenant predicate"
affects: [28-05, 28-06, 28-07, 28-08, 28-09, 28-10, 28-14]

tech-stack:
  added: []
  patterns:
    - "A closed enum is defended twice: in the domain and by a database CHECK, because bean validation does not protect a direct write and a constraint does not give a UI a list"
    - "On a consumer, ABSENT and DEFAULT are different facts and must be representable separately, or a rolling deploy overwrites configuration with a guess"
    - "A back-compat constructor keeps the pre-change call shape compilable, so an additive field does not become a breaking change to every call site"

key-files:
  created:
    - services/pos-service/src/main/resources/db/migration/V14__station_type.sql
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/StationType.java
    - services/kitchen-service/src/main/resources/db/migration/V9__kds_station_type.sql
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/domain/model/StationType.java
    - services/kitchen-service/src/test/java/io/restaurantos/kitchen/StationTypeProjectionIT.java
  modified:
    - services/pos-service/src/main/java/io/restaurantos/pos/domain/model/Station.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/StationDto.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/CreateStationRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/dto/UpdateStationRequest.java
    - services/pos-service/src/main/java/io/restaurantos/pos/repository/StationRepository.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/StationServiceImpl.java
    - services/pos-service/src/main/java/io/restaurantos/pos/web/StationController.java
    - services/pos-service/src/main/java/io/restaurantos/pos/event/PosEventPayloads.java
    - services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/event/KitchenEventPayloads.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/domain/model/KdsStation.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/service/TicketRoutingService.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/web/KdsController.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/repository/KdsStationRepository.java
    - services/pos-service/src/test/java/io/restaurantos/pos/StationAdminIT.java

key-decisions:
  - "Five values, three display families. D-28-01 locks five and the research argued for three; both are honoured — an operator names and filters their pantry separately from their grill, but inventing five boards would leave three of them empty in most restaurants."
  - "On the CONSUMER, absent and KITCHEN are different facts. StationType.fromWireOrNull returns null for an absent OR unknown value, and upsertStation only promotes when non-null. Collapsing them would let a rolling deploy walk every BAR station back to the cooking board, one fire at a time, silently."
  - "kitchen-service gets its own mirrored StationType rather than sharing pos-service's. The two services do not share a domain module and must not — kitchen has to keep serving its board when pos is down, which is why kds_stations is a projection in the first place. The mirroring obligation is stated on the enum, matching the existing convention on the payload records."
  - "The type is optional on create AND on update. On update, absent means 'leave it alone' — every caller that predates this phase sends only name and active, and silently resetting their types would be the change presenting itself as additive."
  - "Two-argument back-compat constructors were added to CreateStationRequest and UpdateStationRequest rather than rewriting the nine pre-existing StationAdminIT tests, so the pre-existing behaviour is still measured by the pre-existing assertions."

patterns-established:
  - "A default supplied by a MIGRATION is asserted against a row INSERTed without naming the column — going through the service would prove the service's default instead"
  - "Back-compat is asserted by constructing the payload through the OLD constructor, not by trusting that a null trailing field deserialises"

requirements-completed: [P28-SC2]

coverage:
  - id: D1
    description: "A station carries a TYPE drawn from a closed enum, defended by both the domain and a database CHECK constraint"
    requirement: P28-SC2
    verification:
      - kind: integration
        ref: "StationAdminIT#createStation_asBar_readsBackAsBar_onItsOwnDisplayFamily, #theDatabaseRefusesAnOutOfEnumType_soTheConstraintIsRealAndNotOnlyABeanValidationCourtesy"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every station that exists today becomes KITCHEN and nothing about today's routing moves"
    requirement: P28-SC2
    verification:
      - kind: integration
        ref: "StationAdminIT#everyStationRowThatPredatesTheMigration_readsBackAsKitchen; StationTypeProjectionIT#everyProjectionRowThatPredatesTheMigration_readsBackAsKitchen"
        status: pass
      - kind: integration
        ref: "pos-service full suite 165/165; kitchen-service full suite 37/37"
        status: pass
    human_judgment: false
  - id: D3
    description: "The type travels on ORDER_SENT_TO_KDS and lands on the kitchen-service station projection"
    requirement: P28-SC2
    verification:
      - kind: integration
        ref: "StationTypeProjectionIT#firingABarItem_producesAProjectionRowTypedBar, #aPlaceholderProjectionRow_isPromotedOnTheNextFire_theSameWayItsNameAlreadyIs"
        status: pass
      - kind: other
        ref: "grep parity check — both records' component lists are identical, 10 fields, same names, same order"
        status: pass
    human_judgment: false
  - id: D4
    description: "A caller can ask kitchen-service (and pos-service) for only the stations of a given type; unfiltered stays the default"
    requirement: P28-SC2
    verification:
      - kind: integration
        ref: "StationAdminIT#listStations_canBeNarrowedToASingleType; KdsStationSeedTableNumberIT (unfiltered call path unchanged)"
        status: pass
    human_judgment: false
  - id: D5
    description: "An ORDER_SENT_TO_KDS message from the pre-change producer is consumed without error and does not downgrade a stored type"
    requirement: P28-SC2
    verification:
      - kind: integration
        ref: "StationTypeProjectionIT#anEventFromThePreChangeProducer_isConsumedWithoutError, #anEventCarryingNoType_leavesAStoredTypeAlone_ratherThanWalkingItBackToKitchen"
        status: pass
    human_judgment: false

duration: 48min
completed: 2026-08-11
status: complete
---

# Phase 28 Plan 02: A typed station, end to end — Summary

**A station now says what kind of destination it is, and that answer travels on the fire event all the way to the projection the board reads — while every station that already existed becomes KITCHEN and nothing about today's routing moves.**

## Performance

- **Duration:** ~48 min
- **Tasks:** 2 of 2
- **Files modified:** 20 (5 created, 15 modified)
- **Commits:** `69097676`, `91742758`

## The enum, verbatim — for plans 28-06, 28-07, 28-09 and 28-10

```java
public enum StationType {
    KITCHEN(DisplayFamily.KITCHEN),   // the hot line — the DEFAULT, and every pre-phase-28 row
    BAR    (DisplayFamily.BAR),       // drinks; its own display
    PANTRY (DisplayFamily.KITCHEN),   // cold prep, salads, sides
    EXPO   (DisplayFamily.EXPO),      // the pass; sees everything
    DESSERT(DisplayFamily.KITCHEN);   // the sweet station
}
public enum DisplayFamily { KITCHEN, BAR, EXPO }
```

`StationDto` carries **both** `stationType` and the derived `displayFamily`, so the browser never re-derives the mapping. A second copy of that table in TypeScript would be a second answer to "does a dessert go to the kitchen screen", and the two would disagree the first time a value was added.

Wire spellings: `station_type` (both databases), `stationType` (both DTOs, both event payload records, both query parameters).

## Accomplishments

- **The type is defended twice.** A closed Java enum *and* a `CHECK (station_type IN (...))` on both tables. Neither alone is sufficient — bean validation does not protect a direct SQL write, and a constraint does not give a UI a list to render. `StationAdminIT` inserts `'bar '` (trailing space, the literal free-text failure mode) through raw SQL and asserts the database refuses it.
- **The default is the entire back-compatibility story, and it is tested as a *migration* property.** Both tests INSERT a row *without naming the column*, so the value comes from the `DEFAULT` clause. Creating one through the service would have proved the service's default and told us nothing about the tenants who already have stations.
- **Both payload records changed in one commit, append-only.** Field-name parity between `PosEventPayloads.KdsItemPayload` and `KitchenEventPayloads.OrderSentToKdsItem` is the *only* contract enforcement between these two services; a mismatch drops every kitchen message with no error at all. Verified afterwards by diffing the two component lists — 10 fields, identical names, identical order.
- **Absent ≠ KITCHEN, on the consumer.** This is the subtle one. `StationType.fromWireOrNull` returns `null` for an absent *or unknown* value, and `upsertStation` promotes only when the value is non-null. During a rolling deploy, instances still on the pre-phase-28 build emit no type; if that were read as `KITCHEN`, every BAR station in every tenant would be walked back to the cooking board one fire at a time, and the only symptom would be drinks appearing on the wrong screen with nothing in any log. It has its own named test.
- **`StationRepository` queries gained an explicit tenant predicate.** `stations` is FORCE RLS since 17b, and under FORCE an unscoped query returns *zero rows* rather than erroring — which presents as "this branch has no stations configured" and gets triaged as a configuration question for a week. The predicate is also the only part of the isolation CI can assert, since Testcontainers runs as a superuser.
- **The board did not move.** Grouping is still by station **code**, still one ticket per order and station; the WebSocket subscription key is untouched. This plan adds an adjective. Asserted explicitly rather than assumed.

## Deviations from Plan

**1. [Rule 3 — Blocking] The plan names `V13__station_type.sql`; V13 was already taken**
- **Found during:** Task 1
- **Issue:** `V13__print_jobs.sql` landed in phase 26-03 (commit `0c691555`). Flyway would have refused two V13s.
- **Fix:** The pos migration is **`V14__station_type.sql`**. Kitchen's V9 was free and is unchanged from the plan.
- **Consequence for the rest of this phase:** every later pos-service migration number in phase 28 shifts by one — 28-04's terminals become **V15**, 28-05's routes **V16**, 28-12's order attribution **V17**.
- **Commit:** `69097676`

**2. [Rule 3 — Blocking] Two existing call sites would not compile after additive fields**
- **Found during:** Tasks 1 and 2
- **Issue:** `StationAdminIT`'s nine pre-existing tests construct `CreateStationRequest`/`UpdateStationRequest` positionally; `KdsStationSeedTableNumberIT` calls `KdsController.getStations(branchId, claims)`.
- **Fix:** Added two-argument back-compat constructors to both request records (Jackson binds the canonical constructor, so the wire contract is unaffected), which meant **none of the nine pre-existing tests was modified**. The one `getStations` call site was passed an explicit `null` filter with a comment saying why.
- **Commits:** `69097676`, `91742758`

## Threat Flags

None beyond the plan's own register. No new endpoint, no new package, no new trust boundary — two existing endpoints gained an optional filter parameter and two existing tables gained a constrained column.

## Self-Check: PASSED

All five created files present; both commits (`69097676`, `91742758`) resolve in `git log`.

## Verification

| Check | Result |
|---|---|
| `StationAdminIT` (9 pre-existing untouched + 8 new) | 17/17 pass |
| `StationTypeProjectionIT` (7 behaviours) | 7/7 pass |
| `StationProjectionRoutingIT`, `TicketRoutingIT`, `TicketRevisionRoutingIT` | pass |
| `RlsForcedInvariantIT` (pos) / (kitchen) | 3/3 · 1/1 pass |
| `KdsWebSocketBranchScopeTest` — untouched by this plan, re-run as a guard | 4/4 pass |
| pos-service full suite | 165/165 pass |
| kitchen-service full suite | 37/37 pass |
| Payload field-name parity, both records | identical, 10 fields |
