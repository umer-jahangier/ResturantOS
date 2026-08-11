---
phase: 25-biometric-terminals
plan: 01
subsystem: testing
tags: [zkteco, adms, iclock, biometric, attendance, testcontainers, http-contract, defect-registry]

requires:
  - phase: 11-hr-payroll
    provides: the ADMS/iClock adapter, DeviceAuthResolver, PunchIngestService, attendance_devices registry
provides:
  - AdmsHttpContractIT — the frozen baseline of what the device path does, asserted over real HTTP
  - five per-owner defect registries pinning fifteen current behaviours so a fix is proven by inversion
  - 25-INVENTORY.md — WORKS / DECORATIVE / MISSING with a test name on every row
  - a repaired Testcontainers port strategy that made the hr-service suite runnable at all on this machine
affects: [25-04, 25-05, 25-06, 25-07, 25-08, 25-09, 25-10, 25-11, 25-12, 25-13]

tech-stack:
  added: []
  patterns:
    - "Wire-level contract test: java.net.http.HttpClient pinned to HTTP/1.1 against a loopback-bound embedded Tomcat, so query binding, Content-Type, the servlet body stream and the exception-resolution chain are all inside the assertion"
    - "Per-owner defect registry: one class per fixing plan, each case asserting the defect STILL reproduces, red meaning fixed, the fixing plan deleting its own case"
    - "Structural assertion for defects that are absences: assert the absence of a reader rather than the presence of a symptom"
    - "Test containers publish on a host port the JVM claims first, on 127.0.0.1 — inverts the race against anything that auto-forwards new listeners"

key-files:
  created:
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsHttpContractIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsWireTestBase.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsAuthDefectsIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsBodyDefectsIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsCommandDefectsIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsRegistrationDefectsIT.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsLivenessDefectsIT.java
    - .planning/phases/25-biometric-terminals/25-INVENTORY.md
  modified:
    - services/hr-service/src/test/java/io/restaurantos/hr/HrTestBase.java

key-decisions:
  - "The auth-status defect does NOT reproduce: commit 174f24f fixed it hours before this plan ran. AdmsAuthDefectsIT was written the other way up, as a regression guard, and 25-04 inherits a smaller and different task than its plan assumes."
  - "AdmsHttpContractIT deliberately does NOT share a base class with the defect registries. A frozen baseline that inherits from something five plans may edit is not frozen."
  - "The inventory is named 25-INVENTORY.md, not 30-INVENTORY.md, and routes to 25-NN plan numbers — the phase was renumbered after the plans were written."
  - "One inventory row (source_record_id reading the work-code field) is labelled an opinion rather than a finding, because no test pins it."

patterns-established:
  - "Inversion protocol: a defect registry case is deleted by the plan that fixes it, and an emptied registry class is deleted with it — a tolerance must not outlive its defect"
  - "Loopback-only, JVM-claimed host ports for every test container and for the test Tomcat"

requirements-completed: [HR-07, BIO-06]

coverage:
  - id: D1
    description: "What the ADMS/iClock path genuinely does is proven at the layer a physical terminal talks to, not at the layer a unit test finds convenient"
    requirement: "BIO-06"
    verification:
      - kind: integration
        ref: "mvn -o -pl services/hr-service verify -Dit.test='AdmsHttpContractIT' — 8/8 pass"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every defect this phase intends to fix is pinned by an assertion that must be inverted to close it, owned by exactly one plan"
    requirement: "BIO-06"
    verification:
      - kind: integration
        ref: "mvn -o -pl services/hr-service verify -Dit.test='Adms*DefectsIT' — 15/15 pass"
        status: pass
    human_judgment: false
  - id: D3
    description: "One document states what works, what is decorative and what is missing, with a file-and-line citation and a test name on every row"
    requirement: "HR-07"
    verification:
      - kind: other
        ref: ".planning/phases/25-biometric-terminals/25-INVENTORY.md — acceptance script: three tables present, every plan 25-04..25-11 routed to"
        status: pass
    human_judgment: true
    rationale: "The plan's own human-check asks whether the closing section says something the reader did not already know. That is a judgement, not an assertion."

duration: 105min
completed: 2026-08-11
status: complete
---

# Phase 25 Plan 01: ADMS Baseline and Defect Registry Summary

**The ADMS/iClock path is now measured rather than believed: 23 assertions over real HTTP separate nineteen things that work from eleven that are decorative, and the largest finding is that no stock ZKTeco terminal can authenticate at all.**

