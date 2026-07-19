#!/usr/bin/env bash
# =============================================================================================
# Phase 12 (Reporting, Dashboards & NLQ) — MOCK DATA SEED
#
# Purpose: land realistic analytics data so every Phase-12 read surface has something to show,
# WITHOUT running the POS -> RabbitMQ -> ETL live pipeline. Populates the four ClickHouse fact
# tables that reporting-service, the dashboard REST snapshot, and NLQ all read, plus the demo
# branch's NTN / Sales-Tax-Registration-No so the FBR Tax Summary header is non-null.
#
# What it lets you test after running (services must be up to VIEW it — see below):
#   - Reports page + named reports (sales_order_facts / sales_item_facts)
#   - FBR Tax Summary: output tax (sum tax_paisa), input tax (sum input_tax_paisa),
#     net payable, and a non-null NTN / STRN header (12-13 gap surface)
#   - Dashboard REST snapshot tiles (revenue, orders, cash position)
#   - NLQ ask page: "What was total revenue today?" etc. resolve against real facts
#
# What it does NOT do (by design):
#   - It does NOT trigger the realtime dashboard WebSocket PUSH (tests 3/4 in 12-UAT.md) — that
#     needs a live ORDER_CLOSED event through the stack. Static facts feed the REST snapshot only.
#   - It does NOT provision the finance Chart of Accounts — reports/FBR/NLQ read ClickHouse, not
#     finance-service, so CoA is not needed to view them. (POS order-close would need it; this
#     seed deliberately bypasses POS.)
#
# Idempotent: every fact row uses a deterministic UUID derived from (tenant, kind, date, index),
# and the tables are ReplacingMergeTree keyed on the same sort columns — re-running REPLACES the
# same logical rows rather than duplicating them. The Postgres branch UPDATE is naturally idempotent.
#
# Data window: the last MOCK_DAYS days (default 14), several orders/day + daily till close +
# a few vendor invoices, so "today" tiles and multi-day report ranges both show data.
#
# ---------------------------------------------------------------------------------------------
# PRECONDITIONS
#   - Docker infra up (at least clickhouse + postgres):  bash scripts/dev-stack-up.sh
#     (or `make dev-up`). ClickHouse schema applied:      bash deploy/clickhouse/apply.sh
#   - The demo tenant/branch/owner exist (auth-service Liquibase context=seed).
#
# To then VIEW the data you additionally need these services UP + Eureka-registered:
#   reporting-service, nlq-service, user-service, auth-service, gateway.
#
# USAGE
#   bash scripts/e2e/phase12-seed-mock-data.sh
#   MOCK_DAYS=30 bash scripts/e2e/phase12-seed-mock-data.sh
#   TENANT_ID=... BRANCH_ID=... CLICKHOUSE_HTTP=http://localhost:8123 bash scripts/e2e/phase12-seed-mock-data.sh
# =============================================================================================
set -euo pipefail

cd "$(dirname "$0")/../.."   # repo root

# --- config -------------------------------------------------------------------------------
# shellcheck disable=SC1091
[[ -f deploy/.env ]] && source deploy/.env

TENANT_ID="${TENANT_ID:-a0000001-0000-4000-8000-000000000001}"
BRANCH_ID="${BRANCH_ID:-b0000001-0000-4000-8000-000000000001}"
MOCK_DAYS="${MOCK_DAYS:-14}"

# deploy/.env's CLICKHOUSE_URL is the in-Docker hostname (http://clickhouse:8123), unreachable
# from a host-run script — always talk to the host-published port unless CLICKHOUSE_HTTP is set.
CLICKHOUSE_URL="${CLICKHOUSE_HTTP:-http://localhost:8123}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-}"

# Postgres (user_db) — for the branch NTN/STRN UPDATE. Prefer a host psql; fall back to docker exec.
PG_CONTAINER="${PG_CONTAINER:-restaurantos-postgres}"
USER_DB="${USER_DB:-user_db}"

# Fixed mock identities (deterministic so the seed is stable across runs).
NTN_VALUE="${MOCK_NTN:-1234567-8}"
STRN_VALUE="${MOCK_STRN:-3277876500809}"

echo "== Phase 12 mock-data seed =="
echo "   tenant=$TENANT_ID branch=$BRANCH_ID days=$MOCK_DAYS"
echo "   clickhouse=$CLICKHOUSE_URL"

# --- preflight: ClickHouse reachable + schema present -------------------------------------
ch_query() { curl -s --fail-with-body "$CLICKHOUSE_URL/?user=default&password=${CLICKHOUSE_PASSWORD}" --data-binary "$1"; }

if ! ch_query "SELECT 1" >/dev/null 2>&1; then
  echo "ERROR: ClickHouse not reachable at $CLICKHOUSE_URL." >&2
  echo "  Start infra:  bash scripts/dev-stack-up.sh   (then: bash deploy/clickhouse/apply.sh)" >&2
  exit 1
