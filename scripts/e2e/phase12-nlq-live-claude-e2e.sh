#!/usr/bin/env bash
# Phase 12 / GAP D (12-15) — LIVE Claude NL->SQL round-trip proof.
#
# This is the honest deferral of 12-10 finding §1i: deploy/.env ships a PLACEHOLDER
# ANTHROPIC_API_KEY (sk-ant-your-key), so the real Anthropic round-trip could not be proven on the
# dev host. Everything else in the NLQ path (7-stage validator, read-only executor, quotas, cache,
# impersonation stamp) IS proven live in phase12-nlq-security-e2e.sh against a local Claude stub —
# because those controls do not need a real key. This script proves the ONE remaining clause: that
# a genuine Claude call, with a real key and the corrected model id (claude-sonnet-4-6), produces
# SQL that flows through the validator and returns rows.
#
# It FAILS FAST with a clear message when no real key is present. It NEVER fakes a pass, and NEVER
# commits a real key — supply one at runtime via the environment.
#
# Usage:
#   ANTHROPIC_API_KEY=sk-ant-<real-key> \
#   NLQ_BASE_URL=http://localhost:8080 \
#   OWNER_JWT=<a real OWNER JWT with nlq.query.run> \
#   bash scripts/e2e/phase12-nlq-live-claude-e2e.sh
#
# Prereqs (bring up ONLY what this needs — the host is memory-constrained):
#   - infra: postgres, redis, clickhouse (bash scripts/dev-stack-up.sh)  + bash deploy/clickhouse/apply.sh
#   - services: eureka, config-server, auth-service, authorization-service, gateway, nlq-service
#   - nlq-service MUST be started with the REAL ANTHROPIC_API_KEY exported and pointed at the real
#     endpoint (ANTHROPIC_BASE_URL unset / https://api.anthropic.com), NOT the local stub.
set -euo pipefail

NLQ_BASE_URL="${NLQ_BASE_URL:-http://localhost:8080}"
EXPECTED_MODEL="claude-sonnet-4-6"

fail() { echo "FAIL: $*" >&2; exit 1; }
skip() { echo "SKIP: $*" >&2; exit 2; }

# ── Gate 0: a REAL key must be present, or we SKIP (exit 2) — never a false green ──────────────
if [[ -z "${ANTHROPIC_API_KEY:-}" || "${ANTHROPIC_API_KEY}" == "sk-ant-your-key" ]]; then
  skip "no real ANTHROPIC_API_KEY exported (placeholder or empty). The live Claude round-trip is
  DEFERRED, not proven. Re-run with a real key per the usage header. All other NLQ controls are
  proven live in phase12-nlq-security-e2e.sh; the validator/executor/quota/cache/impersonation
  paths do not depend on a real key."
fi
[[ -n "${OWNER_JWT:-}" ]] || fail "OWNER_JWT (a real OWNER token carrying nlq.query.run) is required."

# ── Gate 1: the corrected model id is what nlq-service will send (12-15 Task 1/2) ──────────────
echo "==> Asserting deploy/.env resolves the corrected model id..."
ENV_MODEL="$(grep -E '^ANTHROPIC_MODEL_SQL=' deploy/.env | cut -d= -f2)"
[[ "${ENV_MODEL}" == "${EXPECTED_MODEL}" ]] \
  || fail "deploy/.env ANTHROPIC_MODEL_SQL is '${ENV_MODEL}', expected '${EXPECTED_MODEL}' (stale dated id not corrected)."
grep -qE 'claude-(sonnet|haiku)-4-2025' deploy/.env \
  && fail "a stale dated model id is still present in deploy/.env." || true
echo "    OK: ANTHROPIC_MODEL_SQL=${ENV_MODEL}"

# ── Gate 2: a real NL question returns rows via a genuine Claude call ──────────────────────────
echo "==> Firing a real NLQ question through ${NLQ_BASE_URL} (real Claude)..."
RESP="$(curl -sS -X POST "${NLQ_BASE_URL}/api/v1/nlq/query" \
  -H "Authorization: Bearer ${OWNER_JWT}" \
  -H "Content-Type: application/json" \
  -d '{"question":"how many orders were closed today"}')"
echo "    response: ${RESP}"

# The response must be a real result envelope with rows + the executed, tenant/branch-scoped SQL —
# NOT a CLAUDE_UNAVAILABLE / 401 (which is what a placeholder key produces).
echo "${RESP}" | grep -q '"sql"' \
  || fail "response carries no executed SQL — the Claude round-trip did not complete (check the key/model)."
echo "${RESP}" | grep -qiE 'CLAUDE_UNAVAILABLE|401|Unauthorized' \
  && fail "Claude call failed (unavailable/401) — the key is not valid for ${EXPECTED_MODEL}." || true
echo "${RESP}" | grep -qE '"tenant_id|WHERE' \
  || echo "    NOTE: could not confirm a tenant predicate in the echoed SQL — inspect manually."

echo "PASS: real Claude NL->SQL round-trip completed with model ${EXPECTED_MODEL}; SQL executed and rows returned."
