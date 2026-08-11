#!/usr/bin/env bash
# phase37-journal-traceability-e2e.sh — 37-04, the half an IT structurally cannot prove.
#
# JournalEntryTraceabilityIT asserts that journal_entries has RLS enabled AND forced and carries a
# tenant policy. It deliberately does NOT assert row invisibility, because Testcontainers creates
# POSTGRES_USER as a SUPERUSER and a superuser is exempt from FORCE row-level security. Measured:
#
#     Testcontainers postgres:16   select current_user, usesuper  ->  finance_user | t
#     live dev database            select current_user, usesuper  ->  finance_user | f
#
# A row-visibility assertion in that context proves nothing when it passes. So it is asserted HERE,
# against the live database, as the real non-superuser service role. This script refuses to run as
# a superuser rather than reporting a meaningless PASS.
#
# Usage: bash scripts/e2e/phase37-journal-traceability-e2e.sh

set -uo pipefail

PG_CONTAINER="${PG_CONTAINER:-restaurantos-postgres}"
FINANCE_DB_ROLE="${FINANCE_DB_USER:-finance_user}"

PASS=0
FAIL=0
pass() { echo "PASS: $*"; PASS=$((PASS + 1)); }
fail() { echo "FAIL: $*"; FAIL=$((FAIL + 1)); }

case "$FINANCE_DB_ROLE" in
  postgres|root)
    echo "REFUSING to run as '$FINANCE_DB_ROLE' — a superuser bypasses FORCE RLS, so every" >&2
    echo "assertion below would be true of nobody. Use the service role." >&2
    exit 3
    ;;
esac

# `< /dev/null` is load-bearing: docker exec -i otherwise drains an enclosing read loop's stdin.
fsql() {
  local tenant="${1:-}"
  local sql="${2:-}"
  local statement="$sql"
  if [[ -n "$tenant" ]]; then
    statement="select set_config('app.current_tenant_id', '${tenant}', false); ${sql}"
  fi
  docker exec -i "$PG_CONTAINER" psql -U "$FINANCE_DB_ROLE" -d finance_db \
    -v ON_ERROR_STOP=1 -qtA -F$'\t' -c "$statement" < /dev/null 2>&1 \
    | { if [[ -n "$tenant" ]]; then tail -n +2; else cat; fi; }
}

echo "═══ 37-04 · journal traceability, verified as the real role ══════════════════════"
echo

# ── 0. The role really is not a superuser ────────────────────────────────────────────────────
SUPER="$(fsql "" "select usesuper from pg_user where usename = current_user")"
if [[ "$SUPER" == "f" ]]; then
  pass "connected as ${FINANCE_DB_ROLE}, usesuper=f — the policy genuinely applies to this session"
else
  fail "connected role reports usesuper='${SUPER}' — RLS would be inert; nothing below is meaningful"
  exit 1
fi

# ── 1. journal_entries is FORCE RLS ──────────────────────────────────────────────────────────
FLAGS="$(fsql "" "select relrowsecurity, relforcerowsecurity from pg_class where relname='journal_entries'")"
if [[ "$FLAGS" == "t"$'\t'"t" ]]; then
  pass "journal_entries: RLS enabled AND forced"
else
  fail "journal_entries RLS flags are '${FLAGS}', expected 't<TAB>t'"
fi

# ── 2. With NO tenant GUC, nothing is visible ────────────────────────────────────────────────
UNSCOPED="$(fsql "" "select count(*) from journal_entries")"
if [[ "$UNSCOPED" == "0" ]]; then
  pass "no tenant GUC -> 0 journal entries visible"
else
  fail "no tenant GUC -> ${UNSCOPED} entries visible. RLS is NOT protecting this table"
fi

# ── 3. A tenant sees its own entries, and ONLY its own ───────────────────────────────────────
# Two tenants are needed and RLS deliberately prevents enumerating them from finance_db without a
# GUC — that is the protection working, not an obstacle. Take them from the ClickHouse facts, which
# are not tenant-scoped at the connection level, and fall back to the seeded dev tenants.
# (`mapfile` is bash 4+; macOS ships bash 3.2, so this stays portable.)
TENANT_SRC="$(docker exec -i "${CH_CONTAINER:-restaurantos-clickhouse}" clickhouse-client \
  -q "SELECT DISTINCT toString(tenant_id) FROM clickhouse_analytics.sales_order_facts FORMAT TSV" \
  < /dev/null 2>/dev/null)"
A="$(echo "$TENANT_SRC" | sed -n '1p')"
B="$(echo "$TENANT_SRC" | sed -n '2p')"
[[ -z "$A" ]] && A="d108c2e6-a70d-49c8-acdc-37531fd752d8"
[[ -z "$B" ]] && B="99e27e0e-4949-411d-8a9c-b926330a86e3"

