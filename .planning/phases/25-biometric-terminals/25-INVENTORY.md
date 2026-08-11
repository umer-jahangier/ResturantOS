# Phase 25 — ADMS/iClock integration: what works, what is decorative, what is missing

Every row below is backed by a test that ran on 2026-08-11, or it is marked as an opinion and is not
in a table. Nothing here rests on a comment, a javadoc or a `@ResponseStatus`.

Method: two new integration classes go over real HTTP to an embedded Tomcat on a random port
(`AdmsHttpContractIT`, the frozen baseline) and five defect registries pin the current wrong
behaviour so a fix is proven by inversion rather than by assertion of intent. The existing
`AdmsIngestIT` calls the controller as a Java method and can see none of: query binding, the
`Content-Type` the device chose, the servlet body stream, the exception-resolution chain, or the
status a device receives. Four of the six DECORATIVE rows below live in exactly that blind spot.

> **Numbering.** This phase was renumbered from `30-` to `25-` on 2026-08-11 after the plans were
> written. Plan bodies still say `30-NN`; every such reference means `25-NN`. This document uses the
> current numbers.

---

## Table one — WORKS

| Capability | File and line | Proven by |
|---|---|---|
| Handshake handler, and the config block a device boots from | `AdmsController.java:39–57` | `AdmsHttpContractIT.handshakeWithAValidSerialAndTokenReturnsTheDevicesOperatingConfig` |
| ATTLOG upload writes a punch and returns the acknowledgement the protocol expects | `AdmsController.java:60–80` | `AdmsHttpContractIT.aPlainTextAttlogUploadWritesOnePunchAndAcknowledgesWithOk` |
| Command poll and command acknowledgement both answer an authenticated device | `AdmsController.java:83–106` | `AdmsHttpContractIT.anAuthenticatedDeviceCanPollForCommandsAndAcknowledgeOne` |
| Gateway route reaches the service, JWT-exempt, with the device path public | `gateway/application.yml:380–390`, `HrSecurityConfig.java:55` | every HTTP case above; they traverse the same mappings the gateway forwards to |
| Resolve-then-check-then-bind ordering: unknown serial and inactive device are refused before any tenant is bound | `DeviceAuthResolver.java:44–52` | `DeviceAuthResolverIT.resolve_unknownSerial_rejected`, `.resolve_inactiveDevice_rejected` |
| Constant-time token comparison (`MessageDigest.isEqual`, not `String.equals`) | `AttendanceDeviceService.java:88–90` | `DeviceAuthResolverIT.resolve_wrongToken_rejected_noContextLeak` |
| Tenant/branch derived from the registry, never from client input | `DeviceAuthResolver.java:55–58` | `DeviceAuthResolverIT.resolve_validSerialAndToken_bindsTenantBranch_fromRegistry` |
| Tenant context cleared in a `finally` on every handler (pooled threads) | `AdmsController.java:54, 77, 89, 103` | `DeviceAuthResolverIT.resolve_wrongToken_rejected_noContextLeak` (no-leak half) |
| `SECURITY DEFINER` serial lookup, so the pre-tenant read survives FORCE RLS | `031-device-resolve-fn.xml:20–33`, `AttendanceDeviceRepository.java:32` | every HTTP case above; without it the resolver sees zero rows and all fifteen fail |
| Idempotent insert — a replayed batch writes no second row **and publishes no second event** | `PunchIngestService.java:112–142` | `AdmsHttpContractIT.replayingTheIdenticalBatchOverTheWireWritesNoSecondRowAndEmitsNoSecondEvent` |
| Duplicate inside a single batch collapses to one row | `PunchIngestService.java:118` | `AdmsHttpContractIT.aBatchCarryingTheSamePunchTwiceInOneBodyWritesOneRow` |
| Unmapped device user is quarantined with its raw line retained verbatim, never dropped | `PunchIngestService.java:98–109` | `AdmsHttpContractIT.anUnmappedDeviceUserIsQuarantinedWithItsRawLineRetainedVerbatimAndWritesNoPunch` |
| Durable ref→employee mapping on resolution, and refusal to re-point a ref at a second employee | `PunchIngestService.java:62–87` | `AdmsIngestIT.unmappedRef_quarantines_thenResolveEstablishesDurableMapping` |
| A refused device writes nothing at all | `DeviceAuthResolver.java:44–51` | `AdmsHttpContractIT.aWrongTokenWritesNoRowsAtAll` |
| Device token encrypted at rest (AES-256-GCM `bytea`) and returned in plaintext exactly once | `AttendanceDeviceEntity.java:53–55`, `AttendanceDeviceService.java:63`, `DeviceDtos.java:26–32` | `AdmsHttpContractIT` fixture: the token used over the wire comes only from the registration response, and `DeviceResponse` has no token field to leak |
| Device-reported and server-received instants stored as two independent facts | `010-create-hr-tables.xml:183–184`, `PunchIngestService.java:114–117` | `AdmsHttpContractIT.theDeviceReportedInstantAndTheServerReceivedInstantAreStoredSeparatelyAndDiffer` |
| `last_seen_at` is written on every authenticated call | `DeviceAuthResolver.java:60–61` | `AdmsLivenessDefectsIT.lastSeenAdvancesOnEveryAuthenticatedCall` |
| Every refusal is byte-identical whatever the cause (no serial-number oracle) | `HrExceptionHandler.java:77–82` | `AdmsAuthDefectsIT.aRefusalLooksTheSameWhateverTheCause` |
| An unknown or inactive device is refused **401**, not 500 | `HrExceptionHandler.java:24, 77–82` | `AdmsAuthDefectsIT.aHandshakeWithNoTokenIsRefused401AndNot500`, `.aHandshakeWithAWrongTokenIsRefused401AndNot500` — **moved here from DECORATIVE during this plan; see the closing section** |

