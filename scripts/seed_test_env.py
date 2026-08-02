#!/usr/bin/env python3
"""
Idempotent dev seed for RestaurantOS test tenant (phases 1–7).

Creates:
  - Platform superadmin (superadmin@test.com)
  - Tenant slug=test with admin (TENANT_ADMIN), cashier (CASHIER), kitchen staff (KITCHEN_STAFF)
  - POS menu, dining tables, sample orders, modifiers, tills/payments, KDS stations/tickets (direct SQL)
  - Finance COA + periods (API) and sample journal entries (SQL)

LOCAL DEV ONLY.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

import bcrypt
import psycopg2
import redis

REPO_ROOT = Path(__file__).resolve().parent.parent
UUID_NS = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

TENANT_SLUG = "test"
TENANT_BRAND = "Lume"
TENANT_TIER = "GROWTH"

SUPERADMIN_EMAIL = "superadmin@test.com"
SUPERADMIN_PASSWORD = "Test@0110!"

TENANT_PASSWORD = "Test@123!"

USERS = [
    ("admin", "TENANT_ADMIN", "admin@test.com", "Test Admin", ("hq", "second")),
    ("cashier", "CASHIER", "cashier@test.com", "Test Cashier", ("hq",)),
    ("kitchen1", "KITCHEN_STAFF", "kitchen1@test.com", "Kitchen One", ("hq",)),
    ("kitchen2", "KITCHEN_STAFF", "kitchen2@test.com", "Kitchen Two", ("second",)),
]

LEGACY_USER_EMAILS = ("waiter1@test.com", "waiter2@test.com")

ROLE_APPROVAL_LIMITS = {
    "TENANT_ADMIN": 100_000_000,
    "CASHIER": 5_000_000,
    "KITCHEN_STAFF": 0,
}

ALL_FEATURES = [
    "FEATURE_POS",
    "FEATURE_INVENTORY",
    "FEATURE_FINANCE",
    "FEATURE_VENDOR",
    "FEATURE_PURCHASING",
    "FEATURE_HR",
    "FEATURE_CRM",
    "FEATURE_KDS",
    "FEATURE_MULTI_BRANCH",
    "FEATURE_REPORTING",
    "FEATURE_REPORTING_ADVANCED",
    "FEATURE_WHATSAPP_NOTIFICATIONS",
    "FEATURE_CUSTOM_ROLES",
    "FEATURE_AUDIT_EXPORT",
    "FEATURE_LOT_TRACKING",
    "FEATURE_WHITE_LABEL_DOMAIN",
    "FEATURE_CONSOLIDATED_REPORTING",
]

MENU_ITEMS = [
    ("Mains", "Chicken Karahi", 120000, "GRILL", 13.0),
    ("Mains", "Mutton Biryani", 95000, "GRILL", 13.0),
    ("Mains", "Beef Nihari", 110000, "GRILL", 13.0),
    ("Starters", "Seekh Kebab (4 pcs)", 60000, "GRILL", 13.0),
    ("Starters", "Chicken Samosa (3 pcs)", 25000, "FRYER", 13.0),
    ("Beverages", "Fresh Lime", 18000, "DRINKS", 13.0),
    ("Beverages", "Doodh Patti Chai", 12000, "DRINKS", 13.0),
    ("Beverages", "Soft Drink", 15000, "DRINKS", 13.0),
    ("Desserts", "Gulab Jamun (2 pcs)", 22000, "DEFAULT", 13.0),
    ("Desserts", "Kheer", 20000, "DEFAULT", 13.0),
]

KDS_STATIONS = [
    ("GRILL", "Grill Station"),
    ("FRYER", "Fryer Station"),
    ("DRINKS", "Drinks Station"),
    ("DEFAULT", "Default Station"),
]

TABLES_HQ = [("T1", 4), ("T2", 4), ("T3", 6), ("T4", 2), ("T5", 8)]
TABLES_SECOND = [("D1", 4), ("D2", 4), ("D3", 6)]

SAMPLE_ORDERS = [
    {
        "key": "closed-hq-1",
        "branch": "hq",
        "order_no": "LUME-1001",
        "status": "CLOSED",
        "table_no": "T1",
        "order_type": "DINE_IN",
        "cashier": "cashier",
        "cover_count": 2,
        "items": [("Chicken Karahi", 2), ("Doodh Patti Chai", 2)],
        "opened_hours_ago": 4,
        "closed_hours_ago": 3,
    },
    {
        "key": "closed-hq-2",
        "branch": "hq",
        "order_no": "LUME-1002",
        "status": "CLOSED",
        "table_no": "T2",
        "order_type": "DINE_IN",
        "cashier": "cashier",
        "cover_count": 4,
        "items": [("Mutton Biryani", 2), ("Fresh Lime", 2)],
        "opened_hours_ago": 5,
        "closed_hours_ago": 4,
    },
    {
        "key": "closed-hq-3",
        "branch": "hq",
        "order_no": "LUME-1003",
        "status": "CLOSED",
        "table_no": "T3",
        "order_type": "TAKEAWAY",
        "cashier": "cashier",
        "cover_count": 1,
        "items": [("Beef Nihari", 1), ("Seekh Kebab (4 pcs)", 1), ("Soft Drink", 1)],
        "opened_hours_ago": 6,
        "closed_hours_ago": 5,
    },
    {
        "key": "closed-second-1",
        "branch": "second",
        "order_no": "LUME-2001",
        "status": "CLOSED",
        "table_no": "D1",
        "order_type": "DINE_IN",
        "cashier": "cashier",
        "cover_count": 3,
        "items": [("Chicken Karahi", 1), ("Kheer", 2)],
        "opened_hours_ago": 7,
        "closed_hours_ago": 6,
    },
    {
        "key": "open-hq-1",
        "branch": "hq",
        "order_no": "LUME-1004",
        "status": "OPEN",
        "table_no": "T4",
        "order_type": "DINE_IN",
        "cashier": "cashier",
        "cover_count": 2,
        "items": [("Chicken Samosa (3 pcs)", 2), ("Doodh Patti Chai", 1)],
        "opened_hours_ago": 1,
    },
    {
        "key": "kds-hq-1",
        "branch": "hq",
        "order_no": "LUME-1005",
        "status": "SENT_TO_KDS",
        "table_no": "T5",
        "order_type": "DINE_IN",
        "cashier": "cashier",
        "cover_count": 6,
        "items": [("Chicken Karahi", 3), ("Gulab Jamun (2 pcs)", 2)],
        "opened_hours_ago": 2,
        "sent_to_kds_hours_ago": 1,
    },
    {
        "key": "kds-second-1",
        "branch": "second",
        "order_no": "LUME-2002",
        "status": "SENT_TO_KDS",
        "table_no": "D2",
        "order_type": "DINE_IN",
        "cashier": "cashier",
        "cover_count": 4,
        "items": [("Mutton Biryani", 2), ("Fresh Lime", 2)],
        "opened_hours_ago": 2,
        "sent_to_kds_hours_ago": 1,
    },
]


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


def uid(*parts: str) -> str:
    return str(uuid.uuid5(UUID_NS, "/".join(parts)))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()


def db_connect(dbname: str, deploy_env: dict[str, str]) -> psycopg2.extensions.connection:
    return psycopg2.connect(
        host=os.getenv("DB_HOST", deploy_env.get("DB_HOST", "127.0.0.1")),
        port=int(os.getenv("DB_PORT", "5432")),
        dbname=dbname,
        user=os.getenv("POSTGRES_SUPERUSER", deploy_env.get("POSTGRES_SUPERUSER", "postgres")),
        password=os.getenv(
            "POSTGRES_SUPERUSER_PASSWORD",
            deploy_env.get("POSTGRES_SUPERUSER_PASSWORD", "dev_postgres_2026"),
        ),
    )


def set_tenant_guc(cur: Any, tenant_id: str) -> None:
    cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", (tenant_id,))


def seed_platform_superadmin(conn: psycopg2.extensions.connection) -> None:
    cur = conn.cursor()
    pw_hash = hash_password(SUPERADMIN_PASSWORD)
    cur.execute(
        """
        INSERT INTO platform_users (id, email, password_hash, role, is_active)
        VALUES (gen_random_uuid(), %s, %s, 'SUPER_ADMIN', TRUE)
        ON CONFLICT (email) DO UPDATE SET
            password_hash = EXCLUDED.password_hash,
            role = 'SUPER_ADMIN',
            is_active = TRUE
        """,
        (SUPERADMIN_EMAIL, pw_hash),
    )
    conn.commit()
    cur.close()
    print(f"platform_db: superadmin {SUPERADMIN_EMAIL}")


def seed_tenant_platform(conn: psycopg2.extensions.connection, tenant_id: str) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO tenants (id, slug, brand_name, status, tier, max_branches, max_users, storage_gb, nlq_quota)
        VALUES (%s, %s, %s, 'ACTIVE', %s, 5, 50, 20, 5000)
        ON CONFLICT (slug) DO UPDATE SET
            brand_name = EXCLUDED.brand_name,
            status = 'ACTIVE',
            tier = EXCLUDED.tier
        RETURNING id
        """,
        (tenant_id, TENANT_SLUG, TENANT_BRAND, TENANT_TIER),
    )
    row = cur.fetchone()
    if row and str(row[0]) != tenant_id:
        raise RuntimeError(f"Tenant slug '{TENANT_SLUG}' exists with different id {row[0]}")
    for code in ALL_FEATURES:
        cur.execute(
            """
            INSERT INTO tenant_features (tenant_id, feature_code, is_enabled)
            VALUES (%s, %s, TRUE)
            ON CONFLICT (tenant_id, feature_code) DO UPDATE SET is_enabled = TRUE
            """,
            (tenant_id, code),
        )
    conn.commit()
    cur.close()
    print(f"platform_db: tenant slug={TENANT_SLUG}")


