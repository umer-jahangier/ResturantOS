#!/usr/bin/env bash
# Phase 36-05 — every inventory master-data entity, driven through its whole life.
#
# The user's report was "adding stocks, or ingredients, all these things are not linked properly or
# not working". The 36-01 drive measured which half of that was true: ingredients, categories and
# storage locations were complete, and a UNIT OF MEASURE could be created and never changed or
# retired — PUT and archive both answered 404 (F-31-04). Floating Terrace's registry still contains
# a unit coded TETS, named "TEST", factor 5 g, because there has never been a way to remove it.
#
# Usage: bash scripts/e2e/phase31-master-data-e2e.sh

set -uo pipefail
set +B

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=scripts/e2e/_phase31-lib.sh
. "${REPO_ROOT}/scripts/e2e/_phase31-lib.sh"

TENANT_SLUG="floating-terrace"

echo "=== phase 36-05 — inventory master data, end to end ==="
phase31_freshness_gate || { echo "ABANDONED: stale jars — an endpoint that is not loaded yet 404s exactly like one that does not exist"; exit 1; }
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
jget() { printf '%s' "${1:-}" | json_get "${2}" 2>/dev/null || true; }
err_code() { printf '%s' "${1:-}" | python3 -c "
import sys, json
try: print(json.load(sys.stdin).get('error', {}).get('code',''))
except Exception: print('')
"; }

TOKEN="$(tenant_login manager@terrace.local 'Terrace#Manager1' "$TENANT_SLUG" 2>/dev/null || true)"
[[ -z "$TOKEN" ]] && { echo "FATAL: no MANAGER token"; exit 1; }
BRANCH_ID="$(printf '%s' "$TOKEN" | python3 -c "
import sys, base64, json
seg = sys.stdin.read().strip().split('.')[1]; seg += '=' * (-len(seg) % 4)
print(json.loads(base64.urlsafe_b64decode(seg)).get('branch_id',''))
")"
MARK="$(date +%s)$((RANDOM % 90 + 10))"

# ══════════════════════════════════════════════════════════════════════════════════════════════
# UNIT OF MEASURE — the entity F-31-04 found create-only
# ══════════════════════════════════════════════════════════════════════════════════════════════
echo
echo "--- unit of measure: create, read, change, retire, restore ---"
UOM_CODE="DRV${MARK: -5}"
api "$TOKEN" POST "/api/v1/inventory/uom" "$(python3 -c "
import json, sys
print(json.dumps({'code': sys.argv[1], 'name': 'Drive Unit', 'measureType': 'WEIGHT',
                  'baseUnitCode': 'G', 'toBaseFactor': 250}))
" "$UOM_CODE")"
assert_status 200 "$LAST_STATUS" "unit CREATE"
UOM_ID="$(jget "$LAST_BODY" "['data']['id']")"

api "$TOKEN" PUT "/api/v1/inventory/uom/${UOM_ID}" \
  '{"name":"Drive Unit (corrected)","measureType":"WEIGHT","baseUnitCode":"G","toBaseFactor":500}'
echo "      -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
assert_status 200 "$LAST_STATUS" "unit UPDATE — this answered 404 before 36-05"
assert_contains "$LAST_BODY" "corrected" "the new name is returned"

api "$TOKEN" GET "/api/v1/inventory/uom"
assert_status 200 "$LAST_STATUS" "unit list READ"
assert_contains "$LAST_BODY" "Drive Unit (corrected)" "the change is visible in the next list"

# The code is a foreign key by value across two databases: it must not be changeable, and the
# request shape must not even offer it.
api "$TOKEN" PUT "/api/v1/inventory/uom/${UOM_ID}" \
  '{"code":"RENAMED","name":"Drive Unit (corrected)","measureType":"WEIGHT","baseUnitCode":"G","toBaseFactor":500}'
CODE_AFTER="$(inventory_sql "$TENANT_ID" "select code from units_of_measure where id='${UOM_ID}'")"
assert_status "$UOM_CODE" "$CODE_AFTER" "a 'code' in the body is IGNORED — the code is unchangeable"

# The family-base invariant the create path enforces must hold on update too.
api "$TOKEN" PUT "/api/v1/inventory/uom/${UOM_ID}" \
  '{"name":"Drive Unit","measureType":"WEIGHT","toBaseFactor":500}'
echo "      -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
assert_status 422 "$LAST_STATUS" "a base unit with a factor other than 1 is refused on UPDATE too"

api "$TOKEN" POST "/api/v1/inventory/uom/${UOM_ID}/archive" '{}'
echo "      -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
assert_status 200 "$LAST_STATUS" "unit ARCHIVE — this answered 404 before 36-05"
assert_status "1" "$(inventory_sql "$TENANT_ID" "select count(*) from units_of_measure where id='${UOM_ID}' and archived_at is not null")" \
  "db: archived_at is set — the row is RETIRED, never deleted"

api "$TOKEN" GET "/api/v1/inventory/uom"
assert_status 200 "$LAST_STATUS" "the picker list still reads"
if printf '%s' "$LAST_BODY" | grep -q "$UOM_CODE"; then
  echo "FAIL: a retired unit is still offered by the picker"; PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: a retired unit is gone from the picker"; PHASE13_PASS=$((PHASE13_PASS + 1))
fi

api "$TOKEN" GET "/api/v1/inventory/uom?includeRetired=true"
assert_contains "$LAST_BODY" "$UOM_CODE" "the setup screen can still SEE it, shown as retired"

# Idempotent.
api "$TOKEN" POST "/api/v1/inventory/uom/${UOM_ID}/archive" '{}'
assert_status 200 "$LAST_STATUS" "retiring an already-retired unit succeeds and changes nothing"

api "$TOKEN" POST "/api/v1/inventory/uom/${UOM_ID}/restore" '{}'
assert_status 200 "$LAST_STATUS" "unit RESTORE"
api "$TOKEN" GET "/api/v1/inventory/uom"
assert_contains "$LAST_BODY" "$UOM_CODE" "a restored unit is offered by the picker again"

# ── The retire guard ─────────────────────────────────────────────────────────────────────────
echo
echo "--- a unit still in use cannot be retired, and the refusal says by what ---"
api "$TOKEN" GET "/api/v1/inventory/ingredients?status=ACTIVE"
IN_USE_UOM="$(printf '%s' "$LAST_BODY" | python3 -c "
import sys, json
try: print(next(i['baseUomCode'] for i in json.load(sys.stdin)['data']))
except Exception: print('')
")"
api "$TOKEN" GET "/api/v1/inventory/uom"
IN_USE_ID="$(printf '%s' "$LAST_BODY" | python3 -c "
import sys, json, os
code = os.environ['C']
try: print(next(u['id'] for u in json.load(sys.stdin)['data'] if u['code'] == code))
except Exception: print('')
" 2>/dev/null || true)"
IN_USE_ID="$(C="$IN_USE_UOM" bash -c "printf '%s' '$LAST_BODY' | python3 -c \"
import sys, json, os
code = os.environ['C']
try: print(next(u['id'] for u in json.load(sys.stdin)['data'] if u['code'] == code))
except Exception: print('')
\"")"
if [[ -n "$IN_USE_ID" ]]; then
  api "$TOKEN" POST "/api/v1/inventory/uom/${IN_USE_ID}/archive" '{}'
  echo "      retire '${IN_USE_UOM}' -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  echo "      body: $(printf '%s' "$LAST_BODY" | head -c 300)"
  assert_status 422 "$LAST_STATUS" "a unit ingredients are stocked in cannot be retired"
  assert_contains "$LAST_BODY" "ingredient" "the refusal names WHAT still uses it"