fi
if ! ch_query "EXISTS clickhouse_analytics.sales_order_facts" | grep -q 1; then
  echo "ERROR: clickhouse_analytics.sales_order_facts missing — apply the schema first:" >&2
  echo "  bash deploy/clickhouse/apply.sh" >&2
  exit 1
fi

# --- generate the INSERT SQL with a deterministic python helper ---------------------------
# python3 is already a dependency of the other seed scripts in this repo.
INSERT_SQL="$(python3 - "$TENANT_ID" "$BRANCH_ID" "$MOCK_DAYS" <<'PY'
import sys, uuid
from datetime import date, timedelta, datetime, time

tenant_id, branch_id, days = sys.argv[1], sys.argv[2], int(sys.argv[3])
NS = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")  # repo-local namespace for mock facts

def det(kind, *parts):
    return str(uuid.uuid5(NS, f"restaurantos/mock/{tenant_id}/{kind}/" + "/".join(map(str, parts))))

# Stable per-tenant actors.
cashier_id  = det("cashier", 0)
customer_id = det("customer", 0)

MENU = [  # (menu_item_id, name, unit_price_paisa)
    (det("item","chicken-karahi"), "Chicken Karahi", 145000),
    (det("item","beef-biryani"),  "Beef Biryani",     95000),
    (det("item","naan"),          "Naan",              8000),
    (det("item","soft-drink"),    "Soft Drink",       15000),
    (det("item","kheer"),         "Kheer",            25000),
]
TAX_BPS = 1600  # 16% Pakistan GST, basis points

order_rows, item_rows, till_rows, purch_rows = [], [], [], []
today = date.today()

for d in range(days):
    bd = today - timedelta(days=d)
    bd_s = bd.isoformat()
    # 3–5 orders per day (deterministic count from the date).
    n_orders = 3 + (bd.toordinal() % 3)
    day_expected_cash = 0
    for o in range(n_orders):
        order_id = det("order", bd_s, o)
        till_id  = det("till", bd_s)
        # 1–3 line items, deterministic.
        n_items = 1 + ((bd.toordinal() + o) % 3)
        subtotal = 0
        for li in range(n_items):
            mi = MENU[(bd.toordinal() + o + li) % len(MENU)]
            qty = 1 + ((o + li) % 3)
            line_total = mi[2] * qty
            subtotal += line_total
            item_rows.append(
                f"('{tenant_id}','{branch_id}','{bd_s}','{order_id}',{li},'{mi[0]}',"
                f"'{mi[1]}',{qty},{mi[2]},{line_total},NULL,NULL,NULL,"
                f"'{bd_s} 19:{10+li:02d}:00.000','{det('evt-item',order_id,li)}')"
            )
        discount = 0
        service_charge = 0
        tax = (subtotal * TAX_BPS) // 10000
        total = subtotal - discount + service_charge + tax
        day_expected_cash += total
        closed_at = f"{bd_s} 19:{10+o:02d}:00.000"
        order_no = f"MOCK-{bd.strftime('%Y%m%d')}-{o+1:03d}"
        order_rows.append(
            f"('{tenant_id}','{branch_id}','{bd_s}','{order_id}','{order_no}','DINE_IN',"
            f"'{customer_id}',{subtotal},{discount},{service_charge},{tax},{total},"
            f"'{till_id}','{cashier_id}','{closed_at}','{det('evt-order',order_id)}')"
        )
    # one till close per day, counted == expected (zero variance) except a small deterministic drift.
    till_id = det("till", bd_s)
    variance = (bd.toordinal() % 5) * 100 - 200   # -200..+200 paisa
    counted = day_expected_cash + variance
    till_rows.append(
        f"('{tenant_id}','{branch_id}','{bd_s}','{till_id}','{cashier_id}',"
        f"{day_expected_cash},{counted},{variance},'{bd_s} 23:30:00.000','{det('evt-till',bd_s)}')"
    )
    # a vendor invoice every 3rd day -> input tax.
    if d % 3 == 0:
        inv_id = det("invoice", bd_s)
        po_id  = det("po", bd_s)
        inv_total = 500000 + (bd.toordinal() % 7) * 25000
        input_tax = (inv_total * TAX_BPS) // 10000
        purch_rows.append(
            f"('{tenant_id}','{branch_id}','{bd_s}','{inv_id}','{po_id}',"
            f"{input_tax},{inv_total},'MATCHED','{bd_s} 11:00:00.000','{det('evt-inv',bd_s)}')"
        )

def block(table, cols, rows):
    if not rows:
        return ""
    return (f"INSERT INTO clickhouse_analytics.{table} ({cols}) VALUES\n"
            + ",\n".join(rows) + ";\n")

