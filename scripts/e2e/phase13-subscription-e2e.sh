#!/usr/bin/env bash
# Phase 13-14 — subscription and tier management, proved live (D-30, D-34, D-35).
#
# WHY THIS EXISTS. The audit found .planning/phases/03-*/03-VERIFICATION.md scoring Phase 3
# "24/24 passed" while citing a controller that does not exist, because that verification grepped
# source. Every plan in this phase therefore proves itself by driving live HTTP through the real
# gateway. Two of this plan's claims are additionally unprovable from any integration test in
# platform-admin-service:
#
#   * the tier-change IMMEDIACY claim, because the whole point is that a real gateway process, with
#     a warm Redis cache it populated itself, sees the change on the next request. A test that
#     writes and reads the same in-process cache cannot fail the way a half-invalidated one does.
#   * the D-34 impersonation actor, because the defect was that the WRONG VALUE WAS PERSISTED. It
#     has to be read back out of platform_db, as a non-superuser, not asserted from a response.
#
# WHAT IT PROVES
#   S1  A SuperAdmin provisions a STARTER tenant through the real gateway.
#   S2  A growth-only feature is refused for a tenant user: 403 with code FEATURE_DISABLED and the
#       upgrade call-to-action header — the header whose destination did not exist until this plan.
#   S3  The tier is changed to GROWTH through the API...
#   S4  ...and the SAME request now clears the gate, with no restart and no cache-TTL wait. That
#       immediacy is the dual-key invalidation, and a stale cache breaks exactly this.
#   S5  A SuperAdmin explicitly enables an ENTERPRISE-only feature for this GROWTH tenant.
#   S6  Downgrading to STARTER preserves that override while disabling the merely tier-derived
#       codes — PLATFORM-10's authoritative-override rule, read from platform_db and from the API.
#   S7  ...and the gate is back for the tier-derived feature, again immediately.
#   S8  A downgrade below current usage is REFUSED, naming the limit and the usage (409
#       TIER_LIMIT_EXCEEDED), and succeeds with force=true.
#   S9  Billing reference, trial end and renewal date persist and read back — three fields nothing
#       in this codebase read or wrote before.
#   S10 THE D-34 PROOF: the impersonation_log row's acting column is the SuperAdmin's platform user
#       id and NOT the target's, and the returned token's impersonated_by claim says the same.
#   S11 Provisioning retry recovers a failed tenant ON THE SAME ROW, and is refused for a tenant
#       that is not in the failed state.
#
# PRECONDITIONS
#   - Docker infra up; gateway, auth-service, user-service, finance-service and
#     platform-admin-service running.
#   - platform-admin-service and the gateway MUST be running jars built AFTER plan 13-14. Against a
#     stale platform-admin jar the tier call 404s and this script fails early rather than reporting
#     a confident, meaningless pass.
#   - Nothing here restarts anything.
#
# Usage: bash scripts/e2e/phase13-subscription-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

SUPERADMIN_EMAIL="${SUPERADMIN_EMAIL:-superadmin@softxlogic.com}"
SUPERADMIN_PASSWORD="${SUPERADMIN_PASSWORD:-Test@123!}"

# /internal/** is deliberately unrouted at the gateway (the shared secret is the whole of the
# authorization there), so the second branch S8 needs is created against user-service directly.
USER_ORIGIN="${USER_ORIGIN:-http://localhost:8082}"

# The brand is pinned and slugify is deterministic on it, so a re-run addresses the same rows
# rather than littering the database with a tenant per run. Cleanup resolves ids from the slug.
BRAND="Phase13 Subscription E2E"
SLUG="phase13-subscription-e2e"
ADMIN_EMAIL="owner@${SLUG}.local"
FORCED_NEW_PASSWORD='Sub#Owner1x'

# The retry subject. Its slug is pre-claimed in auth_db by a tenant that exists nowhere else, so
# registerTenant answers 409 and the saga fails AFTER creating a branch — a real PROVISIONING_FAILED
# tenant rather than one poked into that state with SQL. Releasing the claim is what makes the
# retry succeed, so the retry is proved against a genuine failure.
RETRY_BRAND="Phase13 Subscription Retry"
RETRY_SLUG="phase13-subscription-retry"
RETRY_EMAIL="owner@${RETRY_SLUG}.local"
RETRY_HOLDER_ID="$(python3 -c "
import uuid
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'),
                 'restaurantos/e2e/phase13-subscription/slug-holder'))
")"

# GROWTH+ in TierFeatureDefaults, and RouteFeatureMap gates /api/v1/nlq/ on it — so the tier
# genuinely governs whether a request gets through the edge.
TIER_DERIVED_CODE="FEATURE_NLQ"
TIER_DERIVED_PATH="/api/v1/nlq/query"
# ENTERPRISE-only, so a GROWTH tenant does not get it from its tier and a STARTER tenant certainly
# does not. Anything still enabled after the downgrade can only be the override.
OVERRIDE_CODE="FEATURE_WHITE_LABEL_DOMAIN"

