#!/usr/bin/env bash
# Phase 13-04 — self-service change-password, proved over live HTTP through the real gateway.
#
# WHY THIS EXISTS (D-30). The audit found .planning/phases/03-*/03-VERIFICATION.md scoring Phase 3
# "24/24 passed" while citing a controller that does not exist, because that verification grepped
# source. This plan's endpoint is the worst possible fit for structural verification: a
# change-password endpoint that is wired but unreachable, wired but public, or wired but not
# actually persisting looks identical in a diff and starts cleanly in every case. Only a real
# request through the real edge can tell them apart.
#
# WHAT IT PROVES
#   1. The endpoint is NOT public at the gateway. This is a prohibition of the plan, and 13-01
#      registered only the fully-qualified /api/v1/auth/change-password/forced in PUBLIC_PATHS
#      precisely because isPublicPath uses startsWith and the bare path would have exposed this one.
#   2. A wrong current password is refused, and refused in a body indistinguishable from a login
#      failure — asserted by comparing the two bodies, not by comparing statuses.
#   3. A weak new password is refused BEFORE the current password is compared, and the refusal
#      carries no fragment of what was submitted.
#   4. Reuse is refused, both against the current password and — after a real change — against the
#      history row the change wrote. The second is the only live proof that the history append
#      actually happened.
#   5. After a change the old password stops working and the new one starts.
#   6. Every refresh session is revoked, while the already-issued ACCESS token stays valid until its
#      own expiry. That residual window is the expected behaviour of a stateless token and is
#      asserted here rather than assumed, so its size is a known fact and not a surprise.
#
# PRECONDITIONS
#   - Docker infra up, and gateway + auth-service running and Eureka-registered. Nothing here
#     restarts anything.
#   - auth-service MUST be running the jar built AFTER this plan. Against a stale jar every
#     change-password assertion answers 401/404 and the script fails loudly rather than passing
#     quietly — but check anyway:
#         ls -l services/auth-service/target/auth-service-1.0.0.jar
#         ps -eo pid,lstart,args | grep auth-service-1.0.0.jar
#     The jar must be OLDER than the process.
#   - The demo tenant (a0000001-…) and its HQ branch (b0000001-…) exist — seeded by auth-service
#     Liquibase, context=seed.
#
# IDEMPOTENCE. The persona's password hash is reset to the known start value at the top of every
# run, so the script is re-runnable regardless of how a previous run ended. Its history rows are
# cleared for the same reason: leaving them would make the reuse assertions pass on the previous
# run's evidence rather than on this one's.
#
# Usage: bash scripts/e2e/phase13-password-change-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

TENANT_ID="a0000001-0000-4000-8000-000000000001"
TENANT_SLUG="demo"
BRANCH_ID="b0000001-0000-4000-8000-000000000001"

PERSONA_EMAIL="e2e-pwchange@demo.local"

# Start password. Reused verbatim from the seeded cashier row: bcrypt(12) of 'Cashier#2026'.
# Deliberately not generated here — bcrypt is not in the shell, and adding a python dependency to a
# verification script is how the script stops being runnable on the machine that needs it most.
# It happens to satisfy the new strength rule (12 chars, all four classes), which is why it can
# still be set as a starting password at all.
START_PASSWORD='Cashier#2026'
START_PASSWORD_HASH='$2a$12$HvDkD2g7oob7I/NXk3Oo/u6lcPoOVcBVa.Tb.dgQgCoiCua/fkII6'

# TERMINAL PASSWORD: what this persona's password is after a successful run. Recorded here and
# printed at the end so a re-run, or a human poking at the row, knows what it is.
NEW_PASSWORD='Zx9!qwrtBn4%'

# Fails the strength rule on length and on three of the four character classes.
WEAK_PASSWORD='qqqqqqq'

# Deterministic uuid5 id, same namespace and path scheme as scripts/onboarding.py, so a re-run
# addresses the same row instead of littering the database with a new persona each time.
uuid5_for() {
  python3 -c "
import uuid, sys
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), sys.argv[1]))
" "$1"
}
PERSONA_ID="$(uuid5_for "restaurantos/tenant/${TENANT_SLUG}/user/e2e-password-change")"

# ── Setup helpers ───────────────────────────────────────────────────────────────────────────

# There is no public user-creation API yet — it lands in a later plan in this phase — so the
# persona is written straight to auth_db, exactly as scripts/onboarding.py does. This and the
# history cleanup are the ONLY direct database writes in this script; every assertion goes over
# HTTP.
#
# The GUC is set in the same session as the writes because users, user_branch_roles and
# password_history are FORCE ROW LEVEL SECURITY on app.current_tenant_id.
auth_sql() {
  docker exec -i restaurantos-postgres psql -U auth_user -d auth_db -v ON_ERROR_STOP=1 -qtA
}

