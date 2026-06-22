# RestaurantOS — Document 11: Seed Data Specification

> Defines all data that must exist in the development database for the system to be usable and testable from day one. Platform-global data is seeded via Liquibase (system roles, permissions, COA template). Tenant data is created via the provisioning API (never direct SQL), so the seed path exercises the real provisioning flow (FD-1). All money is integer paisa. All dev passwords below are for LOCAL DEV ONLY.

## 11.1 Platform Seed Data (`platform_db`, via Liquibase, `context="seed"`)

| Field | SuperAdmin | Support |
|---|---|---|
| `email` | `superadmin@restaurantos.local` | `support@restaurantos.local` |
| dev password (plaintext) | `SuperAdmin#2026` | `Support#2026` |
| `role` | `SUPER_ADMIN` | `SUPPORT` |
| `is_active` | true | true |

```xml
<changeSet id="platform-1.0.0-050-seed-platform-users" author="restaurantos-agent" runOnChange="false" context="seed">
    <insert tableName="platform_users">
        <column name="email" value="superadmin@restaurantos.local"/>
        <column name="password_hash" value="$2a$12$DEV_ONLY_REPLACE_bcrypt_hash_of_SuperAdmin2026"/>
        <column name="role" value="SUPER_ADMIN"/>
        <column name="is_active" valueBoolean="true"/>
    </insert>
    <insert tableName="platform_users">
        <column name="email" value="support@restaurantos.local"/>
        <column name="password_hash" value="$2a$12$DEV_ONLY_REPLACE_bcrypt_hash_of_Support2026"/>
        <column name="role" value="SUPPORT"/>
        <column name="is_active" valueBoolean="true"/>
    </insert>
    <rollback>
        <delete tableName="platform_users">
            <where>email IN ('superadmin@restaurantos.local','support@restaurantos.local')</where>
        </delete>
    </rollback>
</changeSet>
```

Generate real bcrypt hashes once and paste them in (do not commit plaintext): `htpasswd -bnBC 12 "" 'SuperAdmin#2026' | tr -d ':\n' | sed 's/$2y/$2a/'`.

## 11.2 Tenant Seed Data (via the provisioning API, NOT direct SQL)

The demo tenant is created by calling `POST /api/v1/platform/tenants` as the SuperAdmin (FD-1). This seeds:

- Tenant: name "Demo Restaurant", slug `demo`, tier `GROWTH`, country PK, timezone `Asia/Karachi`.
- Default feature flags for GROWTH: all core 7 + `FEATURE_MULTI_BRANCH`, `FEATURE_HR`, `FEATURE_CRM`, `FEATURE_REPORTING_ADVANCED`, `FEATURE_WHITE_LABEL_DOMAIN`, `FEATURE_WHATSAPP_NOTIFICATIONS`, `FEATURE_CUSTOM_ROLES`, `FEATURE_AUDIT_EXPORT`, `FEATURE_LOT_TRACKING`, `FEATURE_CONSOLIDATED_REPORTING`.
- Complete Pakistan-standard chart of accounts (seeded by Finance from its template). Required accounts include the Phase-1-fix additions: `4200 Service Charge Revenue`, `4910 Sales Discounts`, `2400 Loyalty Liability`, `5210 Stock Loss in Transit`, alongside recipe accounts (`1010 Cash`, `1100 Bank`, `1300 Inventory`, `1320 Inventory in Transit`, `1700 GR/IR`, `1710 Input Tax`, `2100 AP`, `2200 Output Tax`, `2300 Wages Payable`, `2500 Accrued Expenses`, `4100 Sales Revenue`, `4920 Sales Refunds`, `5100 COGS`, `5200 Wastage Expense`, `5220 Stock Variance Loss`, `5221 Stock Variance Gain`, `6200 Salary Expense`, `6300 Utilities`).
- All default roles (OWNER, BRANCH_MANAGER, CASHIER, CHEF, ACCOUNTANT, INVENTORY_MANAGER, HR_MANAGER, CRM_MANAGER) and their permission grants per Appendix B.10.
- Two branches: "Main Branch" (HQ, `isHq=true`) and "Branch 2".
- Twelve accounting periods for the current fiscal year (Pakistan FY starts July 1), all `OPEN`.

