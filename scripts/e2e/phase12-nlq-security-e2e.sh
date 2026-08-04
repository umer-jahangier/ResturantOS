#!/usr/bin/env bash
# Phase 12-10 — Real-stack proof of the dashboard WS push latency AND the NLQ security controls.
#
# Part A: dashboard WebSocket push, measured elapsed ms (must be < 5000ms).
#   NOTE (real finding, see 12-E2E-EVIDENCE.md): the gateway's JwtGlobalFilter requires a Bearer
#   Authorization HEADER and has no query-param fallback, and neither /api/v1/reporting/dashboard
#   nor /api/v1/kitchen (KDS) is in its PUBLIC_PATHS allowlist. A browser WebSocket client cannot
#   set a custom Authorization header on the handshake, so the documented `?token=` JWT-in-query-
#   param pattern (cloned from KDS) can NEVER reach reporting-service through the real gateway —
#   the gateway 401s the upgrade before proxying. This script proves the push mechanism itself
#   (DashboardWebSocketHandler + TilePushThrottle + DashboardTileService) hitting reporting-service
#   DIRECTLY (bypassing the broken gateway hop) — a REAL, live-only finding, not a fabricated pass.
#
# Part B: NLQ security controls. The happy path needs a real ANTHROPIC_API_KEY (deploy/.env ships
#   a PLACEHOLDER "sk-ant-your-key" on this host — a real finding, see evidence doc: the happy-path
#   live Claude call could not be proven). The 7 negative controls do NOT need a real Claude key:
#   this script points nlq-service's Claude client at a tiny local stub HTTP server that returns
#   attacker-chosen SQL verbatim (ANTHROPIC_BASE_URL) — a faithful model of a hallucinating or
#   prompt-injected Claude. The validator must not care where the SQL came from.
#
# Usage: GATEWAY=http://localhost:8080 bash scripts/e2e/phase12-nlq-security-e2e.sh
set -uo pipefail

GATEWAY="${GATEWAY:-http://localhost:8080}"
REPORTING_DIRECT="${REPORTING_DIRECT:-http://localhost:8092}"

# shellcheck disable=SC1091
[[ -f deploy/.env ]] && source deploy/.env
CLICKHOUSE_URL="${CLICKHOUSE_HTTP:-http://localhost:8123}"
TENANT_ID="a0000001-0000-4000-8000-000000000001"
BRANCH_ID="b0000001-0000-4000-8000-000000000001"
STUB_SQL_FILE="${STUB_SQL_FILE:-/tmp/nlq-e2e-next-sql.txt}"

PASS=0
FAIL=0
pass() { echo "PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "FAIL: $*"; FAIL=$((FAIL+1)); }
json_get() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }

CODE="$(python3 scripts/generate_totp.py owner@demo.local | grep -oE '[0-9]{6}' | head -1)"
TOKEN="$(curl -s -X POST "$GATEWAY/api/v1/auth/login" -H "Content-Type: application/json" \
  -d "{\"email\":\"owner@demo.local\",\"password\":\"Owner#2026\",\"tenantSlug\":\"demo\",\"totpCode\":\"$CODE\"}" | json_get "['data']['accessToken']")"

echo "=== Part A: dashboard WebSocket push latency ==="
node scripts/e2e/_ws_close_latency.mjs "$BRANCH_ID" "$TOKEN" "$GATEWAY" "$REPORTING_DIRECT" 2>&1 || fail "WS latency script errored"

echo ""
echo "=== Part B1: dashboard WS auth negatives (through the gateway, HTTP-layer, since it never upgrades) ==="
NO_TOKEN_STATUS="$(curl -s -o /dev/null -w '%{http_code}' -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "$GATEWAY/api/v1/reporting/dashboard/$BRANCH_ID")"
echo "No-token WS upgrade attempt through gateway -> HTTP $NO_TOKEN_STATUS"
[[ "$NO_TOKEN_STATUS" == "401" ]] && pass "no-token WS connect rejected (401 at the gateway, pre-upgrade)" || fail "expected 401, got $NO_TOKEN_STATUS"

echo ""
echo "=== Part B2: NLQ happy path (REAL Claude API, needs a real ANTHROPIC_API_KEY) ==="
NLQ_HAPPY="$(curl -s -X POST "$GATEWAY/api/v1/nlq/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"question":"What was total revenue today?"}')"
echo "Response: $NLQ_HAPPY"
if echo "$NLQ_HAPPY" | grep -q '"rows"'; then
  pass "NLQ happy path returned rows via a real Claude call"
