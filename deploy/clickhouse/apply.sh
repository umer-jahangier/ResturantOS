#!/usr/bin/env bash
# Idempotent applier for deploy/clickhouse/V*.sql against a live ClickHouse HTTP interface.
#
# Why a script and not Flyway: Flyway has no ClickHouse dialect.
# Why not a Java runner inside reporting-service: nlq-service also needs the readonly user, and
# the DDL must exist before EITHER service boots — a shared, explicit, re-runnable script is the
# honest boundary. reporting-service fails fast at startup if the fact tables are missing (12-03).
#
# Usage:
#   ./deploy/clickhouse/apply.sh
#
# Env (sourced from deploy/.env if present, can be overridden in the environment):
#   CLICKHOUSE_URL               default: http://localhost:8123
#   CLICKHOUSE_USER               default: default
#   CLICKHOUSE_PASSWORD           required (no default — must match the running container)
#   CLICKHOUSE_READONLY_PASSWORD  required — refuses to run if unset (never creates a
#                                  passwordless nlq_readonly user)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Preserve any values already set in the CALLING environment (even empty-string) so that
# `deploy/.env` can never silently override an explicit environment override — e.g.
# `CLICKHOUSE_READONLY_PASSWORD= ./apply.sh` must fail fast even though deploy/.env sets a value.
# `${VAR+x}` expands to "x" iff VAR is set (including set-but-empty), "" otherwise.
_PRESET_URL="${CLICKHOUSE_URL+x}";               _PRESET_URL_VAL="${CLICKHOUSE_URL-}"
_PRESET_USER="${CLICKHOUSE_USER+x}";             _PRESET_USER_VAL="${CLICKHOUSE_USER-}"
_PRESET_PW="${CLICKHOUSE_PASSWORD+x}";           _PRESET_PW_VAL="${CLICKHOUSE_PASSWORD-}"
_PRESET_RO_PW="${CLICKHOUSE_READONLY_PASSWORD+x}"; _PRESET_RO_PW_VAL="${CLICKHOUSE_READONLY_PASSWORD-}"

# Source deploy/.env if present (do not fail if absent — CI/CD may inject env vars directly).
if [ -f "${REPO_ROOT}/deploy/.env" ]; then
    set -a
    # shellcheck disable=SC1091
    source "${REPO_ROOT}/deploy/.env"
    set +a
fi

# Restore any values that were explicitly set (even empty) before sourcing .env — the calling
# environment always wins over deploy/.env.
[ -n "${_PRESET_URL}" ] && CLICKHOUSE_URL="${_PRESET_URL_VAL}"
[ -n "${_PRESET_USER}" ] && CLICKHOUSE_USER="${_PRESET_USER_VAL}"
[ -n "${_PRESET_PW}" ] && CLICKHOUSE_PASSWORD="${_PRESET_PW_VAL}"
[ -n "${_PRESET_RO_PW}" ] && CLICKHOUSE_READONLY_PASSWORD="${_PRESET_RO_PW_VAL}"

CLICKHOUSE_URL="${CLICKHOUSE_URL:-http://localhost:8123}"
CLICKHOUSE_USER="${CLICKHOUSE_USER:-default}"
CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD:-}"
CLICKHOUSE_READONLY_PASSWORD="${CLICKHOUSE_READONLY_PASSWORD:-}"

if [ -z "${CLICKHOUSE_READONLY_PASSWORD}" ]; then
    echo "FATAL: CLICKHOUSE_READONLY_PASSWORD is unset. Refusing to create a passwordless" >&2
    echo "       nlq_readonly user. Set it in deploy/.env or the environment and retry." >&2
    exit 1
fi

# Normalize CLICKHOUSE_URL: some deploy/.env values point at the in-network hostname
# (http://clickhouse:8123) which only resolves from inside the Docker network. If we're being
# run from the host (not inside a container) against that hostname and it does not resolve,
# fall back to localhost — this keeps the script usable from both contexts without two configs.
if [[ "${CLICKHOUSE_URL}" == *"://clickhouse:"* ]] && ! getent hosts clickhouse >/dev/null 2>&1 && ! ping -c1 -t1 clickhouse >/dev/null 2>&1; then
    echo "NOTE: CLICKHOUSE_URL host 'clickhouse' not resolvable from this shell; falling back to localhost:8123." >&2
    CLICKHOUSE_URL="http://localhost:8123"
fi

echo "Applying ClickHouse migrations to ${CLICKHOUSE_URL} as ${CLICKHOUSE_USER} ..."

