#!/usr/bin/env python3
"""
Repair S0-C: ORDER_REVENUE journal entries dated on a UTC trading day instead of the branch's.

WHAT WENT WRONG. pos-service resolved a sale's trading day with shared-lib's
`BusinessDay.of(Instant)` — a UTC overload shipped "for services that do not hold branch timezone
data (pos-service)". That date is checked against the accounting period AND stamped on
ORDER_CLOSED, and finance-service copies it verbatim onto `journal_entries.entry_date`
(AutoPostingRecipeEngine.post). For an `Asia/Karachi` branch (UTC+5) `UTC − 4h` puts the
trading-day boundary at 09:00 local rather than 04:00, so every sale closed between those hours —
the whole of breakfast — was posted to the PREVIOUS day's ledger while its payment row, its till
session and its order number all read the current day.

Fixed at the source by pos-service's `BranchBusinessDay`, which cuts the day on the branch's own
IANA zone (the field `/app/settings` already tells the owner "Business dates and reports are cut
on it"). This script repairs entries POSTED BEFORE that fix.

WHY IT RECOMPUTES INSTEAD OF SHIFTING A DAY. A blanket `entry_date + 1` is not idempotent, and it
is wrong for every entry that was already correct — which is most of them, because the two rules
only disagree for closes between 23:00Z and 04:00Z. Each entry is instead recomputed from its own
order's `closed_at` and its own branch's timezone, exactly as the fixed code would compute it now.
So this script is:
  - idempotent      — a second run finds nothing to do and writes nothing;
  - self-verifying  — it re-reads every row afterwards and reports any remaining disagreement;
  - safe to re-run  — an entry already on its correct date is left untouched.

WHAT IT DOES NOT TOUCH, DELIBERATELY.
  * ORDER_REFUND entries. A refund is its own event at its own moment; dating it by the ORDER's
    close would be a different bug, not a fix for this one.
  * ORDER_COGS entries. finance dates those from the envelope's publish time, which is a separate
    (and much narrower) divergence — see the report this run prints. Repairing them here while the
    code still derives them differently would only re-open the gap on the next order.
  * Any entry whose corrected date falls OUTSIDE its journal entry's accounting period. Moving an
    entry between periods silently changes a closed month's reported revenue; those are listed for
    a human instead. (On the data this was written against there are none: every correction is
    +1 day and none crosses a month end.)
  * Any entry whose order is missing, deleted or voided. Guessing a date to make a total look tidy
    is exactly what D-37-05 forbids.

THE LEDGER IS IMMUTABLE, AND THIS IS THE ONE EXEMPTION. `trg_je_immutable` refuses any UPDATE to a
POSTED entry. That guard is correct and stays. This is not a restatement of a business event: not
one amount, account, line or balance changes — only a metadata field that a defect wrote wrong, to
the value the same code would write today. It runs with `session_replication_role = replica`, which
suppresses user triggers for this session only, inside one transaction, and the run writes a
manifest naming every entry it moved so the change is auditable after the fact.

READING AS SUPERUSER, DELIBERATELY. pos_db, user_db and finance_db are all FORCE row-level
security. A repair must cover EVERY tenant's rows: a tenant-scoped connection would silently leave
other tenants' ledgers corrupt. Stated rather than implied — the same call
`phase37-repair-analytics-utc-drift.py` makes, and the opposite of
`phase37-generate-business-date-realignment.py`, which must read as `finance_user` because it is
asserting what the SERVICE can see.

AFTER THIS RUNS. reporting-service's ClickHouse `sales_order_facts` were realigned onto the ledger
by 37-03, so the rows this script moves leave their analytics facts a day behind. Re-run
`scripts/ops/phase37-generate-business-date-realignment.py` to see the new deltas.

Usage:
    python3 scripts/ops/s0c-repair-ledger-business-dates.py             # dry run (default)
    python3 scripts/ops/s0c-repair-ledger-business-dates.py --apply     # write the corrections
    python3 scripts/ops/s0c-repair-ledger-business-dates.py --json      # machine-readable report
"""

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

PG_CONTAINER = "restaurantos-postgres"
SUPERUSER = "postgres"

# Must match `restaurantos.business-day.offset-hours` (BUSINESS_DAY_OFFSET_HOURS), the property
# pos-service's BranchBusinessDay and reporting-service's BusinessDay both read. A repair computed
# on a different offset than the services use would simply move the drift somewhere else.
OFFSET_HOURS = 4
DEFAULT_TZ = "Asia/Karachi"  # restaurantos.business-day.default-timezone

REPAIRABLE_SOURCE_TYPES = ("ORDER_REVENUE",)

_TS = re.compile(
    r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?([+-]\d{2})(?::?(\d{2}))?$"
)


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


def sql(db: str, statement: str) -> list[list[str]]:
    out = run(
        ["docker", "exec", PG_CONTAINER, "psql", "-U", SUPERUSER, "-d", db,
         "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "\t", "-c", statement]
    )
    return [ln.split("\t") for ln in out.splitlines() if ln.strip()]


def parse_ts(value: str):
    """psql renders timestamptz as `2026-08-12 02:59:24.65+00`, which `fromisoformat` rejects for
    any fractional length other than 3 or 6 digits. Parsed explicitly rather than hopefully."""
    m = _TS.match(value.strip())
    if not m:
        raise ValueError(f"unparseable timestamp: {value!r}")
    frac = (m.group(3) or "0").ljust(6, "0")[:6]
    off = timezone(timedelta(hours=int(m.group(4)), minutes=int(m.group(5) or 0)))
    return datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}.{frac}").replace(tzinfo=off)


