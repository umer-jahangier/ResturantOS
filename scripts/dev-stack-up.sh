#!/usr/bin/env bash
# RestaurantOS — one-command, health-gated local dev stack bring-up.
#
# Usage:
#   bash scripts/dev-stack-up.sh                 # render + up -d + health gate (default profile)
#   bash scripts/dev-stack-up.sh --full           # also bring up clickhouse + pgadmin (extra ~1.3GB RAM)
#   bash scripts/dev-stack-up.sh --check-only     # skip `docker compose up -d`, just run the health gate
#                                                  # against whatever is currently running
#
# What this does that `docker compose up` alone does not:
#   1. Renders deploy/init/rabbitmq-definitions.json from the committed template, injecting a
#      RabbitMQ SHA-256 password_hash computed from deploy/.env, so the application user exists
#      in RabbitMQ from the FIRST boot — no rabbitmqctl by hand. (Root cause: rabbitmq.conf's
#      `load_definitions` SUPPRESSES the RABBITMQ_DEFAULT_USER/PASS bootstrap entirely; a
#      definitions file with no `users` key boots a broker with zero users.)
#   2. Brings up infra with `docker compose up -d` (no --build — the in-Docker Maven build for
#      eureka/config-server OOMs on an 8GB host; images are prebuilt, see `make dev-rebuild`).
#   3. HEALTH GATES every service's actual health endpoint until UP, with a hard timeout. On
#      timeout it prints the offending service's last 50 log lines and exits 1 — it does not
#      silently continue. ClickHouse + pgAdmin are memory-heavy and stay OFF by default; pass
#      --full (or set DEV_STACK_FULL=1) to include them.
#
set -uo pipefail

# Docker Desktop's credential helper is not on the default PATH on this host — without it
# `docker compose` fails obscurely (credential helper not found).
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
COMPOSE="docker compose -f $COMPOSE_FILE"

FULL=${DEV_STACK_FULL:-0}
CHECK_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --full) FULL=1 ;;
    --check-only) CHECK_ONLY=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

step() { echo ""; echo "==> $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Pre-flight
# ---------------------------------------------------------------------------
step "Pre-flight checks"

[[ -f "$DEPLOY_DIR/.env" ]] || die "deploy/.env missing. Run: bash deploy/generate-keys.sh"
command -v python3 >/dev/null 2>&1 || die "python3 is required to compute the RabbitMQ password hash."
command -v docker  >/dev/null 2>&1 || die "docker CLI not found on PATH."

if lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
  if ! lsof -nP -iTCP:5432 -sTCP:LISTEN | grep -qi "com.docke\|docker"; then
    lsof -nP -iTCP:5432 -sTCP:LISTEN >&2
    die "Something native is already listening on :5432 (a host-installed Postgres?). Stop it before bringing up the postgres container — the port bind will otherwise fail or you'll talk to the wrong database."
  fi
fi

if [[ "$CHECK_ONLY" -eq 0 ]]; then

  # ---------------------------------------------------------------------------
  # 1. Render RabbitMQ definitions.json from the template (declarative users)
  # ---------------------------------------------------------------------------
  step "Rendering RabbitMQ definitions (declarative user + permissions)"

  TEMPLATE="$DEPLOY_DIR/init/rabbitmq-definitions.template.json"
  RENDERED="$DEPLOY_DIR/init/rabbitmq-definitions.json"
  [[ -f "$TEMPLATE" ]] || die "$TEMPLATE missing."

  RABBITMQ_USERNAME="$(grep '^RABBITMQ_USERNAME=' "$DEPLOY_DIR/.env" | cut -d= -f2-)"
  RABBITMQ_PASSWORD="$(grep '^RABBITMQ_PASSWORD=' "$DEPLOY_DIR/.env" | cut -d= -f2-)"
  [[ -n "$RABBITMQ_USERNAME" && -n "$RABBITMQ_PASSWORD" ]] || die "RABBITMQ_USERNAME/RABBITMQ_PASSWORD missing from deploy/.env"

  # RabbitMQ's default hashing (rabbit_password_hashing_sha256):
  #   salt = 4 random bytes; hash = base64( salt || sha256( salt || utf8(password) ) )
  RABBITMQ_PASSWORD_HASH="$(python3 - "$RABBITMQ_PASSWORD" <<'PYEOF'
import sys, os, hashlib, base64
password = sys.argv[1]
salt = os.urandom(4)
digest = hashlib.sha256(salt + password.encode("utf-8")).digest()
print(base64.b64encode(salt + digest).decode("ascii"))
PYEOF
)"
  [[ -n "$RABBITMQ_PASSWORD_HASH" ]] || die "Failed to compute RabbitMQ password hash."

  python3 - "$TEMPLATE" "$RENDERED" "$RABBITMQ_USERNAME" "$RABBITMQ_PASSWORD_HASH" <<'PYEOF'
import sys
template_path, out_path, username, password_hash = sys.argv[1:5]
with open(template_path, "r", encoding="utf-8") as f:
    content = f.read()
content = content.replace("@@RABBITMQ_USERNAME@@", username)
content = content.replace("@@RABBITMQ_PASSWORD_HASH@@", password_hash)
with open(out_path, "w", encoding="utf-8") as f:
    f.write(content)
