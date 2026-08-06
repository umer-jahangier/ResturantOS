#!/usr/bin/env bash
# Phase 13-02 — WAITER and TENANT_ADMIN, proved over live HTTP through the real gateway.
#
# WHY THIS EXISTS (D-30). The audit found .planning/phases/03-*/03-VERIFICATION.md scoring Phase 3
# "24/24 passed" while citing a controller that does not exist, because that verification grepped
# source. Role and permission bugs are the worst possible fit for structural verification: an
# over-granted role, an under-granted role and a correctly-granted role all look identical in a
# changeset diff, all start cleanly, and all differ only in what a real request gets back. So every
# assertion below is an HTTP status or a claim out of a real signed token.
#
# WHAT IT PROVES
#   1. A WAITER can take an order and cannot touch the till. Both directions — a positive that
#      would fail if the role were under-granted, and a negative that would fail if it were widened.
#   2. A TENANT_ADMIN logs in WITHOUT a TOTP challenge and can administer branches and users. This
#      is the precise regression D-23 exists to prevent: granting rbac.manage would have made the
#      administration assertions pass and the login assertion fail, which is exactly the trade the
#      permission split was designed to avoid.
#   3. Assigning a second role at a branch REPLACES the first, reports what it displaced, and leaves
#      the roles claim single-valued.
#
# PRECONDITIONS
#   - Docker infra up, and gateway + auth-service + user-service + pos-service running, all
#     Eureka-registered. Nothing here restarts anything.
#   - auth-service and user-service must be running the jars built AFTER changesets 055/056 and the
#     re-gated controllers. Running this against a stale jar asserts the old catalog and is the one
#     way it can report a confident, meaningless pass.
#   - The demo tenant (a0000001-…) and its HQ branch (b0000001-…) exist — seeded by auth-service
#     Liquibase, context=seed.
#
# Usage: bash scripts/e2e/phase13-roles-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

TENANT_ID="a0000001-0000-4000-8000-000000000001"
TENANT_SLUG="demo"
BRANCH_ID="b0000001-0000-4000-8000-000000000001"

# Reused verbatim from the seeded cashier row: bcrypt(12) of 'Cashier#2026'. Deliberately not
# generated here — bcrypt is not in the shell, and adding a python dependency to a verification
# script is how the script stops being runnable on the machine that needs it most. These are
# throwaway personas on a dev tenant; the hash is already in the repository.
PROBE_PASSWORD='Cashier#2026'
PROBE_PASSWORD_HASH='$2a$12$HvDkD2g7oob7I/NXk3Oo/u6lcPoOVcBVa.Tb.dgQgCoiCua/fkII6'

WAITER_EMAIL="e2e-waiter@demo.local"
TADMIN_EMAIL="e2e-tenantadmin@demo.local"

# Deterministic uuid5 ids, same namespace and path scheme as scripts/onboarding.py, so a re-run
# addresses the same rows instead of littering the database with a new persona each time.
uuid5_for() {
  python3 -c "
import uuid, sys
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), sys.argv[1]))
" "$1"
}
WAITER_ID="$(uuid5_for "restaurantos/tenant/${TENANT_SLUG}/user/e2e-waiter")"
TADMIN_ID="$(uuid5_for "restaurantos/tenant/${TENANT_SLUG}/user/e2e-tenant-admin")"

# ── Setup helpers ───────────────────────────────────────────────────────────────────────────

