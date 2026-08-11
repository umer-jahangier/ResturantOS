#!/usr/bin/env bash
# Phase 36 (originally numbered 31) shared verification library — SOURCE this, do not execute it.
#
# WHY IT EXISTS
#
# Phase 36 repairs purchasing and inventory. Its first plan (36-01) fixes nothing: it drives the
# whole procure-to-pay chain against the LIVE stack and records where it actually breaks, because
# this project has produced nine defects that were green in tests and broken in reality. Two of
# those defects were invisible precisely because the apparatus used to look for them was wrong:
#
#   1. Testcontainers connects as the database superuser. purchasing_db and inventory_db are FORCE
#      row-level security since phase 17b, and Postgres exempts a table's OWNER from its own policy
#      unless FORCE is set — but a SUPERUSER is exempt even then. A harness that queries as postgres
#      sees every tenant's rows and would report a live cross-tenant leak as healthy data. Every SQL
#      helper here therefore connects as the owning SERVICE role and refuses a superuser outright.
#
#   2. A `mvn package` replaces the jar, but a running JVM keeps executing the old inode. Phase 22
#      spent its first hours proving a defect that had already been fixed, in a process that had
#      never loaded the fix. No assertion in this phase means anything without the freshness gate
#      below.
#
# Usage:
#   . scripts/e2e/_phase31-lib.sh
#   phase31_freshness_gate || exit 1
#   phase31_rls_canary "$TENANT_ID" "$OTHER_TENANT_ID" || exit 1
#   purchasing_sql "$TENANT_ID" "select count(*) from purchase_orders"
#   phase13_summary
#
# Safe under `set -euo pipefail` in the sourcing script.

# Idempotent: sourcing twice must not reset the counters mid-run.
if [[ -n "${_PHASE31_LIB_LOADED:-}" ]]; then
  return 0 2>/dev/null || true
fi
_PHASE31_LIB_LOADED=1

# Resolve the repo root from this file's location, not from $PWD. ${BASH_SOURCE[0]} is unset under
# zsh (macOS's default login shell); without the git fallback this silently computes the wrong root,
# silently fails to read deploy/.env, and every helper below degrades without saying so. Same defect
# scripts/local-service-env.sh already hit and fixed.
_PHASE31_LIB_SOURCE="${BASH_SOURCE[0]:-}"
if [[ -n "$_PHASE31_LIB_SOURCE" ]]; then
  _PHASE31_LIB_DIR="$(cd "$(dirname "$_PHASE31_LIB_SOURCE")" && pwd)"
  PHASE31_REPO_ROOT="${PHASE31_REPO_ROOT:-$(cd "${_PHASE31_LIB_DIR}/../.." && pwd)}"
else
  PHASE31_REPO_ROOT="${PHASE31_REPO_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
fi
if [[ ! -f "${PHASE31_REPO_ROOT}/scripts/e2e/_phase31-lib.sh" ]]; then
  echo "_phase31-lib.sh: could not locate the repo root (guessed '${PHASE31_REPO_ROOT}')." >&2
  echo "  Set PHASE31_REPO_ROOT explicitly, or source this from inside the repo." >&2
  return 1 2>/dev/null || exit 1
fi

# Login, token minting, curl_retry/curl_status, json_get, jwt_claims and the assertion counters all
# live in the phase 13 library. SOURCE it — do not copy anything out of it, so there stays exactly
# one implementation of "log a persona in through the real gateway".
PHASE13_REPO_ROOT="${PHASE31_REPO_ROOT}"
# shellcheck source=scripts/e2e/_phase13-lib.sh
. "${PHASE31_REPO_ROOT}/scripts/e2e/_phase13-lib.sh"

# ── Database access, as the roles the services actually connect as ───────────────────────────
#
# Runs inside the postgres CONTAINER rather than through a host psql, exactly as the phase 13
# scripts do: the container always has a psql of the right major version and the credentials are
# already in its environment, so this works on a machine that has never installed postgres.

PHASE31_PG_CONTAINER="${PHASE31_PG_CONTAINER:-restaurantos-postgres}"

PURCHASING_DB_ROLE="${PURCHASING_DB_USER:-purchasing_user}"
INVENTORY_DB_ROLE="${INVENTORY_DB_USER:-inventory_user}"
FINANCE_DB_ROLE="${FINANCE_DB_USER:-finance_user}"
AUTH_DB_ROLE="${AUTH_DB_USER:-auth_user}"

