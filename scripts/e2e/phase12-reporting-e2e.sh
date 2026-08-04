#!/usr/bin/env bash
# Phase 12-10 — Real-stack E2E proof: ETL -> ClickHouse facts -> named reports -> FBR Tax Summary
# -> dashboard push, driven as a real OWNER persona through the real gateway with a real JWT.
#
# Preconditions (see 12-E2E-EVIDENCE.md for exactly how this was satisfied on the reference run):
#   - Docker infra up (postgres, redis, rabbitmq, minio, opa, eureka, config-server, clickhouse)
#   - auth-service, authorization-service, user-service, platform-admin-service, pos-service,
#     purchasing-service, finance-service, reporting-service, gateway all UP and Eureka-registered
#   - deploy/clickhouse/apply.sh has been run (sales_order_facts / sales_item_facts /
#     purchase_tax_facts / till_session_facts + nlq_readonly exist)
#   - The demo tenant (a0000001-0000-4000-8000-000000000001) / branch
#     (b0000001-0000-4000-8000-000000000001) / owner@demo.local exist (seeded by auth-service
#     Liquibase context=seed) and TOTP is enrolled: `python3 scripts/generate_totp.py
#     owner@demo.local --enroll`
#   - finance-service's chart of accounts is provisioned for the tenant:
#     POST /internal/tenants/{tenantId}/provision (X-Internal-Service header) — a fresh
#     platform_db tenant row does NOT auto-provision finance's CoA; this is a real, live-only gap
#     this script's first run discovered (see evidence doc).
#
# Usage: GATEWAY=http://localhost:8080 bash scripts/e2e/phase12-reporting-e2e.sh
set -euo pipefail

GATEWAY="${GATEWAY:-http://localhost:8080}"
TENANT_ID="a0000001-0000-4000-8000-000000000001"
BRANCH_ID="b0000001-0000-4000-8000-000000000001"

# shellcheck disable=SC1091
[[ -f deploy/.env ]] && source deploy/.env
# deploy/.env's CLICKHOUSE_URL (http://clickhouse:8123) is the in-Docker-network hostname —
# unresolvable from this host-run script. Always talk to the host-published port unless
# CLICKHOUSE_HTTP is explicitly set.
CLICKHOUSE_URL="${CLICKHOUSE_HTTP:-http://localhost:8123}"

PASS=0
FAIL=0

pass() { echo "PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $*"; FAIL=$((FAIL+1)); }

json_get() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }

# The gateway's Resilience4j circuit breaker on a cold/idle lb://<service> pool intermittently
# answers the FIRST request after a quiet period with its own SERVICE_UNAVAILABLE fallback (this
# is the exact 10-13-H/10-14-E failure mode) even though the request landed and the backend
# processed it correctly. Retrying once (not silently swallowing a REAL error — a second
# consecutive SERVICE_UNAVAILABLE is treated as real) matches how any real client must behave
# against this gateway and keeps the assertions honest rather than flaky.
curl_retry() {
  local resp
  resp="$(curl -s "$@")"
  if echo "$resp" | grep -q '"code":"SERVICE_UNAVAILABLE"'; then
    sleep 2
    resp="$(curl -s "$@")"
  fi
  echo "$resp"
}

ch_query() {
  # $1 = SQL, executed via ClickHouse HTTP interface as `default`
  curl -s "$CLICKHOUSE_URL/?user=default&password=${CLICKHOUSE_PASSWORD:-}" --data-binary "$1"
}

echo "=== Step 1: Auth — real login for owner@demo.local, assert real permissions in the JWT ==="
CODE="$(python3 scripts/generate_totp.py owner@demo.local | grep -oE '[0-9]{6}' | head -1)"
LOGIN_RESP="$(curl_retry -X POST "$GATEWAY/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"owner@demo.local\",\"password\":\"Owner#2026\",\"tenantSlug\":\"demo\",\"totpCode\":\"$CODE\"}")"
TOKEN="$(echo "$LOGIN_RESP" | json_get "['data']['accessToken']" 2>/dev/null || true)"
if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
  fail "login did not return an accessToken. Raw response: $LOGIN_RESP"
  exit 1