# redis-cli, authenticated. This dev Redis is `requirepass`-ed and _phase13-lib.sh exports
# REDIS_PASSWORD from deploy/.env; without it every GET answers "NOAUTH Authentication required",
# which is indistinguishable from a missing key and would score the dual-key invalidation as broken
# when it is working. REDISCLI_AUTH keeps the password off the command line and out of ps output.
redis_get() {
  docker exec -e REDISCLI_AUTH="${REDIS_PASSWORD:-}" -i restaurantos-redis redis-cli GET "$1" 2>/dev/null
}
redis_del_matching() {
  docker exec -e REDISCLI_AUTH="${REDIS_PASSWORD:-}" -i restaurantos-redis \
    redis-cli --scan --pattern "$1" 2>/dev/null \
    | while read -r k; do
        [[ -n "$k" ]] && docker exec -e REDISCLI_AUTH="${REDIS_PASSWORD:-}" -i restaurantos-redis \
          redis-cli DEL "$k" > /dev/null 2>&1
      done || true
}

# ── Database access ─────────────────────────────────────────────────────────────────────────
#
# platform_admin, auth_user and user_service are all NOSUPERUSER NOBYPASSRLS on these databases.
# branches, users and user_branch_roles are FORCE ROW LEVEL SECURITY on app.current_tenant_id, so
# the GUC lines below are load-bearing: without them the SELECTs return zero rows and the DELETEs
# report success while deleting nothing. platform_db has no RLS at all (SC4/PLATFORM-07), which is
# why the platform_sql blocks set no GUC — measured, not assumed.
auth_sql()     { docker exec -i restaurantos-postgres psql -U auth_user      -d auth_db     -v ON_ERROR_STOP=1 -qtA; }
user_sql()     { docker exec -i restaurantos-postgres psql -U user_service   -d user_db     -v ON_ERROR_STOP=1 -qtA; }
platform_sql() { docker exec -i restaurantos-postgres psql -U platform_admin -d platform_db -v ON_ERROR_STOP=1 -qtA; }
finance_sql()  { docker exec -i restaurantos-postgres psql -U finance_user   -d finance_db  -v ON_ERROR_STOP=1 -qtA; }

# ── Cleanup ─────────────────────────────────────────────────────────────────────────────────

purge_everything() {
  local tenant_ids tid
  tenant_ids="$(printf '%s\n' \
    "SELECT id FROM tenants WHERE slug LIKE '${SLUG}%' OR slug LIKE '${RETRY_SLUG}%'
       OR brand_name IN ('${BRAND}','${RETRY_BRAND}');" | platform_sql 2>/dev/null || true)"

  for tid in $tenant_ids; do
    printf '%s\n' "
      SELECT set_config('app.current_tenant_id', '${tid}', false);
      DELETE FROM refresh_sessions WHERE tenant_id = '${tid}';
      DELETE FROM user_branch_roles WHERE tenant_id = '${tid}';
      DELETE FROM password_reset_tokens WHERE tenant_id = '${tid}';
      DELETE FROM password_history WHERE user_id IN (SELECT id FROM users WHERE tenant_id = '${tid}');
      DELETE FROM users WHERE tenant_id = '${tid}';
      DELETE FROM auth_tenants WHERE id = '${tid}';
    " | auth_sql > /dev/null 2>&1 || true
    printf '%s\n' "
      SELECT set_config('app.current_tenant_id', '${tid}', false);
      DELETE FROM branches WHERE tenant_id = '${tid}';
    " | user_sql > /dev/null 2>&1 || true
    printf '%s\n' "
      SELECT set_config('app.current_tenant_id', '${tid}', false);
      DELETE FROM accounting_periods WHERE tenant_id = '${tid}';
      DELETE FROM chart_of_accounts WHERE tenant_id = '${tid}';
    " | finance_sql > /dev/null 2>&1 || true
    printf '%s\n' "
      DELETE FROM impersonation_log WHERE tenant_id = '${tid}';
      DELETE FROM event_outbox WHERE tenant_id = '${tid}';
      DELETE FROM tenant_features WHERE tenant_id = '${tid}';
      DELETE FROM usage_records WHERE tenant_id = '${tid}';
      DELETE FROM tenants WHERE id = '${tid}';
    " | platform_sql > /dev/null 2>&1 || true
    # Cache keys outlive the rows: a stale tenant:status or tenant_features key would make the NEXT
    # run measure the cache rather than the gate.
    redis_del_matching "*${tid}*"
  done

  printf '%s\n' "
    DELETE FROM auth_tenants WHERE id = '${RETRY_HOLDER_ID}'
       OR slug LIKE '${SLUG}%' OR slug LIKE '${RETRY_SLUG}%';
  " | auth_sql > /dev/null 2>&1 || true
}

