#!/usr/bin/env bash
# Phase 13-09 — the hardened password-reset flow, proved against the LIVE stack.
#
# WHY THIS EXISTS (D-30). The audit found .planning/phases/03-*/03-VERIFICATION.md scoring Phase 3
# "24/24 passed" while citing a controller that does not exist, because that verification grepped
# source. This one reads no source file. Every assertion is a request to ${GATEWAY} or a query
# against the live auth_db — whose owner auth_user is NOSUPERUSER NOBYPASSRLS, so every row-level
# security policy that Testcontainers' SUPERUSER makes inert in the integration suite is really
# enforced here.
#
# That distinction has now hidden FOUR shipped defects in this phase alone: 13-02's branch-role
# write, 13-06's user INSERT, 13-08's discovery that reset-confirm could never find its own token,
# and it is the reason this script exists at all. 13-09 adds a NEW row-level-security-scoped read
# to the reset request path — the per-account cooldown — and a read that comes back empty under RLS
# fails SILENTLY OPEN: no recent issuance found, therefore no cooldown, therefore issue every time.
# Assertion 6 below is what would catch that, and it cannot be caught in Testcontainers.
#
# WHAT IT PROVES (ROADMAP SC4, in part)
#   1. The outbox payload for a reset request contains NO value from which the raw token can be
#      recovered — proved by hashing every string in the persisted payload against the token_hash
#      the same request wrote. This is the only assertion that would have caught the defect, and it
#      needs no knowledge of the raw token, which is the point.
#   2. A raw token whose value this script knows by construction still redeems: the hash path is
#      untouched, and reset-confirm really works against an RLS-enforcing database.
#   3. A persona that was genuinely locked out logs in IMMEDIATELY after completing a reset, and its
#      failed_login_count and locked_until are cleared in the database.
#   4. A known and an unknown address get byte-identical responses.
#   5. Two rapid requests leave exactly ONE unredeemed token, and both responses are identical — the
#      cooldown is enforced server-side and is invisible.
#   6. In disabled mode nothing is issued, nothing is written, and the response carries
#      RESET_DELIVERY_DISABLED.
#
# THIS SCRIPT RESTARTS auth-service TWICE — once into outbox mode, once back to the shipped default.
# The delivery mode is read at startup by design (a flow that can be switched on by a request is a
# flow that can be switched on by an attacker's request). Nothing else is restarted. The final
# state is auth-service on its shipped default, which is the mode it was in before the run.
#
# PRECONDITIONS
#   - Docker infra up; gateway, auth-service and user-service running and Eureka-registered.
#   - auth-service's jar MUST be built AFTER plan 13-09. Against a stale jar the request endpoint
#     issues in every mode and assertion 6 fails loudly rather than reporting a meaningless pass.
#
# Usage: bash scripts/e2e/phase13-reset-hardening-e2e.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck disable=SC1091
. scripts/e2e/_phase13-lib.sh

USER_ORIGIN="${USER_ORIGIN:-http://localhost:8082}"
AUTH_JAR="services/auth-service/target/auth-service-1.0.0.jar"
# The same directory scripts/start-dev.sh uses, so a developer looking for auth-service's log after
# this script restarted it finds it where they already expect it.
AUTH_LOG="${AUTH_LOG:-$REPO_ROOT/.dev-logs/auth-service.log}"

