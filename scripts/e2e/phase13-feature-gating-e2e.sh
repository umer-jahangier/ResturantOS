#!/usr/bin/env bash
# Phase 13-03 — feature gating and tenant suspension, proved over live HTTP through the real gateway.
#
# WHY THIS EXISTS (D-30). The audit found .planning/phases/03-*/03-VERIFICATION.md scoring Phase 3
# "24/24 passed" while citing a controller that does not exist, because that verification grepped
# source. Feature flags are the worst possible fit for structural verification: a flag that is
# granted, a flag that is withheld, and a flag that EXISTS NOWHERE all look identical in a diff, all
# start cleanly, and differ only in what a real request gets back — and the third case produces a
# 403 indistinguishable from the second. That third case has shipped twice in this repository (the
# purchasing phantom flag and the NLQ phantom flag). So every assertion below is a live HTTP status
# and an error CODE out of a real response body.
#
# WHY THE ERROR CODE AND NOT THE STATUS. Three different layers answer 403 on these routes:
#   gateway feature gate  -> 403 {"code":"FEATURE_DISABLED"}   + X-Upgrade-CTA-URL
#   gateway status gate   -> 403 {"code":"TENANT_SUSPENDED"}
#   the service's RBAC    -> 403 {"code":"PERMISSION_DENIED"}
# A bare `assert_not_status 403` cannot tell them apart, and would report a permission failure as a
# gating success — the same class of mistake 13-02 had to fix in its own harness (see 13-02-SUMMARY
# deviation 5, where assert_not_status 403 passed on a gateway 503). Every assertion here names the
# code it expects, or the code it must not see.
#
# WHAT IT PROVES
#   1. FEATURE_HR is genuinely ENABLED for the demo tenant — read back from platform-admin over
#      HTTP, not assumed — and neither /api/v1/hr/ nor the payroll endpoints under it are gated off.
#      This is the concrete regression 13-CONTEXT.md names: with HR merged in Phase 11, a missing
#      FEATURE_HR row 403s every HR request, and payroll rides the same prefix.
#   2. Disabling a feature for one tenant produces 403 FEATURE_DISABLED with the upgrade CTA header
#      on that feature's route, and re-enabling restores access. Both directions, against a service
#      that is actually running, so the "enabled" case is a real 200 and not merely "not 403".
#   3. A suspended tenant is refused with TENANT_SUSPENDED, and is restored to ACTIVE by a trap even
#      if an assertion fails.
#   4. (opt-in, see PHASE13_PROVE_FAIL_CLOSED below) With platform-admin down and the status cache
#      cold, the tenant is REFUSED — 503 TENANT_STATUS_UNAVAILABLE — rather than served. This is
#      D-33: status resolution used to end in .defaultIfEmpty("ACTIVE"), so an outage restored full
#      access to every suspended tenant.
#
# WHY DIRECT DATABASE WRITES FOR THE TOGGLES. The SuperAdmin feature-flag API
# (PATCH /api/v1/platform/tenants/{id}/features/{code}) needs a real SuperAdmin login, which plan
# 13-05 delivers; until then there is no authenticated way to drive it. So this script writes
# tenant_features directly AND deletes both Redis key shapes that FeatureFlagAdminService maintains
# (tenant_features:{t}:{code} for the gateway, feature:{t}:{code} for the @RequiresFeature aspect).
# Deleting only one shape would leave the other serving a stale answer, and the script would then be
# measuring the cache rather than the gate. The API-driven version of this belongs to plan 13-14.
#
# PRECONDITIONS
#   - Docker infra up; gateway, auth-service, user-service and platform-admin-service running and
#     Eureka-registered. Nothing here restarts anything (except the opt-in block, which restarts
#     exactly what it stopped).
#   - The gateway must be running the jar built AFTER the fail-closed status change. Against a stale
#     jar the suspension assertions can pass for the wrong reason.
#   - At least one feature-gated service running, so the "enabled" case is a 200 rather than a 503.
#     inventory-service (8085) is the default probe; see PROBE_* below.
#   - The demo tenant (a0000001-…) and its HQ branch (b0000001-…) exist — seeded by auth-service
#     Liquibase, context=seed — and platform_db has a tenants row for it.
#
# Usage:
#   bash scripts/e2e/phase13-feature-gating-e2e.sh
#   PHASE13_PROVE_FAIL_CLOSED=1 bash scripts/e2e/phase13-feature-gating-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

