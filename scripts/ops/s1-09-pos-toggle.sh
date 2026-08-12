#!/usr/bin/env bash
# S1-09 evidence helper: stop / start pos-service exactly the way start-dev.sh does.
#   s1-09-pos-toggle.sh stop
#   s1-09-pos-toggle.sh start   (waits until /actuator/health is UP)
set -uo pipefail
ROOT="/Users/muhammadumer/Documents/Projects/ResturantOS"
LOG="$ROOT/.dev-logs/pos-service.log"

case "${1:-}" in
  stop)
    pids=$(pgrep -f "pos-service/target/pos-service-1.0.0.jar" || true)
    [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null
    for _ in $(seq 1 30); do
      if ! curl -sf --max-time 2 http://localhost:8084/actuator/health >/dev/null 2>&1; then
        echo "pos-service DOWN (8084 refuses)"; exit 0
      fi
      sleep 1
    done
    echo "pos-service still answering on 8084" >&2; exit 1 ;;
  start)
    if curl -s -o /dev/null --max-time 2 http://localhost:8084/actuator/health; then
      echo "pos-service already up"; exit 0
    fi
    (
      cd "$ROOT"
      # shellcheck source=/dev/null
      source "$ROOT/scripts/dev-env.sh" >/dev/null 2>&1
      # shellcheck source=/dev/null
      source "$ROOT/scripts/local-service-env.sh" >/dev/null 2>&1
      exec java -Xmx512m -jar services/pos-service/target/pos-service-1.0.0.jar
    ) >>"$LOG" 2>&1 &
    echo "started pid $!"
    for _ in $(seq 1 90); do
      body=$(curl -s --max-time 2 http://localhost:8084/actuator/health || true)
      [[ "$body" == *'"status":"UP"'* ]] && { echo "pos-service UP"; exit 0; }
      sleep 2
    done
    echo "pos-service did not come up in 180s" >&2; exit 1 ;;
  *) echo "usage: $0 stop|start" >&2; exit 2 ;;
esac
