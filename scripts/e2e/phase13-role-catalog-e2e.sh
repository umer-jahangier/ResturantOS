#!/usr/bin/env bash
# Phase 13-07 — the role and permission catalog, proved over live HTTP through the real gateway.
#
# WHY THIS EXISTS (D-30). Phase 3's verification scored 24/24 while citing a controller that does
# not exist, because it grepped source. A catalog is the worst possible fit for structural
# verification: a catalog that is right, one that advertises a code assignment refuses, and one that
# publishes a role the caller must never be offered are indistinguishable in a diff, all start
# cleanly, and differ only in what a real request gets back.
#
# WHAT IT PROVES
#   1. Both endpoints are reachable THROUGH THE GATEWAY, 401 without a token and 403 for an
#      authenticated caller holding neither administration code.
#   2. The catalog reflects the database: it carries the WAITER role plan 13-02 seeded, with the
#      order-taking codes 13-02 granted it, and every code it attaches to a role is present in the
#      permission catalog.
#   3. The D-13/D-14 pairing: EVERY role code the catalog advertises is accepted by assignment.
#      A catalog that advertises a code the validator refuses is worse than no catalog.
#   4. The ceiling: OWNER is withheld from a TENANT_ADMIN, because OWNER holds rbac.manage and
#      TENANT_ADMIN deliberately does not (13-02, D-23).
#   5. Tenant isolation: a neighbouring tenant's role is in the table and not in the response.
#
# WHAT IT LEAVES RED, DELIBERATELY (see 13-07-SUMMARY)
#   A. A TENANT_ADMIN can still ASSIGN OWNER through the public door. The catalog withholds it; the
#      write path does not check. Closing that changes an internal cross-service contract 13-06 has
#      just published for 13-10, so it is measured here rather than smuggled in.
#   B. 13-06's 400 UNKNOWN_ROLE_CODE arrives at the client as a 500. It is correct on the internal
#      endpoint and lost by user-service's Feign, which has no ErrorDecoder.
#
# PRECONDITIONS
#   - Docker infra up; gateway, auth-service and user-service running and Eureka-registered.
#   - auth-service and gateway must be running jars built AFTER this plan. Against a stale jar the
#     catalog assertions 404 and the escalation probe cannot run at all.
#   - The demo tenant (a0000001-…) and its HQ branch (b0000001-…) exist — auth-service Liquibase,
#     context=seed.
#
# Usage: bash scripts/e2e/phase13-role-catalog-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

TENANT_ID="a0000001-0000-4000-8000-000000000001"
TENANT_SLUG="demo"
BRANCH_ID="b0000001-0000-4000-8000-000000000001"

# A tenant that is NOT the one under test. Only ever gets a `roles` row, never a user, so it needs
# no auth_tenants row and can never be logged into.
NEIGHBOUR_TENANT_ID="a0000099-0000-4000-8000-000000000099"
NEIGHBOUR_ROLE_ID="d0000099-0000-4000-8000-000000000099"
NEIGHBOUR_ROLE_CODE="NEIGHBOUR_ONLY"

# Reused verbatim from the seeded cashier row: bcrypt(12) of 'Cashier#2026'. Same constant 13-02's
# script uses, and for the same reason — bcrypt is not in the shell, and adding a python dependency
# to a verification script is how it stops being runnable on the machine that needs it most.
PROBE_PASSWORD='Cashier#2026'
PROBE_PASSWORD_HASH='$2a$12$HvDkD2g7oob7I/NXk3Oo/u6lcPoOVcBVa.Tb.dgQgCoiCua/fkII6'

# The tenant-admin and waiter personas are 13-02's, addressed by the SAME deterministic uuid5 paths,
# so this script re-uses those rows rather than creating a parallel set that would drift from them.
WAITER_EMAIL="e2e-waiter@demo.local"
TADMIN_EMAIL="e2e-tenantadmin@demo.local"
# The disposable assignment target. Never logs in; exists only to be assigned to.
TARGET_EMAIL="e2e-catalog-target@demo.local"

