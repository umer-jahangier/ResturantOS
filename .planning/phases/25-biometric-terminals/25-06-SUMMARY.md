---
phase: 25-biometric-terminals
plan: 06
subsystem: database
tags: [zkteco, adms, quarantine, idempotency, liquibase, rls, work-code, silent-data-loss]

requires:
  - phase: 25-biometric-terminals
    provides: "25-03's empty 034 changelog shell; 25-05's AttlogParseOutcome.Rejection and the two handoffs it left"
provides:
  - attendance_quarantine with a reason, a deduplication key and a uniqueness constraint over (device_id, dedup_key)
  - AttendanceQuarantineEntity.Reason — the union of the unmapped case and 25-05's four parse rejections
  - DISMISSED status with who, when and why enforced by the database, not only by the service
  - PunchIngestService.ingestRejection — the durable destination a parse Rejection did not have
  - PunchIngestService.dismissQuarantine and the interpretation-supplying resolveQuarantine
  - BatchTally.unaccounted() — the accounting invariant written down
  - attendance_punches.source_record_id renamed to work_code
  - PunchRetentionIT — 14 assertions over real HTTP, the central one a sum
affects: [25-07, 25-09, 25-12, 25-13]

tech-stack:
  added: []
  patterns:
    - "A nullability relaxation paired with a check constraint that is strictly stronger than the NOT NULL it replaces, and a changeset comment saying so"
    - "A migration that collapses the data its own defect produced, keeping the evidence rather than aborting or deleting"
    - "A deduplication key computed in Java and backfilled in SQL, keyed on epoch millis so the two cannot disagree about formatting"
    - "An exhaustive switch between two parallel enums, so a new value cannot compile without someone choosing its destination"

key-files:
  created:
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/PunchRetentionIT.java
    - .planning/phases/25-biometric-terminals/deferred-items.md
  modified:
    - services/hr-service/src/main/resources/db/changelog/v1.0.0/034-attendance-quarantine-reasons.xml
    - services/hr-service/src/main/java/io/restaurantos/hr/entity/AttendanceQuarantineEntity.java
    - services/hr-service/src/main/java/io/restaurantos/hr/entity/AttendancePunchEntity.java
    - services/hr-service/src/main/java/io/restaurantos/hr/repository/AttendanceQuarantineRepository.java
    - services/hr-service/src/main/java/io/restaurantos/hr/service/PunchIngestService.java
    - services/hr-service/src/main/java/io/restaurantos/hr/adms/AdmsBatchIngestService.java
  deleted: []

key-decisions:
  - "The collapse SUFFIXES pre-existing duplicates out of the uniqueness namespace and marks them RESOLVED, rather than deleting them. They are the evidence that the defect was real, and a full uniqueness constraint is worth more than a partial one scoped to PENDING — a partial one would let a replay silently undo a dismissal."
  - "Epoch millis in the key, not a rendered timestamp. The backfill and the Java must produce a byte-identical string; a number cannot disagree with itself about fractional seconds, offsets or locales. Verified: Postgres wrote 1786507200000 and Instant.toEpochMilli() returns 1786507200000."
  - "SHA-256 for the raw-line key, not String.hashCode. 32 bits collide by accident within what one misconfigured terminal emits in a week, and a collision here silently discards a line — the exact failure this plan removes."
  - "A rejection goes in the SAME queue, distinguished by a reason. A second table is where an unpaid hour goes to be technically retained."
  - "resolution_note is separate from dismissal_reason. Overloading the one column an audit reads with machine-written text makes it ambiguous about who wrote it."

patterns-established:
  - "Assert the accounting as a SUM. A per-case assertion passes while a line quietly falls between two cases — which is how a rejected line produced no row for as long as it did, with every test green."

requirements-completed: [BIO-04, BIO-05, HR-07]

