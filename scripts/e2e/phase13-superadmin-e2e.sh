#!/usr/bin/env bash
# ROADMAP SC1, proved by live HTTP: a SuperAdmin authenticates against platform_users with a
# password and reaches the platform API through the real gateway with no tenant claim.
#
# WHY THIS SCRIPT EXISTS AND WHY IT LOOKS LIKE THIS (D-30).
# .planning/phases/03-*/03-VERIFICATION.md scored Phase 3 twenty-four out of twenty-four while
# citing a controller that does not exist. It scored that way because every check was structural —
# it grepped source. The entire platform API was dead for months inside a phase marked complete.
# So: every assertion below is an HTTP request against ${GATEWAY}. Not one of them reads a source
# file, and not one of them talks to a service port. If it can be satisfied without a running
# gateway, a running auth-service and a running platform-admin-service, it is the wrong assertion.
#
# Usage:  bash scripts/e2e/phase13-superadmin-e2e.sh
# Exits non-zero if any assertion fails.
#
# PRECONDITION the script cannot check for you: gateway, auth-service and platform-admin-service
# must have been REBUILT and RESTARTED since 13-05's commits. A stale platform-admin jar answers
# 404 on the login path and every assertion here fails in a way that looks like a code defect.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
# shellcheck source=/dev/null
. "${SCRIPT_DIR}/_phase13-lib.sh"

# 13-CONTEXT "LOCKED — SuperAdmin authentication". Seeded by changeset 910.
SUPER_EMAIL="superadmin@softxlogic.com"
SUPER_PASSWORD='Test@123!'

# The account changeset 900 seeded with its password committed in the repository, deactivated by
# 910. Its plaintext appears here on purpose: this script's job is to prove it no longer works.
RETIRED_EMAIL="superadmin@restaurantos.io"
RETIRED_PASSWORD='SuperAdmin@restaurantos#2024'

# A tenant persona, to prove an ordinary token is refused on the control plane.
TENANT_EMAIL="${TENANT_EMAIL:-cashier@demo.local}"
TENANT_PASSWORD="${TENANT_PASSWORD:-Cashier#2026}"
TENANT_SLUG="${TENANT_SLUG:-demo}"

LOGIN_PATH="/api/v1/platform/auth/login"

echo "=========================================================="
echo " Phase 13 / SC1 — SuperAdmin login through the real gateway"
echo " gateway: ${GATEWAY}"
echo "=========================================================="

# ── Helpers ────────────────────────────────────────────────────────────────────────────────

# POST a platform login and print "<status>\n<body>". Status and body are returned TOGETHER on
# purpose: 13-04 hit a bug where a helper assigned the status to a global inside a command
# substitution — a subshell — so the assignment died with it and four assertions confidently
# reported the status of some earlier call. Returning both from one invocation removes the
# opportunity entirely.
platform_login_raw() {
  local email="$1" password="$2"
  local body
  body="$(python3 -c "
import json, sys
print(json.dumps({'email': sys.argv[1], 'password': sys.argv[2]}))
" "$email" "$password")"
  curl -s -o /dev/null -w '%{http_code}\n' -X POST "${GATEWAY}${LOGIN_PATH}" \
    -H "Content-Type: application/json" -d "$body"
  curl -s -X POST "${GATEWAY}${LOGIN_PATH}" \
    -H "Content-Type: application/json" -d "$body"
}

login_status() { platform_login_raw "$1" "$2" | head -1; }
login_body()   { platform_login_raw "$1" "$2" | tail -n +2; }

auth_status() {  # auth_status <token> <path>
  curl_status -H "Authorization: Bearer $1" "${GATEWAY}$2"
}

# ── 1. The SuperAdmin can log in at all ────────────────────────────────────────────────────

echo
echo "-- 1. Platform login with the CONTEXT credentials --"

# Preflight, not an assertion. Section 7 deliberately drains this IP's token bucket, and it
# replenishes at 2/s — so a second consecutive run of this script would otherwise fail section 1
# with a 429 and read as a broken login. Wait for the bucket rather than let the harness report a
# defect that is really its own previous run.
for _ in 1 2 3 4 5 6; do
  [[ "$(login_status "$SUPER_EMAIL" "$SUPER_PASSWORD")" != "429" ]] && break
  echo "     rate-limit bucket still draining from a previous run; waiting 15s"
  sleep 15