cleanup() {
  local code=$?
  purge_everything
  echo "Cleaned up throwaway tenants '${SLUG}' and '${RETRY_SLUG}'"
  exit $code
}
trap cleanup EXIT

# A previous run killed between steps would otherwise leave rows that turn "slug already exists"
# into what looks like a defect in the code under test.
purge_everything

# ── Helpers ─────────────────────────────────────────────────────────────────────────────────

# Bodies are ALWAYS built in a variable, never inline inside "$( … )": an inline
# -d "{\"a\":1,\"b\":2}" is brace-expanded by bash into two malformed fragments and curl runs twice,
# which in 13-02 produced a confident FAIL for a request that, sent correctly, succeeds.
# A JSON object built from `key=value` ARGUMENTS, never from an escaped literal.
#
# WHY NOT A LITERAL. `-d "$(json "{\"a\":\"b\"}")"` looks fine and is not: the inner escaped
# quotes are consumed when bash re-parses the nested command substitution, and what reaches python
# is a fragment. 13-07 recorded this exact failure and 13-10 worked around it by assigning every
# body to a variable first — which works, but only as long as nobody writes an inline one again.
# Taking argv pairs removes the shape entirely: there is no literal to mis-escape, and a value
# containing a brace, a comma or a quote is passed through untouched.
#   json_obj tier=GROWTH force:=true      # `:=` marks a raw JSON value (bool/number/null)
json_obj() { python3 -c "
import json, sys
out = {}
for arg in sys.argv[1:]:
    if ':=' in arg and arg.index(':=') < (arg.index('=') if '=' in arg.replace(':=','  ') else len(arg)):
        k, v = arg.split(':=', 1)
        out[k] = json.loads(v)
    else:
        k, v = arg.split('=', 1)
        out[k] = v
print(json.dumps(out))
" "$@"; }

# One request; status on the first line, body on the rest. NOT retried on the gateway's
# SERVICE_UNAVAILABLE fallback — see post_json in phase13-provisioning-e2e.sh for why a blind retry
# against a state-changing endpoint manufactures the failure it is meant to detect. The platform
# route is warmed with a cheap GET before the assertion phase instead.
send_json() {
  local method="$1" url="$2" token="$3" body="$4" idem="${5:-}"
  local args=(-s -w '\n%{http_code}' -X "$method" "$url" -H "Content-Type: application/json")
  [[ -n "$token" ]] && args+=(-H "Authorization: Bearer ${token}")
  [[ -n "$idem"  ]] && args+=(-H "Idempotency-Key: ${idem}")
  [[ -n "$body"  ]] && args+=(-d "$body")
  local response
  response="$(curl "${args[@]}")"
  printf '%s\n%s' "$(printf '%s' "$response" | tail -1)" "$(printf '%s' "$response" | sed '$d')"
}

# The gateway's error CODE for a request, or the literal status when the body carries no code.
#
# 13-03's lesson, and it is not hypothetical: THREE layers answer 403 on these routes, so a bare
# `assert_status 403` cannot tell "the feature gate refused you" from "the service's own RBAC
# refused you", and a status-only assertion once reported a working gate as broken. Every gate
# assertion below names the code.
gate_code() {
  local token="$1" path="$2"
  local response
  response="$(curl -s -w '\n%{http_code}' -X POST "${GATEWAY}${path}" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${token}" -d '{"question":"how many orders today"}')"
  local status body code
  status="$(printf '%s' "$response" | tail -1)"
  body="$(printf '%s' "$response" | sed '$d')"
  code="$(printf '%s' "$body" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin)['error']['code'])
except Exception:
    print('')
" 2>/dev/null || true)"
  printf '%s' "${code:-HTTP_${status}}"
}

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

feature_state() {   # feature_state <tenantId> <code> -> t|f|(empty)
  printf '%s\n' "SELECT is_enabled FROM tenant_features
                   WHERE tenant_id = '${1}' AND feature_code = '${2}';" | platform_sql | tail -1
}

echo "=== Phase 13-14: subscription, tier and the impersonation actor, proved live ==="
echo "gateway=${GATEWAY}"
echo "brand='${BRAND}'  slug=${SLUG}  admin=${ADMIN_EMAIL}"
echo

# ── 0. The SuperAdmin authenticates (13-05's real credential path) ──────────────────────────

LOGIN_BODY="$(json_obj "email=${SUPERADMIN_EMAIL}" "password=${SUPERADMIN_PASSWORD}")"
SUPER_LOGIN="$(curl_retry -X POST "${GATEWAY}/api/v1/platform/auth/login" \
  -H "Content-Type: application/json" \
  -d "$LOGIN_BODY")"
