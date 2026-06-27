#!/usr/bin/env python3
"""
Generate the current TOTP code for a dev user (owner, accountant, etc.).

Reads the encrypted totp_secret from auth_db using the same AES-256-GCM format
as auth-service (FIELD_ENCRYPTION_KEY). No application code changes required.

Dependencies (one-time):
  pip install psycopg2-binary pyotp cryptography

Usage:
  python scripts/generate_totp.py owner@demo.local
  python scripts/generate_totp.py owner@demo.local --enroll
  python scripts/generate_totp.py accountant@demo.local --tenant-slug demo

First-time owner login: the seed has no totp_secret. Run with --enroll once,
then scan the printed otpauth:// URI in Google Authenticator (or use the codes
this script prints; they rotate every 30 seconds).

Environment (optional; defaults match local docker-compose dev):
  FIELD_ENCRYPTION_KEY  from deploy/.env if present
  POSTGRES_HOST         default localhost
  POSTGRES_PORT         default 5432
  POSTGRES_USER         default postgres
  POSTGRES_PASSWORD     default dev_postgres_2026
"""
from __future__ import annotations

import argparse
import base64
import os
import sys
import urllib.parse
from pathlib import Path

try:
    import psycopg2
    import pyotp
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
except ImportError as exc:
    print(
        "Missing dependency. Install with:\n"
        "  pip install psycopg2-binary pyotp cryptography",
        file=sys.stderr,
    )
    raise SystemExit(1) from exc

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TENANT_SLUG = "demo"
DEFAULT_DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXP"  # reproducible dev enroll only
GCM_IV_LENGTH = 12


def load_deploy_env() -> dict[str, str]:
    env: dict[str, str] = {}
    dotenv = REPO_ROOT / "deploy" / ".env"
    if not dotenv.is_file():
        return env
    for raw in dotenv.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def encryption_key_b64(deploy_env: dict[str, str]) -> str:
    key = os.environ.get("FIELD_ENCRYPTION_KEY") or deploy_env.get(
        "FIELD_ENCRYPTION_KEY", ""
    )
    if not key:
        print(
            "FIELD_ENCRYPTION_KEY not set. Run: bash deploy/generate-keys.sh",
            file=sys.stderr,
        )
        raise SystemExit(1)
    raw = base64.b64decode(key)
    if len(raw) < 32:
        print("FIELD_ENCRYPTION_KEY must decode to at least 32 bytes.", file=sys.stderr)
        raise SystemExit(1)
    return key


def encrypt_secret(plaintext: str, key_b64: str) -> bytes:
    key = base64.b64decode(key_b64)
    iv = os.urandom(GCM_IV_LENGTH)
    aes = AESGCM(key)
    ciphertext = aes.encrypt(iv, plaintext.encode("utf-8"), None)
    return iv + ciphertext


def decrypt_secret(ciphertext: bytes, key_b64: str) -> str:
    key = base64.b64decode(key_b64)
    iv = ciphertext[:GCM_IV_LENGTH]
    payload = ciphertext[GCM_IV_LENGTH:]
    aes = AESGCM(key)
    return aes.decrypt(iv, payload, None).decode("utf-8")


def connect(deploy_env: dict[str, str]):
    host = os.environ.get("POSTGRES_HOST", "localhost")
    port = int(os.environ.get("POSTGRES_PORT", "5432"))
    user = os.environ.get("POSTGRES_USER", "postgres")
    password = (
        os.environ.get("POSTGRES_PASSWORD")
        or deploy_env.get("POSTGRES_SUPERUSER_PASSWORD")
        or "dev_postgres_2026"
    )
    return psycopg2.connect(
        host=host,
        port=port,
        dbname="auth_db",
        user=user,
        password=password,
    )


def resolve_tenant_id(cur, tenant_slug: str) -> str:
    cur.execute(
        "SELECT id::text FROM auth_tenants WHERE slug = %s",
        (tenant_slug,),
    )
    row = cur.fetchone()
    if not row:
        print(f"Tenant slug not found: {tenant_slug}", file=sys.stderr)
        raise SystemExit(1)
    return row[0]


def fetch_user(cur, tenant_id: str, email: str):
    cur.execute(
        "SELECT set_config('app.current_tenant_id', %s, false)",
        (tenant_id,),
    )
    cur.execute(
        """
        SELECT id::text, email, totp_secret, totp_enabled
        FROM users
        WHERE tenant_id = %s::uuid AND lower(email) = lower(%s)
        """,
        (tenant_id, email),
    )
    return cur.fetchone()


def otpauth_uri(secret: str, email: str) -> str:
    label = urllib.parse.quote(f"RestaurantOS:{email}")
    params = urllib.parse.urlencode({"secret": secret, "issuer": "RestaurantOS"})
    return f"otpauth://totp/{label}?{params}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate TOTP for a dev auth_db user (local development only).",
    )
    parser.add_argument("email", help="User email, e.g. owner@demo.local")
    parser.add_argument(
        "--tenant-slug",
        default=DEFAULT_TENANT_SLUG,
        help=f"Tenant slug (default: {DEFAULT_TENANT_SLUG})",
    )
    parser.add_argument(
        "--enroll",
        action="store_true",
        help="Create/replace totp_secret when missing (dev only)",
    )
    parser.add_argument(
        "--secret",
        default=os.environ.get("DEV_TOTP_SECRET", DEFAULT_DEV_TOTP_SECRET),
        help="Base32 secret to store when using --enroll (default: fixed dev secret)",
    )
    args = parser.parse_args()

    deploy_env = load_deploy_env()
    key_b64 = encryption_key_b64(deploy_env)

    conn = connect(deploy_env)
    try:
        cur = conn.cursor()
        tenant_id = resolve_tenant_id(cur, args.tenant_slug)
        row = fetch_user(cur, tenant_id, args.email)

        if not row:
            print(f"User not found: {args.email} (tenant {args.tenant_slug})", file=sys.stderr)
            raise SystemExit(1)

        user_id, email, totp_blob, totp_enabled = row
        secret: str | None = None

        if totp_blob:
            secret = decrypt_secret(bytes(totp_blob), key_b64)
        elif args.enroll:
            secret = args.secret.strip().replace(" ", "").upper()
            encrypted = encrypt_secret(secret, key_b64)
            cur.execute(
                """
                UPDATE users
                SET totp_secret = %s, totp_enabled = TRUE, updated_at = NOW()
                WHERE id = %s::uuid
                """,
                (psycopg2.Binary(encrypted), user_id),
            )
            conn.commit()
            print(f"Enrolled TOTP for {email}")
            print(f"otpauth URI: {otpauth_uri(secret, email)}")
        else:
            print(
                f"No totp_secret for {email}. Privileged users need 2FA enrolled.\n"
                f"Run: python scripts/generate_totp.py {email} --enroll",
                file=sys.stderr,
            )
            raise SystemExit(1)

        totp = pyotp.TOTP(secret)
        code = totp.now()
        remaining = 30 - (int(__import__("time").time()) % 30)

        print(f"Email:     {email}")
        print(f"TOTP code: {code}  (valid ~{remaining}s)")
        print(f"Enabled:   {totp_enabled if totp_blob else True}")
        if totp_blob and args.enroll:
            print("(Re-enrolled; previous authenticator entry may no longer match.)")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