## Performance

- **Duration:** ~105 min
- **Tasks:** 3 of 3
- **Files created:** 8 · **modified:** 1
- **Tests:** 45/45 in the hr-service suite green, including 23 new assertions

## Accomplishments

- **`AdmsHttpContractIT` (8 cases)** — the frozen baseline. Handshake, plain-text ATTLOG ingest, over-the-wire replay idempotency (D-25-05, previously only ever asserted by calling the controller twice as a Java method), intra-batch duplicate collapse, quarantine with the raw line retained verbatim, a refused device writing nothing, the two timestamp columns asserted as independent facts in one query, and the command channel. No assertion in the class produces the behaviour under test by calling a controller, service or repository.
- **Five defect registries (15 cases)**, one per owning plan so that five plans need not serialise on one file: `AdmsAuthDefectsIT` → 25-04, `AdmsBodyDefectsIT` → 25-05, `AdmsCommandDefectsIT` → 25-07, `AdmsRegistrationDefectsIT` → 25-08, `AdmsLivenessDefectsIT` → 25-10. Each class header states the inversion protocol in those words.
- **`25-INVENTORY.md`** — 19 WORKS rows, 11 DECORATIVE rows, 14 MISSING rows, each citing a test and a file with a line number, plus a closing section that answers 25-CONTEXT's claim directly.
- **`src/main` is untouched.** `git status --porcelain services/hr-service/src/main gateway/src/main shared-lib/src/main` is empty. This plan measures; it does not repair.

## Defect case identifiers, and their owners

Later plans read this list to know what they must invert and delete.

| Case | Defect | Owner |
|---|---|---|
| ADMS-AUTH-01 | tokenless handshake answered 500 — **ALREADY FIXED**, now a regression guard | 25-04 |
| ADMS-AUTH-02 | wrong token answered 500 — **ALREADY FIXED**, now a regression guard | 25-04 |
| ADMS-AUTH-03 | refusal uniformity — a property to preserve, not a defect | 25-04, and 25-08 must not break it |
| ADMS-BODY-01 | form-encoded ATTLOG → 200 + `OK` + zero rows + nothing logged | 25-05 |
| ADMS-BODY-02 | Unix-epoch timestamp dropped with no row and no quarantine | 25-05 |
| ADMS-BODY-03 | three-field line dropped where the reference parser reads two | 25-05 |
| ADMS-BODY-04 | a good line survives beside an unreadable one; the unreadable one leaves no trace | 25-05 |
| ADMS-CMD-01 | empty command queue answers zero bytes, not the acknowledgement | 25-07 |
| ADMS-CMD-02 | `recordAck` discards a failure report identically to a success | 25-07 |
| ADMS-REG-01 | registration hands the installer `REPLACE-WITH-GATEWAY-HOST` | 25-08 |
| ADMS-REG-02 | the FEATURE_HR gate on `/iclock/` cannot ever fire | 25-08 |
| ADMS-REG-03 | the bridge route's rate limit degrades to one bucket for the whole platform | 25-08 |
| ADMS-LIVE-01 | `last_seen_at` is written faithfully — the premise, not the defect | 25-10 keeps this |
| ADMS-LIVE-02 | nothing compares `last_seen_at` to any threshold | 25-10 |
| ADMS-LIVE-03 | no frontend code asks for the device list at all | 25-10 |

## Live evidence — against the running stack, on a jar verified fresh

`bash scripts/check-stale-jars.sh` → `checked=15 stale=0` after restarting hr-service (pid 87311) on the jar built at 22:06.

```
GET /iclock/cdata?SN=UNKNOWN-DEVICE-999&options=all&pushver=2.4.0        (via gateway :8080)
HTTP/1.1 401 Unauthorized
{"error":{"code":"DEVICE_AUTH_FAILED","message":"Device not recognised","details":[],"traceId":"unknown"}}

POST /iclock/cdata?SN=UNKNOWN-DEVICE-999&table=ATTLOG&Stamp=9999         Content-Type: text/plain
body: 1001<TAB>2026-08-11 09:30:00<TAB>0<TAB>1<LF>
HTTP/1.1 401 Unauthorized
{"error":{"code":"DEVICE_AUTH_FAILED","message":"Device not recognised","details":[],"traceId":"unknown"}}

GET /iclock/getrequest?SN=UNKNOWN-DEVICE-999
HTTP/1.1 401 Unauthorized
```

