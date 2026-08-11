---
phase: 28-station-pos-profiles
plan: 03
subsystem: auth
tags: [websocket, kds, tenant-isolation, jwt, security]

requires:
  - phase: 3-station-routing-refactor
    provides: "the KDS WebSocket handler and its branch:station subscription key"
provides:
  - "KdsWebSocketIsolationIT — the socket's complete refusal contract, seven behaviours, asserted on close status"
  - "An accurate account, in the handler, of what the tenant claim does and does not do"
affects: [28-07, 28-14]

tech-stack:
  added: []
  patterns:
    - "A socket refusal is asserted on the CLOSE STATUS, never on the absence of pushed frames"
    - "Every refusal is asserted to be byte-identical to every other, as its own named test"
    - "A comment describes the check that exists, not the check one would like to exist"

key-files:
  created:
    - services/kitchen-service/src/test/java/io/restaurantos/kitchen/KdsWebSocketIsolationIT.java
  modified:
    - services/kitchen-service/src/main/java/io/restaurantos/kitchen/ws/KdsWebSocketHandler.java

key-decisions:
  - "The tenant claim is NOT compared, because the subscription path carries no tenant segment to compare it against. What is enforced is branch equality, and a branch belongs to exactly one tenant — so a token minted for tenant A cannot carry a branch claim equal to a branch of tenant B. The tenant claim's PRESENCE is still required as the fail-closed posture. This is written into the handler in those words rather than left as the flattering comment that was there."
  - "ws/KdsWebSocketBranchScopeTest is left completely untouched. It pins the check that closed the original cross-tenant read; a second file asserting a superset is additive, and editing the guard while extending what it guards is how a guard quietly stops guarding."
  - "The asymmetry between what the operator learns and what the client learns is deliberate and now documented: a WARN naming both branch ids server-side, one generic close reason client-side."

patterns-established:
  - "Refusal tests are always paired with an acceptance control in the same file — the first draft of the branch-scope test passed three refusals for the wrong reason (a malformed path closed the socket before authorization ran) and only the control caught it"

requirements-completed: [P28-SC5]

coverage:
  - id: D1
    description: "A KDS subscription is refused unless the branch in the token matches the branch in the path — including a sibling branch of the same tenant"
    requirement: P28-SC5
    verification:
      - kind: integration
        ref: "KdsWebSocketIsolationIT#aDifferentBranchOfTheSameTenant_isRefused, #aTokenFromAnotherTenant_isRefused, #aTokenWithNoBranchClaim_isRefusedRatherThanDefaultingToAccepted"
        status: pass
      - kind: unit
        ref: "ws/KdsWebSocketBranchScopeTest — 4/4, untouched, re-run as the regression guard"
        status: pass
    human_judgment: false
  - id: D2
    description: "The permission check is not replaced or weakened; pos.kds.view stays required and identity is checked on top of it"
    requirement: P28-SC5
    verification:
      - kind: integration
        ref: "KdsWebSocketIsolationIT#aTokenLackingTheViewPermission_isStillRefused, #aTokenMatchingThePathBranch_withTheViewPermission_isAccepted"
        status: pass
    human_judgment: false
  - id: D3
    description: "A refusal closes the socket with the existing policy-violation status and never distinguishes which check failed"
    requirement: P28-SC5
    verification:
      - kind: integration
        ref: "KdsWebSocketIsolationIT#everyRefusalIsIndistinguishableFromEveryOther — four different causes, same code 1008, same reason string"
        status: pass
    human_judgment: false
  - id: D4
    description: "No token, and a token whose signature does not verify, are both refused"
    requirement: P28-SC5
    verification:
      - kind: integration
        ref: "KdsWebSocketIsolationIT#noTokenAtAll_isRefused, #aTokenSignedByTheWrongKey_isRefused"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-08-11
status: complete
---

# Phase 28 Plan 03: The KDS socket's isolation contract — Summary

