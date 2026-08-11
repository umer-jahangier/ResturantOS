---
phase: 28-station-pos-profiles
plan: 07
subsystem: auth
tags: [kds, jwt, authorization, websocket, station-scope]

requires:
  - phase: 28-station-pos-profiles
    provides: "28-01's attributes['stations'] claim; 28-03's socket identity checks"
provides:
  - "StationScope — a two-state value type with no accessor that returns an empty collection"
  - "KdsAuthorizationService.resolveStationScope() — one decision, three surfaces"
  - "KdsTicketRepository.findByBranchIdAndStationCodeInAndStatusIn"
  - "Scoped ticket board, scoped station list, scoped WebSocket subscription"
affects: [28-14]

tech-stack:
  added: []
  patterns:
    - "A view filter degrades OPEN on every degenerate input, and says so — the opposite of the authorization posture beside it, deliberately"
    - "The unrestricted state is a distinct type state, not an empty collection, so the dangerous reading is not available to make"
    - "A list refuses by returning empty; a named resource refuses with an error — the asymmetry is about enumeration"

key-files:
  created:
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/authz/StationScope.java
    - services/kitchen-service/src/test/java/io/restaurantos/kitchen/StationScopeIT.java
    - .planning/phases/28-station-pos-profiles/deferred-items.md
  modified:
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/authz/KdsAuthorizationService.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/web/KdsController.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/repository/KdsTicketRepository.java
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/ws/KdsWebSocketHandler.java
    - services/kitchen-service/src/test/java/io/restaurantos/kitchen/KdsWebSocketIsolationIT.java

key-decisions:
  - "Every degenerate input degrades OPEN — absent, empty, wrong type, unparseable. This is deliberately the opposite of the codebase's fail-closed authorization posture, and the reason is written on the type: a station scope is a VIEW filter chosen by a manager, while tenant and branch isolation are the security boundary and are enforced separately and BEFORE it. Getting the filter wrong shows somebody too much of their own branch's board; getting it wrong the other way stops a restaurant from cooking."
  - "StationScope.permittedCodes() THROWS for an unrestricted scope rather than returning an empty set. A caller that reaches it without checking isUnrestricted() is about to build a query with an empty IN clause, and this is the loud version of that mistake."
  - "The ticket LIST returns an empty page for an out-of-scope station; ticket DETAIL refuses. A 403 on the list would let a cook enumerate which stations exist by watching which requests fail; on detail, a specific resource is named and returning it is the actual disclosure."
  - "The station-list scope filter runs AFTER the auto-seed, not before. Filtering first would make a bartender at a kitchen-only branch look like a branch with no stations, and the seed would then write a spurious DEFAULT row into the tenant's database on every screen open."
  - "The socket reads `stations` NESTED under `attributes`, because that is where JwtSigningService actually puts it. A top-level read would find nothing, produce an unrestricted scope for every caller, and look exactly like a working feature."

patterns-established:
  - "The unassigned-user case gets its own named tests on every surface, because it is the regression guard for the entire installed base rather than an edge case"

requirements-completed: [P28-SC6]

coverage:
  - id: D1
    description: "A user assigned to one or more stations sees tickets, station tiles and live pushes for those stations only"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "StationScopeIT#aBartenderAskingForTheBranchWideBoard_receivesBarTicketsOnly, #aKitchenUserAskingForTheBranchWideBoard_doesNotReceiveTheBarTickets, #theStationListReturnsOnlyTheScopedUsersStations"
        status: pass
      - kind: integration
        ref: "KdsWebSocketIsolationIT#aScopedUsersSubscriptionToAStationInsideTheirScope_isAccepted, #aScopedUsersSubscriptionToAStationOutsideTheirScope_isRefusedIdentically"
        status: pass
    human_judgment: false
  - id: D2
    description: "A user assigned to NO station sees every station in their branch, exactly as every user does today"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "StationScopeIT#anUnassignedUser_seesEveryTicketInTheBranch, #anUnassignedUser_seesEveryStation, #anAttributePresentButEmpty_isAlsoUnrestricted, #anAttributeOfAnUnexpectedShape_isUnrestrictedAndDoesNotThrow"
        status: pass
      - kind: integration
        ref: "KdsWebSocketIsolationIT#anUnassignedUsersSubscriptionToAnyStationInTheirOwnBranch_isAccepted, #aScopeAttributeOfTheWrongShape_leavesTheSocketOpenRatherThanBlackingOutTheBoard"
        status: pass
    human_judgment: false
  - id: D3
    description: "The scope is derived from the signed token and never from a request parameter"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "StationScopeIT — every case sets the scope only via JwtClaims.attributes; no endpoint accepts a station scope as input"
        status: pass
    human_judgment: false
  - id: D4
    description: "The tenant and branch checks from 28-03 are not replaced, reordered behind, or weakened by the station check"
    requirement: P28-SC6
    verification:
      - kind: integration
        ref: "KdsWebSocketIsolationIT 12/12 including all seven 28-03 behaviours; ws/KdsWebSocketBranchScopeTest 4/4 untouched; KdsAccessIsolationIT 10/10"
        status: pass
    human_judgment: false