# ── Throwaway identifiers, derived deterministically from this script's name ─────────────────
uuid5_for() {
  python3 -c "
import uuid, sys
print(uuid.uuid5(uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8'), sys.argv[1]))
" "$1"
}

SEAM="phase13-reset-hardening"
TENANT_ID="$(uuid5_for "restaurantos/e2e/${SEAM}/tenant")"
TENANT_SLUG="e2e-1309-reset"
SUBJECT_EMAIL="reset-subject@${TENANT_SLUG}.local"

# All satisfy the shared @StrongPassword policy (>= 8 chars, all four character classes).
FIRST_PASSWORD='Fq7!vwmtBn3%'
RESET_PASSWORD='Kd8@zprtWn5#'
WRONG_PASSWORD='Nope#NotMine1'

# ── SQL ─────────────────────────────────────────────────────────────────────────────────────

auth_sql() {
  docker exec -i restaurantos-postgres psql -U auth_user -d auth_db -v ON_ERROR_STOP=1 -qtA
}
user_sql() {
  docker exec -i restaurantos-postgres psql -U user_service -d user_db -v ON_ERROR_STOP=1 -qtA
}

# Every statement runs with the tenant GUC set in the SAME session, because users,
# user_branch_roles, refresh_sessions, password_reset_tokens, password_history and event_outbox are
# FORCE ROW LEVEL SECURITY on app.current_tenant_id. Without it these queries match zero rows and
# report success — which is the exact failure mode this script exists to detect, so it must not be
# the failure mode of the script itself.
scoped_sql() {
  printf 'SELECT set_config(%s, %s, false);\n%s\n' "'app.current_tenant_id'" "'${TENANT_ID}'" "$1" | auth_sql
}

purge_sql() {
  scoped_sql "
    DELETE FROM password_reset_tokens WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM refresh_sessions WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM user_branch_roles WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM password_history WHERE user_id IN (SELECT id FROM users WHERE tenant_id = '${TENANT_ID}');
    DELETE FROM event_outbox WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM users WHERE tenant_id = '${TENANT_ID}';
    DELETE FROM auth_tenants WHERE id = '${TENANT_ID}';
  " > /dev/null 2>&1 || true
  printf '%s\n' "
    SELECT set_config('app.current_tenant_id', '${TENANT_ID}', false);
    DELETE FROM branches WHERE tenant_id = '${TENANT_ID}';
  " | user_sql > /dev/null 2>&1 || true
}

# ── auth-service lifecycle ──────────────────────────────────────────────────────────────────

auth_pid() {
  pgrep -f "java -jar ${AUTH_JAR}" 2>/dev/null | head -1
}

# Restart auth-service with a given delivery mode. An EMPTY mode means "no override" — i.e. exactly
# what application.yml ships, which is what the run must leave behind.
restart_auth() {
  local mode="${1:-}"
  local label="${mode:-<shipped default>}"
  local pid
  pid="$(auth_pid || true)"
  if [[ -n "$pid" ]]; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do
      [[ -z "$(auth_pid || true)" ]] && break
      sleep 0.5
    done
    [[ -n "$(auth_pid || true)" ]] && kill -9 "$(auth_pid)" 2>/dev/null || true
  fi

  mkdir -p "$(dirname "$AUTH_LOG")"
  (
    cd "$REPO_ROOT"
    # shellcheck disable=SC1091
    source scripts/dev-env.sh
    # shellcheck disable=SC1091
    source scripts/local-service-env.sh
    if [[ -n "$mode" ]]; then
      export PASSWORD_RESET_DELIVERY_MODE="$mode"
    else
      unset PASSWORD_RESET_DELIVERY_MODE
    fi
    exec java -jar "$AUTH_JAR"
  ) >>"$AUTH_LOG" 2>&1 &

  echo "  restarting auth-service with delivery-mode=${label} (log: ${AUTH_LOG})" >&2
  await_auth_reachable_through_gateway
}

# Readiness is measured THROUGH THE GATEWAY, not at auth-service's own /actuator/health. The
# gateway routes lb://auth-service off its Eureka cache, so a service that is up but not yet
# rediscovered answers 503 — and an assertion made in that window fails for a reason that has
# nothing to do with the code under test. Garbage credentials are used deliberately: a 401 is the
# application answering on the merits, which is the only proof that the route is live.
#
# THREE STAGES, and every one of them was added because the previous version was not enough. This
# is the most expensive part of the script and it is worth every second: a run that starts asserting
# while the gateway is still load-balancing onto a dead instance reports PRODUCT defects that are
# entirely its own. Measured, in order of discovery:
#
#   1. A single 401 is not enough. The Resilience4j breaker on a cold lb:// pool answers with its
#      SERVICE_UNAVAILABLE fallback for a while after the backend is healthy (the 10-13-H mode this
#      repo documents). A run that took the first 401 as ready spent its first FOUR wrong-password
#      attempts on 503s — recording one failure instead of five, so the account never locked.
#   2. A streak of 401s is not enough either. Eureka holds the KILLED instance's lease for up to 90
#      seconds, so the gateway round-robins between a live instance and a dead one: a streak can
#      pass by luck and the very next call still 503s. The next run failed in setup for exactly
#      that reason.
#   3. So: wait for Eureka to be down to ONE UP instance, then wait out the gateway's own registry
#      fetch interval (30s by default) so its cached view catches up, then require a streak.
await_auth_reachable_through_gateway() {
  local body code streak=0 ups

  for _ in $(seq 1 120); do
    ups="$(curl -s -H 'Accept: application/json' --max-time 5 \
      "http://localhost:8761/eureka/apps/AUTH-SERVICE" 2>/dev/null \
      | python3 -c "
import sys, json
try:
    app = json.load(sys.stdin)['application']
    instances = app['instance']
    if isinstance(instances, dict):
        instances = [instances]
    print(sum(1 for i in instances if i.get('status') == 'UP'))
except Exception:
    print(-1)
" || echo -1)"
    [[ "$ups" == "1" ]] && break
    sleep 1
  done
  if [[ "$ups" != "1" ]]; then
    echo "SETUP FAILED: Eureka reports ${ups} UP auth-service instances, expected exactly 1" >&2
    exit 1
  fi

  # The gateway's own registry cache, not Eureka's. Nothing observable tells us it has refreshed,
  # so this is the one place the script waits on a clock rather than on a fact.
  sleep 35

  body="$(json_obj email "nobody@${TENANT_SLUG}.local" password "$WRONG_PASSWORD" tenantSlug "$TENANT_SLUG")"
  for _ in $(seq 1 120); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST "${GATEWAY}/api/v1/auth/login" \
      -H "Content-Type: application/json" -d "$body" || true)"
    if [[ "$code" == "401" ]]; then
      streak=$((streak + 1))
      [[ "$streak" -ge 10 ]] && return 0
    else
      streak=0
    fi
    sleep 1
  done
  echo "SETUP FAILED: auth-service never became routable through ${GATEWAY} (last status ${code})" >&2
  echo "  tail -40 ${AUTH_LOG}" >&2
  exit 1
}

cleanup() {
  local code=$?
  set +e
  purge_sql
  # Restore the delivery mode by restarting WITHOUT an override, so the box is left running the
  # mode application.yml ships rather than whatever this run needed.
  if [[ "${MODE_OVERRIDDEN:-false}" == true ]]; then
    restart_auth "" >/dev/null 2>&1
  fi
  echo "Cleaned up throwaway tenant ${TENANT_ID}; auth-service restored to its shipped delivery mode"
  exit $code
}
trap cleanup EXIT

# ── Helpers ─────────────────────────────────────────────────────────────────────────────────

# Bodies are ALWAYS built from ARGUMENTS. An inline -d "{\"a\":1,\"b\":2}" is brace-expanded by
# bash into two malformed fragments and curl runs twice (13-02); building one inside "$( … )" has
# its escaped quotes consumed before the helper sees them (13-07).
json_obj() {
  python3 -c "
import json, sys
args = sys.argv[1:]
print(json.dumps(dict(zip(args[0::2], args[1::2]))))
" "$@"
}

auth_internal_post() {
  curl_retry -X POST "${AUTH_ORIGIN}${1}" \
    -H "Content-Type: application/json" \
    -H "X-Internal-Service: ${INTERNAL_SECRET}" \
    -d "${2}"
}

# One request, status on line 1 and body on the rest. Two separate curls against an endpoint that
# mints a single-use token per call are not the same experiment (13-05 had to fix exactly that).
reset_request_raw() {
  local body
  body="$(json_obj email "${1}" tenantSlug "${2:-$TENANT_SLUG}")"
  local response
  response="$(curl -s -w '\n%{http_code}' -X POST "${GATEWAY}/api/v1/auth/reset-password/request" \
    -H "Content-Type: application/json" -d "$body")"
  printf '%s\n%s' "$(printf '%s' "$response" | tail -1)" "$(printf '%s' "$response" | sed '$d')"
}

reset_confirm_raw() {
  local body
  body="$(json_obj token "${1}" newPassword "${2}")"
  local response
  response="$(curl -s -w '\n%{http_code}' -X POST "${GATEWAY}/api/v1/auth/reset-password/confirm" \
    -H "Content-Type: application/json" -d "$body")"
  printf '%s\n%s' "$(printf '%s' "$response" | tail -1)" "$(printf '%s' "$response" | sed '$d')"
}

login_status() {
  local body
  body="$(json_obj email "${1}" password "${2}" tenantSlug "${TENANT_SLUG}")"
  curl_status -X POST "${GATEWAY}/api/v1/auth/login" -H "Content-Type: application/json" -d "$body"
}

echo "=== Phase 13-09: the hardened password-reset flow, over live HTTP + live auth_db ==="
echo "gateway=${GATEWAY}  auth=${AUTH_ORIGIN}  user=${USER_ORIGIN}"
echo "tenant=${TENANT_ID}  slug=${TENANT_SLUG}"
echo

if [[ ! -f "$AUTH_JAR" ]]; then
  echo "SETUP FAILED: ${AUTH_JAR} does not exist — build it first." >&2
  exit 1
fi

purge_sql

# ── Put the service into outbox mode for the run ────────────────────────────────────────────

MODE_OVERRIDDEN=true
restart_auth outbox

# ── Setup: a disposable persona with a password it chose itself ──────────────────────────────

BRANCH_BODY="$(python3 -c "
import json, sys
print(json.dumps({'tenantId': sys.argv[1], 'name': 'Reset HQ', 'isHq': True}))
" "$TENANT_ID")"
BRANCH_RESPONSE="$(curl_retry -X POST "${USER_ORIGIN}/internal/users/branches" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Service: ${INTERNAL_SECRET}" -d "$BRANCH_BODY")"
BRANCH_ID="$(printf '%s' "$BRANCH_RESPONSE" | json_get "['branchId']" 2>/dev/null || true)"
if [[ -z "$BRANCH_ID" || "$BRANCH_ID" == "None" ]]; then
  echo "SETUP FAILED: no branchId from user-service: ${BRANCH_RESPONSE}" >&2
  exit 1
