#!/usr/bin/env bash
# Idempotent fixes for existing dev volumes (Postgres schema grants, RabbitMQ topology).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$DEPLOY_DIR"

if [[ ! -f .env ]]; then
  echo "ERROR: deploy/.env missing. Run: bash deploy/generate-keys.sh" >&2
  exit 1
fi

set -a && source .env && set +a

COMPOSE="docker compose"

run_psql() {
  local db=$1
  shift
  PGPASSWORD="$POSTGRES_SUPERUSER_PASSWORD" psql -h 127.0.0.1 -U "$POSTGRES_SUPERUSER" -d "$db" \
    -v ON_ERROR_STOP=1 -q "$@"
}

echo "==> Ensuring runtime Postgres roles (user_service, audit_writer, file_service)..."
run_psql postgres \
  -v user_pw="$USER_DB_PASSWORD" \
  -v audit_pw="$AUDIT_DB_PASSWORD" \
  -v file_pw="$FILE_DB_PASSWORD" \
  -f init/02b-ensure-runtime-roles.sql

echo "==> Ensuring Postgres schema grants..."
run_psql postgres -f init/03-grant-schema-privileges.sql

echo "==> Ensuring auth refresh lookup function owner (RLS bypass)..."
run_psql auth_db -f init/04-auth-refresh-lookup-owner.sql

echo "==> RabbitMQ topology + user are declarative (deploy/init/rabbitmq-definitions.template.json,"
echo "    rendered by scripts/dev-stack-up.sh) and loaded at broker boot via load_definitions —"
echo "    no rabbitmqctl step needed here anymore. Re-importing for belt-and-braces on volumes"
echo "    that predate this change:"
$COMPOSE exec -T rabbitmq rabbitmqctl await_startup >/dev/null 2>&1 || true
$COMPOSE exec -T rabbitmq rabbitmqctl import_definitions /etc/rabbitmq/definitions.json 2>/dev/null || true

echo "==> Dev infra ready."
