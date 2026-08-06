#!/usr/bin/env bash
# Phase 13-11 — the user lifecycle, proved against the running stack (D-30).
#
# WHY THIS EXISTS. Blocker B3 is "a tenant cannot onboard a single cashier". The only honest proof
# of the opposite is to create one and then have that person USE the product: a create endpoint that
# returns 201 and yields an account nobody can log into is exactly the failure B2 already was, and it
# is invisible to any test that stops at the write. So the spine of this script is one chain —
# create -> forced change -> login -> a token naming the assigned role with a non-empty permission
# list — and everything else hangs off it.
#
# It also proves the two things auth-service ITs structurally CANNOT:
#   * row-level security. Testcontainers' Postgres user is a SUPERUSER, so the tenant_isolation
#     policy on `users` is inert in every integration test in this repository. Here the writes go
#     through a service whose Liquibase and runtime both run as auth_user (NOSUPERUSER
#     NOBYPASSRLS), so a missing tenant GUC is a 500 and not a silent pass.
#   * the role ceiling over a real network hop, including the escalation 13-07 measured open:
#     a caller assigning OWNER without the authority to hold it.
#
# PRECONDITIONS
#   - Docker infra up; gateway and auth-service running, on jars built AFTER plan 13-11.
#   - The demo tenant (a0000001-…) and its HQ branch (b0000001-…) exist (Liquibase, context=seed).
#
# Usage: bash scripts/e2e/phase13-user-lifecycle-e2e.sh
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

TENANT_ID="a0000001-0000-4000-8000-000000000001"
TENANT_SLUG="demo"
BRANCH_ID="b0000001-0000-4000-8000-000000000001"

# The tenant's seeded OWNER. Acts as the administrator throughout: 13-11 requires every lifecycle
# WRITE to name the human on whose behalf it is made, and bounds what that write may grant by that
# human's own permissions. OWNER holds the whole catalogue (changeset 057), so an owner is the
# persona a real tenant administrator most closely resembles.
OWNER_ID="c0000002-0000-4000-8000-000000000002"
# A deliberately under-privileged actor, for the escalation probes.
CASHIER_ID="c0000001-0000-4000-8000-000000000001"

# A tenant that is NOT the one under test. Gets one user row and nothing else.
NEIGHBOUR_TENANT_ID="a0000098-0000-4000-8000-000000000098"

NEW_PASSWORD='Cashier#2026x'

auth_sql() {
  docker exec -i restaurantos-postgres psql -U auth_user -d auth_db -v ON_ERROR_STOP=1 -qtA
}

# Build a flat JSON object from key/value ARGUMENTS. No brace appears at any call site, which is
# the point: bash brace-expands `-d "{\"a\":1,\"b\":2}"` into two malformed fragments and runs curl
# TWICE (13-02), and re-parses escaped quotes away inside "$( … )" (13-07). Both failures report a
# confident wrong answer rather than an error.
json_obj() {
  python3 -c "
import json, sys
a = sys.argv[1:]
print(json.dumps(dict(zip(a[0::2], a[1::2]))))
" "$@"
}

uuid5_for() {
  python3 -c "
import uuid, sys
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), sys.argv[1]))
" "$1"
}

# Deterministic ids and addresses, so a killed run leaves rows this script can find and remove
# rather than an accumulating pile of random ones.
CASHIER_EMAIL="e2e-lifecycle-cashier@demo.local"
SECOND_EMAIL="e2e-lifecycle-second@demo.local"
BADROLE_EMAIL="e2e-lifecycle-badrole@demo.local"
NOBRANCH_EMAIL="e2e-lifecycle-nobranch@demo.local"
ESCALATE_EMAIL="e2e-lifecycle-escalate@demo.local"
NEIGHBOUR_EMAIL="e2e-lifecycle-neighbour@other.local"
NEIGHBOUR_ID="$(uuid5_for "restaurantos/tenant/other/user/e2e-lifecycle-neighbour")"

