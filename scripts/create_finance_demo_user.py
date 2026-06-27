"""
Creates a FINANCE_VIEWER role and finance_demo@demo.local user for development testing.
No TOTP required — only has finance.journal.view + finance.journal.post (not finance.period.close).
"""
import bcrypt
import psycopg2

TENANT_ID = "a0000001-0000-4000-8000-000000000001"
BRANCH_ID = "b0000001-0000-4000-8000-000000000001"
USER_ID   = "c0000004-0000-4000-8000-000000000004"
UBR_ID    = "d0000006-0000-4000-8000-000000000006"
EMAIL     = "finance_demo@demo.local"
PASSWORD  = "Finance#2026"

conn = psycopg2.connect(
    host="localhost", port=5432,
    dbname="auth_db", user="postgres", password="dev_postgres_2026"
)
cur = conn.cursor()

# 1. FINANCE_VIEWER system role
cur.execute("""
    INSERT INTO roles (id, tenant_id, code, name, is_system)
    VALUES (gen_random_uuid(), NULL, 'FINANCE_VIEWER', 'Finance Viewer', TRUE)
    ON CONFLICT DO NOTHING
""")

# 2. Permissions: COA view + journal view/post (NOT finance.period.close — that triggers TOTP)
for perm in ("finance.coa.view", "finance.journal.view", "finance.journal.post"):
    cur.execute("""
        INSERT INTO role_permissions (role_code, permission_code)
        VALUES ('FINANCE_VIEWER', %s) ON CONFLICT DO NOTHING
    """, (perm,))

# 3. Set tenant GUC so RLS allows inserts
cur.execute("SELECT set_config('app.current_tenant_id', %s, false)", (TENANT_ID,))

# 4. Create the demo user
pw_hash = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(12)).decode()
cur.execute("""
    INSERT INTO users (id, tenant_id, email, password_hash, full_name, locale, totp_enabled)
    VALUES (%s, %s, %s, %s, 'Demo Finance Viewer', 'en', FALSE)
    ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash
""", (USER_ID, TENANT_ID, EMAIL, pw_hash))

# 5. Assign FINANCE_VIEWER role to user on branch 1
cur.execute("""
    INSERT INTO user_branch_roles (id, tenant_id, user_id, branch_id, role_code, approval_limit_paisa)
    VALUES (%s, %s, %s, %s, 'FINANCE_VIEWER', 25000000)
    ON CONFLICT (id) DO NOTHING
""", (UBR_ID, TENANT_ID, USER_ID, BRANCH_ID))

conn.commit()

# Verify
cur.execute("""
    SELECT u.email, ubr.role_code, rp.permission_code
    FROM users u
    JOIN user_branch_roles ubr ON u.id = ubr.user_id
    JOIN role_permissions rp ON rp.role_code = ubr.role_code
    WHERE u.email = %s
""", (EMAIL,))
rows = cur.fetchall()
print(f"Created user: {EMAIL} / {PASSWORD}")
print("Permissions granted:")
for row in rows:
    print(f"  {row[1]}: {row[2]}")
cur.close()
conn.close()
print("\nDone — no TOTP required for this user.")