reset_persona() {
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, locale, totp_enabled, is_active)
    VALUES ('${PERSONA_ID}', '${TENANT_ID}', '${PERSONA_EMAIL}', '${START_PASSWORD_HASH}',
            'E2E Password Change', 'en', false, true)
    ON CONFLICT (id) DO UPDATE SET password_hash        = EXCLUDED.password_hash,
                                   is_active            = true,
                                   must_change_password = false,
                                   failed_login_count   = 0,
                                   locked_until         = NULL;
    DELETE FROM password_history WHERE user_id = '${PERSONA_ID}';
    UPDATE refresh_sessions SET revoked_at = now()
      WHERE user_id = '${PERSONA_ID}' AND revoked_at IS NULL;
  " | auth_sql > /dev/null
}

# CASHIER, not a role holding rbac.manage / finance.period.close / hr.payroll.approve: any of those
# forces TOTP step-up at login (13-02's finding), and this script is not about step-up. The role is
# needed at all because PermissionResolver refuses a user with no active branch assignment.
assign_role() {
  curl_retry -X POST "${AUTH_ORIGIN}/internal/auth/users/${PERSONA_ID}/branch-roles" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -d "{\"branchId\":\"${BRANCH_ID}\",\"roleCode\":\"CASHIER\"}" > /dev/null
}

# Bodies are ALWAYS built in a variable, never written inline inside a command substitution:
# `"$(curl ... -d "{\"a\":1,\"b\":2}")"` brace-expands the comma and runs curl twice with two
# malformed fragments. 13-02's harness did exactly that and reported a confident wrong answer.
# Built through python so the passwords are JSON-escaped rather than hand-quoted.
change_body() {
  python3 -c "
import json, sys
print(json.dumps({'currentPassword': sys.argv[1], 'newPassword': sys.argv[2]}))
" "$1" "$2"
}

# POST a change-password request through the gateway and print BODY, a newline, then the status.
#
# It prints both rather than setting a global, and callers split with change_status/change_body_of
# below. The obvious version — print the body, assign the status to a global — is WRONG in a way
# that reads as correct and produced four confident false FAILs on this script's first run: every
# call site is a command substitution, `"$(post_change ...)"` runs in a SUBSHELL, and the global
# assignment dies with it. The parent kept reporting the status of the last call made OUTSIDE a
# substitution, so four assertions all reported 401 while their body assertions, on the very same
# responses, correctly reported 400/VALIDATION_FAILED and 400/PASSWORD_REUSE. This is the same
# defect class as the brace-expansion bug 13-02 had to fix in its own harness: a verification
# script that can quietly measure the wrong thing is worse than no script.
post_change() {
  local token="${1:-}" body="${2:-}"
  local -a args=(-s -w '\n%{http_code}' -X POST "${GATEWAY}/api/v1/auth/change-password"
                 -H "Content-Type: application/json" -d "$body")
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer ${token}")
  fi
  curl "${args[@]}"
}

# Split what post_change printed. Status is everything after the last newline; body is the rest.
change_status()   { local r="${1:-}"; printf '%s' "${r##*$'\n'}"; }
change_body_of()  { local r="${1:-}"; printf '%s' "${r%$'\n'*}"; }

error_code() {
  printf '%s' "${1:-}" | json_get "['error']['code']" 2>/dev/null || printf 'NO_CODE'
}

# The error object with traceId removed. traceId is per-request by design; everything else about
# two authentication failures must match, or the difference is an oracle.
error_without_trace() {
  printf '%s' "${1:-}" | python3 -c "
import sys, json
try:
    e = json.load(sys.stdin)['error']
except Exception:
    print('UNPARSEABLE'); raise SystemExit
e.pop('traceId', None)
print(json.dumps(e, sort_keys=True))
"
}

assert_equal() {
  local expected="${1:-}" actual="${2:-}" description="${3:-}"
  if [[ "$expected" == "$actual" ]]; then
    echo "PASS: ${description}"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: ${description}"
    echo "        expected: ${expected}"
    echo "        actual:   ${actual}"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi
}

assert_absent() {
  local haystack="${1:-}" needle="${2:-}" description="${3:-}"
  if printf '%s' "$haystack" | grep -qF -- "$needle"; then
    echo "FAIL: ${description} — found '${needle}' in: ${haystack}"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  else
    echo "PASS: ${description}"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  fi
}

