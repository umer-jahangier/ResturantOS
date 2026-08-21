#!/usr/bin/env bash
# apply.sh <dev|prod> — apply an overlay, handling the one thing plain
# `kubectl apply -k` cannot: a Job's spec is IMMUTABLE, so re-applying an
# existing bootstrap Job is rejected outright. Deleting first is not a
# workaround; it is how you re-run a Job.
set -euo pipefail
ENV="${1:?usage: apply.sh <dev|prod>}"
NS="restaurantos-$ENV"
K="${KUBECTL:-k3s kubectl}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
$K -n "$NS" delete job rabbit-topology-import clickhouse-migrate --ignore-not-found >/dev/null 2>&1 || true
$K apply -k "$ROOT/deploy/k8s/overlays/$ENV"
