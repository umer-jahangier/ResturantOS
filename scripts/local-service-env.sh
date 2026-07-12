#!/usr/bin/env bash
# Host-run Spring Boot services against docker-compose infra on localhost.
# Usage: source scripts/local-service-env.sh

set -a

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
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

# finance-service
export FINANCE_DB_URL=jdbc:postgresql://127.0.0.1:5432/finance_db
export FINANCE_DB_USER=finance_user
export FINANCE_DB_PASSWORD="${FINANCE_DB_PASSWORD}"
export EUREKA_URI=http://127.0.0.1:8761/eureka/
export JWKS_URI=http://127.0.0.1:8081/.well-known/jwks.json
# platform-admin-service is on 8096 (8083 is authorization-service).
export PLATFORM_ADMIN_URI=http://127.0.0.1:8096
export CONFIG_URI=http://127.0.0.1:8888
export FAIL_OPEN_ON_PLATFORM_DOWN=true

# Host-run mode: every service is on this machine, so register with Eureka on loopback.
# The services default to prefer-ip-address, which advertises the LAN IP (e.g. 192.168.x.x).
# That address changes with the network and is blocked by the macOS firewall for freshly-started
# java processes, so the gateway's `lb://` lookups resolve to an unreachable host and every
# proxied call fails with 503 even though the service answers fine on 127.0.0.1.
export EUREKA_INSTANCE_IP_ADDRESS=127.0.0.1
export EUREKA_INSTANCE_HOSTNAME=127.0.0.1

set +a