TENANT_ID="a0000001-0000-4000-8000-000000000001"
TENANT_SLUG="demo"
BRANCH_ID="b0000001-0000-4000-8000-000000000001"
PLATFORM_ORIGIN="${PLATFORM_ORIGIN:-http://localhost:8096}"

# The feature toggled in and out. Must be (a) present in TierFeatureDefaults, (b) mapped to a prefix
# in RouteFeatureMap, and (c) served by a service that is actually up — otherwise the re-enabled case
# degrades to "not 403", which is exactly the weak assertion this file exists to avoid.
PROBE_FEATURE="${PROBE_FEATURE:-FEATURE_INVENTORY}"
PROBE_PATH="${PROBE_PATH:-/api/v1/inventory/ingredients}"

# Reused verbatim from the seeded cashier row: bcrypt(12) of 'Cashier#2026'. Deliberately not
# generated here — bcrypt is not in the shell, and adding a dependency to a verification script is
# how it stops being runnable on the machine that needs it most. Throwaway persona on a dev tenant.
PROBE_PASSWORD='Cashier#2026'
PROBE_PASSWORD_HASH='$2a$12$HvDkD2g7oob7I/NXk3Oo/u6lcPoOVcBVa.Tb.dgQgCoiCua/fkII6'
ADMIN_EMAIL="e2e-tenantadmin@demo.local"

# Same uuid5 namespace and path scheme as scripts/onboarding.py and phase13-roles-e2e.sh, so this
# addresses the SAME row that script created rather than littering a second persona.
ADMIN_ID="$(python3 -c "
import uuid
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), 'restaurantos/tenant/demo/user/e2e-tenant-admin'))
")"

# ── Infrastructure helpers ──────────────────────────────────────────────────────────────────

platform_sql() { docker exec -i restaurantos-postgres psql -U platform_user -d platform_db -v ON_ERROR_STOP=1 -qtA; }
auth_sql()     { docker exec -i restaurantos-postgres psql -U auth_user     -d auth_db     -v ON_ERROR_STOP=1 -qtA; }
redis_do()     { docker exec -i restaurantos-redis redis-cli -a "${REDIS_PASSWORD:-your-redis-password}" --no-auth-warning "$@"; }

# Both key shapes FeatureFlagAdminService maintains. Deleting one and not the other leaves a stale
# answer in the other and turns this script into a test of Redis.
drop_feature_cache() {
  redis_do DEL "tenant_features:${TENANT_ID}:$1" > /dev/null
  redis_do DEL "feature:${TENANT_ID}:$1"        > /dev/null
}
drop_status_cache() { redis_do DEL "tenant:status:${TENANT_ID}" > /dev/null; }

set_feature() {
  local code="$1" enabled="$2"
  # (tenant_id, feature_code) is the primary key — there is no surrogate id column on this table.
  printf '%s\n' "
    INSERT INTO tenant_features (tenant_id, feature_code, is_enabled)
    VALUES ('${TENANT_ID}', '${code}', ${enabled})
    ON CONFLICT (tenant_id, feature_code) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;
  " | platform_sql > /dev/null
  drop_feature_cache "$code"
}

set_tenant_status() {
  printf '%s\n' "UPDATE tenants SET status = '$1' WHERE id = '${TENANT_ID}';" | platform_sql > /dev/null
  drop_status_cache
}

