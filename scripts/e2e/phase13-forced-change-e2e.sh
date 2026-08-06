#!/usr/bin/env bash
# Phase 13-08 — the forced-password-change cycle, proved over live HTTP through the real gateway.
#
# WHY THIS EXISTS (D-30). The audit found .planning/phases/03-*/03-VERIFICATION.md scoring Phase 3
# "24/24 passed" while citing a controller that does not exist, because that verification grepped
# source. This one does not read a single source file. Every assertion below is a request to
# ${GATEWAY} or a query against the live auth_db, whose owner auth_user is NOSUPERUSER NOBYPASSRLS
# — so every row-level-security policy that Testcontainers' SUPERUSER makes inert in the integration
# suite is really enforced here. That distinction has already hidden three shipped defects in this
# phase alone (13-02's branch-role write, 13-06's user INSERT, and 13-08's own discovery that the
# forgot-password confirm endpoint could never find its token).
#
# WHAT IT PROVES (ROADMAP SC4, in part)
#   1. A provisioned account's first login is REFUSED — 403 PASSWORD_CHANGE_REQUIRED — and carries a
#      single-use change token and no access token, no permissions and no refresh cookie.
#   2. A wrong password for that same account yields the ORDINARY generic failure, byte-identical to
#      the failure for an account that does not exist. The flag is not an account-existence oracle.
#   3. A weak new password is refused 400 and leaves the token unspent, so a user who fumbles the
#      policy is not locked out of their own recovery.
#   4. Redeeming the token with the temporary password and a compliant new one returns 200.
#   5. A second redemption of the same token is refused.
#   6. The subsequent login returns a normal access token with a non-empty permission claim.
#   7. The AUTHENTICATED self-service change endpoint is still 401 anonymously at the gateway — the
#      forced variant is public, the bare path is not, and both are checked from outside.
#
# ON THE ROLE CHOSEN. The disposable account is provisioned CASHIER, not OWNER. An OWNER holds
# rbac.manage and would meet a SECOND gate after this one — 401 TOTP_ENROLLMENT_REQUIRED (D-29a) —
# which is correct behaviour and is asserted in AuthTenantProvisioningIT, but it would make "the
# subsequent login returns a normal token" a statement about two gates instead of this one.
#
# PRECONDITIONS
#   - Docker infra up; gateway, auth-service and user-service running and Eureka-registered.
#   - auth-service MUST be running a jar built AFTER plan 13-08, so changeset 061 has been applied.
#     Against a stale jar the forced endpoint 404s and this script fails loudly rather than
#     reporting a confident, meaningless pass.
#   - Nothing here restarts anything.
#
# Usage: bash scripts/e2e/phase13-forced-change-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

USER_ORIGIN="${USER_ORIGIN:-http://localhost:8082}"

# ── Throwaway identifiers, derived deterministically from this script's name ─────────────────
# Same uuid5 mechanism scripts/onboarding.py uses, so a re-run addresses the same rows rather than
# littering the database with a new tenant every time.
uuid5_for() {
  python3 -c "
import uuid, sys
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), sys.argv[1]))
" "$1"
}

SEAM="phase13-forced-change"
TENANT_ID="$(uuid5_for "restaurantos/e2e/${SEAM}/tenant")"
TENANT_SLUG="e2e-1308-forced"
SUBJECT_EMAIL="forced-subject@${TENANT_SLUG}.local"

# Both satisfy the shared @StrongPassword policy (>= 8 chars, all four character classes).
NEW_PASSWORD='Fq7!vwmtBn3%'
# Fails it on length and on three character classes.
WEAK_PASSWORD='qqqqqqq'

# ── Cleanup ─────────────────────────────────────────────────────────────────────────────────

auth_sql() {
  docker exec -i restaurantos-postgres psql -U auth_user -d auth_db -v ON_ERROR_STOP=1 -qtA
}
user_sql() {
  docker exec -i restaurantos-postgres psql -U user_service -d user_db -v ON_ERROR_STOP=1 -qtA
}

# The GUC is set in the same session as every statement because users, user_branch_roles,
# refresh_sessions, password_reset_tokens, password_history and branches are all FORCE ROW LEVEL
# SECURITY on app.current_tenant_id — without it these deletes match zero rows and report success,
# leaving the tenant behind. auth_tenants is deliberately NOT scoped (it is the pre-tenant-context
# lookup login performs) so it needs no GUC.
purge_sql() {
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    DELETE FROM password_reset_tokens WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM refresh_sessions WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM user_branch_roles WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM password_history WHERE user_id IN (SELECT id FROM users WHERE tenant_id = '${TENANT_ID}');
    DELETE FROM users WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM auth_tenants WHERE id = '${TENANT_ID}';
  " | auth_sql > /dev/null 2>&1 || true
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    DELETE FROM branches WHERE tenant_id = '${TENANT_ID}';
  " | user_sql > /dev/null 2>&1 || true
}