Six seed users (dev passwords for LOCAL DEV ONLY):

| Role | Email | Dev password | Branch assignment |
|---|---|---|---|
| OWNER | `owner@demo.local` | `Owner#2026` | both branches |
| BRANCH_MANAGER | `manager@demo.local` | `Manager#2026` | Main Branch |
| CASHIER | `cashier@demo.local` | `Cashier#2026` | Main Branch |
| CHEF | `chef@demo.local` | `Chef#2026` | Main Branch |
| ACCOUNTANT | `accountant@demo.local` | `Accountant#2026` | both branches |
| INVENTORY_MANAGER | `inventory@demo.local` | `Inventory#2026` | both branches |

## 11.3 Menu Seed Data (`pos_db`, via authenticated API as OWNER)

Four categories: Mains, Starters, Beverages, Desserts. Ten menu items (`kds_station` tag included per CRIT-04 fix):

| # | Name | Category | `base_price_paisa` | `kds_station` | tax % |
|---|---|---|---|---|---|
| 1 | Chicken Karahi | Mains | 120000 | GRILL | 13.00 |
| 2 | Mutton Biryani | Mains | 95000 | GRILL | 13.00 |
| 3 | Beef Nihari | Mains | 110000 | GRILL | 13.00 |
| 4 | Seekh Kebab (4 pcs) | Starters | 60000 | GRILL | 13.00 |
| 5 | Chicken Samosa (3 pcs) | Starters | 25000 | FRYER | 13.00 |
| 6 | Fresh Lime | Beverages | 18000 | DRINKS | 13.00 |
| 7 | Doodh Patti Chai | Beverages | 12000 | DRINKS | 13.00 |
| 8 | Soft Drink | Beverages | 15000 | DRINKS | 13.00 |
| 9 | Gulab Jamun (2 pcs) | Desserts | 22000 | DEFAULT | 13.00 |
| 10 | Kheer | Desserts | 20000 | DEFAULT | 13.00 |

Two modifier groups: "Spice Level" (`SINGLE`, required: Mild/Medium/Hot, all `price_delta_paisa=0`) and "Add-ons" (`MULTI`, optional: Extra Raita +5000, Extra Naan +8000). `branch_menu_overrides` for one item at Branch 2: Chicken Karahi priced `130000` paisa.

## 11.4 Inventory Seed Data (`inventory_db`, via authenticated API as INVENTORY_MANAGER)

Units of measure: `kg` (base), `g` (to_base 0.001), `l` (base), `ml` (to_base 0.001), `pcs` (base), `dozen` (to_base 12).

Ten ingredients with opening stock at Main Branch (movement type `OPENING_BALANCE`, per MAJOR-03 fix):

| # | Ingredient | Base unit | Reorder point | Opening qty | Opening unit cost (paisa/base) |
|---|---|---|---|---|---|
| 1 | Chicken | kg | 5 | 40 | 45000 |
| 2 | Mutton | kg | 5 | 25 | 130000 |
| 3 | Beef | kg | 5 | 30 | 90000 |
| 4 | Basmati Rice | kg | 10 | 80 | 28000 |
| 5 | Onion | kg | 8 | 60 | 8000 |
| 6 | Tomato | kg | 8 | 50 | 12000 |
| 7 | Cooking Oil | l | 10 | 70 | 60000 |
| 8 | Milk | l | 10 | 40 | 22000 |
| 9 | Sugar | kg | 5 | 30 | 18000 |
| 10 | Flour (Maida) | kg | 8 | 50 | 9000 |

Recipes for five menu items (to enable depletion testing):