# ── Restoration trap ────────────────────────────────────────────────────────────────────────
#
# Installed BEFORE the first mutation. A failed assertion under `set -e`, a Ctrl-C, or an unexpected
# exit must not leave the demo tenant suspended or a module switched off — the next person to use
# this database would be debugging a deliberate act of this script.
PLATFORM_ADMIN_STOPPED_PID=""
GATEWAY_FAIL_OPEN_OVERRIDDEN=""
restore_everything() {
  local rc=$?
  set +e
  echo
  echo "--- restoring demo tenant state (trap) ---"
  if [[ -n "$PLATFORM_ADMIN_STOPPED_PID" ]]; then
    start_platform_admin
  fi
  if [[ -n "$GATEWAY_FAIL_OPEN_OVERRIDDEN" ]]; then
    echo "    restoring the gateway to this machine's configured fail-open setting…"
    restart_gateway "$GATEWAY_FAIL_OPEN_DEFAULT"
    GATEWAY_FAIL_OPEN_OVERRIDDEN=""
  fi
  set_feature "$PROBE_FEATURE" true
  set_tenant_status ACTIVE
  local status feature
  status="$(printf '%s\n' "SELECT status FROM tenants WHERE id='${TENANT_ID}';" | platform_sql)"
  feature="$(printf '%s\n' "SELECT is_enabled FROM tenant_features WHERE tenant_id='${TENANT_ID}' AND feature_code='${PROBE_FEATURE}';" | platform_sql)"
  echo "    tenants.status          = ${status}"
  echo "    ${PROBE_FEATURE} enabled = ${feature}"
  if [[ "$status" != "ACTIVE" || "$feature" != "t" ]]; then
    echo "    *** RESTORATION INCOMPLETE — fix by hand before using this database ***"
    rc=1
  fi
  exit "$rc"
}
trap restore_everything EXIT INT TERM

# ── Probe helpers ───────────────────────────────────────────────────────────────────────────

# GET through the gateway; sets PROBE_STATUS, PROBE_BODY, PROBE_CTA.
probe() {
  local path="$1" token="$2"
  local headers_file body
  headers_file="$(mktemp)"
  body="$(curl -s -o - -w '\n%{http_code}' -D "$headers_file" "${GATEWAY}${path}" \
            -H "Authorization: Bearer ${token}" || true)"
  PROBE_STATUS="$(printf '%s' "$body" | tail -1)"
  PROBE_BODY="$(printf '%s' "$body" | sed '$d')"
  PROBE_CTA="$(grep -i '^X-Upgrade-CTA-URL:' "$headers_file" | tr -d '\r' | cut -d' ' -f2- || true)"
  rm -f "$headers_file"
}

pass() { echo "PASS: $1"; PHASE13_PASS=$((PHASE13_PASS + 1)); }
fail() { echo "FAIL: $1"; PHASE13_FAIL=$((PHASE13_FAIL + 1)); }

# The gate did NOT refuse this request. Anything may answer — including the service's own RBAC, or
# the gateway's SERVICE_UNAVAILABLE when the upstream is down — but FEATURE_DISABLED may not appear.
assert_not_feature_blocked() {
  local description="$1"
  if [[ "$PROBE_STATUS" == "403" ]] && printf '%s' "$PROBE_BODY" | grep -q 'FEATURE_DISABLED'; then
    fail "${description} — gated off with FEATURE_DISABLED (${PROBE_STATUS})"
    return
  fi
  if printf '%s' "$PROBE_BODY" | grep -q 'TENANT_STATUS_UNAVAILABLE'; then
    fail "${description} — the gateway could not determine the tenant status (${PROBE_STATUS})"
    return
  fi
  pass "${description} (${PROBE_STATUS}, no feature gate)"
  if printf '%s' "$PROBE_BODY" | grep -q '"code":"SERVICE_UNAVAILABLE"'; then
    echo "      NOTE: ${PROBE_STATUS} is the gateway's own upstream fallback — the request cleared the"
    echo "            feature gate and reached routing, but the service behind this prefix is not"
    echo "            running, so this does not prove the endpoint itself works."
  fi
}

assert_feature_blocked() {
  local code="$1" description="$2"
  if [[ "$PROBE_STATUS" != "403" ]] || ! printf '%s' "$PROBE_BODY" | grep -q 'FEATURE_DISABLED'; then
    fail "${description} — expected 403 FEATURE_DISABLED, got ${PROBE_STATUS}: $(printf '%s' "$PROBE_BODY" | head -c 160)"
    return
  fi
  pass "${description} (403 FEATURE_DISABLED)"
  if [[ "$PROBE_CTA" == *"${code}"* ]]; then
    pass "the refusal carries X-Upgrade-CTA-URL naming ${code}"
  else
    fail "X-Upgrade-CTA-URL missing or does not name ${code} (got: '${PROBE_CTA}')"
  fi
}

