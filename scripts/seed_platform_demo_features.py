"""
Seeds the demo tenant into platform_db and enables all STARTER-tier feature flags.
Also sets the Redis keys so the gateway serves them immediately.
"""
import psycopg2
import redis

TENANT_ID = "a0000001-0000-4000-8000-000000000001"
TENANT_SLUG = "demo"

# Feature flags enabled for all tiers (matches TierFeatureDefaults.ALL_TIERS_ON)
ALL_TIERS_ON = [
    "FEATURE_POS",
    "FEATURE_INVENTORY",
    "FEATURE_FINANCE",
    "FEATURE_VENDOR",
    "FEATURE_HR",
    "FEATURE_CRM",
    "FEATURE_KDS",
]

# Connect to platform_db
pg = psycopg2.connect(
    host="localhost", port=5432,
    dbname="platform_db", user="postgres", password="dev_postgres_2026"
)
cur = pg.cursor()

# 1. Insert demo tenant if not exists
cur.execute("""
    INSERT INTO tenants (id, slug, brand_name, status, tier)
    VALUES (%s, %s, 'Demo Restaurant', 'ACTIVE', 'STARTER')
    ON CONFLICT (id) DO NOTHING
""", (TENANT_ID, TENANT_SLUG))

# 2. Seed feature flags
for feature_code in ALL_TIERS_ON:
    cur.execute("""
        INSERT INTO tenant_features (tenant_id, feature_code, is_enabled)
        VALUES (%s, %s, TRUE)
        ON CONFLICT (tenant_id, feature_code) DO UPDATE SET is_enabled = TRUE
    """, (TENANT_ID, feature_code))

pg.commit()
cur.execute("SELECT feature_code, is_enabled FROM tenant_features WHERE tenant_id = %s", (TENANT_ID,))
rows = cur.fetchall()
print(f"Tenant {TENANT_ID} feature flags:")
for row in rows:
    print(f"  {row[0]}: {row[1]}")
cur.close()
pg.close()

# 3. Set Redis keys for both key shapes (gateway + service)
r = redis.Redis(host="localhost", port=6379, password="dev_redis_2026", decode_responses=True)
for feature_code in ALL_TIERS_ON:
    gateway_key = f"tenant_features:{TENANT_ID}:{feature_code}"
    service_key = f"feature:{TENANT_ID}:{feature_code}"
    r.set(gateway_key, "true")
    r.set(service_key, "true")
    print(f"  Redis SET {gateway_key} = true")

print("\nDone — FEATURE_FINANCE and all STARTER features enabled for demo tenant.")
