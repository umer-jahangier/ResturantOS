#!/usr/bin/env python3
"""
Phase 1 tenant onboarding — platform tenant, auth tenant, branches, and dev users.

Creates everything required before finance seeding (phase 2: seed_finance_tenant.py).
Idempotent: safe to re-run for the same slug (upserts passwords and metadata).

Databases touched:
  platform_db  — tenants + tenant_features (gateway feature flags)
  auth_db      — auth_tenants, users, user_branch_roles
  user_db      — branches
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import bcrypt
import psycopg2
from psycopg2.extensions import connection as PgConnection

REPO_ROOT = Path(__file__).resolve().parent.parent
UUID_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

DEFAULT_SLUG = "dev"
DEFAULT_BRAND = "Dev Restaurant"
DEFAULT_TIER = "GROWTH"
DEFAULT_TIMEZONE = "Asia/Karachi"
DEFAULT_PASSWORD = "ChangeMe#2026"

# Fixed IDs for the Liquibase demo tenant (slug=demo).
DEMO_IDS = {
    "tenant_id": "a0000001-0000-4000-8000-000000000001",
    "branch_hq_id": "b0000001-0000-4000-8000-000000000001",
    "branch_2_id": "b0000002-0000-4000-8000-000000000002",
    "user_owner": "c0000002-0000-4000-8000-000000000002",
    "user_cashier": "c0000001-0000-4000-8000-000000000001",
    "user_accountant": "c0000003-0000-4000-8000-000000000003",
    "user_finance": "c0000004-0000-4000-8000-000000000004",
}

TIER_LIMITS = {
    "STARTER": (1, 10, 5, 1000),
    "GROWTH": (5, 50, 20, 5000),
    "ENTERPRISE": (50, 500, 100, 50000),
    "CUSTOM": (999, 9999, 999, 999999),
}

ALL_FEATURES = [
    "FEATURE_POS",
    "FEATURE_INVENTORY",
    "FEATURE_FINANCE",
    "FEATURE_VENDOR",
    "FEATURE_HR",
    "FEATURE_CRM",
    "FEATURE_KDS",
    "FEATURE_MULTI_BRANCH",
    "FEATURE_REPORTING_ADVANCED",
    "FEATURE_WHATSAPP_NOTIFICATIONS",
    "FEATURE_CUSTOM_ROLES",
    "FEATURE_AUDIT_EXPORT",
    "FEATURE_LOT_TRACKING",
    "FEATURE_WHITE_LABEL_DOMAIN",
    "FEATURE_CONSOLIDATED_REPORTING",
]

GROWTH_FEATURES_ON = {
    "FEATURE_POS",
    "FEATURE_INVENTORY",
    "FEATURE_FINANCE",
    "FEATURE_VENDOR",
    "FEATURE_HR",
    "FEATURE_CRM",
    "FEATURE_KDS",
    "FEATURE_MULTI_BRANCH",
    "FEATURE_REPORTING_ADVANCED",
    "FEATURE_WHATSAPP_NOTIFICATIONS",
    "FEATURE_CUSTOM_ROLES",
    "FEATURE_AUDIT_EXPORT",
    "FEATURE_LOT_TRACKING",
}

STARTER_FEATURES_ON = {
    "FEATURE_POS",
    "FEATURE_INVENTORY",
    "FEATURE_FINANCE",
    "FEATURE_VENDOR",
    "FEATURE_HR",
    "FEATURE_CRM",
    "FEATURE_KDS",
}

ENTERPRISE_FEATURES_ON = GROWTH_FEATURES_ON | {
    "FEATURE_WHITE_LABEL_DOMAIN",
    "FEATURE_CONSOLIDATED_REPORTING",
}


@dataclass(frozen=True)
class TenantIds:
    tenant_id: str
    branch_hq_id: str
    branch_2_id: str
    user_owner: str
    user_cashier: str
    user_accountant: str
    user_finance: str


# Roles that can log in without TOTP (no rbac.manage / finance.period.close).
LOGIN_VERIFY_ROLES = frozenset({"CASHIER", "FINANCE_VIEWER"})


@dataclass(frozen=True)
class DevUser:
    key: str
    role: str
    email_local: str
    full_name: str
    password: str
    branch_keys: tuple[str, ...]
    approval_limit_paisa: int


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


def slugify(name: str) -> str:
    normalized = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", normalized)
    return slug.strip("-") or "tenant"


def resolve_ids(slug: str, tenant_id: str | None) -> TenantIds:
    if slug == "demo" and (tenant_id is None or tenant_id == DEMO_IDS["tenant_id"]):
        return TenantIds(**DEMO_IDS)
    tid = tenant_id or str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{slug}"))
    return TenantIds(
        tenant_id=tid,
        branch_hq_id=str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{slug}/branch/main")),
        branch_2_id=str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{slug}/branch/second")),
        user_owner=str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{slug}/user/owner")),
        user_cashier=str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{slug}/user/cashier")),
        user_accountant=str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{slug}/user/accountant")),
        user_finance=str(uuid.uuid5(UUID_NS, f"restaurantos/tenant/{slug}/user/finance")),
    )


def feature_defaults(tier: str) -> dict[str, bool]:
    tier = tier.upper()
    if tier == "STARTER":
        enabled = STARTER_FEATURES_ON
    elif tier in ("ENTERPRISE", "CUSTOM"):
        enabled = ENTERPRISE_FEATURES_ON
    else:
        enabled = GROWTH_FEATURES_ON
    return {code: code in enabled for code in ALL_FEATURES}


def db_connect(dbname: str, host: str, port: int, user: str, password: str) -> PgConnection:
    return psycopg2.connect(
        host=host,
        port=port,
        dbname=dbname,
        user=user,
        password=password,
    )


def set_tenant_guc(cur: Any, tenant_id: str) -> None:
    cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()


def build_users(slug: str, password: str) -> list[DevUser]:
    domain = f"{slug}.local"
    if slug == "demo":
        return [
            DevUser("owner", "OWNER", "owner@demo.local", "Demo Owner", "Owner#2026", ("hq", "second"), 100_000_000),
            DevUser("cashier", "CASHIER", "cashier@demo.local", "Demo Cashier", "Cashier#2026", ("hq",), 5_000_000),
            DevUser("accountant", "ACCOUNTANT", "accountant@demo.local", "Demo Accountant", "Accountant#2026", ("hq", "second"), 50_000_000),
            DevUser("finance", "FINANCE_VIEWER", "finance_demo@demo.local", "Demo Finance Viewer", "Finance#2026", ("hq",), 25_000_000),
        ]
    return [
        DevUser("owner", "OWNER", f"owner@{domain}", "Tenant Owner", password, ("hq", "second"), 100_000_000),
        DevUser("cashier", "CASHIER", f"cashier@{domain}", "Cashier", password, ("hq",), 5_000_000),
        DevUser("accountant", "ACCOUNTANT", f"accountant@{domain}", "Accountant", password, ("hq", "second"), 50_000_000),
        DevUser("finance", "FINANCE_VIEWER", f"finance@{domain}", "Finance Viewer", password, ("hq",), 25_000_000),
    ]


def upsert_platform_tenant(
    conn: PgConnection,
    ids: TenantIds,
    slug: str,
    brand_name: str,
    tier: str,
) -> None:
    limits = TIER_LIMITS.get(tier.upper(), TIER_LIMITS["GROWTH"])
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO tenants (id, slug, brand_name, status, tier, max_branches, max_users, storage_gb, nlq_quota)
        VALUES (%s, %s, %s, 'ACTIVE', %s, %s, %s, %s, %s)
        ON CONFLICT (slug) DO UPDATE SET
            brand_name = EXCLUDED.brand_name,
            status = 'ACTIVE',
            tier = EXCLUDED.tier,
            max_branches = EXCLUDED.max_branches,
            max_users = EXCLUDED.max_users,
            storage_gb = EXCLUDED.storage_gb,
            nlq_quota = EXCLUDED.nlq_quota
        RETURNING id
        """,
        (ids.tenant_id, slug, brand_name, tier.upper(), *limits),
    )
    row = cur.fetchone()
    tenant_id = str(row[0])
    if tenant_id != ids.tenant_id:
        raise RuntimeError(
            f"Platform tenant slug '{slug}' already exists with id {tenant_id}; "
            f"pass --tenant-id {tenant_id} or choose another slug."
        )
    for code, enabled in feature_defaults(tier).items():
        cur.execute(
            """
            INSERT INTO tenant_features (tenant_id, feature_code, is_enabled)
            VALUES (%s, %s, %s)
            ON CONFLICT (tenant_id, feature_code) DO UPDATE SET is_enabled = EXCLUDED.is_enabled
            """,
            (ids.tenant_id, code, enabled),
        )
    conn.commit()
    cur.close()