done

SUPER_STATUS="$(login_status "$SUPER_EMAIL" "$SUPER_PASSWORD")"
assert_status 200 "$SUPER_STATUS" "platform login returns 200"

SUPER_BODY="$(login_body "$SUPER_EMAIL" "$SUPER_PASSWORD")"
SUPER_TOKEN="$(printf '%s' "$SUPER_BODY" | json_get "['data']['accessToken']" 2>/dev/null || true)"
if [[ -z "$SUPER_TOKEN" || "$SUPER_TOKEN" == "None" ]]; then
  echo "FAIL: platform login returned no accessToken — body: ${SUPER_BODY}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  phase13_summary
  exit 1
fi
echo "PASS: platform login returned an access token"
PHASE13_PASS=$((PHASE13_PASS + 1))

# The prohibition: no long-lived platform credential leaves this endpoint.
COOKIE_HEADERS="$(curl -s -D - -o /dev/null -X POST "${GATEWAY}${LOGIN_PATH}" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${SUPER_EMAIL}\",\"password\":\"${SUPER_PASSWORD}\"}" | grep -ci '^set-cookie' || true)"
assert_status 0 "$COOKIE_HEADERS" "the login response sets no cookie"
assert_status 0 "$(printf '%s' "$SUPER_BODY" | grep -ci refresh || true)" \
  "the login response carries no refresh credential"

# ── 2. The token is a control-plane token, not a tenant one ────────────────────────────────

echo
echo "-- 2. The minted token's claims --"

CLAIMS="$(jwt_claims "$SUPER_TOKEN")"
assert_status 0 "$(printf '%s' "$CLAIMS" | grep -c '"tenant_id"' || true)" \
  "the token carries NO tenant claim"
assert_status 0 "$(printf '%s' "$CLAIMS" | grep -c '"branch_id"' || true)" \
  "the token carries NO branch claim"
assert_contains "$CLAIMS" 'SUPER_ADMIN'     "the token carries the SuperAdmin role"
assert_contains "$CLAIMS" '"token_type": "platform"' "the token is typed as a platform token"

# ── 3. That token reaches the platform API through the real gateway ────────────────────────

echo
echo "-- 3. Platform admin endpoints with the login-issued token --"

assert_status 200 "$(auth_status "$SUPER_TOKEN" "/api/v1/platform/tenants")" \
  "GET /api/v1/platform/tenants"

TENANTS_JSON="$(curl_retry -H "Authorization: Bearer ${SUPER_TOKEN}" "${GATEWAY}/api/v1/platform/tenants")"
TENANT_ID="$(printf '%s' "$TENANTS_JSON" | json_get "['data'][0]['id']" 2>/dev/null || true)"

if [[ -n "$TENANT_ID" && "$TENANT_ID" != "None" ]]; then
  # 200 or 404 are both acceptable; 401/403 are not. The point of the assertion is that the
  # authorization layer let the request reach the handler, not what the handler then found.
  GET_ONE="$(auth_status "$SUPER_TOKEN" "/api/v1/platform/tenants/${TENANT_ID}")"
  assert_not_status 401 "$GET_ONE" "GET a single tenant is not refused as unauthenticated"
  assert_not_status 403 "$GET_ONE" "GET a single tenant is not refused as forbidden"
  assert_status 200 "$(auth_status "$SUPER_TOKEN" "/api/v1/platform/tenants/${TENANT_ID}/features")" \
    "GET the tenant feature map"
else
  # Also exercised: a random id must reach the handler and come back 404, never 401/403 — so an
  # empty tenant list cannot silently skip the authorization assertion this section exists for.
  RANDOM_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
  GET_ONE="$(auth_status "$SUPER_TOKEN" "/api/v1/platform/tenants/${RANDOM_ID}")"
  assert_status 404 "$GET_ONE" "GET an unknown tenant reaches the handler (no tenants seeded)"
fi

# ── 4. The retired credential is dead ──────────────────────────────────────────────────────

echo
echo "-- 4. The credential committed in this repository --"

