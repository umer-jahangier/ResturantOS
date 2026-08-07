#!/usr/bin/env bash
# Phase 13 — THE acceptance test. One command whose failure is the phase's failure (D-30).
#
# WHY THIS EXISTS
# ===============
#
# The production-readiness audit found `.planning/phases/03-*/03-VERIFICATION.md` scoring Phase 3
# "24/24 passed" while citing a controller that does not exist. That verification was structural —
# it grepped source — which is why blocker B1 (no SuperAdmin could authenticate) survived for
# months inside a phase marked complete.
#
# This runner is the countermeasure. It executes every end-to-end script phase 13 produced, then
# runs the seed script's own verification loop, and reports ONE aggregate result. Nothing here
# reads source code, and nothing here should ever start to. Every number below comes from a live
# HTTP call through the real gateway against the real stack.
#
# WHAT IT RUNS
# ============
#
#   1. every scripts/e2e/phase13-*-e2e.sh, in dependency order
#   2. scripts/seed_restaurantos.py — the full seed, ending with its verification of all nineteen
#      principals (the SuperAdmin plus eighteen personas), each authenticated through the gateway
#
# USAGE
# =====
#
#   bash scripts/e2e/phase13-acceptance.sh                # everything
#   bash scripts/e2e/phase13-acceptance.sh --skip-seed    # the e2e scripts only
#   bash scripts/e2e/phase13-acceptance.sh --seed-verify-only
#                                                         # e2e scripts + `--phase verify`
#                                                         # (assumes the environment is seeded)
#   PAUSE_SECONDS=20 bash scripts/e2e/phase13-acceptance.sh
#
# PRECONDITIONS
# =============
#
#   Docker infra up, and gateway + auth-service + user-service + platform-admin-service +
#   pos-service + inventory-service + purchasing-service + finance-service + reporting-service all
#   running and Eureka-registered, each on a jar built from the current tree.
#
#   A WEDGED SERVICE IS THE MOST COMMON CAUSE OF A FALSE FAILURE HERE. It presents as
#   /actuator/health answering 200 in milliseconds while every other path hangs and the gateway
#   returns 503. If a script fails with SERVICE_UNAVAILABLE, probe the service directly on its own
#   port with a real path — not /actuator/health — and restart it before concluding anything about
#   the code. This has been observed on finance-service, pos-service, hr-service and
#   inventory-service in this phase alone.
#
# WHY THE PAUSE BETWEEN SCRIPTS
# =============================
#
#   The gateway rate-limits `platform-auth-route` at 2/s with a burst of 100, and most of these
#   scripts log the SuperAdmin in during their own setup. Run back to back with no gap, that budget
#   is genuinely exhausted: 13-13 recorded `phase13-subscription-e2e.sh` failing at setup with "the
#   SuperAdmin could not log in" while a direct login seconds later answered 200. A harness that
#   manufactures the failure it exists to detect is worse than no harness, so this waits between
#   scripts rather than reporting a 429 as a defect.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 2

