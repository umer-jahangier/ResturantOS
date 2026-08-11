#!/usr/bin/env bash
# phase32-business-date-reconciliation.sh — 37-03, Definition of Done #4.
#
# Proves the general ledger and the sales report name the SAME trading day for every sale, and that
# the realignment that made that true moved no money.
#
# Reads finance_db as finance_user with the tenant GUC set on the SAME connection as the query.
# Never as a superuser: every table in finance_db is FORCE row-level security, and a superuser
# connection is exempt from the policy, so its answer would be true of nobody. This harness
# refuses to run as one rather than reporting a meaningless PASS.
#
# Usage:
#   bash scripts/e2e/phase32-business-date-reconciliation.sh              # verify current state
#   bash scripts/e2e/phase32-business-date-reconciliation.sh --snapshot   # record money totals only
#   bash scripts/e2e/phase32-business-date-reconciliation.sh --apply      # snapshot, migrate, verify
#
# Exits non-zero on any FAIL.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_CONTAINER="${PG_CONTAINER:-restaurantos-postgres}"
CH_CONTAINER="${CH_CONTAINER:-restaurantos-clickhouse}"
FINANCE_DB_ROLE="${FINANCE_DB_USER:-finance_user}"
CH_DB="${CH_DB:-clickhouse_analytics}"
SNAPSHOT_FILE="${SNAPSHOT_FILE:-$REPO_ROOT/scripts/fixtures/phase37-money-totals-pre-realignment.txt}"
MIGRATION="$REPO_ROOT/deploy/clickhouse/V003__business_date_realignment.sql"

PASS=0
FAIL=0

pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*"; FAIL=$((FAIL + 1)); }

# ── Guard: a superuser read would make every assertion below unfalsifiable ───────────────────
case "$FINANCE_DB_ROLE" in
  postgres|root)
    echo "REFUSING to query finance_db as '$FINANCE_DB_ROLE'." >&2
    echo "  finance_db is FORCE row-level security. A superuser bypasses the policy this check" >&2
    echo "  depends on, so a cross-tenant leak would read as healthy. Use the service role." >&2
    exit 3
    ;;
esac

# `< /dev/null` is load-bearing: `docker exec -i` attaches the CALLER's stdin to the container,
# so a helper invoked inside a `while read` loop silently drains the loop's input and the loop
# runs exactly once. This repo has already been bitten by it (scripts/e2e/_phase31-lib.sh).
finance_sql() {
  local tenant="${1:-}"
  local sql="${2:-}"
  local statement="$sql"
  if [[ -n "$tenant" ]]; then
    statement="select set_config('app.current_tenant_id', '${tenant}', false); ${sql}"
  fi
  docker exec -i "$PG_CONTAINER" psql -U "$FINANCE_DB_ROLE" -d finance_db \
    -v ON_ERROR_STOP=1 -qtA -F$'\t' -c "$statement" < /dev/null 2>&1 \
    | { if [[ -n "$tenant" ]]; then tail -n +2; else cat; fi; }
}

ch_sql() {
  docker exec -i "$CH_CONTAINER" clickhouse-client -q "$1" < /dev/null 2>&1
}

money_totals() {
  ch_sql "SELECT count(), sum(subtotal_paisa), sum(discount_paisa), sum(service_charge_paisa),
                 sum(tax_paisa), sum(total_paisa)
          FROM ${CH_DB}.sales_order_facts FORMAT TSV"
}

item_totals() {
  ch_sql "SELECT count(), sum(line_total_paisa) FROM ${CH_DB}.sales_item_facts FORMAT TSV"
}

echo "═══ phase 37-03 · business-date reconciliation ═══════════════════════════════════"
echo

# ── RLS canary — before trusting a single row of SQL evidence ────────────────────────────────
echo "── RLS canary ────────────────────────────────────────────────────────────────────"
TENANTS="$(ch_sql "SELECT DISTINCT toString(tenant_id) FROM ${CH_DB}.sales_order_facts FORMAT TSV")"
FIRST_TENANT="$(echo "$TENANTS" | head -1)"