def upsert_auth_tenant(conn: PgConnection, ids: TenantIds, slug: str, brand_name: str) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO auth_tenants (id, slug, name, status)
        VALUES (%s, %s, %s, 'ACTIVE')
        ON CONFLICT (slug) DO UPDATE SET
            name = EXCLUDED.name,
            status = 'ACTIVE'
        RETURNING id
        """,
        (ids.tenant_id, slug, brand_name),
    )
    row = cur.fetchone()
    tenant_id = str(row[0])
    if tenant_id != ids.tenant_id:
        raise RuntimeError(
            f"Auth tenant slug '{slug}' already exists with id {tenant_id}; "
            f"pass --tenant-id {tenant_id} or choose another slug."
        )
    conn.commit()
    cur.close()


def upsert_branches(conn: PgConnection, ids: TenantIds, timezone: str) -> None:
    cur = conn.cursor()
    set_tenant_guc(cur, ids.tenant_id)
    branches = [
        (ids.branch_hq_id, "Main Branch (HQ)", True),
        (ids.branch_2_id, "Downtown Branch", False),
    ]
    for branch_id, name, is_hq in branches:
        cur.execute(
            """
            INSERT INTO branches (id, tenant_id, name, is_hq, is_active, timezone)
            VALUES (%s, %s, %s, %s, TRUE, %s)
            ON CONFLICT (tenant_id, name) DO UPDATE SET
                is_hq = EXCLUDED.is_hq,
                is_active = TRUE,
                timezone = EXCLUDED.timezone
            """,
            (branch_id, ids.tenant_id, name, is_hq, timezone),
        )
    conn.commit()
    cur.close()


def upsert_users(conn: PgConnection, ids: TenantIds, slug: str, password: str) -> list[DevUser]:
    branch_map = {"hq": ids.branch_hq_id, "second": ids.branch_2_id}
    user_id_map = {
        "owner": ids.user_owner,
        "cashier": ids.user_cashier,
        "accountant": ids.user_accountant,
        "finance": ids.user_finance,
    }
    users = build_users(slug, password)
    cur = conn.cursor()
    set_tenant_guc(cur, ids.tenant_id)

    for user in users:
        user_id = user_id_map[user.key]
        pw_hash = hash_password(user.password)
        cur.execute(
            """
            INSERT INTO users (id, tenant_id, email, password_hash, full_name, locale, totp_enabled, is_active)
            VALUES (%s, %s, %s, %s, %s, 'en', FALSE, TRUE)
            ON CONFLICT (tenant_id, email) DO UPDATE SET
                password_hash = EXCLUDED.password_hash,
                full_name = EXCLUDED.full_name,
                is_active = TRUE,
                totp_enabled = FALSE
            """,
            (user_id, ids.tenant_id, user.email_local, pw_hash, user.full_name),
        )
        for branch_key in user.branch_keys:
            branch_id = branch_map[branch_key]
            role_id = str(uuid.uuid5(UUID_NS, f"{ids.tenant_id}/{user_id}/{branch_id}/{user.role}"))
            cur.execute(
                """
                INSERT INTO user_branch_roles
                    (id, tenant_id, user_id, branch_id, role_code, approval_limit_paisa, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (tenant_id, user_id, branch_id, role_code) DO UPDATE SET
                    approval_limit_paisa = EXCLUDED.approval_limit_paisa,
                    is_active = TRUE
                """,
                (role_id, ids.tenant_id, user_id, branch_id, user.role, user.approval_limit_paisa),
            )

    conn.commit()
    cur.close()
    return users


def verify_db(conn_auth: PgConnection, conn_user: PgConnection, ids: TenantIds, slug: str) -> None:
    cur = conn_auth.cursor()
    cur.execute("SELECT status FROM auth_tenants WHERE slug = %s", (slug,))
    row = cur.fetchone()
    if not row or row[0] != "ACTIVE":
        raise RuntimeError(f"auth_tenants missing or inactive for slug={slug}")
    set_tenant_guc(cur, ids.tenant_id)
    cur.execute("SELECT COUNT(*) FROM users WHERE tenant_id = %s", (ids.tenant_id,))
    user_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM user_branch_roles WHERE tenant_id = %s", (ids.tenant_id,))
    role_count = cur.fetchone()[0]
    cur.close()

    cur = conn_user.cursor()
    set_tenant_guc(cur, ids.tenant_id)
    cur.execute("SELECT COUNT(*) FROM branches WHERE tenant_id = %s", (ids.tenant_id,))
    branch_count = cur.fetchone()[0]
    cur.close()

    if user_count < 4:
        raise RuntimeError(f"Expected 4 users, found {user_count}")
    if role_count < 6:
        raise RuntimeError(f"Expected at least 6 branch-role rows, found {role_count}")
    if branch_count < 2:
        raise RuntimeError(f"Expected 2 branches, found {branch_count}")


def verify_login(auth_url: str, slug: str, email: str, password: str) -> None:
    body = json.dumps({"email": email, "password": password, "tenantSlug": slug}).encode("utf-8")
    request = urllib.request.Request(
        f"{auth_url.rstrip('/')}/api/v1/auth/login",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.load(response)
    token = payload.get("data", {}).get("accessToken") or payload.get("accessToken")
    if not token:
        raise RuntimeError(f"Login succeeded but no accessToken for {email}")


def print_summary(
    ids: TenantIds,
    slug: str,
    brand_name: str,
    tier: str,
    users: list[DevUser],
) -> None:
    print(f"\nTenant onboarded: {brand_name} (slug={slug}, tier={tier})")
    print(f"  tenant_id:     {ids.tenant_id}")
    print(f"  branch HQ:     {ids.branch_hq_id}")
    print(f"  branch second: {ids.branch_2_id}")
    print("\nDev users:")
    for user in users:
        branches = ", ".join(user.branch_keys)
        print(f"  {user.role:16} {user.email_local:30} {user.password:16} branches={branches}")
    print("\nPhase 2 - seed finance COA + periods (finance-service must be running):")
    print(f"  python scripts/seed_finance_tenant.py --tenant-id {ids.tenant_id}")
    print(f"\nLogin: tenant slug '{slug}' at http://localhost:3000/login")


def main() -> int:
    deploy_env = load_deploy_env()
    parser = argparse.ArgumentParser(
        description="Phase 1 tenant onboarding (platform + auth + branches + dev users)"
    )
    parser.add_argument("--slug", default=os.getenv("TENANT_SLUG", DEFAULT_SLUG))
    parser.add_argument("--brand-name", default=os.getenv("TENANT_BRAND", DEFAULT_BRAND))
    parser.add_argument("--tenant-id", default=os.getenv("TENANT_ID"))
    parser.add_argument("--tier", default=os.getenv("TENANT_TIER", DEFAULT_TIER), choices=TIER_LIMITS.keys())
    parser.add_argument("--password", default=os.getenv("TENANT_DEV_PASSWORD", DEFAULT_PASSWORD))
    parser.add_argument("--timezone", default=DEFAULT_TIMEZONE)
    parser.add_argument("--db-host", default=os.getenv("DB_HOST", "127.0.0.1"))
    parser.add_argument("--db-port", type=int, default=int(os.getenv("DB_PORT", "5432")))
    parser.add_argument(
        "--db-user",
        default=os.getenv("POSTGRES_SUPERUSER", deploy_env.get("POSTGRES_SUPERUSER", "postgres")),
    )
    parser.add_argument(
        "--db-password",
        default=os.getenv("POSTGRES_SUPERUSER_PASSWORD", deploy_env.get("POSTGRES_SUPERUSER_PASSWORD", "dev_postgres_2026")),
    )
    parser.add_argument("--skip-platform", action="store_true", help="Skip platform_db writes")
    parser.add_argument(
        "--auth-url",
        default=os.getenv("AUTH_SERVICE_URL", "http://127.0.0.1:8081"),
        help="Auth service base URL for login verification",
    )
    parser.add_argument("--verify-login", action="store_true", help="POST /api/v1/auth/login for each user")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    slug = args.slug.strip().lower()
    if not re.fullmatch(r"[a-z0-9-]+", slug):
        print("Invalid slug: use lowercase letters, digits, and hyphens only.", file=sys.stderr)
        return 1

    ids = resolve_ids(slug, args.tenant_id)
    users = build_users(slug, args.password)

    if args.dry_run:
        print(f"Would onboard slug={slug} tenant_id={ids.tenant_id}")
        for user in users:
            print(f"  {user.role}: {user.email_local}")
        return 0

    try:
        if not args.skip_platform:
            with db_connect("platform_db", args.db_host, args.db_port, args.db_user, args.db_password) as platform_conn:
                upsert_platform_tenant(platform_conn, ids, slug, args.brand_name, args.tier)
                print("platform_db: tenant + feature flags OK")

        with db_connect("auth_db", args.db_host, args.db_port, args.db_user, args.db_password) as auth_conn:
            upsert_auth_tenant(auth_conn, ids, slug, args.brand_name)
            print("auth_db: auth_tenants OK")
            upsert_users(auth_conn, ids, slug, args.password)
            print("auth_db: users + branch roles OK")

        with db_connect("user_db", args.db_host, args.db_port, args.db_user, args.db_password) as user_conn:
            upsert_branches(user_conn, ids, args.timezone)
            print("user_db: branches OK")

        with db_connect("auth_db", args.db_host, args.db_port, args.db_user, args.db_password) as auth_conn, db_connect(
            "user_db", args.db_host, args.db_port, args.db_user, args.db_password
        ) as user_conn:
            verify_db(auth_conn, user_conn, ids, slug)
            print("DB verification OK")

        if args.verify_login:
            for user in users:
                if user.role not in LOGIN_VERIFY_ROLES:
                    print(f"  login skipped ({user.role} requires TOTP): {user.email_local}")
                    continue
                verify_login(args.auth_url, slug, user.email_local, user.password)
                print(f"  login OK: {user.email_local}")

    except psycopg2.Error as exc:
        print(f"Database error: {exc}", file=sys.stderr)
        return 1
    except urllib.error.HTTPError as exc:
        print(f"Login verification failed: HTTP {exc.code}", file=sys.stderr)
        print(exc.read().decode("utf-8", errors="replace"), file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Could not reach auth-service at {args.auth_url}: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print_summary(ids, slug, args.brand_name, args.tier, users)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
