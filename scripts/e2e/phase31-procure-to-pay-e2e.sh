#!/usr/bin/env bash
# Phase 36-01 — drive the WHOLE procure-to-pay chain against the live stack and record what happens.
#
# This script deliberately fixes nothing. It answers one question with evidence: which steps of
# vendor → vendor item → PO → submit → approve → send → receive → invoice → three-way match → AP
# payment actually work through the gateway, as the real personas, and what reached the database.
#
# Two rules make the output trustworthy:
#
#   - A FAILING STEP DOES NOT STOP THE RUN. One defect must not hide the nine behind it, which is
#     what a `set -e` drive would do. Every step is attempted and its outcome recorded.
#   - EVERY CLAIM IS A LIVE RESPONSE OR A ROW READ AS THE SERVICE ROLE. Nothing here reads source.
#
# Exit code: zero when the DRIVE completed, regardless of how many assertions failed — it is a
# diagnostic. Set PHASE31_GATE=1 to make it exit non-zero when any assertion failed, which is how
# plans 36-06/07/08 reuse it unchanged as an acceptance gate.
#
# Usage:
#   bash scripts/e2e/phase31-procure-to-pay-e2e.sh
#   PHASE31_GATE=1 bash scripts/e2e/phase31-procure-to-pay-e2e.sh

set -uo pipefail   # NOT -e: see above.

# Brace expansion OFF. Every JSON body below is built by a `python3 -c` whose source contains
# `{'a': 1, 'b': 2}` — and bash expands that into two fragments BEFORE python ever sees it, so the
# program becomes `print(json.dumps('a': 1))` and the request goes out with an empty body. The
# service then answers 400 BAD_REQUEST "Request body is missing or malformed", which reads exactly
# like a product defect and is not one. _phase13-lib.sh's forced_change carries a comment about the
# same bash behaviour biting the harness in 13-02; this is the general cure.
set +B

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=scripts/e2e/_phase31-lib.sh
. "${REPO_ROOT}/scripts/e2e/_phase31-lib.sh"

LOG_DIR=".planning/phases/36-purchasing-inventory-wiring"
LOG="${LOG_DIR}/31-01-drive.log"
mkdir -p "$LOG_DIR"
exec > >(tee "$LOG") 2>&1

TENANT_SLUG="floating-terrace"
OTHER_SLUG="control-bistro-isolation-test-tenant"

echo "=========================================================================="
echo "PHASE 36-01 — procure-to-pay live drive"
echo "started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "gateway: ${GATEWAY}"
echo "=========================================================================="

# ── Gates ────────────────────────────────────────────────────────────────────────────────────
echo
echo "### GATE: jar freshness"
if ! phase31_freshness_gate; then
  echo "ABANDONING THE RUN. A result produced against a stale process is fiction."
  exit 1
fi

TENANT_ID="$(tenant_id_for "$TENANT_SLUG")"
OTHER_ID="$(tenant_id_for "$OTHER_SLUG")"
echo
echo "### GATE: RLS canary"
echo "tenant ${TENANT_SLUG} = ${TENANT_ID}"
if ! phase31_rls_canary "$TENANT_ID" "$OTHER_ID"; then
  echo "ABANDONING THE RUN. The harness's own SQL does not obey the tenant policy, so no row it"
  echo "reads below would prove anything about the tenant it claims to be reading."
  exit 1
fi

# ── Personas ─────────────────────────────────────────────────────────────────────────────────
echo
echo "### PERSONAS"

MGR_TOKEN=""; OWN_TOKEN=""
MGR_TOKEN="$(tenant_login manager@terrace.local 'Terrace#Manager1' "$TENANT_SLUG" 2>/dev/null || true)"
OWNER_TOTP="$(python3 scripts/generate_totp.py owner@terrace.local 2>/dev/null | grep -oE '[0-9]{6}' | head -1 || true)"
OWN_TOKEN="$(tenant_login owner@terrace.local 'Terrace#Owner1' "$TENANT_SLUG" "$OWNER_TOTP" 2>/dev/null || true)"

[[ -n "$MGR_TOKEN" ]] && echo "PASS: MANAGER authenticated" || echo "FAIL: MANAGER could not authenticate"
[[ -n "$OWN_TOKEN" ]] && echo "PASS: OWNER authenticated"   || echo "FAIL: OWNER could not authenticate"

# What the token ACTUALLY carries — read from the token, never assumed.
claims_field() {
  printf '%s' "${1:-}" | python3 -c "
import sys, base64, json
seg = sys.stdin.read().strip().split('.')[1]; seg += '=' * (-len(seg) % 4)
d = json.loads(base64.urlsafe_b64decode(seg))
import os
key = os.environ.get('CLAIM_KEY','')
if key == 'vendor_perms':
    print(','.join(sorted(p for p in d.get('permissions', []) if p.startswith('vendor.'))))
elif key == 'approval_limit':
    print(d.get('attributes', {}).get('approval_limit_paisa', 'ABSENT'))
else:
    print(d.get(key, ''))
"
}