assert_code() {
  local expected_status="$1" expected_code="$2" description="$3"
  if [[ "$PROBE_STATUS" == "$expected_status" ]] && printf '%s' "$PROBE_BODY" | grep -q "$expected_code"; then
    pass "${description} (${PROBE_STATUS} ${expected_code})"
  else
    fail "${description} — expected ${expected_status} ${expected_code}, got ${PROBE_STATUS}: $(printf '%s' "$PROBE_BODY" | head -c 160)"
  fi
}

assert_ok() {
  local description="$1"
  if [[ "$PROBE_STATUS" == "200" ]]; then
    pass "${description} (200)"
  else
    fail "${description} — expected 200, got ${PROBE_STATUS}: $(printf '%s' "$PROBE_BODY" | head -c 160)"
  fi
}

# ── Persona ─────────────────────────────────────────────────────────────────────────────────
#
# TENANT_ADMIN rather than a cashier, deliberately: the re-enabled case must be a real 200, and a
# cashier is refused by inventory-service's own RBAC (PERMISSION_DENIED), which would leave the
# positive direction unproven. TENANT_ADMIN is challenged for TOTP — it holds finance.period.close
# and hr.payroll.approve, both step-up triggers; see 13-02-SUMMARY "Left failing" #1 — so the login
# steps up. That challenge is a finding of plan 13-02, not of this one.
ensure_persona() {
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, locale, totp_enabled, is_active)
    VALUES ('${ADMIN_ID}', '${TENANT_ID}', '${ADMIN_EMAIL}', '${PROBE_PASSWORD_HASH}', 'E2E Tenant Admin', 'en', false, true)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                                   is_active = true,
                                   failed_login_count = 0,
                                   locked_until = NULL;
  " | auth_sql > /dev/null
  curl_retry -X POST "${AUTH_ORIGIN}/internal/auth/users/${ADMIN_ID}/branch-roles" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H "X-Acting-User-Id: ${SEED_ACTING_USER_ID}" \
    -d "{\"branchId\":\"${BRANCH_ID}\",\"roleCode\":\"TENANT_ADMIN\"}" > /dev/null
  python3 scripts/generate_totp.py "$ADMIN_EMAIL" > /dev/null 2>&1 \
    || python3 scripts/generate_totp.py "$ADMIN_EMAIL" --enroll > /dev/null 2>&1 || true
}

# 13-11 made X-Acting-User-Id REQUIRED on the branch-role write path: auth-service bounds what a
# request may grant by the ACTING user's own permissions, so it has to know who is asking. Before
# that, a caller with the shared secret and no identity at all could assign OWNER and be answered
# 200 — the escalation 13-07 measured and left open. This script's seeding is system work, and the
# honest way to express that under the new contract is to act as the tenant's OWNER, who holds the
# whole catalogue and can therefore legitimately grant any of these roles.
SEED_ACTING_USER_ID="c0000002-0000-4000-8000-000000000002"

login_admin() {
  local code
  code="$(python3 scripts/generate_totp.py "$ADMIN_EMAIL" 2>/dev/null | grep -oE '[0-9]{6}' | head -1 || true)"
  tenant_login "$ADMIN_EMAIL" "$PROBE_PASSWORD" "$TENANT_SLUG" "$code" 2>/dev/null || true
}

# ── Service lifecycle (opt-in outage proof only) ─────────────────────────────────────────────
#
# What this machine's dev stack actually sets. scripts/local-service-env.sh exports
# FAIL_OPEN_ON_PLATFORM_DOWN=true, so a locally-started gateway runs with the break-glass lever
# PULLED — the one setting under which fail-closed cannot be observed. The block below therefore
# restarts the gateway with the production default to prove the refusal, then restarts it again
# with fail-open to prove the override, and the trap puts it back the way it found it.
GATEWAY_FAIL_OPEN_DEFAULT="$(
  ( . "${REPO_ROOT}/scripts/dev-env.sh" >/dev/null 2>&1
    . "${REPO_ROOT}/scripts/local-service-env.sh" >/dev/null 2>&1
    printf '%s' "${FAIL_OPEN_ON_PLATFORM_DOWN:-false}" ) 2>/dev/null || printf 'false'
)"