PAUSE_SECONDS="${PAUSE_SECONDS:-12}"
SKIP_SEED=false
SEED_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-seed)        SKIP_SEED=true ;;
    --seed-verify-only) SEED_ARGS=(--phase verify) ;;
    -h|--help)          sed -n '2,60p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; RESET=$'\033[0m'
fi

LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/phase13-acceptance.XXXXXX")"
trap 'echo "logs: ${LOG_DIR}"' EXIT

# ── The suite, in dependency order ──────────────────────────────────────────────────────────
#
# name | script | the baseline PASS/FAIL recorded by the plan that produced it
#
# The baseline is carried here on purpose. "48 PASS / 0 FAIL" means nothing on its own — a script
# that silently stopped asserting half of what it used to also reports 0 failures. A count that
# DROPS while still passing is a regression in the verification itself, and this is the only place
# it becomes visible.
SUITE=(
  "13-05 platform login|scripts/e2e/phase13-superadmin-e2e.sh|21|0"
  "13-06 auth/provisioning seam|scripts/e2e/phase13-auth-provisioning-seam-e2e.sh|20|0"
  "13-02 roles: waiter + tenant admin|scripts/e2e/phase13-roles-e2e.sh|25|0"
  "13-07 role catalog|scripts/e2e/phase13-role-catalog-e2e.sh|28|0"
  "13-03 feature gating|scripts/e2e/phase13-feature-gating-e2e.sh|11|0"
  "13-04 self-service password change|scripts/e2e/phase13-password-change-e2e.sh|22|0"
  "13-08 forced change at login|scripts/e2e/phase13-forced-change-e2e.sh|25|0"
  "13-09 reset hardening|scripts/e2e/phase13-reset-hardening-e2e.sh|31|0"
  "13-10 provisioning saga|scripts/e2e/phase13-provisioning-e2e.sh|27|0"
  "13-11 user lifecycle|scripts/e2e/phase13-user-lifecycle-e2e.sh|48|0"
  "13-12 tenant-admin user API|scripts/e2e/phase13-tenant-admin-users-e2e.sh|56|0"
  "13-13 administrator reset|scripts/e2e/phase13-admin-reset-e2e.sh|48|0"
  "13-14 subscription and tier|scripts/e2e/phase13-subscription-e2e.sh|51|0"
)

echo
echo "${BOLD}================================================================================${RESET}"
echo "${BOLD}  PHASE 13 ACCEPTANCE — every live end-to-end script, plus the seed's own${RESET}"
echo "${BOLD}  verification of all nineteen principals.${RESET}"
echo "${BOLD}================================================================================${RESET}"
echo "  repo    : ${REPO_ROOT}"
echo "  commit  : $(git rev-parse --short HEAD 2>/dev/null || echo 'n/a')"
echo "  gateway : ${GATEWAY:-http://localhost:8080}"
echo "  started : $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  pause   : ${PAUSE_SECONDS}s between scripts (platform-auth-route budget)"
echo "  logs    : ${LOG_DIR}"
echo

RESULTS=()
TOTAL_PASS=0
TOTAL_FAIL=0
SUITES_FAILED=0
STARTED_AT=$(date +%s)

run_one() {
  local label="$1" script="$2" base_pass="$3" base_fail="$4"
  local log="${LOG_DIR}/$(basename "$script").log"

  if [[ ! -f "$script" ]]; then
    echo "  ${RED}MISSING${RESET}  ${label} — ${script} does not exist"
    RESULTS+=("${label}|MISSING|-|-|${base_pass}|${base_fail}")
    SUITES_FAILED=$((SUITES_FAILED + 1))
    return
  fi

  printf '  %s…%s %-40s' "$DIM" "$RESET" "$label"
  local start end code p f
  start=$(date +%s)
  bash "$script" > "$log" 2>&1
  code=$?
  end=$(date +%s)

  # Every script in this phase ends with `phase13_summary`, which prints exactly one
  # "PASS: <n>   FAIL: <n>" tally line. Read THAT rather than counting "PASS:" prefixes — several
  # scripts print a multi-line PASS explanation, and counting lines would over-report.
  local tally
  tally="$(grep -E '^PASS: [0-9]+ +FAIL: [0-9]+$' "$log" | tail -1)"
  if [[ -n "$tally" ]]; then
    p="$(printf '%s' "$tally" | sed -E 's/^PASS: ([0-9]+).*/\1/')"
    f="$(printf '%s' "$tally" | sed -E 's/.*FAIL: ([0-9]+)$/\1/')"
  else
    p="?"; f="?"
  fi

  local status drift=""
  if [[ "$code" -eq 0 && "$f" == "0" ]]; then
    status="PASS"
  else
    status="FAIL"
    SUITES_FAILED=$((SUITES_FAILED + 1))
  fi
  if [[ "$p" =~ ^[0-9]+$ ]]; then
    TOTAL_PASS=$((TOTAL_PASS + p))
    [[ "$f" =~ ^[0-9]+$ ]] && TOTAL_FAIL=$((TOTAL_FAIL + f))
    if [[ "$p" -lt "$base_pass" ]]; then
      drift=" ${YELLOW}(assertions DROPPED: ${p} < baseline ${base_pass})${RESET}"
    elif [[ "$p" -gt "$base_pass" ]]; then
      drift=" ${DIM}(+$((p - base_pass)) vs baseline)${RESET}"
    fi
  fi

  local colour="$GREEN"; [[ "$status" == "FAIL" ]] && colour="$RED"
  printf '%s%s%s  %s/%s  %ss%s\n' "$colour" "$status" "$RESET" "$p" "$f" "$((end - start))" "$drift"
  RESULTS+=("${label}|${status}|${p}|${f}|${base_pass}|${base_fail}")

  if [[ "$status" == "FAIL" ]]; then
    echo "        ${DIM}exit ${code}; failing assertions:${RESET}"
    grep -E '^FAIL' "$log" | head -8 | sed 's/^/        /'
    echo "        ${DIM}full log: ${log}${RESET}"
  fi
}

for entry in "${SUITE[@]}"; do
  IFS='|' read -r label script base_pass base_fail <<< "$entry"
  run_one "$label" "$script" "$base_pass" "$base_fail"
  sleep "$PAUSE_SECONDS"
done

# ── The seed's own verification — the acceptance test for the phase ─────────────────────────
SEED_STATUS="SKIPPED"
SEED_PRINCIPALS="-"
if [[ "$SKIP_SEED" == false ]]; then
  echo
  echo "  ${BOLD}scripts/seed_restaurantos.py${RESET} ${DIM}— nineteen principals, each authenticated${RESET}"
  echo "  ${DIM}through the real gateway. Not by inspecting the database for expected rows.${RESET}"
  seed_log="${LOG_DIR}/seed_restaurantos.log"
  python3 scripts/seed_restaurantos.py "${SEED_ARGS[@]}" > "$seed_log" 2>&1
  seed_code=$?
  SEED_PRINCIPALS="$(grep -oE '[0-9]+ of [0-9]+ principals' "$seed_log" | tail -1)"
  if [[ "$seed_code" -eq 0 ]]; then
    SEED_STATUS="PASS"
    echo "  ${GREEN}PASS${RESET}  ${SEED_PRINCIPALS:-verification completed}"
  else
    SEED_STATUS="FAIL"
    SUITES_FAILED=$((SUITES_FAILED + 1))
    echo "  ${RED}FAIL${RESET}  ${SEED_PRINCIPALS:-verification failed} (exit ${seed_code})"
    grep -E '^\s+✗|^  FAIL' "$seed_log" | head -20 | sed 's/^/        /'
    echo "        ${DIM}full log: ${seed_log}${RESET}"
  fi
  # Whatever the outcome, surface the direct-write ledger: the point of printing it on every run
  # is that the set of remaining API gaps stays visible rather than archaeological.
  echo
  sed -n '/DIRECT DATABASE WRITES/,/^====/p' "$seed_log" | sed 's/^/  /' | head -30
fi

# ── One aggregate result ────────────────────────────────────────────────────────────────────
FINISHED_AT=$(date +%s)
echo
echo "${BOLD}================================================================================${RESET}"
echo "${BOLD}  PHASE 13 ACCEPTANCE — RESULT${RESET}"
echo "${BOLD}================================================================================${RESET}"
printf '  %-40s %-7s %-9s %s\n' "SUITE" "RESULT" "PASS/FAIL" "BASELINE"
printf '  %-40s %-7s %-9s %s\n' "----------------------------------------" "-------" "---------" "--------"
for r in "${RESULTS[@]}"; do
  IFS='|' read -r label status p f bp bf <<< "$r"
  printf '  %-40s %-7s %-9s %s\n' "$label" "$status" "${p}/${f}" "${bp}/${bf}"
done
printf '  %-40s %-7s %-9s %s\n' "13-15 seed self-verification" "$SEED_STATUS" "${SEED_PRINCIPALS:--}" "19 principals"
echo
echo "  live assertions:  ${TOTAL_PASS} passed, ${TOTAL_FAIL} failed"
echo "  suites:           $(( ${#RESULTS[@]} + 1 )) run, ${SUITES_FAILED} not green"
echo "  elapsed:          $(( FINISHED_AT - STARTED_AT ))s"
echo

if [[ "$SUITES_FAILED" -eq 0 ]]; then
  echo "  ${GREEN}${BOLD}PHASE 13 ACCEPTED.${RESET} Every repaired path was exercised end to end through the"
  echo "  real gateway, and every seeded principal can log in."
  exit 0
fi

echo "  ${RED}${BOLD}PHASE 13 NOT ACCEPTED.${RESET} ${SUITES_FAILED} suite(s) are not green."
echo "  Before concluding the code is wrong: a service in the wedged state described at the top of"
echo "  this file answers /actuator/health in milliseconds and hangs on everything else, and the"
echo "  gateway reports that as 503. Probe a real path on the service's own port first."
exit 1