UNSCOPED="$(finance_sql "" "select count(*) from journal_entries")"
SCOPED="$(finance_sql "$FIRST_TENANT" "select count(*) from journal_entries")"
if [[ "$UNSCOPED" == "0" ]]; then
  pass "journal_entries invisible with NO tenant GUC — RLS is genuinely in force for $FINANCE_DB_ROLE"
else
  fail "journal_entries returned $UNSCOPED rows with NO tenant GUC. RLS is not in force for"
  echo "      $FINANCE_DB_ROLE; every assertion below would be meaningless. Stopping."
  exit 1
fi
if [[ "$SCOPED" -gt 0 ]]; then
  pass "journal_entries visible ($SCOPED) once the tenant GUC is set on the same connection"
else
  fail "journal_entries still empty WITH the tenant GUC set — the harness can see nothing"
  exit 1
fi
echo

# ── Snapshot mode ────────────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--snapshot" || "${1:-}" == "--apply" ]]; then
  mkdir -p "$(dirname "$SNAPSHOT_FILE")"
  {
    echo "# Money totals across ${CH_DB}.sales_order_facts and sales_item_facts,"
    echo "# recorded BEFORE V003__business_date_realignment.sql ran."
    echo "# The realignment moves rows between day buckets and must not alter one paisa."
    echo "# order_facts: count subtotal discount service_charge tax total"
    money_totals
    echo "# item_facts: count line_total"
    item_totals
  } > "$SNAPSHOT_FILE"
  echo "── Snapshot ──────────────────────────────────────────────────────────────────────"
  echo "Recorded pre-realignment money totals to ${SNAPSHOT_FILE#"$REPO_ROOT"/}:"
  grep -v '^#' "$SNAPSHOT_FILE" | sed 's/^/    /'
  echo
  [[ "${1:-}" == "--snapshot" ]] && { echo "Snapshot only. Re-run with --apply to migrate."; exit 0; }
fi

# ── Apply mode ───────────────────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--apply" ]]; then
  echo "── Applying V003__business_date_realignment.sql ───────────────────────────────────"
  if [[ ! -f "$MIGRATION" ]]; then
    fail "migration not found at $MIGRATION"
    exit 1
  fi
  if docker exec -i "$CH_CONTAINER" clickhouse-client --multiquery < "$MIGRATION"; then
    pass "migration applied"
  else
    fail "migration failed to apply"
    exit 1
  fi
  # ClickHouse mutations are asynchronous; wait for the DELETEs to materialise before asserting.
  for _ in $(seq 1 30); do
    PENDING="$(ch_sql "SELECT count() FROM system.mutations WHERE is_done = 0 AND database = '${CH_DB}' FORMAT TSV")"
    [[ "$PENDING" == "0" ]] && break
    sleep 1
  done
  echo "    pending mutations: ${PENDING:-unknown}"
  echo
fi

# ── Assertion 1: the money totals are unchanged by the realignment ───────────────────────────
echo "── Money must not move, only days ────────────────────────────────────────────────"
if [[ -f "$SNAPSHOT_FILE" ]]; then
  BEFORE_ORDERS="$(grep -v '^#' "$SNAPSHOT_FILE" | sed -n '1p')"
  BEFORE_ITEMS="$(grep -v '^#' "$SNAPSHOT_FILE" | sed -n '2p')"
  AFTER_ORDERS="$(money_totals)"
  AFTER_ITEMS="$(item_totals)"
  if [[ "$BEFORE_ORDERS" == "$AFTER_ORDERS" ]]; then
    pass "sales_order_facts money totals byte-identical before and after"
    echo "      $AFTER_ORDERS"
  else
    fail "sales_order_facts money totals CHANGED — the realignment altered money"
    echo "      before: $BEFORE_ORDERS"
    echo "      after : $AFTER_ORDERS"
  fi
  if [[ "$BEFORE_ITEMS" == "$AFTER_ITEMS" ]]; then
    pass "sales_item_facts money totals byte-identical before and after"
    echo "      $AFTER_ITEMS"
  else
    fail "sales_item_facts money totals CHANGED"
    echo "      before: $BEFORE_ITEMS"
    echo "      after : $AFTER_ITEMS"
  fi