---

## Table two — DECORATIVE

A row belongs here when code, a comment or an annotation asserts a property the running system does
not have. Every row was re-measured; the one that no longer reproduced was moved out.

| What it claims | What it does | Pinned by | Fixed in |
|---|---|---|---|
| `@RequestBody(required = false)` plus a `body != null` guard reads whatever the device posts | A form-encoded POST is drained into request parameters by the container; the guard skips the loop; the device gets **200 + `OK` + zero rows + no log line** | `AdmsBodyDefectsIT.aFormEncodedAttlogIsAcknowledgedAsSuccessAndWritesNothing` | 25-05 |
| "Defensive parser … SKIP (never throw)" — presented as tolerance | An empty `Optional` is indistinguishable from a line never sent. A Unix-epoch timestamp is dropped with no row, no quarantine and a success acknowledgement | `AdmsBodyDefectsIT.anEpochTimestampIsDroppedWithNoRowNoQuarantineAndASuccessAcknowledgement` | 25-05 |
| Same, for field count: four fields are required | A three-field line is dropped the same way; the Go reference parser identifies a punch from two | `AdmsBodyDefectsIT.aThreeFieldLineIsDroppedWithNoRowAndNoQuarantine` | 25-05 |
| One bad line does not stop a batch | True — and the bad line lands nowhere, so the batch is partially and silently lossy | `AdmsBodyDefectsIT.aGoodLineBesideAnUnreadableOneSurvivesButTheUnreadableOneLeavesNoTrace` | 25-05 |
| `pendingCommandsFor` is "a seam so commands can be queued later" | Returns the empty string; a poll answers 200 with zero bytes where two reference implementations return the acknowledgement | `AdmsCommandDefectsIT.anEmptyCommandQueueAnswersWithZeroBytesRatherThanTheAcknowledgement` | 25-07 |
| `recordAck` "records a device's execution result" | Empty method body. A failure report is answered identically to a success and neither is stored | `AdmsCommandDefectsIT.anAcknowledgementForACommandThatWasNeverIssuedIsAcceptedAndDiscarded` | 25-07 |
| Registration tells the installer where to point the terminal | Hands them `https://REPLACE-WITH-GATEWAY-HOST/iclock`. The property is set in no yml, no env file, no manifest — beside a token shown exactly once | `AdmsRegistrationDefectsIT.registrationHandsBackAPlaceholderHostRatherThanAReachableAddress` | 25-08 |
| `/iclock/` is FEATURE_HR-gated ("so pushes to an HR-disabled tenant are rejected at the edge") | `FeatureFlagGlobalFilter` passes through the instant `X-Tenant-Id` is absent, which on this path it always is. The gate cannot fire. A tenant with HR switched off keeps ingesting | `AdmsRegistrationDefectsIT.theDevicePrefixIsMappedToFeatureHrByAFilterThatAlwaysPassesItThrough` | 25-08 |
| "Rate-limited per DEVICE (SN query param) so one device cannot exhaust a branch's budget" | True on `/iclock`. On `/internal/attendance/ingest` the serial is in the JSON body, so the resolver degrades to the literal key `"unknown"` — **one 120-request bucket shared by every bridge agent in every tenant on the platform** | `AdmsRegistrationDefectsIT.theBridgeRouteSharesOneRateLimitBucketAcrossEveryTenant` | 25-08 |
| `last_seen_at` — a device liveness column | Written on every call; read exactly once, by a DTO mapper; compared to nothing, by nothing. No threshold, no sweep, no reader outside the service | `AdmsLivenessDefectsIT.nothingInTheServiceComparesLastSeenAgainstAnyThreshold`, `.noFrontendCodeEverAsksForTheDeviceList` | 25-10 |
| `source_record_id` — "some firmwares carry a device record id in a later field" | Reads field index 4, which all three reference parsers call the **work code**. It is stored, never read, and is not an identifier | `AttlogLineParser.java:51` — **opinion, not a finding: no test pins it.** Re-measure in 25-05 before acting on it | 25-05 |