uuid5_for() {
  python3 -c "
import uuid, sys
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), sys.argv[1]))
" "$1"
}
WAITER_ID="$(uuid5_for "restaurantos/tenant/${TENANT_SLUG}/user/e2e-waiter")"
TADMIN_ID="$(uuid5_for "restaurantos/tenant/${TENANT_SLUG}/user/e2e-tenant-admin")"
TARGET_ID="$(uuid5_for "restaurantos/tenant/${TENANT_SLUG}/user/e2e-catalog-target")"

auth_sql() {
  docker exec -i restaurantos-postgres psql -U auth_user -d auth_db -v ON_ERROR_STOP=1 -qtA
}

# ── Cleanup, in a trap AND before starting ──────────────────────────────────────────────────
#
# Before as well as after: a run killed between steps would otherwise leave the target user and the
# neighbour role behind, and the next run's "already exists" would look like a defect in the code
# under test rather than in this script's housekeeping.
cleanup() {
  local code=$?
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    DELETE FROM user_branch_roles WHERE user_id = '${TARGET_ID}';
    DELETE FROM refresh_sessions  WHERE user_id = '${TARGET_ID}';
    DELETE FROM password_history  WHERE user_id = '${TARGET_ID}';
    -- 13-08 gave password_reset_tokens a second purpose and it has an FK to users; without this
    -- the users DELETE aborts on fk_password_reset_tokens_user and leaves the target behind.
    DELETE FROM password_reset_tokens WHERE user_id = '${TARGET_ID}';
    DELETE FROM users             WHERE id      = '${TARGET_ID}';
  " | auth_sql > /dev/null 2>&1 || true
  # The neighbour role lives under a different tenant, so its DELETE needs that tenant's GUC —
  # `roles` is FORCE ROW LEVEL SECURITY and auth_user is NOSUPERUSER NOBYPASSRLS, so without it the
  # DELETE matches zero rows and reports success.
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${NEIGHBOUR_TENANT_ID}', false);
    DELETE FROM roles WHERE id = '${NEIGHBOUR_ROLE_ID}';
  " | auth_sql > /dev/null 2>&1 || true
  exit $code
}
trap cleanup EXIT

printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  DELETE FROM user_branch_roles WHERE user_id = '${TARGET_ID}';
  DELETE FROM password_reset_tokens WHERE user_id = '${TARGET_ID}';
  DELETE FROM users WHERE id = '${TARGET_ID}';
" | auth_sql > /dev/null
printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${NEIGHBOUR_TENANT_ID}', false);
  DELETE FROM roles WHERE id = '${NEIGHBOUR_ROLE_ID}';
" | auth_sql > /dev/null

# ── Helpers ─────────────────────────────────────────────────────────────────────────────────

# Build a flat JSON object from key/value ARGUMENTS. There is no brace anywhere in the call site,
# which is the point.
#
# 13-02 documented that `-d "{\"a\":1,\"b\":2}"` written inline inside "$( … )" is brace-expanded
# into two malformed fragments and runs curl twice. Its remedy was "build the body in a variable
# first" — and that is not sufficient, which this script found the hard way. Inside `"$( … )"` the
# substitution's contents are re-parsed AFTER the backslashes are stripped, so
# `X="$(json "{\"a\":\"1\",\"b\":\"2\"}")"` hands `json` a string whose quotes have already been
# consumed, leaving the braces and the comma bare and expanding them again. The first run of this
# script produced three JSONDecodeErrors and `curl: option : blank argument` from exactly that.
#
# Passing values as separate argv entries removes the failure mode rather than tiptoeing around it,
# and it also means a persona email or password containing a quote could never break the body.
json_obj() {
  python3 -c "
import json, sys
a = sys.argv[1:]
print(json.dumps(dict(zip(a[0::2], a[1::2]))))
" "$@"
}

# TOTP in pure stdlib. pyotp is not installed on this machine's python3 and T-13-07-SC forbids
# installing a package to make a verification script run. Parameters match dev.samstevens.totp's
# defaults, which is what auth-service verifies against: SHA1, 6 digits, 30s.
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