assert_status 401 "$(login_status "$RETIRED_EMAIL" "$RETIRED_PASSWORD")" \
  "the repository-committed SuperAdmin password no longer authenticates"

# ── 5. No failure distinguishes itself from any other ──────────────────────────────────────

echo
echo "-- 5. The failure paths are one failure path --"

UNKNOWN_EMAIL="nobody-$(date +%s)@nowhere.invalid"
UNKNOWN_BODY="$(login_body "$UNKNOWN_EMAIL" "$SUPER_PASSWORD")"
WRONG_BODY="$(login_body "$SUPER_EMAIL" 'Wrong@123!')"
RETIRED_BODY="$(login_body "$RETIRED_EMAIL" "$RETIRED_PASSWORD")"

assert_status 401 "$(login_status "$UNKNOWN_EMAIL" "$SUPER_PASSWORD")" "an unknown email is refused"

if [[ "$WRONG_BODY" == "$UNKNOWN_BODY" ]]; then
  echo "PASS: a wrong password is byte-identical to an unknown email"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: wrong-password body differs from unknown-email body"
  echo "      unknown: ${UNKNOWN_BODY}"
  echo "      wrong:   ${WRONG_BODY}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

if [[ "$RETIRED_BODY" == "$UNKNOWN_BODY" ]]; then
  echo "PASS: a deactivated account is byte-identical to an unknown email"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: deactivated-account body differs from unknown-email body"
  echo "      unknown:  ${UNKNOWN_BODY}"
  echo "      retired:  ${RETIRED_BODY}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

# ── 6. A tenant token buys nothing on the control plane ────────────────────────────────────

echo
echo "-- 6. A tenant persona's ordinary token on the platform API --"

TENANT_TOKEN="$(tenant_login "$TENANT_EMAIL" "$TENANT_PASSWORD" "$TENANT_SLUG" 2>/dev/null || true)"
if [[ -n "$TENANT_TOKEN" ]]; then
  assert_status 403 "$(auth_status "$TENANT_TOKEN" "/api/v1/platform/tenants")" \
    "a tenant token is refused on GET /api/v1/platform/tenants"
  if [[ -n "$TENANT_ID" && "$TENANT_ID" != "None" ]]; then
    assert_status 403 "$(auth_status "$TENANT_TOKEN" "/api/v1/platform/tenants/${TENANT_ID}/features")" \
      "a tenant token is refused on the tenant feature map"
  fi
else
  echo "FAIL: could not log ${TENANT_EMAIL} in — the tenant-token refusal could not be tested"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

# Unauthenticated and garbage-token requests must not reach the control plane either.
assert_status 401 "$(curl_status "${GATEWAY}/api/v1/platform/tenants")" \
  "no token is refused on the platform API"
assert_status 401 "$(curl_status -H "Authorization: Bearer not.a.jwt" "${GATEWAY}/api/v1/platform/tenants")" \
  "a garbage token is refused on the platform API"

# ── 7. The dedicated rate-limited route is actually matched ────────────────────────────────
#
# Declaration order is the whole mechanism: /api/v1/platform/auth/login also matches
# platform-admin-route's /api/v1/platform/** predicate, and Spring Cloud Gateway takes the first
# match. If platform-auth-route ever drifts below it, the throttle silently disappears from a
# credential endpoint and NOTHING else in this suite would notice. Hence a live 429.
#
# Run last: it deliberately spends the per-IP budget. Each attempt uses a distinct unknown email
# so no real account accumulates lockout failures from this section.

echo
echo "-- 7. The platform login route's rate limit --"

BURST="${RATE_LIMIT_AUTH_PER_MIN:-100}"
ATTEMPTS=$(( BURST + 40 ))
SAW_429=0
for i in $(seq 1 "$ATTEMPTS"); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${GATEWAY}${LOGIN_PATH}" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"rl-${i}-$$@nowhere.invalid\",\"password\":\"x\"}")"
  if [[ "$code" == "429" ]]; then
    SAW_429=1
    echo "     429 after ${i} attempts (burst capacity ${BURST})"
    break
  fi
done
assert_status 1 "$SAW_429" "platform-auth-route throttles the login endpoint (429)"

# ── Summary ────────────────────────────────────────────────────────────────────────────────

echo
phase13_summary