for persona in MANAGER OWNER; do
  tok="$MGR_TOKEN"; [[ "$persona" == "OWNER" ]] && tok="$OWN_TOKEN"
  [[ -z "$tok" ]] && continue
  echo "  ${persona} vendor authorities : $(CLAIM_KEY=vendor_perms claims_field "$tok")"
  echo "  ${persona} approval_limit_paisa: $(CLAIM_KEY=approval_limit claims_field "$tok")"
done

BRANCH_ID="$(CLAIM_KEY=branch_id claims_field "${MGR_TOKEN:-$OWN_TOKEN}")"
echo "  branch: ${BRANCH_ID}"

# ── HTTP helpers that record instead of exploding ────────────────────────────────────────────
LAST_BODY=""; LAST_STATUS=""
api() {                       # api <token> <method> <path> [json body]
  local tok="$1" method="$2" path="$3" body="${4:-}"
  local raw
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
try:
    d = json.load(sys.stdin); print(d.get('error', {}).get('code', ''))
except Exception:
    print('')
"; }

# step <id> <expected status> <description> — scores LAST_STATUS, always prints the error code.
step() {
  local id="$1" expected="$2" desc="$3"
  local ec; ec="$(err_code "$LAST_BODY")"
  if [[ "$LAST_STATUS" == "$expected" ]]; then
    echo "PASS [${id}] ${desc} — HTTP ${LAST_STATUS}"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL [${id}] ${desc} — expected ${expected}, got ${LAST_STATUS}${ec:+ (${ec})}"
    echo "      body: $(printf '%s' "$LAST_BODY" | head -c 400)"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi
}

# note <id> <text> — an observation that is a FINDING whichever way it lands, so it is not scored.
note() { echo "NOTE [${1}] ${2}"; }

jget() { printf '%s' "${1:-}" | json_get "${2}" 2>/dev/null || true; }

MARK="p36-$(date +%s)"

# ── Queue depths before ──────────────────────────────────────────────────────────────────────
GRN_DLQ_BEFORE="$(dlq_depth inventory.grn-received.queue)"
GRN_Q_BEFORE="$(queue_depth inventory.grn-received.queue)"
FIN_DLQ_BEFORE="$(dlq_depth finance.stock-received.queue)"
INV_MATCH_BEFORE="$(queue_depth finance.invoice-matched.queue)"
echo
echo "### BROKER BEFORE"
echo "  inventory.grn-received.queue     = ${GRN_Q_BEFORE}   dlq = ${GRN_DLQ_BEFORE}"
echo "  finance.stock-received.queue.dlq = ${FIN_DLQ_BEFORE}"
echo "  finance.invoice-matched.queue    = ${INV_MATCH_BEFORE}"

# ── Master data the chain needs, read from the product ───────────────────────────────────────
echo
echo "### MASTER DATA (read through the product, as MANAGER)"
api "$MGR_TOKEN" GET "/api/v1/inventory/ingredients?status=ACTIVE"
step MD-ING-READ 200 "list ingredients"
ING_KG="$(printf '%s' "$LAST_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    print(next(i['id'] for i in d if i['baseUomCode'] == 'KG'))
except Exception:
    print('')
")"
ING_KG_NAME="$(printf '%s' "$LAST_BODY" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)['data']
    print(next(i['name'] for i in d if i['baseUomCode'] == 'KG'))
except Exception:
    print('')
")"
echo "  KG-stocked ingredient for the conversion probe: ${ING_KG_NAME} (${ING_KG})"

api "$MGR_TOKEN" GET "/api/v1/inventory/uom"
step MD-UOM-READ 200 "list units of measure"
api "$MGR_TOKEN" GET "/api/v1/inventory/categories"
step MD-CAT-READ 200 "list item categories"
CAT_ID="$(jget "$LAST_BODY" "['data'][0]['id']")"
api "$MGR_TOKEN" GET "/api/v1/inventory/storage-locations"
step MD-LOC-READ 200 "list storage locations"

# ══════════════════════════════════════════════════════════════════════════════════════════════
#  THE CHAIN, driven once per persona.
#
#  Driving it TWICE is the point: it separates "this role may not" from "this endpoint is broken
#  for everyone", which is the exact question the MANAGER 403 poses.
# ══════════════════════════════════════════════════════════════════════════════════════════════

drive_chain() {
  local persona="$1" tok="$2" p="$3"   # p = short id prefix
  echo
  echo "=========================================================================="
  echo "### CHAIN as ${persona}"
  echo "=========================================================================="
  if [[ -z "$tok" ]]; then
    echo "FAIL [${p}-AUTH] ${persona} has no token — the whole chain is unreachable for this persona"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
    return
  fi

  # 1 — vendor
  api "$tok" POST "/api/v1/purchasing/vendors" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Drive Vendor ' + sys.argv[1] + ' ' + sys.argv[2],
                  'paymentTerms': 'NET30', 'notes': sys.argv[1]}))
