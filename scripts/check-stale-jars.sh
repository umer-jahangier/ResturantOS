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
# process opened still the file at that path? So the inode is the PRIMARY signal, and the
# process-start-vs-jar-mtime comparison stays as the gating secondary — it is not merely
# redundant with the inode, because inode numbers get RECYCLED. Observed here on 2026-08-12:
# inode 50484413 was pos-service's boot jar at 15:39; a rebuild at 15:45 unlinked it and the
# freed number was immediately reused for pos-service-1.0.0.jar.original. Had that rebuild
# landed the new BOOT jar on the recycled number instead, an inode-equality test would have
# said "ok" about a process running three-hour-old code, and mtime would have been the only
# thing left standing. Both signals gate. Neither is decoration.
#
# Exit 1 if any service is stale, so this can gate a verification run.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

stale=0
checked=0
warned=0

# ---------------------------------------------------------------------------
# WHICH PROCESS IS ACTUALLY RUNNING THIS JAR
#
# The obvious version of this line is wrong, and was wrong here:
#
#   pid="$(pgrep -f "$(basename "$jar")" | head -1)"
#
# `pgrep -f` matches the ENTIRE COMMAND LINE. It does not answer "who is running
# pos-service-1.0.0.jar?", it answers "whose command line CONTAINS that string?" —
# a different question, which also matches things that are not the service at all:
#
#   until unzip -l services/pos-service/target/pos-service-1.0.0.jar | grep -q BOOT-INF/; do sleep 1; done
#
# a wait-loop shell that merely names the jar while waiting for a build. `head -1`
# then takes the lowest pid, and the shell wins whenever it started first. The script
# went on to compare THAT SHELL's start time against the jar and announced:
#
#   STALE pos-service (pid 6357) — jar built 0m AFTER the process started
#   ERROR: at least one service is running code that is not what is on disk.
#
# while the real JVM — a different pid entirely — was holding precisely the on-disk
# inode. Observed twice on 2026-08-12.
#
# This is the one signal in the repo whose whole job is to say whether a live
# verification can be trusted, so a false STALE costs more than it looks like it
# should. It sends you off to rebuild and restart a service that was already correct,
# and — the expensive part — it teaches you to wave past a gate that is right almost
# every time. A gate that cries wolf is worse than no gate: it launders a true warning
# into noise, and this script exits 1 to block verification runs, so the failure is silent.
#
# So: match on the EXECUTABLE, not on the command line. Only a java process can be
# running a jar; everything else is a process talking about one.
jvms_running() {
  local jar_base="$1" pid comm argv0
  # The dots in "1.0.0" are ERE metacharacters to pgrep; escape them so the pattern
  # cannot also match a hypothetical 1X0Y0 jar.
  for pid in $(pgrep -f "${jar_base//./\\.}" 2>/dev/null); do
    # macOS prints the full path here, Linux the bare name; ${x##*/} normalises both.
    #
    # argv[0] is consulted as well because `comm` is not always the whole story: in the
    # MULTI-column form (ps -axo pid=,comm=,args=) macOS truncates comm to 16 characters,
    # so "/opt/homebrew/opt/openjdk@25/.../bin/java" arrives as "/opt/homebrew/op". The
    # single-column form used here does not truncate — but if it ever did, the JVM would
    # fail this test, the service would look "not running", and it would be skipped in
    # SILENCE. Missing a service entirely is the worst outcome available to this script,
    # so it is worth two cheap reads instead of one.
    comm="$(ps -p "$pid" -o comm= 2>/dev/null)"
    argv0="$(ps -p "$pid" -o args= 2>/dev/null | awk '{print $1}')"
    if [ "${comm##*/}" = "java" ] || [ "${argv0##*/}" = "java" ]; then
      printf '%s\n' "$pid"
    fi
  done
}

# The inode of the file this process actually has open at that path — the whole ball game.
# Prints "<inode>|present" or "<inode>|deleted"; prints nothing if it holds no such file.
#
# The match is anchored to "/<basename>" at END of string rather than done with a substring
# grep, because a substring grep also matches the decoy Spring Boot leaves next door:
#
#   .../user-service-1.0.0.jar.original   <- 108 KB pre-repackage thin jar, inode 49792841
#   .../user-service-1.0.0.jar            <- 107 MB boot jar,               inode 50496256
#
# `lsof -p PID | grep -F user-service-1.0.0.jar | head -1` happily returns the .original row.
# Since the "(deleted)" marker lives on the row for the REAL jar, that shadow turns a stale
# process into a clean "ok" — a false negative, the direction that actually hurts.
#
# lsof -F (one field per line: f=descriptor, i=inode, n=name) is used instead of slicing
# columns because a NAME can contain spaces, and this repo demonstrably grows files called
# "PosServiceApplication 10.class". Records are flushed on the "f" marker so the parse does
# not depend on i preceding n.
open_jar_inode() {
  local pid="$1" jar_base="$2"
  lsof -p "$pid" -F in 2>/dev/null | awk -v base="/$jar_base" '
    function flush(  d) {
      if (nm != "" && !found) {
        d = 0
        if (nm ~ / \(deleted\)$/) { d = 1; sub(/ \(deleted\)$/, "", nm) }
        if (length(nm) >= length(base) && substr(nm, length(nm) - length(base) + 1) == base) {
          print ino "|" (d ? "deleted" : "present"); found = 1
        }
      }
      ino = ""; nm = ""
    }
    /^f/ { flush(); next }
    /^i/ { ino = substr($0, 2); next }
    /^n/ { nm  = substr($0, 2); next }
    END  { flush() }
  '
}