wait_healthy() {
  local url="$1" waited=0
  while (( waited < 150 )); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' "$url")" == "200" ]] && return 0
    sleep 3; waited=$((waited + 3))
  done
  return 1
}

# The gateway's Resilience4j breaker answers the first request after a restart with its own
# SERVICE_UNAVAILABLE fallback body — which is ALSO a 503, and would be indistinguishable from
# TENANT_STATUS_UNAVAILABLE if we asserted on status alone. Warm it until it stops doing that, so
# the 503 the assertion sees is the one the filter authored.
warm_gateway() {
  local token="$1" i
  for i in 1 2 3 4 5 6 7 8; do
    probe "$PROBE_PATH" "$token"
    printf '%s' "$PROBE_BODY" | grep -q '"code":"SERVICE_UNAVAILABLE"' || return 0
    sleep 3
  done
  return 1
}

restart_gateway() {
  local want_fail_open="$1" pid
  pid="$(pgrep -f 'gateway/target/gateway-1.0.0.jar' | head -1)"
  if [[ -n "$pid" ]]; then kill "$pid"; sleep 5; fi
  ( cd "$REPO_ROOT" \
      && . scripts/dev-env.sh \
      && . scripts/local-service-env.sh \
      && export FAIL_OPEN_ON_PLATFORM_DOWN="$want_fail_open" \
      && exec java -jar gateway/target/gateway-1.0.0.jar
  ) >> "${REPO_ROOT}/.dev-logs/gateway.log" 2>&1 &
  if wait_healthy "${GATEWAY}/actuator/health"; then
    echo "    gateway up with fail-open-on-platform-down=${want_fail_open}"
    return 0
  fi
  echo "    *** the gateway did NOT come back — start it by hand ***"
  return 1
}

stop_platform_admin() {
  PLATFORM_ADMIN_STOPPED_PID="$(pgrep -f 'platform-admin-service-1.0.0.jar' | head -1)"
  [[ -z "$PLATFORM_ADMIN_STOPPED_PID" ]] && return 1
  kill "$PLATFORM_ADMIN_STOPPED_PID"
  sleep 6
  drop_status_cache
  return 0
}

start_platform_admin() {
  echo "    restarting platform-admin-service…"
  ( cd "$REPO_ROOT" \
      && . scripts/dev-env.sh \
      && . scripts/local-service-env.sh \
      && exec java -jar services/platform-admin-service/target/platform-admin-service-1.0.0.jar
  ) >> "${REPO_ROOT}/.dev-logs/platform-admin-service.log" 2>&1 &
  PLATFORM_ADMIN_STOPPED_PID=""
  local waited=0
  while (( waited < 120 )); do
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' "${PLATFORM_ORIGIN}/actuator/health")" == "200" ]]; then
      echo "    platform-admin-service healthy again"
      return 0
    fi
    sleep 3; waited=$((waited + 3))
  done
  echo "    *** platform-admin-service did NOT come back — start it by hand ***"
  return 1
}

# ══════════════════════════════════════════════════════════════════════════════════════════════
echo "Phase 13-03 — feature gating and suspension, live through ${GATEWAY}"
echo

ensure_persona
ADMIN_TOKEN="$(login_admin)"
if [[ -z "$ADMIN_TOKEN" ]]; then
  echo "FATAL: could not log in as ${ADMIN_EMAIL}. Nothing below can be asserted."
  echo "       Try: python3 scripts/generate_totp.py ${ADMIN_EMAIL} --enroll"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
  phase13_summary || exit 1
fi

# Assertions must not abort the run at the first failure: a script that stops on failure #1 silently
# skips everything after it and reports a smaller, prettier number (13-02-SUMMARY deviation 5).
set +e

# ── 1. HR and payroll are genuinely enabled, not assumed ────────────────────────────────────
echo "── 1. HR and payroll (the 13-CONTEXT regression) ──"

