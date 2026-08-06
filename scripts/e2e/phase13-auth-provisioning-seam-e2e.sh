#!/usr/bin/env bash
# Phase 13-06 — the auth-service provisioning seam, proved directly, BEFORE the saga is repaired.
#
# WHY THIS EXISTS (D-30). Plan 13-10 repairs the provisioning saga in platform-admin-service and
# calls the two operations this plan added. If 13-10 is the first thing that ever exercises them,
# then a failure there is ambiguous: a broken saga and a broken seam look identical from the
# outside. Driving the seam directly, now, makes that failure attributable — if this script is green
# and 13-10 is red, the defect is in the saga.
#
# It also does what no integration test in auth-service can. Testcontainers' Postgres user is a
# SUPERUSER and superusers bypass row security entirely, so an RLS defect on a write path is
# invisible to the suite by construction — which is exactly how the branch-role write path stayed
# green for months while being incapable of writing a row (13-02), and how provision-admin's own
# user INSERT did the same until this plan. The live dev auth_db's owner, auth_user, is
# NOSUPERUSER NOBYPASSRLS. Every write below therefore lands under a policy that is really enforced.
#
# WHAT IT PROVES
#   1. An auth tenant can be registered from application code, and login then resolves it by slug.
#   2. A provisioned admin has a branch-role assignment — the login is NOT refused for want of one,
#      which is the whole of blocker B2's second half.
#   3. That admin ends up holding a real token whose roles claim names OWNER and whose permissions
#      claim is non-empty.
#   4. A misspelled role code is rejected and leaves no user behind (D-13).
#   5. /internal/auth/** remains unroutable through the gateway.
#
# ON THE OWNER LOGIN, AND WHY IT IS NOT A STRAIGHT 200
# A freshly provisioned OWNER meets TWO gates before it holds a token, and since 13-08 it meets them
# in this order:
#
#   1. 403 PASSWORD_CHANGE_REQUIRED — the account carries must_change_password, which 13-06 writes
#      and 13-08 made login actually read. The refusal hands back a single-use change token.
#   2. 401 TOTP_ENROLLMENT_REQUIRED — OWNER holds rbac.manage, AuthServiceImpl.requiresTotpStepUp
#      fires on it, and the new account has no enrolled factor. That is D-29a working as decided.
#
# Neither is a defect, and BOTH are good news for blocker B2, because each sits after the step B2 is
# about: enforceTotpStepUp runs AFTER permissionResolver.resolveDefault, so being asked to enrol is
# itself proof that the branch assignment resolved. The script therefore treats a successful login,
# a forced-change response and a TOTP-enrolment demand as all satisfying "the admin can
# authenticate", and fails ONLY on a no-branch-assignment error or a generic credential rejection.
# It then clears both gates over the real public endpoints — forced change first, enrolment second,
# which is the order 13-15's seed script should copy — so criterion 3 is proved against an
# actually-issued token rather than asserted about one that was never minted.
#
# PRECONDITIONS
#   - Docker infra up; gateway, auth-service and user-service running and Eureka-registered.
#   - auth-service MUST be running the jar built AFTER plan 13-06. Against a stale jar the register
#     endpoint 404s and this script fails at step 1 rather than reporting a confident, meaningless
#     pass.
#   - Nothing here restarts anything.
#
# Usage: bash scripts/e2e/phase13-auth-provisioning-seam-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

USER_ORIGIN="${USER_ORIGIN:-http://localhost:8082}"

# ── Throwaway identifiers, derived deterministically from this script's name ─────────────────
#
# Same uuid5 mechanism scripts/onboarding.py uses, so a re-run addresses the same rows instead of
# littering the database with a new tenant every time. The slug is fixed for the same reason.
uuid5_for() {
  python3 -c "
import uuid, sys
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), sys.argv[1]))
" "$1"
}

SEAM="phase13-auth-provisioning-seam"
TENANT_ID="$(uuid5_for "restaurantos/e2e/${SEAM}/tenant")"
TENANT_SLUG="e2e-1306-seam"
ADMIN_EMAIL="seam-owner@${TENANT_SLUG}.local"
BADROLE_EMAIL="seam-badrole@${TENANT_SLUG}.local"

# ── Cleanup ─────────────────────────────────────────────────────────────────────────────────

auth_sql() {
  docker exec -i restaurantos-postgres psql -U auth_user -d auth_db -v ON_ERROR_STOP=1 -qtA
}
user_sql() {
  docker exec -i restaurantos-postgres psql -U user_service -d user_db -v ON_ERROR_STOP=1 -qtA
}

