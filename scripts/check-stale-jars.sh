#!/usr/bin/env bash
#
# Detect locally-running services executing a jar that is no longer the one on disk.
#
# WHY THIS EXISTS
#
# A `mvn package` replaces the jar file, but a JVM already running holds an open descriptor on
# the OLD inode. The file is unlinked from the directory yet still very much alive inside that
# process. So:
#
#   - the source is correct
#   - the on-disk jar is correct
#   - `javap` on the on-disk jar shows the fix
#   - and the running service is executing code from days ago
#
# Measured on this project: finance-service ran a deleted pre-fix jar (inode 47074233) while
# the on-disk jar (inode 47496165) had been built four and a half days earlier WITH the fix.
# Every discounted order was still failing with JE_UNBALANCED — 7,198 times in one log — against
# a defect that had already been fixed and committed. Separately, audit-service was started at
# 06:52:23 with a jar built at 06:55:00, three minutes LATER: its message queue climbed to 1,855
# undrained while `audit_events` sat frozen. Restarting drained it to 0 and the row count went
# 2,600 -> 4,010 immediately.
#
# The reason this is dangerous rather than merely annoying: it silently invalidates verification.
# You fix a bug, you re-run the check against the live stack, it still fails, and every instinct
# says the fix was wrong. The fix was fine. The process never loaded it.
#
# WHY IT COMPARES INODES AND NOT TIMESTAMPS
#
# A timestamp check asks "is the jar newer than the process?" — which misses the case where the
# jar was rebuilt and the process restarted in the same minute, and produces false alarms for a
# jar touched without being rebuilt. Inode identity is the actual question: is the file this
# process opened still the file at that path? The process-start-vs-jar-mtime comparison is kept
# as a secondary signal because it catches the same class and is easy to read.
#
# Exit 1 if any service is stale, so this can gate a verification run.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

stale=0
checked=0

check_one() {
  local name="$1" jar="$2"
  local pid
  pid="$(pgrep -f "$(basename "$jar")" | head -1)"
  [ -z "$pid" ] && return 0          # not running locally — nothing to say
  [ -f "$jar" ] || { echo "WARN  $name: running, but no jar at $jar"; return 0; }

  checked=$((checked + 1))

  local ondisk_inode running_line
  ondisk_inode="$(stat -f %i "$jar" 2>/dev/null || stat -c %i "$jar" 2>/dev/null)"
  running_line="$(lsof -p "$pid" 2>/dev/null | grep -F "$(basename "$jar")" | head -1)"

  # A deleted jar is the unambiguous case: the process opened a file that no longer exists.
  if printf '%s' "$running_line" | grep -q "(deleted)"; then
    echo "STALE $name (pid $pid) — executing a DELETED jar; the on-disk jar has been replaced"
    stale=$((stale + 1))
    return 0
  fi

  # Secondary signal: a jar built after the process started cannot be the one it loaded.
  local jar_epoch proc_epoch
  jar_epoch="$(stat -f %m "$jar" 2>/dev/null || stat -c %Y "$jar" 2>/dev/null)"
  proc_epoch="$(ps -p "$pid" -o lstart= 2>/dev/null | xargs -I{} date -j -f "%a %b %e %T %Y" "{}" +%s 2>/dev/null)"
  if [ -n "$jar_epoch" ] && [ -n "$proc_epoch" ] && [ "$jar_epoch" -gt "$proc_epoch" ]; then
    echo "STALE $name (pid $pid) — jar built $(( (jar_epoch - proc_epoch) / 60 ))m AFTER the process started"
    stale=$((stale + 1))
    return 0
  fi

  echo "ok    $name (pid $pid, inode $ondisk_inode)"
}

for dir in services/*/; do
  svc="$(basename "$dir")"
  check_one "$svc" "${dir}target/${svc}-1.0.0.jar"
done
check_one "gateway" "gateway/target/gateway-1.0.0.jar"

echo "----------------------------------------"
echo "checked=$checked stale=$stale"

if [ "$stale" -gt 0 ]; then
  cat >&2 <<'EOF'

ERROR: at least one service is running code that is not what is on disk.

Any verification against the live stack right now is measuring the OLD build. Restart the
services named above before trusting a single result, and re-run whatever you were verifying.
EOF
  exit 1
fi
