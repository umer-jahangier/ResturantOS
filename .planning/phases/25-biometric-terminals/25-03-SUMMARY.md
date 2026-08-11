---
phase: 25-biometric-terminals
plan: 03
subsystem: database
tags: [liquibase, postgres, rls, jpa, zkteco, adms, attendance-devices, schema]

requires:
  - phase: 25-biometric-terminals
    provides: "25-01's inventory, which named every missing property this plan gives a home to"
provides:
  - eighteen columns on attendance_devices covering identity, locale, liveness, clock discipline, sync configuration, authentication mode and lifecycle
  - AttendanceDeviceEntity.AuthMode and .HealthState enums
  - findSilentDevices — the per-device-cadence silence query, in SQL
  - archived-aware lookups as two distinct named methods
  - two empty changelog shells (034, 035) pre-wired to the master so no wave-3 plan edits it
affects: [25-05, 25-06, 25-07, 25-08, 25-09, 25-10, 25-11]

tech-stack:
  added: []
  patterns:
    - "Every added column is nullable or defaults to the value the code produces today, so migrating changes no existing device by a single character"
    - "Thresholds are stored; derived values are not — max_clock_skew_seconds is a column, skew never is"
    - "Two named lookups instead of one with a boolean: findByIdAndTenantIdAndArchivedAtIsNull vs findByIdAndTenantIdIncludingArchived"
    - "Same-wave migration collision avoided by creating empty-but-valid changelog shells up front and wiring all includes once"

key-files:
  created:
    - services/hr-service/src/main/resources/db/changelog/v1.0.0/033-attendance-device-management.xml
    - services/hr-service/src/main/resources/db/changelog/v1.0.0/034-attendance-quarantine-reasons.xml
    - services/hr-service/src/main/resources/db/changelog/v1.0.0/035-device-command-queue.xml
    - services/hr-service/src/test/java/io/restaurantos/hr/adms/AttendanceDeviceSchemaIT.java
  modified:
    - services/hr-service/src/main/resources/db/changelog/db.changelog-master.xml
    - services/hr-service/src/main/java/io/restaurantos/hr/entity/AttendanceDeviceEntity.java
    - services/hr-service/src/main/java/io/restaurantos/hr/repository/AttendanceDeviceRepository.java

key-decisions:
  - "auth_mode DEFAULT 'TOKEN' — the mode in force today. D-25-06 forbids a migration relaxing how an existing device authenticates, and this default is that prohibition made mechanical."
  - "Two extra columns beyond the plan — last_refused_source_address and last_refused_at — required by 25-AUTH-MODES.md's added constraint, so 25-08 needs no schema change of its own."
  - "Skew is derived, never stored. A stored third value is a fact that can disagree with its own inputs."
  - "Empty changelog shells 034 and 035 created and wired now, so 25-06 and 25-07 can stay in the same wave."

patterns-established:
  - "A column added by a schema plan names the plan that reads it, in the changeset and in the entity"

requirements-completed: [BIO-01, BIO-02, BIO-03, HR-07]

coverage:
  - id: D1
    description: "A terminal can be named, located in time, expected on a cadence, configured for sync, assigned an authentication mode, and archived — with none of it changing how any existing device behaves"
    requirement: "BIO-01"
    verification:
      - kind: integration
        ref: "AttendanceDeviceSchemaIT.everyAddedColumnRoundTripsThroughTheEntity, .aDeviceSavedWithoutTouchingAnyNewFieldGetsTodaysBehaviourExactly"
        status: pass
    human_judgment: false
  - id: D2
    description: "The query that will make silence loud exists and is tested before the sweep that calls it is written"
    requirement: "BIO-02"
    verification:
      - kind: integration
        ref: "AttendanceDeviceSchemaIT — four silence cases: overdue vs within, never-contacted first, shorter interval outranks longer, archived and deactivated excluded"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolve_device survives the table-shape change — its return type follows attendance_devices"
    requirement: "HR-07"
    verification:
      - kind: integration
        ref: "DeviceAuthResolverIT + AdmsHttpContractIT (both resolve a real serial post-migration); bash deploy/scripts/verify-security-definer-owners.sh against the live dev stack — checked=4 repaired=0 failed=0"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-08-11
status: complete
---

# Phase 25 Plan 03: Device Management Schema Summary

**Eighteen columns give a terminal the properties a person managing terminals needs it to have — and every default is byte-identical to what the code did before, so the migration changed no device's behaviour by a single character.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 2 of 2
- **Files created:** 4 · **modified:** 3
- **Tests:** 53/53 hr-service suite green (8 new)

## Every column added, and the plan that reads it

A column with no named reader is exactly the shape of `last_seen_at`, which this phase exists partly to fix. So:

| Column | Purpose | Read by |
|---|---|---|
| `display_name` | a name a human chose; `model` is not a name | 25-09, 25-11 |
| `device_timezone` (def. `Asia/Karachi`) | the zone a device's reported times are in | **25-05** — the parser stops using a compiled-in zone |
| `expected_contact_interval_seconds` (def. 900) | this device's own cadence | **25-10**, 25-11 |
| `health_state` (def. `UNKNOWN`) | never-seen / healthy / silent / clock-skewed | **25-10**, 25-11 |
| `silent_since` | when silence *started*, so an alert fires on the transition | **25-10** |
| `max_clock_skew_seconds` (def. 300) | the tolerance; the skew itself is never stored | **25-10** |
| `realtime_push` (def. true) | handshake `Realtime=` | **25-07** |
| `poll_delay_seconds` (def. 30) | handshake `Delay=` | **25-07** |
| `error_delay_seconds` (def. 30) | handshake `ErrorDelay=` | **25-07** |
| `transfer_interval_minutes` (def. 1) | handshake `TransInterval=` | **25-07** |
| `transfer_times` (def. `00:00;14:05`) | handshake `TransTimes=` | **25-07** |
| `transfer_flag` (def. `1111000000`) | handshake `TransFlag=` | **25-07** |
| `auth_mode` (def. `TOKEN`) | D-25-06 credential policy | **25-08** |
| `source_address_allowlist` | required non-empty for any secret-less mode | **25-08** |
| `last_refused_source_address` | the address a refusal was actually seen from | **25-08**, 25-11 |
| `last_refused_at` | when | **25-08**, 25-11 |
| `archived_at` | removal as a recorded event, not an overloaded flag | 25-09, 25-11 |
| `token_rotated_at` | so 25-10 reports post-rotation silence as a consequence, not a fault | **25-10**, 25-09 |

Plus `idx_attendance_devices_liveness` on `(tenant_id, archived_at, last_seen_at)` — the sweep's access path.

## Live verification

The migration was applied to the running dev database and hr-service restarted on the rebuilt jar (`check-stale-jars.sh` → `checked=15 stale=0`).

```
psql hr_db \d attendance_devices
  → 27 columns, all eighteen new ones present with the defaults above
  → Policies (forced row security enabled): POLICY "tenant_isolation"     ← untouched

bash deploy/scripts/verify-security-definer-owners.sh
  OK hr_db: public.resolve_device owner=postgres, definer context resolves a real row as hr_user
  checked=4 repaired=0 failed=0

GET /iclock/cdata?SN=UNKNOWN-DEVICE-999&options=all&pushver=2.4.0   → 401 DEVICE_AUTH_FAILED
```

`resolve_device` is declared `RETURNS SETOF attendance_devices`, so its row type follows this table and this was the first change to that table since it was written. It survived: verified in the harness by `DeviceAuthResolverIT` and `AdmsHttpContractIT`, and against the live database by the ownership verifier resolving a real row.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 1 — Bug] The silence query failed at runtime with a type error the compiler could not see.**

- **Found during:** Task 2, first run — four of eight cases errored with `operator does not exist: timestamp with time zone < interval`.
- **Cause:** a bare `:asOf` bind parameter reaches Postgres untyped, so `:asOf - make_interval(...)` resolved against the wrong operator. The query compiled and would have deployed cleanly.
- **Fix:** explicit `CAST(:asOf AS timestamptz)` at both use sites, with a comment saying why it is not decorative.

### Additions beyond the plan

**2. Two columns the plan did not list: `last_refused_source_address` and `last_refused_at`.** `25-AUTH-MODES.md` adds one constraint beyond the plan's four — a device refused for a source-address mismatch must record the observed address on its own row, and the device screen must offer a one-click "allow this address". Adding those columns here rather than in 25-08 keeps that plan a change of policy rather than a change of schema, which was this plan's whole purpose.

**3. `HealthState` includes `CLOCK_SKEWED`.** The plan asked for a health state and separately for a skew threshold, without saying what happens when the threshold is crossed. A device whose clock has drifted is a distinct fault from one that has gone quiet — it is talking, and lying about when — so it gets its own state rather than being folded into `SILENT`. 25-10 sets it.

### Naming deviation

**4. Plan bodies say `30-NN`; this summary uses `25-NN`.** The phase was renumbered on the day the plans were written.

## What this plan deliberately did NOT do

**It adds no behaviour.** Nothing reads `device_timezone`, `auth_mode`, or any sync column yet — those are 25-05, 25-07 and 25-08. Stating that plainly is the point: this plan is a set of places, and the table above is the audit that each place has an owner.

`RlsForcedInvariantIT` — this plan creates **no new table**, so there is nothing new for it to guard. `attendance_devices` was already `ENABLE`d and `FORCE`d in changelog 011 and this changeset does not touch that. Verified live: `Policies (forced row security enabled)` still present.

## Hardware sign-off (D-25-04)

**Requires U5: nothing.** One item is *informed* by hardware without waiting on it: `transfer_flag` accepts either observed encoding, and its column comment records both plus the consequence of choosing wrong — a device that connects, handshakes, reports healthy and uploads nothing. When a physical unit settles which encoding its firmware honours, the answer is a row update rather than a code change. That is the point of making it a column.

## Self-Check: PASSED

All four created files exist. Migration verified applied against the live `hr_db`. Full hr-service suite 53/53 in one run. `HrTestBase` verified unmodified by this plan (`git status --porcelain` empty for it).