# There is no public user-creation API yet — it lands in a later plan in this phase — so the two
# personas are written straight to auth_db, exactly as scripts/onboarding.py does. This is the ONLY
# direct database write in this script; every assertion below goes over HTTP.
#
# The GUC is set in the same session as the INSERT because users and user_branch_roles are FORCE
# ROW LEVEL SECURITY on app.current_tenant_id: without it the INSERT is rejected by the policy.
auth_sql() {
  docker exec -i restaurantos-postgres psql -U auth_user -d auth_db -v ON_ERROR_STOP=1 -qtA
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

# 13-11 made X-Acting-User-Id REQUIRED on the branch-role write path: auth-service bounds what a
# request may grant by the ACTING user's own permissions, so it has to know who is asking. Before
# that, a caller with the shared secret and no identity at all could assign OWNER and be answered
# 200 — the escalation 13-07 measured and left open. This script's seeding is system work, and the
# honest way to express that under the new contract is to act as the tenant's OWNER, who holds the
# whole catalogue and can therefore legitimately grant any of these roles.
SEED_ACTING_USER_ID="c0000002-0000-4000-8000-000000000002"

# Assign through auth-service's internal endpoint — the system of record for user_branch_roles, and
# the same door user-service uses. Prints the raw response so callers can read displacedRoleCode.
assign_role() {
  local user_id="$1" role_code="$2"
  curl_retry -X POST "${AUTH_ORIGIN}/internal/auth/users/${user_id}/branch-roles" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H "X-Acting-User-Id: ${SEED_ACTING_USER_ID}" \
    -d "{\"branchId\":\"${BRANCH_ID}\",\"roleCode\":\"${role_code}\"}"
}

# The permissions array out of a real signed access token.
token_permissions() {
  jwt_claims "$1" | python3 -c "
import sys, json
print('\n'.join(json.load(sys.stdin).get('permissions', [])))
"
}

token_roles() {
  jwt_claims "$1" | python3 -c "
import sys, json
print(json.dumps(json.load(sys.stdin).get('roles', [])))
"
}

# "The request reached the controller and the gate let it through."
#
# assert_not_status 403 is not enough on its own, and the first run of this script proved it: a
# gateway 503 (a cold circuit breaker, or an upstream whose jar had been rewritten under a running
# JVM) is not 403, so it PASSED an authorization assertion while the request had never reached the
# service at all. Anything that means "did not get past the edge or the gate" is a failure here;
# only a business-level answer counts as the gate having been satisfied.
assert_authorized() {
  local status="${1:-}" description="${2:-}"
  case "$status" in
    401|403|404|5??|000)
      echo "FAIL: ${description} — got ${status}, which is not the gate letting the request through"
      PHASE13_FAIL=$((PHASE13_FAIL + 1))
      ;;
    *)
      echo "PASS: ${description} (${status})"
      PHASE13_PASS=$((PHASE13_PASS + 1))
      ;;
  esac
}

echo "=== Phase 13-02: WAITER + TENANT_ADMIN over live HTTP ==="
echo "gateway=${GATEWAY}  auth=${AUTH_ORIGIN}  tenant=${TENANT_SLUG}"
echo

# ── Setup ───────────────────────────────────────────────────────────────────────────────────

seed_persona "$WAITER_ID" "$WAITER_EMAIL" "E2E Waiter"
seed_persona "$TADMIN_ID" "$TADMIN_EMAIL" "E2E Tenant Admin"
assign_role "$WAITER_ID" "WAITER"  > /dev/null
assign_role "$TADMIN_ID" "TENANT_ADMIN" > /dev/null
echo "Seeded: waiter=${WAITER_ID}  tenant-admin=${TADMIN_ID}"
echo

# errexit is deliberately dropped from here down. The assert_* helpers return 1 on failure, so
# under `set -e` the script dies at the FIRST failing assertion — which is what happened on this
# script's first run: one FAIL was printed and every assertion after it was silently never
# attempted, so the report was both incomplete and misleadingly short. Setup above still runs under
# errexit, because a failure there means the assertions would be measuring nothing. The exit code
# comes from phase13_summary.
set +e

# ── 1. WAITER ───────────────────────────────────────────────────────────────────────────────

WAITER_TOKEN="$(tenant_login "$WAITER_EMAIL" "$PROBE_PASSWORD" "$TENANT_SLUG")"
assert_contains "$(token_roles "$WAITER_TOKEN")" 'WAITER' "waiter token carries the WAITER role"

WAITER_PERMS="$(token_permissions "$WAITER_TOKEN")"
for code in pos.order.create pos.order.update pos.order.view pos.order.send_to_kds; do
  assert_contains "$WAITER_PERMS" "$code" "waiter token carries ${code}"
done

# The negative half, and the more important one. An over-granted role passes every positive
# assertion above; only this catches it.
for family in 'pos\.till\.' 'pos\.order\.void' 'pos\.order\.refund'; do
  if printf '%s' "$WAITER_PERMS" | grep -qE "^${family}"; then
    echo "FAIL: waiter token carries a ${family} permission — $(printf '%s' "$WAITER_PERMS" | grep -E "^${family}" | tr '\n' ' ')"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  else
    echo "PASS: waiter token carries NO ${family}* permission"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  fi
done

# Bodies below are VALID on purpose. @Valid argument resolution happens before the @PreAuthorize
# interceptor runs, so a malformed body answers 400 without ever reaching the gate — and a 400
# would satisfy "not 403" while proving nothing at all.
#
# And every one of them is built in a VARIABLE first, never written inline inside a command
# substitution. `"$(curl_status ... -d "{\"a\":1,\"b\":2}")"` does not do what it reads like: the
# outer double quotes strip the backslashes before the inner command is parsed, the braces end up
# unquoted, and bash brace-expands the comma — so curl runs TWICE with two malformed fragments and
# the substitution yields two words. That is not theoretical; `set -x` on this script's second run
# showed it, and the two 400s it produced landed in assert_status as the actual status AND the
# description. It reported a clean, wrong answer for a request that was never sent as written.
ORDER_BODY="{\"branchId\":\"${BRANCH_ID}\",\"clientOrderId\":\"$(uuid5_for "restaurantos/e2e/phase13/order/$(date +%s)")\",\"type\":\"DINE_IN\",\"coverCount\":2}"
ORDER_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/pos/orders" \
  -H "Authorization: Bearer ${WAITER_TOKEN}" -H "Content-Type: application/json" -d "$ORDER_BODY")"