# ---------------------------------------------------------------------------------------------
# Enable SQL-driven access control for the default user before running any V*.sql.
#
# REAL FINDING: the stock clickhouse/clickhouse-server:25.9 image's docker-entrypoint generates
# /etc/clickhouse-server/users.d/default-user.xml with `<access_management>0</access_management>`
# baked in from CLICKHOUSE_USER/CLICKHOUSE_PASSWORD env vars. Without access_management=1,
# CREATE USER / CREATE SETTINGS PROFILE / GRANT all fail with:
#   Code: 497. DB::Exception: default: Not enough privileges. To execute this query, it's
#   necessary to have the grant SHOW ACCESS ON *.*. (ACCESS_DENIED)
# This step is idempotent and safe to skip if docker/the container is unreachable from this shell
# (e.g. CI running against a remote/managed ClickHouse where SQL-driven ACL is already on) — it
# only runs if a container named restaurantos-clickhouse is found locally.
# ---------------------------------------------------------------------------------------------
CONTAINER_NAME="restaurantos-clickhouse"
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "${CONTAINER_NAME}"; then
    ACCESS_MGMT_FILE="${SCRIPT_DIR}/zz-access-management.xml"
    # tail -n1: the file's own doc comment quotes the OLD (0) value as prose, so a plain grep -o
    # matches that too — only the last match (the real <users><default> element, after the XML
    # comment block closes) reflects the actual applied setting.
    CURRENT_AM_SETTING="$(docker exec "${CONTAINER_NAME}" sh -c "grep -o '<access_management>[0-9]</access_management>' /etc/clickhouse-server/users.d/zz-access-management.xml 2>/dev/null | tail -n1 || true")"
    if [ "${CURRENT_AM_SETTING}" != "<access_management>1</access_management>" ]; then
        echo "Enabling SQL-driven access control on ${CONTAINER_NAME} (users.d/zz-access-management.xml)..."
        docker cp "${ACCESS_MGMT_FILE}" "${CONTAINER_NAME}:/etc/clickhouse-server/users.d/zz-access-management.xml"
        docker restart "${CONTAINER_NAME}" >/dev/null
        echo -n "Waiting for ${CONTAINER_NAME} to become healthy"
        for _ in $(seq 1 30); do
            HSTATUS="$(docker inspect --format='{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "")"
            if [ "${HSTATUS}" = "healthy" ]; then
                echo " OK"
                break
            fi
            echo -n "."
            sleep 2
        done
    fi
fi

apply_sql() {
    local sql="$1"
    local response
    response="$(curl -sS -w '\n%{http_code}' "${CLICKHOUSE_URL}/?user=${CLICKHOUSE_USER}&password=${CLICKHOUSE_PASSWORD}" --data-binary "${sql}")"
    local http_code
    http_code="$(echo "${response}" | tail -n1)"
    local body
    body="$(echo "${response}" | sed '$d')"

    if [ "${http_code}" != "200" ]; then
        echo "FATAL: HTTP ${http_code} applying statement:" >&2
        echo "${sql}" >&2
        echo "Response:" >&2
        echo "${body}" >&2
        exit 1
    fi
    if echo "${body}" | grep -qE 'Exception|Code:'; then
        echo "FATAL: ClickHouse returned an error for statement:" >&2
        echo "${sql}" >&2
        echo "Response:" >&2
        echo "${body}" >&2
        exit 1
    fi
    echo "${body}"
}

for FILE in $(find "${SCRIPT_DIR}" -maxdepth 1 -name 'V*.sql' | sort); do
    echo "--- Applying $(basename "${FILE}") ---"
    # Expand ${CLICKHOUSE_READONLY_PASSWORD} placeholder; envsubst limited to that one var so any
    # other literal ${...} text in the SQL (there is none today) is left untouched.
    EXPANDED_SQL="$(CLICKHOUSE_READONLY_PASSWORD="${CLICKHOUSE_READONLY_PASSWORD}" envsubst '${CLICKHOUSE_READONLY_PASSWORD}' < "${FILE}")"

    # ClickHouse's HTTP interface rejects multi-statement bodies ("Multi-statements are not
    # allowed") — split the file into individual ';'-terminated statements. Strip full-line and
    # trailing '--' comments first (none of our DDL's string literals contain '--').
    STRIPPED_SQL="$(echo "${EXPANDED_SQL}" | sed 's/--.*$//')"
    # Split on ';' (one statement per record), drop blank/whitespace-only records.
    while IFS= read -r -d ';' STATEMENT; do
        TRIMMED="$(echo "${STATEMENT}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
        if [ -n "${TRIMMED}" ]; then
            apply_sql "${TRIMMED}" >/dev/null
        fi
    done <<< "${STRIPPED_SQL};"
    echo "OK: $(basename "${FILE}")"
done

echo "All ClickHouse migrations applied successfully."
