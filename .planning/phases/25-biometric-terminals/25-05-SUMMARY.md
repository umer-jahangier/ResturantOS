---
phase: 25-biometric-terminals
plan: 05
subsystem: api
tags: [zkteco, adms, iclock, servlet-filter, parser, timezone, silent-data-loss]

requires:
  - phase: 25-biometric-terminals
    provides: "25-03's device_timezone column; 25-01's AdmsBodyDefectsIT; 25-08's AdmsRequestContext"
provides:
  - DeviceBodyPreservingFilter — a device-chosen Content-Type can no longer discard a batch
  - AttlogParseOutcome — a sealed Punch-or-named-Rejection; the parser can no longer return nothing
  - AttlogLineParser reading the device's own timezone, accepting epochs, minimum two fields
  - AdmsBatchIngestService with a per-batch tally and a zero-yield warning
  - AdmsBodyContractIT — six wire-level assertions replacing the four pinned defects
affects: [25-06, 25-07, 25-12, 25-13]

tech-stack:
  added: []
  patterns:
    - "Prevent the consumption rather than reconstruct after it: cache the body in a prefix-scoped filter"
    - "A sealed outcome type instead of Optional, so a new silent-discard path must name itself"
    - "Decode request bodies with an explicit charset — never the platform default"

key-files:
  created:
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/AttlogParseOutcome.java
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/AdmsBatchIngestService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/config/DeviceBodyPreservingFilter.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AttlogLineParserTest.java
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsBodyContractIT.java
  modified:
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/AttlogLineParser.java
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/AdmsController.java
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/AdmsRequestContext.java
    - services/hr-service/src/test/java/io/restaurantos/hr/AdmsIngestIT.java
  deleted:
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AdmsBodyDefectsIT.java

key-decisions:
  - "Prevention over reconstruction. Rebuilding the body from the parsed parameter map is lossy exactly where it matters: an ATTLOG line containing = or & would be mangled, and the parser could not tell damage-in-transit from damage-on-the-wire."
  - "An epoch timestamp takes NO timezone. It already names an instant; applying the device offset would move every such punch by hours and leave a plausible-looking time behind."
  - "sourceRecordId renamed to workCode in Java only. The COLUMN rename is handed to 25-06, which owns the ingest migration."
  - "The wire reply is unchanged in every case, including zero-yield. A zero-yield batch becomes visible on the server, never in what the device is told."

patterns-established:
  - "A batch tally (inserted / duplicate / quarantined / rejected) so a batch that produced nothing cannot be silent"

requirements-completed: [BIO-04, HR-07]

coverage:
  - id: D1
    description: "A Content-Type the device chose can no longer decide whether a punch exists"
    requirement: "BIO-04"
    verification:
      - kind: integration
        ref: "AdmsBodyContractIT.plainTextFormEncodedAndNoContentTypeAllWriteTheSameRows"
        status: pass
    human_judgment: false
  - id: D2
    description: "The parser reports outcomes instead of vanishing; two-field lines, epochs and per-device zones all work"
    requirement: "BIO-04"
    verification:
      - kind: unit
        ref: "AttlogLineParserTest — 9/9, no container"
        status: pass
      - kind: integration
        ref: "AdmsBodyContractIT — 6/6 over real HTTP incl. the two-zone and epoch cases"
        status: pass
    human_judgment: false

duration: 70min
completed: 2026-08-12
status: complete
---

# Phase 25 Plan 05: The Upload Path Stops Losing Punches Summary

**Three silent-loss paths are gone: a form-encoded POST now writes the same rows as plain text, a firmware that emits three fields is no longer discarded entirely, and a device abroad is read in its own time.**

## Performance

- **Duration:** ~70 min · **Tasks:** 3 of 3
- **Files created:** 5 · **modified:** 4 · **deleted:** 1
- **Tests:** hr-service **86/86** integration (was 73), plus the 9-case parser unit test

## What was actually wrong

Each of these ended with HTTP 200, the two-character acknowledgement the device waits for, **zero rows written, and nothing logged**. The terminal then deletes its offline buffer, because as far as it knows the punches were delivered. Nobody finds out until an employee disputes a payslip.

| Path | Now |
|---|---|
| Form-encoded POST → container drains the body, binding sees an empty stream | `DeviceBodyPreservingFilter` caches the body before anything parses a parameter |
| Fewer than four fields → discarded (reference parser accepts two) | Minimum is two; a missing status is `UNKNOWN`, not a missing row |
| Unix epoch timestamp → unparseable, discarded | Parsed, and deliberately with **no zone applied** |
| Unparseable line → empty `Optional`, indistinguishable from never sent | Named `Rejection` carrying the raw line verbatim |
| `Asia/Karachi` compiled into the parser | The device's own zone, from 25-03's column |

**The cloud deployment makes this worse, not better.** A terminal on a flaky domestic connection retries more often and has more chance of believing a lie.

## Deviations from Plan

**1. [Rule 3 — blocking] The module would not compile, twice, for reasons that were not mine.** `HrConfigAuthorizationIT` — an untracked file another agent was mid-writing — was missing `import java.util.Map`, blocking every agent working in hr-service. I waited ~8 minutes rather than editing someone's in-flight file, then added the single import when it was clear they had moved on. Purely additive; it cannot change their intent. **The owning agent should know.**

**2. [Rule 1 — mine] `AdmsIngestIT` broke on my own signature change.** `cdataUpload` now takes `HttpServletRequest` instead of a bound `String body`. Five call sites updated to pass a `MockHttpServletRequest` carrying the body, with a comment recording what that makes visible: **this class cannot see the defect 25-05 fixed at all**, because the container is not in the picture. That is precisely why `AdmsBodyContractIT` exists.

**3. `AdmsRequestContext` already existed.** 25-08 built it first (25-05 had not run). Extended with the per-request `Captured` record the plan specifies, rather than duplicated.

## Handoffs

- **To 25-06:** the `source_record_id` **column** rename to `work_code`. All three reference parsers call position 4 the work code; the old name backed a comment proposing it for idempotency, which would have deduplicated two genuinely different punches sharing a work code. Java is renamed; the migration is 25-06's because it owns the ingest changelog.
- **To 25-06:** `AttlogParseOutcome.Rejection` currently gets a counted warning and no durable destination. 25-06 owns giving it one — D-25-03 says a line is never dropped, and until then this is a smaller hole rather than no hole.

## Self-Check: PASSED

All five created files verified present. `AdmsBodyDefectsIT` verified absent. `AdmsHttpContractIT` verified **unmodified** (`git status --porcelain` empty) — 25-01's frozen baseline is intact and still 8/8. Full suite 86/86 in one run.