cleanup() {
  local code=$?
  set +e
  purge_sql
  echo "Cleaned up throwaway tenant ${TENANT_ID}"
  exit $code
}
trap cleanup EXIT

# Also clean BEFORE starting: a previous run killed between steps would otherwise leave rows that
# make "already exists" look like a defect in the code under test.
purge_sql

# ── Helpers ─────────────────────────────────────────────────────────────────────────────────

# Bodies are ALWAYS built from ARGUMENTS, never written inline. An inline -d "{\"a\":1,\"b\":2}" is
# brace-expanded by bash into two malformed fragments and curl runs twice (13-02); and building one
# inside "$( … )" has its escaped quotes consumed before the helper ever sees them (13-07).
json_obj() {
  python3 -c "
import json, sys
args = sys.argv[1:]
print(json.dumps(dict(zip(args[0::2], args[1::2]))))
" "$@"
}

# The error object with traceId stripped. Two credential refusals must be byte-identical apart from
# a per-request trace id, and comparing STATUSES would not show it if they were not.
error_without_trace() {
  printf '%s' "${1:-}" | python3 -c "
import sys, json
try:
    e = json.load(sys.stdin)['error']
    e.pop('traceId', None)
    print(json.dumps(e, sort_keys=True))
except Exception:
    print('<unparseable>')
"
}

auth_internal_post() {
  curl_retry -X POST "${AUTH_ORIGIN}${1}" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -d "${2}"
}

# One request, status and body together. Two separate curls against a login endpoint that mints a
# single-use token per call are not the same experiment — the status and the body would describe
# different responses, and different tokens (13-05 had to fix exactly this).
login_raw() {
  local body
  body="$(json_obj email "${1}" password "${2}" tenantSlug "${TENANT_SLUG}")"
  curl -s -D - -o - -w '\n%{http_code}' -X POST "${GATEWAY}/api/v1/auth/login" \
    -H "Content-Type: application/json" -d "$body"
}

echo "=== Phase 13-08: the forced-password-change cycle, over live HTTP ==="
echo "gateway=${GATEWAY}  auth=${AUTH_ORIGIN}  user=${USER_ORIGIN}"
echo "tenant=${TENANT_ID}  slug=${TENANT_SLUG}"
echo

# ── Setup: a disposable account carrying must_change_password ────────────────────────────────

BRANCH_BODY="$(json_obj tenantId "${TENANT_ID}" name "Forced HQ")"
BRANCH_BODY="$(python3 -c "
import json,sys
b = json.loads(sys.argv[1]); b['isHq'] = True; print(json.dumps(b))
" "$BRANCH_BODY")"
BRANCH_RESPONSE="$(curl_retry -X POST "${USER_ORIGIN}/internal/users/branches" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Service: ${INTERNAL_SECRET}" -d "$BRANCH_BODY")"
BRANCH_ID="$(printf '%s' "$BRANCH_RESPONSE" | json_get "['branchId']" 2>/dev/null || true)"
if [[ -z "$BRANCH_ID" || "$BRANCH_ID" == "None" ]]; then
  echo "SETUP FAILED: no branchId from user-service: ${BRANCH_RESPONSE}" >&2
  exit 1
fi

REGISTER_BODY="$(json_obj tenantId "${TENANT_ID}" slug "${TENANT_SLUG}" name "Forced Change Co")"
auth_internal_post "/internal/auth/tenants" "$REGISTER_BODY" > /dev/null

PROVISION_BODY="$(json_obj email "${SUBJECT_EMAIL}" branchId "${BRANCH_ID}" roleCode CASHIER fullName "Forced Subject")"
PROVISION_RESPONSE="$(auth_internal_post "/internal/auth/tenants/${TENANT_ID}/provision-admin" "$PROVISION_BODY")"
TEMP_PASSWORD="$(printf '%s' "$PROVISION_RESPONSE" | json_get "['data']['tempPassword']" 2>/dev/null || true)"
SUBJECT_ID="$(printf '%s' "$PROVISION_RESPONSE" | json_get "['data']['userId']" 2>/dev/null || true)"
if [[ -z "$TEMP_PASSWORD" || "$TEMP_PASSWORD" == "None" ]]; then
  echo "SETUP FAILED: provision-admin returned no temp password: ${PROVISION_RESPONSE}" >&2
  exit 1
fi
echo "Provisioned ${SUBJECT_EMAIL} (${SUBJECT_ID}) on branch ${BRANCH_ID}"
echo