# Prefer a pair that both actually hold entries, so assertion 4 is not vacuous.
if [[ "$(fsql "$A" "select count(*) from journal_entries")" == "0" ]]; then
  A="d108c2e6-a70d-49c8-acdc-37531fd752d8"
fi
if [[ "$(fsql "$B" "select count(*) from journal_entries")" == "0" || "$B" == "$A" ]]; then
  B="99e27e0e-4949-411d-8a9c-b926330a86e3"
fi

COUNT_A="$(fsql "$A" "select count(*) from journal_entries")"
COUNT_B="$(fsql "$B" "select count(*) from journal_entries")"
if [[ "${COUNT_A:-0}" -gt 0 && "${COUNT_B:-0}" -gt 0 ]]; then
  pass "tenant A sees ${COUNT_A} entries, tenant B sees ${COUNT_B} — both non-empty, so the next check is real"
else
  fail "one tenant sees nothing (A=${COUNT_A} B=${COUNT_B}); the isolation check below would be vacuous"
fi

# ── 4. THE assertion: a source belonging to tenant B is invisible to tenant A ────────────────
FOREIGN_SOURCE="$(fsql "$B" "select source_id::text from journal_entries where source_id is not null limit 1")"
if [[ -z "$FOREIGN_SOURCE" ]]; then
  fail "tenant B has no sourced entry to probe with — cannot exercise the isolation check"
else
  SEEN_BY_B="$(fsql "$B" "select count(*) from journal_entries where source_id = '${FOREIGN_SOURCE}'")"
  SEEN_BY_A="$(fsql "$A" "select count(*) from journal_entries where source_id = '${FOREIGN_SOURCE}'")"
  if [[ "${SEEN_BY_B:-0}" -gt 0 ]]; then
    pass "source ${FOREIGN_SOURCE:0:8}… is visible to its OWN tenant (${SEEN_BY_B} entries)"
  else
    fail "source ${FOREIGN_SOURCE:0:8}… invisible to its own tenant — probe is broken"
  fi
  if [[ "${SEEN_BY_A:-1}" == "0" ]]; then
    pass "the SAME source id returns 0 entries for a different tenant — the policy, not app code"
  else
    fail "CROSS-TENANT LEAK: tenant A can see ${SEEN_BY_A} of tenant B's journal entries by source id"
  fi
fi

# ── 5. The by-source index exists ────────────────────────────────────────────────────────────
IDX="$(fsql "" "select indexdef from pg_indexes where tablename='journal_entries' and indexname='idx_journal_entries_tenant_source'")"
if [[ -n "$IDX" ]]; then
  pass "idx_journal_entries_tenant_source present"
else
  fail "idx_journal_entries_tenant_source MISSING — apply finance migration V10. The transaction"
  echo "      register (37-08) calls the by-source lookup once per visible row and will scan."
fi

# ── 6. An order really does produce more than one entry — the whole point of the plan ────────
# Scanned across every tenant, not just one: whichever tenant happens to sort first is an accident
# of the fixture, and "this tenant has no multi-entry order" is not the question being asked.
MULTI=""
MULTI_TENANT=""
for T in $TENANT_SRC $A $B; do
  [[ -z "$T" ]] && continue
  CANDIDATE="$(fsql "$T" "select source_id::text, count(*) from journal_entries
                           where source_type like 'ORDER%' group by source_id
                           having count(*) > 1 limit 1")"
  if [[ -n "$CANDIDATE" ]]; then
    MULTI="$CANDIDATE"
    MULTI_TENANT="$T"
    break
  fi
done

if [[ -n "$MULTI" ]]; then
  SRC="$(echo "$MULTI" | cut -f1)"
  N="$(echo "$MULTI" | cut -f2)"
  TYPES="$(fsql "$MULTI_TENANT" "select string_agg(source_type, ',' order by source_type)
                                  from journal_entries where source_id = '${SRC}'")"
  pass "order ${SRC:0:8}… produced ${N} entries (${TYPES}) — a (type,id) PAIR query returns 1 of them"
else
  fail "no order in this database produced more than one entry — the multi-entry behaviour,"
  echo "      which is the entire point of 37-04, is not exercised against live data here."
fi

echo
echo "═════════════════════════════════════════════════════════════════════════════════"
echo "PASS: $PASS   FAIL: $FAIL"
[[ "$FAIL" -gt 0 ]] && exit 1
echo "The ledger answers 'where did this number come from?' — and only for the right tenant."