# Read the entitlement back over HTTP from the service that owns it, rather than trusting the tier
# matrix or the database. This is the difference between "the code exists in TierFeatureDefaults" and
# "this tenant is actually entitled", and only the second one decides whether a request gets through.
FEATURES_JSON="$(curl_retry "${PLATFORM_ORIGIN}/internal/platform/tenants/${TENANT_ID}/features" \
  -H "X-Internal-Service: ${INTERNAL_SECRET}")"
if printf '%s' "$FEATURES_JSON" | python3 -c "
import sys, json
f = json.load(sys.stdin)['data']['features']
sys.exit(0 if f.get('FEATURE_HR') else 1)
" 2>/dev/null; then
  pass "platform-admin reports FEATURE_HR ENABLED for the demo tenant"
else
  fail "platform-admin does not report FEATURE_HR enabled: $(printf '%s' "$FEATURES_JSON" | head -c 200)"
fi

probe "/api/v1/hr/employees" "$ADMIN_TOKEN"
assert_not_feature_blocked "an HR endpoint is not gated off"

# Payroll is served UNDER the HR prefix (/api/v1/hr/payroll-runs), so it gates on FEATURE_HR. The
# orphan FEATURE_PAYROLL mapping on /api/v1/payroll/ has never 403'd anyone because no route matches
# that prefix — an accident of routing, not a guarantee, which is why FeatureCodeClosureTest now
# fails the build on a gated code the tier matrix does not define.
probe "/api/v1/hr/payroll-runs" "$ADMIN_TOKEN"
assert_not_feature_blocked "a payroll endpoint under the HR prefix is not gated off"

# The codes added to the tier matrix in this plan are seeded at PROVISIONING time. A tenant created
# before them has no row, and a missing row reads as "not entitled". Reported, not asserted as a
# pass: it is a real gap that the seed script in 13-14 has to close.
echo
echo "── tier-matrix codes with no row on this (pre-existing) tenant ──"
printf '%s\n' "
  SELECT c.code FROM (VALUES ('FEATURE_PAYROLL'),('FEATURE_ANALYTICS'),('FEATURE_LOYALTY'),
                             ('FEATURE_ECOMMERCE'),('FEATURE_NLQ')) AS c(code)
  WHERE NOT EXISTS (SELECT 1 FROM tenant_features tf
                    WHERE tf.tenant_id='${TENANT_ID}' AND tf.feature_code=c.code);
" | platform_sql | sed 's/^/    missing: /'
echo "    (provisioning seeds from TierFeatureDefaults.defaultsFor; existing tenants are not"
echo "     backfilled. Harmless today — no gateway route matches those prefixes — and a 403 the"
echo "     day one is added. Belongs to the seed script in 13-14.)"

# ── 2. Feature gating, both directions, against a live upstream ─────────────────────────────
echo
echo "── 2. ${PROBE_FEATURE} gating on ${PROBE_PATH} ──"

set_feature "$PROBE_FEATURE" true
probe "$PROBE_PATH" "$ADMIN_TOKEN"
assert_ok "baseline: ${PROBE_FEATURE} enabled"

set_feature "$PROBE_FEATURE" false
probe "$PROBE_PATH" "$ADMIN_TOKEN"
assert_feature_blocked "$PROBE_FEATURE" "${PROBE_FEATURE} disabled refuses the route"

set_feature "$PROBE_FEATURE" true
probe "$PROBE_PATH" "$ADMIN_TOKEN"
assert_ok "re-enabling ${PROBE_FEATURE} restores access"

# The gate is per-tenant-per-feature, not a global switch: an unrelated feature's route must be
# unaffected while this one is off. Without this, a filter that refused everything would pass above.
set_feature "$PROBE_FEATURE" false
probe "/api/v1/finance/accounts" "$ADMIN_TOKEN"
assert_not_feature_blocked "an unrelated feature's route is unaffected while ${PROBE_FEATURE} is off"
set_feature "$PROBE_FEATURE" true

# ── 3. Suspension ───────────────────────────────────────────────────────────────────────────
echo
echo "── 3. suspension ──"