set +e   # errexit off for the assertion phase: assert_* return 1, and under -e the first failure
         # would silently skip every assertion after it. The exit code comes from phase13_summary.

# The premise. If this is false, everything below is testing nothing.
FLAG="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT must_change_password FROM users WHERE id = '${SUBJECT_ID}';
" | auth_sql | tail -1)"
assert_status "t" "$FLAG" "the provisioned account carries must_change_password"

# ── 1. The first login is refused, and hands back a change token ─────────────────────────────

RAW="$(login_raw "$SUBJECT_EMAIL" "$TEMP_PASSWORD")"
FIRST_STATUS="$(printf '%s' "$RAW" | tail -1)"
FIRST_BODY="$(printf '%s' "$RAW" | sed '$d' | sed -n '/^{/,$p')"
FIRST_HEADERS="$(printf '%s' "$RAW" | sed -n '1,/^\r*$/p')"

assert_status 403 "$FIRST_STATUS" "the first login is REFUSED, not tokenised"
assert_contains "$FIRST_BODY" 'PASSWORD_CHANGE_REQUIRED' "the refusal carries the distinct machine-readable code"

CHANGE_TOKEN="$(change_token_from "$FIRST_BODY" || true)"
if [[ -n "$CHANGE_TOKEN" ]]; then
  echo "PASS: the refusal carries a single-use change token"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: no change token in the refusal: ${FIRST_BODY}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

# No access token, no permission claim, no refresh credential — the "restricted token" design that
# was deliberately NOT chosen would show up right here.
if printf '%s' "$FIRST_BODY" | grep -qE '"accessToken"|"permissions"|"refreshToken"'; then
  echo "FAIL: the refusal leaked a token or a permission claim: ${FIRST_BODY}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: the refusal carries no access token, no permissions and no refresh token"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

if printf '%s' "$FIRST_HEADERS" | grep -qi '^set-cookie'; then
  echo "FAIL: the refusal set a cookie — a successful login's 30-day refresh credential"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: the refusal carries no Set-Cookie header"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

# ── 2. The flag is not an account-existence oracle ───────────────────────────────────────────

WRONG_RAW="$(login_raw "$SUBJECT_EMAIL" 'Nope#NotMine1')"
WRONG_STATUS="$(printf '%s' "$WRONG_RAW" | tail -1)"
WRONG_BODY="$(printf '%s' "$WRONG_RAW" | sed '$d' | sed -n '/^{/,$p')"

NOBODY_RAW="$(login_raw "nobody@${TENANT_SLUG}.local" 'Nope#NotMine1')"
NOBODY_BODY="$(printf '%s' "$NOBODY_RAW" | sed '$d' | sed -n '/^{/,$p')"

assert_status 401 "$WRONG_STATUS" "a wrong password for a FLAGGED account is the ordinary refusal"
assert_status "$(error_without_trace "$NOBODY_BODY")" "$(error_without_trace "$WRONG_BODY")" \
  "and its body is byte-identical to the one for an account that does not exist"
if printf '%s' "$WRONG_BODY" | grep -q 'PASSWORD_CHANGE_REQUIRED'; then
  echo "FAIL: a wrong password disclosed that the account is flagged"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: a wrong password discloses nothing about the flag"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

# ── 3. A weak new password fails WITHOUT consuming the token ─────────────────────────────────

WEAK_RESULT="$(forced_change "$CHANGE_TOKEN" "$TEMP_PASSWORD" "$WEAK_PASSWORD")"
WEAK_STATUS="$(printf '%s' "$WEAK_RESULT" | head -1)"
WEAK_BODY="$(printf '%s' "$WEAK_RESULT" | tail -n +2)"

assert_status 400 "$WEAK_STATUS" "a weak new password is refused by validation"
assert_contains "$WEAK_BODY" 'VALIDATION_FAILED' "and named as a validation failure, not a credential one"
if printf '%s' "$WEAK_BODY" | grep -qF -- "$WEAK_PASSWORD"; then
  echo "FAIL: the validation message echoed the submitted password"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: the validation message echoes neither submitted value"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

UNSPENT="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM password_reset_tokens
   WHERE user_id = '${SUBJECT_ID}' AND purpose = 'FORCED_CHANGE' AND used_at IS NULL;
" | auth_sql | tail -1)"
assert_status 1 "$UNSPENT" "the fumbled attempt left the change token unspent"

# ── 4. Redemption succeeds, once ─────────────────────────────────────────────────────────────

CHANGE_RESULT="$(forced_change "$CHANGE_TOKEN" "$TEMP_PASSWORD" "$NEW_PASSWORD")"
CHANGE_STATUS="$(printf '%s' "$CHANGE_RESULT" | head -1)"
assert_status 200 "$CHANGE_STATUS" "the change token plus the temporary password completes the change"