" "$MARK" "$persona")"
  step "${p}-01-VENDOR-CREATE" 200 "create vendor"
  local vendor_id; vendor_id="$(jget "$LAST_BODY" "['data']['id']")"
  if [[ -n "$vendor_id" ]]; then
    local row; row="$(purchasing_sql "$TENANT_ID" "select name from vendors where id='${vendor_id}'")"
    echo "      db: vendors row = '${row}'"
  fi

  api "$tok" GET "/api/v1/purchasing/vendors"
  step "${p}-02-VENDOR-LIST" 200 "list vendors"

  # 2 — vendor catalog item. Pack unit is G against a KG-stocked ingredient: this is the
  #     hand-checkable conversion case. 1 pack = 500 G = 0.5 KG.
  local vitem_id=""
  if [[ -n "$vendor_id" && -n "$ING_KG" ]]; then
    api "$tok" POST "/api/v1/purchasing/vendors/${vendor_id}/items" "$(python3 -c "
import json, sys
print(json.dumps({'ingredientId': sys.argv[1], 'vendorSku': 'SKU-' + sys.argv[2],
                  'orderUom': 'PACK', 'packQty': 500, 'packUom': 'G',
                  'packDescription': '500 g pack',
                  'initialUnitPricePaisa': 620000, 'initialPriceUom': 'PACK'}))
" "$ING_KG" "$MARK")"
    step "${p}-03-VITEM-CREATE" 200 "create vendor catalog item (500 G pack, PKR 6200)"
    vitem_id="$(jget "$LAST_BODY" "['data']['id']")"

    if [[ -n "$vitem_id" ]]; then
      api "$tok" POST "/api/v1/purchasing/vendor-items/${vitem_id}/prices" \
        '{"unitPricePaisa":620000,"priceUom":"PACK","contractPrice":false,"source":"MANUAL"}'
      step "${p}-04-VITEM-PRICE" 200 "record a current price"
      local prow; prow="$(purchasing_sql "$TENANT_ID" \
        "select unit_price_paisa from vendor_item_prices where vendor_item_id='${vitem_id}' order by effective_from desc limit 1")"
      echo "      db: vendor_item_prices.unit_price_paisa = ${prow}"
    fi
  fi

  # 3 — purchase order with BOTH line shapes
  local po_id=""
  if [[ -n "$vendor_id" && -n "$vitem_id" && -n "$ING_KG" ]]; then
    api "$tok" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2],
                  'notes': sys.argv[4],
                  'lines': [
                    {'vendorItemId': sys.argv[3], 'qty': 2},
                    {'ingredientId': sys.argv[5], 'qty': 3, 'uom': 'KG', 'unitPricePaisa': 1250000}
                  ]}))