check_one() {
  local name="$1" jar="$2"
  local base; base="$(basename "$jar")"

  local pids
  pids="$(jvms_running "$base")"
  [ -z "$pids" ] && return 0          # not running locally — nothing to say

  local pid_list pid_count
  pid_list="$(printf '%s' "$pids" | tr '\n' ' ' | sed 's/ *$//')"
  pid_count="$(printf '%s\n' "$pids" | wc -l | tr -d ' ')"

  checked=$((checked + 1))

  # A running service with NO jar on disk is the loudest case in this file, not the quietest.
  #
  # It was a WARN, and a WARN is exactly wrong here. Every other line in this script compares
  # the running code against the code on disk; this is the one state where that comparison
  # CANNOT BE FORMED AT ALL. The process is necessarily holding an unlinked file — it is running
  # something, and there is nothing left to check it against. `mvn clean` on a module whose
  # service is still up produces precisely this, and it was nearly trusted for a verification
  # today. "WARN" reads as "noted, carry on", which is the opposite of what a reader should do.
  #
  # It is arguably worse than STALE: a stale service can be restarted from the jar sitting right
  # there, whereas this one has to be rebuilt before it can even be diagnosed. Same word, though,
  # because callers grep for "^STALE <svc> " and this must fail their gate too.
  if [ ! -f "$jar" ]; then
    echo "STALE $name (pid $pid_list) — running, but there is NO jar at $jar; the module was cleaned and this process is holding an unlinked file"
    stale=$((stale + 1))
    return 0
  fi

  local ondisk_inode jar_epoch
  ondisk_inode="$(stat -f %i "$jar" 2>/dev/null || stat -c %i "$jar" 2>/dev/null)"
  jar_epoch="$(stat -f %m "$jar" 2>/dev/null || stat -c %Y "$jar" 2>/dev/null)"

  local pid open ino state proc_epoch bad=0 fresh_pids=""
  for pid in $pids; do
    open="$(open_jar_inode "$pid" "$base")"

    if [ -z "$open" ]; then
      # No descriptor on this path at all: either lsof told us nothing, or the process is
      # genuinely not holding the file it was started with (user-service does exactly this
      # when it boots the thin .original). Fall back to the weaker timestamp signal — and
      # say out loud that that is what happened, so the line can be judged for what it is.
      proc_epoch="$(ps -p "$pid" -o lstart= 2>/dev/null | xargs -I{} date -j -f "%a %b %e %T %Y" "{}" +%s 2>/dev/null)"
      if [ -n "$jar_epoch" ] && [ -n "$proc_epoch" ] && [ "$jar_epoch" -gt "$proc_epoch" ]; then
        echo "STALE $name (pid $pid) — holds no descriptor on $base, and the jar was built $(( (jar_epoch - proc_epoch) / 60 ))m AFTER the process started"
        bad=$((bad + 1))
      else
        echo "WARN  $name (pid $pid) — cannot read the running inode (lsof reports no $base); freshness UNVERIFIED"
        warned=$((warned + 1))
      fi
      continue
    fi

    ino="${open%%|*}"
    state="${open##*|}"

    # A deleted jar is the unambiguous case: the process opened a file that no longer exists.
    if [ "$state" = "deleted" ]; then
      echo "STALE $name (pid $pid) — executing a DELETED jar (inode $ino); the on-disk jar is inode $ondisk_inode"
      bad=$((bad + 1))
      continue
    fi

    if [ "$ino" != "$ondisk_inode" ]; then
      echo "STALE $name (pid $pid) — running inode $ino, but the jar on disk is inode $ondisk_inode"
      bad=$((bad + 1))
      continue
    fi

    fresh_pids="$fresh_pids $pid"
  done

  if [ "$bad" -gt 0 ]; then
    stale=$((stale + 1))
    return 0
  fi

  # Same inode, but the file was written after the process started. Either someone touched it
  # (harmless) or the bytes changed under the process — a build that rewrote the file in place,
  # or a rebuild that landed on a RECYCLED inode number, neither of which inode equality can
  # see. A Spring Boot fat jar is read lazily, so a process can go on loading classes out of a
  # file that was rewritten beneath it hours ago.
  #
  # This gates. It was briefly a non-gating WARN on the theory that a stray `touch` was the
  # likelier explanation, which was the wrong trade: the false STALE this script was reported
  # for came from matching the WRONG PROCESS, and that is fixed above by matching on the
  # executable. Loosening the staleness rule on top of that would have bought nothing and sold
  # a true positive — the exact failure this file exists to prevent.
  local start_epoch oldest=""
  for pid in $fresh_pids; do
    start_epoch="$(ps -p "$pid" -o lstart= 2>/dev/null | xargs -I{} date -j -f "%a %b %e %T %Y" "{}" +%s 2>/dev/null)"
    if [ -n "$start_epoch" ] && { [ -z "$oldest" ] || [ "$start_epoch" -lt "$oldest" ]; }; then
      oldest="$start_epoch"
    fi
  done
  if [ -n "$jar_epoch" ] && [ -n "$oldest" ] && [ "$jar_epoch" -gt "$oldest" ]; then
    echo "STALE $name (pid$fresh_pids) — inode $ondisk_inode matches, but the jar was written $(( (jar_epoch - oldest) / 60 ))m AFTER the process started; the bytes changed underneath it"
    stale=$((stale + 1))
    return 0
  fi

  # Two JVMs on one jar is not staleness — both are on the current inode — but it is worth
  # saying, because only one of them can hold the port and the other is a leftover.
  if [ "$pid_count" -gt 1 ]; then
    echo "WARN  $name — $pid_count JVMs are running $base (pids$fresh_pids), all on inode $ondisk_inode; only one can hold the port"
    warned=$((warned + 1))
    return 0
  fi

  echo "ok    $name (pid$fresh_pids, inode $ondisk_inode)"
}

