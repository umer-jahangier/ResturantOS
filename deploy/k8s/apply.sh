#!/usr/bin/env bash
# apply.sh <dev|prod> — apply an overlay WITHOUT destroying the running image pins.
#
# TWO THINGS THIS EXISTS TO PREVENT, both of which cost a deploy:
#
# 1. A Job's spec is IMMUTABLE, so re-applying an existing bootstrap Job is
#    rejected outright. Deleting first is not a workaround; it is how a Job is
#    re-run.
#
# 2. `kubectl apply -k` RESETS every image to the base manifests' placeholder,
#    `restaurantos/<name>:latest`. That placeholder resolves to Docker Hub, where
#    none of these repositories exist, so every pod it touches goes
#    ImagePullBackOff with "pull access denied, repository does not exist".
#    CI avoids this because it runs `kustomize edit set image` first. A HUMAN
#    running apply.sh to push an unrelated config change does not — and silently
#    unpins the entire namespace. That is exactly how a ClickHouse memory fix
#    took reporting-service down.
#
#    So: capture the live images first, apply, then put them back. A namespace
#    that was running GHCR digests keeps running them; only the config changes.
set -euo pipefail
ENV="${1:?usage: apply.sh <dev|prod>}"
NS="restaurantos-$ENV"
K="${KUBECTL:-k3s kubectl}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ── 1. remember what is actually running ────────────────────────────────────
PINS=$(mktemp)
$K -n "$NS" get deploy -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null \
  | grep -v ':latest$' > "$PINS" || true
echo "  captured $(wc -l < "$PINS" | tr -d ' ') live image pins"

# ── 2. Jobs must be deleted to be re-run ────────────────────────────────────
$K -n "$NS" delete job rabbit-topology-import clickhouse-migrate --ignore-not-found >/dev/null 2>&1 || true

# ── 3. apply ────────────────────────────────────────────────────────────────
$K apply -k "$ROOT/deploy/k8s/overlays/$ENV"

# ── 4. restore the pins apply just clobbered ────────────────────────────────
restored=0
while read -r name image; do
  [ -z "${name:-}" ] && continue
  cur=$($K -n "$NS" get deploy "$name" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)
  if [ "$cur" != "$image" ]; then
    $K -n "$NS" set image "deploy/$name" "$name=$image" >/dev/null 2>&1 && restored=$((restored+1))
  fi
done < "$PINS"
rm -f "$PINS"
echo "  restored $restored image pin(s) that apply -k had reset to the :latest placeholder"

# ── 5. refuse to leave the namespace holding an unpullable placeholder ──────
bad=$($K -n "$NS" get deploy -o jsonpath='{range .items[*]}{.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null | grep -c '^restaurantos/.*:latest$' || true)
if [ "${bad:-0}" -gt 0 ]; then
  echo "  WARNING: $bad deployment(s) still point at restaurantos/<name>:latest."
  echo "           That placeholder is NOT pullable — it resolves to Docker Hub."
  echo "           Pin them before expecting pods to start."
fi