fi

auth_internal_post "/internal/auth/tenants" \
  "$(json_obj tenantId "${TENANT_ID}" slug "${TENANT_SLUG}" name "Reset Hardening Co")" > /dev/null

PROVISION_RESPONSE="$(auth_internal_post "/internal/auth/tenants/${TENANT_ID}/provision-admin" \
  "$(json_obj email "${SUBJECT_EMAIL}" branchId "${BRANCH_ID}" roleCode CASHIER fullName "Reset Subject")")"
TEMP_PASSWORD="$(printf '%s' "$PROVISION_RESPONSE" | json_get "['data']['tempPassword']" 2>/dev/null || true)"
SUBJECT_ID="$(printf '%s' "$PROVISION_RESPONSE" | json_get "['data']['userId']" 2>/dev/null || true)"
if [[ -z "$TEMP_PASSWORD" || "$TEMP_PASSWORD" == "None" ]]; then
  echo "SETUP FAILED: provision-admin returned no temp password: ${PROVISION_RESPONSE}" >&2
  exit 1
fi

# A provisioned account carries must_change_password (13-08), so its first login is refused with a
# change token. Complete that here: this script is about RESET, and a persona still sitting behind
# the forced-change gate would make every login assertion below ambiguous.
REFUSAL="$(curl_retry -X POST "${GATEWAY}/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "$(json_obj email "${SUBJECT_EMAIL}" password "${TEMP_PASSWORD}" tenantSlug "${TENANT_SLUG}")")"
CHANGE_TOKEN="$(change_token_from "$REFUSAL" || true)"
if [[ -z "$CHANGE_TOKEN" ]]; then
  echo "SETUP FAILED: no forced-change token in the first login refusal: ${REFUSAL}" >&2
  exit 1