# ---------------------------------------------------------------------------
# Duplicate build artefacts: "Foo 2.class", "bar 3.jar"
#
# A second, related way a build lies to you. Something — iCloud's conflict
# resolution, a copy racing a concurrent build, Finder — finds two versions of a
# file and keeps both by appending " 2". The JVM then opens `TestFixtures 2.class`,
# reads the class name recorded INSIDE it as `TestFixtures`, and refuses to load it:
#
#   There was an error in the forked process
#   io/restaurantos/shared/integration/TestFixtures 2 (wrong name: .../TestFixtures)
#
# Which surfaces as an opaque SurefireBooterForkException with no test failure and
# no compile error — a green module that will not run its own suite. 132 of these
# had accumulated here, and they reappear whenever several builds run at once.
#
# Deleted rather than reported, because a duplicate .class is unambiguously
# garbage: the real file sits beside it, and nothing in any build references the
# name with a space in it. Source files are NEVER touched — only build output
# under target/, so a genuine " 2.java" a person wrote cannot be lost here.
# The glob is "* [0-9]*" and NOT "* [0-9]" — the single-digit form was the original bug here.
# It cleaned `Foo 2.class` happily and walked straight past `PosServiceApplication 10.class`,
# which then broke the build in a completely different and much less obvious way:
#
#   Unable to find a single main class from the following candidates
#   [io.restaurantos.pos.PosServiceApplication 10, io.restaurantos.pos.PosServiceApplication]
#
# Spring Boot's repackage goal cannot choose between two main classes, so pos-service silently
# produced a 300 KB thin jar with zero BOOT-INF entries. That jar does not boot, and a service
# restarted from it holds its port while answering nothing — the exact wedge this script exists
# to catch, caused by this script's own incomplete cleanup.
#
# A pattern written to catch a class of garbage that only catches the first ten instances of it
# is worse than no pattern, because the report says "clean".
dupes="$(find ./*/target ./*/*/target \( -name "* [0-9]*.class" -o -name "* [0-9]*.jar" \) 2>/dev/null | wc -l | tr -d ' ')"
if [ "${dupes:-0}" -gt 0 ]; then
  find ./*/target ./*/*/target \( -name "* [0-9]*.class" -o -name "* [0-9]*.jar" \) -delete 2>/dev/null
  echo "clean removed $dupes duplicate build artefact(s) — these break surefire with 'wrong name'"
fi

for dir in services/*/; do
  svc="$(basename "$dir")"
  check_one "$svc" "${dir}target/${svc}-1.0.0.jar"
done
check_one "gateway" "gateway/target/gateway-1.0.0.jar"

echo "----------------------------------------"
echo "checked=$checked stale=$stale warn=$warned"

if [ "$stale" -gt 0 ]; then
  cat >&2 <<'EOF'

ERROR: at least one service is running code that is not what is on disk.

Any verification against the live stack right now is measuring the OLD build. Restart the
services named above before trusting a single result, and re-run whatever you were verifying.
EOF
  exit 1
fi