def business_date(closed_at: datetime, tz_name: str):
    """The one rule, in Python: `closedAt` on the branch's wall clock, minus the trading-day
    offset. Identical to shared-lib BusinessDay.of(at, zone, offsetHours)."""
    return (closed_at.astimezone(ZoneInfo(tz_name)) - timedelta(hours=OFFSET_HOURS)).date()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the corrections")
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    args = ap.parse_args()

    branches = {
        bid: (tz or DEFAULT_TZ)
        for bid, tz in sql("user_db", "select id::text, timezone from branches")
    }
    orders = {}
    for oid, bid, closed, order_no in sql(
        "pos_db",
        "select id::text, branch_id::text, closed_at::text, order_no from orders "
        "where closed_at is not null and deleted_at is null and voided_at is null",
    ):
        orders[oid] = (bid, parse_ts(closed), order_no)

    types = ", ".join(f"'{t}'" for t in REPAIRABLE_SOURCE_TYPES)
    entries = sql(
        "finance_db",
        "select je.id::text, coalesce(je.entry_no,''), je.source_type, je.source_id::text, "
        "je.entry_date::text, je.status, je.tenant_id::text, p.start_date::text, p.end_date::text "
        "from journal_entries je join accounting_periods p on p.id = je.period_id "
        f"where je.deleted_at is null and je.source_id is not null and je.source_type in ({types})",
    )

    to_move, orphaned, out_of_period, already_right = [], [], [], 0
    for jid, entry_no, stype, src, edate, status, tenant, p_start, p_end in entries:
        order = orders.get(src)
        if order is None:
            orphaned.append({"je_id": jid, "entry_no": entry_no, "source_id": src,
                             "entry_date": edate, "reason": "order missing, deleted or voided"})
            continue
        bid, closed_at, order_no = order
        tz_name = branches.get(bid, DEFAULT_TZ)
        correct = str(business_date(closed_at, tz_name))
        if correct == edate:
            already_right += 1
            continue
        row = {"je_id": jid, "entry_no": entry_no, "source_type": stype, "tenant_id": tenant,
               "order_no": order_no, "closed_at": closed_at.isoformat(), "timezone": tz_name,
               "status": status, "from": edate, "to": correct,
               "period": f"{p_start}..{p_end}"}
        if not (p_start <= correct <= p_end):
            out_of_period.append(row)
        else:
            to_move.append(row)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "offset_hours": OFFSET_HOURS,
        "source_types": list(REPAIRABLE_SOURCE_TYPES),
        "entries_examined": len(entries),
        "already_correct": already_right,
        "to_move": len(to_move),
        "out_of_period_LEFT_ALONE": len(out_of_period),
        "orphaned_LEFT_ALONE": len(orphaned),
        "moves": to_move,
        "out_of_period_rows": out_of_period,
        "orphaned_rows": orphaned,
        "applied": False,
        "remaining_after_apply": None,
    }

    if args.apply and to_move:
        # session_replication_role suppresses `trg_je_immutable` for THIS session only. No FK on
        # entry_date, no amount touched, one transaction, and the manifest above names every row.
        updates = "".join(
            f"update journal_entries set entry_date = date '{m['to']}', updated_at = now() "
            f"where id = '{m['je_id']}'::uuid and entry_date = date '{m['from']}';\n"
            for m in to_move
        )
        run(["docker", "exec", PG_CONTAINER, "psql", "-U", SUPERUSER, "-d", "finance_db",
             "-v", "ON_ERROR_STOP=1", "-qtA", "-c",
             "begin; set local session_replication_role = replica;\n" + updates + "commit;"])
        report["applied"] = True

        # Self-verification: re-read from the database rather than trusting the write.
        after = {
            r[0]: r[1]
            for r in sql("finance_db",
                         "select id::text, entry_date::text from journal_entries "
                         "where id in (" + ", ".join(f"'{m['je_id']}'::uuid" for m in to_move) + ")")
        }
        report["remaining_after_apply"] = [
            {"je_id": m["je_id"], "expected": m["to"], "actual": after.get(m["je_id"])}
            for m in to_move if after.get(m["je_id"]) != m["to"]
        ]

    if args.json:
        print(json.dumps(report, indent=2))
        return 0

    verb = "moved" if report["applied"] else "would move"
    print(f"\n  ORDER-sourced entries examined : {report['entries_examined']}")
    print(f"  already on the correct day     : {report['already_correct']}")
    print(f"  {verb:<30} : {report['to_move']}")
    print(f"  out of period (LEFT ALONE)     : {report['out_of_period_LEFT_ALONE']}")
    print(f"  orphaned      (LEFT ALONE)     : {report['orphaned_LEFT_ALONE']}")
    if to_move:
        moves: dict[tuple[str, str], int] = {}
        for m in to_move:
            moves[(m["from"], m["to"])] = moves.get((m["from"], m["to"]), 0) + 1
        print("\n  moves (stored date -> branch trading day):")
        for key in sorted(moves):
            print(f"    {key[0]} -> {key[1]}   {moves[key]:4d} entries")
    for row in out_of_period:
        print(f"  ! {row['entry_no']} would move {row['from']} -> {row['to']}, outside its "
              f"period {row['period']} — LEFT ALONE, needs a human")
    if report["applied"]:
        remaining = report["remaining_after_apply"]
        print(f"\n  verified after write: {'ALL CORRECT' if not remaining else remaining}")
    if not report["applied"]:
        print("\n  dry run — nothing was written. Re-run with --apply.")
    print()
    return 1 if report["remaining_after_apply"] else 0


if __name__ == "__main__":
    sys.exit(main())
