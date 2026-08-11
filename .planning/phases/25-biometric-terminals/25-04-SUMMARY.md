---
phase: 25-biometric-terminals
plan: 04
subsystem: api
tags: [zkteco, adms, iclock, exception-handling, rate-limiting, circuit-breaker, audit, gateway]

requires:
  - phase: 25-biometric-terminals
    provides: "25-01's AdmsAuthDefectsIT (the cases this plan closes out) and 25-03's archived_at column"
provides:
  - DeviceAuthResponseTest — the advice arrangement pinned with both advices registered
  - DeviceAuthHttpIT — five refusal causes proven byte-identical over real HTTP
  - DeviceAuthFailureRecorder — bounded, evicting, per-serial failure visibility
  - DeviceAuthFailureEventPublisher — the refusal survives the transaction that refused
  - both device routes now trip the circuit breaker on 500 as well as 503
affects: [25-08, 25-10, 25-11]

tech-stack:
  added: []
  patterns:
    - "Refusal uniformity asserted by comparing responses to EACH OTHER, never each to a literal"
    - "Bounded per-key log suppression whose summary carries the suppressed count, so an attack is louder than a typo"
    - "A capacity-bounded LRU for any map keyed on input from a public path"
    - "REQUIRES_NEW for anything that must outlive the transaction that failed"

key-files:
  created:
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/DeviceAuthFailureRecorder.java
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/DeviceAuthFailureEventPublisher.java
    - services/hr-service/src/test/java/io/restaurantos/hr/exception/DeviceAuthResponseTest.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/DeviceAuthHttpIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/DeviceAuthFailureRecorderTest.java
    - gateway/src/test/java/io/restaurantos/gateway/DeviceRouteConfigTest.java
  modified:
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/DeviceAuthResolver.java
    - gateway/src/main/resources/application.yml
  deleted:
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsAuthDefectsIT.java

key-decisions:
  - "Task 1's handler already existed — commit 174f24f landed it before the phase ran. This plan therefore built the two tests the plan asked for, added the archived cause, and closed out the defect registry."
  - "An unknown serial publishes NO event: there is no tenant, and the resolver binds none until every check passes. An invented tenant would put one tenant's audit trail in another's, on precisely the case an investigator would most want to trust."
  - "The failure event is published in REQUIRES_NEW. On the caller's transaction it would roll back with the refusal that caused it and the audit trail would show a healthy system."
  - "DeviceRouteConfigTest asserts against the PARSED config tree, not the YAML text — following the house pattern in GatewayResilienceConfigTest."

patterns-established:
  - "A defect registry class is deleted by the plan that owns it, once its last case is inverted"

requirements-completed: [BIO-01, HR-07]

coverage:
  - id: D1
    description: "A device that cannot authenticate is told so in one answer that tells a stranger nothing else — five causes, one byte-identical refusal"
    requirement: "BIO-01"
    verification:
      - kind: unit
        ref: "DeviceAuthResponseTest — 4/4 (advice arrangement, 401-not-500, byte-identical, no leak)"
        status: pass
      - kind: integration
        ref: "DeviceAuthHttpIT — 5/5 over real HTTP"
        status: pass
    human_judgment: false
  - id: D2
    description: "A thousand authentication failures cannot fill a disk or a heap, and are still visible once and summarised"
    requirement: "HR-07"
    verification:
      - kind: unit
        ref: "DeviceAuthFailureRecorderTest — 7/7 including 5,000 attacker serials evicted to 8"
        status: pass
      - kind: manual_procedural
        ref: "live: 5 polls of one unknown serial through the gateway -> exactly 1 log line, 0 stack traces"
        status: pass
    human_judgment: false
  - id: D3
    description: "A genuine fault on the device path opens the breaker, and the routes' configuration is pinned so it stays that way"
    requirement: "HR-07"
    verification:
      - kind: unit
        ref: "gateway DeviceRouteConfigTest — 4/4"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-08-11
status: complete
---

# Phase 25 Plan 04: A Refused Device Looks Refused Summary

**Five causes of refusal now produce one byte-identical 401, a misconfigured terminal polling every three seconds produces one log line per five minutes instead of fifteen thousand stack traces a day, and a real fault on the device path finally opens the breaker.**

## Performance

- **Duration:** ~55 min · **Tasks:** 3 of 3
- **Files created:** 6 · **modified:** 2 · **deleted:** 1
- **Tests:** hr-service 23 unit + 55 integration green; gateway 7 green

## Accomplishments