# The GUC is set in the same session as every statement because users, user_branch_roles,
# refresh_sessions and branches are all FORCE ROW LEVEL SECURITY on app.current_tenant_id — without
# it these deletes match zero rows and report success, leaving the tenant behind. auth_tenants is
# deliberately NOT scoped (it is the pre-tenant-context lookup) so it needs no GUC.
cleanup() {
  local code=$?
  set +e
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    DELETE FROM refresh_sessions WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM user_branch_roles WHERE tenant_id = '${TENANT_ID}';
    -- 13-08: password_reset_tokens now also holds FORCED_CHANGE tokens, and it has an FK to
    -- users. Without this line the users DELETE below aborts on
    -- fk_password_reset_tokens_user and (under ON_ERROR_STOP) leaves the whole tenant behind.
    DELETE FROM password_reset_tokens WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM password_history WHERE user_id IN (SELECT id FROM users WHERE tenant_id = '${TENANT_ID}');
    DELETE FROM users WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM auth_tenants WHERE id = '${TENANT_ID}';
  " | auth_sql > /dev/null 2>&1
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    DELETE FROM branches WHERE tenant_id = '${TENANT_ID}';
  " | user_sql > /dev/null 2>&1
  echo "Cleaned up throwaway tenant ${TENANT_ID}"
  exit $code
}
trap cleanup EXIT

# Also clean BEFORE starting: a previous run killed between steps would otherwise leave rows that
# make "already exists" failures look like defects in the code under test.
printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  DELETE FROM refresh_sessions WHERE tenant_id = '${TENANT_ID}';
  DELETE FROM user_branch_roles WHERE tenant_id = '${TENANT_ID}';
  DELETE FROM password_reset_tokens WHERE tenant_id = '${TENANT_ID}';
  DELETE FROM password_history WHERE user_id IN (SELECT id FROM users WHERE tenant_id = '${TENANT_ID}');
  DELETE FROM users WHERE tenant_id = '${TENANT_ID}';
  DELETE FROM auth_tenants WHERE id = '${TENANT_ID}';
" | auth_sql > /dev/null
printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  DELETE FROM branches WHERE tenant_id = '${TENANT_ID}';
" | user_sql > /dev/null

# ── Helpers ─────────────────────────────────────────────────────────────────────────────────

# Bodies are ALWAYS built in a variable, never written inline inside "$( … )". An inline
# -d "{\"a\":1,\"b\":2}" is BRACE-EXPANDED by bash into two malformed fragments and curl runs twice
# — which in 13-02 produced a confident FAIL for a request that, sent correctly, succeeds.
json() { python3 -c "
import json, sys
print(json.dumps(json.loads(sys.argv[1])))
" "$1"; }

# "The request reached the service and was answered on its merits."
# Borrowed from 13-02: assert_not_status alone passed on a gateway 503 once — an authorization
# success reported for a request that never arrived.
assert_authorized() {
  local status="${1:-}" description="${2:-}"
  case "$status" in
    401|403|404|5??|000)
      echo "FAIL: ${description} — got ${status}, which is not the service answering on the merits"
      PHASE13_FAIL=$((PHASE13_FAIL + 1))
      ;;
    *)
      echo "PASS: ${description} (${status})"
      PHASE13_PASS=$((PHASE13_PASS + 1))
      ;;
  esac
}

# TOTP in pure stdlib. pyotp is not installed on this machine's python3, and the phase threat
# register (T-13-06-SC) forbids installing a package to make a verification script run — a
# verification script that cannot run on the machine that needs it is not a verification script.
# Parameters match dev.samstevens.totp's defaults, which is what auth-service verifies against:
# SHA1, 6 digits, 30-second period.
totp_now() {
  python3 -c "
import base64, hmac, hashlib, struct, sys, time
secret = sys.argv[1]
key = base64.b32decode(secret + '=' * (-len(secret) % 8), casefold=True)
mac = hmac.new(key, struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest()
off = mac[-1] & 0x0F
print(str((struct.unpack('>I', mac[off:off+4])[0] & 0x7FFFFFFF) % 10**6).zfill(6))
" "$1"
}

auth_internal_post() {
  local path="$1" body="$2"
  curl_retry -X POST "${AUTH_ORIGIN}${path}" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -d "$body"
}

auth_internal_status() {
  local path="$1" body="$2"
  curl_status -X POST "${AUTH_ORIGIN}${path}" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -d "$body"
}

echo "=== Phase 13-06: the auth-service provisioning seam, over live HTTP ==="
echo "gateway=${GATEWAY}  auth=${AUTH_ORIGIN}  user=${USER_ORIGIN}"
echo "tenant=${TENANT_ID}  slug=${TENANT_SLUG}"
echo

# ── Setup: exactly what the saga in 13-10 will do, in the same order ─────────────────────────

# 1. The branch, through user-service's internal endpoint. isHq:true is sent deliberately — the
#    saga omits it today, which is one of blocker B2's listed causes.
BRANCH_BODY="$(json "{\"tenantId\":\"${TENANT_ID}\",\"name\":\"Seam HQ\",\"isHq\":true}")"
BRANCH_RESPONSE="$(curl_retry -X POST "${USER_ORIGIN}/internal/users/branches" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Service: ${INTERNAL_SECRET}" \
  -d "$BRANCH_BODY")"