else
  echo "SKIP: no pre-realignment snapshot at ${SNAPSHOT_FILE#"$REPO_ROOT"/}."
  echo "      Run with --snapshot BEFORE applying the migration. Not counted as a pass —"
  echo "      an unrecorded baseline cannot prove money was untouched."
fi
echo

# ── Assertion 2: ledger and report agree, per tenant, per day ────────────────────────────────
echo "── Ledger vs report, per tenant per day ──────────────────────────────────────────"
DIVERGENCES=0
while IFS= read -r TENANT; do
  [[ -z "$TENANT" ]] && continue

  LEDGER="$(finance_sql "$TENANT" \
    "select entry_date::text, count(*) from journal_entries
      where source_type = 'ORDER_REVENUE' group by entry_date order by entry_date")"
  REPORT="$(ch_sql "SELECT toString(business_date), count()
                    FROM ${CH_DB}.sales_order_facts WHERE tenant_id = '${TENANT}'
                    GROUP BY business_date ORDER BY business_date FORMAT TSV")"

  if [[ "$LEDGER" == "$REPORT" ]]; then
    pass "tenant ${TENANT:0:8}… ledger and report agree on every day ($(echo "$REPORT" | wc -l | tr -d ' ') day(s))"
  else
    fail "tenant ${TENANT:0:8}… ledger and report DISAGREE"
    echo "      ledger (journal_entries.entry_date):"
    echo "$LEDGER" | sed 's/^/        /'
    echo "      report (sales_order_facts.business_date):"
    echo "$REPORT" | sed 's/^/        /'
    DIVERGENCES=$((DIVERGENCES + 1))
  fi
done <<< "$TENANTS"
echo

# ── Assertion 3: the day boundary, checked against pos_db — NOT against the fact's closed_at ──
#
# DO NOT reinstate a check of the form
#     business_date == toDate(sales_order_facts.closed_at - INTERVAL 4 HOUR)
# It looks right and it is unsound, because sales_order_facts.closed_at is CORRUPT. See
# DEFECT-37-03-B below: SalesFactWriter writes `Timestamp.from(instant)` through JDBC with no
# Calendar, so the driver renders it in the JVM's default zone and stores branch-local wall-clock
# time in a column declared DateTime64(3,'UTC'). Measured offset: +5h (Asia/Karachi).
# pos_db.orders.closed_at is the true instant, so the boundary check reads from there.
echo "── The day boundary that caused this (23:00Z–04:00Z), vs pos_db ──────────────────"
BOUNDARY_TOTAL=0
BOUNDARY_BAD=0
while IFS= read -r TENANT; do
  [[ -z "$TENANT" ]] && continue
  # Orders genuinely closed inside the window, per pos_db's real UTC instant.
  ROWS="$(docker exec -i "$PG_CONTAINER" psql -U "${POS_DB_USER:-pos_user}" -d pos_db -qtA -F$'\t' \
      -c "select set_config('app.current_tenant_id','${TENANT}',false);
          select id::text, (date_trunc('day', closed_at at time zone 'UTC' - interval '4 hours'))::date::text
            from orders
           where status = 'CLOSED' and closed_at is not null
             and (extract(hour from closed_at at time zone 'UTC') >= 23
                  or extract(hour from closed_at at time zone 'UTC') < 4)" \
      < /dev/null 2>&1 | tail -n +2)"
  while IFS=$'\t' read -r OID EXPECTED; do
    [[ -z "$OID" ]] && continue
    BOUNDARY_TOTAL=$((BOUNDARY_TOTAL + 1))
    ACTUAL="$(ch_sql "SELECT toString(business_date) FROM ${CH_DB}.sales_order_facts
                      WHERE order_id = '${OID}' FORMAT TSV")"
    [[ -z "$ACTUAL" ]] && continue
    if [[ "$ACTUAL" != "$EXPECTED" ]]; then
      BOUNDARY_BAD=$((BOUNDARY_BAD + 1))
      echo "      ${OID}  expected ${EXPECTED}  got ${ACTUAL}"
    fi
  done <<< "$ROWS"
