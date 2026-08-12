#!/usr/bin/env bash
# Start the full local stack: 16 backend services + gateway + frontend.
#
#   bash scripts/run-dev-services.sh              # stop anything running, then start everything
#   bash scripts/run-dev-services.sh --stop       # stop only
#   bash scripts/run-dev-services.sh --no-frontend
#   bash scripts/run-dev-services.sh --skip-stop  # start without stopping first (rarely what you want)
#
# Runs fine from an agent shell: services are started with setsid-equivalent detachment via nohup
# and the script does NOT `wait`, so nothing dies when the invoking shell exits. It still prints a
# real health table before returning, so "launched" and "up" are not confused for each other.
#
# WHAT THIS SCRIPT REFUSES TO DO, and why — each of these cost a debugging session:
#
#   1. It will not start a service whose jar has no BOOT-INF entries. A failed Spring Boot
#      repackage leaves a ~300 KB jar that BINDS ITS PORT AND ANSWERS NOTHING, which reads as
#      "started" everywhere except the one place you look last.
#   2. It will not start on top of a held port. The old process keeps the port, the new one dies
#      on bind, and you spend an hour reading fresh code against a five-day-old process.
#   3. It kills by EXECUTABLE, never by command line. `pkill -f <jar>` also matches shells that
#      merely NAME the jar — a build wait-loop, or this script — so a command-line match can kill
#      the thing doing the killing.
#   4. It waits on /actuator/health, not on `sleep`. A fixed sleep is a guess that is too short on
#      a cold JVM and wasted on a warm one.
#   5. It reports the truth at the end. The previous version printed "All services launched" and
#      exited 0 whether or not a single one had come up.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.dev-logs"
PID_FILE="$REPO_ROOT/.dev-pids"
PID_JSON="$REPO_ROOT/.dev-pids.json"
mkdir -p "$LOG_DIR"

DO_STOP=1; DO_START=1; DO_FRONTEND=1
for arg in "$@"; do
  case "$arg" in
    --stop)        DO_START=0 ;;
    --skip-stop)   DO_STOP=0 ;;
    --no-frontend) DO_FRONTEND=0 ;;
    -h|--help)     sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home}"
export PATH="$JAVA_HOME/bin:$PATH"
# shellcheck source=/dev/null
source "$REPO_ROOT/deploy/scripts/local-service-env.sh"

# module:port. Order is dependency order — auth first because every other service validates tokens
# against its JWKS, gateway last because it routes to all of them.
SERVICES=(
  "services/auth-service:8081"
  "services/user-service:8082"
  "services/authorization-service:8083"
  "services/pos-service:8084"
  "services/inventory-service:8085"
  "services/finance-service:8086"
  "services/purchasing-service:8087"
  "services/hr-service:8088"
  "services/crm-service:8089"
  "services/kitchen-service:8090"
  "services/reporting-service:8092"
  "services/audit-service:8093"
  "services/nlq-service:8094"
  "services/file-service:8095"
  "services/platform-admin-service:8096"
  "gateway:8080"
)

ts() { date +%H:%M:%S; }

# Kill every java process running the named jar. Executable-matched: see refusal 3 above.
kill_jar() {
  local name="$1" sig="${2:-TERM}" found=0 pid comm
  # Dots in "1.0.0" are ERE metacharacters to pgrep; escape them.
  for pid in $(pgrep -f "${name}-1\.0\.0\.jar" 2>/dev/null); do
    comm="$(ps -p "$pid" -o comm= 2>/dev/null)"
    if [ "${comm##*/}" = "java" ]; then
      kill "-$sig" "$pid" 2>/dev/null && found=1
      echo "  [$(ts)] SIG$sig $name (pid $pid)"
    fi
  done
  return $((1 - found))
}

stop_all() {
  echo "=== stopping ==="
  local entry name
  for entry in "${SERVICES[@]}"; do
    name="$(basename "${entry%%:*}")"
    kill_jar "$name" TERM
  done
  for pid in $(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null); do
    echo "  [$(ts)] SIGTERM frontend (pid $pid)"; kill "$pid" 2>/dev/null
  done
  # Give the JVMs a chance to shut down cleanly, then insist.
  sleep 8
  for entry in "${SERVICES[@]}"; do
    name="$(basename "${entry%%:*}")"
    kill_jar "$name" KILL >/dev/null 2>&1
  done
  sleep 2
  echo "  [$(ts)] stopped"
}

# Refusal 1: a jar that is not a bootable jar is not started.
jar_is_bootable() {
  local jar="$1"
  [ -f "$jar" ] || return 1
  [ "$(unzip -l "$jar" 2>/dev/null | grep -c 'BOOT-INF/')" -ge 10 ]
}