fi
FORCED_RESULT="$(forced_change "$CHANGE_TOKEN" "$TEMP_PASSWORD" "$FIRST_PASSWORD")"
if [[ "$(printf '%s' "$FORCED_RESULT" | head -1)" != "200" ]]; then
  echo "SETUP FAILED: forced change did not complete: ${FORCED_RESULT}" >&2
  exit 1
fi
echo "Provisioned ${SUBJECT_EMAIL} (${SUBJECT_ID}) on branch ${BRANCH_ID}, forced change completed"
echo

set +e   # errexit off for the assertion phase: assert_* return 1, and under -e the first failure
         # would silently skip every assertion after it. The exit code comes from phase13_summary.

# ── 1. Lock the persona out for real ────────────────────────────────────────────────────────

# Submit wrong passwords until the threshold trips, rather than assuming a fixed count lands. Every
# attempt goes through the gateway, whose auth-route carries a per-IP budget and a circuit breaker
# that can answer the first call after an idle period with its own fallback — so "five requests
# sent" and "five failures recorded" are not the same statement, and a run that quietly recorded
# four would report a product defect that is really a harness artifact. The statuses are printed so
# a failure here is diagnosable from the output alone.
LOCK_ATTEMPTS=""
for _ in $(seq 1 10); do
  attempt_status="$(login_status "$SUBJECT_EMAIL" "$WRONG_PASSWORD")"
  LOCK_ATTEMPTS="${LOCK_ATTEMPTS}${attempt_status} "
  [[ "$attempt_status" == "423" ]] && break
