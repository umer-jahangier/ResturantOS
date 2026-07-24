# 09-02 Summary — CRM Service (Customers, Loyalty, Promotions, Feedback)

**Completed:** 2026-06-27  
**Plan:** 09-02 (greenfield crm-service)

## Delivered

### Service scaffold
- **Module:** `services/crm-service` (port 8089, `crm_db`, Liquibase)
- **Gateway route:** `/api/v1/crm/**` → `lb://crm-service`
- **Dockerfile** + parent POM module entry

### Schema (`crm_db`)
| Table | Purpose |
|-------|---------|
| `customers` | Phone-unique per tenant, RLS |
| `loyalty_accounts` | Points balance, tier, lifetime spend |
| `loyalty_transactions` | ACCRUAL / DEBIT / REDEMPTION |
| `loyalty_tier_config` | Tier thresholds + points rate |
| `promotions` | Time/day/item/tier filters |
| `customer_feedback` | Post-order rating + comment |
| `processed_events` | Consumer dedup (NON-RLS) |

### Loyalty accrual formula
```
points = floor(totalPaisa / points_per_pkr_paisa)
```
Default: **1 point per PKR 100 spent** (`points_per_pkr_paisa = 100`).

### Tier thresholds (paisa)
| Tier | Min lifetime spend |
|------|-------------------|
| BRONZE | 0 |
| SILVER | 5,000,000 (PKR 50,000) |
| GOLD | 20,000,000 (PKR 200,000) |

### APIs
**Public (JWT + permissions):**
- `CRUD /api/v1/crm/customers`
- `POST/GET /api/v1/crm/promotions`
- `POST/GET /api/v1/crm/feedback`

**Internal (X-Internal-Service):**
- `GET /internal/crm/customers/lookup?phone=`
- `POST /internal/crm/promotions/evaluate`

### Event consumers
| Queue | Event | Behavior |
|-------|-------|----------|
| `crm.order-closed.queue` | `ORDER_CLOSED` | Accrue points + tier check (skip if `customerId` null) |
| `crm.order-refunded.queue` | `ORDER_REFUNDED` | Proportional point debit |

### Promotion evaluation rules
- Active date range (`start_at` / `end_at`)
- Day-of-week filter (Asia/Karachi)
- Hour window filter
- Tier filter (optional)
- Menu item intersection (optional)
- Best eligible discount wins (PERCENT or FIXED, capped at subtotal)

### POS contract (Phase 7)
1. Set `customerId` on `ORDER_CLOSED` payload for loyalty accrual
2. Call `POST /internal/crm/promotions/evaluate` before payment finalization
3. Call `GET /internal/crm/customers/lookup?phone=` at cashier lookup

### Integration tests
- `CrmLoyaltyIT` — accrual, dedup, tier upgrade, refund debit
- `PromotionEngineIT` — percent discount + outside-window zero

## Verification
Run: `mvn -pl services/crm-service -am verify` (requires JDK 25 + Maven + Docker)
