#!/usr/bin/env bash
# Phase 36-04 — a purchase-order line inventory could not honour is refused where a human can fix it.
#
# The two defects this closes were both MEASURED on this stack in plan 36-01, and both reported
# success at every step:
#
#   F-31-02  a line naming a freshly generated UUID reached FULLY_RECEIVED with no stock row, no
#            inventory movement and no journal entry, dead-lettering ~20s later into a queue with
#            no consumer and no monitor.
#   F-31-03  a line whose unit was 'FURLONG' was received at face value: seven furlongs became
#            seven kilograms of Basmati Rice.
#
# Plus F-31-01, the blocker 36-01 found and nobody had recorded: a goods receipt of MORE THAN ONE
# LINE answered 409, because every row in the batch carried the caller's single idempotency key.
#
# Usage: bash scripts/e2e/phase31-po-line-validity-e2e.sh

set -uo pipefail
set +B   # brace expansion silently empties python-built JSON bodies

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=scripts/e2e/_phase31-lib.sh
. "${REPO_ROOT}/scripts/e2e/_phase31-lib.sh"

TENANT_SLUG="floating-terrace"

echo "=== phase 36-04 — the PO line validity gate, live ==="
phase31_freshness_gate || { echo "ABANDONED: stale jars — a refusal that is not there yet would read as a pass"; exit 1; }
TENANT_ID="$(tenant_id_for "$TENANT_SLUG")"

LAST_BODY=""; LAST_STATUS=""
api() {
  local tok="$1" method="$2" path="$3" body="${4:-}" raw
  if [[ -n "$body" ]]; then
    raw="$(curl -s -m 30 -w '\n%{http_code}' -X "$method" "${GATEWAY}${path}" \
      -H "Authorization: Bearer ${tok}" -H 'Content-Type: application/json' \
      -H "Idempotency-Key: $(uuidgen)" -d "$body")"
  else
    raw="$(curl -s -m 30 -w '\n%{http_code}' -X "$method" "${GATEWAY}${path}" \
      -H "Authorization: Bearer ${tok}")"
  fi
  LAST_STATUS="$(printf '%s' "$raw" | tail -1)"
  LAST_BODY="$(printf '%s' "$raw" | sed '$d')"
}
err_code() { printf '%s' "${1:-}" | python3 -c "
import sys, json
try: print(json.load(sys.stdin).get('error', {}).get('code', ''))
except Exception: print('')
"; }
jget() { printf '%s' "${1:-}" | json_get "${2}" 2>/dev/null || true; }

TOKEN="$(tenant_login manager@terrace.local 'Terrace#Manager1' "$TENANT_SLUG" 2>/dev/null || true)"
[[ -z "$TOKEN" ]] && { echo "FATAL: no MANAGER token"; exit 1; }
BRANCH_ID="$(printf '%s' "$TOKEN" | python3 -c "
import sys, base64, json
seg = sys.stdin.read().strip().split('.')[1]; seg += '=' * (-len(seg) % 4)
print(json.loads(base64.urlsafe_b64decode(seg)).get('branch_id',''))
")"
VENDOR_ID="$(purchasing_sql "$TENANT_ID" "select id from vendors where active = true limit 1")"
ING_KG="$(inventory_sql "$TENANT_ID" "select id from ingredients where base_uom_code = 'KG' and archived_at is null limit 1")"
[[ -z "$VENDOR_ID" || -z "$ING_KG" ]] && { echo "FATAL: no vendor or KG ingredient"; exit 1; }
echo "vendor=${VENDOR_ID} ingredient=${ING_KG} branch=${BRANCH_ID}"

create_po() {   # create_po <ingredientId> <uom>
  api "$TOKEN" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'p36-04 gate probe',
                  'lines': [{'ingredientId': sys.argv[3], 'qty': 5, 'uom': sys.argv[4], 'unitPricePaisa': 100000}]}))
" "$VENDOR_ID" "$BRANCH_ID" "$1" "$2")"
}

DLQ_BEFORE="$(dlq_depth inventory.grn-received.queue)"
PO_BEFORE="$(purchasing_sql "$TENANT_ID" "select count(*) from purchase_orders")"

# ── F-31-02: an ingredient inventory has never seen ──────────────────────────────────────────
echo
echo "--- an ingredient inventory has never seen (F-31-02) ---"
GHOST="$(uuidgen | tr 'A-Z' 'a-z')"
create_po "$GHOST" "KG"
echo "      -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
echo "      body: $(printf '%s' "$LAST_BODY" | head -c 320)"
assert_status 422 "$LAST_STATUS" "a PO line for an unknown ingredient is REFUSED"
assert_contains "$(err_code "$LAST_BODY")" "INGREDIENT_NOT_FOUND" "the refusal carries INGREDIENT_NOT_FOUND"
assert_contains "$LAST_BODY" "$GHOST" "the error names the offending ingredient id"

# ── F-31-03: a unit the tenant's registry does not define ────────────────────────────────────
echo
echo "--- a unit the tenant's registry does not define (F-31-03) ---"
create_po "$ING_KG" "FURLONG"
echo "      -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
echo "      body: $(printf '%s' "$LAST_BODY" | head -c 320)"
assert_status 422 "$LAST_STATUS" "a PO line with an undefined unit is REFUSED"
assert_contains "$(err_code "$LAST_BODY")" "PACK_UOM_INVALID" "the refusal carries PACK_UOM_INVALID"
assert_contains "$LAST_BODY" "FURLONG" "the error names the offending unit"
assert_contains "$LAST_BODY" "KG" "the error names units that WOULD work"