# Roles that would make every RLS assertion in this phase meaningless. A superuser is exempt from
# FORCE row-level security, so a query issued as one returns every tenant's rows and a harness using
# it would score a live cross-tenant leak as "data present, healthy".
_phase31_is_superuser_role() {
  case "${1:-}" in
    postgres|"${POSTGRES_SUPERUSER:-__none__}") return 0 ;;
    *) return 1 ;;
  esac
}

# phase31_sql <db> <role> <tenant_id|""> <sql>
#
# Unaligned, tuple-only, ON_ERROR_STOP. When a tenant id is given it is applied with set_config on
# the SAME connection as the statement — a GUC set on a different connection scopes nothing, which
# is the mistake that makes an RLS harness quietly test nothing at all.
phase31_sql() {
  local db="${1:-}" role="${2:-}" tenant="${3:-}" sql="${4:-}"
  if [[ -z "$db" || -z "$role" || -z "$sql" ]]; then
    echo "phase31_sql: db, role and sql are required" >&2
    return 2
  fi
  if _phase31_is_superuser_role "$role"; then
    echo "phase31_sql: REFUSING to query ${db} as '${role}'." >&2
    echo "  ${db} is FORCE row-level security. A superuser connection bypasses the policy this" >&2
    echo "  phase depends on, so the answer would be true of nobody. Use the service role." >&2
    return 3
  fi
  local statement="$sql"
  if [[ -n "$tenant" ]]; then
    statement="select set_config('app.current_tenant_id', '${tenant}', false); ${sql}"
  fi
  # `< /dev/null` is load-bearing. `docker exec -i` attaches the CALLER's stdin to the container, so
  # a helper called from inside `while read ... < <(...)` silently drains the loop's input and the
  # loop runs exactly once. It cost this harness a cross-tenant probe that reported "no foreign
  # tenant holds a vendor" when three of them do — a false all-clear on an isolation check, which is
  # the worst possible direction for that particular lie.
  docker exec -i "$PHASE31_PG_CONTAINER" \
    psql -U "$role" -d "$db" -v ON_ERROR_STOP=1 -qtA -c "$statement" < /dev/null 2>&1 \
    | { if [[ -n "$tenant" ]]; then tail -n +2; else cat; fi; }
}

purchasing_sql() { phase31_sql purchasing_db "$PURCHASING_DB_ROLE" "${1:-}" "${2:-}"; }
inventory_sql()  { phase31_sql inventory_db  "$INVENTORY_DB_ROLE"  "${1:-}" "${2:-}"; }
finance_sql()    { phase31_sql finance_db    "$FINANCE_DB_ROLE"    "${1:-}" "${2:-}"; }

# auth_db is PARTLY row-level-security scoped, which is the trap here.
#
#   NOT scoped (global catalogues): auth_tenants, permissions, role_permissions
#   FORCE RLS  (tenant-owned)     : users, user_branch_roles, roles, refresh_sessions,
#                                   password_history, password_reset_tokens
#
# A query against `users` with no tenant GUC returns ZERO ROWS and no error. It looks exactly like
# "that user does not exist", which is the most misleading possible answer when the question is
# "did the write land?" — this cost a real read-back in 36-03, where the row was there the whole
# time. So `auth_sql` takes the tenant id FIRST, like every other helper, and callers reading a
# global catalogue pass an empty string explicitly rather than by accident.
#
#   auth_sql "$TENANT_ID" "select approval_limit_paisa from user_branch_roles where ..."
#   auth_sql ""           "select role_code from role_permissions where ..."
auth_sql() { phase31_sql auth_db "$AUTH_DB_ROLE" "${1:-}" "${2:-}"; }