# Note the shape: this endpoint returns a BARE {"branchId": …}, NOT an ApiResponse envelope. The
# saga's extractBranchId looks for {"data":{"id"}} and therefore always falls through to a random
# UUID — audit B2. Parsing it correctly here is part of what makes this a reference for 13-10.
BRANCH_ID="$(printf '%s' "$BRANCH_RESPONSE" | json_get "['branchId']" 2>/dev/null || true)"
if [[ -z "$BRANCH_ID" || "$BRANCH_ID" == "None" ]]; then
  echo "SETUP FAILED: no branchId from user-service: ${BRANCH_RESPONSE}" >&2
  exit 1
fi
echo "Created branch ${BRANCH_ID}"

set +e   # errexit off for the assertion phase: assert_* return 1, and under -e the first failure
         # would silently skip every assertion after it. The exit code comes from phase13_summary.

# ── 1. Registering the auth tenant ───────────────────────────────────────────────────────────

REGISTER_BODY="$(json "{\"tenantId\":\"${TENANT_ID}\",\"slug\":\"${TENANT_SLUG}\",\"name\":\"Seam Test Co\"}")"
REGISTER_RESPONSE="$(auth_internal_post "/internal/auth/tenants" "$REGISTER_BODY")"
REGISTER_STATUS="$(auth_internal_status "/internal/auth/tenants" "$REGISTER_BODY")"

assert_status 200 "$REGISTER_STATUS" "auth tenant registered (and the replay is idempotent)"
assert_contains "$REGISTER_RESPONSE" '"status":"ACTIVE"' "the registered tenant is ACTIVE"

# The second call above WAS the replay. Assert it did not create a second row.
ROW_COUNT="$(printf '%s\n' "SELECT count(*) FROM auth_tenants WHERE id = '${TENANT_ID}';" | auth_sql)"
assert_status 1 "$ROW_COUNT" "the replayed registration upserted rather than duplicating"

# ── 2. Provisioning the admin ────────────────────────────────────────────────────────────────

PROVISION_BODY="$(json "{\"email\":\"${ADMIN_EMAIL}\",\"branchId\":\"${BRANCH_ID}\",\"roleCode\":\"OWNER\",\"fullName\":\"Seam Owner\"}")"
PROVISION_RESPONSE="$(auth_internal_post "/internal/auth/tenants/${TENANT_ID}/provision-admin" "$PROVISION_BODY")"
TEMP_PASSWORD="$(printf '%s' "$PROVISION_RESPONSE" | json_get "['data']['tempPassword']" 2>/dev/null || true)"
ADMIN_ID="$(printf '%s' "$PROVISION_RESPONSE" | json_get "['data']['userId']" 2>/dev/null || true)"

if [[ -z "$TEMP_PASSWORD" || "$TEMP_PASSWORD" == "None" ]]; then
  echo "FAIL: provision-admin returned no temp password: ${PROVISION_RESPONSE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: provision-admin returned a temp password and user id ${ADMIN_ID}"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

# The assignment exists in the database, under a policy that is actually enforced — this is the
# write that a superuser-backed test cannot vouch for.
# psql renders a boolean as 't'/'f' in its table output but as 'true'/'false' when concatenated
# into text, which is what || does here. Expecting the display form reported a FAIL for a row that
# was entirely correct on this script's first run.
ASSIGNMENT="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT role_code || ':' || is_active || ':' || is_primary
    FROM user_branch_roles WHERE tenant_id = '${TENANT_ID}' AND user_id = '${ADMIN_ID}';
" | auth_sql | tail -1)"
assert_status "OWNER:true:true" "$ASSIGNMENT" "the OWNER assignment is present, active and primary (RLS-enforcing db)"

# ── 3. The admin authenticates ───────────────────────────────────────────────────────────────

LOGIN_BODY="$(json "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${TEMP_PASSWORD}\",\"tenantSlug\":\"${TENANT_SLUG}\"}")"
LOGIN_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" -H "Content-Type: application/json" -d "$LOGIN_BODY")"