" "$vendor_id" "$BRANCH_ID" "$vitem_id" "$MARK" "$ING_KG")"
    step "${p}-05-PO-CREATE" 200 "create PO — one catalog line, one hand-typed line"
    po_id="$(jget "$LAST_BODY" "['data']['id']")"
    if [[ -n "$po_id" ]]; then
      echo "      db: purchase_order_lines = $(purchasing_sql "$TENANT_ID" \
        "select count(*) from purchase_order_lines where purchase_order_id='${po_id}'")"
      echo "      db: po status = $(purchasing_sql "$TENANT_ID" \
        "select status from purchase_orders where id='${po_id}'")"
    fi
  fi

  if [[ -n "$po_id" ]]; then
    api "$tok" POST "/api/v1/purchasing/purchase-orders/${po_id}/submit" '{}'
    step "${p}-06-PO-SUBMIT" 200 "submit PO"
    echo "      db: po status = $(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${po_id}'")"

    api "$tok" POST "/api/v1/purchasing/purchase-orders/${po_id}/approve" '{}'
    step "${p}-07-PO-APPROVE" 200 "approve PO (gated by the approval limit on the token)"
    echo "      db: po status = $(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${po_id}'")"
    echo "      db: approval records = $(purchasing_sql "$TENANT_ID" \
      "select count(*) from po_approval_records where purchase_order_id='${po_id}'")"

    api "$tok" POST "/api/v1/purchasing/purchase-orders/${po_id}/send" '{}'
    step "${p}-08-PO-SEND" 200 "send PO to the vendor"
    echo "      db: po status = $(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${po_id}'")"
  fi

  # 4 — receive. THE CONVERSION PROBE lives here.
  local line_catalog=""
  if [[ -n "$po_id" ]]; then
    line_catalog="$(purchasing_sql "$TENANT_ID" \
      "select id from purchase_order_lines where purchase_order_id='${po_id}' and vendor_item_id is not null limit 1")"
    local line_typed
    line_typed="$(purchasing_sql "$TENANT_ID" \
      "select id from purchase_order_lines where purchase_order_id='${po_id}' and vendor_item_id is null limit 1")"

    local onhand_before mac_before
    onhand_before="$(inventory_sql "$TENANT_ID" \
      "select coalesce(qty_on_hand,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
    mac_before="$(inventory_sql "$TENANT_ID" \
      "select coalesce(avg_cost_paisa,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
    echo "      db BEFORE receipt: qty_on_hand=${onhand_before:-0} avg_cost_paisa=${mac_before:-0}"

    if [[ -n "$line_catalog" && -n "$line_typed" ]]; then
      api "$tok" POST "/api/v1/purchasing/purchase-orders/${po_id}/mock-receive" "$(python3 -c "
import json, sys
print(json.dumps({'lines': [{'poLineId': sys.argv[1], 'receivedQty': 2},
                            {'poLineId': sys.argv[2], 'receivedQty': 3}]}))
" "$line_catalog" "$line_typed")"
      step "${p}-09-PO-RECEIVE" 200 "receive goods — BOTH lines in one call, as a receiving clerk would"

      # Discriminator. If the two-line call failed, retry the SAME receipt one line at a time. A
      # single-line success here means receiving is not broken — receiving MORE THAN ONE LINE is,
      # which is a completely different defect with a completely different repair.
      if [[ "$LAST_STATUS" != "200" ]]; then
        note "${p}-09b" "two-line receive failed; retrying ONE line to discriminate"
        api "$tok" POST "/api/v1/purchasing/purchase-orders/${po_id}/mock-receive" \
          "{\"lines\":[{\"poLineId\":\"${line_catalog}\",\"receivedQty\":2}]}"
        note "${p}-09b" "single-line receive of the catalog line -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
        if [[ "$LAST_STATUS" == "200" ]]; then
          note "${p}-09b" "SINGLE LINE SUCCEEDS. The receiving path works; the MULTI-LINE call does not."
          api "$tok" POST "/api/v1/purchasing/purchase-orders/${po_id}/mock-receive" \
            "{\"lines\":[{\"poLineId\":\"${line_typed}\",\"receivedQty\":3}]}"
          note "${p}-09b" "single-line receive of the hand-typed line -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
        fi
      fi
      echo "      db: po status = $(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${po_id}'")"

      sleep 12   # let the GRN_RECEIVED message travel and inventory write the lot

      local onhand_after mac_after moves
      onhand_after="$(inventory_sql "$TENANT_ID" \
        "select coalesce(qty_on_hand,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
      mac_after="$(inventory_sql "$TENANT_ID" \
        "select coalesce(avg_cost_paisa,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
      moves="$(inventory_sql "$TENANT_ID" \
        "select count(*) from inventory_movements where ingredient_id='${ING_KG}' and created_at > now() - interval '3 minutes'")"
      echo "      db AFTER receipt : qty_on_hand=${onhand_after:-0} avg_cost_paisa=${mac_after:-0} movements(3m)=${moves:-0}"
      note "${p}-CONV" "CONVERSION PROBE. 2 packs x 500 G = 1000 G = 1.0 KG expected onto a KG-stocked"
      note "${p}-CONV" "ingredient, PLUS 3 KG from the hand-typed KG line = +4.0 KG expected in total."
      note "${p}-CONV" "observed delta = ${onhand_before:-0} -> ${onhand_after:-0}."
      note "${p}-CONV" "A delta near +1003 means the G pack was received at face value (the 1000x defect)."
      echo "      broker: grn dlq now $(dlq_depth inventory.grn-received.queue) (was ${GRN_DLQ_BEFORE})"
    else
      echo "FAIL [${p}-09-PO-RECEIVE] no PO lines to receive — upstream step failed"
      PHASE13_FAIL=$((PHASE13_FAIL + 1))
    fi
  fi

  # 5 — vendor invoice + three-way match
  local inv_id=""
  if [[ -n "$po_id" && -n "$line_catalog" ]]; then
    api "$tok" POST "/api/v1/purchasing/invoices" "$(python3 -c "
import json, sys, datetime
print(json.dumps({'purchaseOrderId': sys.argv[1],
                  'invoiceNo': 'INV-' + sys.argv[3],
                  'invoiceDate': datetime.date.today().isoformat(),
                  'inputTaxPaisa': 0,
                  'lines': [{'poLineId': sys.argv[2], 'qty': 2, 'unitPricePaisa': 620000}]}))
" "$po_id" "$line_catalog" "$MARK")"
    step "${p}-10-INVOICE-BOOK" 200 "book a vendor invoice against the PO"
    inv_id="$(jget "$LAST_BODY" "['data']['id']")"
    local match; match="$(jget "$LAST_BODY" "['data']['status']")"
    note "${p}-MATCH" "three-way match result on the response = '${match:-<absent>}'"
    if [[ -n "$inv_id" ]]; then
      echo "      db: vendor_invoices.status = $(purchasing_sql "$TENANT_ID" \
        "select status from vendor_invoices where id='${inv_id}'")"
      echo "      db: vendor_invoices.matched_at = $(purchasing_sql "$TENANT_ID" \
        "select coalesce(matched_at::text,'<null>') from vendor_invoices where id='${inv_id}'")"
    fi
  fi

  # 6 — AP payment
  if [[ -n "$inv_id" ]]; then
    api "$tok" GET "/api/v1/purchasing/bank-accounts"
    step "${p}-11-BANK-LIST" 200 "list bank accounts for payment"
    local bank; bank="$(jget "$LAST_BODY" "['data'][0]['code']")"
    api "$tok" POST "/api/v1/purchasing/payments" "$(python3 -c "
import json, sys, datetime
print(json.dumps({'invoiceId': sys.argv[1], 'paymentDate': datetime.date.today().isoformat(),
                  'amountPaisa': 1240000, 'bankAccountCode': sys.argv[2] or '1000'}))
" "$inv_id" "${bank:-}")"
    step "${p}-12-AP-PAYMENT" 200 "post an AP payment"
    echo "      db: ap_payment_allocations for this invoice = $(purchasing_sql "$TENANT_ID" \
      "select count(*) from ap_payment_allocations where invoice_id='${inv_id}'")"
  fi

  DRIVE_PO_ID="$po_id"; DRIVE_VENDOR_ID="$vendor_id"
}

drive_chain MANAGER "$MGR_TOKEN" M
MGR_PO_ID="${DRIVE_PO_ID:-}"; MGR_VENDOR_ID="${DRIVE_VENDOR_ID:-}"
drive_chain OWNER "$OWN_TOKEN" O
OWN_VENDOR_ID="${DRIVE_VENDOR_ID:-}"

# ══════════════════════════════════════════════════════════════════════════════════════════════
#  DELIBERATE PROBES — each is a finding whichever way it lands.
# ══════════════════════════════════════════════════════════════════════════════════════════════
echo
echo "=========================================================================="
echo "### DELIBERATE PROBES"
echo "=========================================================================="

PROBE_TOKEN="${OWN_TOKEN:-$MGR_TOKEN}"
PROBE_VENDOR="${OWN_VENDOR_ID:-$MGR_VENDOR_ID}"

# PROBE 1 — a PO line naming an ingredient id inventory has never seen.
GHOST_ING="$(uuidgen | tr 'A-Z' 'a-z')"
echo
echo "-- PROBE 1: PO line for ingredient ${GHOST_ING} which inventory has never seen"
if [[ -n "$PROBE_VENDOR" ]]; then
  api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'probe-ghost-ingredient',
                  'lines': [{'ingredientId': sys.argv[3], 'qty': 5, 'uom': 'KG', 'unitPricePaisa': 100000}]}))