done
echo "  wrong-password attempt statuses: ${LOCK_ATTEMPTS}"
assert_status 423 "$(login_status "$SUBJECT_EMAIL" "$FIRST_PASSWORD")" \
  "wrong passwords lock the account — the CORRECT password is now refused 423"

LOCK_STATE="$(scoped_sql "SELECT locked_until IS NOT NULL FROM users WHERE id = '${SUBJECT_ID}';" | tail -1)"
assert_status "t" "$LOCK_STATE" "and locked_until is set in the database"

# handleFailedPassword ZEROES the counter at the moment it trips the lock, so a genuinely
# locked-out account has failed_login_count = 0 and asserting "0 afterwards" would pass without the
# reset doing anything. Plant a non-zero counter so the assertion at step 5 is about the reset.
scoped_sql "UPDATE users SET failed_login_count = 3 WHERE id = '${SUBJECT_ID}';" > /dev/null
COUNTER_BEFORE="$(scoped_sql "SELECT failed_login_count FROM users WHERE id = '${SUBJECT_ID}';" | tail -1)"
assert_status 3 "$COUNTER_BEFORE" "failed_login_count planted non-zero, so step 5 cannot pass vacuously"

# ── 2. THE LOAD-BEARING ASSERTION: the raw token is not in the outbox payload ────────────────

RESET_RESULT="$(reset_request_raw "$SUBJECT_EMAIL")"
KNOWN_STATUS="$(printf '%s' "$RESET_RESULT" | head -1)"
KNOWN_BODY="$(printf '%s' "$RESET_RESULT" | tail -n +2)"
assert_status 200 "$KNOWN_STATUS" "a reset request for a real account is accepted"

TOKEN_ROW="$(scoped_sql "
  SELECT id || '|' || token_hash FROM password_reset_tokens
   WHERE user_id = '${SUBJECT_ID}' AND purpose = 'RESET'
   ORDER BY created_at DESC LIMIT 1;" | tail -1)"
