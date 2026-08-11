#!/usr/bin/env bash
# Phase 36-02 — purchasing is reachable by the role that owns procurement, refused for the roles the
# design excludes, and the two kinds of refusal are distinguishable by a caller.
#
# The 36-01 drive established that the reported MANAGER 403 no longer reproduces. This script is
# what keeps that true: it is cheap, it runs against the live stack through the gateway, and it
# fails loudly if a grant regresses or a role quietly acquires purchasing.
#
# Usage: bash scripts/e2e/phase31-purchasing-access-e2e.sh

set -uo pipefail
set +B   # see phase31-procure-to-pay-e2e.sh: brace expansion silently empties JSON bodies

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

# shellcheck source=scripts/e2e/_phase31-lib.sh
. "${REPO_ROOT}/scripts/e2e/_phase31-lib.sh"

TENANT_SLUG="floating-terrace"

echo "=== phase 36-02 — purchasing access ==="
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

# ── The role that owns procurement reaches purchasing ────────────────────────────────────────
echo
echo "--- MANAGER (the role that owns procurement) ---"
MGR="$(tenant_login manager@terrace.local 'Terrace#Manager1' "$TENANT_SLUG" 2>/dev/null || true)"
if [[ -z "$MGR" ]]; then
  echo "FAIL: MANAGER could not authenticate"; PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: MANAGER authenticated"; PHASE13_PASS=$((PHASE13_PASS + 1))

  api "$MGR" GET "/api/v1/purchasing/vendors"
  assert_status 200 "$LAST_STATUS" "MANAGER can list vendors"

  BRANCH_ID="$(printf '%s' "$MGR" | python3 -c "
import sys, base64, json
seg = sys.stdin.read().strip().split('.')[1]; seg += '=' * (-len(seg) % 4)
print(json.loads(base64.urlsafe_b64decode(seg)).get('branch_id', ''))
")"

  # branchId is a REQUIRED query parameter on this endpoint; omitting it is a 400, not a 403, and
  # scoring that as an access failure would have blamed the permission model for a missing argument.
  api "$MGR" GET "/api/v1/purchasing/purchase-orders?branchId=${BRANCH_ID}"
  assert_status 200 "$LAST_STATUS" "MANAGER can list purchase orders"

  # Creation, not just reading — a read-only pass would have missed the original report entirely.
  VENDOR_ID="$(purchasing_sql "$TENANT_ID" "select id from vendors where active = true limit 1")"
  ING_ID="$(inventory_sql "$TENANT_ID" "select id from ingredients where archived_at is null limit 1")"
  if [[ -n "$VENDOR_ID" && -n "$BRANCH_ID" && -n "$ING_ID" ]]; then
    api "$MGR" POST "/api/v1/purchasing/purchase-orders" "$(python3 -c "
import json, sys
print(json.dumps({'vendorId': sys.argv[1], 'branchId': sys.argv[2], 'notes': 'phase36-02 access probe',
                  'lines': [{'ingredientId': sys.argv[3], 'qty': 1, 'uom': 'KG', 'unitPricePaisa': 100000}]}))
" "$VENDOR_ID" "$BRANCH_ID" "$ING_ID")"
    assert_status 200 "$LAST_STATUS" "MANAGER can create a purchase order"
  else
    echo "FAIL: could not assemble a purchase-order body (vendor/branch/ingredient missing)"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi
fi

# ── A role the design excludes stays excluded ────────────────────────────────────────────────
#
# 031's own comment records that CASHIER holds nothing in the vendor module on purpose. Asserted as
# a negative case rather than assumed: an exclusion nobody checks erodes one convenient grant at a
# time, which is exactly what 13-02 split rbac.manage to prevent.
echo
echo "--- CASHIER (deliberately excluded) ---"
CASHIER="$(tenant_login cashier@terrace.local 'Terrace#Cashier1' "$TENANT_SLUG" 2>/dev/null || true)"
PERMISSION_CODE=""
if [[ -z "$CASHIER" ]]; then
  echo "FAIL: CASHIER could not authenticate"; PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  api "$CASHIER" GET "/api/v1/purchasing/vendors"
  assert_status 403 "$LAST_STATUS" "CASHIER is refused vendor listing"
  PERMISSION_CODE="$(err_code "$LAST_BODY")"
  assert_contains "$PERMISSION_CODE" "PERMISSION_DENIED" \
    "the refusal carries PERMISSION_DENIED, not a feature code"
fi

# ── A tenant without the module produces a DIFFERENT code ────────────────────────────────────
#
# Driven against the tenant that legitimately has a module switched off, never by switching a
# feature off on a shared stack — that would be a destructive write against other people's work.
echo
echo "--- a tenant that legitimately has a module disabled ---"
CB_SLUG="control-bistro-isolation-test-tenant"
CB_TOKEN="$(tenant_login owner@control.local 'Control#Owner1' "$CB_SLUG" \
  "$(python3 scripts/generate_totp.py owner@control.local 2>/dev/null | grep -oE '[0-9]{6}' | head -1)" \
  2>/dev/null || true)"
FEATURE_CODE=""
if [[ -z "$CB_TOKEN" ]]; then
  echo "SKIP: no Control Bistro owner token; the feature-off case could not be driven live."
  echo "      This is recorded rather than passed — see scripts/CREDENTIALS.md for the persona."
else
  # FEATURE_CRM is forced OFF for this tenant (CREDENTIALS.md), so it is the honest feature-off case.
  api "$CB_TOKEN" GET "/api/v1/crm/customers"
  FEATURE_CODE="$(err_code "$LAST_BODY")"
  echo "NOTE: a disabled module answers HTTP ${LAST_STATUS} ${FEATURE_CODE}"
  assert_contains "$FEATURE_CODE" "FEATURE_DISABLED" \
    "a disabled module answers FEATURE_DISABLED"
fi

if [[ -n "$PERMISSION_CODE" && -n "$FEATURE_CODE" ]]; then
  if [[ "$PERMISSION_CODE" != "$FEATURE_CODE" ]]; then
    echo "PASS: the two refusals carry different codes (${PERMISSION_CODE} vs ${FEATURE_CODE})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: both refusals carry ${PERMISSION_CODE} — a caller cannot tell them apart"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi
fi

echo
phase13_summary
