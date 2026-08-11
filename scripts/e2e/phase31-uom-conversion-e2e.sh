#!/usr/bin/env bash
# Phase 36-06 — the conversion, proven on the real receiving path with a case a human can check.
#
# THE CASE. A vendor sells an ingredient in a 500 g pack for PKR 6,200. The ingredient is stocked in
# KG. Two packs arrive.
#
#   quantity   2 packs x 500 G = 1000 G  ->  x 0.001 KG/G  =  1.0 KG      (not 1000)
#   unit cost  620,000 paisa/pack / 500 g = 1,240 paisa/g  ->  /0.001 = 1,240,000 paisa/KG
#   value      1.0 KG x 1,240,000 paisa   =  1,240,000 paisa = PKR 12,400 = what two packs cost
#
# Money identical before and after; quantity a thousandfold apart. Anyone can check it by hand,
# which is the point: receiving 1000 G as 1000 KG was live on this stack and every downstream check
# stayed green through it.
#
# Usage: bash scripts/e2e/phase31-uom-conversion-e2e.sh

set -uo pipefail
set +B

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=scripts/e2e/_phase31-lib.sh
. "${REPO_ROOT}/scripts/e2e/_phase31-lib.sh"

TENANT_SLUG="floating-terrace"

echo "=== phase 36-06 — the purchase-unit conversion, on the real receiving path ==="
phase31_freshness_gate || { echo "ABANDONED: stale jars"; exit 1; }
TENANT_ID="$(tenant_id_for "$TENANT_SLUG")"

LAST_BODY=""; LAST_STATUS=""
api() {
  local tok="$1" method="$2" path="$3" body="${4:-}" raw
  if [[ -n "$body" ]]; then
    raw="$(curl -s -m 30 -w '\n%{http_code}' -X "$method" "${GATEWAY}${path}" \
      -H "Authorization: Bearer ${tok}" -H 'Content-Type: application/json' \
      -H "Idempotency-Key: $(uuidgen)" -d "$body")"
  else
    raw="$(curl -s -m 30 -w '\n%{http_code}' -X "$method" "${GATEWAY}${path}" -H "Authorization: Bearer ${tok}")"
  fi
  LAST_STATUS="$(printf '%s' "$raw" | tail -1)"
  LAST_BODY="$(printf '%s' "$raw" | sed '$d')"
}
jget() { printf '%s' "${1:-}" | json_get "${2}" 2>/dev/null || true; }

TOKEN="$(tenant_login manager@terrace.local 'Terrace#Manager1' "$TENANT_SLUG" 2>/dev/null || true)"
[[ -z "$TOKEN" ]] && { echo "FATAL: no token"; exit 1; }
BRANCH_ID="$(printf '%s' "$TOKEN" | python3 -c "
import sys, base64, json
seg = sys.stdin.read().strip().split('.')[1]; seg += '=' * (-len(seg) % 4)
print(json.loads(base64.urlsafe_b64decode(seg)).get('branch_id',''))
")"
VENDOR_ID="$(purchasing_sql "$TENANT_ID" "select id from vendors where active = true limit 1")"
MARK="$(date +%s)$((RANDOM % 90 + 10))"

# A FRESH ingredient, so the arithmetic is checkable without unpicking history.
api "$TOKEN" GET "/api/v1/inventory/categories"
CAT_ID="$(jget "$LAST_BODY" "['data'][0]['id']")"
api "$TOKEN" POST "/api/v1/inventory/ingredients" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Conversion Probe Rice ' + sys.argv[1], 'sku': 'CPR-' + sys.argv[1],
                  'baseUomCode': 'KG', 'categoryId': sys.argv[2], 'reorderPoint': 1}))
" "$MARK" "$CAT_ID")"
assert_status 200 "$LAST_STATUS" "a fresh KG-stocked ingredient is created"
ING="$(jget "$LAST_BODY" "['data']['id']")"

# The catalog row: 500 G per pack, PKR 6,200 per pack.
api "$TOKEN" POST "/api/v1/purchasing/vendors/${VENDOR_ID}/items" "$(python3 -c "
import json, sys
print(json.dumps({'ingredientId': sys.argv[1], 'vendorSku': 'CPS-' + sys.argv[2],
                  'orderUom': 'PACK', 'packQty': 500, 'packUom': 'G',
                  'packDescription': '500 g pack',
                  'initialUnitPricePaisa': 620000, 'initialPriceUom': 'PACK'}))
" "$ING" "$MARK")"
assert_status 200 "$LAST_STATUS" "a 500 G pack priced at PKR 6,200 is added to the catalog"
VITEM="$(jget "$LAST_BODY" "['data']['id']")"

api "$TOKEN" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'p36-06 conversion',
                  'lines': [{'vendorItemId': sys.argv[3], 'qty': 2}]}))
