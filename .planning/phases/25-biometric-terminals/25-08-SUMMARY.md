---
phase: 25-biometric-terminals
plan: 08
subsystem: auth
tags: [zkteco, adms, iclock, device-auth, credential-policy, rate-limiting, feature-flags, gateway]

requires:
  - phase: 25-biometric-terminals
    provides: "25-03's auth_mode + allowlist + last_refused columns; 25-04's single refusal code and failure recorder; 25-01's AdmsRegistrationDefectsIT"
provides:
  - DeviceCredentialPolicy — the seam, with TOKEN, SERIAL_ONLY_BOUNDED and HOST_MAPPED
  - AdmsRequestContext — the source address and host, with the trust caveat written down
  - DeviceRefusalRecorder — the observed refusal address on the device's own row
  - FEATURE_HR enforced where the tenant is first known
  - a real server address and mode-specific installer instructions at registration
  - deviceKeyResolver keyed per device, never on a shared constant
affects: [25-09, 25-10, 25-11, 25-13]

tech-stack:
  added: []
  patterns:
    - "A policy seam substituted INSIDE an existing security ordering rather than a rewrite around it"
    - "Refusal uniformity asserted by comparing refusals to each other across every mode"
    - "Fail-closed on misconfiguration: a secret-less mode with an empty allowlist is refused before any other check"
    - "A rate-limit fallback key must never be a constant — a shared key is a shared bucket is a cross-tenant DoS"

key-files:
  created:
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/DeviceCredentialPolicy.java
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/AdmsRequestContext.java
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/DeviceRefusalRecorder.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/DeviceCredentialPolicyIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/DeviceFeatureGateIT.java
    - gateway/src/test/java/io/restaurantos/gateway/DeviceRateLimitKeyTest.java
  modified:
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/DeviceAuthResolver.java
    - services/hr-service/src/main/java/io/restaurantos/hr/dto/DeviceDtos.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/AttendanceDeviceService.java
    - services/hr-service/src/main/resources/application.yml
    - gateway/src/main/java/io/restaurantos/gateway/config/RateLimitConfig.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/JwtGlobalFilter.java
    - gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java
    - services/hr-service/src/test/java/io/restaurantos/hr/HrTestBase.java
  deleted:
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsRegistrationDefectsIT.java

key-decisions:
  - "The policy is a substitution inside DeviceAuthResolver's ordering, not a rewrite around it. Resolve, active, archived, THEN policy, then bind. TOKEN delegates to the same constant-time comparison."
  - "The source address is the first X-Forwarded-For token, matching the gateway's own ipKeyResolver. The caveat is written into AdmsRequestContext: that token is only trustworthy because Nginx overwrites it, and SERIAL_ONLY_BOUNDED rests entirely on it."
  - "The rate-limit fallback is the caller's address, never a constant. A constant fallback was the whole of ADMS-REG-03."
  - "FEATURE_HR is enforced in hr-service, not the gateway — the gateway cannot derive a tenant on this path without a database call at the edge on a 3-second poll."
  - "HrTestBase stubs FeatureFlagService permissive, which is only safe because DeviceFeatureGateIT exercises the denying direction."

patterns-established:
  - "A control that nothing exercises in its denying direction is indistinguishable from a control that does not work"

requirements-completed: [BIO-01, HR-07]