echo "=== Phase 13-04: self-service change-password over live HTTP ==="
echo "gateway=${GATEWAY}  auth=${AUTH_ORIGIN}  tenant=${TENANT_SLUG}"
echo

reset_persona
assign_role
echo "Persona ${PERSONA_EMAIL} (${PERSONA_ID}) reset to the start password."
echo

# errexit is deliberately dropped from here down: the assert_* helpers return 1 on failure, so
# under `set -e` the script would die at the FIRST failure and silently skip every assertion after
# it. Setup above still runs under errexit, because a failure there means the assertions measure
# nothing. The exit code comes from phase13_summary.
set +e

# ── 1. The endpoint is authenticated, at the edge ───────────────────────────────────────────

NO_TOKEN_BODY="$(change_body "$START_PASSWORD" "$NEW_PASSWORD")"
assert_status 401 "$(change_status "$(post_change "" "$NO_TOKEN_BODY")")" \
  "/api/v1/auth/change-password is NOT in the gateway public paths (no token => 401)"

assert_status 401 "$(change_status "$(post_change "not.a.real.jwt" "$NO_TOKEN_BODY")")" \
  "a garbage bearer token is refused"

# ── 2. Log in, keeping the refresh cookie for the revocation assertion later ────────────────

LOGIN_BODY="$(python3 -c "
import json, sys
print(json.dumps({'email': sys.argv[1], 'password': sys.argv[2], 'tenantSlug': sys.argv[3]}))
" "$PERSONA_EMAIL" "$START_PASSWORD" "$TENANT_SLUG")"

LOGIN_HEADERS="$(mktemp)"
LOGIN_RESPONSE="$(curl_retry -D "$LOGIN_HEADERS" -X POST "${GATEWAY}/api/v1/auth/login" \
  -H "Content-Type: application/json" -d "$LOGIN_BODY")"
TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | json_get "['data']['accessToken']" 2>/dev/null || true)"
REFRESH_COOKIE="$(grep -i '^set-cookie: refresh_token=' "$LOGIN_HEADERS" \
  | head -1 | sed -E 's/^[Ss]et-[Cc]ookie: *([^;]*).*/\1/' | tr -d '\r')"
rm -f "$LOGIN_HEADERS"

if [[ -z "$TOKEN" || "$TOKEN" == "None" ]]; then
  echo "FAIL: could not log the persona in before changing anything: ${LOGIN_RESPONSE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  phase13_summary
  exit 1
fi
echo "PASS: the persona logs in with the start password"
PHASE13_PASS=$((PHASE13_PASS + 1))
assert_contains "$REFRESH_COOKIE" "refresh_token=" "login issued a refresh cookie to revoke later"

# ── 3. A wrong current password ─────────────────────────────────────────────────────────────

WRONG_BODY="$(change_body 'Definitely#Wrong1' "$NEW_PASSWORD")"
WRONG_RAW="$(post_change "$TOKEN" "$WRONG_BODY")"
WRONG_RESPONSE="$(change_body_of "$WRONG_RAW")"
assert_status 401 "$(change_status "$WRONG_RAW")" "a wrong current password is refused"

FAILED_LOGIN_BODY="$(python3 -c "
import json, sys
print(json.dumps({'email': sys.argv[1], 'password': 'Definitely#Wrong1', 'tenantSlug': sys.argv[2]}))
" "$PERSONA_EMAIL" "$TENANT_SLUG")"
FAILED_LOGIN_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" \
  -H "Content-Type: application/json" -d "$FAILED_LOGIN_BODY")"
assert_equal "$(error_without_trace "$FAILED_LOGIN_RESPONSE")" "$(error_without_trace "$WRONG_RESPONSE")" \
  "the refusal is byte-identical to a login failure (no oracle)"

# It must also not have half-applied.
assert_status 200 "$(curl_status -X POST "${GATEWAY}/api/v1/auth/login" \
  -H "Content-Type: application/json" -d "$LOGIN_BODY")" \
  "a refused attempt leaves the old password working"

# ── 4. A weak new password ──────────────────────────────────────────────────────────────────

# BOTH fields are wrong on purpose. If validation runs first this is 400; if the password
# comparison runs first it is 401. That difference is the whole assertion.
WEAK_BODY="$(change_body 'AlsoWrong#111' "$WEAK_PASSWORD")"
WEAK_RAW="$(post_change "$TOKEN" "$WEAK_BODY")"
WEAK_RESPONSE="$(change_body_of "$WEAK_RAW")"
assert_status 400 "$(change_status "$WEAK_RAW")" "a weak new password is refused BEFORE the current one is checked"
assert_equal "VALIDATION_FAILED" "$(error_code "$WEAK_RESPONSE")" "and refused as a validation failure"
assert_contains "$WEAK_RESPONSE" "must contain" "the message names the unmet rules"
assert_absent "$WEAK_RESPONSE" "$WEAK_PASSWORD" "the refusal does not echo the submitted new password"
assert_absent "$WEAK_RESPONSE" "AlsoWrong" "the refusal does not echo the submitted current password"