All three device endpoints refuse identically. The 500 recorded in the plan's objective is gone.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — Blocking] The hr-service integration suite could not run on this machine at all.**

- **Found during:** Task 1, before a single new assertion had been written.
- **Issue:** Every run failed, and failed differently. One run: `Timed out waiting for URL to be accessible (http://localhost:34831/health)` after 60 s, with the OPA container's own log showing a healthy server that had received no request. The next: `PSQLException: The connection attempt failed`. The pre-existing `AdmsIngestIT` failed identically, so this was not caused by the new code — four consecutive baseline runs failed before any change.
- **Root cause:** `lsof -nP -iTCP:34831 -sTCP:LISTEN` named the owner: not Docker. An IDE's automatic port forwarding had bound the port and Docker's listener was displaced, so the port was open, `docker ps` showed the mapping, and every connection hung. The forwarder holds those listeners after the container dies, and Docker allocates sequentially from the low end of a fixed range — so leftovers accumulate exactly where the next container lands. Over 40 contiguous ports from 32768 were held.
- **Fix:** `HrTestBase` now claims a host port itself from the OS ephemeral range (49152+, clear of Docker's automatic range) and binds each container to `127.0.0.1:thatPort`. Docker binds first, so a forwarder noticing afterwards cannot displace it. The same treatment for the test Tomcat: `server.address=127.0.0.1`, addressed as `127.0.0.1` rather than as the name `localhost`.
- **Effect:** the suite went from 45 errors to 45/45 green, and from 62 s of timeouts to 13 s.
- **Also correct on its own merits:** a Testcontainers Postgres publishes a database whose password is written in the test file. It had no business being reachable from the LAN.
- **Files modified:** `services/hr-service/src/test/java/io/restaurantos/hr/HrTestBase.java` (test-only; no `src/main` change).

**2. [Rule 3 — Blocking] `HrTestBase.postgres` was package-private.**

- The plan requires the new tests in a new `adms` package; they read the container's JDBC coordinates to verify what the service wrote. Widened to `protected` with the reason stated in a comment.

### Planned work that turned out not to be needed

**3. The two auth-status defect cases do not reproduce.** The plan expected `500 INTERNAL_ERROR` on a tokenless and on a wrong-token handshake. Commit `174f24f`, landed on 2026-08-11 a few hours before this plan ran, added `HrExceptionHandler.handleDeviceAuth`; both now answer 401, verified live through the real gateway and again over the wire in the test harness. Per the plan's own instruction, the cases were not forced: they are recorded in the inventory as ALREADY FIXED with the evidence, and `AdmsAuthDefectsIT` was written the other way up as a regression guard on the fix (it fails if the handler is removed, or if its `HIGHEST_PRECEDENCE` order is removed and the shared catch-all wins again). **Consequence for 25-04: its Task 1 is already done. Its remaining work is the refusal-uniformity property and the circuit-breaker status list.**

**4. A defect the plan did not predict, worse than the research said.** The research recorded the bridge route's rate-limit key resolver as "degraded". Re-measurement establishes the blast radius: the fallback is the literal string `"unknown"`, so it is not one bucket per branch or per tenant but **one 120-request bucket shared by every bridge agent in every tenant on the platform** — a cross-tenant availability coupling. Pinned as ADMS-REG-03 and routed to 25-08.

### Naming deviation

**5. The inventory is `25-INVENTORY.md`, not `30-INVENTORY.md`.** The phase was renumbered from `30-` on the day the plans were written; the plan body and its automated `<verify>` script both still say `30-`. The document uses current numbers and the acceptance script was run in its `25-` form. Recorded here rather than silently satisfying a stale grep.

## What this plan deliberately did NOT do

No file under any `src/main` tree was modified. No package was added to any manifest. The defects are pinned, not fixed.

## Hardware sign-off (D-25-04)

**Requires U5 (a physical ZKTeco terminal): nothing in this plan.** Every assertion here is an HTTP request this plan constructs. The one question this plan cannot settle — whether any firmware field can carry a per-device secret — is recorded as a MISSING row and was answered by decision D-25-06 (`both`), built in 25-08. It was a design question, not a test declined.

## Self-Check: PASSED

All eight created files exist on disk. `src/main` verified clean. Suite verified green in one run of `mvn -o -pl services/hr-service verify` (45/45), and the live probes above were taken against a jar `check-stale-jars.sh` reports as fresh.