| Menu item | Recipe lines (ingredient, qty, uom, yield_pct) | `yield_servings` |
|---|---|---|
| Chicken Karahi | Chicken 0.4 kg 0.90; Onion 0.15 kg 1.0; Tomato 0.2 kg 1.0; Oil 0.05 l 1.0 | 1 |
| Mutton Biryani | Mutton 0.3 kg 0.92; Basmati Rice 0.25 kg 1.0; Onion 0.1 kg 1.0; Oil 0.04 l 1.0 | 1 |
| Beef Nihari | Beef 0.35 kg 0.90; Flour 0.02 kg 1.0; Oil 0.05 l 1.0 | 1 |
| Doodh Patti Chai | Milk 0.2 l 1.0; Sugar 0.02 kg 1.0 | 1 |
| Kheer | Milk 0.25 l 1.0; Basmati Rice 0.05 kg 1.0; Sugar 0.04 kg 1.0 | 1 |

These let an agent close an order and verify depletion + COGS at MAC end-to-end.

## 11.5 Seed Script

`scripts/seed-dev-data.sh` — idempotent. Calls the platform/auth APIs in order. Requires infra up and the Phase-1 services running.

```bash
#!/usr/bin/env bash
# RestaurantOS dev data seeder. Idempotent. LOCAL DEV ONLY.
set -euo pipefail

API="${NEXT_PUBLIC_API_BASE_URL:-http://localhost:8080}"
PLATFORM_EMAIL="superadmin@restaurantos.local"
PLATFORM_PASSWORD="SuperAdmin#2026"
DEMO_SLUG="demo"

log() { printf '\033[36m[seed]\033[0m %s\n' "$*"; }

# 1. Platform login -> SuperAdmin JWT
log "Logging in as SuperAdmin..."
SA_TOKEN=$(curl -sf -X POST "$API/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$PLATFORM_EMAIL\",\"password\":\"$PLATFORM_PASSWORD\"}" \
  | jq -r '.data.accessToken')

# 2. Provision the demo tenant (idempotent: skip if slug exists)
EXISTS=$(curl -sf "$API/api/v1/platform/tenants?slug=$DEMO_SLUG" \
  -H "Authorization: Bearer $SA_TOKEN" | jq -r '.data | length')
if [ "$EXISTS" = "0" ]; then
  log "Provisioning Demo Restaurant (GROWTH)..."
  curl -sf -X POST "$API/api/v1/platform/tenants" \
    -H "Authorization: Bearer $SA_TOKEN" \
    -H 'Content-Type: application/json' \
    -H "Idempotency-Key: $(uuidgen)" \
    -d '{
      "companyName":"Demo Restaurant","slug":"demo","email":"owner@demo.local",
      "phone":"+923000000000","country":"PK","timezone":"Asia/Karachi","tier":"GROWTH"
    }' > /dev/null
else
  log "Demo tenant already exists; skipping provisioning."
fi

# 3. Owner login -> OWNER JWT
log "Authenticating demo OWNER..."
OWNER_TOKEN=$(curl -sf -X POST "$API/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@demo.local","password":"Owner#2026","tenantSlug":"demo"}' \
  | jq -r '.data.accessToken')

# 4. Add Branch 2 if missing
log "Ensuring Branch 2 exists..."
curl -sf -X POST "$API/api/v1/branches" \
  -H "Authorization: Bearer $OWNER_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"name":"Branch 2","timezone":"Asia/Karachi"}' >/dev/null || true

# 5. Seed menu
log "Seeding menu..."
bash "$(dirname "$0")/seed-menu.sh" "$API" "$OWNER_TOKEN"

# 6. Seed inventory
log "Seeding inventory..."
INV_TOKEN=$(curl -sf -X POST "$API/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"inventory@demo.local","password":"Inventory#2026","tenantSlug":"demo"}' \
  | jq -r '.data.accessToken')
bash "$(dirname "$0")/seed-inventory.sh" "$API" "$INV_TOKEN"

log "Seed complete. Login at $API as owner@demo.local / Owner#2026"
```

The helpers `seed-menu.sh` and `seed-inventory.sh` iterate §11.3 and §11.4, POSTing each entity with an `Idempotency-Key`; unique constraints make re-runs safe. Order matters: categories before items, ingredients + UOM before recipes, branches before branch_menu_overrides.