else
  echo "NOTE: could not resolve an in-use unit id; guard not driven"
fi

# ══════════════════════════════════════════════════════════════════════════════════════════════
# INGREDIENT — including the reorder point and par level the reorder path depends on
# ══════════════════════════════════════════════════════════════════════════════════════════════
echo
echo "--- ingredient: create, read, change, archive, restore, with reorder point and par level ---"
api "$TOKEN" GET "/api/v1/inventory/categories"
CAT_ID="$(jget "$LAST_BODY" "['data'][0]['id']")"
api "$TOKEN" POST "/api/v1/inventory/ingredients" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'MD Drive Ingredient ' + sys.argv[1], 'sku': 'MDD-' + sys.argv[1],
                  'baseUomCode': 'KG', 'categoryId': sys.argv[2],
                  'reorderPoint': 7, 'parLevel': 25}))
" "$MARK" "$CAT_ID")"
assert_status 200 "$LAST_STATUS" "ingredient CREATE with a reorder point and a par level"
ING_ID="$(jget "$LAST_BODY" "['data']['id']")"

api "$TOKEN" GET "/api/v1/inventory/ingredients/${ING_ID}"
assert_status 200 "$LAST_STATUS" "ingredient READ"
assert_contains "$LAST_BODY" '"reorderPoint":7' "the reorder point was STORED, not just accepted"
assert_contains "$LAST_BODY" '"parLevel":25' "the par level was stored"

