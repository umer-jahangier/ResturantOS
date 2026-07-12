#!/usr/bin/env bash
# RestaurantOS — start full local dev stack (infra + all backend services + frontend)
#
# Usage:
#   ./scripts/start-dev.sh              # start everything
#   ./scripts/start-dev.sh --stop       # stop host services + docker infra
#   ./scripts/start-dev.sh --infra-only # docker infra only
#   ./scripts/start-dev.sh --skip-build # skip upfront mvn package
#   ./scripts/start-dev.sh --skip-docker-build # use cached Docker images (no pull/rebuild)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$REPO_ROOT/.dev-logs"
PID_FILE="$REPO_ROOT/.dev-pids.json"
DEPLOY_DIR="$REPO_ROOT/deploy"

STOP=false
INFRA_ONLY=false
SKIP_BUILD=false
SKIP_DOCKER_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --stop|-Stop) STOP=true ;;
    --infra-only|-InfraOnly) INFRA_ONLY=true ;;
    --skip-build|-SkipBuild) SKIP_BUILD=true ;;
    --skip-docker-build|-SkipDockerBuild) SKIP_DOCKER_BUILD=true ;;
    -h|--help)
      sed -n '2,9p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Usage: $0 [--stop] [--infra-only] [--skip-build] [--skip-docker-build]" >&2
      exit 1
      ;;
  esac
done

step() {
  echo ""
  echo "==> $*"
}

warn() {
  echo "WARNING: $*" >&2
}