SUPER_TOKEN="$(printf '%s' "$SUPER_LOGIN" | json_get "['data']['accessToken']" 2>/dev/null || true)"
SUPER_ID="$(printf '%s' "$SUPER_LOGIN"    | json_get "['data']['platformUserId']" 2>/dev/null || true)"
if [[ -z "$SUPER_TOKEN" || "$SUPER_TOKEN" == "None" ]]; then
  echo "SETUP FAILED: the SuperAdmin could not log in — this is blocker B1, not 13-14." >&2
  exit 1
fi
echo "SuperAdmin authenticated (platformUserId=${SUPER_ID})."

# Warm the platform route's load-balancer pool so the provisioning POST is not the first request
# through it. See send_json for why this replaces a blind 503 retry rather than supplementing one.
curl_status "${GATEWAY}/api/v1/platform/tenants?size=1" -H "Authorization: Bearer ${SUPER_TOKEN}" > /dev/null

set +e   # errexit off for the assertion phase: assert_* return 1, and under -e the first failure
         # would silently skip every assertion after it. The exit code comes from phase13_summary.

# ── S1. Provision a STARTER tenant ──────────────────────────────────────────────────────────

PROVISION_BODY="$(json_obj "brandName=${BRAND}" "adminEmail=${ADMIN_EMAIL}" "tier=STARTER")"
PROVISION_RESULT="$(send_json POST "${GATEWAY}/api/v1/platform/tenants" "$SUPER_TOKEN" \
  "$PROVISION_BODY" "e2e-1314-$(date +%s)")"
PROVISION_STATUS="$(printf '%s' "$PROVISION_RESULT" | head -1)"
PROVISION_RESPONSE="$(printf '%s' "$PROVISION_RESULT" | tail -n +2)"
assert_status 201 "$PROVISION_STATUS" "[S1] a STARTER tenant is provisioned through the gateway"

TENANT_ID="$(printf '%s' "$PROVISION_RESPONSE"     | json_get "['data']['tenantId']"     2>/dev/null || true)"
TENANT_SLUG="$(printf '%s' "$PROVISION_RESPONSE"   | json_get "['data']['slug']"         2>/dev/null || true)"
TEMP_PASSWORD="$(printf '%s' "$PROVISION_RESPONSE" | json_get "['data']['tempPassword']" 2>/dev/null || true)"
if [[ -z "$TENANT_ID" || "$TENANT_ID" == "None" ]]; then
  echo "FATAL: no tenant id in the provisioning response: ${PROVISION_RESPONSE}" >&2
  phase13_summary; exit 1
fi

assert_status "STARTER" "$(printf '%s\n' "SELECT tier FROM tenants WHERE id='${TENANT_ID}';" | platform_sql | tail -1)" \
  "[S1] ...at the STARTER tier"
assert_status "f" "$(feature_state "$TENANT_ID" "$TIER_DERIVED_CODE")" \
  "[S1] ...with ${TIER_DERIVED_CODE} off, because STARTER does not include it"

# ── The tenant's own admin obtains a real token (13-08 then D-29a, in that order) ───────────

ADMIN_PASSWORD="$TEMP_PASSWORD"
# Every body below is built on its OWN statement, one level of command substitution deep.
# Nesting a body-building "$( … )" inside another one is what breaks: bash brace-expands the dict
# literal before python ever sees it (13-02) and eats the escaped quotes of a JSON literal (13-07).
# json_obj takes argv pairs, so there is no brace and no quote to lose.
FIRST_LOGIN_BODY="$(json_obj "email=${ADMIN_EMAIL}" "password=${TEMP_PASSWORD}" "tenantSlug=${TENANT_SLUG}")"
LOGIN_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "$FIRST_LOGIN_BODY")"
CHANGE_TOKEN="$(change_token_from "$LOGIN_RESPONSE" || true)"
if [[ -n "$CHANGE_TOKEN" ]]; then
  FORCED_RESULT="$(forced_change "$CHANGE_TOKEN" "$TEMP_PASSWORD" "$FORCED_NEW_PASSWORD")"
  [[ "$(printf '%s' "$FORCED_RESULT" | head -1)" == "200" ]] && ADMIN_PASSWORD="$FORCED_NEW_PASSWORD"
fi

BOOTSTRAP_BODY="$(json_obj "email=${ADMIN_EMAIL}" "password=${ADMIN_PASSWORD}" "tenantSlug=${TENANT_SLUG}")"
BOOTSTRAP_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/2fa/bootstrap" \
  -H "Content-Type: application/json" -d "$BOOTSTRAP_BODY")"
OTPAUTH_URI="$(printf '%s' "$BOOTSTRAP_RESPONSE" | json_get "['data']['otpauthUri']" 2>/dev/null || true)"
TENANT_TOKEN=""
if [[ -n "$OTPAUTH_URI" && "$OTPAUTH_URI" != "None" ]]; then
  TOTP_SECRET="$(printf '%s' "$OTPAUTH_URI" | python3 -c "