print(block("sales_order_facts",
      "tenant_id,branch_id,business_date,order_id,order_no,order_type,customer_id,"
      "subtotal_paisa,discount_paisa,service_charge_paisa,tax_paisa,total_paisa,"
      "till_session_id,cashier_id,closed_at,event_id", order_rows))
print(block("sales_item_facts",
      "tenant_id,branch_id,business_date,order_id,line_no,menu_item_id,item_name,qty,"
      "unit_price_paisa,line_total_paisa,cogs_paisa,gross_margin_paisa,category_name,closed_at,event_id",
      item_rows))
print(block("purchase_tax_facts",
      "tenant_id,branch_id,business_date,invoice_id,purchase_order_id,input_tax_paisa,"
      "total_paisa,match_status,matched_at,event_id", purch_rows))
print(block("till_session_facts",
      "tenant_id,branch_id,business_date,till_session_id,cashier_id,expected_cash_paisa,"
      "counted_cash_paisa,variance_paisa,closed_at,event_id", till_rows))
PY
)"

# --- apply the ClickHouse inserts (one statement per line block) ---------------------------
echo "-- inserting ClickHouse facts..."
# Split on the trailing ';' of each INSERT and send individually so a bad block is isolated.
while IFS= read -r stmt; do
  [[ -z "${stmt// }" ]] && continue
  ch_query "$stmt" >/dev/null
done < <(printf '%s\n' "$INSERT_SQL" | awk 'BEGIN{RS=";\n"} NF{print $0 ";"}')

# ReplacingMergeTree: force a merge so duplicate re-runs collapse immediately (not just on schedule).
for t in sales_order_facts sales_item_facts purchase_tax_facts till_session_facts; do
  ch_query "OPTIMIZE TABLE clickhouse_analytics.$t FINAL" >/dev/null || true
done

# --- report what landed --------------------------------------------------------------------
oc=$(ch_query "SELECT count() FROM clickhouse_analytics.sales_order_facts WHERE tenant_id='$TENANT_ID'")
ic=$(ch_query "SELECT count() FROM clickhouse_analytics.sales_item_facts  WHERE tenant_id='$TENANT_ID'")
pc=$(ch_query "SELECT count() FROM clickhouse_analytics.purchase_tax_facts WHERE tenant_id='$TENANT_ID'")
tc=$(ch_query "SELECT count() FROM clickhouse_analytics.till_session_facts WHERE tenant_id='$TENANT_ID'")
rev=$(ch_query "SELECT sum(total_paisa) FROM clickhouse_analytics.sales_order_facts WHERE tenant_id='$TENANT_ID'")
otax=$(ch_query "SELECT sum(tax_paisa) FROM clickhouse_analytics.sales_order_facts WHERE tenant_id='$TENANT_ID'")
itax=$(ch_query "SELECT sum(input_tax_paisa) FROM clickhouse_analytics.purchase_tax_facts WHERE tenant_id='$TENANT_ID'")
echo "   sales_order_facts : $oc"
echo "   sales_item_facts  : $ic"
echo "   purchase_tax_facts: $pc"
echo "   till_session_facts: $tc"
echo "   total revenue     : $rev paisa   output tax: $otax   input tax: $itax   net payable: $((otax - itax)) paisa"

# --- Postgres: set the demo branch NTN / STRN so the FBR header is non-null -----------------
echo "-- setting branch NTN/STRN in $USER_DB.branches..."
PG_SQL="SET app.current_tenant_id = '$TENANT_ID';
UPDATE branches SET ntn = '$NTN_VALUE', fbr_strn = '$STRN_VALUE', updated_at = NOW()
WHERE id = '$BRANCH_ID' AND tenant_id = '$TENANT_ID';"

run_pg() {
  if command -v psql >/dev/null 2>&1 && [[ -n "${PGHOST:-}${DATABASE_URL:-}" ]]; then
    psql "${DATABASE_URL:-}" -v ON_ERROR_STOP=1 -d "$USER_DB" -c "$PG_SQL"
  elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${PG_CONTAINER}$"; then
    docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -d "$USER_DB" -c "$PG_SQL"
  else
    echo "WARN: no psql/docker route to Postgres — skipping NTN/STRN update." >&2
    echo "      Run this manually against $USER_DB when the DB is reachable:" >&2
    echo "$PG_SQL" >&2
    return 1
  fi
}
if run_pg; then
  echo "   branch NTN=$NTN_VALUE STRN=$STRN_VALUE set."
fi

echo ""
echo "== DONE. Mock data seeded. =="
echo "Now (with reporting/nlq/user/auth/gateway UP) you can test:"
echo "  - Reports + named reports, FBR Tax Summary (non-null NTN/STRN, output/input/net)"
echo "  - Dashboard REST snapshot tiles"
echo "  - NLQ: \"What was total revenue today?\" / \"top selling items this week\""
echo "Note: the realtime dashboard WS PUSH (UAT tests 3/4) still needs a LIVE order close, not this seed."