stop_port() {
  local port=$1
  local pids
  pids=$(lsof -ti "tcp:${port}" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

stop_dev_stack() {
  step "Stopping host services (ports 3000, 8080-8096)"
  local port
  for port in 3000 8080 8081 8082 8083 8086 8093 8095 8096; do
    stop_port "$port"
  done

  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      [[ -z "$pid" || "$pid" == "null" ]] && continue
      kill "$pid" 2>/dev/null || true
    done < <(grep -Eo '[0-9]+' "$PID_FILE" || true)
    rm -f "$PID_FILE"
  fi

  step "Stopping Docker infrastructure (~30-60s)"
  (cd "$DEPLOY_DIR" && docker compose down --timeout 10 --remove-orphans)
  echo "Stopped."
  exit 0
}

wait_http_ok() {
  local url=$1
  local timeout_sec=${2:-120}
  local deadline=$((SECONDS + timeout_sec))
  while (( SECONDS < deadline )); do
    if curl -sf --max-time 5 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

check_toolchain() {
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/dev-env.sh"

  local tool
  for tool in docker java mvn; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "ERROR: Missing '$tool'. Install Docker Desktop, JDK 25, and Maven." >&2
      exit 1
    fi
  done

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "ERROR: pnpm not found. Install with: brew install pnpm  (or: corepack enable)" >&2
    exit 1
  fi

  if [[ ! -d "$JAVA_HOME" ]]; then
    warn "JAVA_HOME not found at $JAVA_HOME — set JAVA_HOME to JDK 25 before running."
  fi
}

warn_port_conflict() {
  if lsof -ti tcp:5432 -sTCP:LISTEN >/dev/null 2>&1; then
    if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^restaurantos-postgres$'; then
      warn "Port 5432 is in use (often ServBay PostgreSQL)."
      warn "Stop it first: /Applications/ServBay/script/pgsql.sh stop 17"
    fi
  fi
}

start_service() {
  local name=$1
  local maven_module=$2
  local artifact
  artifact="$(basename "$maven_module")"
  local jar_path="$REPO_ROOT/$maven_module/target/${artifact}-1.0.0.jar"
  local log_file="$LOG_DIR/${name}.log"

  if [[ ! -f "$jar_path" ]]; then
    mvn -pl "$maven_module" -am -DskipTests package -q
  fi

  (
    cd "$REPO_ROOT"
    # shellcheck source=/dev/null
    source "$SCRIPT_DIR/dev-env.sh"
    # shellcheck source=/dev/null
    source "$SCRIPT_DIR/local-service-env.sh"
    exec java -jar "$jar_path"
  ) >>"$log_file" 2>&1 &

  local pid=$!
  echo "  Started $name (PID $pid) -> $log_file" >&2
  echo "$pid"
}

[[ "$STOP" == true ]] && stop_dev_stack

check_toolchain
warn_port_conflict

# shellcheck source=/dev/null
source "$SCRIPT_DIR/local-service-env.sh"

frontend_env="$REPO_ROOT/frontend/.env.local"
if [[ ! -f "$frontend_env" ]]; then
  cat >"$frontend_env" <<'EOF'
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8080
EOF
fi

mkdir -p "$LOG_DIR"

step "Starting Docker infrastructure"
if [[ "$SKIP_DOCKER_BUILD" == true ]]; then
  make -C "$REPO_ROOT/deploy" dev-up-fast
else
  make -C "$REPO_ROOT" dev-up
fi

if [[ "$INFRA_ONLY" == true ]]; then
  echo "Infra only — done. Backend services not started."
  exit 0
fi

step "Waiting for Eureka"
if ! wait_http_ok "http://localhost:8761/" 180; then
  warn "Eureka health check timed out — continuing anyway"
fi

if [[ "$SKIP_BUILD" != true ]]; then
  step "Building backend JARs (skip next time with --skip-build)"
  mvn -pl services/auth-service,services/authorization-service,services/user-service,services/platform-admin-service,services/audit-service,services/file-service,services/finance-service,gateway \
    -am -DskipTests package -q
fi

step "Starting backend services (background)"
AUTH_PID=$(start_service auth-service services/auth-service)
sleep 15

AUTHZ_PID=$(start_service authorization-service services/authorization-service)
USER_PID=$(start_service user-service services/user-service)
PLATFORM_PID=$(start_service platform-admin-service services/platform-admin-service)
AUDIT_PID=$(start_service audit-service services/audit-service)
FILE_PID=$(start_service file-service services/file-service)
FINANCE_PID=$(start_service finance-service services/finance-service)

step "Waiting for auth-service JWKS before gateway"
if ! wait_http_ok "http://localhost:8081/.well-known/jwks.json" 180; then
  warn "Auth JWKS not ready — gateway may fail. Check .dev-logs/auth-service.log"
fi

step "Applying auth refresh-lookup owner (post-migration)"
if docker exec -i restaurantos-postgres psql -U "$POSTGRES_SUPERUSER" -d auth_db -q \
  <"$DEPLOY_DIR/init/04-auth-refresh-lookup-owner.sql" 2>/dev/null; then
  :
else
  warn "Could not apply deploy/init/04-auth-refresh-lookup-owner.sql"
fi

GATEWAY_PID=$(start_service gateway gateway)

step "Starting frontend (Next.js)"
frontend_log="$LOG_DIR/frontend.log"
(
  cd "$REPO_ROOT/frontend"
  if [[ ! -d node_modules ]]; then
    pnpm install
  fi
  exec pnpm dev
) >>"$frontend_log" 2>&1 &
FRONTEND_PID=$!

cat >"$PID_FILE" <<EOF
{
  "auth-service": ${AUTH_PID},
  "authorization-service": ${AUTHZ_PID},
  "user-service": ${USER_PID},
  "platform-admin-service": ${PLATFORM_PID},
  "audit-service": ${AUDIT_PID},
  "file-service": ${FILE_PID},
  "finance-service": ${FINANCE_PID},
  "gateway": ${GATEWAY_PID},
  "frontend": ${FRONTEND_PID}
}
EOF

echo ""
echo "====================================================="
echo " RestaurantOS dev stack starting"
echo "====================================================="
echo ""
echo "  Frontend     http://localhost:3000"
echo "  API Gateway  http://localhost:8080"
echo "  Eureka       http://localhost:8761"
echo "  RabbitMQ UI  http://localhost:15672"
echo "  Mailpit      http://localhost:8025"
echo ""
echo "  Logs dir:    $LOG_DIR"
echo ""
echo "  View a log:       tail -f $LOG_DIR/gateway.log"
echo "  Tail all logs:    tail -f $LOG_DIR/*.log"
echo "  Stop everything:  ./scripts/start-dev.sh --stop"
echo ""
echo "Services take 1-3 min to fully register in Eureka."