import sys, urllib.parse as u
print(u.parse_qs(u.urlparse(sys.stdin.read().strip()).query)['secret'][0])
")"
  VERIFY_CODE="$(totp_now "$TOTP_SECRET")"
  VERIFY_BODY="$(json_obj "email=${ADMIN_EMAIL}" "password=${ADMIN_PASSWORD}" \
    "tenantSlug=${TENANT_SLUG}" "code=${VERIFY_CODE}")"
  curl_status -X POST "${GATEWAY}/api/v1/auth/2fa/bootstrap/verify" -H "Content-Type: application/json" \
    -d "$VERIFY_BODY" > /dev/null
  STEPUP_CODE="$(totp_now "$TOTP_SECRET")"
  STEPUP_BODY="$(json_obj "email=${ADMIN_EMAIL}" "password=${ADMIN_PASSWORD}" \
    "tenantSlug=${TENANT_SLUG}" "totpCode=${STEPUP_CODE}")"
  STEPUP_RESPONSE="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" -H "Content-Type: application/json" \
    -d "$STEPUP_BODY")"
  TENANT_TOKEN="$(printf '%s' "$STEPUP_RESPONSE" | json_get "['data']['accessToken']" 2>/dev/null || true)"
fi
if [[ -z "$TENANT_TOKEN" || "$TENANT_TOKEN" == "None" ]]; then
  echo "FATAL: the tenant's own admin never obtained a token; the gate assertions below would be"
  echo "       measuring authentication rather than entitlement. ${STEPUP_RESPONSE:-}" >&2
  phase13_summary; exit 1
fi
echo "Tenant OWNER authenticated."

# ── S2. The dead link: a growth-only feature is refused, with the upgrade call to action ────

assert_status "FEATURE_DISABLED" "$(gate_code "$TENANT_TOKEN" "$TIER_DERIVED_PATH")" \
  "[S2] a STARTER tenant is refused ${TIER_DERIVED_CODE} with the FEATURE_DISABLED code"

CTA_HEADER="$(curl -s -D - -o /dev/null -X POST "${GATEWAY}${TIER_DERIVED_PATH}" \
  -H "Content-Type: application/json" -H "Authorization: Bearer ${TENANT_TOKEN}" \
  -d '{"question":"x"}' | grep -i '^x-upgrade-cta-url:' || true)"
assert_contains "$CTA_HEADER" "$TIER_DERIVED_CODE" \
  "[S2] ...carrying the upgrade call-to-action header whose destination this plan creates"

# ── S3 + S4. The tier changes, and the gate opens on the very next request ──────────────────

TIER_RESULT="$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/tier" "$SUPER_TOKEN" \
  "$(json_obj tier=GROWTH)")"
assert_status 200 "$(printf '%s' "$TIER_RESULT" | head -1)" \
  "[S3] the SuperAdmin changes the tier to GROWTH through the API"
assert_contains "$(printf '%s' "$TIER_RESULT" | tail -n +2)" "$TIER_DERIVED_CODE" \
  "[S3] ...and the response names ${TIER_DERIVED_CODE} among the codes it changed"
assert_status "5" "$(printf '%s\n' "SELECT max_branches FROM tenants WHERE id='${TENANT_ID}';" | platform_sql | tail -1)" \
  "[S3] ...the tier's LIMITS were re-applied, not only its features (max_branches 1 -> 5)"
assert_status "5000" "$(printf '%s\n' "SELECT nlq_quota FROM tenants WHERE id='${TENANT_ID}';" | platform_sql | tail -1)" \
  "[S3] ...including the NLQ quota the gateway now enforces against"

# No restart. No sleep. No cache expiry. This is the assertion a half-invalidated cache fails.
NEW_CODE="$(gate_code "$TENANT_TOKEN" "$TIER_DERIVED_PATH")"
if [[ "$NEW_CODE" == "FEATURE_DISABLED" ]]; then
  echo "FAIL: [S4] the upgrade did not take effect — the gateway still refuses ${TIER_DERIVED_CODE}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
else
  echo "PASS: [S4] the upgrade takes effect IMMEDIATELY — no restart, no TTL wait (now: ${NEW_CODE})"
  PHASE13_PASS=$((PHASE13_PASS + 1))
fi
assert_status "true" "$(redis_get "tenant_features:${TENANT_ID}:${TIER_DERIVED_CODE}")" \
  "[S4] ...the gateway's cache key was rewritten"
assert_status "true" "$(redis_get "feature:${TENANT_ID}:${TIER_DERIVED_CODE}")" \
  "[S4] ...and so was the service/aspect key — writing one leaves the other stale"