# ── The RLS canary ───────────────────────────────────────────────────────────────────────────
#
# Call this BEFORE trusting any SQL evidence. It answers one question: does the connection this
# harness uses actually obey the tenant policy? If it does not, every "row present" result below is
# unfalsifiable, and a real leak reads as healthy.
#
# phase31_rls_canary <tenant_id> <other_tenant_id>
phase31_rls_canary() {
  local tenant="${1:-}" other="${2:-}"
  local ok=0

  local unscoped scoped
  unscoped="$(purchasing_sql "" "select count(*) from vendors")"
  scoped="$(purchasing_sql "$tenant" "select count(*) from vendors")"
  if [[ "$unscoped" == "0" ]]; then
    echo "PASS: purchasing vendors invisible with no tenant GUC (${unscoped})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: purchasing vendors visible with NO tenant GUC — got ${unscoped}. RLS is not in force"
    echo "      for role ${PURCHASING_DB_ROLE}; every SQL assertion in this run is meaningless."
    PHASE13_FAIL=$((PHASE13_FAIL + 1)); ok=1
  fi
  if [[ "${scoped:-0}" =~ ^[0-9]+$ ]] && [[ "$scoped" -gt 0 ]]; then
    echo "PASS: purchasing vendors visible for the demo tenant GUC (${scoped})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: purchasing vendors NOT visible even with the tenant GUC — got '${scoped}'"
    PHASE13_FAIL=$((PHASE13_FAIL + 1)); ok=1
  fi

  local inv_unscoped inv_scoped
  inv_unscoped="$(inventory_sql "" "select count(*) from ingredients")"
  inv_scoped="$(inventory_sql "$tenant" "select count(*) from ingredients")"
  if [[ "$inv_unscoped" == "0" ]]; then
    echo "PASS: inventory ingredients invisible with no tenant GUC (${inv_unscoped})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: inventory ingredients visible with NO tenant GUC — got ${inv_unscoped}"
    PHASE13_FAIL=$((PHASE13_FAIL + 1)); ok=1
  fi
  if [[ "${inv_scoped:-0}" =~ ^[0-9]+$ ]] && [[ "$inv_scoped" -gt 0 ]]; then
    echo "PASS: inventory ingredients visible for the demo tenant GUC (${inv_scoped})"
    PHASE13_PASS=$((PHASE13_PASS + 1))
  else
    echo "FAIL: inventory ingredients NOT visible even with the tenant GUC — got '${inv_scoped}'"
    PHASE13_FAIL=$((PHASE13_FAIL + 1)); ok=1
  fi

  # Cross-tenant: the first tenant's rows must be absent under the second tenant's GUC.
  if [[ -n "$other" ]]; then
    local cross
    cross="$(purchasing_sql "$other" "select count(*) from vendors where tenant_id = '${tenant}'")"
    if [[ "$cross" == "0" ]]; then
      echo "PASS: tenant ${other:0:8} cannot see tenant ${tenant:0:8}'s vendors (0)"
      PHASE13_PASS=$((PHASE13_PASS + 1))
    else
      echo "FAIL: CROSS-TENANT LEAK — tenant ${other:0:8} sees ${cross} of tenant ${tenant:0:8}'s vendors"
      PHASE13_FAIL=$((PHASE13_FAIL + 1)); ok=1
    fi
  fi

  return $ok
}

# ── Broker ───────────────────────────────────────────────────────────────────────────────────
#
# A step that answered 200 and then dead-lettered has "succeeded" by every check except this one.
# That is exactly the shape of defect D-5 (a PO line for an ingredient inventory has never seen).

PHASE31_RABBIT_MGMT="${PHASE31_RABBIT_MGMT:-http://localhost:15672}"
PHASE31_RABBIT_USER="${RABBITMQ_USERNAME:-${RABBITMQ_USER:-restaurantos}}"
PHASE31_RABBIT_PASS="${RABBITMQ_PASSWORD:-guest}"

# queue_depth <queue name> — prints the ready message count, or "n/a" when the queue is unknown.
queue_depth() {
  local q="${1:-}"
  [[ -z "$q" ]] && { echo "n/a"; return 1; }
  local body
  body="$(curl -s -m 8 -u "${PHASE31_RABBIT_USER}:${PHASE31_RABBIT_PASS}" \
    "${PHASE31_RABBIT_MGMT}/api/queues/%2F/${q}" 2>/dev/null || true)"
  printf '%s' "$body" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(d['messages'] if isinstance(d, dict) and 'messages' in d else 'n/a')
except Exception:
    print('n/a')
"
}

# dlq_depth <queue name> — the depth of that queue's dead-letter sibling, by this fleet's convention.
dlq_depth() { queue_depth "${1:-}.dlq"; }