assert_authorized \
  "$(curl_status -X POST "${GATEWAY}/api/v1/pos/orders" \
       -H "Authorization: Bearer ${WAITER_TOKEN}" -H "Content-Type: application/json" -d "$ORDER_BODY")" \
  "waiter may create an order"

# The authorization assertion above is satisfied by any business-level answer, and that is correct
# for an authorization assertion — but it must not be allowed to read as "a waiter can take orders".
# It cannot, yet: pos-service refuses order creation unless the CALLER has an open till session, and
# a waiter by definition cannot open one. Authorization is right and the workflow is impossible, and
# that combination is invisible to a green line.
if printf '%s' "$ORDER_RESPONSE" | grep -q 'NO_OPEN_TILL'; then
  echo "FAIL: waiter is authorized to create an order but pos-service refuses it — NO_OPEN_TILL."
  echo "      OrderService requires the creating user to hold an open till session, which WAITER"
  echo "      cannot obtain (pos.till.open is deliberately withheld). The role is correctly granted"
  echo "      and still unusable end-to-end. Fixing it means changing where pos-service demands a"
  echo "      till — an architectural decision, not an RBAC one. See 13-02-SUMMARY."
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: waiter's order was accepted by pos-service, not just by the authorization gate"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi

TILL_BODY="{\"branchId\":\"${BRANCH_ID}\",\"openingFloatPaisa\":0}"
assert_status 403 \
  "$(curl_status -X POST "${GATEWAY}/api/v1/pos/tills" \
       -H "Authorization: Bearer ${WAITER_TOKEN}" -H "Content-Type: application/json" -d "$TILL_BODY")" \
  "waiter is refused opening a till"
echo

# ── 2. TENANT_ADMIN ─────────────────────────────────────────────────────────────────────────

# First, with NO totpCode.
#
# D-23's stated objective was that a TENANT_ADMIN reaches administration WITHOUT being forced into
# TOTP step-up, and its stated mechanism was to keep rbac.manage — the step-up trigger — off the
# role. The mechanism works and is asserted below. The objective does not follow from it, and this
# assertion is what showed that.
#
# requiresTotpStepUp fires on rbac.manage OR finance.period.close OR hr.payroll.approve. Changeset
# 030 grants TENANT_ADMIN "every permission except rbac.manage" — which includes
# finance.period.close — and 045-hr adds hr.payroll.approve. So TENANT_ADMIN is still challenged,
# for two triggers this plan neither introduced nor is permitted to remove: closing an accounting
# period and approving payroll are exactly the money-moving actions step-up exists for.
#
# This assertion is therefore left FAILING rather than softened. Making it pass would require
# either dropping a money gate from requiresTotpStepUp, or revoking finance.period.close and
# hr.payroll.approve from TENANT_ADMIN — a reduction of the role's authority, and a decision to be
# taken deliberately rather than smuggled in as a side effect of an RBAC repair. See 13-02-SUMMARY.
TADMIN_LOGIN_BODY="{\"email\":\"${TADMIN_EMAIL}\",\"password\":\"${PROBE_PASSWORD}\",\"tenantSlug\":\"${TENANT_SLUG}\"}"
TADMIN_LOGIN="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" \
  -H "Content-Type: application/json" -d "$TADMIN_LOGIN_BODY")"
if printf '%s' "$TADMIN_LOGIN" | grep -qE 'TOTP_REQUIRED|TOTP_ENROLLMENT_REQUIRED'; then
  echo "FAIL: tenant admin is still challenged for TOTP: ${TADMIN_LOGIN}"
  echo "      (expected while TENANT_ADMIN holds finance.period.close / hr.payroll.approve — see the"
  echo "       comment above and 13-02-SUMMARY. NOT caused by rbac.manage; that is asserted below.)"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  TADMIN_TOKEN=""
else
  echo "PASS: tenant admin logs in with no TOTP challenge"
  PHASE13_PASS=$((PHASE13_PASS + 1))
  TADMIN_TOKEN="$(printf '%s' "$TADMIN_LOGIN" | json_get "['data']['accessToken']")"
fi