---

## Table three — MISSING

| What is absent | What it costs a payroll month | Added in |
|---|---|---|
| **Any path a stock terminal can walk.** The token is a query parameter; the terminal's menu offers Enable, Domain Name, Server Address, Server Port and proxy settings, and firmware generates the query string | The integration cannot be connected to the hardware it is for, by anyone, at all. This is the single largest finding of this plan | 25-08 (decided: D-25-06 → `both`) |
| Any device screen whatsoever — `frontend/` has zero references to the endpoint | A restaurant owner who buys a terminal is handed a curl command | 25-11 |
| A human-readable name column; there is only `model` | Four devices named "ZKTeco" and a UUID each | 25-03 (column), 25-09 (API), 25-11 (screen) |
| Rename, branch reassignment, re-enable, token rotation | A leaked token can only be dealt with by deleting the device and re-registering it under a serial it does not have | 25-03, 25-09 |
| Liveness / staleness detection | A terminal silent since the 3rd is discovered on the 30th, as a dispute with an employee rather than a maintenance ticket | 25-10 |
| Clock-skew measurement, though both columns exist precisely so it is measurable | A terminal drifting twenty minutes puts punches in the wrong shift window and corrupts every late-arrival calculation downstream | 25-10 |
| Per-device timezone — `Asia/Karachi` is a constant in the parser | A branch in another timezone silently records every punch five hours out | 25-03, 25-05 |
| Per-device handshake and sync settings — nine lines of string literal in a controller method, identical for every device in every tenant | "Auto-sync the terminals with the app" is, on this protocol, exactly these values. Today they are a decoration | 25-03 (columns), 25-07 (the handshake reads them) |
| Retention of a line the parser cannot read | The unpaid hour, by the one route D-25-03's quarantine does not cover | 25-05, 25-06 |
| Quarantine uniqueness — an unmapped ref is queued unconditionally, with no key | A device polling every 3–8 seconds with one unmapped user grows the queue without bound | 25-06 |
| A mapping surface beyond one dropdown at the bottom of the attendance page | The queue after 25-06 holds two kinds of entry and that table has a column for neither | 25-12 |
| A device simulator | Every question about this integration otherwise waits on a purchase | 25-02 |
| Branch-scoped authorization on device and quarantine operations | `EmployeeService` routes every read and write through the policy with the record's branch; `AttendanceDeviceService` and `QuarantineController` call it not at all | 25-09 |
| A circuit breaker that trips on a device-path fault — the `/iclock` route lists only 503, while the sibling HR route lists 500 and 503 | A 500 storm at poll cadence passes straight through the breaker | 25-04 |

---

## Is 25-CONTEXT right that "the protocol work is largely done and the gap is management, sync and visibility"?

**Half right, and the wrong half is load-bearing.** The protocol work genuinely is largely done — the
WORKS table is nineteen rows long and includes the parts that are hardest to get right: resolve-then-
bind ordering, constant-time comparison, a definer-context lookup that survives FORCE RLS,
idempotency proven over the wire, and quarantine that retains the raw line. That is a better
foundation than this repository's average.

But it is done **for a client we write ourselves**. No stock ZKTeco terminal can authenticate,
because the credential is a query parameter and the terminal's configuration menu has no field for
one. So the accurate sentence is not "the protocol is done and the management is missing" — it is
*the protocol is done and nothing sold as a biometric terminal can walk it*. Management, sync and
visibility are all genuinely missing too, and they are the larger volume of work; but they are not
the thing that would have made the user's terminal fail on the day they plugged it in. That is
D-25-06, decided during this phase as `both`, and built in 25-08.

**Two rows moved during verification, and both movements matter.**

*Out of DECORATIVE:* the plan expected two reproducing cases showing device-auth failures answered
`500 INTERNAL_ERROR`. Neither reproduces. Commit `174f24f`, landed hours before this plan ran, added
`HrExceptionHandler.handleDeviceAuth`, and both now answer 401 — verified live through the real
gateway and again over the wire here. `AdmsAuthDefectsIT` was therefore written the other way up, as
a regression guard on the fix. **Plan 25-04 inherits a smaller and different task than its plan
assumes**: the status code is done; the uniform-refusal property and the circuit-breaker status list
are not.

*Into DECORATIVE, unplanned:* the bridge route's rate limiter. The research recorded the resolver as
degraded; what re-measurement establishes is the blast radius — the fallback key is a literal
constant, so it is not one bucket per branch or per tenant but **one bucket for every bridge agent on
the platform**. That is a cross-tenant availability coupling, and it is the only finding here that is
worse than the document that predicted it.

One row is marked as an opinion rather than a finding: `source_record_id` reading the work-code
position. It is very probably wrong, no test pins it, and saying so is cheaper than pretending.
