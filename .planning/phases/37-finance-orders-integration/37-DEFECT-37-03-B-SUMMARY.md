---
phase: 37-finance-orders-integration
plan: DEFECT-37-03-B
subsystem: etl
tags: [clickhouse, timezone, data-corruption, analytics, backfill]
requires:
  - phase: 37-03
    provides: the measurement that found the drift
provides:
  - "AnalyticsInstant.utc() — the one seam for binding an Instant to a DateTime64(3,'UTC') column"
  - "scripts/ops/phase37-repair-analytics-utc-drift.py — idempotent, source-derived backfill"
  - "AnalyticsInstantBindingIT — a zone-forcing regression guard on all three ETL writers"
affects: [37-06, 37-07, 37-12, 37-13, 37-14]
tech-stack:
  added: []
  patterns:
    - "One binding seam for analytics instants, mirroring the one-formatter rule for money"
    - "Data repair derives the correct value from the source of truth, never a blanket offset"
    - "A timezone test forces a non-UTC JVM zone, or it cannot fail"
key-files:
  created:
    - services/reporting-service/src/main/java/io/restaurantos/reporting/etl/AnalyticsInstant.java
    - services/reporting-service/src/test/java/io/restaurantos/reporting/etl/AnalyticsInstantBindingIT.java
    - scripts/ops/phase37-repair-analytics-utc-drift.py
  modified:
    - services/reporting-service/src/main/java/io/restaurantos/reporting/etl/SalesFactWriter.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/etl/TillSessionFactWriter.java
    - services/reporting-service/src/main/java/io/restaurantos/reporting/etl/PurchaseTaxFactWriter.java
    - services/reporting-service/src/test/java/io/restaurantos/reporting/etl/EtlPipelineIT.java
key-decisions:
  - "The recorded diagnosis was wrong and its implied fix was also wrong — corrected in STATE.md"
  - "Bind OffsetDateTime, not LocalDateTime: both measure correct, only one carries its own offset"
  - "Backfill to the source event's instant, not minus-five-hours, so the repair is idempotent"
metrics:
  duration: ~1h
  completed: 2026-08-12
status: complete
---

# Phase 37 DEFECT-37-03-B: Analytics facts stored local wall-clock in UTC columns — Summary

Every analytics fact in ClickHouse sat exactly five hours in the future, so every time-of-day
report over them was wrong — including the daily-takings screen that shipped in 37-12, which is a
time-of-day report and the first number an owner looks at each day. Writers fixed at a single new
seam, all 44 rows backfilled from their source events, verified live.

## What was actually wrong

The defect was real and reproduced exactly. **Its recorded diagnosis was not.**

STATE.md said `SalesFactWriter:47` "passes `Timestamp.from(instant)` to JDBC with no `Calendar`, so
the driver renders it in the JVM's default zone". The implication is that adding a UTC `Calendar`
fixes it. Measured against live ClickHouse 25.9 / clickhouse-jdbc 0.8.6 in `Asia/Karachi`, binding
`2026-07-16T14:30:00.932Z`:

| Binding | Stored | Verdict |
|---|---|---|
| `ps.setTimestamp(i, ts)` | 14:30:00.932 | CORRECT — the driver was never the problem |
| `ps.setTimestamp(i, ts, utcCalendar)` | 19:30:00.932 | **+5h WRONG** — the "obvious fix" |
| `ps.setObject(i, ts)` | 19:30:00.932 | +5h WRONG |
| `ps.setObject(i, LocalDateTime @UTC)` | 14:30:00.932 | CORRECT |
| `ps.setObject(i, OffsetDateTime @UTC)` | 14:30:00.932 | CORRECT |
| `jdbcTemplate.update(sql, ts)` | 19:30:00.932 | **+5h WRONG** — the production path |
| `jdbcTemplate.update(sql, OffsetDateTime)` | 14:30:00.932 | CORRECT |

Spring never calls `setTimestamp`. `StatementCreatorUtils.isDateValue()` explicitly *excludes*
`java.sql.Timestamp`, so a `Timestamp` argument falls through to `ps.setObject()`, which this
driver renders in the JVM default zone; the `DateTime64(3,'UTC')` column then reads that
wall-clock as UTC.

The bug lives in the **seam between Spring and the driver**, not in either alone. That is why
reading the code could not settle it — and why the first probe I wrote, which called `setTimestamp`
directly, reported the writer as CORRECT and briefly contradicted the observed corruption. Only
driving the actual `JdbcTemplate` path reproduced it.

## Scope was wider than recorded

Not just `SalesFactWriter`. **All three** ETL writers had it, across **all four**
`DateTime64(3,'UTC')` columns:

| Table | Column | Rows | Drift |
|---|---|---|---|
| `sales_order_facts` | `closed_at` | 11 | +5.00h on 11/11 |
| `sales_item_facts` | `closed_at` | 12 | +5.00h on 11 events |
| `till_session_facts` | `closed_at` | 1 | +5.00h on 1/1 |
| `purchase_tax_facts` | `matched_at` | 20 | +5.00h on 20/20 |

Zero rows were already correct; zero lacked a source event.

The note's "73 of 73 sampled rows" does not correspond to anything now in the database — the tables
held 44 rows. The +5h finding itself reproduced exactly, so this is a bookkeeping discrepancy in
the note, not a disagreement about the defect.

## The fix

All three writers now route through one seam, `AnalyticsInstant.utc()` — the same principle the
project already applies to money, where a second formatting path is forbidden.

It returns an `OffsetDateTime` rather than a `LocalDateTime`. Both measure correct today, but a
zoneless value is only *accidentally* right: it depends on the column staying UTC-typed, and it
reads to a human as "some local time". An `OffsetDateTime` carries its own offset, so no driver
and no JVM default zone can reinterpret it.

## Why it survived, and what now stops it

**No test in the suite had ever read a timestamp column back.** Four green ETL tests asserted money
and `business_date` only. `business_date` is written as a separate parameter and was correct, so
the one date-ish assertion in the suite actively looked fine.

Two assertions now exist, and **both were demonstrated to fail on the old code** (18 000 000 ms
out — the failure message names the drift and the JVM zone):

- `EtlPipelineIT.orderClosed_landsOrderAndItemFacts` — end to end through RabbitMQ.
- `AnalyticsInstantBindingIT` — drives the real writers against a real ClickHouse with **the JVM
  default zone forced to `Asia/Karachi`**. Forcing the zone is the point: this defect is invisible
  to a suite that inherits a UTC CI zone, so an unforced test would pass on a broken build. It
  carries a precondition test (`jvmZoneIsNotUtc_soThisSuiteCanActuallyFail`) that fails loudly if
  that ever stops being true.

Both tests use an *afternoon* instant deliberately, so a +5h error stays on the same calendar day
and cannot be masked by a `business_date` assertion.

## The backfill

`scripts/ops/phase37-repair-analytics-utc-drift.py`, dry-run by default, `--apply` to write.

It corrects each row to the instant carried by **the event that produced it**, read from the
producing service's `event_outbox` and joined on `event_id` — not by subtracting five hours. A
blanket shift is not idempotent (run it twice and the data is ten hours out, with nothing to say
so) and would corrupt any row written correctly after the writer fix. Source-derived correction is
idempotent, self-verifying, and a no-op on rows already right.

Rows whose source event cannot be found are left untouched and listed. Guessing a timestamp to
make a table look uniform is what D-37-05 forbids.

Ordering used: stopped the old service so no write could race the repair → rebuilt → applied →
restarted the fixed service.

### Verification, four independent ways

1. **Script re-read** after applying: 44 correct, 0 drifted.
2. **Second dry run**: no-op — confirms idempotency.
3. **Independent cross-check**: all 11 `sales_order_facts` match `pos_db.orders.closed_at` to the
   millisecond, compared outside the script's own logic.
4. **Live end-to-end**: an `ORDER_CLOSED` replayed through the live RabbitMQ into the rebuilt
   service stored `drift_ms = 0`. Probe row deleted afterwards (0 remaining), on a throwaway
   tenant that could not perturb a real report even before cleanup.

`scripts/check-stale-jars.sh` confirms `reporting-service` is running the rebuilt jar.

## Deviations from Plan

**[Rule 1 — Bug] The recorded root cause was wrong.** Implementing it as written would have
shipped a still-broken writer believed to be fixed, because the prescribed fix (a UTC `Calendar`)
is itself +5h wrong. Corrected in STATE.md with the measurements, rather than quietly fixed.

**[Rule 2 — Missing critical functionality] Two writers beyond the one named.**
`TillSessionFactWriter` and `PurchaseTaxFactWriter` had the identical defect and were not in the
note. Fixing only `SalesFactWriter` would have left 21 of 44 rows corrupt.

## Known limitations

- The repair covers the rows present on **this** deployment. Any other environment must run the
  script itself; it is safe to run anywhere because it is source-derived and idempotent.
- `purchase_tax_facts.matched_at` feeds the FBR tax summary, which aggregates by `business_date`
  rather than time of day, so its corruption had less user-visible effect than the sales facts'.
  It was repaired regardless.

## Self-Check: PASSED

- `AnalyticsInstant.java`, `AnalyticsInstantBindingIT.java`, `phase37-repair-analytics-utc-drift.py`
  exist on disk.
- Commits `206876d8` (writers + tests) and `aed99b2d` (backfill) exist in `git log`.
- `AnalyticsInstantBindingIT` 4/4 green on the fix, 1 failure on the reverted writer.