seed_persona() {
  local user_id="$1" email="$2" full_name="$3"
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, locale, totp_enabled, is_active)
    VALUES ('${user_id}', '${TENANT_ID}', '${email}', '${PROBE_PASSWORD_HASH}', '${full_name}', 'en', false, true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                   is_active = true,
                                   failed_login_count = 0,
                                   locked_until = NULL;
  " | auth_sql > /dev/null
}

# Clear an enrolled factor so this script can enrol its own over the PUBLIC bootstrap endpoints.
#
# 13-02's script needed `python3 scripts/generate_totp.py <email> --enroll` run by hand first, and
# skipped its administration assertions when that had not happened — a verification script whose
# most important assertions silently do not run. auth-service refuses /2fa/bootstrap once a secret
# exists (correctly), so the only way to make this self-contained is to clear the throwaway dev
# persona's factor first. Nothing about the step-up rule is weakened: the persona still has to
# enrol and still has to present a code.
clear_factor() {
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = '${1}';
  " | auth_sql > /dev/null
}

# 13-11 made X-Acting-User-Id REQUIRED on this path: auth-service bounds what a request may grant
# by the ACTING user's own permissions, which is how the escalation THIS SCRIPT measured — a
# TENANT_ADMIN assigning OWNER and getting 200 — is now closed at the door rather than only in the
# picker. The seeding below is system work, so it acts as the tenant's OWNER, who holds the whole
# catalogue and can legitimately grant any of these roles.
SEED_ACTING_USER_ID="c0000002-0000-4000-8000-000000000002"

# Assign through auth-service's internal endpoint — the system of record, and the door 13-02 uses.
assign_internal() {
  local user_id="$1" role_code="$2" body
  body="$(json_obj branchId "$BRANCH_ID" roleCode "$role_code")"
  curl_retry -X POST "${AUTH_ORIGIN}/internal/auth/users/${user_id}/branch-roles" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H "X-Acting-User-Id: ${SEED_ACTING_USER_ID}" \
    -d "$body"
}

assign_internal_status() {
  local user_id="$1" role_code="$2" body
  body="$(json_obj branchId "$BRANCH_ID" roleCode "$role_code")"
  curl_status -X POST "${AUTH_ORIGIN}/internal/auth/users/${user_id}/branch-roles" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H "X-Acting-User-Id: ${SEED_ACTING_USER_ID}" \
    -d "$body"
}

# Assign through the PUBLIC door with a real caller's token — what a role picker actually does.
assign_public_status() {
  local token="$1" user_id="$2" role_code="$3" body
  body="$(json_obj branchId "$BRANCH_ID" roleCode "$role_code")"
  curl_status -X POST "${GATEWAY}/api/v1/users/${user_id}/branch-roles" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d "$body"
}

# "The request reached the service and was answered on its merits." assert_not_status alone is not
# enough: a gateway 503 is not a 403, so it once PASSED an authorization assertion for a request
# that never arrived (13-02).
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

# Enrol a factor over the public bootstrap endpoints and return a stepped-up access token.
stepped_up_token() {
  local email="$1" secret uri bootstrap_body verify_body
  bootstrap_body="$(json_obj email "$email" password "$PROBE_PASSWORD" tenantSlug "$TENANT_SLUG")"
  uri="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/2fa/bootstrap" \
      -H "Content-Type: application/json" -d "$bootstrap_body" \
      | json_get "['data']['otpauthUri']" 2>/dev/null || true)"
  if [[ -z "$uri" || "$uri" == "None" ]]; then
    echo "stepped_up_token: no otpauth uri for ${email}" >&2
    return 1
  fi
  secret="$(printf '%s' "$uri" | python3 -c "
import sys, urllib.parse as u
print(u.parse_qs(u.urlparse(sys.stdin.read().strip()).query)['secret'][0])
")"
  verify_body="$(json_obj email "$email" password "$PROBE_PASSWORD" \
                          tenantSlug "$TENANT_SLUG" code "$(totp_now "$secret")")"
  curl_status -X POST "${GATEWAY}/api/v1/auth/2fa/bootstrap/verify" \
    -H "Content-Type: application/json" -d "$verify_body" > /dev/null
  tenant_login "$email" "$PROBE_PASSWORD" "$TENANT_SLUG" "$(totp_now "$secret")"
}

