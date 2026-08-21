#!/usr/bin/env bash
# bootstrap-secrets.sh <namespace> — create the two Secrets an environment needs.
#
# THE ONE RULE: THIS IS CREATE-IF-ABSENT, NEVER ROTATE.
# init/02-create-roles.sql runs exactly once, when the Postgres data directory is
# empty, and it bakes the *_DB_PASSWORD values of that moment into the roles it
# creates. Re-running this script with fresh random values would leave fifteen
# services holding passwords the database has never heard of, and the failure
# would look like a connectivity problem rather than a credentials one. If you
# genuinely want to rotate, change the role's password in Postgres in the same
# operation.
#
# Secrets are generated ON THE SERVER and never travel through GitHub. CI only
# ever holds an SSH key; a compromised repository does not hand over the
# databases. That is why the GitHub secret list is three entries and not thirty.
set -euo pipefail
NS="${1:?usage: bootstrap-secrets.sh <namespace>}"
K="${KUBECTL:-k3s kubectl}"
OUT="/root/restaurantos-credentials-${NS}.txt"

$K get namespace "$NS" >/dev/null 2>&1 || $K create namespace "$NS"

if $K -n "$NS" get secret restaurantos-secrets >/dev/null 2>&1; then
  echo "  [$NS] secrets already exist — leaving them alone (see $OUT)"
  exit 0
fi

# Alphanumeric only: these values are interpolated into JDBC URLs, psql \set
# backticks and AMQP URIs, any of which will mangle a stray '@', ':' or '/'.
#
# NOT `tr -dc ... < /dev/urandom | head -c N`. Under `set -o pipefail` that is a
# trap: head exits as soon as it has N bytes, tr takes SIGPIPE, the pipeline
# reports 141, and `set -e` kills the script with no message at all — which
# reads as a hang on /dev/urandom rather than as the error it is. openssl needs
# no pipe, and hex is alphanumeric by construction. 16 bytes = 32 chars = 128 bits.
gen() { openssl rand -hex "$(( ${1:-32} / 2 ))"; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$TMP/jwt.pem" 2>/dev/null
openssl rsa -in "$TMP/jwt.pem" -pubout -out "$TMP/jwt.pub" 2>/dev/null
# Base64 of the whole PEM on one line — the encoding JwtProperties expects
# (see deploy/generate-keys.sh: consumers Base64-decode, then parse PEM).
JWT_PRIVATE_KEY="$(base64 -w0 < "$TMP/jwt.pem")"
JWT_PUBLIC_KEY="$(base64 -w0 < "$TMP/jwt.pub")"

PG_SUPER="restaurantos_admin"
declare -A DB
for k in AUTH USER POS INVENTORY FINANCE PURCHASING HR CRM KITCHEN NOTIFICATION AUDIT FILE PLATFORM REPORTING NLQ; do
  DB[$k]="$(gen 32)"
done
PG_SUPER_PW="$(gen 40)"
REDIS_PW="$(gen 32)"
RABBIT_USER="restaurantos"
RABBIT_PW="$(gen 32)"
MINIO_KEY="$(gen 20)"
MINIO_SECRET="$(gen 40)"
CH_USER="restaurantos"
CH_PW="$(gen 32)"
CH_RO_USER="nlq_readonly"
CH_RO_PW="$(gen 32)"
INTERNAL_SECRET="$(gen 48)"
FIELD_KEY="$(openssl rand -base64 32 | tr -d '\n')"
JWT_KID="$(gen 16)"

# ── Secret 1: database passwords (Postgres + the services) ───────────────────
DBARGS=(--from-literal=POSTGRES_SUPERUSER="$PG_SUPER"
        --from-literal=POSTGRES_SUPERUSER_PASSWORD="$PG_SUPER_PW")
for k in "${!DB[@]}"; do DBARGS+=(--from-literal="${k}_DB_PASSWORD=${DB[$k]}"); done
$K -n "$NS" create secret generic restaurantos-db-passwords "${DBARGS[@]}"

# ── Secret 2: everything the applications need ───────────────────────────────
APPARGS=("${DBARGS[@]}"
  --from-literal=REDIS_PASSWORD="$REDIS_PW"
  # Both spellings are set deliberately: the fleet is inconsistent — gateway,
  # auth, pos and others read RABBITMQ_USER, while platform-admin reads
  # RABBITMQ_USERNAME. Setting one leaves the other half authenticating as ''.
  --from-literal=RABBITMQ_USER="$RABBIT_USER"
  --from-literal=RABBITMQ_USERNAME="$RABBIT_USER"
  --from-literal=RABBITMQ_PASSWORD="$RABBIT_PW"
  --from-literal=MINIO_ACCESS_KEY="$MINIO_KEY"
  --from-literal=MINIO_SECRET_KEY="$MINIO_SECRET"
  --from-literal=CLICKHOUSE_USER="$CH_USER"
  --from-literal=CLICKHOUSE_PASSWORD="$CH_PW"
  --from-literal=CLICKHOUSE_READONLY_USER="$CH_RO_USER"
  --from-literal=CLICKHOUSE_READONLY_PASSWORD="$CH_RO_PW"
  --from-literal=JWT_PRIVATE_KEY="$JWT_PRIVATE_KEY"
  --from-literal=JWT_PUBLIC_KEY="$JWT_PUBLIC_KEY"
  --from-literal=JWT_PUBLIC_KEY_ID="$JWT_KID"
  --from-literal=INTERNAL_SERVICE_SECRET="$INTERNAL_SECRET"
  --from-literal=FIELD_ENCRYPTION_KEY="$FIELD_KEY")
$K -n "$NS" create secret generic restaurantos-secrets "${APPARGS[@]}"

# ── Human-readable handover copy ─────────────────────────────────────────────
umask 077
{
  echo "RestaurantOS credentials — namespace $NS"
  echo "Generated on the server; these values were never sent to GitHub."
  echo
  echo "Postgres superuser : $PG_SUPER / $PG_SUPER_PW"
  for k in $(echo "${!DB[@]}" | tr ' ' '\n' | sort); do
    printf "%-22s : %s\n" "${k}_DB_PASSWORD" "${DB[$k]}"
  done
  echo
  echo "Redis password     : $REDIS_PW"
  echo "RabbitMQ           : $RABBIT_USER / $RABBIT_PW"
  echo "MinIO              : $MINIO_KEY / $MINIO_SECRET"
  echo "ClickHouse         : $CH_USER / $CH_PW"
  echo "ClickHouse readonly: $CH_RO_USER / $CH_RO_PW"
  echo "JWT key id         : $JWT_KID"
  echo "INTERNAL_SERVICE_SECRET : $INTERNAL_SECRET"
  echo "FIELD_ENCRYPTION_KEY    : $FIELD_KEY"
  echo
  echo "JWT keypair is in the cluster secret only (2048-bit RSA, base64 PEM):"
  echo "  $K -n $NS get secret restaurantos-secrets -o jsonpath='{.data.JWT_PRIVATE_KEY}' | base64 -d | base64 -d"
} > "$OUT"
chmod 600 "$OUT"
echo "  [$NS] created restaurantos-db-passwords + restaurantos-secrets; handover written to $OUT"