# THE blocker-B2 assertion. Before this plan the provisioned admin died here.
if printf '%s' "$LOGIN_RESPONSE" | grep -q "no active branch assignments"; then
  echo "FAIL: the provisioned admin has no branch assignment — blocker B2 is NOT closed: ${LOGIN_RESPONSE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: the provisioned admin is NOT refused for want of a branch assignment"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

# Success, a TOTP-enrolment demand, or a forced-change response (once 13-08 lands) all mean the
# credential and the assignment were both accepted. Anything else is a real authentication failure.
if printf '%s' "$LOGIN_RESPONSE" | grep -qE '"accessToken"|TOTP_ENROLLMENT_REQUIRED|TOTP_REQUIRED|PASSWORD_CHANGE_REQUIRED|MUST_CHANGE_PASSWORD'; then
  echo "PASS: the admin authenticates (token, or a second-factor / forced-change step)"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: generic authentication failure for the provisioned admin: ${LOGIN_RESPONSE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

# ── 3b. Clear the 13-08 forced-change gate ───────────────────────────────────────────────────
#
# Added when 13-08 made must_change_password govern login. Before it, this script went straight
# from the refused first login to TOTP enrolment; now the provisioned admin must replace its
# temporary credential first, and every subsequent step uses the new password.
#
# THE ORDER IS THE POINT, and 13-15 should copy it: forced change, THEN enrolment. Enrolling a
# second factor while the first is still a temporary password known to whoever provisioned the
# account would bind the factor under a credential the admin does not exclusively control.

ADMIN_PASSWORD="$TEMP_PASSWORD"
CHANGE_TOKEN="$(change_token_from "$LOGIN_RESPONSE" || true)"
if [[ -z "$CHANGE_TOKEN" ]]; then
  echo "FAIL: the refused first login carried no change token: ${LOGIN_RESPONSE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  FORCED_NEW_PASSWORD='Seam#Owner1x'
  FORCED_RESULT="$(forced_change "$CHANGE_TOKEN" "$TEMP_PASSWORD" "$FORCED_NEW_PASSWORD")"
  FORCED_STATUS="$(printf '%s' "$FORCED_RESULT" | head -1)"
  assert_status 200 "$FORCED_STATUS" "the provisioned admin can replace its temporary credential (13-08)"
  if [[ "$FORCED_STATUS" == "200" ]]; then
    ADMIN_PASSWORD="$FORCED_NEW_PASSWORD"
  fi
fi

# ── 4. Complete the D-29a enrolment and get a real token ─────────────────────────────────────

BOOTSTRAP_BODY="$(json "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\",\"tenantSlug\":\"${TENANT_SLUG}\"}")"
BOOTSTRAP_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/2fa/bootstrap" \
  -H "Content-Type: application/json" -d "$BOOTSTRAP_BODY")"
OTPAUTH_URI="$(printf '%s' "$BOOTSTRAP_RESPONSE" | json_get "['data']['otpauthUri']" 2>/dev/null || true)"

ADMIN_TOKEN=""
if [[ -z "$OTPAUTH_URI" || "$OTPAUTH_URI" == "None" ]]; then
  echo "FAIL: TOTP bootstrap returned no otpauth uri: ${BOOTSTRAP_RESPONSE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  TOTP_SECRET="$(printf '%s' "$OTPAUTH_URI" | python3 -c "
import sys, urllib.parse as u
print(u.parse_qs(u.urlparse(sys.stdin.read().strip()).query)['secret'][0])
")"
  VERIFY_BODY="$(json "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\",\"tenantSlug\":\"${TENANT_SLUG}\",\"code\":\"$(totp_now "$TOTP_SECRET")\"}")"
  VERIFY_STATUS="$(curl_status -X POST "${GATEWAY}/api/v1/auth/2fa/bootstrap/verify" \
    -H "Content-Type: application/json" -d "$VERIFY_BODY")"
  assert_status 200 "$VERIFY_STATUS" "the admin can enrol a second factor (D-29a first-login flow)"

  STEPUP_BODY="$(json "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\",\"tenantSlug\":\"${TENANT_SLUG}\",\"totpCode\":\"$(totp_now "$TOTP_SECRET")\"}")"
  STEPUP_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" \
    -H "Content-Type: application/json" -d "$STEPUP_BODY")"
  ADMIN_TOKEN="$(printf '%s' "$STEPUP_RESPONSE" | json_get "['data']['accessToken']" 2>/dev/null || true)"
fi

