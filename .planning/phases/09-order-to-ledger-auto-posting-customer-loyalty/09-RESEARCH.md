# Phase 9: Order-to-Ledger Auto-Posting & Customer Loyalty — Research

**Researched:** 2026-06-27  
**Domain:** Finance auto-posting consumers, recipe engine, CRM/loyalty microservice, event-driven idempotency  
**Confidence:** HIGH (spec M3.4/M9, Doc 02 event registry, existing finance-service seams verified)

---

## Summary

Phase 9 closes the **core-value loop**: POS `ORDER_CLOSED` → balanced revenue + COGS journal entries + loyalty accrual. Two plans:

- **09-01** — Extend **finance-service** (already exists, Phase 6 complete) with RabbitMQ consumers + `AutoPostingRecipeEngine` that resolves COA accounts by `system_tag` and posts via existing `JournalEntryService.autoPostInternal()`.
- **09-02** — Greenfield **crm-service** (port 8089, `crm_db`) for customers, loyalty, promotions, feedback; consumes `crm.order-closed.queue` and exposes POS lookup/promotion APIs.

**Do NOT** create a separate auto-posting microservice — spec M3.1: Finance is the financial source of truth; `finance.order-closed.queue` already targets Finance.

---

## Standard Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Auto-posting host | `finance-service` (8086) | Reuse `autoPostInternal`, COA, periods, triggers |
| CRM host | `crm-service` (8089) | New module per Doc 01 scaffold |
| Events | RabbitMQ + `EventEnvelope` | Doc 02; queues partially exist |
| Idempotency | `processed_events` + JE `(source_type, source_id)` | Add `posted_source_events` for FIN-03 spec alignment |
| Tenant context | `TenantAwareMessageProcessor` | Same as Phase 5 consumers |
| Account resolution | `ChartOfAccountRepository.findBySystemTag()` | CASH, REVENUE, OUTPUT_TAX, COGS, INVENTORY, etc. |
| CRM DB | PostgreSQL + RLS | Mirror user-service / notification patterns |
| Tests | Testcontainers Postgres + RabbitMQ | Publish envelope → assert JE rows + loyalty rows |

---

## Architecture Patterns

### Pattern 1 — Dual JE for order close (Revenue + COGS)

M3.4 defines **two** recipes for order close. Inventory and Finance consume `ORDER_CLOSED` **in parallel**, so COGS MAC is **not** available on the POS payload.

**Use two event hooks:**

| JE | Trigger | source_type | source_id |
|----|---------|-------------|-----------|
| Revenue | `ORDER_CLOSED` on `finance.order-closed.queue` | `ORDER_REVENUE` | orderId |
| COGS | `STOCK_DEPLETED` on new `finance.stock-depleted.queue` | `ORDER_COGS` | orderId |

`STOCK_DEPLETED` payload includes `totalCogsPaisa` (Doc 02). Inventory publishes after depletion (Phase 8).

Revenue recipe (M3.4):
- DR: Cash/Card/Loyalty (split by `payments[]` method → CASH/BANK system_tags)
- CR: Sales Revenue (4100/`REVENUE`) + Output Tax (2200/`OUTPUT_TAX`)
- Handle `discountPaisa` → DR Discounts Allowed (4910) if non-zero

COGS recipe:
- DR: COGS (5100/`COGS`) for `totalCogsPaisa`
- CR: Inventory (1300/`INVENTORY`) for same amount

### Pattern 2 — Idempotency (FIN-03 / SC2)

Three layers (defense in depth):

1. **Consumer:** `ProcessedEventService.tryProcess(consumerName, eventId, action)` — same as Phase 5
2. **Business:** `posted_source_events(tenant_id, source_type, source_id)` UNIQUE — insert before post; skip if exists
3. **JE:** `autoPostInternal` checks `journal_entries` by `(tenant_id, source_type, source_id)` — already in Phase 6

Record `posted_source_events` with `source_type` matching JE (`ORDER_REVENUE`, `ORDER_COGS`, `ORDER_REFUND`, etc.).

### Pattern 3 — Phase 9 vs deferred FIN-03 recipes

| Recipe | Phase | Queue (add if missing) |
|--------|-------|------------------------|
| Order revenue + COGS | **9** | `finance.order-closed`, `finance.stock-depleted` |
| Refund | **9** | `finance.order-refunded` → `pos.order.refunded` |
| Wastage | **9** | `finance.wastage` → `inventory.wastage.recorded` |
| Stock count variance | **9** | `finance.count-variance` → `inventory.count.variance` |
| Transfer ship/receive | **9** | `finance.transfer-shipped`, `finance.transfer-received` |
| GR/IR (goods receipt) | 10 | `finance.stock-received` (exists) |
| Vendor invoice / payment | 10 | `finance.invoice-matched` (exists) |
| Payroll | 11 | `finance.payroll-approved` (exists) |
| Expense | 10+ | defer — no queue yet |

### Pattern 4 — CRM event consumer

`OrderClosedLoyaltyConsumer` on `crm.order-closed.queue`:
- Skip if `customerId` null
- Accrue: `points = floor(totalPaisa / pointsPerPkr)` from tenant config
- Insert `loyalty_transactions` ACCRUAL
- Check tier thresholds → upgrade if needed
- Publish `LOYALTY_POINTS_EARNED` (optional, notifications Phase 5)

`OrderRefundedConsumer` on `crm.order-refunded.queue` (new binding):
- Debit loyalty points proportionally

### Pattern 5 — Promotion engine POS contract

Internal APIs for POS (Phase 7 calls via gateway or Feign):