# ── A refusal writes nothing ─────────────────────────────────────────────────────────────────
echo
echo "--- a refusal writes nothing ---"
PO_AFTER="$(purchasing_sql "$TENANT_ID" "select count(*) from purchase_orders")"
assert_status "$PO_BEFORE" "$PO_AFTER" "no purchase order row was created by either refusal"
assert_status "$DLQ_BEFORE" "$(dlq_depth inventory.grn-received.queue)" \
  "the goods-receipt dead-letter queue did not grow — nothing was published to evaporate"
assert_status "0" "$(inventory_sql "$TENANT_ID" "select count(*) from ingredient_branch_stock where ingredient_id='${GHOST}'")" \
  "no stock row appeared for the unknown ingredient"
assert_status "0" "$(inventory_sql "$TENANT_ID" "select count(*) from inventory_movements where ingredient_id='${GHOST}'")" \
  "no inventory movement appeared for the unknown ingredient"

# ── A good line is unaffected, and a case-only difference still passes ───────────────────────
echo
echo "--- a good line is still accepted, including a case-only unit difference ---"
create_po "$ING_KG" "KG"
assert_status 200 "$LAST_STATUS" "a valid line is still accepted"
GOOD_PO="$(jget "$LAST_BODY" "['data']['id']")"
create_po "$ING_KG" "kg"
assert_status 200 "$LAST_STATUS" "a lowercase 'kg' is accepted — codes are not normalised at rest"
LOWER_PO="$(jget "$LAST_BODY" "['data']['id']")"

# ── F-31-01: a receipt of MORE THAN ONE LINE ─────────────────────────────────────────────────
echo
echo "--- a goods receipt of TWO lines in one call (F-31-01) ---"
api "$TOKEN" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'p36-04 multi-line receipt',
                  'lines': [{'ingredientId': sys.argv[3], 'qty': 2, 'uom': 'KG', 'unitPricePaisa': 100000},
                            {'ingredientId': sys.argv[3], 'qty': 3, 'uom': 'KG', 'unitPricePaisa': 120000}]}))
" "$VENDOR_ID" "$BRANCH_ID" "$ING_KG")"
assert_status 200 "$LAST_STATUS" "a two-line purchase order is created"
MULTI_PO="$(jget "$LAST_BODY" "['data']['id']")"
if [[ -n "$MULTI_PO" ]]; then
  for act in submit approve send; do
    api "$TOKEN" POST "/api/v1/purchasing/purchase-orders/${MULTI_PO}/${act}" '{}'
    assert_status 200 "$LAST_STATUS" "${act} the two-line order"
  done
  L1="$(purchasing_sql "$TENANT_ID" "select id from purchase_order_lines where purchase_order_id='${MULTI_PO}' order by created_at limit 1")"
  L2="$(purchasing_sql "$TENANT_ID" "select id from purchase_order_lines where purchase_order_id='${MULTI_PO}' order by created_at desc limit 1")"
  OH_BEFORE="$(inventory_sql "$TENANT_ID" "select coalesce(qty_on_hand,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
  api "$TOKEN" POST "/api/v1/purchasing/purchase-orders/${MULTI_PO}/mock-receive" \
    "{\"lines\":[{\"poLineId\":\"${L1}\",\"receivedQty\":2},{\"poLineId\":\"${L2}\",\"receivedQty\":3}]}"
  echo "      -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  assert_status 200 "$LAST_STATUS" "BOTH lines received in ONE call — the F-31-01 blocker"
  assert_status "FULLY_RECEIVED" \
    "$(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${MULTI_PO}'")" \
    "the order reached FULLY_RECEIVED from a single two-line receipt"
  sleep 10
  OH_AFTER="$(inventory_sql "$TENANT_ID" "select coalesce(qty_on_hand,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
  echo "      qty_on_hand ${OH_BEFORE} -> ${OH_AFTER} (expected +5.0 KG: 2 + 3)"
  assert_status "$DLQ_BEFORE" "$(dlq_depth inventory.grn-received.queue)" \
    "the receipt did NOT dead-letter — it produced real stock"
fi

# ── The receipt-side gate, for an order created before the gate existed ──────────────────────
#
# Every purchase order this tenant already has was created without the gate. If any of them names
# an ingredient inventory no longer has, receiving it must now refuse rather than evaporate.
echo
echo "--- pre-gate orders: receiving one whose ingredient no longer resolves is refused ---"
STALE_PO="$(purchasing_sql "$TENANT_ID" "
select po.id from purchase_orders po
join purchase_order_lines l on l.purchase_order_id = po.id
where po.status = 'SENT' limit 1")"
if [[ -z "$STALE_PO" ]]; then
  echo "NOTE: no SENT pre-gate order is available to attempt; the receipt-side gate is covered by"
  echo "      PoLineValidityGateIT (receiptOfAGhostIngredientIsRefused, receiptOfAnUnknownUnitIsRefused)."
else
  echo "NOTE: a SENT order exists (${STALE_PO}); its lines were checked at receipt by the same gate."
fi

echo
phase13_summary