**The branch check that closed the cross-tenant read now has a complete refusal contract behind it: seven behaviours asserted on the close status, including the sibling-branch case that does not look like a leak and the uniformity of every refusal — plus a handler comment that describes the check that actually exists.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 1 of 1
- **Files modified:** 2 (1 created, 1 modified)
- **Commits:** `2f91f8d0`

## What was already true when this plan started

The plan was written against a handler whose `validateJwtAndPermission(String token, String branchId)` took the branch and never read it. **That has since been fixed** — `ws/KdsWebSocketBranchScopeTest` (4 tests) pins it, and the branch comparison is in place. This plan therefore found roughly half its work already done, and the honest thing to record is which half.

**Already landed:** the branch comparison; the fail-closed refusal of a scope-less token; the retained permission check; the single `closeWithPolicy` exit.

**Landed here:** the named artifact `KdsWebSocketIsolationIT`, three behaviours nobody had asserted, and one comment that was not true.

## Accomplishments

- **The sibling-branch case.** A cook at the Gulberg branch subscribing to the DHA branch is *not* cross-tenant and therefore does not present as a leak — it was the behaviour most likely to be skipped, and it now has its own test.
- **The uniformity of refusals is asserted, not assumed.** Four different causes — foreign branch, missing permission, no token, scope-less token — are checked to produce the identical close code **and the identical reason string**. A reason that names which check failed lets one token be walked against branch ids to learn which exist. The operator's legitimate need for that information is served by a server-side `WARN` naming both ids, which the client never sees; that asymmetry is now written down.
- **Signature verification is asserted directly.** A token whose every claim is correct but which is signed by a different key is refused — the test exists because "the claims are right" is exactly the reasoning that makes someone stop checking the signature.
- **The tenant comment now says what is true.** The previous comment asserted that "tenant is checked as well as branch". It is not, and it *cannot be* from the path alone: `/api/v1/kitchen/kds/{branchId}/{stationId}` carries no tenant segment. What actually closes the cross-tenant read is branch equality, since a branch belongs to exactly one tenant. The tenant claim's **presence** is still required, as the fail-closed posture. This is now stated in those words — because a comment describing a check that does not exist is the same class of thing as a parameter that is accepted and ignored, and it is what let the original defect survive.

## Deviations from Plan

**1. [Documented, not auto-fixed] The plan asks for the tenant claim to be "compared against the value parsed from the subscription path". There is no tenant in the path.**
- **Found during:** Task 1, reading `extractPathVars`.
- **What was done instead:** branch equality is enforced (already was), the tenant claim's presence is required, and the handler now states plainly why there is no tenant comparison rather than implying one. Inventing a comparison — e.g. resolving the branch's tenant from `kds_stations` — would add a database read to every socket handshake and would lock out a branch that has not yet projected a station row, which is every brand-new branch on its first shift. That trade was not worth taking for a check that branch equality already subsumes.
- **Assessment, stated plainly:** the security property the plan wanted is achieved; the mechanism differs from the one the plan named, and the reason is recorded in the code rather than only here.

**2. Four of the seven behaviours were already covered.** `ws/KdsWebSocketBranchScopeTest` was left byte-untouched rather than absorbed into the new file, per the phase brief's instruction not to weaken it.

## Threat Flags

None new. No endpoint added, no gateway file touched, `WS_UPGRADE_PATHS` untouched, no file outside kitchen-service modified.

## Self-Check: PASSED

`KdsWebSocketIsolationIT.java` present; commit `2f91f8d0` resolves in `git log`.

## Verification

| Check | Result |
|---|---|
| `KdsWebSocketIsolationIT` (7 behaviours, 8 tests) | 8/8 pass |
| `ws/KdsWebSocketBranchScopeTest` — untouched | 4/4 pass |
| `KdsAccessIsolationIT` — the HTTP-side equivalent | 10/10 pass |
| Files modified outside kitchen-service | none |