PYEOF

  grep -q '"users"' "$RENDERED" || die "Render failed: $RENDERED has no users block."
  echo "Rendered $RENDERED with declarative user '$RABBITMQ_USERNAME'."

  # ---------------------------------------------------------------------------
  # 2. Bring up infra (no --build — see make dev-rebuild for that)
  # ---------------------------------------------------------------------------
  step "Bringing up infra (docker compose up -d, no --build)"
  PROFILE_ARGS=()
  if [[ "$FULL" -eq 1 ]]; then
    $COMPOSE up -d
  else
    # Default profile: everything except the two memory-heavy, non-essential
    # containers (ClickHouse ~1GB, pgAdmin ~300MB) on this 8GB host.
    ALL_SERVICES=$($COMPOSE config --services)
    UP_SERVICES=$(echo "$ALL_SERVICES" | grep -vE '^(clickhouse|pgadmin)$')
    # shellcheck disable=SC2086
    $COMPOSE up -d $UP_SERVICES
    echo "(clickhouse, pgadmin skipped — pass --full or DEV_STACK_FULL=1 to include them)"
  fi
  # `up -d` can legitimately report a non-zero exit for a container it could not
  # gracefully restart (e.g. a paused container) — don't let that abort the script;
  # the health gate below is the real pass/fail signal.
fi

# ---------------------------------------------------------------------------
# 3. HEALTH GATE — poll every service until UP, hard timeout, name the culprit
# ---------------------------------------------------------------------------
step "Health gate (this can take 60-90s on a cold host)"

POSTGRES_USER="$(grep '^POSTGRES_SUPERUSER=' "$DEPLOY_DIR/.env" | cut -d= -f2-)"
REDIS_PASSWORD="$(grep '^REDIS_PASSWORD=' "$DEPLOY_DIR/.env" | cut -d= -f2-)"

check_postgres()      { docker exec restaurantos-postgres pg_isready -U "$POSTGRES_USER" -d postgres >/dev/null 2>&1; }
check_redis()         { docker exec restaurantos-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null | grep -q PONG; }
check_rabbitmq()      { docker exec restaurantos-rabbitmq rabbitmq-diagnostics -q ping >/dev/null 2>&1; }
check_minio()         { docker exec restaurantos-minio sh -c 'mc ready local 2>/dev/null || wget -q --spider http://localhost:9000/minio/health/live' >/dev/null 2>&1; }
check_opa()           { curl -sf --max-time 3 http://localhost:8181/health >/dev/null 2>&1; }
check_eureka()        { curl -sf --max-time 3 http://localhost:8761/actuator/health 2>/dev/null | grep -q '"status":"UP"'; }
check_config_server() { curl -sf --max-time 3 http://localhost:8888/actuator/health 2>/dev/null | grep -q '"status":"UP"'; }
check_mailpit()       { curl -sf --max-time 3 http://localhost:8025/api/v1/info >/dev/null 2>&1; }
check_clickhouse()    { curl -sf --max-time 3 http://localhost:8123/ping >/dev/null 2>&1; }
check_pgadmin()       { curl -sf --max-time 3 -o /dev/null -w '%{http_code}' http://localhost:5050/login >/dev/null 2>&1; }

SERVICES=(postgres redis rabbitmq minio opa eureka config_server mailpit)
if [[ "$FULL" -eq 1 ]]; then
  SERVICES+=(clickhouse pgadmin)
fi

CONTAINER_OF() {
  case "$1" in
    config_server) echo "restaurantos-config-server" ;;
    *) echo "restaurantos-$1" ;;
  esac
}

TIMEOUT_SEC=120
POLL_INTERVAL=3
FAILED=0

for svc in "${SERVICES[@]}"; do
  container="$(CONTAINER_OF "$svc")"
  deadline=$((SECONDS + TIMEOUT_SEC))
  printf "  %-15s " "$svc"
  ok=0
  while (( SECONDS < deadline )); do
    if "check_${svc}"; then
      ok=1
      break
    fi
    sleep "$POLL_INTERVAL"
  done
  if [[ "$ok" -eq 1 ]]; then
    echo "UP"
  else
    echo "DOWN (timed out after ${TIMEOUT_SEC}s)"
    echo "----- last 50 log lines: $container -----"
    docker logs --tail 50 "$container" 2>&1 || echo "(container not found / no logs)"
    echo "----- end log excerpt -----"
    FAILED=1
  fi
done

if [[ "$FAILED" -eq 1 ]]; then
  die "Health gate FAILED — see the offending service's log excerpt above. Stack is NOT ready."
fi

# ---------------------------------------------------------------------------
# 4. Ready banner
# ---------------------------------------------------------------------------
step "Stack is UP and healthy"
cat <<'EOF'

Infra is ready. Next: start the backend services + frontend on the host:
  ./scripts/start-dev.sh

Then log in at http://localhost:3000 with one of the seeded personas:
  manager1@demo.local   / Manager1#2026   (tenantSlug: demo)  — vendor.* full purchasing/AP
  manager2@demo.local   / Manager2#2026   (tenantSlug: demo)  — second approver identity
  cashier@demo.local    / Cashier#2026    (tenantSlug: demo)  — POS only
  finance_demo@demo.local / Finance#2026  (tenantSlug: demo)  — finance viewer

See scripts/DEV-STACK-RUNBOOK.md for host pitfalls and known failure modes.
EOF