def seed_redis_features(tenant_id: str, deploy_env: dict[str, str]) -> None:
    r = redis.Redis(
        host=os.getenv("REDIS_HOST", "127.0.0.1"),
        port=int(os.getenv("REDIS_PORT", "6379")),
        password=os.getenv("REDIS_PASSWORD", deploy_env.get("REDIS_PASSWORD", "dev_redis_2026")),
        decode_responses=True,
    )
    for code in ALL_FEATURES:
        r.set(f"tenant_features:{tenant_id}:{code}", "true")
        r.set(f"feature:{tenant_id}:{code}", "true")
    r.set(f"tenant:status:{tenant_id}", "ACTIVE")
    print("redis: feature flags + tenant status cached")


def seed_auth_tenant(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    branch_hq: str,
    branch_second: str,
) -> None:
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO auth_tenants (id, slug, name, status)
        VALUES (%s, %s, %s, 'ACTIVE')
        ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, status = 'ACTIVE'
        """,
        (tenant_id, TENANT_SLUG, TENANT_BRAND),
    )
    set_tenant_guc(cur, tenant_id)

    user_ids: dict[str, str] = {}
    branch_map = {"hq": branch_hq, "second": branch_second}

    cur.execute(
        """
        UPDATE users SET is_active = FALSE, updated_at = NOW()
        WHERE tenant_id = %s AND email = ANY(%s)
        """,
        (tenant_id, list(LEGACY_USER_EMAILS)),
    )
    cur.execute(
        """
        UPDATE user_branch_roles SET is_active = FALSE
        WHERE tenant_id = %s AND user_id IN (
            SELECT id FROM users WHERE tenant_id = %s AND email = ANY(%s)
        )
        """,
        (tenant_id, tenant_id, list(LEGACY_USER_EMAILS)),
    )
    cur.execute(
        """
        UPDATE user_branch_roles SET is_active = FALSE
        WHERE tenant_id = %s AND role_code = 'OWNER'
        """,
        (tenant_id,),
    )

    for key, role, email, full_name, branches in USERS:
        user_id = uid("restaurantos/tenant", TENANT_SLUG, "user", key)
        user_ids[key] = user_id
        pw_hash = hash_password(TENANT_PASSWORD)
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
            (user_id, tenant_id, email, pw_hash, full_name),
        )
        for branch_key in branches:
            branch_id = branch_map[branch_key]
            role_id = uid(tenant_id, user_id, branch_id, role)
            cur.execute(
                """
                INSERT INTO user_branch_roles
                    (id, tenant_id, user_id, branch_id, role_code, approval_limit_paisa, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (tenant_id, user_id, branch_id, role_code) DO UPDATE SET
                    approval_limit_paisa = EXCLUDED.approval_limit_paisa,
                    is_active = TRUE
                """,
                (
                    role_id,
                    tenant_id,
                    user_id,
                    branch_id,
                    role,
                    ROLE_APPROVAL_LIMITS.get(role, 0),
                ),
            )

    conn.commit()
    cur.close()
    print("auth_db: tenant users + branch roles OK")


def seed_branches(conn: psycopg2.extensions.connection, tenant_id: str, branch_hq: str, branch_second: str) -> None:
    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)
    for branch_id, name, is_hq in [
        (branch_hq, "Main Branch (HQ)", True),
        (branch_second, "Downtown Branch", False),
    ]:
        cur.execute(
            """
            INSERT INTO branches (id, tenant_id, name, is_hq, is_active, timezone)
            VALUES (%s, %s, %s, %s, TRUE, 'Asia/Karachi')
            ON CONFLICT (tenant_id, name) DO UPDATE SET
                is_hq = EXCLUDED.is_hq,
                is_active = TRUE,
                timezone = EXCLUDED.timezone
            """,
            (branch_id, tenant_id, name, is_hq),
        )
    conn.commit()
    cur.close()
    print("user_db: branches OK")


def seed_pos_data(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    branch_hq: str,
    branch_second: str,
) -> None:
    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)

    categories: dict[str, str] = {}
    sort = 1
    for cat_name, *_ in MENU_ITEMS:
        if cat_name in categories:
            continue
        cat_id = uid(tenant_id, "pos", "category", cat_name)
        cur.execute(
            """
            INSERT INTO menu_categories (id, tenant_id, name, sort_order, active)
            VALUES (%s, %s, %s, %s, TRUE)
            ON CONFLICT (tenant_id, name) DO UPDATE SET sort_order = EXCLUDED.sort_order, active = TRUE
            RETURNING id
            """,
            (cat_id, tenant_id, cat_name, sort),
        )
        row = cur.fetchone()
        categories[cat_name] = str(row[0])
        sort += 1

    for cat_name, item_name, price, station, tax in MENU_ITEMS:
        item_id = uid(tenant_id, "pos", "item", item_name)
        cur.execute(
            """
            INSERT INTO menu_items
                (id, tenant_id, category_id, name, base_price_paisa, tax_rate_pct, kds_station, active)
            VALUES (%s, %s, %s, %s, %s, %s, %s, TRUE)
            ON CONFLICT (id) DO UPDATE SET
                base_price_paisa = EXCLUDED.base_price_paisa,
                kds_station = EXCLUDED.kds_station,
                active = TRUE
            """,
            (item_id, tenant_id, categories[cat_name], item_name, price, tax, station),
        )
        override_id = uid(tenant_id, branch_second, item_id)
        if item_name == "Chicken Karahi":
            cur.execute(
                """
                INSERT INTO branch_menu_overrides (id, tenant_id, branch_id, menu_item_id, price_paisa, active)
                VALUES (%s, %s, %s, %s, 130000, TRUE)
                ON CONFLICT (tenant_id, branch_id, menu_item_id) DO UPDATE SET price_paisa = 130000
                """,
                (override_id, tenant_id, branch_second, item_id),
            )

    for branch_id, tables in [(branch_hq, TABLES_HQ), (branch_second, TABLES_SECOND)]:
        for table_no, capacity in tables:
            table_id = uid(tenant_id, branch_id, "table", table_no)
            cur.execute(
                """
                INSERT INTO dining_tables
                    (id, tenant_id, branch_id, table_number, capacity, status)
                VALUES (%s, %s, %s, %s, %s, 'AVAILABLE')
                ON CONFLICT (tenant_id, branch_id, table_number) DO UPDATE SET
                    capacity = EXCLUDED.capacity,
                    status = 'AVAILABLE'
                """,
                (table_id, tenant_id, branch_id, table_no, capacity),
            )

    conn.commit()
    cur.close()
    print("pos_db: menu + tables OK")


def _menu_catalog() -> dict[str, tuple[int, str, float]]:
    return {name: (price, station, tax) for _, name, price, station, tax in MENU_ITEMS}


def seed_sample_orders(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    branch_hq: str,
    branch_second: str,
) -> None:
    from datetime import datetime, timedelta, timezone

    catalog = _menu_catalog()
    branch_map = {"hq": branch_hq, "second": branch_second}
    branch_price_overrides = {
        (branch_second, "Chicken Karahi"): 130_000,
    }
    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)

    now = datetime.now(timezone.utc)
    occupied_tables: set[tuple[str, str]] = set()

    for spec in SAMPLE_ORDERS:
        branch_id = branch_map[spec["branch"]]
        order_id = uid(tenant_id, "pos", "order", spec["key"])
        client_order_id = uid(tenant_id, "pos", "client-order", spec["key"])
        table_id = uid(tenant_id, branch_id, "table", spec["table_no"])
        cashier_id = uid("restaurantos/tenant", TENANT_SLUG, "user", spec["cashier"])

        opened_at = now - timedelta(hours=spec["opened_hours_ago"])
        closed_at = None
        sent_to_kds_at = None
        if spec["status"] == "CLOSED":
            closed_at = now - timedelta(hours=spec["closed_hours_ago"])
        elif spec["status"] == "SENT_TO_KDS":
            sent_to_kds_at = now - timedelta(hours=spec["sent_to_kds_hours_ago"])
            occupied_tables.add((branch_id, spec["table_no"]))
        elif spec["status"] == "OPEN":
            occupied_tables.add((branch_id, spec["table_no"]))

        subtotal = 0
        tax_total = 0
        line_rows: list[tuple[Any, ...]] = []

        for item_name, qty in spec["items"]:
            base_price, station, tax_pct = catalog[item_name]
            unit_price = branch_price_overrides.get((branch_id, item_name), base_price)
            line_subtotal = unit_price * qty
            line_tax = int(line_subtotal * tax_pct / 100)
            line_total = line_subtotal + line_tax
            subtotal += line_subtotal
            tax_total += line_tax
            item_id = uid(tenant_id, "pos", "item", item_name)
            line_id = uid(tenant_id, order_id, "line", item_name)
            # pos order_items.kds_status uses OrderItemStatus (QA V5 widened the check
            # constraint): PENDING/SENT/ACCEPTED/PREPARING/READY/SERVED/CANCELLED. "COOKING"
            # is a kitchen TicketStatus value, not valid here — map SENT_TO_KDS to PREPARING.
            kds_status = "READY" if spec["status"] == "CLOSED" else (
                "PREPARING" if spec["status"] == "SENT_TO_KDS" else "PENDING"
            )
            line_rows.append(
                (
                    line_id,
                    tenant_id,
                    order_id,
                    item_id,
                    item_name,
                    unit_price,
                    qty,
                    station,
                    kds_status,
                    line_tax,
                    line_total,
                    cashier_id,
                    cashier_id,
                )
            )

        total = subtotal + tax_total

        cur.execute(
            """
            INSERT INTO orders (
                id, tenant_id, branch_id, order_no, type, status, table_id, cover_count,
                cashier_id, subtotal_paisa, tax_paisa, discount_paisa, service_charge_paisa,
                total_paisa, opened_at, sent_to_kds_at, closed_at, client_order_id,
                created_by, updated_by
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, 0, 0,
                %s, %s, %s, %s, %s,
                %s, %s
            )
            ON CONFLICT (id) DO UPDATE SET
                order_no = EXCLUDED.order_no,
                status = EXCLUDED.status,
                subtotal_paisa = EXCLUDED.subtotal_paisa,
                tax_paisa = EXCLUDED.tax_paisa,
                total_paisa = EXCLUDED.total_paisa,
                opened_at = EXCLUDED.opened_at,
                sent_to_kds_at = EXCLUDED.sent_to_kds_at,
                closed_at = EXCLUDED.closed_at,
                updated_at = NOW()
            """,
            (
                order_id,
                tenant_id,
                branch_id,
                spec["order_no"],
                spec["order_type"],
                spec["status"],
                table_id,
                spec["cover_count"],
                cashier_id,
                subtotal,
                tax_total,
                total,
                opened_at,
                sent_to_kds_at,
                closed_at,
                client_order_id,
                cashier_id,
                cashier_id,
            ),
        )

        for row in line_rows:
            cur.execute(
                """
                INSERT INTO order_items (
                    id, tenant_id, order_id, menu_item_id, item_name_snapshot,
                    unit_price_snapshot, quantity, kds_station, kds_status,
                    tax_paisa, line_total_paisa, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    quantity = EXCLUDED.quantity,
                    kds_status = EXCLUDED.kds_status,
                    line_total_paisa = EXCLUDED.line_total_paisa,
                    updated_at = NOW()
                """,
                row,
            )

    for branch_id, table_no in occupied_tables:
        cur.execute(
            """
            UPDATE dining_tables SET status = 'OCCUPIED', updated_at = NOW()
            WHERE tenant_id = %s AND branch_id = %s AND table_number = %s
            """,
            (tenant_id, branch_id, table_no),
        )

    conn.commit()
    cur.close()
    print(f"pos_db: {len(SAMPLE_ORDERS)} sample orders OK")


def seed_pos_modifiers(conn: psycopg2.extensions.connection, tenant_id: str) -> None:
    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)
    admin_id = uid("restaurantos/tenant", TENANT_SLUG, "user", "admin")
    karahi_id = uid(tenant_id, "pos", "item", "Chicken Karahi")
    group_id = uid(tenant_id, "pos", "modifier-group", "spice-level")

    cur.execute(
        """
        INSERT INTO modifier_groups
            (id, tenant_id, menu_item_id, name, required, min_select, max_select, created_by, updated_by)
        VALUES (%s, %s, %s, 'Spice Level', TRUE, 1, 1, %s, %s)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, required = EXCLUDED.required
        """,
        (group_id, tenant_id, karahi_id, admin_id, admin_id),
    )

    for mod_name, delta in [("Mild", 0), ("Hot", 0), ("Extra Hot", 5000)]:
        mod_id = uid(tenant_id, group_id, "modifier", mod_name.lower().replace(" ", "-"))
        cur.execute(
            """
            INSERT INTO modifiers
                (id, tenant_id, modifier_group_id, name, price_delta_paisa, active, created_by, updated_by)
            VALUES (%s, %s, %s, %s, %s, TRUE, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                price_delta_paisa = EXCLUDED.price_delta_paisa,
                active = TRUE
            """,
            (mod_id, tenant_id, group_id, mod_name, delta, admin_id, admin_id),
        )

    conn.commit()
    cur.close()
    print("pos_db: menu modifiers OK")


def seed_pos_tills_and_payments(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    branch_hq: str,
) -> None:
    from datetime import datetime, timedelta, timezone

    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)
    now = datetime.now(timezone.utc)
    cashier_id = uid("restaurantos/tenant", TENANT_SLUG, "user", "cashier")

    closed_till_id = uid(tenant_id, branch_hq, "till", "closed-yesterday")
    open_till_id = uid(tenant_id, branch_hq, "till", "open-today")

    cur.execute(
        """
        INSERT INTO till_sessions (
            id, tenant_id, branch_id, cashier_id, opening_float_paisa,
            expected_closing_paisa, declared_closing_paisa,
            opened_at, closed_at, status, created_by, updated_by
        )
        VALUES (%s, %s, %s, %s, 100000, 850000, 850000, %s, %s, 'CLOSED', %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            expected_closing_paisa = EXCLUDED.expected_closing_paisa,
            declared_closing_paisa = EXCLUDED.declared_closing_paisa,
            status = 'CLOSED',
            updated_at = NOW()
        """,
        (
            closed_till_id,
            tenant_id,
            branch_hq,
            cashier_id,
            now - timedelta(days=1, hours=10),
            now - timedelta(days=1, hours=2),
            cashier_id,
            cashier_id,
        ),
    )

    cur.execute(
        """
        INSERT INTO till_sessions (
            id, tenant_id, branch_id, cashier_id, opening_float_paisa,
            opened_at, status, created_by, updated_by
        )
        VALUES (%s, %s, %s, %s, 500000, %s, 'OPEN', %s, %s)
        ON CONFLICT (id) DO UPDATE SET
            opening_float_paisa = EXCLUDED.opening_float_paisa,
            status = 'OPEN',
            updated_at = NOW()
        """,
        (
            open_till_id,
            tenant_id,
            branch_hq,
            cashier_id,
            now - timedelta(hours=6),
            cashier_id,
            cashier_id,
        ),
    )

    cur.execute(
        """
        SELECT id, status, total_paisa, closed_at
        FROM orders
        WHERE tenant_id = %s AND branch_id = %s AND deleted_at IS NULL
        """,
        (tenant_id, branch_hq),
    )
    orders = cur.fetchall()
    payment_count = 0

    for order_id, status, total_paisa, closed_at in orders:
        till_id = closed_till_id if status == "CLOSED" else open_till_id
        cur.execute(
            """
            UPDATE orders SET till_session_id = %s, updated_at = NOW()
            WHERE id = %s AND tenant_id = %s
            """,
            (till_id, order_id, tenant_id),
        )

        if status != "CLOSED":
            continue

        payment_id = uid(tenant_id, order_id, "payment", "cash")
        recorded_at = closed_at or (now - timedelta(hours=3))
        cur.execute(
            """
            INSERT INTO order_payments
                (id, tenant_id, order_id, method, amount_paisa, recorded_at, created_by, updated_by)
            VALUES (%s, %s, %s, 'CASH', %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                amount_paisa = EXCLUDED.amount_paisa,
                recorded_at = EXCLUDED.recorded_at,
                updated_at = NOW()
            """,
            (payment_id, tenant_id, order_id, total_paisa, recorded_at, cashier_id, cashier_id),
        )
        payment_count += 1

    conn.commit()
    cur.close()
    print(f"pos_db: tills + {payment_count} order payments OK")


def seed_kds_tickets(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    branch_hq: str,
    branch_second: str,
) -> None:
    from datetime import datetime, timedelta, timezone

    catalog = _menu_catalog()
    branch_map = {"hq": branch_hq, "second": branch_second}
    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)
    now = datetime.now(timezone.utc)
    kitchen_user = uid("restaurantos/tenant", TENANT_SLUG, "user", "kitchen1")
    ticket_count = 0
    item_count = 0

    kds_specs = [s for s in SAMPLE_ORDERS if s["status"] == "SENT_TO_KDS"]

    for spec in kds_specs:
        branch_id = branch_map[spec["branch"]]
        order_id = uid(tenant_id, "pos", "order", spec["key"])
        received_at = now - timedelta(hours=spec.get("sent_to_kds_hours_ago", 1))

        by_station: dict[str, list[tuple[str, int]]] = {}
        for item_name, qty in spec["items"]:
            station = catalog[item_name][1]
            by_station.setdefault(station, []).append((item_name, qty))

        for station_code, items in by_station.items():
            ticket_id = uid(tenant_id, order_id, "kds-ticket", station_code)
            cooking = spec["key"] == "kds-hq-1" and station_code == "GRILL"
            ticket_status = "COOKING" if cooking else "PENDING"
            started_at = received_at + timedelta(minutes=5) if cooking else None

            cur.execute(
                """
                INSERT INTO kds_tickets (
                    id, tenant_id, branch_id, order_id, order_no, station_code, status,
                    priority, received_at, started_at, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, FALSE, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    status = EXCLUDED.status,
                    started_at = EXCLUDED.started_at,
                    updated_at = NOW()
                """,
                (
                    ticket_id,
                    tenant_id,
                    branch_id,
                    order_id,
                    spec["order_no"],
                    station_code,
                    ticket_status,
                    received_at,
                    started_at,
                    kitchen_user,
                    kitchen_user,
                ),
            )
            ticket_count += 1

            for item_name, qty in items:
                order_item_id = uid(tenant_id, order_id, "line", item_name)
                ticket_item_id = uid(ticket_id, order_item_id, "kds-item")
                item_status = "COOKING" if cooking else "PENDING"
                cur.execute(
                    """
                    INSERT INTO kds_ticket_items (
                        id, tenant_id, ticket_id, order_item_id, name, qty,
                        modifiers, status, created_by, updated_by
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, '[]'::jsonb, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        qty = EXCLUDED.qty,
                        status = EXCLUDED.status,
                        updated_at = NOW()
                    """,
                    (
                        ticket_item_id,
                        tenant_id,
                        ticket_id,
                        order_item_id,
                        item_name,
                        qty,
                        item_status,
                        kitchen_user,
                        kitchen_user,
                    ),
                )
                item_count += 1

    conn.commit()
    cur.close()
    print(f"kitchen_db: {ticket_count} KDS tickets ({item_count} items) OK")


def seed_finance_sample_data(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    branch_hq: str,
) -> None:
    from datetime import date

    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)
    admin_id = uid("restaurantos/tenant", TENANT_SLUG, "user", "admin")
    today = date.today()

    cur.execute(
        """
        SELECT id, fiscal_year, period_no
        FROM accounting_periods
        WHERE tenant_id = %s AND start_date <= %s AND end_date >= %s
        ORDER BY fiscal_year DESC, period_no DESC
        LIMIT 1
        """,
        (tenant_id, today, today),
    )
    period_row = cur.fetchone()
    if not period_row:
        cur.close()
        print("finance_db: skip sample JEs — no open accounting period (run finance provision first)")
        return

    period_id, fiscal_year, _period_no = period_row

    cur.execute(
        "SELECT COUNT(*) FROM chart_of_accounts WHERE tenant_id = %s",
        (tenant_id,),
    )
    if cur.fetchone()[0] == 0:
        cur.close()
        print("finance_db: skip sample JEs — COA not provisioned")
        return

    sales_paisa = 0
    catalog = _menu_catalog()
    branch_price_overrides = {(branch_hq, "Chicken Karahi"): 130_000}
    for spec in SAMPLE_ORDERS:
        if spec["status"] != "CLOSED" or spec["branch"] != "hq":
            continue
        for item_name, qty in spec["items"]:
            base_price, _, tax_pct = catalog[item_name]
            unit_price = branch_price_overrides.get((branch_hq, item_name), base_price)
            line_subtotal = unit_price * qty
            sales_paisa += line_subtotal + int(line_subtotal * tax_pct / 100)

    sample_entries = [
        {
            "key": "rent-jun",
            "entry_no": f"JE-{fiscal_year}-000001",
            "description": "June rent — Main Branch",
            "status": "POSTED",
            "lines": [
                ("6100", "Rent expense", 250_000_00, 0),
                ("1110", "Bank payment", 0, 250_000_00),
            ],
        },
        {
            "key": "pos-sales",
            "entry_no": f"JE-{fiscal_year}-000002",
            "description": "POS dine-in sales summary (HQ)",
            "status": "POSTED",
            "lines": [
                ("1010", "Cash receipts", sales_paisa, 0),
                ("4100", "Food sales revenue", 0, sales_paisa),
            ],
        },
        {
            "key": "utilities-accrual",
            "entry_no": f"JE-{fiscal_year}-000003",
            "description": "Utilities accrual (draft)",
            "status": "DRAFT",
            "lines": [
                ("6300", "Electricity estimate", 45_000_00, 0),
                ("1010", "Accrued cash offset", 0, 45_000_00),
            ],
        },
        {
            "key": "petty-cash",
            "entry_no": f"JE-{fiscal_year}-000004",
            "description": "Petty cash replenishment",
            "status": "POSTED",
            "lines": [
                ("1020", "Petty cash top-up", 20_000_00, 0),
                ("1010", "Cash transfer", 0, 20_000_00),
            ],
        },
    ]

    cur.execute(
        """
        INSERT INTO je_sequences (tenant_id, fiscal_year, last_seq)
        VALUES (%s, %s, %s)
        ON CONFLICT (tenant_id, fiscal_year) DO UPDATE
        SET last_seq = GREATEST(je_sequences.last_seq, EXCLUDED.last_seq)
        """,
        (tenant_id, fiscal_year, len(sample_entries)),
    )

    je_count = 0
    line_count = 0
    for entry in sample_entries:
        je_id = uid(tenant_id, "finance", "je", entry["key"])
        cur.execute(
            """
            INSERT INTO journal_entries (
                id, tenant_id, branch_id, entry_no, period_id, entry_date,
                description, source_type, status, posted_by, created_by, updated_by
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'MANUAL', %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                description = EXCLUDED.description,
                status = EXCLUDED.status,
                updated_at = NOW()
            """,
            (
                je_id,
                tenant_id,
                branch_hq,
                entry["entry_no"],
                period_id,
                today,
                entry["description"],
                entry["status"],
                admin_id if entry["status"] == "POSTED" else None,
                admin_id,
                admin_id,
            ),
        )
        je_count += 1

        for idx, (account_code, line_desc, debit, credit) in enumerate(entry["lines"]):
            line_id = uid(je_id, "line", str(idx))
            cur.execute(
                """
                INSERT INTO journal_lines (
                    id, tenant_id, je_id, account_code, description,
                    debit_paisa, credit_paisa, created_by, updated_by
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    debit_paisa = EXCLUDED.debit_paisa,
                    credit_paisa = EXCLUDED.credit_paisa,
                    updated_at = NOW()
                """,
                (line_id, tenant_id, je_id, account_code, line_desc, debit, credit, admin_id, admin_id),
            )
            line_count += 1

    conn.commit()
    cur.close()
    print(f"finance_db: {je_count} journal entries ({line_count} lines) OK")


def seed_kitchen_stations(
    conn: psycopg2.extensions.connection,
    tenant_id: str,
    branch_hq: str,
    branch_second: str,
) -> None:
    cur = conn.cursor()
    set_tenant_guc(cur, tenant_id)
    for branch_id in (branch_hq, branch_second):
        for code, name in KDS_STATIONS:
            station_id = uid(tenant_id, branch_id, "kds", code)
            cur.execute(
                """
                INSERT INTO kds_stations
                    (id, tenant_id, branch_id, code, name, is_active, escalation_threshold_seconds)
                VALUES (%s, %s, %s, %s, %s, TRUE, 900)
                ON CONFLICT (tenant_id, branch_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE
                """,
                (station_id, tenant_id, branch_id, code, name),
            )
    conn.commit()
    cur.close()
    print("kitchen_db: KDS stations OK")


def provision_finance(tenant_id: str, deploy_env: dict[str, str]) -> None:
    finance_url = os.getenv("FINANCE_SERVICE_URL", "http://127.0.0.1:8086")
    secret = os.getenv(
        "INTERNAL_SERVICE_SECRET",
        deploy_env.get("INTERNAL_SERVICE_SECRET", "dev-internal-secret"),
    )
    from datetime import date

    today = date.today()
    fiscal_year = today.year + 1 if today.month >= 7 else today.year
    url = f"{finance_url.rstrip('/')}/internal/tenants/{tenant_id}/provision"
    body = json.dumps({"fiscalYear": fiscal_year}).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "X-Internal-Service": secret},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    data = payload.get("data", payload)
    print(
        f"finance-service: accounts={data.get('accountsSeeded', 0)} "
        f"periods={data.get('periodsSeeded', 0)}"
    )


def verify_login(auth_url: str, email: str, password: str) -> None:
    body = json.dumps(
        {"email": email, "password": password, "tenantSlug": TENANT_SLUG}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{auth_url.rstrip('/')}/api/v1/auth/login",
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.load(response)
    token = payload.get("data", {}).get("accessToken")
    if not token:
        raise RuntimeError(f"Login failed for {email}")


def main() -> int:
    deploy_env = load_deploy_env()
    tenant_id = uid("restaurantos/tenant", TENANT_SLUG)
    branch_hq = uid("restaurantos/tenant", TENANT_SLUG, "branch", "main")
    branch_second = uid("restaurantos/tenant", TENANT_SLUG, "branch", "second")

    auth_url = os.getenv("AUTH_SERVICE_URL", "http://127.0.0.1:8081")
    skip_finance = os.getenv("SKIP_FINANCE_SEED", "").lower() in ("1", "true", "yes")

    try:
        with db_connect("platform_db", deploy_env) as platform_conn:
            seed_platform_superadmin(platform_conn)
            seed_tenant_platform(platform_conn, tenant_id)

        seed_redis_features(tenant_id, deploy_env)

        with db_connect("auth_db", deploy_env) as auth_conn:
            seed_auth_tenant(auth_conn, tenant_id, branch_hq, branch_second)

        with db_connect("user_db", deploy_env) as user_conn:
            seed_branches(user_conn, tenant_id, branch_hq, branch_second)

        with db_connect("pos_db", deploy_env) as pos_conn:
            seed_pos_data(pos_conn, tenant_id, branch_hq, branch_second)
            seed_sample_orders(pos_conn, tenant_id, branch_hq, branch_second)
            seed_pos_modifiers(pos_conn, tenant_id)
            seed_pos_tills_and_payments(pos_conn, tenant_id, branch_hq)

        with db_connect("kitchen_db", deploy_env) as kitchen_conn:
            seed_kitchen_stations(kitchen_conn, tenant_id, branch_hq, branch_second)
            seed_kds_tickets(kitchen_conn, tenant_id, branch_hq, branch_second)

        if not skip_finance:
            provision_finance(tenant_id, deploy_env)
            with db_connect("finance_db", deploy_env) as finance_conn:
                seed_finance_sample_data(finance_conn, tenant_id, branch_hq)

        for _, _, email, _, _ in USERS:
            verify_login(auth_url, email, TENANT_PASSWORD)
            print(f"  login OK: {email}")

    except psycopg2.Error as exc:
        print(f"Database error: {exc}", file=sys.stderr)
        return 1
    except urllib.error.HTTPError as exc:
        print(f"HTTP error: {exc.code}", file=sys.stderr)
        print(exc.read().decode("utf-8", errors="replace"), file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Service unreachable: {exc}", file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print("\n=== Seed complete ===")
    print(f"Tenant slug: {TENANT_SLUG}")
    print(f"Login URL:   http://localhost:3000/login?tenant={TENANT_SLUG}")
    print(f"Superadmin:  {SUPERADMIN_EMAIL} / {SUPERADMIN_PASSWORD} (platform_db)")
    print(f"Tenant pwd:  {TENANT_PASSWORD} for all tenant users")
    print("Roles:")
    for _, role, email, _, _ in USERS:
        print(f"  {role:14} {email}")
    if LEGACY_USER_EMAILS:
        print(f"  (deactivated)  {', '.join(LEGACY_USER_EMAILS)}")
    print("\nUI data seeded:")
    print("  Dashboard / POS — menu, tables, 7 orders, modifiers, tills, payments")
    print("  Kitchen KDS  — stations + tickets for SENT_TO_KDS orders (HQ + Downtown)")
    print("  Finance      — COA, periods, 4 journal entries (3 posted, 1 draft)")
    print("  Auth/Users   — 4 roles across 2 branches")
    print("\nNot yet implemented (no backend/UI pages): Inventory, Purchasing, HR, CRM, Reporting")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