# ── 5. Reuse of the current password ────────────────────────────────────────────────────────

REUSE_BODY="$(change_body "$START_PASSWORD" "$START_PASSWORD")"
REUSE_RAW="$(post_change "$TOKEN" "$REUSE_BODY")"
REUSE_RESPONSE="$(change_body_of "$REUSE_RAW")"
assert_status 400 "$(change_status "$REUSE_RAW")" "reusing the current password is refused"
assert_equal "PASSWORD_REUSE" "$(error_code "$REUSE_RESPONSE")" "and refused as reuse, not as a bad credential"

# ── 6. The change itself ────────────────────────────────────────────────────────────────────

VALID_BODY="$(change_body "$START_PASSWORD" "$NEW_PASSWORD")"
VALID_RAW="$(post_change "$TOKEN" "$VALID_BODY")"
VALID_RESPONSE="$(change_body_of "$VALID_RAW")"
assert_status 200 "$(change_status "$VALID_RAW")" "a correct current password and a compliant new one succeed"
assert_absent "$VALID_RESPONSE" "$NEW_PASSWORD" "the success response does not echo the new password"

assert_status 401 "$(curl_status -X POST "${GATEWAY}/api/v1/auth/login" \
  -H "Content-Type: application/json" -d "$LOGIN_BODY")" \
  "the OLD password no longer authenticates"

NEW_LOGIN_BODY="$(python3 -c "
import json, sys
print(json.dumps({'email': sys.argv[1], 'password': sys.argv[2], 'tenantSlug': sys.argv[3]}))
" "$PERSONA_EMAIL" "$NEW_PASSWORD" "$TENANT_SLUG")"
assert_status 200 "$(curl_status -X POST "${GATEWAY}/api/v1/auth/login" \
  -H "Content-Type: application/json" -d "$NEW_LOGIN_BODY")" \
  "the NEW password authenticates"

# ── 7. History was actually written ─────────────────────────────────────────────────────────

# Changing BACK to the start password must now be refused as reuse. Nothing else proves the
# history append happened: the current-password check alone would refuse it only if it were the
# current password, and it is not any more.
NEW_TOKEN="$(tenant_login "$PERSONA_EMAIL" "$NEW_PASSWORD" "$TENANT_SLUG")"
BACK_BODY="$(change_body "$NEW_PASSWORD" "$START_PASSWORD")"
BACK_RAW="$(post_change "$NEW_TOKEN" "$BACK_BODY")"
BACK_RESPONSE="$(change_body_of "$BACK_RAW")"
assert_status 400 "$(change_status "$BACK_RAW")" "changing BACK to the previous password is refused"
assert_equal "PASSWORD_REUSE" "$(error_code "$BACK_RESPONSE")" \
  "…as reuse — which is only possible if the change wrote a history row"

# ── 8. Sessions: refresh revoked, access token intentionally still live ─────────────────────

REFRESH_STATUS="$(curl_status -X POST "${GATEWAY}/api/v1/auth/refresh" -H "Cookie: ${REFRESH_COOKIE}")"
assert_not_status 200 "$REFRESH_STATUS" "the pre-change refresh session can no longer be exchanged"

# The other half, and the one that must be asserted rather than assumed. An access token is
# stateless: there is no revocation list, so one minted before the change stays valid until it
# expires. That window is the documented, intended behaviour — measuring it here means its size is
# a known fact rather than a surprise found during an incident.
ACCESS_STILL_VALID="$(curl_status -X GET "${GATEWAY}/api/v1/auth/my-branches" \
  -H "Authorization: Bearer ${TOKEN}")"
assert_status 200 "$ACCESS_STILL_VALID" \
  "the pre-change ACCESS token still works until its own expiry (stateless, by design)"

TOKEN_TTL="$(jwt_claims "$TOKEN" | python3 -c "
import sys, json
c = json.load(sys.stdin)
print(int(c['exp']) - int(c['iat']))
" 2>/dev/null || echo unknown)"
echo "        (residual window = the access-token TTL, ${TOKEN_TTL}s)"

echo
echo "Persona left at: ${PERSONA_EMAIL} / ${NEW_PASSWORD}  (id ${PERSONA_ID})"
echo "Re-running this script resets it to '${START_PASSWORD}' first, so it is idempotent."
phase13_summary