- **`DeviceAuthResponseTest`** — the advice arrangement, with *both* advices registered as the running service has them. A test registering only the local advice would pass against a service that still answered 500; that is the whole point of the class and it is stated in its javadoc.
- **`DeviceAuthHttpIT`** — five causes (unknown serial, wrong token, no token, inactive, archived) proven **byte-identical to each other** over real HTTP, plus: no serial/token/cause leaked, no refused request writing a punch or quarantine row, and the refusal reaching the outbox despite the rollback.
- **`DeviceAuthFailureRecorder`** — first failure per serial per window logged, the rest counted, one summary with the count when the window closes. **Bounded LRU:** 5,000 attacker-chosen serials evict to 8. This is a security property, not tidiness: `/iclock` is public by necessity, so the map's keys are attacker-chosen and an unbounded one is a memory-exhaustion vector with no authentication in front of it.
- **`DeviceAuthFailureEventPublisher`** — `REQUIRES_NEW`, because the resolver's transaction exits by throwing and an event enqueued on it would roll back with the refusal that caused it.
- **Both device routes trip on 500.** With the reason recorded at the route: until this phase a 500 here was overwhelmingly an auth refusal, so tripping would have taken a branch's terminals offline on the first mistyped serial.

## Live evidence — fresh jars, `check-stale-jars.sh` reports hr-service and gateway `ok`

```
GET /iclock/cdata?SN=UNKNOWN-DEVICE-999&options=all&pushver=2.4.0
HTTP/1.1 401 Unauthorized
{"error":{"code":"DEVICE_AUTH_FAILED","message":"Device not recognised","details":[],"traceId":"unknown"}}

# five rapid polls of one unknown serial, through the gateway:
grep -c "SN-FLOOD-TEST-1" .dev-logs/hr-service.log   →  1
WARN i.r.hr.adms.DeviceAuthFailureRecorder : Device auth refused: serial=SN-FLOOD-TEST-1 cause=UNKNOWN_SERIAL

grep -c "DeviceAuthException" .dev-logs/hr-service.log  →  0     (no stack traces, at any level)
```

Five polls, one line, zero stack traces. Before this phase that was five stack traces, and a real terminal polls at that rate forever.

## Deviations from Plan

**1. Task 1's production change was already done.** `HrExceptionHandler.handleDeviceAuth` landed in commit `174f24f` hours before this phase ran — 25-01 found this and recorded it. This plan therefore wrote the two tests the plan specifies, added the missing **archived-device** cause (25-03 introduced `archived_at`, and without a check an archived device would have kept authenticating), and closed out `AdmsAuthDefectsIT` per that class's own protocol: both its cases were fixed, so they were deleted, and its third case — refusal uniformity — moved to `DeviceAuthHttpIT` where this plan owns it.

**2. [Rule 2 — missing critical functionality] An archived device could still authenticate.** 25-03 made archiving a recorded event, and nothing checked it. Added as a fourth refusal cause in the resolver, ordered with the others and answering the same byte-identical 401.

**3. The unknown-serial case publishes no event, and this is deliberate.** The plan asks for an event on the first failure. For an unknown serial there is no tenant — that is what unknown means — and `DomainEventPublisher` requires one. The two available workarounds were both worse than the gap: inventing a tenant would put one tenant's audit trail into another's on exactly the case an investigator most needs to trust, and binding tenant context earlier would weaken the resolve-then-bind ordering this phase is forbidden to touch. So an unknown serial is **logged and counted but not published**, stated in the class javadoc and asserted by a test, rather than left for someone to discover from an empty audit query.

**4. `DeviceRouteConfigTest` parses the YAML rather than loading Spring route definitions.** The plan asks for the latter. The house pattern for gateway config gates (`GatewayResilienceConfigTest`) parses the file with SnakeYAML and runs with no context, no container and no socket — and the substantive requirement, "a text search must not be able to satisfy this", is met: the assertions walk the parsed tree to the filter's `args` map and compare the status list as a list of numbers. A comment mentioning 500, or the 500 belonging to the route above, satisfies neither.

## What this plan deliberately did NOT do

- **`RateLimitConfig` is untouched.** Its `deviceKeyResolver` defect on the JSON bridge route is real, pinned by 25-01 as ADMS-REG-03, and belongs to 25-08 which owns that file. `DeviceRouteConfigTest` pins the limiter's *presence* so 25-08 changes the resolver rather than losing the limiter.
- **`RouteFeatureMap` and the public-path list are unmodified.** The inert FEATURE_HR gate is 25-08's.
- **`AdmsHttpContractIT` is unmodified** — verified by `git status --porcelain`. 25-01 froze it.

## Hardware sign-off (D-25-04)

**Requires U5: nothing.** Whether a given firmware surfaces a 401 to the installer differently from a 503 is a display question on the device's own screen, not a protocol question, and it changes nothing about what the server should send.

## Self-Check: PASSED

All six created files exist; `AdmsAuthDefectsIT` verified absent; `AdmsHttpContractIT` verified unmodified. hr-service 23 unit + 55 integration green in one run; gateway 7 green. Live probes taken against jars `check-stale-jars.sh` reports fresh for both hr-service and gateway.
