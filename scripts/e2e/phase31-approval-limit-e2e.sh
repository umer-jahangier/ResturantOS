#!/usr/bin/env bash
# Phase 36-03 — the approval limit actually gates approval, driven live.
#
# Definition-of-done item 2. The case this builds could not previously be reached from inside the
# product at all: `approval_limit_paisa` was NULL on every row and settable only by a script.
#
# Four things are proven, in order, against the running stack through the gateway:
#
#   1. A persona holding vendor.po.approve with NO limit is REFUSED, and nothing is written.
#   2. An owner sets a limit above the order total through the product's own endpoint; after the
#      persona signs in again, the same approval SUCCEEDS and the order advances.
#   3. A limit BELOW the next order's total is refused, and the refusal names the limit rather than
#      being a generic permission failure.
#   4. A token minted before a limit change still carries the OLD limit — which is exactly what the
#      assign dialog promises in words, so the promise is verified rather than asserted.
#
# Usage: bash scripts/e2e/phase31-approval-limit-e2e.sh

set -uo pipefail
set +B   # brace expansion silently empties python-built JSON bodies — see the procure-to-pay drive

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=scripts/e2e/_phase31-lib.sh
. "${REPO_ROOT}/scripts/e2e/_phase31-lib.sh"

TENANT_SLUG="floating-terrace"
SUBJECT_EMAIL="manager@terrace.local"
SUBJECT_PASSWORD='Terrace#Manager1'

echo "=== phase 36-03 — the approval limit gates approval ==="
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
claim() { printf '%s' "${1:-}" | python3 -c "
import sys, base64, json, os
seg = sys.stdin.read().strip().split('.')[1]; seg += '=' * (-len(seg) % 4)
d = json.loads(base64.urlsafe_b64decode(seg))
k = os.environ['K']
print(d.get('attributes', {}).get('approval_limit_paisa', 'ABSENT') if k == 'limit' else d.get(k, ''))
"; }

owner_token() {
  tenant_login owner@terrace.local 'Terrace#Owner1' "$TENANT_SLUG" \
    "$(python3 scripts/generate_totp.py owner@terrace.local 2>/dev/null | grep -oE '[0-9]{6}' | head -1)" \
    2>/dev/null || true
}
subject_token() { tenant_login "$SUBJECT_EMAIL" "$SUBJECT_PASSWORD" "$TENANT_SLUG" 2>/dev/null || true; }

# set_limit <owner token> <user id> <branch> <role> <paisa|null>
#
# Through POST /api/v1/users/{id}/branch-roles — the SAME endpoint the assign dialog uses. No SQL:
# the whole point of D-36-03 is that this is a product capability.
set_limit() {
  local tok="$1" uid="$2" branch="$3" role="$4" paisa="$5"
  api "$tok" POST "/api/v1/users/${uid}/branch-roles" "$(python3 -c "
import json, sys
limit = None if sys.argv[3] == 'null' else int(sys.argv[3])
print(json.dumps({'branchId': sys.argv[1], 'roleCode': sys.argv[2], 'approvalLimitPaisa': limit}))
" "$branch" "$role" "$paisa")"
}

OWNER="$(owner_token)"
[[ -z "$OWNER" ]] && { echo "FATAL: no owner token"; exit 1; }

SUBJECT="$(subject_token)"
[[ -z "$SUBJECT" ]] && { echo "FATAL: no subject token"; exit 1; }
SUBJECT_ID="$(K=sub claim "$SUBJECT")"
BRANCH_ID="$(K=branch_id claim "$SUBJECT")"
ORIGINAL_LIMIT="$(K=limit claim "$SUBJECT")"
echo "subject   : ${SUBJECT_EMAIL} (${SUBJECT_ID})"
echo "branch    : ${BRANCH_ID}"
echo "limit now : ${ORIGINAL_LIMIT}"

VENDOR_ID="$(purchasing_sql "$TENANT_ID" "select id from vendors where active = true limit 1")"
ING_ID="$(inventory_sql "$TENANT_ID" "select id from ingredients where archived_at is null limit 1")"
[[ -z "$VENDOR_ID" || -z "$ING_ID" ]] && { echo "FATAL: no vendor or ingredient to build an order from"; exit 1; }

# A purchase order worth exactly 20,000,00 paisa (Rs 20,000) — one line, 4 KG at Rs 5,000/KG.
ORDER_TOTAL_PAISA=2000000
make_pending_po() {
  local tok="$1"
  api "$tok" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'phase36-03 approval gate',
                  'lines': [{'ingredientId': sys.argv[3], 'qty': 4, 'uom': 'KG', 'unitPricePaisa': 500000}]}))
" "$VENDOR_ID" "$BRANCH_ID" "$ING_ID")"
  local po; po="$(jget "$LAST_BODY" "['data']['id']")"
  [[ -z "$po" ]] && { echo "" ; return; }
  api "$tok" POST "/api/v1/purchasing/purchase-orders/${po}/submit" '{}' >/dev/null
  printf '%s' "$po"
}

# assert_untouched <po id> <label> — a denied approval must record nothing.
assert_untouched() {
  local po="$1" label="$2"
  local status records
  status="$(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${po}'")"
  records="$(purchasing_sql "$TENANT_ID" "select count(*) from po_approval_records where purchase_order_id='${po}'")"
  assert_status "PENDING_APPROVAL" "$status" "${label}: the order is still PENDING_APPROVAL"
  assert_status "0" "$records" "${label}: no approval record was written"
}