" "$PROBE_VENDOR" "$BRANCH_ID" "$GHOST_ING")"
  note P1-CREATE "POST purchase-orders with an unknown ingredient -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  GHOST_PO="$(jget "$LAST_BODY" "['data']['id']")"
  if [[ -n "$GHOST_PO" ]]; then
    note P1-CREATE "ACCEPTED. purchase order ${GHOST_PO} exists for an ingredient that does not."
    api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders/${GHOST_PO}/submit" '{}'
    note P1-SUBMIT "submit -> HTTP ${LAST_STATUS}"
    api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders/${GHOST_PO}/approve" '{}'
    note P1-APPROVE "approve -> HTTP ${LAST_STATUS}"
    api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders/${GHOST_PO}/send" '{}'
    note P1-SEND "send -> HTTP ${LAST_STATUS}"
    GHOST_LINE="$(purchasing_sql "$TENANT_ID" "select id from purchase_order_lines where purchase_order_id='${GHOST_PO}' limit 1")"
    DLQ_PRE="$(dlq_depth inventory.grn-received.queue)"
    api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders/${GHOST_PO}/mock-receive" \
      "{\"lines\":[{\"poLineId\":\"${GHOST_LINE}\",\"receivedQty\":5}]}"
    note P1-RECEIVE "receive -> HTTP ${LAST_STATUS}"
    # The consumer retries at 2s/4s/8s before it dead-letters. Anything less than ~20s here reads
    # as "it did not even dead-letter", which is a different and much worse finding than the truth.
    sleep 25
    note P1-AFTER "po status = $(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${GHOST_PO}'")"
    note P1-AFTER "stock rows for the ghost ingredient = $(inventory_sql "$TENANT_ID" \
      "select count(*) from ingredient_branch_stock where ingredient_id='${GHOST_ING}'")"
    note P1-AFTER "inventory movements for it = $(inventory_sql "$TENANT_ID" \
      "select count(*) from inventory_movements where ingredient_id='${GHOST_ING}'")"
    note P1-AFTER "grn dlq depth ${DLQ_PRE} -> $(dlq_depth inventory.grn-received.queue)"
  else
    note P1-CREATE "REFUSED at creation. body: $(printf '%s' "$LAST_BODY" | head -c 300)"
  fi
else
  note P1 "skipped — no vendor was created, so the probe has nothing to hang off"
fi

# PROBE 2 — a hand-typed line whose unit the tenant's registry does not define.
echo
echo "-- PROBE 2: hand-typed line with a unit the registry does not define ('FURLONG')"
if [[ -n "$PROBE_VENDOR" && -n "$ING_KG" ]]; then
  api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'probe-unknown-uom',
                  'lines': [{'ingredientId': sys.argv[3], 'qty': 7, 'uom': 'FURLONG', 'unitPricePaisa': 100000}]}))