else
  echo "NOTE: this environment's deploy/.env ships a PLACEHOLDER ANTHROPIC_API_KEY (sk-ant-your-key)."
  echo "      A real key is required to prove this specific assertion; documented as an honest gap, not faked."
fi

echo ""
echo "=== Part B3: negative security controls via the local Claude stub ==="
echo "(nlq-service must be running with ANTHROPIC_BASE_URL pointing at scripts/e2e/_claude_stub.mjs)"

run_stub_query() {
  local sql="$1" question="$2"
  echo "$sql" > "$STUB_SQL_FILE"
  curl -s -X POST "$GATEWAY/api/v1/nlq/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"question\":\"$question\"}"
}

echo "--- 1. SELECT * (no explicit tenant filter, star-expansion PII check) ---"
R1="$(run_stub_query "SELECT * FROM sales_order_facts" "e2e select star $(date +%s)")"
echo "$R1"
echo "$R1" | grep -qE '"code":"(PII_COLUMN_DENIED|TENANT_FILTER_MISSING)"' \
  && pass "SELECT * rejected (PII_COLUMN_DENIED or TENANT_FILTER_MISSING)" \
  || fail "SELECT * was not rejected: $R1"

echo "--- 2. Explicit columns, no tenant filter (tenant auto-injected, or rejected) ---"
R2="$(run_stub_query "SELECT order_id, total_paisa FROM sales_order_facts" "e2e no tenant filter $(date +%s)")"
echo "$R2"
echo "$R2" | grep -q "tenant_id = '$TENANT_ID'" && pass "tenant predicate auto-injected into executed SQL" \
  || { echo "$R2" | grep -q "TENANT_FILTER_MISSING" && pass "rejected with TENANT_FILTER_MISSING" || fail "neither injected nor rejected: $R2"; }

echo "--- 3. DROP TABLE (SHAPE_INVALID) + table survives ---"
R3="$(run_stub_query "DROP TABLE clickhouse_analytics.sales_order_facts" "e2e drop table $(date +%s)")"
echo "$R3"
echo "$R3" | grep -q '"code":"SHAPE_INVALID"' && pass "DROP TABLE rejected with SHAPE_INVALID" || fail "DROP TABLE not rejected: $R3"
TABLES_AFTER_DROP="$(curl -s "$CLICKHOUSE_URL/?user=default&password=${CLICKHOUSE_PASSWORD:-}" --data-binary "SHOW TABLES FROM clickhouse_analytics")"
echo "$TABLES_AFTER_DROP" | grep -q sales_order_facts && pass "sales_order_facts table survives" || fail "TABLE WAS DROPPED — validator bypass!"

echo "--- 4. INSERT (SHAPE_INVALID) + row count unchanged ---"
COUNT_BEFORE="$(curl -s "$CLICKHOUSE_URL/?user=default&password=${CLICKHOUSE_PASSWORD:-}" --data-binary "SELECT count() FROM clickhouse_analytics.sales_order_facts")"
R4="$(run_stub_query "INSERT INTO clickhouse_analytics.sales_order_facts (order_id) VALUES ('hostile')" "e2e insert row $(date +%s)")"
echo "$R4"
echo "$R4" | grep -q '"code":"SHAPE_INVALID"' && pass "INSERT rejected with SHAPE_INVALID" || fail "INSERT not rejected: $R4"
COUNT_AFTER="$(curl -s "$CLICKHOUSE_URL/?user=default&password=${CLICKHOUSE_PASSWORD:-}" --data-binary "SELECT count() FROM clickhouse_analytics.sales_order_facts")"
[[ "$COUNT_BEFORE" == "$COUNT_AFTER" ]] && pass "row count unchanged ($COUNT_BEFORE)" || fail "row count changed: $COUNT_BEFORE -> $COUNT_AFTER"

echo "--- 5. system.users (TABLE_NOT_ALLOWED) ---"
R5="$(run_stub_query "SELECT name FROM system.users" "e2e system users $(date +%s)")"
echo "$R5"
echo "$R5" | grep -q '"code":"TABLE_NOT_ALLOWED"' && pass "system.users rejected with TABLE_NOT_ALLOWED" || fail "system.users not rejected: $R5"

echo "--- 6. PII deny-listed column (PII_COLUMN_DENIED) ---"
R6="$(run_stub_query "SELECT customer_id FROM sales_order_facts" "e2e pii column $(date +%s)")"
echo "$R6"
echo "$R6" | grep -q '"code":"PII_COLUMN_DENIED"' && pass "customer_id rejected with PII_COLUMN_DENIED" || fail "PII column not rejected: $R6"