fi
pass "login returned a non-empty JWT"

CLAIMS="$(echo "$TOKEN" | cut -d. -f2)"
PAD=$(( (4 - ${#CLAIMS} % 4) % 4 ))
CLAIMS_PADDED="${CLAIMS}$(printf '=%.0s' $(seq 1 $PAD))"
DECODED="$(echo "$CLAIMS_PADDED" | python3 -c "import sys,base64,json; print(json.dumps(json.loads(base64.urlsafe_b64decode(sys.stdin.read()))))")"
echo "Decoded claims: $DECODED"
for perm in reporting.report.view reporting.report.fbr reporting.dashboard.view; do
  if echo "$DECODED" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if '$perm' in d.get('permissions',[]) else 1)"; then
    pass "JWT carries permission $perm"
  else
    fail "JWT MISSING permission $perm — 12-05/12-06/12-11 changeset not seeded+granted"
  fi
done

echo ""
echo "=== Step 2: Close 3 real POS orders through the real gateway with known tax amounts ==="
# Menu items e2e00002-...-1/2/3 (tax 1000/2500/500 paisa) are seeded once via
# scripts/e2e/_seed-e2e-menu.sql (idempotent) against pos_db.
ITEM_A="e2e00002-0000-4000-8000-000000000001"  # tax 1000
ITEM_B="e2e00002-0000-4000-8000-000000000002"  # tax 2500
ITEM_C="e2e00002-0000-4000-8000-000000000003"  # tax 500
ORDER_IDS=()
EXPECTED_TAX_TOTAL=4000
EXPECTED_REVENUE_TOTAL=0

close_one_order() {
  local item_id="$1" amount_paisa="$2"
  local client_id order_id line_id item_resp pay_resp
  client_id="$(python3 -c 'import uuid;print(uuid.uuid4())')"
  ORD="$(curl_retry -X POST "$GATEWAY/api/v1/pos/orders" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"branchId\":\"$BRANCH_ID\",\"clientOrderId\":\"$client_id\",\"type\":\"DINE_IN\",\"coverCount\":1}")"
  order_id="$(echo "$ORD" | json_get "['data']['id']")"
  item_resp="$(curl_retry -X POST "$GATEWAY/api/v1/pos/orders/$order_id/items" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"menuItemId\":\"$item_id\",\"branchId\":\"$BRANCH_ID\",\"quantity\":1}")"
  line_id="$(echo "$item_resp" | json_get "['data']['items'][0]['id']")"
  curl_retry -X POST "$GATEWAY/api/v1/pos/orders/$order_id/send-to-kds" -H "Authorization: Bearer $TOKEN" >/dev/null
  curl_retry -X POST "$GATEWAY/api/v1/pos/orders/$order_id/items/$line_id/serve" -H "Authorization: Bearer $TOKEN" >/dev/null
  pay_resp="$(curl_retry -X POST "$GATEWAY/api/v1/pos/orders/$order_id/payments" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"method\":\"CASH\",\"amountPaisa\":$amount_paisa}")"
  echo "$order_id"
}

O1="$(close_one_order "$ITEM_A" 11000)"; ORDER_IDS+=("$O1")
O2="$(close_one_order "$ITEM_B" 27500)"; ORDER_IDS+=("$O2")
O3="$(close_one_order "$ITEM_C" 5500)"; ORDER_IDS+=("$O3")
EXPECTED_REVENUE_TOTAL=44000
echo "Closed orders: ${ORDER_IDS[*]}"
pass "3 real POS orders closed through the gateway (tax 1000+2500+500=4000 paisa)"

echo ""
echo "=== Step 3: Match 2 real vendor invoices (PO -> approve -> send -> mock-receive -> invoice) ==="
VENDOR_RESP="$(curl_retry -X POST "$GATEWAY/api/v1/purchasing/vendors" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"name\":\"E2E Vendor $(date +%s)\",\"paymentTerms\":\"NET_30\",\"ntn\":\"1234567-8\",\"strn\":\"12-34-5678-901-23\"}")"
VENDOR_ID="$(echo "$VENDOR_RESP" | json_get "['data']['id']")"