coverage:
  - id: D1
    description: "A replayed batch of unmapped punches does not grow the queue — the guarantee D-25-05 gave punches now covers the surface a person has to clear"
    requirement: "BIO-05"
    verification:
      - kind: integration
        ref: "PunchRetentionIT.theSameUnmappedPunchSentThreeTimesWritesExactlyOneQueueEntry, .mixedBatchOfTenAccountsForEveryLineOverThreeReplays, .anOfflineFlushOfTwentyRecordsReplayedLeavesTheSameRows"
        status: pass
    human_judgment: false
  - id: D2
    description: "A line the parser could not interpret is retained with its raw text and surfaced in the same queue, never discarded"
    requirement: "BIO-04"
    verification:
      - kind: integration
        ref: "PunchRetentionIT.anUninterpretableLineIsRetainedVerbatimWithNoReferenceAndNoInstant, .everyRejectionReasonReachesTheQueueAndReplayingThemAddsNothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "An uninterpretable entry is resolved by an administrator's reading, never by a service's guess; a dismissal carries a name and a reason, enforced by the table"
    requirement: "BIO-04"
    verification:
      - kind: integration
        ref: "PunchRetentionIT.resolvingAnUninterpretableEntryIsRefusedWithoutAnInterpretationAndSucceedsWithOne, .dismissalRecordsWhoAndWhy_writesNoPunch_andIsRefusedWithoutAReason, .theDatabaseItselfRefusesADismissalWithNoNameAndNoReason"
        status: pass
    human_judgment: false
  - id: D4
    description: "The migration applies to a database that already contains the duplicates the defect produced"
    requirement: "HR-07"
    verification:
      - kind: manual_procedural
        ref: "throwaway database at the pre-034 shape seeded with five copies of one punch: 6 rows in, 2 PENDING out, 4 retained as evidence, the genuinely different punch untouched — transcript in this summary"
        status: pass
    human_judgment: false

duration: 150min
completed: 2026-08-12
status: complete
---

# Phase 25 Plan 06: Three Destinations And No Fourth Summary

**The queue D-25-03's whole promise rests on had no uniqueness constraint of any kind while the punch table beside it had one — so a terminal replaying its offline buffer grew it one row per unmapped punch per replay, without bound. It now deduplicates, it now holds the lines nobody could read, and no entry leaves it without a person's name on the decision.**

## Performance

- **Duration:** ~150 min · **Tasks:** 3 of 3
- **Files created:** 2 · **modified:** 6
- **Tests:** hr-service **113/114** integration + 33 unit. `PunchRetentionIT` 14/14. The single failure is another plan's, recorded in `deferred-items.md`.

## What was actually wrong

| | Before | Now |
|---|---|---|
| A device replays one unmapped punch five times | five queue rows, five times the work | one row |
| A line the parser cannot read | a counted warning and no row anywhere | a queue entry with the reason and the line verbatim |
| An entry cleared by an administrator | status flipped, nobody recorded | dismissal carries the actor, the instant and a reason, enforced by the table |
| Field 4 of an ATTLOG line | `source_record_id` | `work_code` |

The rejection half is 25-05's second handoff. That plan replaced an empty `Optional` — indistinguishable from a line never sent — with a named `Rejection`, and said plainly that a counted warning with no home is a smaller hole rather than no hole. This closes it.

## The migration, against a database that already contained the defect's output

`AttendanceQuarantineSchema`-shaped throwaway database, seeded with **one unmapped punch replayed five times** plus one genuinely different punch, then changelog 034's SQL extracted **verbatim from the changeset** and applied:

```
  status  |        reason        |             dedup_key              |            resolution_note
----------+----------------------+------------------------------------+---------------------------------------
 PENDING  | UNMAPPED_DEVICE_USER | REF:9001@1786507200000             |
 PENDING  | UNMAPPED_DEVICE_USER | REF:9001@1786537800000             |
 RESOLVED | UNMAPPED_DEVICE_USER | REF:9001@1786507200000#collapsed-0 | Collapsed by migration 034: a duplicate…
 RESOLVED | UNMAPPED_DEVICE_USER | REF:9001@1786507200000#collapsed-5 | Collapsed by migration 034: a duplicate…
 RESOLVED | UNMAPPED_DEVICE_USER | REF:9001@1786507200000#collapsed-9 | Collapsed by migration 034: a duplicate…
 RESOLVED | UNMAPPED_DEVICE_USER | REF:9001@1786507200000#collapsed-9 | Collapsed by migration 034: a duplicate…
```

Six rows in, **two pending out**, four kept as evidence, the 17:30 punch untouched, and the migration did not fail — which was the requirement, because a migration that aborts on the data its own defect produced is unrunnable exactly where it is most needed.

Every constraint refuses what it must, proven by trying each:

```
UNMAPPED_DEVICE_USER with no reference  -> ck_attendance_quarantine_unmapped_has_identity
TOO_FEW_FIELDS with no raw line         -> ck_attendance_quarantine_rejection_has_evidence
a second row with the same device+key   -> uk_attendance_quarantine_dedup
status='DISMISSED' with no name/reason  -> ck_attendance_quarantine_dismissal
reason='SOMETHING_NEW'                  -> ck_attendance_quarantine_reason
```

RLS after the migration: `relrowsecurity = t, relforcerowsecurity = t`. No new table, so `RlsForcedInvariantIT` has nothing new to guard. `attendance_punches.work_code` present, `source_record_id` gone. The rollback returns the table to its exact pre-034 shape.

**The one cross-check that mattered most:** the deduplication key is computed in Java at ingest time and backfilled in SQL at migration time, and if the two ever disagreed a punch already in the queue would silently acquire a second row the first time it was replayed after deployment. Postgres wrote `1786507200000`; `Instant.toEpochMilli()` returns `1786507200000`.

## The accounting, over the wire

`PunchRetentionIT` posts a ten-line batch three times and asserts the **sum**, not the cases:

```
3 mapped punches | 1 repeat of one of them | 2 unmapped | 1 repeat of one of those | 3 unreadable lines
                        punches + queue entries = 10 - 3 duplicates, after every replay
                        events published = 3, after every replay
```

A per-case assertion passes while a line quietly falls between two cases. That is not hypothetical: it is exactly how a rejected line produced no row for as long as it did, with every existing test green.

Also asserted: a twenty-record offline flush replayed, a descending-order batch storing the same rows as the ascending one (nothing depended on order, and nothing said so), and that no refused or duplicate path publishes an event.

## Deviations from Plan

**1. [Rule 2 — missing critical] `ck_attendance_quarantine_rejection_has_evidence`.** The plan requires the raw line never be dropped on a rejected entry and enforces the mirror case (a reference-bearing reason must carry a reference) in the database. The evidence direction had no constraint at all. An entry whose raw line is null is one an administrator cannot act on — the same hole, from the other side.

**2. [Rule 2] `resolution_note`, one column beyond the plan's list.** The plan asks the migration to mark collapsed duplicates "with a note" and provides no column to put one in. Reusing `dismissal_reason` would put machine-written text in the one column an audit reads to find out who decided not to pay somebody.

**3. Collapsed duplicates are suffixed, not left colliding.** The plan says keep the earliest and mark the rest resolved. Marking alone is not enough: the uniqueness constraint is over `(device_id, dedup_key)` regardless of status, so the marked rows would fail it. The alternatives were a partial index scoped to `PENDING` — which would let a replay silently re-queue a **dismissed** entry, undoing somebody's recorded decision — or deleting the rows. Suffixing keeps the evidence and the full constraint.

**4. `BatchTally.yieldedNothing()` became `unaccounted()`.** The old warning fired when a non-empty body produced nothing, which after this plan cannot happen — every line reaches a destination. Replacing it with the invariant that actually matters (`inserted + duplicates + quarantined + rejected == lines`) keeps a signal where there would otherwise be a permanently-false condition nobody would notice had stopped meaning anything. It logs rather than throws: a batch already partly written must still be acknowledged, and throwing would trade a counting bug for a data-loss bug.