TOKEN_ID="${TOKEN_ROW%%|*}"
TOKEN_HASH="${TOKEN_ROW##*|}"
if [[ -z "$TOKEN_HASH" || ${#TOKEN_HASH} -ne 64 ]]; then
  echo "FAIL: no RESET token row was written for ${SUBJECT_ID} (got '${TOKEN_ROW}')"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

PAYLOAD="$(scoped_sql "
  SELECT envelope_json FROM event_outbox
   WHERE tenant_id = '${TENANT_ID}' AND event_type = 'PASSWORD_RESET_REQUESTED'
   ORDER BY created_at DESC LIMIT 1;" | tail -1)"

# THE assertion. Hash every string in the persisted payload and compare it with the token_hash the
# same request wrote. If any value in the payload IS the raw token, this fails — and it needs no
# knowledge of the raw token, which is precisely why it is the assertion that would have caught the
# defect. Reads the DATABASE, not a log and not a mock: the value reaching event_outbox is the
# whole finding.
PREIMAGE="$(printf '%s' "$PAYLOAD" | python3 -c "
import sys, json, hashlib
target = sys.argv[1]
def strings(node):
    if isinstance(node, dict):
        for k, v in node.items():
            yield k
            yield from strings(v)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v)
    elif node is not None:
        yield str(node)
payload = json.load(sys.stdin).get('payload', {})
hits = [s for s in strings(payload) if hashlib.sha256(s.encode()).hexdigest() == target]
print(hits[0] if hits else 'NONE')
" "$TOKEN_HASH")"
assert_status "NONE" "$PREIMAGE" \
  "no value in the persisted outbox payload hashes to the stored token_hash — the RAW TOKEN IS GONE"

SHAPE="$(printf '%s' "$PAYLOAD" | python3 -c "
import sys, json
print(','.join(sorted(json.load(sys.stdin).get('payload', {}).keys())))
")"
assert_status "email,tokenId,userId" "$SHAPE" "the payload shape is closed: identity plus a row handle"

PAYLOAD_TOKEN_ID="$(printf '%s' "$PAYLOAD" | json_get "['payload']['tokenId']" 2>/dev/null || true)"
assert_status "$TOKEN_ID" "$PAYLOAD_TOKEN_ID" "the handle is the token ROW's id, which confers nothing on its own"

HASH_LEAK="$(scoped_sql "
  SELECT count(*) FROM event_outbox
   WHERE tenant_id = '${TENANT_ID}' AND envelope_json LIKE '%${TOKEN_HASH}%';" | tail -1)"
assert_status 0 "$HASH_LEAK" "not even the SHA-256 reached an event payload"

# ── 3. A raw token this script knows by construction still redeems ───────────────────────────

# Constructed rather than recovered: the stored form is a SHA-256 and inverting it is the thing the
# hashing exists to prevent. The script picks the raw value and writes only its hash, exactly as
# PasswordPolicyService.issueSingleUseToken does — including the <tenantId>. routing prefix, which
# is how a PUBLIC flow resolves a tenant before the RLS GUC can exist (13-08).
RAW_TOKEN="$(python3 -c "
import base64, os, sys
print(sys.argv[1] + '.' + base64.urlsafe_b64encode(os.urandom(32)).decode().rstrip('='))
" "$TENANT_ID")"
RAW_HASH="$(printf '%s' "$RAW_TOKEN" | python3 -c "
import sys, hashlib
print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())
")"
scoped_sql "
  UPDATE password_reset_tokens SET used_at = now()
   WHERE user_id = '${SUBJECT_ID}' AND purpose = 'RESET' AND used_at IS NULL;
  INSERT INTO password_reset_tokens
    (id, tenant_id, user_id, token_hash, purpose, expires_at, created_at, updated_at)
  VALUES (gen_random_uuid(), '${TENANT_ID}', '${SUBJECT_ID}', '${RAW_HASH}', 'RESET',
          now() + interval '30 minutes', now(), now());
" > /dev/null

RAW_IN_OUTBOX="$(scoped_sql "
  SELECT count(*) FROM event_outbox WHERE envelope_json LIKE '%${RAW_TOKEN}%';" | tail -1)"
assert_status 0 "$RAW_IN_OUTBOX" "a raw token value appears in no event payload anywhere"

RAW_STORED="$(scoped_sql "
  SELECT count(*) FROM password_reset_tokens WHERE token_hash = '${RAW_TOKEN}';" | tail -1)"
assert_status 0 "$RAW_STORED" "and the raw value is not what is stored — only its SHA-256 is"

CONFIRM_RESULT="$(reset_confirm_raw "$RAW_TOKEN" "$RESET_PASSWORD")"
assert_status 200 "$(printf '%s' "$CONFIRM_RESULT" | head -1)" \
  "reset-confirm redeems the token against an RLS-ENFORCING database (auth_user is NOSUPERUSER NOBYPASSRLS)"

assert_status 401 "$(printf '%s' "$(reset_confirm_raw "$RAW_TOKEN" 'Zx4^ptmrLq9@')" | head -1)" \
  "a second redemption of the same token is refused — single use is a conditional UPDATE"

# ── 4. The lockout columns are cleared in the database, not merely bypassed ──────────────────

# READ BEFORE ANY FURTHER LOGIN, and the order is load-bearing rather than tidy. A successful login
# zeroes failed_login_count anyway, so asserting after one would pass even if the reset had done
# nothing; and a deliberately WRONG login increments it back to 1, which is what an earlier draft of
# this script measured and misread as a product defect. The columns are inspected in the state the
# RESET left them in, with nothing in between.
LOCK_AFTER="$(scoped_sql "
  SELECT failed_login_count || '|' || (locked_until IS NULL) || '|' || must_change_password
    FROM users WHERE id = '${SUBJECT_ID}';" | tail -1)"
assert_status "0|true|false" "$LOCK_AFTER" \
  "failed_login_count cleared, locked_until cleared, must_change_password cleared — by the RESET"

# ── 5. The reset really unlocked the account ────────────────────────────────────────────────

assert_status 200 "$(login_status "$SUBJECT_EMAIL" "$RESET_PASSWORD")" \
  "the previously LOCKED-OUT persona logs in immediately after the reset, with no wait"

assert_status 401 "$(login_status "$SUBJECT_EMAIL" "$FIRST_PASSWORD")" \
  "and the old password no longer authenticates"

# ── 6. Non-enumeration and the cooldown, which must be indistinguishable from each other ────

# Clear this account's issuance history so the cooldown assertion below starts from a known state
# rather than from whatever step 2 left behind.
scoped_sql "DELETE FROM password_reset_tokens WHERE user_id = '${SUBJECT_ID}';" > /dev/null

FIRST_REQ="$(reset_request_raw "$SUBJECT_EMAIL")"
FIRST_REQ_STATUS="$(printf '%s' "$FIRST_REQ" | head -1)"
FIRST_REQ_BODY="$(printf '%s' "$FIRST_REQ" | tail -n +2)"

SECOND_REQ="$(reset_request_raw "$SUBJECT_EMAIL")"
SECOND_REQ_STATUS="$(printf '%s' "$SECOND_REQ" | head -1)"
SECOND_REQ_BODY="$(printf '%s' "$SECOND_REQ" | tail -n +2)"

UNKNOWN_REQ="$(reset_request_raw "nobody-$(uuidgen)@${TENANT_SLUG}.local")"
UNKNOWN_REQ_STATUS="$(printf '%s' "$UNKNOWN_REQ" | head -1)"
UNKNOWN_REQ_BODY="$(printf '%s' "$UNKNOWN_REQ" | tail -n +2)"

LIVE_TOKENS="$(scoped_sql "
  SELECT count(*) FROM password_reset_tokens
   WHERE user_id = '${SUBJECT_ID}' AND purpose = 'RESET' AND used_at IS NULL;" | tail -1)"
TOTAL_TOKENS="$(scoped_sql "
  SELECT count(*) FROM password_reset_tokens
   WHERE user_id = '${SUBJECT_ID}' AND purpose = 'RESET';" | tail -1)"

# This is the assertion that would catch the cooldown read failing OPEN under row-level security.
# A read that returns nothing means "no recent issuance", which means issue again — so an RLS
# mistake here produces TWO rows and is invisible in Testcontainers, whose Postgres user is a
# SUPERUSER. It is only visible against this database.
assert_status 1 "$TOTAL_TOKENS" "two rapid requests minted exactly ONE token — the cooldown is enforced server-side"
assert_status 1 "$LIVE_TOKENS" "and exactly one reset token is live for the account"

assert_status "$FIRST_REQ_STATUS" "$SECOND_REQ_STATUS" "the cooldown refusal carries the same status as an issuance"
assert_status "$FIRST_REQ_BODY" "$SECOND_REQ_BODY" \
  "and the SAME BODY, byte for byte — an announced cooldown is an account-existence oracle"
assert_status "$FIRST_REQ_STATUS" "$UNKNOWN_REQ_STATUS" "an unknown address gets the same status as a known one"
assert_status "$FIRST_REQ_BODY" "$UNKNOWN_REQ_BODY" "and the same body, byte for byte"

UNKNOWN_WROTE="$(scoped_sql "
  SELECT count(*) FROM password_reset_tokens WHERE user_id <> '${SUBJECT_ID}';" | tail -1)"
assert_status 0 "$UNKNOWN_WROTE" "and the unknown address wrote nothing at all"

# The control. Without it every equality above would also hold against an endpoint that silently
# does nothing for everybody, which is a different bug wearing this script's green.
assert_status 1 "$TOTAL_TOKENS" "control: the KNOWN address really did issue, so the equalities above mean something"

# ── 7. Disabled mode: nothing issued, nothing written, and it says so ────────────────────────

TOKENS_BEFORE_DISABLED="$TOTAL_TOKENS"
EVENTS_BEFORE_DISABLED="$(scoped_sql "
  SELECT count(*) FROM event_outbox
   WHERE tenant_id = '${TENANT_ID}' AND event_type = 'PASSWORD_RESET_REQUESTED';" | tail -1)"

restart_auth ""   # no override — the SHIPPED default, which is what an operator gets
MODE_OVERRIDDEN=false

DISABLED_REQ="$(reset_request_raw "$SUBJECT_EMAIL")"
DISABLED_STATUS="$(printf '%s' "$DISABLED_REQ" | head -1)"
DISABLED_BODY="$(printf '%s' "$DISABLED_REQ" | tail -n +2)"

assert_status 200 "$DISABLED_STATUS" "disabled mode still answers 200 — the request was accepted, not rejected"
assert_contains "$DISABLED_BODY" 'RESET_DELIVERY_DISABLED' \
  "and carries a stable code a UI can render instead of pretending an email was sent"

TOKENS_AFTER_DISABLED="$(scoped_sql "
  SELECT count(*) FROM password_reset_tokens
   WHERE user_id = '${SUBJECT_ID}' AND purpose = 'RESET';" | tail -1)"
EVENTS_AFTER_DISABLED="$(scoped_sql "
  SELECT count(*) FROM event_outbox
   WHERE tenant_id = '${TENANT_ID}' AND event_type = 'PASSWORD_RESET_REQUESTED';" | tail -1)"
assert_status "$TOKENS_BEFORE_DISABLED" "$TOKENS_AFTER_DISABLED" "disabled mode minted NO token"
assert_status "$EVENTS_BEFORE_DISABLED" "$EVENTS_AFTER_DISABLED" "disabled mode wrote NO outbox row"

DISABLED_UNKNOWN="$(reset_request_raw "nobody-$(uuidgen)@${TENANT_SLUG}.local")"
assert_status "$DISABLED_BODY" "$(printf '%s' "$DISABLED_UNKNOWN" | tail -n +2)" \
  "the disabled response is byte-identical for an unknown address — turning a flow off must not build an oracle"

DISABLED_NO_TENANT="$(reset_request_raw "$SUBJECT_EMAIL" "no-such-tenant-$(uuidgen)")"
assert_status "$DISABLED_BODY" "$(printf '%s' "$DISABLED_NO_TENANT" | tail -n +2)" \
  "and for a tenant that does not exist — the branch returns before any row is read"

if tail -400 "$AUTH_LOG" 2>/dev/null | grep -q 'restaurantos.auth.password-reset.delivery-mode'; then
  echo "PASS: the service warned at startup, naming the property an operator has to change"
  PHASE13_PASS=$((PHASE13_PASS + 1))
else
  echo "FAIL: no startup warning naming restaurantos.auth.password-reset.delivery-mode in ${AUTH_LOG}"
  PHASE13_FAIL=$((PHASE13_FAIL + 1))
fi

# ── 8. Nothing anywhere in this tenant's events carries a password or a token ────────────────

LEAKED="$(scoped_sql "
  SELECT count(*) FROM event_outbox
   WHERE tenant_id = '${TENANT_ID}'
     AND (envelope_json LIKE '%${RAW_TOKEN}%'
       OR envelope_json LIKE '%${RESET_PASSWORD}%'
       OR envelope_json LIKE '%${FIRST_PASSWORD}%'
       OR envelope_json LIKE '%${TEMP_PASSWORD}%'
       OR envelope_json LIKE '%\$2a\$%'
       OR envelope_json LIKE '%\$2b\$%');" | tail -1)"
assert_status 0 "$LEAKED" "no token value, no password and no bcrypt hash reached any event payload"

echo
phase13_summary