set_tenant_status SUSPENDED
probe "$PROBE_PATH" "$ADMIN_TOKEN"
assert_code 403 "TENANT_SUSPENDED" "a suspended tenant is refused on a feature-gated route"

# Suspension outranks entitlement: the status check runs first, so a suspended tenant is told it is
# suspended rather than being told the feature is off. An operator reading FEATURE_DISABLED here
# would go looking for the wrong thing.
probe "/api/v1/finance/accounts" "$ADMIN_TOKEN"
assert_code 403 "TENANT_SUSPENDED" "suspension refuses every tenant-scoped route, not just one"

set_tenant_status ACTIVE
probe "$PROBE_PATH" "$ADMIN_TOKEN"
assert_ok "reactivating restores access"

# ── 4. Fail closed when nobody can answer (opt-in) ──────────────────────────────────────────
#
# Opt-in because it stops a shared service. The behaviour itself is asserted unconditionally, and
# more thoroughly, by FeatureFlagFilterIT (platform-admin erroring AND answering empty, plus the
# fail-open lever). This block is the same claim against the real stack.
assert_status_cache_empty() {
  if [[ "$(redis_do EXISTS "tenant:status:${TENANT_ID}")" == "0" ]]; then
    pass "$1"
  else
    fail "$1 — the undetermined status was CACHED as '$(redis_do GET "tenant:status:${TENANT_ID}")'"
  fi
}

if [[ "${PHASE13_PROVE_FAIL_CLOSED:-0}" == "1" ]]; then
  echo
  echo "── 4. an undeterminable status, both postures (D-33) ──"
  echo "    (this machine's dev stack configures fail-open-on-platform-down=${GATEWAY_FAIL_OPEN_DEFAULT})"

  # ---- 4a. the production default: refuse ----
  GATEWAY_FAIL_OPEN_OVERRIDDEN=1
  if ! restart_gateway false; then
    fail "could not restart the gateway with fail-open disabled"
  elif ! warm_gateway "$ADMIN_TOKEN"; then
    fail "the gateway breaker never warmed; a 503 here could not be attributed to the status filter"
  elif ! stop_platform_admin; then
    fail "could not find the platform-admin-service process to stop"
  else
    probe "$PROBE_PATH" "$ADMIN_TOKEN"
    assert_code 503 "TENANT_STATUS_UNAVAILABLE" "fail-open OFF: an undeterminable status REFUSES the request"
    # The prohibition that keeps a blip from becoming a five-minute outage.
    assert_status_cache_empty "fail-open OFF: nothing was written to the status cache"

    start_platform_admin
    drop_status_cache
    warm_gateway "$ADMIN_TOKEN" > /dev/null
    probe "$PROBE_PATH" "$ADMIN_TOKEN"
    assert_ok "fail-open OFF: access returns once platform-admin can answer again"
  fi

  # ---- 4b. the break-glass: proceed, but still determine nothing ----
  #
  # The second assertion here is the one that regressed silently before this plan.
  # PlatformAdminClient.getStatus used to answer "ACTIVE" on any error while fail-open was on. That
  # value was indistinguishable from a real determination, so the filter CACHED it — and the cached
  # fabrication then outlived the operator turning fail-open back off.
  GATEWAY_FAIL_OPEN_OVERRIDDEN=1
  if restart_gateway true && warm_gateway "$ADMIN_TOKEN" && stop_platform_admin; then
    probe "$PROBE_PATH" "$ADMIN_TOKEN"
    assert_ok "fail-open ON: the break-glass lever lets the request through"
    assert_status_cache_empty "fail-open ON: a fail-open decision is still not a determination"
    start_platform_admin
    # The gateway is now back on this machine's configured value, so the trap has nothing to undo.
    [[ "$GATEWAY_FAIL_OPEN_DEFAULT" == "true" ]] && GATEWAY_FAIL_OPEN_OVERRIDDEN=""
  else
    fail "could not set up the fail-open half of the outage proof"
  fi
else
  echo
  echo "── 4. outage proof SKIPPED (set PHASE13_PROVE_FAIL_CLOSED=1 to run; it restarts the gateway"
  echo "      and platform-admin-service). Asserted unconditionally by FeatureFlagFilterIT. ──"
fi

echo
phase13_summary