coverage:
  - id: D1
    description: "A terminal that can only be given a server address and a port authenticates and delivers a punch"
    requirement: "BIO-01"
    verification:
      - kind: integration
        ref: "DeviceCredentialPolicyIT.aTerminalWithNoTokenAtAllResolvesWhenItsAddressIsAllowed (+9 more) — 10/10"
        status: pass
      - kind: manual_procedural
        ref: "live, fresh jar: tokenless boot handshake -> 200 with the config block; ATTLOG POST -> 200 OK; punch landed on 'Stock Terminal Tester'"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every refusal across every mode is byte-identical, and a source-address refusal records the observed address"
    requirement: "BIO-01"
    verification:
      - kind: integration
        ref: "DeviceCredentialPolicyIT.everyRefusalAcrossEveryModeIsByteIdentical, .aSourceAddressRefusalRecordsTheObservedAddressOnTheDevicesOwnRow"
        status: pass
      - kind: manual_procedural
        ref: "live: same terminal from 203.0.113.55 -> 401, and last_refused_source_address = 203.0.113.55 on its row"
        status: pass
    human_judgment: false
  - id: D3
    description: "ADMS-REG-03 — two tenants cannot exhaust each other's rate-limit budget"
    requirement: "HR-07"
    verification:
      - kind: unit
        ref: "gateway DeviceRateLimitKeyTest — 6/6, incl. five distinct callers producing five distinct buckets"
        status: pass
    human_judgment: false
  - id: D4
    description: "FEATURE_HR is enforced where the tenant is known, and the gateway comments say what is true"
    requirement: "HR-07"
    verification:
      - kind: integration
        ref: "DeviceFeatureGateIT — 3/3"
        status: pass
    human_judgment: true
    rationale: "The plan's own human-check asks whether each corrected gateway comment states something verifiable by reading the twenty lines under it. That is a reading, not an assertion."

duration: 95min
completed: 2026-08-11
status: complete
---

# Phase 25 Plan 08: A Stock Terminal Can Connect Summary

**A ZKTeco terminal given nothing but a server address and a port now boots, authenticates and delivers a punch that lands on the right employee — proven against the running service, on a jar verified fresh.**

## Performance

- **Duration:** ~95 min · **Tasks:** 3 of 3
- **Files created:** 6 · **modified:** 8 · **deleted:** 1
- **Tests:** hr-service 73/73 integration + 23 unit; gateway 64/64

## The live proof

```
─── BOOT HANDSHAKE. No token anywhere in this request. ───
GET /iclock/cdata?SN=ZK-STOCK-TERMINAL-01&options=all&pushver=2.4.0
HTTP/1.1 200
GET OPTION FROM: ZK-STOCK-TERMINAL-01
Stamp=0 / OpStamp=0 / ErrorDelay=30 / Delay=30
TransTimes=00:00;14:05 / TransInterval=1 / TransFlag=1111000000
Realtime=1 / Encrypt=0

─── PUNCH UPLOAD. Still no token. ───
POST /iclock/cdata?SN=ZK-STOCK-TERMINAL-01&table=ATTLOG&Stamp=9999
Content-Type: text/plain
body:  7788<TAB>2026-08-11 09:30:00<TAB>0<TAB>1<LF>
HTTP/1.1 200
OK

─── WHERE IT LANDED ───
      full_name        | device_user_ref | punch_type |  device_reported_at    |   server_received_at
-----------------------+-----------------+------------+------------------------+---------------------------
 Stock Terminal Tester | 7788            | IN         | 2026-08-11 04:30:00+00 | 2026-08-11 18:43:32.71+00

─── THE SAME TERMINAL FROM A CHANGED PUBLIC IP ───
X-Forwarded-For: 203.0.113.55                          → HTTP/1.1 401
 display_name | auth_mode           | source_address_allowlist | last_refused_source_address
--------------+---------------------+--------------------------+-----------------------------
 Kitchen door | SERIAL_ONLY_BOUNDED | 127.0.0.1                | 203.0.113.55
```

`bash scripts/check-stale-jars.sh` → `ok hr-service (pid 59879)` before every line above.

The last block is 25-AUTH-MODES.md's added constraint working end to end: the address the terminal is *actually* dialling from is on its own row, so a restaurant whose public IP changed is a one-click fix on the device screen rather than a weekend support call about attendance nobody can reconstruct.

## Two things the live run found that no test would have

**1. The 25-04 circuit-breaker change is real.** Seeding a device with an invalid encrypted token produced a 500 from the converter, and the gateway breaker opened and served `503 SERVICE_UNAVAILABLE`. That is exactly the behaviour 25-04 added and it was observed by accident rather than by assertion.

**2. The FEATURE_HR gate is real.** The first tokenless handshake got past the credential policy and was refused `403 FEATURE_DISABLED`, because the seeded tenant had no HR entitlement. Both new controls fired in sequence, in the right order, on the first attempt.

## Deviations from Plan

**1. [Rule 3 — blocking] `AdmsRequestContext` did not exist.** The plan reads it from 25-05, which has not run. Built here as a `RequestContextHolder`-based accessor, so the resolver's signature and `AdmsController` are untouched and 25-05 can replace it with an explicit thread-through later.