done <<< "$TENANTS"

if [[ "$BOUNDARY_TOTAL" -gt 0 ]]; then
  pass "$BOUNDARY_TOTAL order(s) genuinely closed inside the window — this check is exercised, not vacuous"
  if [[ "$BOUNDARY_BAD" == "0" ]]; then
    pass "every boundary order's fact sits on pos-service's (closed_at − 4h) UTC day"
  else
    fail "$BOUNDARY_BAD boundary order(s) sit on the wrong day"
  fi
else
  fail "NO order closed inside the 23:00Z–04:00Z window — this assertion proves nothing."
  echo "      Close an order in that window before trusting this check."
fi
echo

# ── Assertion 3b: DEFECT-37-03-B — the fact table's closed_at must be the true UTC instant ────
echo "── sales_order_facts.closed_at must equal pos_db's real instant ──────────────────"
SKEWED=0
SAMPLED=0
while IFS= read -r TENANT; do
  [[ -z "$TENANT" ]] && continue
  ROWS="$(docker exec -i "$PG_CONTAINER" psql -U "${POS_DB_USER:-pos_user}" -d pos_db -qtA -F$'\t' \
      -c "select set_config('app.current_tenant_id','${TENANT}',false);
          select id::text, to_char(closed_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS')
            from orders where status = 'CLOSED' and closed_at is not null limit 25" \
      < /dev/null 2>&1 | tail -n +2)"
  while IFS=$'\t' read -r OID TRUE_TS; do
    [[ -z "$OID" ]] && continue
    CH_TS="$(ch_sql "SELECT formatDateTime(closed_at,'%Y-%m-%d %H:%M:%S') FROM ${CH_DB}.sales_order_facts
                     WHERE order_id = '${OID}' FORMAT TSV")"
    [[ -z "$CH_TS" ]] && continue
    SAMPLED=$((SAMPLED + 1))
    [[ "$CH_TS" != "$TRUE_TS" ]] && SKEWED=$((SKEWED + 1))
  done <<< "$ROWS"
done <<< "$TENANTS"

if [[ "$SAMPLED" == "0" ]]; then
  fail "no order could be sampled — this assertion proves nothing"
elif [[ "$SKEWED" == "0" ]]; then
  pass "closed_at matches pos_db exactly across $SAMPLED sampled order(s)"
else
  fail "DEFECT-37-03-B: $SKEWED of $SAMPLED sampled fact(s) carry a closed_at that is NOT the true"
  echo "      UTC instant. SalesFactWriter passes Timestamp.from(instant) to JDBC with no Calendar,"
  echo "      so the driver renders it in the JVM's default zone and stores branch-local wall-clock"
  echo "      time in a column declared DateTime64(3,'UTC'). Every time-of-day report built on this"
  echo "      column is wrong by the JVM's UTC offset. NOT fixed by 37-03; see 37-03-SUMMARY.md."
fi
echo

# ── Assertion 4: order headers and item lines sit on the same day ────────────────────────────
echo "── Item lines must follow their order header ─────────────────────────────────────"
ORPHANED="$(ch_sql "SELECT count() FROM ${CH_DB}.sales_item_facts i
                    LEFT JOIN ${CH_DB}.sales_order_facts o
                      ON i.order_id = o.order_id AND i.business_date = o.business_date
                    WHERE o.order_id = '00000000-0000-0000-0000-000000000000' FORMAT TSV")"
if [[ "${ORPHANED:-0}" == "0" ]]; then
  pass "no item line sits on a different day from its order header"
else
  fail "$ORPHANED item line(s) sit on a different day from their order header"
fi
echo

# ── Verdict ──────────────────────────────────────────────────────────────────────────────────
echo "═════════════════════════════════════════════════════════════════════════════════"
echo "PASS: $PASS   FAIL: $FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  echo "Ledger and report do not agree. Do NOT build the takings screen on this."
  exit 1
fi
echo "The general ledger and the sales report name the same trading day for every sale."