echo "=== Phase 13-07: the role and permission catalog, over live HTTP ==="
echo "gateway=${GATEWAY}  auth=${AUTH_ORIGIN}  tenant=${TENANT_SLUG}"
echo

# ── Setup ───────────────────────────────────────────────────────────────────────────────────

seed_persona "$WAITER_ID" "$WAITER_EMAIL" "E2E Waiter"
seed_persona "$TADMIN_ID" "$TADMIN_EMAIL" "E2E Tenant Admin"
seed_persona "$TARGET_ID" "$TARGET_EMAIL" "E2E Catalog Target"
assign_internal "$WAITER_ID" "WAITER"       > /dev/null
assign_internal "$TADMIN_ID" "TENANT_ADMIN" > /dev/null
assign_internal "$TARGET_ID" "CASHIER"      > /dev/null
clear_factor "$TADMIN_ID"

# The neighbouring tenant's role. Written with the NEIGHBOUR's GUC, because `roles` is FORCE ROW
# LEVEL SECURITY and auth_user is NOSUPERUSER NOBYPASSRLS — without it the INSERT is rejected, and
# the isolation assertion below would then be proving nothing at all.
printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${NEIGHBOUR_TENANT_ID}', false);
  INSERT INTO roles (id, tenant_id, code, name, is_system)
  VALUES ('${NEIGHBOUR_ROLE_ID}', '${NEIGHBOUR_TENANT_ID}', '${NEIGHBOUR_ROLE_CODE}', 'Neighbour Only', false);
" | auth_sql > /dev/null

echo "Seeded: tenant-admin=${TADMIN_ID}  waiter=${WAITER_ID}  target=${TARGET_ID}"
echo

TADMIN_TOKEN="$(stepped_up_token "$TADMIN_EMAIL")"
WAITER_TOKEN="$(tenant_login "$WAITER_EMAIL" "$PROBE_PASSWORD" "$TENANT_SLUG")"
echo "Tokens obtained (tenant admin enrolled a factor over the public bootstrap endpoints — D-29a)."
echo

# errexit is deliberately dropped from here down: the assert_* helpers return 1 on failure, so under
# `set -e` this would die at the first failure and silently skip every assertion after it — which is
# exactly what happened on 13-02's first run. Setup above stays under errexit. The exit code comes
# from phase13_summary.
set +e

# ── 1. Reachability and the gate ─────────────────────────────────────────────────────────────

assert_status 401 "$(curl_status "${GATEWAY}/api/v1/roles")" \
  "role catalog refuses an anonymous request"
assert_status 401 "$(curl_status "${GATEWAY}/api/v1/permissions")" \
  "permission catalog refuses an anonymous request"

assert_status 403 "$(curl_status "${GATEWAY}/api/v1/roles" -H "Authorization: Bearer ${WAITER_TOKEN}")" \
  "role catalog refuses a waiter (holds neither administration code)"
assert_status 403 "$(curl_status "${GATEWAY}/api/v1/permissions" -H "Authorization: Bearer ${WAITER_TOKEN}")" \
  "permission catalog refuses a waiter"

ROLES_STATUS="$(curl_status "${GATEWAY}/api/v1/roles" -H "Authorization: Bearer ${TADMIN_TOKEN}")"
PERMS_STATUS="$(curl_status "${GATEWAY}/api/v1/permissions" -H "Authorization: Bearer ${TADMIN_TOKEN}")"
assert_status 200 "$ROLES_STATUS" "tenant admin reads the role catalog THROUGH THE GATEWAY"
assert_status 200 "$PERMS_STATUS" "tenant admin reads the permission catalog THROUGH THE GATEWAY"

ROLES_BODY="$(curl_retry "${GATEWAY}/api/v1/roles" -H "Authorization: Bearer ${TADMIN_TOKEN}")"
PERMS_BODY="$(curl_retry "${GATEWAY}/api/v1/permissions" -H "Authorization: Bearer ${TADMIN_TOKEN}")"
echo

