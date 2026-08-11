#!/usr/bin/env bash
# Host-run Spring Boot services against docker-compose infra on localhost.
# Usage: source scripts/local-service-env.sh

set -a

# ${BASH_SOURCE[0]} is unset when this file is `source`d from a non-bash shell
# (e.g. zsh, the macOS default). Falling back silently to `dirname ""` resolves
# to the caller's cwd instead of scripts/, so deploy/.env is "missing" and every
# service below boots with empty JWT keys + empty DB passwords — no error, just
# silent auth failures. Fall back to the git root so this works under any shell.
if [[ -n "${BASH_SOURCE:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
  SCRIPT_DIR="$REPO_ROOT/scripts"
fi
DEPLOY_ENV="$SCRIPT_DIR/../deploy/.env"

if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "ERROR: deploy/.env missing. Run: bash deploy/generate-keys.sh" >&2
  return 1 2>/dev/null || exit 1
fi

# shellcheck source=/dev/null
source "$DEPLOY_ENV"

export DB_HOST=127.0.0.1
export DB_PORT=5432
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
export RABBITMQ_HOST=127.0.0.1
export RABBITMQ_PORT=5672
export RABBITMQ_USER="${RABBITMQ_USERNAME:-restaurantos}"
export EUREKA_URL=http://127.0.0.1:8761/eureka/
export OPA_URL=http://127.0.0.1:8181
export JWT_JWKS_URL=http://127.0.0.1:8081/.well-known/jwks.json
export AUTH_COOKIE_SECURE=false
export MINIO_ENDPOINT=http://127.0.0.1:9000

# auth-service + authorization-service
export DB_NAME=auth_db
export DB_USER=auth_user
export DB_PASSWORD="${AUTH_DB_PASSWORD}"

# user-service
export USER_DB_URL=jdbc:postgresql://127.0.0.1:5432/user_db
export USER_DB_USER=user_service
export USER_DB_PASSWORD="${USER_DB_PASSWORD}"

# platform-admin-service
export PLATFORM_DB_URL=jdbc:postgresql://127.0.0.1:5432/platform_db
export PLATFORM_DB_USER=platform_user
export PLATFORM_DB_PASSWORD="${PLATFORM_DB_PASSWORD}"

# audit-service (Liquibase admin + runtime writer)
export AUDIT_DB_URL=jdbc:postgresql://127.0.0.1:5432/audit_db
export AUDIT_DB_USER=audit_writer
export AUDIT_DB_PASSWORD="${AUDIT_DB_PASSWORD}"
export AUDIT_DB_ADMIN_URL=jdbc:postgresql://127.0.0.1:5432/audit_db
export AUDIT_DB_ADMIN_USER="${POSTGRES_SUPERUSER}"
export AUDIT_DB_ADMIN_PASSWORD="${POSTGRES_SUPERUSER_PASSWORD}"

# file-service
export FILE_DB_URL=jdbc:postgresql://127.0.0.1:5432/file_db
export FILE_DB_USER=file_service
export FILE_DB_PASSWORD="${FILE_DB_PASSWORD}"

# purchasing-service (Flyway + runtime as purchasing_user; role created by init/02-create-roles.sql)
export PURCHASING_DB_URL=jdbc:postgresql://127.0.0.1:5432/purchasing_db
export PURCHASING_DB_USER=purchasing_user
export PURCHASING_DB_PASSWORD="${PURCHASING_DB_PASSWORD}"

# finance-service
export FINANCE_DB_URL=jdbc:postgresql://127.0.0.1:5432/finance_db
export FINANCE_DB_USER=finance_user
export FINANCE_DB_PASSWORD="${FINANCE_DB_PASSWORD}"
export EUREKA_URI=http://127.0.0.1:8761/eureka/
export JWKS_URI=http://127.0.0.1:8081/.well-known/jwks.json
# platform-admin-service is on 8096 (8083 is authorization-service).
export PLATFORM_ADMIN_URI=http://127.0.0.1:8096
# file-service reads a DIFFERENT property name for the same thing:
# `restaurantos.platform-admin-service.uri: ${PLATFORM_ADMIN_SERVICE_URI:http://platform-admin-service:8096}`.
# Without this export it falls back to the docker-compose hostname, which does not resolve on the
# host, and EVERY upload dies in QuotaService with
# `UnknownHostException: platform-admin-service` — surfaced as a bare 500, because the quota
# check is deliberately fail-closed. Nobody hit it before 19b for the simple reason that nothing
# in the product had ever called file-service; the menu-item picture upload is its first caller.
export PLATFORM_ADMIN_SERVICE_URI=http://127.0.0.1:8096
export CONFIG_URI=http://127.0.0.1:8888
export FAIL_OPEN_ON_PLATFORM_DOWN=true

# crm-service (Liquibase + runtime as crm_user) — consumer of ORDER_CLOSED / ORDER_REFUNDED.
# Parity fix: start-dev.sh has launched crm-service since the Phase 9 merge, but this file only
# ever had the reporting/nlq blocks, so on the Linux/WSL path crm-service started with no
# datasource at all. Mirrors the local-service-env.ps1 block exactly.
# LIQUIBASE_CONTEXTS=seed is load-bearing: without it the loyalty tier config
# (BRONZE/SILVER/GOLD thresholds, changeset 900-seed-loyalty-config) is never inserted and
# LoyaltyService.ensureTierConfig has nothing to resolve a tier against.
export CRM_DB_URL=jdbc:postgresql://127.0.0.1:5432/crm_db
export CRM_DB_USER=crm_user
export CRM_DB_PASSWORD="${CRM_DB_PASSWORD}"
export LIQUIBASE_CONTEXTS=seed

# pos-service (order lifecycle; publishes ORDER_CLOSED consumed by the dashboard/ETL)
export POS_DB_URL=jdbc:postgresql://127.0.0.1:5432/pos_db
export POS_DB_USER=pos_user
export POS_DB_PASSWORD="${POS_DB_PASSWORD}"

# kitchen-service (KDS routing + WebSocket board)
export KITCHEN_DB_URL=jdbc:postgresql://127.0.0.1:5432/kitchen_db
export KITCHEN_DB_USER=kitchen_user
export KITCHEN_DB_PASSWORD="${KITCHEN_DB_PASSWORD}"

# ClickHouse analytics store (host-run: docker 'clickhouse' hostname -> localhost). Shared by
# reporting-service (default user, read path) and nlq-service (locked-down nlq_readonly user).
export CLICKHOUSE_URL=http://127.0.0.1:8123
export CLICKHOUSE_DB=clickhouse_analytics
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD="${CLICKHOUSE_PASSWORD}"
export CLICKHOUSE_READONLY_USER="${CLICKHOUSE_READONLY_USER:-nlq_readonly}"
export CLICKHOUSE_READONLY_PASSWORD="${CLICKHOUSE_READONLY_PASSWORD}"

# reporting-service (ClickHouse-backed named reports + FBR + realtime dashboard WS) — Phase 12
export REPORTING_DB_URL=jdbc:postgresql://127.0.0.1:5432/reporting_db
export REPORTING_DB_USER=reporting_user
export REPORTING_DB_PASSWORD="${REPORTING_DB_PASSWORD}"

# hr-service (employees w/ encrypted PII, payroll, attendance, leave) — Phase 11.
# Without this block the service falls back to application.yml's literal `hr_pass`, which is NOT the
# generated HR_DB_PASSWORD, and the connection is refused at startup.
export HR_DB_URL=jdbc:postgresql://127.0.0.1:5432/hr_db
export HR_DB_USER=hr_user
export HR_DB_PASSWORD="${HR_DB_PASSWORD}"

# nlq-service (NL->SQL via Claude, 7-stage AST validation) — Phase 12. ANTHROPIC_API_KEY is a
# placeholder in deploy/.env by default; the live-Claude round-trip skips honestly without a real key.
export NLQ_DB_URL=jdbc:postgresql://127.0.0.1:5432/nlq_db
export NLQ_DB_USER=nlq_user
export NLQ_DB_PASSWORD="${NLQ_DB_PASSWORD}"

# Host-run mode: every service is on this machine, so register with Eureka on loopback.
# The services default to prefer-ip-address, which advertises the LAN IP (e.g. 192.168.x.x).
# That address changes with the network and is blocked by the macOS firewall for freshly-started
# java processes, so the gateway's `lb://` lookups resolve to an unreachable host and every
# proxied call fails with 503 even though the service answers fine on 127.0.0.1.
export EUREKA_INSTANCE_IP_ADDRESS=127.0.0.1
export EUREKA_INSTANCE_HOSTNAME=127.0.0.1

set +a