# ── The freshness gate ───────────────────────────────────────────────────────────────────────
#
# scripts/check-stale-jars.sh compares the inode a process has open against the inode on disk. This
# is the ONLY check that catches a JVM holding a deleted jar; the timestamp comparison in
# build-freshness.ps1 cannot see it.
#
# Phase 22 spent its first hours proving a defect that had already been fixed, in a process that had
# never loaded the fix — the fix was fine, the process was four days old. Nothing this phase asserts
# means anything without this gate, so it runs before any assertion and abandons the run rather than
# producing a result that might be about code from days ago.
#
# It is scoped to the services THIS phase reasons about — auth, purchasing, inventory, finance and
# the gateway. A stale pos-service cannot make a purchasing claim false, and failing the run for it
# would only teach the next reader to skip the gate.
PHASE31_FRESHNESS_SERVICES="${PHASE31_FRESHNESS_SERVICES:-auth-service purchasing-service inventory-service finance-service gateway}"

phase31_freshness_gate() {
  local out rc=0
  out="$(bash "${PHASE31_REPO_ROOT}/scripts/check-stale-jars.sh" 2>&1)" || rc=$?
  echo "$out"
  local relevant_stale=""
  local svc
  for svc in $PHASE31_FRESHNESS_SERVICES; do
    if printf '%s' "$out" | grep -qE "^STALE ${svc} "; then
      relevant_stale="${relevant_stale} ${svc}"
    fi
  done
  if [[ -n "$relevant_stale" ]]; then
    echo "----------------------------------------"
    echo "FRESHNESS GATE FAILED:${relevant_stale} are executing a jar that is not what is on disk."
    echo "Restart them and re-run. Any result produced now would be about code from a previous build."
    return 1
  fi
  if [[ $rc -ne 0 ]]; then
    echo "NOTE: a service outside this phase's scope is stale. Not gating on it — this phase reasons"
    echo "      about:${PHASE31_FRESHNESS_SERVICES// / }."
  fi
  echo "FRESHNESS GATE PASSED for:${PHASE31_FRESHNESS_SERVICES// / }"
  return 0
}

# ── Tenant lookup ────────────────────────────────────────────────────────────────────────────

# tenant_id_for <slug> — the tenant uuid, read from auth_db.
tenant_id_for() {
  local slug="${1:-}"
  [[ -z "$slug" ]] && return 1
  # auth_tenants is a global catalogue, not tenant-scoped — hence the explicit empty tenant.
  auth_sql "" "select id from auth_tenants where slug = '${slug}'" | head -1 | tr -d '[:space:]'
}

# ── Self-test ────────────────────────────────────────────────────────────────────────────────
#
# Exits non-zero only when the LIBRARY is unusable. A failing canary or a stale jar is reported and
# is a finding for the caller — it is not this function's business to decide the run is over.
phase31_selftest() {
  echo "phase31 library self-test"
  echo "  repo root      : ${PHASE31_REPO_ROOT}"
  echo "  gateway origin : ${GATEWAY}"
  echo "  purchasing role: ${PURCHASING_DB_ROLE}"
  echo "  inventory role : ${INVENTORY_DB_ROLE}"
  echo "  finance role   : ${FINANCE_DB_ROLE}"
  echo "  auth role      : ${AUTH_DB_ROLE}"
  echo "  pg container   : ${PHASE31_PG_CONTAINER}"

  local demo other
  demo="$(tenant_id_for floating-terrace)"
  other="$(tenant_id_for control-bistro-isolation-test-tenant)"
  echo "  floating-terrace : ${demo:-<unresolved>}"
  echo "  control-bistro   : ${other:-<unresolved>}"
  if [[ -z "$demo" ]]; then
    echo "  FATAL: could not resolve the demo tenant id — the library cannot be used." >&2
    return 1
  fi

  echo "--- superuser refusal ---"
  if phase31_sql purchasing_db postgres "" "select 1" >/dev/null 2>&1; then
    echo "  FATAL: the library did NOT refuse a superuser connection." >&2
    return 1
  fi
  echo "  refused a postgres connection to purchasing_db (correct)"

  echo "--- freshness ---"
  phase31_freshness_gate || echo "  (freshness verdict: STALE — a finding for the caller, not a library fault)"

  echo "--- rls canary ---"
  phase31_rls_canary "$demo" "$other" || echo "  (canary verdict: FAILED — a finding for the caller)"

  echo "--- broker ---"
  echo "  inventory.grn-received.queue      depth: $(queue_depth inventory.grn-received.queue)"
  echo "  inventory.grn-received.queue.dlq  depth: $(dlq_depth inventory.grn-received.queue)"

  echo "phase31 library self-test complete"
  return 0
}