" "$PROBE_VENDOR" "$BRANCH_ID" "$ING_KG")"
  note P2-CREATE "POST purchase-orders with uom 'FURLONG' -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  UOM_PO="$(jget "$LAST_BODY" "['data']['id']")"
  if [[ -n "$UOM_PO" ]]; then
    note P2-CREATE "ACCEPTED. Nothing in the tenant's unit registry defines FURLONG."
    for act in submit approve send; do
      api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders/${UOM_PO}/${act}" '{}'
      note "P2-${act}" "-> HTTP ${LAST_STATUS}"
    done
    UOM_LINE="$(purchasing_sql "$TENANT_ID" "select id from purchase_order_lines where purchase_order_id='${UOM_PO}' limit 1")"
    OH_PRE="$(inventory_sql "$TENANT_ID" "select coalesce(qty_on_hand,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
    api "$PROBE_TOKEN" POST "/api/v1/purchasing/purchase-orders/${UOM_PO}/mock-receive" \
      "{\"lines\":[{\"poLineId\":\"${UOM_LINE}\",\"receivedQty\":7}]}"
    note P2-RECEIVE "receive -> HTTP ${LAST_STATUS}"
    sleep 25
    OH_POST="$(inventory_sql "$TENANT_ID" "select coalesce(qty_on_hand,0) from ingredient_branch_stock where ingredient_id='${ING_KG}' and branch_id='${BRANCH_ID}'")"
    note P2-AFTER "qty_on_hand ${OH_PRE} -> ${OH_POST}. 7 FURLONG is not a quantity of anything;"
    note P2-AFTER "a +7 delta means it was received at face value into a KG-stocked ingredient."
    note P2-AFTER "grn dlq depth = $(dlq_depth inventory.grn-received.queue)"
  else
    note P2-CREATE "REFUSED at creation. body: $(printf '%s' "$LAST_BODY" | head -c 300)"
  fi
fi

# PROBE 3 is the conversion probe, driven inline in the chain above (M-CONV / O-CONV).
echo
echo "-- PROBE 3: the finer-unit-into-coarser-unit conversion is driven inline (see *-CONV notes)"

# PROBE 4 — cross-tenant read THROUGH THE API, by id.
#
# The RLS canary above proves the DATABASE policy holds for a psql connection. It does not prove the
# APPLICATION is scoped, and those are different questions: the phase-26 agent found Hibernate's
# `tenantFilter` sits on the TenantAuditableEntity mapped superclass and does not propagate to
# BranchEntity, so a cross-tenant fetch returned 200 with no tenant predicate anywhere in the SQL.
# A findByTenantIdAndId repository method is scoped; a bare findById is not, and both compile.
# So: ask for a real object belonging to ANOTHER tenant, with this tenant's token, by id.
echo
echo "-- PROBE 4: cross-tenant read by id, through the gateway (the Hibernate-filter shape)"
# A PURCHASE ORDER belonging to a tenant that is NOT ours — chosen over a vendor because
# GET /vendors/{id} does not exist (the vendor controller exposes list/create/update only, so that
# probe answers 405 and proves nothing), whereas GET /purchase-orders/{id} is a real read path.
# Found by scanning tenant by tenant, because the SQL helper will not run unscoped — which is
# exactly the property that makes this evidence rather than assertion.
FOREIGN_PO=""; FOREIGN_TENANT=""
while IFS='|' read -r t_id t_slug; do
  [[ -z "$t_id" || "$t_id" == "$TENANT_ID" ]] && continue
  v="$(purchasing_sql "$t_id" "select id from purchase_orders limit 1")"
  if [[ -n "$v" && "$v" != *ERROR* ]]; then FOREIGN_PO="$v"; FOREIGN_TENANT="$t_slug"; break; fi
done < <(auth_sql "" "select id, slug from auth_tenants")

if [[ -n "$FOREIGN_PO" ]]; then
  note P4 "attempting tenant ${FOREIGN_TENANT}'s purchase order ${FOREIGN_PO} with a floating-terrace token"
  api "$PROBE_TOKEN" GET "/api/v1/purchasing/purchase-orders/${FOREIGN_PO}"
  note P4-PO "GET a foreign tenant's purchase order by id -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  if [[ "$LAST_STATUS" == "200" ]]; then
    note P4-PO "CROSS-TENANT READ SUCCEEDED. body: $(printf '%s' "$LAST_BODY" | head -c 240)"
  else
    note P4-PO "refused, as it must be (404 leaks less than 403)"
  fi
else
  note P4 "no foreign tenant holds a purchase order; the probe could not be run"
fi

FOREIGN_ING=""; FOREIGN_ING_TENANT=""
while IFS='|' read -r t_id t_slug; do
  [[ -z "$t_id" || "$t_id" == "$TENANT_ID" ]] && continue
  i="$(inventory_sql "$t_id" "select id from ingredients limit 1")"
  if [[ -n "$i" && "$i" != *ERROR* ]]; then FOREIGN_ING="$i"; FOREIGN_ING_TENANT="$t_slug"; break; fi
done < <(auth_sql "" "select id, slug from auth_tenants")

if [[ -n "$FOREIGN_ING" ]]; then
  note P4 "attempting tenant ${FOREIGN_ING_TENANT}'s ingredient ${FOREIGN_ING} with a floating-terrace token"
  api "$PROBE_TOKEN" GET "/api/v1/inventory/ingredients/${FOREIGN_ING}"
  note P4-INGREDIENT "GET a foreign tenant's ingredient by id -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  if [[ "$LAST_STATUS" == "200" ]]; then
    note P4-INGREDIENT "CROSS-TENANT READ SUCCEEDED. body: $(printf '%s' "$LAST_BODY" | head -c 200)"
  else
    note P4-INGREDIENT "refused, as it must be"
  fi
fi

# ── The ledger, after everything ─────────────────────────────────────────────────────────────
echo
echo "### GENERAL LEDGER (finance_db, as ${FINANCE_DB_ROLE})"
for acct in 1300 1700 2100; do
  label="inventory control"
  [[ "$acct" == 1700 ]] && label="goods received / not invoiced"
  [[ "$acct" == 2100 ]] && label="accounts payable"
  echo "  ${acct} ${label} — net DR-CR posted in the last 30 min:"
  finance_sql "$TENANT_ID" "
select coalesce(sum(jl.debit_paisa),0) - coalesce(sum(jl.credit_paisa),0)
from journal_lines jl
join journal_entries je on je.id = jl.je_id
where je.tenant_id = '${TENANT_ID}'
  and jl.account_code = '${acct}'
  and je.created_at > now() - interval '30 minutes'" 2>&1 | sed 's/^/    /'
done
echo "  journal entries posted in the last 30 min, by source:"
finance_sql "$TENANT_ID" "
select source_type, count(*), string_agg(distinct status, ',')
from journal_entries
where tenant_id = '${TENANT_ID}' and created_at > now() - interval '30 minutes'
group by source_type order by 1" 2>&1 | sed 's/^/    /'

# ══════════════════════════════════════════════════════════════════════════════════════════════
#  MASTER-DATA CRUD MATRIX — the half of the user's report that is not purchasing at all.
# ══════════════════════════════════════════════════════════════════════════════════════════════
echo
echo "=========================================================================="
echo "### MASTER-DATA CRUD MATRIX (as MANAGER)"
echo "=========================================================================="

MD_TOKEN="${MGR_TOKEN:-$OWN_TOKEN}"

# Ingredient: C R U Archive Restore
api "$MD_TOKEN" POST "/api/v1/inventory/ingredients" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Drive Ingredient ' + sys.argv[1], 'sku': 'DRV-' + sys.argv[1],
                  'baseUomCode': 'KG', 'categoryId': sys.argv[2], 'reorderPoint': 5}))