# ── 2. The catalog is the database ───────────────────────────────────────────────────────────

ROLE_CODES="$(printf '%s' "$ROLES_BODY" | python3 -c "
import sys, json
print('\n'.join(r['code'] for r in json.load(sys.stdin)['data']))
" 2>/dev/null || true)"

if [[ -z "$ROLE_CODES" ]]; then
  echo "FAIL: the role catalog returned no codes at all: ${ROLES_BODY}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "Catalog advertises: $(printf '%s' "$ROLE_CODES" | tr '\n' ' ')"
  PHASE13_PASS=$((PHASE13_PASS + 1))
  echo "PASS: the role catalog is non-empty"
fi

# WAITER exists only because changeset 055 inserted it. No source file in auth-service names it, so
# a catalog assembled from a list in code could not answer this.
assert_contains "$ROLE_CODES" 'WAITER' "the catalog carries the role plan 13-02 seeded"

WAITER_CATALOG_PERMS="$(printf '%s' "$ROLES_BODY" | python3 -c "
import sys, json
for r in json.load(sys.stdin)['data']:
    if r['code'] == 'WAITER':
        print('\n'.join(r['permissions']))
" 2>/dev/null || true)"
for code in pos.order.create pos.order.update pos.order.view pos.order.send_to_kds; do
  assert_contains "$WAITER_CATALOG_PERMS" "$code" "the catalog reports WAITER's ${code}"
done

# ── 3. The permission catalog, and its closure over the role catalog ─────────────────────────

MODULE_CHECK="$(printf '%s' "$PERMS_BODY" | python3 -c "
import sys, json
mods = json.load(sys.stdin)['data']
assert mods, 'empty'
names = [m['module'] for m in mods]
assert names == sorted(names), 'modules not sorted'
assert len(names) == len(set(names)), 'a module appears twice'
for m in mods:
    assert m['permissions'], 'module %s is empty' % m['module']
    codes = [p['code'] for p in m['permissions']]
    assert codes == sorted(codes), 'codes not sorted in %s' % m['module']
    for p in m['permissions']:
        assert p['module'] == m['module'], 'permission filed under the wrong module'
print('OK %d modules %d codes' % (len(mods), sum(len(m['permissions']) for m in mods)))
" 2>&1 || true)"
if [[ "$MODULE_CHECK" == OK* ]]; then
  echo "PASS: the permission catalog is grouped by module, sorted and non-empty (${MODULE_CHECK#OK })"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: permission catalog shape — ${MODULE_CHECK}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