**2. [Rule 1 — bug] `DeviceRefusalRecorder`'s update would have matched zero rows and reported success.** `attendance_devices` is under FORCE RLS and no tenant GUC is set at refusal time — the resolver binds context only after every check passes, and this runs because one failed. It now sets the GUC transaction-locally from the registry row's tenant, exactly as the resolver does. Caught before it shipped; the failure would have been silent, which is the shape this whole class exists to remove.

**3. [Rule 2 — missing critical] `HrTestBase` now stubs `FeatureFlagService`.** The new gate broke 19 tests whose Redis is mocked. Stubbing permissive matches inventory-service's per-class convention, hoisted because the device path is traversed by nearly every class. **This is only safe because `DeviceFeatureGateIT` exercises the denying direction** — a control nothing ever denies with is indistinguishable from one that does not work, which is the exact defect this plan is fixing.

**4. ADMS-REG-03 tested as a DoS, not as a null check.** Per the coordinator: the broken resolver also returned a non-null key, which is why it survived review. `DeviceRateLimitKeyTest` asserts *two callers cannot collide* across every input shape the two routes accept — including two agents behind one NAT, and a caller sending no serial at all.

**5. `HOST_MAPPED` stores its hostname in `source_address_allowlist`.** One column serving two modes, because 25-03 provisioned one. It is the mode's network bound in both cases. Worth a dedicated column if a device ever needs both.

## Process incident — read this before auditing the manifest

**This plan's code was committed by another agent, inside `ed1700e3` ("docs(26-06): complete — the print agent runs end to end").** Four executors share this working tree; between my `git add` and my `git commit`, a concurrent agent ran a broad `git add` and committed, sweeping my staged files into their commit.

The code is intact and present in HEAD — verified file by file. **No history was rewritten to correct the attribution**: `ed1700e3` already had a descendant, and rewriting a shared branch other agents are building on would be far more damaging than a wrong commit message. This paragraph is the record, so that a phase manifest or a `gsd-undo` does not conclude 25-08 was never committed.

The same collision cost the environment note in `.planning/STATE.md` once — recovered from a dangling blob via `git fsck --unreachable` and re-committed as `f18588f`.

## What this plan deliberately did NOT do

- **The device screen's "allow this address" button.** The column and the recording are here; the button is 25-11's, which owns the frontend. This plan delivers the half that cannot be added later without a schema change.
- **`DeviceAuthResolver`'s ordering, constant-time comparison, or `finally` clearing.** Untouched. The policy is a substitution inside the ordering; `DeviceAuthResolverIT` passes unmodified.

## Residual risk, stated rather than inferred

`SERIAL_ONLY_BOUNDED` trusts a serial — printed on the device, visible in support tickets and photographs — plus a source address, which is the restaurant's public IP. **A guest on the restaurant's wifi shares that address and can post fabricated punches for that branch.** The ceiling is payroll fraud bounded by whatever attendance-to-payroll review catches. It is materially weaker than `TOKEN`, and it is the mode most customers will run.

It is accepted because the alternative is not a stronger deployment but no deployment. What makes it defensible rather than negligent: per-device, opt-in, audited, bounded at the network, never a default, never applied by migration, and visible on the device screen as a weaker mode.

One thing compounds it and is written into `AdmsRequestContext`: the first `X-Forwarded-For` token is trustworthy **only because Nginx overwrites it**. Remove Nginx from the ingress, or reconfigure it to append, and that value becomes attacker-controlled — at which point this mode is trusting a string the attacker types. Anyone changing ingress topology must revisit that class.

## Hardware sign-off (D-25-04)

**Requires U5: nothing this plan could not settle.** The one genuinely open question — whether a given firmware's Server Address field accepts a bare host and builds `/iclock` itself, as documented — is settled by the terminal's own menu on the day it arrives and changes no code either way.

## Self-Check: PASSED

All six created files verified present in HEAD. `AdmsRegistrationDefectsIT` verified absent. hr-service 73/73 + 23 unit and gateway 64/64 in single runs. Every live response above was taken against a jar `check-stale-jars.sh` reports fresh.