# ── S5 + S6 + S7. PLATFORM-10: an explicit override outranks the tier default ───────────────

OVERRIDE_RESULT="$(send_json PATCH "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/features/${OVERRIDE_CODE}" \
  "$SUPER_TOKEN" "$(json_obj enabled:=true)")"
assert_status 200 "$(printf '%s' "$OVERRIDE_RESULT" | head -1)" \
  "[S5] the SuperAdmin explicitly enables the ENTERPRISE-only ${OVERRIDE_CODE} for a GROWTH tenant"
assert_status "t" "$(printf '%s\n' "SELECT is_override FROM tenant_features
    WHERE tenant_id='${TENANT_ID}' AND feature_code='${OVERRIDE_CODE}';" | platform_sql | tail -1)" \
  "[S5] ...and the row is marked as an override, which is what makes S6 possible at all"

DOWN_RESULT="$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/tier" "$SUPER_TOKEN" \
  "$(json_obj tier=STARTER)")"
assert_status 200 "$(printf '%s' "$DOWN_RESULT" | head -1)" "[S6] the tier is changed back down to STARTER"

assert_status "t" "$(feature_state "$TENANT_ID" "$OVERRIDE_CODE")" \
  "[S6] the explicitly-enabled ${OVERRIDE_CODE} SURVIVES the downgrade (PLATFORM-10)"
assert_status "f" "$(feature_state "$TENANT_ID" "$TIER_DERIVED_CODE")" \
  "[S6] ...while the merely tier-derived ${TIER_DERIVED_CODE} is disabled — so 'preserved' does not just mean 'nothing happened'"
assert_status "t" "$(feature_state "$TENANT_ID" "FEATURE_POS")" \
  "[S6] ...and an all-tiers code is untouched, so reconciliation is selective rather than indiscriminate"

FEATURES_BODY="$(curl_retry "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/features" \
  -H "Authorization: Bearer ${SUPER_TOKEN}")"
assert_contains "$FEATURES_BODY" "\"${OVERRIDE_CODE}\":true" \
  "[S6] ...and the API agrees with the database about the override"

assert_status "FEATURE_DISABLED" "$(gate_code "$TENANT_TOKEN" "$TIER_DERIVED_PATH")" \
  "[S7] the downgrade re-closes the gate immediately, with no restart"

# ── S8. A downgrade below current usage is refused, and force overrides it ──────────────────

send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/tier" "$SUPER_TOKEN" \
  "$(json_obj tier=GROWTH)" > /dev/null

BRANCH_BODY="$(json_obj "tenantId=${TENANT_ID}" "name=${BRAND} Second" isHq:=false)"
SECOND_BRANCH_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${USER_ORIGIN}/internal/users/branches" \
  -H "Content-Type: application/json" -H "X-Internal-Service: ${INTERNAL_SECRET}" \
  -d "$BRANCH_BODY")"
assert_status 201 "$SECOND_BRANCH_STATUS" "[S8] a second branch is created, putting the tenant over STARTER's cap of 1"

REFUSED="$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/tier" "$SUPER_TOKEN" \
  "$(json_obj tier=STARTER)")"
REFUSED_STATUS="$(printf '%s' "$REFUSED" | head -1)"
REFUSED_BODY="$(printf '%s' "$REFUSED" | tail -n +2)"
assert_status 409 "$REFUSED_STATUS" "[S8] the downgrade below current usage is REFUSED"
assert_contains "$REFUSED_BODY" "TIER_LIMIT_EXCEEDED" "[S8] ...with a code a client can branch on"
assert_contains "$REFUSED_BODY" "branches"            "[S8] ...naming WHICH limit"
assert_contains "$REFUSED_BODY" "in use 2"            "[S8] ...and the actual usage, so the operator knows what to do"
assert_status "GROWTH" "$(printf '%s\n' "SELECT tier FROM tenants WHERE id='${TENANT_ID}';" | platform_sql | tail -1)" \
  "[S8] ...and nothing was half-applied"

FORCED="$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/tier" "$SUPER_TOKEN" \
  "$(json_obj tier=STARTER force:=true)")"
assert_status 200 "$(printf '%s' "$FORCED" | head -1)" "[S8] force=true applies it anyway"
assert_contains "$(printf '%s' "$FORCED" | tail -n +2)" '"forcedOverLimits":true' \
  "[S8] ...and says so, rather than reporting an ordinary success"
assert_status "2" "$(printf '%s\n' "SELECT set_config('app.current_tenant_id','${TENANT_ID}',false);
    SELECT count(*) FROM branches WHERE tenant_id='${TENANT_ID}' AND deleted_at IS NULL AND is_active;" \
    | user_sql | tail -1)" \
  "[S8] ...and DESTROYED NO DATA: both branches are still live under the lower tier"

