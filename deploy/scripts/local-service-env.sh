#!/usr/bin/env bash
# Source to run Spring services against docker-compose infra on localhost.
# Usage (from repo root): source deploy/scripts/local-service-env.sh
set -a
if [[ -n "${BASH_VERSION:-}" ]]; then
  _SCRIPT="${BASH_SOURCE[0]}"
elif [[ -n "${ZSH_VERSION:-}" ]]; then
  # zsh when sourced
  _SCRIPT="${(%):-%x}"
else
  _SCRIPT="$0"
fi
DEPLOY_DIR="$(cd "$(dirname "$_SCRIPT")/.." && pwd)"
if [[ ! -f "$DEPLOY_DIR/.env" && -f "$(pwd)/deploy/.env" ]]; then
  DEPLOY_DIR="$(cd "$(pwd)/deploy" && pwd)"
fi
# shellcheck source=/dev/null
source "$DEPLOY_DIR/.env"

export DB_HOST=127.0.0.1
export DB_PORT=5432
export REDIS_HOST=127.0.0.1
export REDIS_PORT=6379
export RABBITMQ_HOST=127.0.0.1
export RABBITMQ_PORT=5672
export RABBITMQ_USER="${RABBITMQ_USERNAME:-restaurantos}"
export EUREKA_URL="${EUREKA_URL:-http://127.0.0.1:8761/eureka/}"
export OPA_URL="${OPA_URL:-http://127.0.0.1:8181}"
export JWT_JWKS_URL="${JWT_JWKS_URL:-http://127.0.0.1:8081/.well-known/jwks.json}"
export AUTH_COOKIE_SECURE="${AUTH_COOKIE_SECURE:-false}"

# Per-service DB (host-run Spring Boot; docker-compose uses service-specific env in compose)
export AUTH_DB_NAME=auth_db
export AUTH_DB_USER=auth_user
export AUTHZ_DB_NAME=auth_db
export AUTHZ_DB_USER=auth_user
set +a