# Refusal 2: never start on top of a held port.
port_is_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# Refusal 4: wait for health, not for a guess. Returns 0 as soon as the port answers.
wait_for_health() {
  local port="$1" limit="${2:-90}" i
  for ((i = 0; i < limit; i++)); do
    if curl -sf -m 2 "http://127.0.0.1:${port}/actuator/health" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

start_all() {
  echo "=== starting ==="
  : > "$PID_FILE"
  local entry module port name jar refused=0
  for entry in "${SERVICES[@]}"; do
    module="${entry%%:*}"; port="${entry##*:}"; name="$(basename "$module")"
    jar="$REPO_ROOT/$module/target/$name-1.0.0.jar"

    if ! jar_is_bootable "$jar"; then
      echo "  [$(ts)] REFUSED $name — jar missing or has no BOOT-INF (run: mvn clean package -Dmaven.test.skip=true)"
      refused=1; continue
    fi
    if ! port_is_free "$port"; then
      echo "  [$(ts)] REFUSED $name — port $port already held (use --stop first)"
      refused=1; continue
    fi

    nohup java -jar "$jar" >> "$LOG_DIR/$name.log" 2>&1 &
    echo "$!" >> "$PID_FILE"
    echo "  [$(ts)] started $name (pid $!, port $port)"

    # auth-service gates everything else: nothing can validate a token until its JWKS answers.
    if [ "$name" = "auth-service" ]; then
      if wait_for_health "$port" 90; then echo "  [$(ts)] auth-service healthy"
      else echo "  [$(ts)] WARNING auth-service did not become healthy — the rest will likely fail"; fi
    fi
  done
  return $refused
}

start_frontend() {
  if [[ ! -f "$REPO_ROOT/frontend/.env.local" ]]; then
    cat > "$REPO_ROOT/frontend/.env.local" <<'EOF'
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_WS_BASE_URL=ws://localhost:8080
NEXT_PUBLIC_DEFAULT_TENANT_SLUG=test
EOF
  fi
  [[ -d "$REPO_ROOT/frontend/node_modules" ]] || (cd "$REPO_ROOT/frontend" && pnpm install)
  echo "  [$(ts)] starting frontend"
  (cd "$REPO_ROOT/frontend" && nohup pnpm dev >> "$LOG_DIR/frontend.log" 2>&1 & echo "$!" >> "$PID_FILE")
}

# Refusal 5: say what is actually true.
health_report() {
  echo
  echo "=== health ==="
  printf "  %-26s %-6s %s\n" "SERVICE" "PORT" "STATUS"
  local entry module port name up=0 down=0 json="{"
  for entry in "${SERVICES[@]}"; do
    module="${entry%%:*}"; port="${entry##*:}"; name="$(basename "$module")"
    if curl -sf -m 3 "http://127.0.0.1:${port}/actuator/health" >/dev/null 2>&1; then
      printf "  %-26s %-6s UP\n" "$name" "$port"; up=$((up + 1))
    elif lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
      # The dangerous middle state: something holds the port and does not answer.
      printf "  %-26s %-6s PORT HELD, NOT ANSWERING  <-- check %s\n" "$name" "$port" ".dev-logs/$name.log"
      down=$((down + 1))
    else
      printf "  %-26s %-6s DOWN  <-- check %s\n" "$name" "$port" ".dev-logs/$name.log"
      down=$((down + 1))
    fi
    local pid; pid="$(pgrep -f "${name}-1\.0\.0\.jar" 2>/dev/null | head -1)"
    [ -n "$pid" ] && json="$json\"$name\":$pid,"
  done
  if curl -sf -m 3 "http://127.0.0.1:3000" >/dev/null 2>&1; then
    printf "  %-26s %-6s UP\n" "frontend" "3000"
  else
    printf "  %-26s %-6s DOWN or still compiling\n" "frontend" "3000"
  fi
  local fpid; fpid="$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null | head -1)"
  [ -n "$fpid" ] && json="$json\"frontend\":$fpid,"
  echo "${json%,}}" > "$PID_JSON"
  echo
  echo "  $up up, $down down.  Frontend http://localhost:3000  ·  Gateway http://localhost:8080"
  echo "  Logs: $LOG_DIR/   ·   Stop: bash scripts/run-dev-services.sh --stop"
  [ "$down" -eq 0 ]
}

[ "$DO_STOP" -eq 1 ] && stop_all
if [ "$DO_START" -eq 0 ]; then echo "[$(ts)] stop-only, done."; exit 0; fi

start_all
[ "$DO_FRONTEND" -eq 1 ] && start_frontend

echo
echo "  [$(ts)] waiting for services to come up (JVM cold start is 20-60s each)…"
for entry in "${SERVICES[@]}"; do wait_for_health "${entry##*:}" 45 >/dev/null 2>&1; done

health_report
exit $?