# ── Cleanup, in a trap AND before starting ──────────────────────────────────────────────────
#
# Before as well as after: a run killed midway would otherwise leave rows behind, and the next
# run's "email already exists" would look like a defect in the code under test rather than in this
# script's housekeeping.
purge_tenant_users() {
  local tenant="$1"; shift
  local emails="" e
  for e in "$@"; do emails="${emails}${emails:+,}'${e}'"; done
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${tenant}', false);
    DELETE FROM user_branch_roles     WHERE user_id IN (SELECT id FROM users WHERE email IN (${emails}));
    DELETE FROM refresh_sessions      WHERE user_id IN (SELECT id FROM users WHERE email IN (${emails}));
    DELETE FROM password_history      WHERE user_id IN (SELECT id FROM users WHERE email IN (${emails}));
    DELETE FROM password_reset_tokens WHERE user_id IN (SELECT id FROM users WHERE email IN (${emails}));
    DELETE FROM users                 WHERE email IN (${emails});
  " | auth_sql > /dev/null 2>&1 || true
}

purge_all() {
  purge_tenant_users "$TENANT_ID" "$CASHIER_EMAIL" "$SECOND_EMAIL" "$BADROLE_EMAIL" \
    "$NOBRANCH_EMAIL" "$ESCALATE_EMAIL"
  purge_tenant_users "$NEIGHBOUR_TENANT_ID" "$NEIGHBOUR_EMAIL"
}

cleanup() {
  local code=$?
  purge_all
  exit $code
}
trap cleanup EXIT
purge_all

# ── HTTP helpers ────────────────────────────────────────────────────────────────────────────
#
# /internal/auth/** is deliberately UNROUTED at the gateway — the shared secret is the whole of the
# authorization there — so these go straight to auth-service's own port. Everything a real END USER
# does (login, forced change, using the token) goes through ${GATEWAY}, because proving something
# against a service's own port proves nothing about whether a client can reach it, which is the
# exact gap blocker B1 lived in.

lc_post() {   # lc_post <path> <acting-user-id|-> [body]
  local path="$1" acting="$2" body="${3:-{\}}"
  local args=(-X POST "${AUTH_ORIGIN}${path}"
              -H "Content-Type: application/json"
              -H "X-Internal-Service: ${INTERNAL_SECRET}"
              -H "X-Tenant-Id: ${TENANT_ID}")
  [[ "$acting" != "-" ]] && args+=(-H "X-Acting-User-Id: ${acting}")
  curl_retry "${args[@]}" -d "$body"
}

lc_post_status() {
  local path="$1" acting="$2" body="${3:-{\}}"
  local args=(-X POST "${AUTH_ORIGIN}${path}"
              -H "Content-Type: application/json"
              -H "X-Internal-Service: ${INTERNAL_SECRET}"
              -H "X-Tenant-Id: ${TENANT_ID}")
  [[ "$acting" != "-" ]] && args+=(-H "X-Acting-User-Id: ${acting}")
  curl_status "${args[@]}" -d "$body"
}

lc_patch_status() {
  local path="$1" acting="$2" body="$3"
  curl_status -X PATCH "${AUTH_ORIGIN}${path}" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H "X-Acting-User-Id: ${acting}" \
    -d "$body"
}

lc_get() {    # lc_get <path> [tenant-id]
  curl_retry -X GET "${AUTH_ORIGIN}${1}" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${2:-$TENANT_ID}"
}

lc_get_status() {
  curl_status -X GET "${AUTH_ORIGIN}${1}" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${2:-$TENANT_ID}"
}

echo "=============================================================================="
echo " Phase 13-11 — user lifecycle, live"
echo "=============================================================================="
echo

# ── 0. The stack is really there ─────────────────────────────────────────────────────────────
#
# First, and unconditionally: every assertion below is about a status code, and a dead upstream
# produces status codes too.
assert_status 200 "$(curl_status "${AUTH_ORIGIN}/actuator/health")" "auth-service is up"
assert_status 200 "$(curl_status "${GATEWAY}/actuator/health")"    "the gateway is up"
assert_status 404 "$(curl_status "${GATEWAY}/internal/auth/users" -H "X-Tenant-Id: ${TENANT_ID}")" \
  "the gateway maps NO route to /internal/auth/** — the lifecycle is unreachable from outside"
assert_status 403 "$(curl_status -X GET "${AUTH_ORIGIN}/internal/auth/users" -H "X-Tenant-Id: ${TENANT_ID}")" \
  "and without the internal secret it is 403 INTERNAL_AUTH_REQUIRED"
echo

# ── 1. Create a cashier, and prove that cashier can actually use the product ─────────────────

