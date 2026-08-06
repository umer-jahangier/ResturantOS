#!/usr/bin/env bash
# Phase 13 shared verification library — SOURCE this, do not execute it.
#
# Why it exists (D-30): the audit found .planning/phases/03-*/03-VERIFICATION.md scoring Phase 3
# "24/24 passed" while citing a controller that does not exist. That verification was structural —
# it grepped source. It is precisely why blocker B1 (no SuperAdmin can authenticate) survived for
# months in a phase marked complete. Every plan in phase 13 therefore proves itself by driving live
# HTTP through the real gateway against the real stack, and this file is the shared apparatus for
# doing that. Nothing here reads source code, and nothing here should ever start to.
#
# Usage:
#   . scripts/e2e/_phase13-lib.sh
#   TOKEN="$(mint_platform_token "$(uuidgen)")"
#   assert_status 200 "$(curl -s -o /dev/null -w '%{http_code}' ...)" "platform tenants reachable"
#   phase13_summary   # exits non-zero if anything failed
#
# Safe under `set -euo pipefail` in the sourcing script.

# Idempotent: sourcing twice must not reset the counters mid-run.
if [[ -n "${_PHASE13_LIB_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
_PHASE13_LIB_LOADED=1

# Resolve the repo root from this file's location, not from $PWD — callers run from anywhere.
#
# ${BASH_SOURCE[0]} is unset under zsh, which is macOS's default login shell. Without the
# git fallback, sourcing this from a zsh prompt silently computes the wrong root, silently fails to
# read deploy/.env, and silently falls back to the placeholder internal secret — so every internal
# call 403s while the harness reports nothing wrong. That is the SAME failure this repo already
# hit and fixed in scripts/local-service-env.sh (DEV-STACK-RUNBOOK "Known failure modes" #1), and a
# verification harness that can quietly test the wrong thing is worse than none.
_PHASE13_LIB_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$_PHASE13_LIB_SOURCE" ]]; then
  _PHASE13_LIB_DIR="$(cd "$(dirname "$_PHASE13_LIB_SOURCE")" && pwd)"
  PHASE13_REPO_ROOT="${PHASE13_REPO_ROOT:-$(cd "${_PHASE13_LIB_DIR}/../.." && pwd)}"
else
  PHASE13_REPO_ROOT="${PHASE13_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
if [[ ! -f "${PHASE13_REPO_ROOT}/scripts/e2e/_phase13-lib.sh" ]]; then
  echo "_phase13-lib.sh: could not locate the repo root (guessed '${PHASE13_REPO_ROOT}')." >&2
  echo "  Set PHASE13_REPO_ROOT explicitly, or source this from inside the repo." >&2
  return 1 2>/dev/null || exit 1
fi

# deploy/.env holds INTERNAL_SERVICE_SECRET and the DB/broker credentials. `set -a` exports every
# assignment so child curl/python invocations inherit them. Tolerated-missing: a developer running
# against a hand-started stack may not have one, and the defaults below match the values baked into
# gateway/auth-service application.yml.
if [[ -f "${PHASE13_REPO_ROOT}/deploy/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  . "${PHASE13_REPO_ROOT}/deploy/.env"
  set +a
fi

# ── Endpoints ───────────────────────────────────────────────────────────────────────────────
# GATEWAY is the ONLY origin assertions should normally target: proving something against a
# service's own port proves nothing about whether a real client can reach it, which is the exact
# gap B1 lived in.
GATEWAY="${GATEWAY:-http://localhost:8080}"
# AUTH_ORIGIN is the exception, and only for /internal/**: the gateway deliberately maps no route
# to /internal/auth/**, because the internal shared secret is the whole of the authorization there.
AUTH_ORIGIN="${AUTH_ORIGIN:-http://localhost:8081}"
INTERNAL_SECRET="${INTERNAL_SERVICE_SECRET:-dev-internal-secret}"

PHASE13_PASS=0
PHASE13_FAIL=0

# ── HTTP ────────────────────────────────────────────────────────────────────────────────────

# curl, retried ONCE when the gateway answers with its own SERVICE_UNAVAILABLE fallback.
#
# This gateway's Resilience4j breaker on a cold/idle `lb://` pool intermittently answers the first
# request after a quiet period with the fallback body even though the backend is healthy (the
# 10-13-H / 10-14-E failure mode, and the reason authCircuitBreaker's time limiter was raised to
# 5s). Retrying once is what any real client must do against this gateway. A SECOND consecutive
# SERVICE_UNAVAILABLE is returned as-is and treated as a real failure — this must never become a
# loop that hides a genuinely dead upstream.
curl_retry() {
  local response
  response="$(curl -s "$@")"
  if printf '%s' "$response" | grep -q '"code":"SERVICE_UNAVAILABLE"'; then
    sleep 2
    response="$(curl -s "$@")"
  fi
  printf '%s' "$response"
}

# HTTP status code only, same cold-breaker retry. Prints e.g. 401.
curl_status() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  if [[ "$code" == "503" ]]; then
    sleep 2
    code="$(curl -s -o /dev/null -w '%{http_code}' "$@")"
  fi
  printf '%s' "$code"
}

# ── JSON ────────────────────────────────────────────────────────────────────────────────────

# Read JSON on stdin, print the value at a python subscript expression.
#   echo "$RESP" | json_get "['data']['accessToken']"
# Prints nothing and returns 1 when the path is absent, so callers can test with [[ -z ]].
json_get() {
  python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(eval('d' + sys.argv[1]))
except Exception:
    sys.exit(1)
" "$1"
}

# Base64url-decode a JWT's payload segment and pretty-print it as JSON.
#
# Developer-run against a local stack only (threat T-13-01-E, accepted): a JWT payload carries
# claims, not secrets, but the token itself is on the command line — do not pipe this into a log
# you keep.
jwt_claims() {
  local token="${1:-}"
  if [[ -z "$token" ]]; then
    echo "jwt_claims: no token given" >&2
    return 1
  fi
  printf '%s' "$token" | python3 -c "
import sys, base64, json
seg = sys.stdin.read().strip().split('.')[1]
seg += '=' * (-len(seg) % 4)
print(json.dumps(json.loads(base64.urlsafe_b64decode(seg)), indent=2, sort_keys=True))
"
}

# ── Tokens ──────────────────────────────────────────────────────────────────────────────────

# Mint a tenant-less platform (control-plane) token. Prints the raw JWT.
#   TOKEN="$(mint_platform_token "$PLATFORM_USER_ID" SUPER_ADMIN)"
#
# Goes straight to auth-service, NOT through the gateway: /internal/auth/** is gated by
# InternalServiceFilter's shared secret and is deliberately unrouted at the edge (threat
# T-13-01-B). Until 13-05 lands the real platform login, this is how later plans obtain a
# SuperAdmin token to drive the platform API.
mint_platform_token() {
  local platform_user_id="${1:-}"
  local platform_role="${2:-SUPER_ADMIN}"
  if [[ -z "$platform_user_id" ]]; then
    echo "mint_platform_token: platform user id required" >&2
    return 1
  fi
  local response token
  response="$(curl_retry -X POST "${AUTH_ORIGIN}/internal/auth/platform-token" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -d "{\"platformUserId\":\"${platform_user_id}\",\"platformRole\":\"${platform_role}\"}")"
  token="$(printf '%s' "$response" | json_get "['data']['token']" 2>/dev/null || true)"
  if [[ -z "$token" || "$token" == "None" ]]; then
    echo "mint_platform_token: no token in response: ${response}" >&2
    return 1
  fi
  printf '%s' "$token"
}

# Log a PLATFORM (SuperAdmin) user in through the REAL gateway and print the access token.
#   TOKEN="$(platform_login superadmin@softxlogic.com 'Test@123!')"
#
# This is the real credential path added by 13-05, and it is what every later plan should use.
# mint_platform_token above bypasses the password entirely over the internal secret channel; it
# remains available for negative tests and for driving the API when no platform account exists yet,
# but a plan that proves itself with it has proven nothing about whether a human can log in — which
# is the exact gap blocker B1 lived in.
#
# Goes through ${GATEWAY}, never platform-admin-service's own port: the path is public at the edge
# (JwtGlobalFilter.PUBLIC_PATHS) and rate-limited by platform-auth-route, and neither of those is
# exercised by hitting :8096 directly.
platform_login() {
  local email="${1:-}" password="${2:-}"
  if [[ -z "$email" || -z "$password" ]]; then
    echo "platform_login: email and password are required" >&2
    return 1
  fi
  local body response token
  body="$(python3 -c "
import json, sys
print(json.dumps({'email': sys.argv[1], 'password': sys.argv[2]}))
" "$email" "$password")"
  response="$(curl_retry -X POST "${GATEWAY}/api/v1/platform/auth/login" \
    -H "Content-Type: application/json" -d "$body")"
  token="$(printf '%s' "$response" | json_get "['data']['accessToken']" 2>/dev/null || true)"
  if [[ -z "$token" || "$token" == "None" ]]; then
    echo "platform_login: no accessToken for ${email}: ${response}" >&2
    return 1
  fi
  printf '%s' "$token"
}

# Log a tenant user in through the REAL gateway and print the access token.
#   TOKEN="$(tenant_login owner@demo.local 'Owner#2026' demo "$(python3 scripts/generate_totp.py owner@demo.local | grep -oE '[0-9]{6}' | head -1)")"
# The TOTP argument is optional: only roles carrying rbac.manage are forced into step-up.
tenant_login() {
  local email="${1:-}" password="${2:-}" tenant_slug="${3:-}" totp_code="${4:-}"
  if [[ -z "$email" || -z "$password" || -z "$tenant_slug" ]]; then
    echo "tenant_login: email, password and tenantSlug are required" >&2
    return 1
  fi
  local body response token
  body="$(python3 -c "
import json, sys
b = {'email': sys.argv[1], 'password': sys.argv[2], 'tenantSlug': sys.argv[3]}
if sys.argv[4]:
    b['totpCode'] = sys.argv[4]
print(json.dumps(b))
" "$email" "$password" "$tenant_slug" "$totp_code")"
  response="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" \
    -H "Content-Type: application/json" -d "$body")"
  token="$(printf '%s' "$response" | json_get "['data']['accessToken']" 2>/dev/null || true)"
  if [[ -z "$token" || "$token" == "None" ]]; then
    echo "tenant_login: no accessToken for ${email}: ${response}" >&2
    return 1
  fi
  printf '%s' "$token"
}

# ── Forced password change (13-08, D-17) ────────────────────────────────────────────────────

# Extract the single-use change token from a 403 PASSWORD_CHANGE_REQUIRED login refusal.
#   REFUSAL="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" ... )"
#   CHANGE_TOKEN="$(change_token_from "$REFUSAL")"
#
# The token travels in the standard error envelope's `details` array as
# {"field":"changeToken","issue":"<token>"}, so a client keeps one error parser rather than two.
# Prints nothing and returns 1 when the response is not a forced-change refusal, so a caller can
# test with [[ -z ]] instead of parsing a success body by accident.
change_token_from() {
  local response="${1:-}"
  printf '%s' "$response" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for detail in d['error']['details']:
        if detail.get('field') == 'changeToken':
            print(detail['issue'])
            sys.exit(0)
except Exception:
    pass
sys.exit(1)
"
}

# Redeem a change token through the REAL gateway. Prints the HTTP status on the FIRST line and the
# response body on the remaining lines:
#   RESULT="$(forced_change "$CHANGE_TOKEN" "$TEMP_PASSWORD" "$NEW_PASSWORD")"
#   STATUS="$(printf '%s' "$RESULT" | head -1)"
#   BODY="$(printf '%s' "$RESULT" | tail -n +2)"
#
# WHY ONE REQUEST RATHER THAN TWO. 13-05 had to fix a harness that fetched the status and the body
# with separate curls: against a single-use endpoint those are not the same experiment, because the
# second call is redeeming an already-spent token. Every assertion pair here concerns one response.
#
# /api/v1/auth/change-password/forced is the ONLY password path public at the gateway, and it is
# registered there in its fully qualified form because JwtGlobalFilter.isPublicPath matches with
# startsWith — the bare /api/v1/auth/change-password would expose the authenticated self-service
# endpoint too. This helper must never be pointed at the bare path.
forced_change() {
  local change_token="${1:-}" current_password="${2:-}" new_password="${3:-}"
  if [[ -z "$change_token" || -z "$current_password" || -z "$new_password" ]]; then
    echo "forced_change: changeToken, currentPassword and newPassword are all required" >&2
    return 1
  fi
  # Built from ARGUMENTS, never as an inline literal: bash brace-expands -d "{\"a\":1,\"b\":2}"
  # into two malformed fragments and runs curl twice (13-02), and re-parses escaped quotes away
  # inside "$( … )" (13-07). Passing values as argv sidesteps both.
  local body
  body="$(python3 -c "
import json, sys
print(json.dumps({'changeToken': sys.argv[1],
                  'currentPassword': sys.argv[2],
                  'newPassword': sys.argv[3]}))
" "$change_token" "$current_password" "$new_password")"
  local response
  response="$(curl -s -w '\n%{http_code}' -X POST "${GATEWAY}/api/v1/auth/change-password/forced" \
    -H "Content-Type: application/json" -d "$body")"
  # curl appended the status as the LAST line; the caller wants it first.
  printf '%s\n%s' "$(printf '%s' "$response" | tail -1)" "$(printf '%s' "$response" | sed '$d')"
}

# ── Assertions ──────────────────────────────────────────────────────────────────────────────

# assert_status <expected> <actual> <description>
# Prints PASS/FAIL and keeps the counters phase13_summary reports on.
assert_status() {
  local expected="${1:-}" actual="${2:-}" description="${3:-}"
  if [[ "$expected" == "$actual" ]]; then
    echo "PASS: ${description} (${actual})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
    return 0
  fi
  echo "FAIL: ${description} — expected ${expected}, got ${actual}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  return 1
}

# assert_not_status <unwanted> <actual> <description>
# For "the gateway must stop 401ing this" style checks, where the upstream's own answer (403 from
# an authorization layer, 404 for an endpoint a later plan adds) is an acceptable pass.
assert_not_status() {
  local unwanted="${1:-}" actual="${2:-}" description="${3:-}"
  if [[ "$unwanted" != "$actual" ]]; then
    echo "PASS: ${description} (got ${actual}, not ${unwanted})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
    return 0
  fi
  echo "FAIL: ${description} — got the forbidden status ${actual}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  return 1
}

assert_contains() {
  local haystack="${1:-}" needle="${2:-}" description="${3:-}"
  if printf '%s' "$haystack" | grep -q -- "$needle"; then
    echo "PASS: ${description}"
    PHASE13_PASS=$((PHASE13_PASS + 1))
    return 0
  fi
  echo "FAIL: ${description} — '${needle}' not found in: ${haystack}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  return 1
}

# Print the tally. Returns 1 if anything failed, so a caller running under `set -e` stops.
phase13_summary() {
  echo "----------------------------------------"
  echo "PASS: ${PHASE13_PASS}   FAIL: ${PHASE13_FAIL}"
  [[ "$PHASE13_FAIL" -eq 0 ]]
}