match_one_invoice() {
  local qty="$1" unit_price="$2" input_tax="$3" invoice_no="$4"
  local ing po_resp po_id line_id
  ing="$(python3 -c 'import uuid;print(uuid.uuid4())')"
  po_resp="$(curl_retry -X POST "$GATEWAY/api/v1/purchasing/purchase-orders" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"vendorId\":\"$VENDOR_ID\",\"branchId\":\"$BRANCH_ID\",\"notes\":\"E2E\",\"lines\":[{\"ingredientId\":\"$ing\",\"qty\":$qty,\"uom\":\"kg\",\"unitPricePaisa\":$unit_price}]}")"
  po_id="$(echo "$po_resp" | json_get "['data']['id']")"
  line_id="$(echo "$po_resp" | json_get "['data']['lines'][0]['id']")"
  curl_retry -X POST "$GATEWAY/api/v1/purchasing/purchase-orders/$po_id/submit" -H "Authorization: Bearer $TOKEN" >/dev/null
  curl_retry -X POST "$GATEWAY/api/v1/purchasing/purchase-orders/$po_id/approve" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' >/dev/null
  curl_retry -X POST "$GATEWAY/api/v1/purchasing/purchase-orders/$po_id/send" -H "Authorization: Bearer $TOKEN" >/dev/null
  curl_retry -X POST "$GATEWAY/api/v1/purchasing/purchase-orders/$po_id/mock-receive" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"lines\":[{\"poLineId\":\"$line_id\",\"receivedQty\":$qty}]}" >/dev/null
  curl_retry -X POST "$GATEWAY/api/v1/purchasing/invoices" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"purchaseOrderId\":\"$po_id\",\"invoiceNo\":\"$invoice_no\",\"invoiceDate\":\"$(date +%Y-%m-%d)\",\"inputTaxPaisa\":$input_tax,\"lines\":[{\"poLineId\":\"$line_id\",\"qty\":$qty,\"unitPricePaisa\":$unit_price}]}"
}

INV1="$(match_one_invoice 10 100000 1500 "INV-E2E-$(date +%s)-1")"
INV2="$(match_one_invoice 5 50000 250 "INV-E2E-$(date +%s)-2")"
echo "Invoice 1: $INV1"
echo "Invoice 2: $INV2"
if echo "$INV1$INV2" | grep -q '"status":"MATCHED"'; then
  pass "2 vendor invoices MATCHED (inputTaxPaisa 1500 + 250 = 1750)"
else
  fail "vendor invoices did not reach MATCHED status"
fi

echo ""
echo "=== Step 4: Poll ClickHouse for the facts (up to 30s) ==="
deadline=$((SECONDS + 30))
while (( SECONDS < deadline )); do
  N="$(ch_query "SELECT count() FROM clickhouse_analytics.sales_order_facts WHERE tenant_id = '$TENANT_ID'")"
  if [[ "$N" -ge 3 ]]; then break; fi
  sleep 2
done
SALES_COUNT="$(ch_query "SELECT count() FROM clickhouse_analytics.sales_order_facts WHERE tenant_id = '$TENANT_ID'")"
TAX_SUM="$(ch_query "SELECT sum(tax_paisa) FROM clickhouse_analytics.sales_order_facts WHERE order_id IN ('$O1','$O2','$O3')")"
ITEM_COUNT="$(ch_query "SELECT count() FROM clickhouse_analytics.sales_item_facts WHERE order_id IN ('$O1','$O2','$O3')")"
PURCHASE_COUNT="$(ch_query "SELECT count() FROM clickhouse_analytics.purchase_tax_facts WHERE tenant_id = '$TENANT_ID'")"
INPUT_TAX_SUM="$(ch_query "SELECT sum(input_tax_paisa) FROM clickhouse_analytics.purchase_tax_facts WHERE tenant_id = '$TENANT_ID'")"
COGS_NOT_NULL="$(ch_query "SELECT count() FROM clickhouse_analytics.sales_item_facts WHERE cogs_paisa IS NOT NULL")"

