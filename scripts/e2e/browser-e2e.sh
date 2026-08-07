#!/usr/bin/env bash
#
# THE SINGLE RUNNER for the browser E2E suite.
#
#   bash scripts/e2e/browser-e2e.sh              # preflight, then the full journey suite
#   bash scripts/e2e/browser-e2e.sh --smoke      # backend-free smoke only (what CI runs)
#   bash scripts/e2e/browser-e2e.sh --headed     # watch it
#   bash scripts/e2e/browser-e2e.sh --grep "role visibility"
#
# WHY A PREFLIGHT AND NOT JUST `playwright test`
# ==============================================
# Three of this stack's failure modes produce RED TESTS THAT ARE NOT TEST FAILURES, and each
# one costs an hour if you debug it as an assertion problem. They are checked here, up front,
# and reported in their own words:
#
#   1. A WEDGED SERVICE — /actuator/health answers 200 while every routed path hangs.
#   2. A STALE EUREKA LEASE — a service is healthy on its own port but absent from the
#      registry, so the gateway answers 503 for everything routed to it. Observed live on
#      2026-08-07: auth-service had its jar replaced under the running JVM by a concurrent
#      build, threw NoClassDefFoundError on a lazily-loaded class, lost its heartbeat, and was
#      evicted. Health stayed 200 the whole time.
#   3. AN UNSEEDED DATABASE — every persona login fails and 40 journeys go red at once.
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GATEWAY="${E2E_GATEWAY_URL:-http://localhost:8080}"
FRONTEND="${PLAYWRIGHT_BASE_URL:-http://localhost:3000}"
EUREKA="${EUREKA_URL:-http://localhost:8761}"

MODE="journeys"
PASSTHROUGH=()
for arg in "$@"; do
  case "$arg" in
    --smoke) MODE="smoke" ;;
    *) PASSTHROUGH+=("$arg") ;;
  esac
done

red()  { printf '\033[31m%s\033[0m\n' "$*"; }
grn()  { printf '\033[32m%s\033[0m\n' "$*"; }
ylw()  { printf '\033[33m%s\033[0m\n' "$*"; }
bold() { printf '\033[1m%s\033[0m\n' "$*"; }

if [[ "$MODE" == "smoke" ]]; then
  bold "Backend-free smoke suite"
  exec pnpm --dir "$REPO_ROOT/frontend" run e2e "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
fi

bold "Preflight"
FAIL=0

# ── 1. the frontend ───────────────────────────────────────────────────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$FRONTEND/" || echo 000)
if [[ "$code" == "000" ]]; then
  red "  ✗ frontend $FRONTEND is not answering."
  red "    Start it:  pnpm --dir frontend dev"
  FAIL=1
else
  grn "  ✓ frontend $FRONTEND -> $code"
fi

# ── 2. the gateway, and a ROUTED path — not just its own health ───────────────────────
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$GATEWAY/actuator/health" || echo 000)
if [[ "$code" != "200" ]]; then
  red "  ✗ gateway $GATEWAY health -> $code"
  FAIL=1
else
  grn "  ✓ gateway health -> 200"

  # THE CHECK THAT MATTERS. A gateway can be perfectly healthy and still 503 everything,
  # because routing is resolved through Eureka. Probing a routed path with a deliberately
  # bad credential distinguishes the cases:
  #   401  -> auth-service was REACHED and rejected us. Routing works. This is success.
  #   503  -> the route could not be resolved: a missing or stale Eureka registration.
  #   000  -> the request hung: a WEDGED service.
  routed=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    -X POST "$GATEWAY/api/v1/auth/login" \
    -H 'Content-Type: application/json' \
    -H 'X-Forwarded-For: 10.63.250.250' \
    -d '{"email":"preflight@invalid.local","password":"x","tenantSlug":"nope"}' || echo 000)

  case "$routed" in
    401|400|422)
      grn "  ✓ gateway -> auth-service routing works (probe answered $routed)" ;;
    429)
      ylw "  ! rate-limited on the probe (429). The per-IP credential bucket is 2/s with a"
      ylw "    burst of 100 and it is SHARED. Not fatal — the suite retries 429 with backoff —"
      ylw "    but if you have just run the suite, wait ~60s for the bucket to refill." ;;
    503|502)
      red "  ✗ gateway answered $routed for a ROUTED path while its own health is 200."
      red "    This is ROUTING, not your tests. Almost always a missing Eureka registration."
      if reg=$(curl -s -H 'Accept: application/json' --max-time 5 "$EUREKA/eureka/apps" 2>/dev/null); then
        missing=""
        for svc in AUTH-SERVICE USER-SERVICE POS-SERVICE KITCHEN-SERVICE PLATFORM-ADMIN-SERVICE; do
          grep -q "\"$svc\"" <<<"$reg" || missing="$missing $svc"
        done
        if [[ -n "$missing" ]]; then
          red "    NOT REGISTERED IN EUREKA:$missing"
          red "    Restart the named service(s); a re-registration takes ~30s and the"
          red "    gateway's load-balancer cache another ~30s on top."
        else
          red "    All core services ARE registered — suspect an open circuit breaker."
          red "    Wait ~60s and re-run before investigating further."
        fi
      fi
      FAIL=1 ;;
    000)
      red "  ✗ the routed probe HUNG (no response in 15s) while health answered 200."
      red "    That is a WEDGED service. Restart it — this is a known open defect, not a"
      red "    test failure."
      FAIL=1 ;;
    *)
      ylw "  ! routed probe answered $routed (unexpected, continuing)" ;;
  esac
fi

# ── 3. the seed ───────────────────────────────────────────────────────────────────────
if [[ ! -d "$REPO_ROOT/.seed-state/totp" ]]; then
  ylw "  ! no .seed-state/totp — TOTP-enrolled personas (owner, accountant) cannot log in."
  ylw "    auth-service mints those secrets at enrolment and they CANNOT be re-derived."
  ylw "    Run: python3 scripts/seed_restaurantos.py --phase personas"
else
  grn "  ✓ .seed-state/totp present ($(find "$REPO_ROOT/.seed-state/totp" -type f | wc -l | tr -d ' ') secrets)"
fi

if [[ "$FAIL" == "1" ]]; then
  red ""
  red "Preflight FAILED — not running the suite. Every failure above is an ENVIRONMENT"
  red "problem; running the journeys now would report it as ~40 assertion failures."
  exit 2
fi

grn ""
bold "Running the journey suite (live stack)"
cd "$REPO_ROOT/frontend" || exit 1
E2E_STACK=1 exec pnpm exec playwright test --project=journeys "${PASSTHROUGH[@]+"${PASSTHROUGH[@]}"}"