" "$MARK" "$CAT_ID")"
step MD-ING-CREATE 200 "ingredient CREATE"
NEW_ING="$(jget "$LAST_BODY" "['data']['id']")"
if [[ -n "$NEW_ING" ]]; then
  api "$MD_TOKEN" GET "/api/v1/inventory/ingredients/${NEW_ING}";  step MD-ING-GET 200 "ingredient READ"
  api "$MD_TOKEN" PUT "/api/v1/inventory/ingredients/${NEW_ING}" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Drive Ingredient ' + sys.argv[1] + ' (edited)', 'baseUomCode': 'KG',
                  'categoryId': sys.argv[2], 'reorderPoint': 9, 'active': True}))
" "$MARK" "$CAT_ID")"
  step MD-ING-UPDATE 200 "ingredient UPDATE"
  api "$MD_TOKEN" POST "/api/v1/inventory/ingredients/${NEW_ING}/archive" '{}'
  step MD-ING-ARCHIVE 200 "ingredient ARCHIVE"
  api "$MD_TOKEN" POST "/api/v1/inventory/ingredients/${NEW_ING}/restore" '{}'
  step MD-ING-RESTORE 200 "ingredient RESTORE"
fi

# Category: C R U Archive
api "$MD_TOKEN" POST "/api/v1/inventory/categories" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Drive Category ' + sys.argv[1], 'code': 'DRVC' + sys.argv[1][-6:]}))
" "$MARK")"
step MD-CAT-CREATE 200 "category CREATE"
NEW_CAT="$(jget "$LAST_BODY" "['data']['id']")"
if [[ -n "$NEW_CAT" ]]; then
  api "$MD_TOKEN" PUT "/api/v1/inventory/categories/${NEW_CAT}" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Drive Category ' + sys.argv[1] + ' (edited)'}))
" "$MARK")"
  step MD-CAT-UPDATE 200 "category UPDATE"
  api "$MD_TOKEN" POST "/api/v1/inventory/categories/${NEW_CAT}/archive" '{}'
  step MD-CAT-ARCHIVE 200 "category ARCHIVE"
fi

# Unit of measure: C, then UPDATE and ARCHIVE — which is where D-36-06 expects a hole.
UOM_CODE="DRV$(date +%S)$((RANDOM % 90 + 10))"
api "$MD_TOKEN" POST "/api/v1/inventory/uom" "$(python3 -c "
import json, sys
print(json.dumps({'code': sys.argv[1], 'name': 'Drive Unit ' + sys.argv[1],
                  'measureType': 'WEIGHT', 'baseUnitCode': 'G', 'toBaseFactor': 250}))
