#!/usr/bin/env bash
# S1-09 helper: restart one host-run service exactly the way start-dev.sh starts it.
#   s1-09-restart.sh <name> <module-dir> <port>
set -uo pipefail
ROOT="/Users/muhammadumer/Documents/Projects/ResturantOS"
NAME="$1"; MODULE="$2"; PORT="$3"
JAR="$MODULE/target/$(basename "$MODULE")-1.0.0.jar"
LOG="$ROOT/.dev-logs/${NAME}.log"

boot_entries=$(unzip -l "$ROOT/$JAR" 2>/dev/null | grep -c "BOOT-INF/lib" || echo 0)
if [[ "$boot_entries" -lt 50 ]]; then
  echo "REFUSING: $JAR has only $boot_entries BOOT-INF/lib entries — repackage was skipped" >&2
  exit 1
fi

pids=$(pgrep -f "$(basename "$MODULE")/target/$(basename "$MODULE")-1.0.0.jar" || true)
[[ -n "$pids" ]] && kill -9 $pids 2>/dev/null
sleep 3

(
  cd "$ROOT"
  # shellcheck source=/dev/null
  source "$ROOT/scripts/dev-env.sh" >/dev/null 2>&1
  # shellcheck source=/dev/null
  source "$ROOT/scripts/local-service-env.sh" >/dev/null 2>&1
  exec java -Xmx512m -jar "$JAR"
) >>"$LOG" 2>&1 &
echo "started $NAME pid $!"

for _ in $(seq 1 90); do
  body=$(curl -s --max-time 2 "http://localhost:${PORT}/actuator/health" || true)
  [[ "$body" == *'"status":"UP"'* ]] && { echo "$NAME UP"; exit 0; }
  sleep 2
done
echo "$NAME did not come up in 180s" >&2
tail -25 "$LOG" >&2
exit 1
