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

echo "==> Ensuring RabbitMQ topology (exchanges/queues/bindings)..."
$COMPOSE exec -T rabbitmq rabbitmqctl await_startup >/dev/null 2>&1 || true
# Existing volumes may have been created with an older password — sync broker user to .env.
$COMPOSE exec -T rabbitmq rabbitmqctl add_user "$RABBITMQ_USERNAME" "$RABBITMQ_PASSWORD" 2>/dev/null \
  || $COMPOSE exec -T rabbitmq rabbitmqctl change_password "$RABBITMQ_USERNAME" "$RABBITMQ_PASSWORD"
$COMPOSE exec -T rabbitmq rabbitmqctl set_user_tags "$RABBITMQ_USERNAME" administrator
$COMPOSE exec -T rabbitmq rabbitmqctl set_permissions -p / "$RABBITMQ_USERNAME" ".*" ".*" ".*"
$COMPOSE exec -T rabbitmq rabbitmqctl import_definitions /etc/rabbitmq/definitions.json

echo "==> Dev infra ready."