if [[ -z "$ADMIN_TOKEN" || "$ADMIN_TOKEN" == "None" ]]; then
  echo "FAIL: the provisioned admin never obtained an access token"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: the provisioned admin holds a real access token"
  PHASE13_PASS=$((PHASE13_PASS + 1))

  CLAIM_ROLES="$(jwt_claims "$ADMIN_TOKEN" | python3 -c "
import sys, json; print(json.dumps(json.load(sys.stdin).get('roles', [])))
")"
  CLAIM_PERMS="$(jwt_claims "$ADMIN_TOKEN" | python3 -c "
import sys, json; print(len(json.load(sys.stdin).get('permissions', [])))
")"
  CLAIM_BRANCH="$(jwt_claims "$ADMIN_TOKEN" | python3 -c "
import sys, json; print(json.load(sys.stdin).get('branch_id', ''))
")"

  assert_contains "$CLAIM_ROLES" 'OWNER' "the issued token's roles claim names OWNER"
  if [[ "$CLAIM_PERMS" -gt 0 ]]; then
    echo "PASS: the issued token carries a non-empty permissions claim (${CLAIM_PERMS} codes)"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: the issued token's permissions claim is EMPTY — the hallmark of an unvalidated role code"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi
  assert_status "$BRANCH_ID" "$CLAIM_BRANCH" "the token's branch is the branch the admin was provisioned against"

  # The token is not merely well-formed: it opens a real permission-gated door. /api/v1/branches is
  # gated on branch.manage, which OWNER holds — so a 200 exercises the permissions the role actually
  # granted, rather than only proving the signature verifies.
  #
  # Deliberately NOT /api/v1/users/me: that path is not a route at all, it matches
  # /api/v1/users/{userId} and 400s on parsing "me" as a UUID. A 400 satisfies "not 401/403" while
  # proving nothing about authorization, which is the shape of assertion this phase exists to stop
  # trusting.
  BRANCHES_STATUS="$(curl_status "${GATEWAY}/api/v1/branches" -H "Authorization: Bearer ${ADMIN_TOKEN}")"
  assert_status 200 "$BRANCHES_STATUS" "the admin's token opens a branch.manage-gated endpoint"
fi

# ── 5. D-13: a misspelled role code is rejected and leaves nothing behind ────────────────────

BADROLE_BODY="$(json "{\"email\":\"${BADROLE_EMAIL}\",\"branchId\":\"${BRANCH_ID}\",\"roleCode\":\"OWNERR\",\"fullName\":\"Typo Squatter\"}")"
BADROLE_STATUS="$(auth_internal_status "/internal/auth/tenants/${TENANT_ID}/provision-admin" "$BADROLE_BODY")"
BADROLE_RESPONSE="$(auth_internal_post "/internal/auth/tenants/${TENANT_ID}/provision-admin" "$BADROLE_BODY")"

assert_status 400 "$BADROLE_STATUS" "a misspelled role code is rejected"
assert_contains "$BADROLE_RESPONSE" 'OWNERR' "the rejection names the offending code"

BADROLE_ROWS="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM users WHERE email = '${BADROLE_EMAIL}';
" | auth_sql | tail -1)"
assert_status 0 "$BADROLE_ROWS" "the rejected provisioning left no user row behind"

# And the same conclusion reached the way a user would reach it.
BADROLE_LOGIN_BODY="$(json "{\"email\":\"${BADROLE_EMAIL}\",\"password\":\"${TEMP_PASSWORD}\",\"tenantSlug\":\"${TENANT_SLUG}\"}")"
BADROLE_LOGIN_STATUS="$(curl_status -X POST "${GATEWAY}/api/v1/auth/login" \
  -H "Content-Type: application/json" -d "$BADROLE_LOGIN_BODY")"
assert_status 401 "$BADROLE_LOGIN_STATUS" "no login exists for the rejected admin"

# ── 6. The seam stays internal ───────────────────────────────────────────────────────────────

GW_REGISTER_STATUS="$(curl_status -X POST "${GATEWAY}/internal/auth/tenants" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Service: ${INTERNAL_SECRET}" -d "$REGISTER_BODY")"
assert_status 404 "$GW_REGISTER_STATUS" "the tenant-register endpoint is unroutable through the gateway"

NOSECRET_BODY="$(json "{\"tenantId\":\"${TENANT_ID}\",\"slug\":\"${TENANT_SLUG}\",\"name\":\"No Secret\"}")"
NOSECRET_STATUS="$(curl_status -X POST "${AUTH_ORIGIN}/internal/auth/tenants" \
  -H "Content-Type: application/json" -d "$NOSECRET_BODY")"
assert_status 403 "$NOSECRET_STATUS" "the internal secret is the whole of the authorization"

echo
phase13_summary