# Every code the role catalog attaches to a role must exist in the permission catalog. This is the
# live counterpart of PermissionCatalogClosureTest, and it is what would catch a role holding a
# grant for a permission row that no longer exists — the pos.order.void.own shape (049).
CLOSURE="$(python3 -c "
import sys, json
roles = json.loads(sys.argv[1])['data']
mods  = json.loads(sys.argv[2])['data']
vocab = {p['code'] for m in mods for p in m['permissions']}
used  = {c for r in roles for c in r['permissions']}
missing = sorted(used - vocab)
print('OK' if not missing else 'MISSING ' + ' '.join(missing))
" "$ROLES_BODY" "$PERMS_BODY" 2>&1 || true)"
if [[ "$CLOSURE" == "OK" ]]; then
  echo "PASS: every code the role catalog uses exists in the permission catalog"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: the role catalog names codes the permission catalog does not define — ${CLOSURE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi
echo

# ── 4. D-13/D-14: every advertised code is accepted by assignment ────────────────────────────

echo "--- assigning every advertised role code to the disposable user ---"
while IFS= read -r role_code; do
  [[ -z "$role_code" ]] && continue
  status="$(assign_public_status "$TADMIN_TOKEN" "$TARGET_ID" "$role_code")"
  assert_authorized "$status" "the catalog's ${role_code} is accepted by assignment"
done <<< "$ROLE_CODES"

# The other half: a code the catalog does not return, and that exists nowhere, must be refused.
# Both doors are measured, because they do not agree.
assert_status 400 "$(assign_internal_status "$TARGET_ID" "NOT_A_REAL_ROLE")" \
  "an unknown role code is 400 UNKNOWN_ROLE_CODE on the internal endpoint (13-06's D-13)"

PUBLIC_UNKNOWN="$(assign_public_status "$TADMIN_TOKEN" "$TARGET_ID" "NOT_A_REAL_ROLE")"
if [[ "$PUBLIC_UNKNOWN" == "400" ]]; then
  echo "PASS: an unknown role code is 400 through the public door too"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: an unknown role code arrives at the client as ${PUBLIC_UNKNOWN}, not 400."
  echo "      auth-service answers 400 UNKNOWN_ROLE_CODE (asserted above); user-service's Feign"
  echo "      client has no ErrorDecoder, so FeignException.BadRequest falls through to the generic"
  echo "      handler and a role picker cannot distinguish 'you chose a bad role' from 'the platform"
  echo "      broke'. Fix belongs with 13-12's public user API, not here. See 13-07-SUMMARY."
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi
echo

# ── 5. The ceiling ───────────────────────────────────────────────────────────────────────────

if printf '%s' "$ROLE_CODES" | grep -qx 'OWNER'; then
  echo "FAIL: the catalog offers OWNER to a TENANT_ADMIN — the ceiling check has been removed."
  echo "      OWNER holds rbac.manage and TENANT_ADMIN deliberately does not (13-02, D-23), so"
  echo "      offering it turns the role picker into a privilege-escalation control."
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: the catalog withholds OWNER from a TENANT_ADMIN (above its ceiling)"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

WITHHELD="$(printf '%s' "$ROLES_BODY" | python3 -c "
import sys, json
w = json.load(sys.stdin).get('warnings') or []
print(w[0]['code'] if w else '')
" 2>/dev/null || true)"
assert_contains "$WITHHELD" 'ROLES_WITHHELD_ABOVE_CEILING' \
  "the response says how many roles it withheld, rather than them silently vanishing"

# The escalation the catalog cannot close on its own.
OWNER_ASSIGN="$(assign_public_status "$TADMIN_TOKEN" "$TARGET_ID" "OWNER")"
if [[ "$OWNER_ASSIGN" == "403" ]]; then
  echo "PASS: a TENANT_ADMIN is refused ASSIGNING OWNER (${OWNER_ASSIGN})"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: a TENANT_ADMIN ASSIGNED OWNER through the public door and got ${OWNER_ASSIGN}."
  echo "      The catalog withholds the role; the write path does not check. A tenant admin can"
  echo "      therefore grant OWNER to an account it controls, log in as it, and hold rbac.manage —"
  echo "      the permission 13-02's authority split exists to withhold from it."
  echo "      The check needs the CALLER's permission set (only user-service has it) and the TARGET"
  echo "      ROLE's (only auth-service has it), so closing it means propagating caller identity"
  echo "      across the /internal/auth/** seam that 13-06 has just published for 13-10 — a"
  echo "      breaking change to a cross-service contract, i.e. a deviation Rule 4 decision."
  echo "      Reported, not made. See 13-07-SUMMARY."
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi
echo

# ── 6. Tenant isolation ──────────────────────────────────────────────────────────────────────

# The control. Without it, "the neighbour's role is absent" is satisfied by the row never having
# been written — which, given `roles` is FORCE RLS and auth_user cannot bypass it, is a real risk.
NEIGHBOUR_ROWS="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${NEIGHBOUR_TENANT_ID}', false);
  SELECT count(*) FROM roles WHERE id = '${NEIGHBOUR_ROLE_ID}';
" | auth_sql | tail -1)"
assert_status 1 "$NEIGHBOUR_ROWS" "the neighbouring tenant's role really is in the roles table"

if printf '%s' "$ROLE_CODES" | grep -qx "$NEIGHBOUR_ROLE_CODE"; then
  echo "FAIL: the catalog returned another tenant's role (${NEIGHBOUR_ROLE_CODE})"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: the catalog never returns another tenant's role"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi
echo

phase13_summary