# ── S9. The subscription fields ─────────────────────────────────────────────────────────────

TRIAL_END="$(python3 -c "
import datetime as d
print((d.datetime.now(d.timezone.utc) + d.timedelta(days=14)).replace(microsecond=0).isoformat().replace('+00:00','Z'))")"
RENEWS_AT="$(python3 -c "
import datetime as d
print((d.datetime.now(d.timezone.utc) + d.timedelta(days=365)).replace(microsecond=0).isoformat().replace('+00:00','Z'))")"

UPDATE_BODY="$(json_obj "brandName=${BRAND} Renamed" "billingRef=cus_PHASE13_1314" \
  "trialEndsAt=${TRIAL_END}" "renewsAt=${RENEWS_AT}")"
UPDATE_RESULT="$(send_json PATCH "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}" "$SUPER_TOKEN" \
  "$UPDATE_BODY")"
assert_status 200 "$(printf '%s' "$UPDATE_RESULT" | head -1)" \
  "[S9] the SuperAdmin sets the billing reference, trial end and renewal date"

READBACK="$(curl_retry "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}" -H "Authorization: Bearer ${SUPER_TOKEN}")"
assert_contains "$READBACK" "cus_PHASE13_1314" "[S9] ...the billing reference reads back"
assert_contains "$READBACK" "${BRAND} Renamed" "[S9] ...so does the brand"
assert_status "1" "$(printf '%s\n' "SELECT count(*) FROM tenants WHERE id='${TENANT_ID}'
    AND billing_ref='cus_PHASE13_1314' AND trial_ends_at IS NOT NULL AND renews_at IS NOT NULL;" \
    | platform_sql | tail -1)" \
  "[S9] ...and all three PERSISTED — three columns nothing in this codebase read or wrote before"
assert_status "$TENANT_SLUG" "$(printf '%s\n' "SELECT slug FROM tenants WHERE id='${TENANT_ID}';" | platform_sql | tail -1)" \
  "[S9] ...while the slug, which login resolves by, is unchanged"

# ── S10. THE D-34 PROOF, read out of the database ───────────────────────────────────────────

TARGET_USER_ID="$(printf '%s\n' "SELECT set_config('app.current_tenant_id','${TENANT_ID}',false);
    SELECT id FROM users WHERE tenant_id='${TENANT_ID}' AND email='${ADMIN_EMAIL}';" | auth_sql | tail -1)"

IMPERSONATE_BODY="$(json_obj "tenantId=${TENANT_ID}" "targetUserId=${TARGET_USER_ID}" \
  "reason=13-14 verification")"
IMPERSONATE_RESULT="$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/impersonate" \
  "$SUPER_TOKEN" "$IMPERSONATE_BODY")"
assert_status 200 "$(printf '%s' "$IMPERSONATE_RESULT" | head -1)" \
  "[S10] the SuperAdmin impersonates the tenant's admin"
IMPERSONATION_TOKEN="$(printf '%s' "$IMPERSONATE_RESULT" | tail -n +2 | json_get "['data']['token']" 2>/dev/null || true)"

LOG_ACTOR="$(printf '%s\n' "SELECT platform_user_id FROM impersonation_log
    WHERE tenant_id='${TENANT_ID}' ORDER BY started_at DESC LIMIT 1;" | platform_sql | tail -1)"
LOG_TARGET="$(printf '%s\n' "SELECT target_user_id FROM impersonation_log
    WHERE tenant_id='${TENANT_ID}' ORDER BY started_at DESC LIMIT 1;" | platform_sql | tail -1)"

assert_status "$SUPER_ID" "$LOG_ACTOR" \
  "[S10] the PERSISTED impersonation_log names the SuperAdmin as the acting administrator"
assert_status "$TARGET_USER_ID" "$LOG_TARGET" \
  "[S10] ...and the tenant admin as the target"
if [[ -n "$LOG_ACTOR" && "$LOG_ACTOR" != "$LOG_TARGET" ]]; then
  echo "PASS: [S10] ...and the two are DIFFERENT values — the whole of D-34, from the database"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: [S10] the audit row still cannot answer who impersonated whom (actor=${LOG_ACTOR} target=${LOG_TARGET})"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

CLAIM_ACTOR="$(jwt_claims "$IMPERSONATION_TOKEN" 2>/dev/null | python3 -c "
import sys, json; print(json.load(sys.stdin).get('impersonated_by',''))
" 2>/dev/null || true)"
assert_status "$SUPER_ID" "$CLAIM_ACTOR" \
  "[S10] the issued token's impersonated_by claim also names the SuperAdmin"
if [[ "$CLAIM_ACTOR" != "$TARGET_USER_ID" ]]; then
  echo "PASS: [S10] ...and not the impersonated user"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: [S10] the token claims the target impersonated themselves"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