duration: 44min
completed: 2026-08-12
status: complete
---

# Phase 28 Plan 07: The kitchen honours a cook's stations — Summary

**A bartender now sees bar tickets and a cook does not, on the board, the station list and the live socket, from one decision — and a cook with no assignment still sees everything, which is asserted on all three surfaces because it is the state every user in the product is in.**

## Performance

- **Duration:** ~44 min
- **Tasks:** 2 of 2
- **Files modified:** 8 (3 created, 5 modified)
- **Commits:** `c0c0d099`

## Accomplishments

- **The dangerous default is a type, not a convention.** `StationScope` has two states and **no accessor that returns an empty collection**. `permittedCodes()` *throws* for an unrestricted scope, so a caller cannot reach a query with an empty `IN` clause. The failure this defends against — every kitchen screen in every tenant going blank the moment this deploys, mid-service, with no error anywhere — is not prevented by care; it is prevented by the wrong reading not being available.
- **Degrading OPEN is written down as a decision, with its consequence.** Absent, empty, wrong-type and unparseable all produce unrestricted, and the malformed ones log a warning so an operator can see something is wrong *while the board keeps working*. The type's javadoc states plainly that this inverts the codebase's usual fail-closed posture and why it is correct here: a station scope is a **view filter**; tenant and branch isolation are the security boundary, enforced separately and first.
- **List and detail refuse differently, on purpose.** Out-of-scope station on the list → empty page. Out-of-scope ticket on detail → `PermissionDeniedException`. A 403 on the list is an enumeration oracle; on detail, a specific resource is named and handing it back is the disclosure.
- **Two ordering bugs caught and fixed during implementation, both of which would have passed a careless test suite:**
  - The station-list filter was initially placed *before* the auto-seed, so a bartender at a kitchen-only branch would have looked like a branch with no stations and triggered a spurious `DEFAULT` row on every screen open. Moved after, with its own named test.
  - The socket read `stations` as a *top-level* claim. `JwtSigningService` nests it under `attributes`. A top-level read finds nothing, produces an unrestricted scope for every caller, and looks exactly like a working feature — no test that only checked the unassigned case would have noticed.
- **28-03's identity checks are untouched and still first.** Signature → permission → tenant → branch → *then* scope. `ws/KdsWebSocketBranchScopeTest` was not edited. `WS_UPGRADE_PATHS` and every gateway file were not touched.

## Deviations from Plan

**1. [Rule 1 — Bug] Scope filter ordering against the auto-seed.** Described above. Fixed with a named regression test (`aScopedUserAtABranchOfOnlyOtherStations_doesNotTriggerASpuriousDefaultSeed`).

**2. [Rule 1 — Bug] The socket read the claim at the wrong nesting level.** Described above. Fixed before the first test run; the scoped-token helper in the test now builds the nested shape `JwtSigningService` actually emits.

**3. [Rule 3 — Blocking, worked around not fixed] `shared-lib` did not compile** mid-session because of another agent's in-flight `print/PrintDocument.java`. Built kitchen-service against the installed artifact instead of editing another agent's file. Recorded in `deferred-items.md`.

**4. [Out of scope, logged not fixed] `TenantGucTransactionalProbeIT` fails in a full-suite run.** It passes in isolation; it is another agent's *uncommitted* probe documenting a pre-existing connection-pool GUC contradiction. Phase 28 adds transactional tests to the JVM, which changes which tenant is left on a pooled connection, but not the mechanism. Recorded in `deferred-items.md` rather than patched.

**5. [Environment] `StationScopeIT` stubs `StringRedisTemplate.opsForValue()`.** The class drives the real controller, so it passes through `FeatureFlagAspect`, which reads `FEATURE_KDS` from Redis; the base class's `@MockitoBean` returns null and the aspect NPEs. `FEATURE_KDS` is on for every tier in production, so "enabled" is the honest stub.

## Threat Flags

None new. No endpoint added; three existing surfaces narrowed. The scope is read only from a signature-verified token and no endpoint accepts it as input.

## Self-Check: PASSED

All three created files present; commit `c0c0d099` resolves.

## Verification

| Check | Result |
|---|---|
| `StationScopeIT` (7 + 11 behaviours, 15 tests) | 15/15 pass |
| `KdsWebSocketIsolationIT` (7 from 28-03 + 4 scope) | 12/12 pass |
| `ws/KdsWebSocketBranchScopeTest` — untouched | 4/4 pass |
| `KdsAccessIsolationIT` — untouched | 10/10 pass |
| kitchen-service full suite | 65/66 pass — the one failure is item 2 in `deferred-items.md`, not caused by this phase |
| Gateway files modified | none |