# ── Case 1 — no limit at all is refused ──────────────────────────────────────────────────────
echo
echo "--- CASE 1: the subject holds vendor.po.approve with NO approval limit ---"
set_limit "$OWNER" "$SUBJECT_ID" "$BRANCH_ID" "MANAGER" "null"
assert_status 200 "$LAST_STATUS" "owner clears the limit through the product's own endpoint"

SUBJECT="$(subject_token)"
NO_LIMIT_CLAIM="$(K=limit claim "$SUBJECT")"
assert_status "ABSENT" "$NO_LIMIT_CLAIM" "a fresh token carries NO approval_limit_paisa attribute"

PO1="$(make_pending_po "$SUBJECT")"
if [[ -z "$PO1" ]]; then
  echo "FAIL: could not create a pending purchase order"; PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  api "$SUBJECT" POST "/api/v1/purchasing/purchase-orders/${PO1}/approve" '{}'
  echo "      approve -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  assert_not_status 200 "$LAST_STATUS" "approval with no limit is REFUSED"
  assert_untouched "$PO1" "no limit"
fi

# ── Case 4 (set up here, asserted after the change) — the stale-token promise ────────────────
STALE_TOKEN="$SUBJECT"

# ── Case 2 — a limit above the order total allows it ─────────────────────────────────────────
echo
echo "--- CASE 2: owner sets a limit ABOVE the order total ---"
set_limit "$OWNER" "$SUBJECT_ID" "$BRANCH_ID" "MANAGER" "$((ORDER_TOTAL_PAISA * 5))"
assert_status 200 "$LAST_STATUS" "owner sets the limit to $((ORDER_TOTAL_PAISA * 5)) paisa"

# user_branch_roles is FORCE row-level security, so this read needs the tenant GUC. Without it the
# query returns zero rows and NO error, which reads as "that assignment does not exist" — the most
# misleading possible answer to "did the write land?".
echo "      db: user_branch_roles.approval_limit_paisa = $(auth_sql "$TENANT_ID" \
  "select coalesce(approval_limit_paisa::text,'<null>') from user_branch_roles where user_id='${SUBJECT_ID}' and branch_id='${BRANCH_ID}' and is_active = true")"

# The stale-token promise, verified before a fresh sign-in replaces it.
STALE_CLAIM="$(K=limit claim "$STALE_TOKEN")"
assert_status "ABSENT" "$STALE_CLAIM" \
  "the token minted BEFORE the change still carries the old limit — the screen says so, and it is true"

SUBJECT="$(subject_token)"
FRESH_CLAIM="$(K=limit claim "$SUBJECT")"
assert_status "$((ORDER_TOTAL_PAISA * 5))" "$FRESH_CLAIM" "a fresh token carries the new limit"

if [[ -n "${PO1:-}" ]]; then
  api "$SUBJECT" POST "/api/v1/purchasing/purchase-orders/${PO1}/approve" '{}'
  echo "      approve -> HTTP ${LAST_STATUS} $(err_code "$LAST_BODY")"
  assert_status 200 "$LAST_STATUS" "the SAME order now approves, with a sufficient limit"
  assert_status "APPROVED" \
    "$(purchasing_sql "$TENANT_ID" "select status from purchase_orders where id='${PO1}'")" \
    "the order advanced to APPROVED"
  assert_status "1" \
    "$(purchasing_sql "$TENANT_ID" "select count(*) from po_approval_records where purchase_order_id='${PO1}'")" \
    "exactly one approval record was written"
fi

# ── Case 3 — a limit below the order total is refused, and says why ──────────────────────────
echo
echo "--- CASE 3: owner sets a limit BELOW the next order's total ---"
set_limit "$OWNER" "$SUBJECT_ID" "$BRANCH_ID" "MANAGER" "$((ORDER_TOTAL_PAISA / 4))"
assert_status 200 "$LAST_STATUS" "owner sets the limit to $((ORDER_TOTAL_PAISA / 4)) paisa"

SUBJECT="$(subject_token)"
assert_status "$((ORDER_TOTAL_PAISA / 4))" "$(K=limit claim "$SUBJECT")" \
  "a fresh token carries the reduced limit"

PO2="$(make_pending_po "$SUBJECT")"
if [[ -z "$PO2" ]]; then
  echo "FAIL: could not create the second pending purchase order"; PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  api "$SUBJECT" POST "/api/v1/purchasing/purchase-orders/${PO2}/approve" '{}'
  REFUSAL_CODE="$(err_code "$LAST_BODY")"
  echo "      approve -> HTTP ${LAST_STATUS} ${REFUSAL_CODE}"
  echo "      body: $(printf '%s' "$LAST_BODY" | head -c 300)"
  assert_not_status 200 "$LAST_STATUS" "approval above the limit is REFUSED"
  # The refusal must name the limit rather than read as a generic permission failure — otherwise a
  # manager cannot tell "you may not approve" from "you may not approve THIS MUCH", and the remedy
  # for those two is completely different.
  assert_contains "$REFUSAL_CODE" "APPROVAL_LIMIT" \
    "the refusal names the LIMIT, not a generic permission failure"
  assert_untouched "$PO2" "insufficient limit"
fi

# ── Restore the seed's documented limit ──────────────────────────────────────────────────────
#
# This runs against a shared stack. The seed documents MANAGER at 30,000,000 paisa; leaving the
# reduced limit behind would break the next person's run and look like a regression.
echo
echo "--- restoring the seed's documented MANAGER limit (30000000 paisa) ---"
set_limit "$OWNER" "$SUBJECT_ID" "$BRANCH_ID" "MANAGER" "30000000"
assert_status 200 "$LAST_STATUS" "the seed's documented limit is restored"

echo
phase13_summary
