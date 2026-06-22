#!/usr/bin/env bash
# generate-keys.sh — idempotent RS256 keypair + AES-256 key generator for dev.
#
# Encoding: PEM bytes are base64-encoded (no newlines) so they fit on a single
# KEY=VALUE line in .env. Consumers (JwksKeyProvider / JwtProperties from 01-04)
# must Base64-decode the value, then parse the resulting PEM.
#
# Run at project root: bash deploy/generate-keys.sh
# Re-running rotates all three keys without duplicating lines.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"
ENV_EXAMPLE="$SCRIPT_DIR/.env.example"
TMPDIR_KEYS="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_KEYS"' EXIT

# ── Bootstrap .env from .env.example if absent ───────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$ENV_EXAMPLE" ]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created deploy/.env from deploy/.env.example"
  else
    touch "$ENV_FILE"
    echo "Created empty deploy/.env"
  fi
fi

# ── Generate RS256 keypair (RSA-2048) ─────────────────────────────────────────
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
  -out "$TMPDIR_KEYS/jwt-private.pem" 2>/dev/null

openssl rsa -in "$TMPDIR_KEYS/jwt-private.pem" \
  -pubout -out "$TMPDIR_KEYS/jwt-public.pem" 2>/dev/null

# Encode full PEM as a single-line base64 string (cross-platform: no GNU -w flag)
PRIVATE_KEY_B64="$(base64 < "$TMPDIR_KEYS/jwt-private.pem" | tr -d '\n')"
PUBLIC_KEY_B64="$(base64 < "$TMPDIR_KEYS/jwt-public.pem" | tr -d '\n')"

# ── Generate AES-256 key (32 random bytes, base64-encoded) ───────────────────
FIELD_ENCRYPTION_KEY="$(openssl rand -base64 32 | tr -d '\n')"

# ── Idempotent in-place replacement: delete existing lines, append fresh ones ─
# Using portable sed -i '' (macOS) with a fallback for Linux sed -i
_sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i "$@"
  else
    sed -i '' "$@"
  fi
}

for KEY in JWT_PRIVATE_KEY JWT_PUBLIC_KEY FIELD_ENCRYPTION_KEY; do
  _sed_inplace "/^${KEY}=/d" "$ENV_FILE"
done

{
  echo "JWT_PRIVATE_KEY=${PRIVATE_KEY_B64}"
  echo "JWT_PUBLIC_KEY=${PUBLIC_KEY_B64}"
  echo "FIELD_ENCRYPTION_KEY=${FIELD_ENCRYPTION_KEY}"
} >> "$ENV_FILE"

echo "Wrote 3 keys to deploy/.env (JWT_PRIVATE_KEY, JWT_PUBLIC_KEY, FIELD_ENCRYPTION_KEY)"