# ── S11. Retry recovers a genuinely failed provisioning ─────────────────────────────────────

printf '%s\n' "
  INSERT INTO auth_tenants (id, slug, name, status, created_at, updated_at)
  VALUES ('${RETRY_HOLDER_ID}', '${RETRY_SLUG}', 'Slug Holder', 'ACTIVE', now(), now())
  ON CONFLICT (id) DO NOTHING;" | auth_sql > /dev/null

RETRY_BODY="$(json_obj "brandName=${RETRY_BRAND}" "adminEmail=${RETRY_EMAIL}" "tier=STARTER")"
RETRY_PROVISION="$(send_json POST "${GATEWAY}/api/v1/platform/tenants" "$SUPER_TOKEN" \
  "$RETRY_BODY" \
  "e2e-1314-retry-$(date +%s)")"
case "$(printf '%s' "$RETRY_PROVISION" | head -1)" in
  2??) echo "FAIL: [S11] the slug-colliding provision reported SUCCESS"
       PHASE13_FAIL=$((PHASE13_FAIL + 1)) ;;
  *)   echo "PASS: [S11] a slug-colliding provision fails ($(printf '%s' "$RETRY_PROVISION" | head -1))"
       PHASE13_PASS=$((PHASE13_PASS + 1)) ;;
esac

RETRY_TENANT_ID="$(printf '%s\n' "SELECT id FROM tenants WHERE brand_name='${RETRY_BRAND}';" | platform_sql | tail -1)"
RETRY_TENANT_SLUG="$(printf '%s\n' "SELECT slug FROM tenants WHERE id='${RETRY_TENANT_ID}';" | platform_sql | tail -1)"
assert_status "PROVISIONING_FAILED" \
  "$(printf '%s\n' "SELECT status FROM tenants WHERE id='${RETRY_TENANT_ID}';" | platform_sql | tail -1)" \
  "[S11] the failed tenant is PROVISIONING_FAILED"

# Release the claim so the retry can succeed — the failure was real, and so is its removal.
printf '%s\n' "DELETE FROM auth_tenants WHERE id = '${RETRY_HOLDER_ID}';" | auth_sql > /dev/null

RETRY_RESULT="$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${RETRY_TENANT_ID}/retry-provisioning" \
  "$SUPER_TOKEN" "$(json_obj "adminEmail=${RETRY_EMAIL}")")"
assert_status 200 "$(printf '%s' "$RETRY_RESULT" | head -1)" \
  "[S11] retry-provisioning is reachable through the API and succeeds"
assert_status "ACTIVE" \
  "$(printf '%s\n' "SELECT status FROM tenants WHERE id='${RETRY_TENANT_ID}';" | platform_sql | tail -1)" \
  "[S11] ...the tenant reaches ACTIVE"
assert_status "1" "$(printf '%s\n' "SELECT count(*) FROM tenants WHERE brand_name='${RETRY_BRAND}';" | platform_sql | tail -1)" \
  "[S11] ...on the SAME row — the pre-13-14 retry produced a SECOND tenant with a '-1' slug"
assert_status "$RETRY_TENANT_SLUG" \
  "$(printf '%s\n' "SELECT slug FROM tenants WHERE id='${RETRY_TENANT_ID}';" | platform_sql | tail -1)" \
  "[S11] ...keeping the slug the operator asked about"

REFUSED_RETRY="$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/retry-provisioning" \
  "$SUPER_TOKEN" "$(json_obj "adminEmail=${ADMIN_EMAIL}")")"
assert_status 409 "$(printf '%s' "$REFUSED_RETRY" | head -1)" \
  "[S11] retrying a tenant that is NOT in the failed state is refused"

# ── The gate: only a SUPER_ADMIN may do any of this ─────────────────────────────────────────

assert_status 403 "$(printf '%s' "$(send_json POST "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/tier" \
  "$TENANT_TOKEN" "$(json_obj tier=ENTERPRISE)")" | head -1)" \
  "[GATE] a tenant OWNER cannot grant itself a higher tier"
assert_status 403 "$(printf '%s' "$(send_json PATCH "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}" \
  "$TENANT_TOKEN" "$(json_obj billingRef=attacker)")" | head -1)" \
  "[GATE] ...nor edit its own subscription"
assert_status 403 "$(printf '%s' "$(send_json PATCH \
  "${GATEWAY}/api/v1/platform/tenants/${TENANT_ID}/features/${TIER_DERIVED_CODE}" \
  "$TENANT_TOKEN" "$(json_obj enabled:=true)")" | head -1)" \
  "[GATE] ...nor switch its own modules on"
assert_status "STARTER" "$(printf '%s\n' "SELECT tier FROM tenants WHERE id='${TENANT_ID}';" | platform_sql | tail -1)" \
  "[GATE] ...and none of it moved anything"

echo
phase13_summary