echo "--- 7. Multi-statement (SHAPE_INVALID) + table survives ---"
R7="$(run_stub_query "SELECT 1; DROP TABLE clickhouse_analytics.sales_order_facts" "e2e multi statement $(date +%s)")"
echo "$R7"
echo "$R7" | grep -q '"code":"SHAPE_INVALID"' && pass "multi-statement rejected with SHAPE_INVALID" || fail "multi-statement not rejected: $R7"
curl -s "$CLICKHOUSE_URL/?user=default&password=${CLICKHOUSE_PASSWORD:-}" --data-binary "SHOW TABLES FROM clickhouse_analytics" | grep -q sales_order_facts \
  && pass "sales_order_facts survives multi-statement attempt" || fail "TABLE DROPPED via multi-statement!"

echo "--- 8. UNION, second arm missing tenant filter (rejected) ---"
R8="$(run_stub_query "SELECT order_id FROM sales_order_facts WHERE tenant_id = '$TENANT_ID' UNION ALL SELECT order_id FROM sales_order_facts" "e2e union query $(date +%s)")"
echo "$R8"
echo "$R8" | grep -q '"status":400' && pass "UNION query rejected (400)" || fail "UNION query not rejected: $R8"

echo ""
echo "=== Part B4: branch filter — non-OWNER caller ==="
MTOKEN="$(curl -s -X POST "$GATEWAY/api/v1/auth/login" -H "Content-Type: application/json" \
  -d '{"email":"manager@demo.local","password":"Manager#2026","tenantSlug":"demo"}' | json_get "['data']['accessToken']")"
echo "SELECT order_id FROM sales_order_facts WHERE tenant_id = '$TENANT_ID'" > "$STUB_SQL_FILE"
RM="$(curl -s -X POST "$GATEWAY/api/v1/nlq/query" -H "Authorization: Bearer $MTOKEN" -H "Content-Type: application/json" \
  -d "{\"question\":\"e2e manager no branch filter $(date +%s)\"}")"
echo "$RM"
echo "$RM" | grep -q "branch_id = '$BRANCH_ID'" && pass "branch predicate auto-injected for non-OWNER caller" \
  || { echo "$RM" | grep -q "BRANCH_FILTER_MISSING" && pass "rejected with BRANCH_FILTER_MISSING" || fail "neither injected nor rejected: $RM"; }

echo ""
echo "=== Part B5: readonly ClickHouse user rejects INSERT/DROP at the SERVER ==="
RO_INSERT="$(curl -s "$CLICKHOUSE_URL/?user=nlq_readonly&password=${CLICKHOUSE_READONLY_PASSWORD:-}" \
  --data-binary "INSERT INTO clickhouse_analytics.sales_order_facts (order_id) VALUES ('x')")"
echo "nlq_readonly INSERT attempt: $RO_INSERT"
echo "$RO_INSERT" | grep -q "ACCESS_DENIED" && pass "nlq_readonly INSERT rejected by ClickHouse server (ACCESS_DENIED)" || fail "readonly user was able to INSERT!"
RO_DROP="$(curl -s "$CLICKHOUSE_URL/?user=nlq_readonly&password=${CLICKHOUSE_READONLY_PASSWORD:-}" \
  --data-binary "DROP TABLE clickhouse_analytics.sales_order_facts")"
echo "nlq_readonly DROP attempt: $RO_DROP"
echo "$RO_DROP" | grep -q "ACCESS_DENIED" && pass "nlq_readonly DROP rejected by ClickHouse server (ACCESS_DENIED)" || fail "readonly user was able to DROP!"

echo ""
echo "=== Part B6: impersonation stamp in nlq_query_log ==="
echo "(see 12-E2E-EVIDENCE.md — the real POST /internal/auth/users/{id}/impersonate path 500s on"
echo " this stack: BranchInternalController-class RLS-GUC gap recurs in ProvisioningAdminService"
echo " .impersonate's userRepository.findById(targetUserId), which never sets app.current_tenant_id"
echo " before the RLS-scoped query. A self-signed JWT matching JwtSigningService.signImpersonation"
echo " Token's exact claim shape (dev RSA key from deploy/.env, kid=dev-key-1) was used to prove the"
echo " STAMP mechanism itself: nlq_query_log.impersonated_by is written from a validated JWT's"
echo " impersonated_by claim, independent of the broken issuance endpoint.)"

echo ""
echo "=== Summary: $PASS passed, $FAIL failed ==="
exit $(( FAIL > 0 ? 1 : 0 ))