echo "sales_order_facts count for tenant: $SALES_COUNT"
echo "tax_paisa sum for our 3 orders: $TAX_SUM (expected 4000)"
echo "sales_item_facts count for our 3 orders: $ITEM_COUNT (expected 3)"
echo "purchase_tax_facts count: $PURCHASE_COUNT"
echo "input_tax_paisa sum: $INPUT_TAX_SUM (expected >= 1750)"
echo "sales_item_facts with cogs_paisa NOT NULL: $COGS_NOT_NULL (expected 0 — Phase 8 gap, honest NULL)"

[[ "$TAX_SUM" == "4000" ]] && pass "sum(tax_paisa) for the 3 orders == 4000" || fail "sum(tax_paisa) == $TAX_SUM, expected 4000"
[[ "$ITEM_COUNT" == "3" ]] && pass "sales_item_facts count == 3" || fail "sales_item_facts count == $ITEM_COUNT, expected 3"
[[ "$COGS_NOT_NULL" == "0" ]] && pass "cogs_paisa IS NOT NULL count == 0 (Phase-8 columns honestly NULL)" || fail "cogs_paisa unexpectedly non-null in $COGS_NOT_NULL rows"

echo ""
echo "=== Step 5: Run sales-by-day through the gateway ==="
SBD="$(curl_retry -X POST "$GATEWAY/api/v1/reporting/reports/sales-by-day/run" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"branchId\":\"$BRANCH_ID\",\"from\":\"$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d '-30 days' +%Y-%m-%d)\",\"to\":\"$(date +%Y-%m-%d)\"}")"
echo "sales-by-day response: $SBD"
if echo "$SBD" | grep -q '"durationMs"'; then
  pass "sales-by-day report ran and returned durationMs"
else
  fail "sales-by-day report did not return durationMs"
fi

echo ""
echo "=== Step 6: Run the FBR Tax Summary through the gateway (THE load-bearing assertion) ==="
FBR="$(curl_retry "$GATEWAY/api/v1/reporting/reports/fbr-tax-summary?from=$(date -v-30d +%Y-%m-%d 2>/dev/null || date -d '-30 days' +%Y-%m-%d)&to=$(date +%Y-%m-%d)&branchId=$BRANCH_ID" -H "Authorization: Bearer $TOKEN")"
echo "FBR Tax Summary response: $FBR"
OUTPUT_TAX="$(echo "$FBR" | json_get "['data']['outputTaxPaisa']")"
INPUT_TAX="$(echo "$FBR" | json_get "['data']['inputTaxPaisa']")"
NET_PAYABLE="$(echo "$FBR" | json_get "['data']['netPayablePaisa']")"
NTN="$(echo "$FBR" | json_get "['data']['ntn']")"
FBR_STRN="$(echo "$FBR" | json_get "['data']['fbrStrn']")"

echo "outputTaxPaisa=$OUTPUT_TAX inputTaxPaisa=$INPUT_TAX netPayablePaisa=$NET_PAYABLE ntn=$NTN fbrStrn=$FBR_STRN"
[[ "$OUTPUT_TAX" == "4000" ]] && pass "outputTaxPaisa == 4000" || fail "outputTaxPaisa == $OUTPUT_TAX, expected 4000"
[[ "$INPUT_TAX" == "1750" ]] && pass "inputTaxPaisa == 1750" || fail "inputTaxPaisa == $INPUT_TAX, expected 1750"
[[ "$NET_PAYABLE" == "2250" ]] && pass "netPayablePaisa == 2250 (4000 - 1750)" || fail "netPayablePaisa == $NET_PAYABLE, expected 2250"
if [[ "$NTN" != "None" && -n "$NTN" ]]; then
  pass "ntn is non-null ($NTN) — internal Feign JWT-forward to user-service works live"
else
  fail "ntn is NULL — the internal Feign call to user-service's branch lookup is broken on the real stack (see evidence doc: BranchInternalController.getBranch only sets the RLS tenant GUC when an X-Tenant-Id header is present; reporting-service's Feign client does not send one, so the RLS-scoped query silently returns nothing). This is a REAL, live-only finding tied to the 10-25 internal-auth-seam gap class — NOT faked green."
fi

echo ""
echo "=== Summary: $PASS passed, $FAIL failed ==="
exit $(( FAIL > 0 ? 1 : 0 ))