CREATE_BODY="$(json_obj email "$CASHIER_EMAIL" fullName "E2E Lifecycle Cashier" \
  locale "en" branchId "$BRANCH_ID" roleCode "CASHIER")"
CREATED="$(lc_post /internal/auth/users "$OWNER_ID" "$CREATE_BODY")"

USER_ID="$(printf '%s' "$CREATED" | json_get "['data']['id']" 2>/dev/null || true)"
TEMP_PASSWORD="$(printf '%s' "$CREATED" | json_get "['data']['tempPassword']" 2>/dev/null || true)"

if [[ -z "$USER_ID" || "$USER_ID" == "None" ]]; then
  echo "FAIL: create returned no user id: ${CREATED}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  phase13_summary || exit 1
fi
echo "PASS: a cashier was created (${USER_ID})"
PHASE13_PASS=$((PHASE13_PASS + 1))

if [[ -n "$TEMP_PASSWORD" && "$TEMP_PASSWORD" != "None" && ${#TEMP_PASSWORD} -eq 16 ]]; then
  echo "PASS: a 16-character temporary password came back with it"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: no usable temporary password in the create response"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

assert_contains "$CREATED" '"mustChangePassword":true' \
  "the account is created with the forced-change flag set (D-12)"
assert_contains "$CREATED" 'CASHIER' "the requested role was assigned in the same transaction"

# The temp password exists in that response and nowhere else.
STORED_HASH="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT password_hash FROM users WHERE id = '${USER_ID}';
" | auth_sql | tail -1)"
if [[ "$STORED_HASH" == \$2* && "$STORED_HASH" != *"$TEMP_PASSWORD"* ]]; then
  echo "PASS: only a bcrypt hash is at rest — the temporary password is not stored"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: users.password_hash is not a bcrypt hash of a secret we do not hold"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

OUTBOX_LEAK="$(printf '%s\n' "
  SELECT count(*) FROM event_outbox WHERE envelope_json LIKE '%${TEMP_PASSWORD}%';
" | auth_sql | tail -1)"
assert_status 0 "$OUTBOX_LEAK" "and it is in no event payload"
echo

# The whole point of B3: the created person can use the product.
REFUSAL="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "$(json_obj email "$CASHIER_EMAIL" password "$TEMP_PASSWORD" tenantSlug "$TENANT_SLUG")")"
CHANGE_TOKEN="$(change_token_from "$REFUSAL" 2>/dev/null || true)"
if [[ -n "$CHANGE_TOKEN" ]]; then
  echo "PASS: the first login is refused with PASSWORD_CHANGE_REQUIRED and a change token (13-08)"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: the first login was not a forced-change refusal: ${REFUSAL}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

CHANGE_RESULT="$(forced_change "$CHANGE_TOKEN" "$TEMP_PASSWORD" "$NEW_PASSWORD" 2>/dev/null || true)"
assert_status 200 "$(printf '%s' "$CHANGE_RESULT" | head -1)" \
  "the temporary password satisfies the platform's own strength rule and can be changed"

TOKEN="$(tenant_login "$CASHIER_EMAIL" "$NEW_PASSWORD" "$TENANT_SLUG" 2>/dev/null || true)"
if [[ -n "$TOKEN" ]]; then
  echo "PASS: and then the cashier logs in normally — blocker B3's chain, end to end"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: the created cashier could not log in after changing their password"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

if [[ -n "$TOKEN" ]]; then
  CLAIMS="$(jwt_claims "$TOKEN")"
  assert_contains "$CLAIMS" 'CASHIER' "the token names the role that was assigned at creation"
  PERM_COUNT="$(printf '%s' "$CLAIMS" | python3 -c "
import sys, json
print(len(json.load(sys.stdin).get('permissions', [])))
")"
  if [[ "$PERM_COUNT" -gt 0 ]]; then
    echo "PASS: and carries ${PERM_COUNT} permission codes — not the empty set an unvalidated role gives"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: the token carries no permissions — a working login into a product with no screens"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi
fi
echo

# ── 2. List, page, search ────────────────────────────────────────────────────────────────────

LIST="$(lc_get "/internal/auth/users?size=200")"
assert_contains "$LIST" "$CASHIER_EMAIL" "the new cashier appears in the tenant's user list"

TOTAL="$(printf '%s' "$LIST" | json_get "['meta']['totalCount']" 2>/dev/null || echo 0)"
if [[ "$TOTAL" -gt 0 ]]; then
  echo "PASS: the list carries a total count (${TOTAL})"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: no totalCount in the list envelope"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

PAGE0="$(lc_get "/internal/auth/users?page=0&size=2" | python3 -c "
import sys, json
print(','.join(sorted(u['email'] for u in json.load(sys.stdin)['data'])))
")"
PAGE1="$(lc_get "/internal/auth/users?page=1&size=2" | python3 -c "
import sys, json
print(','.join(sorted(u['email'] for u in json.load(sys.stdin)['data'])))
")"
if [[ -n "$PAGE0" && "$PAGE0" != "$PAGE1" ]]; then
  echo "PASS: a second page returns different rows (page 0: ${PAGE0} | page 1: ${PAGE1})"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: pages 0 and 1 returned the same rows — pagination is decorative"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

SEARCH="$(lc_get "/internal/auth/users?size=200&search=lifecycle-cashier")"
assert_contains "$SEARCH" "$CASHIER_EMAIL" "search finds the cashier by a fragment of their address"
SEARCH_HITS="$(printf '%s' "$SEARCH" | python3 -c "
import sys, json
print(len(json.load(sys.stdin)['data']))
")"
assert_status 1 "$SEARCH_HITS" "and the search really narrows — one row, not the whole list"
echo

# ── 3. Deactivate, and prove access is actually gone ─────────────────────────────────────────
#
# users.is_active has existed since changeset 020 and login never read it, so before 13-11
# deactivating a user did nothing at all to their ability to log in. This is the assertion that
# would have caught that, and it needs the control above it: the same credentials worked a moment
# ago, so the refusal is the flag rather than a mistyped password.

REFRESH_BEFORE="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM refresh_sessions WHERE user_id = '${USER_ID}' AND revoked_at IS NULL;
" | auth_sql | tail -1)"

assert_status 200 "$(lc_post_status "/internal/auth/users/${USER_ID}/deactivate" "$OWNER_ID")" \
  "the cashier is deactivated"

LOGIN_AFTER="$(curl_status -X POST "${GATEWAY}/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "$(json_obj email "$CASHIER_EMAIL" password "$NEW_PASSWORD" tenantSlug "$TENANT_SLUG")")"
assert_status 401 "$LOGIN_AFTER" "a deactivated user cannot log in"

REFRESH_AFTER="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM refresh_sessions WHERE user_id = '${USER_ID}' AND revoked_at IS NULL;
" | auth_sql | tail -1)"
if [[ "$REFRESH_BEFORE" -gt 0 && "$REFRESH_AFTER" -eq 0 ]]; then
  echo "PASS: their live refresh sessions were revoked (${REFRESH_BEFORE} -> ${REFRESH_AFTER})"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: refresh sessions before=${REFRESH_BEFORE} after=${REFRESH_AFTER} — refusing new"
  echo "      logins while leaving a 30-day refresh token renewable is not removing access."
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

ROW_AND_ROLE="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT (SELECT count(*) FROM users WHERE id = '${USER_ID}')
       + (SELECT count(*) FROM user_branch_roles WHERE user_id = '${USER_ID}' AND is_active);
" | auth_sql | tail -1)"
assert_status 2 "$ROW_AND_ROLE" \
  "the row and its assignment both survive — never a hard delete, so audit and order references hold"

assert_status 200 "$(lc_post_status "/internal/auth/users/${USER_ID}/reactivate" "$OWNER_ID")" \
  "the cashier is reactivated"
RETOKEN="$(tenant_login "$CASHIER_EMAIL" "$NEW_PASSWORD" "$TENANT_SLUG" 2>/dev/null || true)"
if [[ -n "$RETOKEN" ]]; then
  echo "PASS: and access is restored — they log in again with the role they had"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: a reactivated user still cannot log in"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi
echo

# ── 4. The tenant boundary, against a database that really enforces RLS ──────────────────────
#
# The control matters more than usual here. `users` is FORCE ROW LEVEL SECURITY and auth_user is
# NOSUPERUSER NOBYPASSRLS, so an INSERT without the neighbour's own GUC is REFUSED — and then "the
# neighbour is not visible" would be satisfied by the row never having existed.

printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${NEIGHBOUR_TENANT_ID}', false);
  INSERT INTO users (id, tenant_id, email, password_hash, full_name, totp_enabled, is_active,
                     failed_login_count, created_at, updated_at, version, must_change_password)
  VALUES ('${NEIGHBOUR_ID}', '${NEIGHBOUR_TENANT_ID}', '${NEIGHBOUR_EMAIL}',
          '\$2a\$12\$notarealhashnotarealhashnotarealhashnotarealhash', 'Neighbour', false, true,
          0, now(), now(), 0, false)
  ON CONFLICT (id) DO NOTHING;
" | auth_sql > /dev/null

NEIGHBOUR_ROWS="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${NEIGHBOUR_TENANT_ID}', false);
  SELECT count(*) FROM users WHERE id = '${NEIGHBOUR_ID}';
" | auth_sql | tail -1)"
assert_status 1 "$NEIGHBOUR_ROWS" \
  "control: the neighbouring tenant's user really is in the users table"

assert_status 404 "$(lc_get_status "/internal/auth/users/${NEIGHBOUR_ID}")" \
  "fetching it as the demo tenant is NOT FOUND — not 403, which would confirm the id exists"

DEMO_LIST="$(lc_get "/internal/auth/users?size=200")"
if printf '%s' "$DEMO_LIST" | grep -q "$NEIGHBOUR_EMAIL"; then
  echo "FAIL: the demo tenant's user list contains another tenant's user"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: and it never appears in the demo tenant's list"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

NEIGHBOUR_LIST="$(lc_get "/internal/auth/users?size=200" "$NEIGHBOUR_TENANT_ID")"
assert_contains "$NEIGHBOUR_LIST" "$NEIGHBOUR_EMAIL" \
  "control: asked for the neighbour's OWN tenant the same endpoint does return it, so the two
   negatives above measure scoping rather than an absent fixture"
echo

# ── 5. The negatives ─────────────────────────────────────────────────────────────────────────

BADROLE="$(json_obj email "$BADROLE_EMAIL" fullName "Bad Role" branchId "$BRANCH_ID" \
  roleCode "NOT_A_REAL_ROLE")"
assert_status 400 "$(lc_post_status /internal/auth/users "$OWNER_ID" "$BADROLE")" \
  "an unknown role code is 400 UNKNOWN_ROLE_CODE (D-13)"
# Asserted as a COUNT rather than by grepping for an empty JSON array: `[]` is a bracket
# expression to grep, which matches nothing and reports "brackets not balanced" — a harness that
# fails for a reason unrelated to the code under test is worse than no assertion.
assert_status 0 "$(lc_get "/internal/auth/users?size=200&search=lifecycle-badrole" \
  | json_get "['meta']['totalCount']")" \
  "and it created nothing — checked by a subsequent list"

NOBRANCH="$(json_obj email "$NOBRANCH_EMAIL" fullName "No Branch" roleCode "CASHIER")"
assert_status 400 "$(lc_post_status /internal/auth/users "$OWNER_ID" "$NOBRANCH")" \
  "a role code with no branch id is 400 — an assignment-less account cannot log in"

# A password on create cannot be sent, because the request declares no such field. On UPDATE it is
# REFUSED rather than ignored: Jackson would otherwise drop the key and answer 200, leaving an
# administrator certain they had set a password the platform has never heard of.
WITH_PASSWORD="$(json_obj fullName "Renamed" password "Hunter#2026")"
assert_status 400 "$(lc_patch_status "/internal/auth/users/${USER_ID}" "$OWNER_ID" "$WITH_PASSWORD")" \
  "an update carrying a password field is REJECTED, not silently ignored"
UNCHANGED="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT full_name FROM users WHERE id = '${USER_ID}';
" | auth_sql | tail -1)"
assert_contains "$UNCHANGED" 'E2E Lifecycle Cashier' \
  "and nothing at all from that body was applied"

OK_PATCH="$(json_obj fullName "E2E Lifecycle Cashier" locale "ur-PK")"
assert_status 200 "$(lc_patch_status "/internal/auth/users/${USER_ID}" "$OWNER_ID" "$OK_PATCH")" \
  "control: an ordinary profile update still succeeds, so the refusal above is about passwords"
echo

# ── 6. The role ceiling, over a real network hop ─────────────────────────────────────────────
#
# THE ESCALATION 13-07 MEASURED AND LEFT OPEN. Before 13-11, this exact request — the shared secret,
# no identity of any kind, roleCode OWNER — was answered 200, and the account so created holds
# rbac.manage, which is precisely what 13-02's authority split exists to withhold from a tenant
# admin. /internal/auth/** carried no caller identity, so auth-service could not answer "may THIS
# person grant THAT role" and the check could only live in the calling service, where anything
# reaching the internal port bypasses it.

ASSIGN_OWNER="$(json_obj branchId "$BRANCH_ID" roleCode "OWNER")"

assert_status 403 "$(lc_post_status "/internal/auth/users/${USER_ID}/branch-roles" "-" "$ASSIGN_OWNER")" \
  "assigning OWNER with NO acting user is refused — an absent identity is a refusal, not a skipped check"

assert_status 403 "$(lc_post_status "/internal/auth/users/${USER_ID}/branch-roles" "$CASHIER_ID" "$ASSIGN_OWNER")" \
  "a caller below OWNER's ceiling is refused ROLE_CEILING_EXCEEDED when assigning OWNER"

CEILING_BODY="$(lc_post "/internal/auth/users/${USER_ID}/branch-roles" "$CASHIER_ID" "$ASSIGN_OWNER")"
assert_contains "$CEILING_BODY" 'ROLE_CEILING_EXCEEDED' "with a code a client can act on"
if printf '%s' "$CEILING_BODY" | grep -q 'rbac.manage'; then
  echo "FAIL: the refusal names the permission codes it withheld — republishing what it withholds"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: and it names a COUNT, never the permission codes (13-07's rule, applied here too)"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

STILL_CASHIER="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM user_branch_roles
   WHERE user_id = '${USER_ID}' AND role_code = 'OWNER' AND is_active;
" | auth_sql | tail -1)"
assert_status 0 "$STILL_CASHIER" \
  "and no OWNER row was written — a refused assignment must not have displaced anything first"

# The control. Without it every assertion above is satisfied by a ceiling that refuses everything,
# and the endpoint would be broken rather than secured.
assert_status 200 "$(lc_post_status "/internal/auth/users/${USER_ID}/branch-roles" "$OWNER_ID" \
  "$(json_obj branchId "$BRANCH_ID" roleCode "MANAGER")")" \
  "control: an IN-ceiling grant still succeeds — the OWNER may assign MANAGER"

ESCALATE_BODY="$(json_obj email "$ESCALATE_EMAIL" fullName "Escalation Attempt" \
  branchId "$BRANCH_ID" roleCode "OWNER")"
assert_status 403 "$(lc_post_status /internal/auth/users "$CASHIER_ID" "$ESCALATE_BODY")" \
  "the same ceiling applies to CREATE — a lesser role cannot mint an OWNER outright"
assert_status 403 "$(lc_post_status "/internal/auth/users/${OWNER_ID}/deactivate" "$CASHIER_ID")" \
  "and to DEACTIVATE — a lesser role cannot lock the OWNER out of their own tenant"
OWNER_STILL_ACTIVE="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT count(*) FROM users WHERE id = '${OWNER_ID}' AND is_active;
" | auth_sql | tail -1)"
assert_status 1 "$OWNER_STILL_ACTIVE" "the OWNER is still active"
echo

# ── 7. Per-tenant email uniqueness, enforced by the database ─────────────────────────────────

DUPLICATE="$(json_obj email "$(printf '%s' "$CASHIER_EMAIL" | tr '[:lower:]' '[:upper:]')" \
  fullName "Case Variant" branchId "$BRANCH_ID" roleCode "CASHIER")"
assert_status 409 "$(lc_post_status /internal/auth/users "$OWNER_ID" "$DUPLICATE")" \
  "a case variant of an existing address in the SAME tenant is refused (changeset 058)"

STORED_EMAIL="$(printf '%s\n' "
  SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
  SELECT email FROM users WHERE id = '${USER_ID}';
" | auth_sql | tail -1)"
assert_contains "$STORED_EMAIL" "$CASHIER_EMAIL" \
  "addresses are stored lower-cased, because login lower-cases before the lookup"

CI_INDEX="$(printf '%s\n' "
  SELECT count(*) FROM pg_indexes
   WHERE tablename = 'users' AND indexname = 'uk_users_tenant_email_ci';
" | auth_sql | tail -1)"
assert_status 1 "$CI_INDEX" \
  "and it is a real unique index, not an application check a race can pass"
echo

phase13_summary
