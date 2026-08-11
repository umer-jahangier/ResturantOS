#!/usr/bin/env python3
"""
Repair DEFECT-37-03-B: analytics fact timestamps stored as local wall-clock in UTC columns.

WHAT WENT WRONG. reporting-service's ETL writers passed a java.sql.Timestamp as a JdbcTemplate
argument for columns declared DateTime64(3,'UTC'). Spring's StatementCreatorUtils.isDateValue()
excludes java.sql.Timestamp, so the argument falls through to PreparedStatement.setObject(), and
clickhouse-jdbc renders a Timestamp there in the JVM's default zone. The column then reads that
wall-clock as UTC. On this deployment (Asia/Karachi, UTC+5, no DST) every fact landed exactly five
hours in the future, so every time-of-day report over them was wrong — including daily takings.

Fixed in the writers by commit 206876d8 (AnalyticsInstant.utc). This script repairs rows written
BEFORE that fix.

WHY THIS DOES NOT JUST SUBTRACT FIVE HOURS. A blanket shift is not idempotent: run it twice and
the data is ten hours out, with nothing to say so. It is also wrong for any row that was already
correct — for example one written after the service was restarted with the fix.

Instead, every fact is corrected to the instant carried by the EVENT THAT PRODUCED IT, read from
the producing service's event_outbox and joined on event_id. That makes this script:
  - idempotent      — a second run finds zero drift and writes nothing;
  - self-verifying  — it re-reads every row afterwards and reports remaining drift;
  - safe to run     — a row already correct is left untouched, because it already equals its source.

Rows whose source event cannot be found are NOT touched and are listed instead. Guessing a
timestamp to make a table look uniform is exactly what D-37-05 forbids.

READING AS SUPERUSER, DELIBERATELY. The event_outbox tables are read as `postgres`. Unlike
phase37-generate-business-date-realignment.py — which must read finance_db as finance_user or its
answer would be true of nobody — this is a repair that must cover EVERY tenant's rows. A
tenant-scoped read would silently leave other tenants' facts corrupt. Stated rather than implied.

Usage:
    python3 scripts/ops/phase37-repair-analytics-utc-drift.py            # dry run (default)
    python3 scripts/ops/phase37-repair-analytics-utc-drift.py --apply    # write the corrections
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone

PG_CONTAINER = "restaurantos-postgres"
CH_CONTAINER = "restaurantos-clickhouse"
CH_DB = "clickhouse_analytics"

# table -> (source database, key column in ClickHouse, JSON path to the true instant)
# 'payload.closedAt' is the moment the order closed; 'occurredAt' is the envelope's own timestamp,
# used where the payload carries no timestamp of its own (see the writers' javadoc).
TARGETS = [
    ("sales_order_facts", "pos_db", "closed_at", ("payload", "closedAt")),
    ("sales_item_facts", "pos_db", "closed_at", ("payload", "closedAt")),
    ("till_session_facts", "pos_db", "closed_at", ("occurredAt",)),
    ("purchase_tax_facts", "purchasing_db", "matched_at", ("occurredAt",)),
]


def run(cmd: list[str]) -> str:
    """Always closes stdin. `docker exec -i` otherwise attaches the CALLER's stdin to the
    container and silently drains an enclosing read loop — a trap this repo has already been
    bitten by (see scripts/e2e/_phase31-lib.sh)."""
    result = subprocess.run(
        cmd, stdin=subprocess.DEVNULL, capture_output=True, text=True, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def ch_sql(sql: str) -> list[list[str]]:
    out = run(["docker", "exec", CH_CONTAINER, "clickhouse-client", "-q", sql + " FORMAT TSV"])
    return [ln.split("\t") for ln in out.splitlines() if ln.strip()]


def pg_sql(database: str, sql: str) -> list[list[str]]:
    out = run(["docker", "exec", PG_CONTAINER, "psql", "-U", "postgres", "-d", database,
               "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "\t", "-c", sql])
    return [ln.split("\t", 1) for ln in out.splitlines() if ln.strip()]


def to_millis(iso: str) -> int:
    """ISO-8601 with a Z suffix -> epoch millis, truncated to the column's millisecond precision."""
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00"))
               .astimezone(timezone.utc).timestamp() * 1000)


def source_instants(database: str, path: tuple) -> dict[str, int]:
    """event_id -> true instant in epoch millis, from the producing service's outbox."""
    rows = pg_sql(database, "SELECT event_id::text, envelope_json::text FROM event_outbox")
    out: dict[str, int] = {}
    for event_id, envelope in rows:
        try:
            node = json.loads(envelope)
            for key in path:
                node = node[key]
            out[event_id] = to_millis(node)
        except (KeyError, TypeError, ValueError):
            continue  # a different event type, or no such field — not our concern
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true",
                        help="write the corrections (default is a dry run)")
    args = parser.parse_args()

    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"DEFECT-37-03-B analytics UTC repair — {mode}\n")

    grand_drifted = grand_orphan = grand_ok = 0
    exit_code = 0

    for table, database, column, path in TARGETS:
        facts = ch_sql(
            f"SELECT event_id, toUnixTimestamp64Milli({column}) FROM {CH_DB}.{table}"
        )
        truth = source_instants(database, path)

        drifted: dict[str, tuple[int, int]] = {}  # event_id -> (stored, true)
        orphan: set[str] = set()
        ok = 0
        for event_id, stored_millis in facts:
            true_millis = truth.get(event_id)
            if true_millis is None:
                orphan.add(event_id)
            elif int(stored_millis) != true_millis:
                drifted[event_id] = (int(stored_millis), true_millis)
            else:
                ok += 1

        print(f"{table}: {len(facts)} row(s) — "
              f"{ok} correct, {len(drifted)} drifted, {len(orphan)} without a source event")

        if drifted:
            offsets = {stored - true for stored, true in drifted.values()}
            for offset in sorted(offsets):
                n = sum(1 for s, t in drifted.values() if s - t == offset)
                print(f"    drift {offset / 3600000:+.2f}h on {n} distinct event(s)")
        if orphan:
            print(f"    NOT REPAIRED (no source event, left exactly as found):")
            for event_id in sorted(orphan):
                print(f"      {event_id}")

        if drifted and args.apply:
            for event_id, (_stored, true_millis) in sorted(drifted.items()):
                ch_sql(
                    f"ALTER TABLE {CH_DB}.{table} "
                    f"UPDATE {column} = fromUnixTimestamp64Milli(toInt64({true_millis}), 'UTC') "
                    f"WHERE event_id = toUUID('{event_id}') SETTINGS mutations_sync = 2"
                )
            # Re-read rather than trust the mutation: this is the whole point of the script.
            recheck = ch_sql(
                f"SELECT event_id, toUnixTimestamp64Milli({column}) FROM {CH_DB}.{table}"
            )
            still = [e for e, s in recheck
                     if e in drifted and int(s) != truth[e]]
            if still:
                print(f"    FAILED to correct {len(still)} row(s): {still}")
                exit_code = 1
            else:
                print(f"    repaired {len(drifted)} event(s); re-read confirms 0 drift")

        grand_drifted += len(drifted)
        grand_orphan += len(orphan)
        grand_ok += ok

    print(f"\nTOTAL: {grand_ok} correct, {grand_drifted} drifted, "
          f"{grand_orphan} without a source event")
    if not args.apply and grand_drifted:
        print("\nDry run — nothing was written. Re-run with --apply to correct these rows.")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
