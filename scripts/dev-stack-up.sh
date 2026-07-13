#!/usr/bin/env bash
# RestaurantOS — one-command, health-gated local dev stack bring-up.
#
# Usage:
#   bash scripts/dev-stack-up.sh
#
# What this does that `docker compose up` alone does not:
#   1. Renders deploy/init/rabbitmq-definitions.json from the committed template,
#      injecting a RabbitMQ SHA-256 password_hash computed from deploy/.env, so the
#      application user exists in RabbitMQ from the FIRST boot — no rabbitmqctl by hand.
#      (root cause: rabbitmq.conf's `load_definitions` SUPPRESSES the
#      RABBITMQ_DEFAULT_USER/PASS bootstrap entirely; a definitions file with no
#      `users` key boots a broker with zero users.)
#
set -euo pipefail

# Docker Desktop's credential helper is not on the default PATH on this host —
# without it `docker compose` fails obscurely (credential helper not found).
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/deploy"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
COMPOSE="docker compose -f $COMPOSE_FILE"

step() { echo ""; echo "==> $*"; }
die()  { echo "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. Pre-flight
# ---------------------------------------------------------------------------
step "Pre-flight checks"

[[ -f "$DEPLOY_DIR/.env" ]] || die "deploy/.env missing. Run: bash deploy/generate-keys.sh"
command -v python3 >/dev/null 2>&1 || die "python3 is required to compute the RabbitMQ password hash."

if lsof -nP -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
  if ! lsof -nP -iTCP:5432 -sTCP:LISTEN | grep -qi "com.docke\|docker"; then
    lsof -nP -iTCP:5432 -sTCP:LISTEN >&2
    die "Something native is already listening on :5432 (a host-installed Postgres?). Stop it before bringing up the postgres container — the port bind will otherwise fail or you'll talk to the wrong database."
  fi
fi

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