api "$TOKEN" PUT "/api/v1/inventory/ingredients/${ING_ID}" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'MD Drive Ingredient ' + sys.argv[1] + ' (edited)', 'baseUomCode': 'KG',
                  'categoryId': sys.argv[2], 'reorderPoint': 12, 'parLevel': 40, 'active': True}))
" "$MARK" "$CAT_ID")"
assert_status 200 "$LAST_STATUS" "ingredient UPDATE"
assert_status "12.0000" "$(inventory_sql "$TENANT_ID" "select reorder_point from ingredients where id='${ING_ID}'")" \
  "db: the changed reorder point is what reorder suggestions will read"

api "$TOKEN" POST "/api/v1/inventory/ingredients/${ING_ID}/archive" '{}'
assert_status 200 "$LAST_STATUS" "ingredient ARCHIVE"
api "$TOKEN" POST "/api/v1/inventory/ingredients/${ING_ID}/restore" '{}'
assert_status 200 "$LAST_STATUS" "ingredient RESTORE"

# ══════════════════════════════════════════════════════════════════════════════════════════════
# CATEGORY / STORAGE LOCATION
# ══════════════════════════════════════════════════════════════════════════════════════════════
echo
echo "--- item category and storage location ---"
api "$TOKEN" POST "/api/v1/inventory/categories" "$(python3 -c "
import json, sys
print(json.dumps({'name': 'MD Drive Category ' + sys.argv[1], 'code': 'MDC' + sys.argv[1][-5:]}))
" "$MARK")"
assert_status 200 "$LAST_STATUS" "category CREATE"
NEW_CAT="$(jget "$LAST_BODY" "['data']['id']")"
api "$TOKEN" PUT "/api/v1/inventory/categories/${NEW_CAT}" \
  "{\"name\":\"MD Drive Category ${MARK} (edited)\"}"
assert_status 200 "$LAST_STATUS" "category UPDATE"
api "$TOKEN" POST "/api/v1/inventory/categories/${NEW_CAT}/archive" '{}'
assert_status 200 "$LAST_STATUS" "category ARCHIVE"

api "$TOKEN" POST "/api/v1/inventory/storage-locations" \
  "{\"name\":\"MD Drive Store ${MARK}\",\"sortOrder\":97}"
assert_status 200 "$LAST_STATUS" "storage location CREATE"
NEW_LOC="$(jget "$LAST_BODY" "['data']['id']")"
api "$TOKEN" PUT "/api/v1/inventory/storage-locations/${NEW_LOC}" \
  "{\"name\":\"MD Drive Store ${MARK} (edited)\",\"sortOrder\":96}"
assert_status 200 "$LAST_STATUS" "storage location UPDATE"
api "$TOKEN" POST "/api/v1/inventory/storage-locations/${NEW_LOC}/archive" '{}'
assert_status 200 "$LAST_STATUS" "storage location ARCHIVE"

# ══════════════════════════════════════════════════════════════════════════════════════════════
# OPENING STOCK — a different economic event from a goods receipt, asserted at the movement row
# ══════════════════════════════════════════════════════════════════════════════════════════════
echo
echo "--- opening stock ---"
api "$TOKEN" POST "/api/v1/inventory/opening-balance" "$(python3 -c "
import json, sys
print(json.dumps({'ingredientId': sys.argv[1], 'branchId': sys.argv[2], 'qty': 15, 'unitCostPaisa': 4200}))
" "$ING_ID" "$BRANCH_ID")"
assert_status 200 "$LAST_STATUS" "opening balance RECORD"
assert_status "15.0000" "$(inventory_sql "$TENANT_ID" \
  "select qty_on_hand from ingredient_branch_stock where ingredient_id='${ING_ID}' and branch_id='${BRANCH_ID}'")" \
  "db: on-hand is exactly the opening quantity"
assert_status "1" "$(inventory_sql "$TENANT_ID" \
  "select count(*) from inventory_movements where ingredient_id='${ING_ID}' and movement_type='OPENING_BALANCE'")" \
  "db: exactly one OPENING_BALANCE movement — a different event from a RECEIPT"

api "$TOKEN" GET "/api/v1/inventory/stock?branchId=${BRANCH_ID}"
assert_status 200 "$LAST_STATUS" "stock levels READ"

echo
phase13_summary