" "$VENDOR_ID" "$BRANCH_ID" "$VITEM")"
assert_status 200 "$LAST_STATUS" "a purchase order for TWO packs"
PO="$(jget "$LAST_BODY" "['data']['id']")"
for act in submit approve send; do
  api "$TOKEN" POST "/api/v1/purchasing/purchase-orders/${PO}/${act}" '{}'
  assert_status 200 "$LAST_STATUS" "${act}"
done

LINE="$(purchasing_sql "$TENANT_ID" "select id from purchase_order_lines where purchase_order_id='${PO}' limit 1")"
GL_BEFORE="$(finance_sql "$TENANT_ID" "
select coalesce(sum(jl.debit_paisa),0) - coalesce(sum(jl.credit_paisa),0)
from journal_lines jl join journal_entries je on je.id = jl.je_id
where je.tenant_id = '${TENANT_ID}' and jl.account_code = '1300'")"

api "$TOKEN" POST "/api/v1/purchasing/purchase-orders/${PO}/mock-receive" \
  "{\"lines\":[{\"poLineId\":\"${LINE}\",\"receivedQty\":2}]}"
assert_status 200 "$LAST_STATUS" "receive both packs"
sleep 12

echo
echo "--- the hand-checkable answer ---"
ONHAND="$(inventory_sql "$TENANT_ID" "select qty_on_hand from ingredient_branch_stock where ingredient_id='${ING}' and branch_id='${BRANCH_ID}'")"
MAC="$(inventory_sql "$TENANT_ID" "select avg_cost_paisa from ingredient_branch_stock where ingredient_id='${ING}' and branch_id='${BRANCH_ID}'")"
echo "      qty_on_hand      = ${ONHAND}   (expected 1.0000 — 2 x 500 G = 1000 G = 1 KG, NOT 1000)"
echo "      avg_cost_paisa   = ${MAC}   (expected 1240000.0000 paisa/KG — PKR 12,400/kg)"
assert_status "1.0000" "$ONHAND" "two 500 G packs are ONE kilogram"
assert_status "1240000.0000" "$MAC" "the cost per kilogram is the pack price scaled by the same factor"

# The invariant that matters: a unit conversion must not create or destroy money.
VALUE="$(python3 -c "
from decimal import Decimal
print((Decimal('${ONHAND}') * Decimal('${MAC}')).quantize(Decimal('1')))
")"
echo "      on-hand x MAC    = ${VALUE} paisa   (expected 1240000 — exactly what two packs cost)"
assert_status "1240000" "$VALUE" "value survives the conversion exactly"

GL_AFTER="$(finance_sql "$TENANT_ID" "
select coalesce(sum(jl.debit_paisa),0) - coalesce(sum(jl.credit_paisa),0)
from journal_lines jl join journal_entries je on je.id = jl.je_id
where je.tenant_id = '${TENANT_ID}' and jl.account_code = '1300'")"
GL_DELTA="$(python3 -c "print(int('${GL_AFTER}') - int('${GL_BEFORE}'))")"
echo "      inventory control (1300) moved by ${GL_DELTA} paisa (expected 1240000)"
assert_status "1240000" "$GL_DELTA" "the ledger was debited the money that was actually spent"

MOVES="$(inventory_sql "$TENANT_ID" "select count(*) from inventory_movements where ingredient_id='${ING}'")"
assert_status "1" "$MOVES" "exactly one movement row"

# ── The refusal ──────────────────────────────────────────────────────────────────────────────
#
# 36-04 refuses an unresolvable unit at the API, loud and early. 36-06 makes the CONSUMER refuse
# too, so a message that reaches inventory some other way dead-letters instead of creating stock at
# face value. The API refusal is what a person sees; this asserts it is the one that fires first.
echo
echo "--- an unresolvable unit is refused before it can become stock ---"
DLQ_BEFORE="$(dlq_depth inventory.grn-received.queue)"
api "$TOKEN" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'p36-06 refusal',
                  'lines': [{'ingredientId': sys.argv[3], 'qty': 7, 'uom': 'FURLONG', 'unitPricePaisa': 100000}]}))
" "$VENDOR_ID" "$BRANCH_ID" "$ING")"
echo "      -> HTTP ${LAST_STATUS}"
assert_status 422 "$LAST_STATUS" "the API refuses first — a person sees this, not a dead letter"
assert_status "$ONHAND" \
  "$(inventory_sql "$TENANT_ID" "select qty_on_hand from ingredient_branch_stock where ingredient_id='${ING}' and branch_id='${BRANCH_ID}'")" \
  "on-hand is untouched — 7 FURLONG did not become 7 KG"
assert_status "$DLQ_BEFORE" "$(dlq_depth inventory.grn-received.queue)" \
  "nothing was published, so nothing dead-lettered"

echo
phase13_summary