SECOND_RESULT="$(forced_change "$CHANGE_TOKEN" "$NEW_PASSWORD" 'Rj2^xzptLk9@')"
SECOND_STATUS="$(printf '%s' "$SECOND_RESULT" | head -1)"
assert_status 401 "$SECOND_STATUS" "a second redemption of the same token is refused"

FLAG_AFTER="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT must_change_password FROM users WHERE id = '${SUBJECT_ID}';
" | auth_sql | tail -1)"
assert_status "f" "$FLAG_AFTER" "must_change_password is cleared by the change, not merely reported"

# ── 5. The next login is an ordinary login ───────────────────────────────────────────────────

OLD_RAW="$(login_raw "$SUBJECT_EMAIL" "$TEMP_PASSWORD")"
assert_status 401 "$(printf '%s' "$OLD_RAW" | tail -1)" "the temporary password no longer authenticates"

NEXT_RAW="$(login_raw "$SUBJECT_EMAIL" "$NEW_PASSWORD")"
NEXT_STATUS="$(printf '%s' "$NEXT_RAW" | tail -1)"
NEXT_BODY="$(printf '%s' "$NEXT_RAW" | sed '$d' | sed -n '/^{/,$p')"
assert_status 200 "$NEXT_STATUS" "the immediately subsequent login with the new password succeeds"

NEXT_TOKEN="$(printf '%s' "$NEXT_BODY" | json_get "['data']['accessToken']" 2>/dev/null || true)"
if [[ -z "$NEXT_TOKEN" || "$NEXT_TOKEN" == "None" ]]; then
  echo "FAIL: no access token on the post-change login: ${NEXT_BODY}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  PERM_COUNT="$(jwt_claims "$NEXT_TOKEN" | python3 -c "
import sys, json; print(len(json.load(sys.stdin).get('permissions', [])))
")"
  if [[ "$PERM_COUNT" -gt 0 ]]; then
    echo "PASS: the post-change token carries a non-empty permission claim (${PERM_COUNT} codes)"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: the post-change token's permissions claim is EMPTY — this is a normal login or it is nothing"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi
fi

# ── 6. The raw token exists nowhere but the response that handed it over ─────────────────────

TOKEN_ROWS="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM password_reset_tokens WHERE token_hash = '${CHANGE_TOKEN}';
" | auth_sql | tail -1)"
assert_status 0 "$TOKEN_ROWS" "the raw change token is not stored — only its SHA-256 is"

LEAKED="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM event_outbox
   WHERE envelope_json LIKE '%${CHANGE_TOKEN}%'
      OR envelope_json LIKE '%${NEW_PASSWORD}%'
      OR envelope_json LIKE '%${TEMP_PASSWORD}%';
" | auth_sql | tail -1)"
assert_status 0 "$LEAKED" "no change token and no password value reached any event payload"

# ── 7. Exactly ONE password path is public at the gateway ────────────────────────────────────

# The bare path is the AUTHENTICATED self-service endpoint 13-04 added. JwtGlobalFilter.isPublicPath
# matches with startsWith, so registering it would have exposed this one too — 13-01 registered the
# fully qualified /forced form precisely to avoid that. This is the assertion that would catch
# someone "tidying" the list.
BARE_BODY="$(json_obj currentPassword "$NEW_PASSWORD" newPassword 'Rj2^xzptLk9@')"
BARE_STATUS="$(curl_status -X POST "${GATEWAY}/api/v1/auth/change-password" \
  -H "Content-Type: application/json" -d "$BARE_BODY")"
assert_status 401 "$BARE_STATUS" "the AUTHENTICATED change-password path still requires a token at the gateway"

# And the forced path really is reachable anonymously — the control, without which the 401 above
# could mean "the whole prefix is closed" rather than "only the bare path is".
GARBAGE_RESULT="$(forced_change "not-a-real-token" "$NEW_PASSWORD" 'Rj2^xzptLk9@')"
GARBAGE_STATUS="$(printf '%s' "$GARBAGE_RESULT" | head -1)"
GARBAGE_BODY="$(printf '%s' "$GARBAGE_RESULT" | tail -n +2)"
assert_status 401 "$GARBAGE_STATUS" "the forced path is reachable anonymously and answers on the merits"
assert_contains "$GARBAGE_BODY" 'Invalid credentials' \
  "and its refusal is the application's generic one, not the gateway's or the chain's"
assert_status "$(error_without_trace "$NOBODY_BODY")" "$(error_without_trace "$GARBAGE_BODY")" \
  "a bad change token is indistinguishable from a login for an account that does not exist"

echo
phase13_summary