" "$UOM_CODE")"
step MD-UOM-CREATE 200 "unit of measure CREATE"
NEW_UOM="$(jget "$LAST_BODY" "['data']['id']")"
if [[ -n "$NEW_UOM" ]]; then
  api "$MD_TOKEN" PUT "/api/v1/inventory/uom/${NEW_UOM}" \
    '{"code":"'"$UOM_CODE"'","name":"Drive Unit edited","measureType":"WEIGHT","baseUnitCode":"G","toBaseFactor":250}'
  note MD-UOM-UPDATE "PUT /api/v1/inventory/uom/{id} -> HTTP ${LAST_STATUS} (404/405 = the endpoint does not exist)"
  api "$MD_TOKEN" POST "/api/v1/inventory/uom/${NEW_UOM}/archive" '{}'
  note MD-UOM-ARCHIVE "POST /api/v1/inventory/uom/{id}/archive -> HTTP ${LAST_STATUS}"
  api "$MD_TOKEN" DELETE "/api/v1/inventory/uom/${NEW_UOM}"
  note MD-UOM-DELETE "DELETE /api/v1/inventory/uom/{id} -> HTTP ${LAST_STATUS}"
fi

# Storage location: C R U Archive
api "$MD_TOKEN" POST "/api/v1/inventory/storage-locations" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Drive Store ' + sys.argv[1], 'sortOrder': 99}))
" "$MARK")"
step MD-LOC-CREATE 200 "storage location CREATE"
NEW_LOC="$(jget "$LAST_BODY" "['data']['id']")"
if [[ -n "$NEW_LOC" ]]; then
  api "$MD_TOKEN" PUT "/api/v1/inventory/storage-locations/${NEW_LOC}" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'Drive Store ' + sys.argv[1] + ' (edited)', 'sortOrder': 98}))
" "$MARK")"
  step MD-LOC-UPDATE 200 "storage location UPDATE"
  api "$MD_TOKEN" POST "/api/v1/inventory/storage-locations/${NEW_LOC}/archive" '{}'
  step MD-LOC-ARCHIVE 200 "storage location ARCHIVE"
fi

# Opening balance, manual receipt, stock count — the "adding stocks" half of the user's report.
if [[ -n "${NEW_ING:-}" ]]; then
  api "$MD_TOKEN" POST "/api/v1/inventory/opening-balance" "$(python3 -c "
import json, sys
print(json.dumps({'ingredientId': sys.argv[1], 'branchId': sys.argv[2],
                  'qty': 10, 'unitCostPaisa': 5000}))
" "$NEW_ING" "$BRANCH_ID")"
  step MD-OPENING 200 "record an opening balance"

  api "$MD_TOKEN" POST "/api/v1/inventory/receipts" "$(python3 -c "
import json, sys
print(json.dumps({'ingredientId': sys.argv[1], 'branchId': sys.argv[2],
                  'qty': 4, 'unitCostPaisa': 5200}))
" "$NEW_ING" "$BRANCH_ID")"
  step MD-RECEIPT 200 "receive stock manually"

  api "$MD_TOKEN" POST "/api/v1/inventory/counts" "$(python3 -c "
import json, sys
print(json.dumps({'branchId': sys.argv[2], 'lines': [{'ingredientId': sys.argv[1], 'countedQty': 13}]}))
" "$NEW_ING" "$BRANCH_ID")"
  step MD-COUNT 200 "post a stock count"

  echo "      db: on hand for the drive ingredient = $(inventory_sql "$TENANT_ID" \
    "select coalesce(qty_on_hand,0) from ingredient_branch_stock where ingredient_id='${NEW_ING}' and branch_id='${BRANCH_ID}'")"
fi

api "$MD_TOKEN" GET "/api/v1/inventory/stock?branchId=${BRANCH_ID}"
step MD-STOCK-READ 200 "read stock levels"

# ── Broker after ─────────────────────────────────────────────────────────────────────────────
echo
echo "### BROKER AFTER"
echo "  inventory.grn-received.queue     = $(queue_depth inventory.grn-received.queue) (was ${GRN_Q_BEFORE})"
echo "  inventory.grn-received.queue.dlq = $(dlq_depth inventory.grn-received.queue) (was ${GRN_DLQ_BEFORE})"
echo "  finance.stock-received.queue.dlq = $(dlq_depth finance.stock-received.queue) (was ${FIN_DLQ_BEFORE})"
echo "  finance.invoice-matched.queue    = $(queue_depth finance.invoice-matched.queue) (was ${INV_MATCH_BEFORE})"
echo
echo "### QUEUE CONSUMERS — a queue that is bound, filling, and has NO consumer is a silent break."
echo "    (name / ready / unacked / consumers)"
docker exec "$PHASE31_PG_CONTAINER" true 2>/dev/null   # keep docker warm; harmless
docker exec restaurantos-rabbitmq rabbitmqctl list_queues name messages messages_unacknowledged consumers 2>/dev/null \
  | grep -E 'grn|invoice-matched|stock-received' | sed 's/^/    /'

# ── Tally ────────────────────────────────────────────────────────────────────────────────────
echo
echo "=========================================================================="
phase13_summary || true
echo "finished: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=========================================================================="

# Exit zero unless explicitly gating: this script is a DIAGNOSTIC first and an acceptance gate
# second, and a diagnostic that stops at the first failure hides the nine defects behind it.
if [[ "${PHASE31_GATE:-0}" == "1" ]]; then
  [[ "$PHASE13_FAIL" -eq 0 ]] || exit 1
fi
exit 0