**5. [Rule 3 — blocking, twice, neither mine] hr-service would not build or start because of another agent's in-flight work.** `015-employee-department-designation-fk.xml` had an unescaped `<` in an XML comment-free region (blocked every hr-service integration test module-wide) and `EmployeeService`/`EmployeeEntity` were mid-refactor. I waited rather than editing files another agent was holding; both were fixed by their owner within minutes. **No file of theirs was touched.**

## The live stack could not be used, and that is worth reading

25-06 was verified against a real Postgres 18.4 and a real HTTP stack in the test harness, but **not against the running dev stack**, because hr-service cannot start. Restarting it onto the fresh jar surfaced a **blocking defect in plan 35-05's committed changeset `015b`**:

```
Migration failed for changeset 015-employee-department-designation-fk.xml::hr-1.0.0-015b-backfill-from-free-text
Reason: ERROR: invalid input syntax for type uuid: ""
  Where: SQL statement "SELECT DISTINCT tenant_id FROM employees"
```

Its changeset comment states the assumption that fails: *"Liquibase runs as hr_user with NO tenant context."* The connection carries the **empty string**, not no value, and every hr policy casts that GUC to `uuid` unguarded. `HrTestBase` migrates an **empty** `employees` table, so the driving loop iterates zero times and the failure is structurally invisible under test.

**There is a worse defect underneath it, and it is why I did not paper over the first one.** `employees` is FORCE RLS, so even with the GUC unset that driving query returns zero rows to `hr_user` — the backfill cannot see the tenants it is meant to iterate — and `015c` then drops the free-text columns believing it ran. On the current dev database nothing is lost (`count(department) = 0`); on a customer database that is a green migration followed by silent data loss. A one-line patch stopping the *error* would hand `015c` a green light. Fixing it properly needs a `SECURITY DEFINER` helper or an administrative connection, which is a design decision inside 35-05 and touches what `verify-security-definer-owners.sh` audits.

Full reproduction in `deferred-items.md`. **hr-service is currently down and this is on committed HEAD — the next restart by any agent hits it regardless of 25-06.**

## Handoffs

- **To 25-09:** the queue's API surface is `resolveQuarantine(id, employeeId)`, `resolveQuarantine(id, employeeId, SuppliedInterpretation(deviceUserRef, deviceReportedAt, punchType))`, and `dismissQuarantine(id, reason)`. The acting user comes from `TenantContext`, never from a request field. Repository queries exist for pending-by-tenant, pending-by-reason and pending-by-device.
- **To 25-12:** `raw_line` is stored **verbatim and unescaped** — it is attacker-controlled text from an unauthenticated device, and escaping it at render is that plan's acceptance criterion (T-30-06-E). The screen needs two distinct actions, resolve and dismiss, and dismissal must collect a reason before it will submit.
- **To 25-13:** `scripts/adms-sim/scenarios.py`'s replayed-batch, offline-flush and malformed-line scenarios are reproduced as in-process shapes here, so the live run and this test agree by construction rather than by coincidence.

## Hardware sign-off (D-25-04)

**Requires U5: nothing.** Whether a particular firmware emits a line shape this parser rejects is a hardware question; the consequence of it doing so is settled here, which is the point of fixing the destination before knowing the input.

## Self-Check: PASSED

`PunchRetentionIT.java` and `deferred-items.md` verified present. Commits `f3e02245` and `1fadb8b4` verified in HEAD. `AttendanceIngestController.java` verified **unmodified** — the bridge-agent ingest path gained the same deduplication from one change with no edit of its own, which was an acceptance criterion. `AdmsHttpContractIT` (25-01's frozen baseline) verified unmodified and still 8/8.