# Step up and carry on, so the administration half — which is what the split actually delivers, and
# what "multiple admins per tenant" depends on — is proved live rather than left unmeasured behind
# the failure above.
if [[ -z "$TADMIN_TOKEN" ]]; then
  TADMIN_TOTP="$(python3 scripts/generate_totp.py "$TADMIN_EMAIL" 2>/dev/null | grep -oE '[0-9]{6}' | head -1 || true)"
  if [[ -n "$TADMIN_TOTP" ]]; then
    TADMIN_TOKEN="$(tenant_login "$TADMIN_EMAIL" "$PROBE_PASSWORD" "$TENANT_SLUG" "$TADMIN_TOTP" 2>/dev/null || true)"
    [[ -n "$TADMIN_TOKEN" ]] && echo "NOTE: continuing with a stepped-up tenant-admin token."
  fi
  if [[ -z "$TADMIN_TOKEN" ]]; then
    echo "NOTE: no TOTP secret enrolled for ${TADMIN_EMAIL}; the administration assertions below"
    echo "      cannot run. Enrol one:  python3 scripts/generate_totp.py ${TADMIN_EMAIL} --enroll"
  fi
fi

if [[ -n "$TADMIN_TOKEN" ]]; then
  TADMIN_PERMS="$(token_permissions "$TADMIN_TOKEN")"
  for code in rbac.user.manage rbac.role.manage branch.manage; do
    assert_contains "$TADMIN_PERMS" "$code" "tenant admin token carries ${code}"
  done
  # The D-23 mechanism itself. This is the assertion that fails if someone "fixes" the TOTP
  # challenge above by granting TENANT_ADMIN the umbrella code.
  if printf '%s' "$TADMIN_PERMS" | grep -qx 'rbac.manage'; then
    echo "FAIL: tenant admin token carries rbac.manage — the authority split has been undone"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  else
    echo "PASS: tenant admin token does NOT carry rbac.manage"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  fi

  assert_authorized \
    "$(curl_status "${GATEWAY}/api/v1/branches" -H "Authorization: Bearer ${TADMIN_TOKEN}")" \
    "tenant admin may list branches"

  # Contrast pair: the same valid request, one persona with branch.manage and one without. This is
  # what makes the 201 meaningful — on its own it could be an unguarded endpoint.
  BRANCH_BODY='{"name":"Phase13 E2E Probe Branch","isHq":false}'
  assert_status 403 \
    "$(curl_status -X POST "${GATEWAY}/api/v1/branches" \
         -H "Authorization: Bearer ${WAITER_TOKEN}" -H "Content-Type: application/json" -d "$BRANCH_BODY")" \
    "waiter is refused creating a branch"

  CREATE_BRANCH="$(curl_retry -X POST "${GATEWAY}/api/v1/branches" \
    -H "Authorization: Bearer ${TADMIN_TOKEN}" -H "Content-Type: application/json" -d "$BRANCH_BODY")"
  NEW_BRANCH_ID="$(printf '%s' "$CREATE_BRANCH" | json_get "['data']['id']" 2>/dev/null || true)"
  if [[ -n "$NEW_BRANCH_ID" && "$NEW_BRANCH_ID" != "None" ]]; then
    echo "PASS: tenant admin created a branch (${NEW_BRANCH_ID})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
    # Soft-delete it again, which also exercises the third branch.manage gate and keeps re-runs
    # from accumulating probe branches.
    assert_status 204 \
      "$(curl_status -X DELETE "${GATEWAY}/api/v1/branches/${NEW_BRANCH_ID}" \
           -H "Authorization: Bearer ${TADMIN_TOKEN}")" \
      "tenant admin may delete the branch it created"
  else
    echo "FAIL: tenant admin could not create a branch: ${CREATE_BRANCH}"
    PHASE13_FAIL=$((PHASE13_FAIL + 1))
  fi

  # 200, not merely "not 403". This endpoint read through to auth-service without the tenant
  # header, so it answered 500 — which would have satisfied a not-403 assertion and reported a
  # confident pass over a broken path.
  assert_status 200 \
    "$(curl_status "${GATEWAY}/api/v1/users/${WAITER_ID}?branchId=${BRANCH_ID}" \
         -H "Authorization: Bearer ${TADMIN_TOKEN}")" \
    "tenant admin may read a user's resolved permissions"
fi
echo

# ── 3. One active role per branch, over the wire ─────────────────────────────────────────────

DISPLACE="$(assign_role "$WAITER_ID" "CASHIER")"
assert_contains "$DISPLACE" '"displacedRoleCode":"WAITER"' \
  "assigning a second role reports the role it displaced"

DISPLACED_TOKEN="$(tenant_login "$WAITER_EMAIL" "$PROBE_PASSWORD" "$TENANT_SLUG")"
assert_contains "$(token_roles "$DISPLACED_TOKEN")" '\["CASHIER"\]' \
  "after displacement the roles claim is single-valued and holds only the new role"

# Put the persona back, so a re-run starts from the same place it did the first time.
RESTORE="$(assign_role "$WAITER_ID" "WAITER")"
assert_contains "$RESTORE" '"displacedRoleCode":"CASHIER"' \
  "restoring WAITER displaces CASHIER symmetrically"

echo
phase13_summary
