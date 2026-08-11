#!/usr/bin/env python3
"""
Generate the (order_id, correct_business_date) realignment pairs for 37-03.

THE AUTHORITY IS THE GENERAL LEDGER, not a recomputation. pos-service resolves a sale's trading
day once, checks the accounting period against it, and puts it on the ORDER_CLOSED event;
finance-service dates the journal entry from that same field. finance and pos therefore cannot
disagree. reporting-service re-derived the day from closedAt in the branch's timezone, which for a
UTC+5 branch diverges for anything closed between 23:00Z and 04:00Z.

So: for every sales fact, the correct business_date is the entry_date of the ORDER_REVENUE journal
entry whose source_id is that order. A fact with no matching journal entry is NOT realigned — that
is a second, different defect, and guessing its date to make a total look tidy is exactly what
D-37-05 forbids. Those ids are listed instead.

finance_db is FORCE row-level security. This reads as finance_user with the tenant GUC set on the
SAME connection as the query — a GUC set on a different connection scopes nothing, and a superuser
read would return every tenant's rows and prove nothing about what the service sees.

Usage:  python3 scripts/ops/phase37-generate-business-date-realignment.py [--json]
"""

import json
import subprocess
import sys

PG_CONTAINER = "restaurantos-postgres"
CH_CONTAINER = "restaurantos-clickhouse"
FINANCE_ROLE = "finance_user"
CH_DB = "clickhouse_analytics"

FORBIDDEN_ROLES = {"postgres", "root"}


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


def finance_sql(tenant_id: str, sql: str) -> list[list[str]]:
    if FINANCE_ROLE in FORBIDDEN_ROLES:
        raise SystemExit(
            f"REFUSING to read finance_db as '{FINANCE_ROLE}'. Every table there is FORCE RLS; "
            "a superuser connection bypasses the policy and the answer would be true of nobody."
        )
    statement = f"select set_config('app.current_tenant_id', '{tenant_id}', false); {sql}"
    out = run(
        ["docker", "exec", "-i", PG_CONTAINER, "psql", "-U", FINANCE_ROLE, "-d", "finance_db",
         "-v", "ON_ERROR_STOP=1", "-qtA", "-F", "\t", "-c", statement]
    )
    lines = out.splitlines()
    # First line is the set_config echo.
    return [ln.split("\t") for ln in lines[1:] if ln.strip()]


def ch_sql(sql: str) -> list[list[str]]:
    out = run(["docker", "exec", CH_CONTAINER, "clickhouse-client", "-q", sql + " FORMAT TSV"])
    return [ln.split("\t") for ln in out.splitlines() if ln.strip()]


def main() -> int:
    facts = ch_sql(
        f"SELECT tenant_id, order_id, toString(business_date), total_paisa "
        f"FROM {CH_DB}.sales_order_facts ORDER BY tenant_id, order_id"
    )
    print(f"sales_order_facts rows: {len(facts)}", file=sys.stderr)

    tenants = sorted({row[0] for row in facts})
    ledger: dict[tuple[str, str], str] = {}
    for tenant in tenants:
        rows = finance_sql(
            tenant,
            "select source_id::text, entry_date::text from journal_entries "
            "where source_type = 'ORDER_REVENUE' and source_id is not null",
        )
        for source_id, entry_date in rows:
            ledger[(tenant, source_id)] = entry_date

    print(f"ORDER_REVENUE journal entries across {len(tenants)} tenant(s): {len(ledger)}",
          file=sys.stderr)

    realign, agreed, unmatched = [], [], []
    for tenant_id, order_id, fact_date, total_paisa in facts:
        entry_date = ledger.get((tenant_id, order_id))
        if entry_date is None:
            unmatched.append({"tenant_id": tenant_id, "order_id": order_id,
                              "fact_business_date": fact_date, "total_paisa": int(total_paisa)})
        elif entry_date != fact_date:
            realign.append({"tenant_id": tenant_id, "order_id": order_id,
                            "from": fact_date, "to": entry_date,
                            "total_paisa": int(total_paisa)})
        else:
            agreed.append(order_id)

    report = {
        "fact_rows": len(facts),
        "agreed": len(agreed),
        "to_realign": len(realign),
        "unmatched": len(unmatched),
        "realign": realign,
        "unmatched_rows": unmatched,
    }

    if "--json" in sys.argv:
        print(json.dumps(report, indent=2))
    else:
        print(f"\n  agree with the ledger : {len(agreed)}")
        print(f"  need realignment      : {len(realign)}")
        print(f"  unmatched (LEFT ALONE): {len(unmatched)}")
        if realign:
            moves: dict[tuple[str, str], int] = {}
            paisa: dict[tuple[str, str], int] = {}
            for r in realign:
                key = (r["from"], r["to"])
                moves[key] = moves.get(key, 0) + 1
                paisa[key] = paisa.get(key, 0) + r["total_paisa"]
            print("\n  moves (fact date -> ledger date):")
            for key in sorted(moves):
                print(f"    {key[0]} -> {key[1]}   {moves[key]:4d} orders   "
                      f"{paisa[key]:>12,} paisa")
        if unmatched:
            print("\n  unmatched order ids (left exactly where they are):")
            for u in unmatched:
                print(f"    {u['order_id']}  tenant={u['tenant_id']}  "
                      f"fact_date={u['fact_business_date']}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
