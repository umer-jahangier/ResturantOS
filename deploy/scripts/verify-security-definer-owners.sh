#!/usr/bin/env bash
#
# Post-migration ownership fixups for SECURITY DEFINER functions, plus a FUNCTIONAL check.
#
# WHY THIS EXISTS
#
# A SECURITY DEFINER function runs as its owner. Under FORCE ROW LEVEL SECURITY, RLS applies to
# the table owner too — so a function owned by the service role (auth_user, hr_user: both
# NOSUPERUSER NOBYPASSRLS) cannot bypass RLS at all. It does not error. It returns zero rows.
#
# Measured on the live auth_db, same function body, only the owner differing:
#
#     owned by auth_user -> 0 rows
#     owned by postgres  -> 175 rows
#
# These functions exist precisely to run BEFORE app.current_tenant_id is set — refresh-token
# lookup has no tenant yet, that is the whole point — so "returns zero rows" means refresh and
# logout fail for every user, silently, with a valid token.
#
# THE ORDERING TRAP THIS CLOSES
#
# deploy/init/04-*.sql and 05-*.sql already reassign ownership, but they are invoked from
# ensure-dev-infra.sh, which runs BEFORE the services start. On a fresh database the functions do
# not exist yet, so those scripts take their `IF to_regprocedure(...) IS NOT NULL` branch, do
# nothing, and say nothing. Liquibase then creates the functions as auth_user/hr_user, and the
# system comes up broken. It works on this machine only because an older migration run happened to
# create them while the connection was postgres.
#
# So this must run AFTER migrations. It is idempotent and safe to run repeatedly.
#
# WHY IT CHECKS BEHAVIOUR AND NOT OWNERSHIP
#
# Ownership is a proxy. What matters is whether the function can actually see rows past RLS, so
# that is what is asserted — by calling it as the service role. A future function that is owned
# correctly but declared SECURITY INVOKER by mistake would pass an ownership check and fail this.
#
# Exits non-zero on any unrepaired function. Silence here is the failure mode we are eliminating,
# so this script is deliberately loud.

set -euo pipefail

CONTAINER="${POSTGRES_CONTAINER:-restaurantos-postgres}"
SUPERUSER="${POSTGRES_SUPERUSER:-postgres}"

psql_super() {
  local db="$1"; shift
  docker exec -i "$CONTAINER" psql -U "$SUPERUSER" -d "$db" -v ON_ERROR_STOP=1 "$@"
}

# db | function signature | service role | RLS-protected table the definer context must see past
#
# The functional probe CALLS THE FUNCTION — it does not select the table directly. Selecting the
# table as the service role always returns 0 under FORCE RLS whether the function is healthy or
# not, so that would report a failure permanently (it did, on the first version of this script).
# The argument is sampled as the superuser first, because the service role cannot read the row it
# needs to build the call.
FIXUPS=(
  "auth_db|public.auth_lookup_refresh_tenant(TEXT)|auth_user|refresh_sessions|token_hash"
  "hr_db|public.resolve_device(TEXT)|hr_user|attendance_devices|device_token"
  "hr_db|public.hr_tenant_ids()|hr_user||"
)

failed=0
repaired=0
checked=0

for row in "${FIXUPS[@]}"; do
  IFS='|' read -r db fn role probe_table probe_col <<<"$row"
  fn_name="${fn%%(*}"

  exists=$(psql_super "$db" -tAc "SELECT to_regprocedure('${fn}') IS NOT NULL;" 2>/dev/null || echo "f")
  if [[ "$exists" != "t" ]]; then
    echo "SKIP  ${db}: ${fn} not present (migrations for this service have not run yet)"
    continue
  fi
  checked=$((checked + 1))

  owner=$(psql_super "$db" -tAc \
    "SELECT a.rolname FROM pg_proc p JOIN pg_authid a ON a.oid = p.proowner
      WHERE p.oid = to_regprocedure('${fn}');")

  if [[ "$owner" != "$SUPERUSER" ]]; then
    echo "FIX   ${db}: ${fn_name} owned by '${owner}' -> ${SUPERUSER}"
    psql_super "$db" -q <<SQL
ALTER FUNCTION ${fn} OWNER TO ${SUPERUSER};
REVOKE ALL ON FUNCTION ${fn} FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ${fn} TO ${role};
SQL
    repaired=$((repaired + 1))
  fi

  # Functional proof: as the service role, with no tenant GUC set, the underlying table must be
  # readable through a definer context. A count of 0 on a populated table is the silent failure.
  # Structural: it must actually be SECURITY DEFINER. An owner-only check would pass a function
  # someone had quietly redeclared SECURITY INVOKER, which fails in exactly the same silent way.
  secdef=$(psql_super "$db" -tAc \
    "SELECT p.prosecdef FROM pg_proc p WHERE p.oid = to_regprocedure('${fn}');")
  if [[ "$secdef" != "t" ]]; then
    echo "FAIL  ${db}: ${fn_name} is not SECURITY DEFINER — it cannot bypass RLS regardless of owner"
    failed=$((failed + 1))
    continue
  fi

  # Functional: call the real function as the service role, with an argument sampled as the
  # superuser (the service role cannot read the row it needs to build the call).
  if [[ -z "$probe_table" ]]; then
    echo "OK    ${db}: ${fn_name} owner=${SUPERUSER}, SECURITY DEFINER (no-arg; structural check only)"
    continue
  fi

  set +e
  sample=$(psql_super "$db" -tAc "SELECT ${probe_col} FROM ${probe_table} LIMIT 1" 2>/dev/null)
  set -e
  if [[ -z "$sample" ]]; then
    echo "OK    ${db}: ${fn_name} owner=${SUPERUSER}, SECURITY DEFINER (${probe_table} empty — not exercised)"
    continue
  fi

  set +e
  got=$(psql_super "$db" -tA 2>/dev/null <<SQL
SET ROLE ${role};
SELECT ${fn_name}('${sample}') IS NOT NULL;
SQL
)
  rc=$?
  set -e
  got=$(printf '%s' "$got" | tail -1)

  if [[ $rc -ne 0 ]]; then
    echo "FAIL  ${db}: calling ${fn_name} as ${role} errored"
    failed=$((failed + 1))
  elif [[ "$got" != "t" ]]; then
    echo "FAIL  ${db}: ${fn_name} returned NULL as ${role} for a row that exists — RLS is not being"
    echo "      bypassed. Refresh/logout (or device auth) fails silently for every user."
    failed=$((failed + 1))
  else
    echo "OK    ${db}: ${fn_name} owner=${SUPERUSER}, definer context resolves a real row as ${role}"
  fi
done

echo "----------------------------------------"
echo "checked=${checked} repaired=${repaired} failed=${failed}"

if [[ "$failed" -gt 0 ]]; then
  echo "ERROR: SECURITY DEFINER ownership is not correct. See deploy/init/04-*.sql and 05-*.sql." >&2
  exit 1
fi