```
POST /internal/crm/promotions/evaluate
  { branchId, customerId?, items[], subtotalPaisa, at: ISO8601 }
  → { discountPaisa, appliedPromotionIds[], lineAdjustments[] }

GET /internal/crm/customers/lookup?phone=+92...
  → { customerId, name, tier, pointsBalance, eligiblePromotions[] }
```

Public CRM CRUD at `/api/v1/crm/customers/**`, `/api/v1/crm/promotions/**`, `/api/v1/crm/feedback/**`.

---

## Don't Hand-Roll

| Problem | Use instead |
|---------|-------------|
| Custom JE posting | `JournalEntryService.autoPostInternal()` |
| Custom balance check | Existing deferred trigger (Phase 6) |
| Custom tenant propagation | `TenantAwareMessageProcessor` |
| Custom consumer dedup | `ProcessedEventService` + `processed_events` |
| Hard-coded account codes | `system_tag` lookup on `chart_of_accounts` |
| Loyalty math in POS | CRM service owns accrual rules |

---

## Common Pitfalls

1. **COGS on ORDER_CLOSED only** — MAC not ready; use `STOCK_DEPLETED` for COGS JE.
2. **Single source_type per order** — Revenue and COGS need distinct `source_type` values.
3. **Period lock** — Call `GET /internal/finance/periods/status` or use in-process `AccountingPeriodService` before post; expect 423 on LOCKED period.
4. **Payment method → account mapping** — CASH→1010/CASH, CARD→1100/BANK, LOYALTY_POINTS→2400/Loyalty Liability (account 2400 per seed doc 11).
5. **Missing RabbitMQ bindings** — Wastage/transfer/refund/depleted queues NOT in definitions.json yet; Phase 9 must add them.
6. **CRM without customerId** — Walk-in orders skip loyalty; IT must cover both paths.
7. **Promotion timezone** — Use branch timezone or tenant default for day/hour rules (store `ZoneId` on branch or tenant settings).

---

## Code Examples

### Recipe engine sketch

```java
@Service
public class AutoPostingRecipeEngine {
  public void postOrderRevenue(EventEnvelope<Map<String,Object>> env) {
    var p = env.payload();
    UUID orderId = uuid(p, "orderId");
    if (postedSourceRepo.exists(tenantId(), "ORDER_REVENUE", orderId)) return;

    List<CreateJeLineRequest> lines = new ArrayList<>();
    // DR payment splits from p.get("payments")
    // CR revenue + output tax from subtotalPaisa, taxPaisa, discountPaisa
    postedSourceRepo.insert("ORDER_REVENUE", orderId);
    jeService.autoPostInternal(new InternalAutoPostJeRequest(
        branchId, entryDate, "Order " + p.get("orderNo"), "ORDER_REVENUE", orderId, lines));
  }
}
```

### Consumer pattern

```java
@RabbitListener(queues = "finance.order-closed.queue")
public void onOrderClosed(Message msg) {
  var env = parseEnvelope(msg);
  processedEvents.tryProcess("finance.order-closed", env.eventId(), () ->
    tenantProcessor.process(env, recipeEngine::postOrderRevenue));
}
```

---

## CRM Schema (prescriptive)

```sql
-- customers (RLS)
customers(id, tenant_id, phone UNIQUE per tenant, name, email, birthday, cnic_encrypted, created_at)

-- loyalty_accounts (RLS, 1:1 customer)
loyalty_accounts(id, tenant_id, customer_id, points_balance BIGINT, tier VARCHAR, lifetime_spend_paisa BIGINT)

-- loyalty_transactions (RLS, append-only)
loyalty_transactions(id, tenant_id, customer_id, order_id, type ACCRUAL|DEBIT|REDEMPTION, points BIGINT, created_at)

-- loyalty_tier_config (RLS, seeded per tenant)
loyalty_tier_config(tenant_id, tier, min_lifetime_spend_paisa, points_multiplier)

-- promotions (RLS)
promotions(id, tenant_id, name, discount_type PERCENT|FIXED, discount_value, start_at, end_at, days_of_week[], hours_start, hours_end, tier_filter[], menu_item_ids[], is_active)

-- customer_feedback (RLS)
customer_feedback(id, tenant_id, customer_id, order_id, rating INT, comment TEXT, created_at)

-- processed_events (NON-RLS)
```

Seed default tier thresholds: Bronze 0, Silver 50_000_00 paisa (PKR 50k), Gold 200_000_00 paisa.

---

## Test Strategy

**09-01 AutoPostingIT:**
- Publish `ORDER_CLOSED` → assert 1 revenue JE balanced, `posted_source_events` row
- Publish same eventId again → no duplicate JE
- Publish `STOCK_DEPLETED` with totalCogsPaisa → COGS JE balanced
- Publish `ORDER_REFUNDED` → reversal-style refund JE
- Publish to LOCKED period → consumer logs/skips or DLQ (document behavior)

**09-02 CrmLoyaltyIT:**
- Create customer → lookup by phone
- Publish `ORDER_CLOSED` with customerId → points accrued, tier upgraded when threshold crossed
- Publish refund → points debited
- Evaluate promotion → discount returned for matching tier/item/time

---

## Primary Recommendation

Extend finance-service in-place for auto-posting; scaffold crm-service as new module. Add missing inventory/POS finance+crm queue bindings to `rabbitmq-definitions.json`. Split order close into revenue (ORDER_CLOSED) and COGS (STOCK_DEPLETED) consumers. Add `posted_source_events` table for explicit FIN-03 compliance alongside existing JE idempotency.
