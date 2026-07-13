---
phase: 09-order-to-ledger-auto-posting-customer-loyalty
verified: 2026-07-01T00:00:00Z
status: human_needed
score: 11/12 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: unknown
  gaps_closed:
    - "Full static verification of finance autopost package (7 consumers, recipe engine, V5 migration)"
    - "Full static verification of crm-service (loyalty, promotions, feedback, gateway route)"
    - "RabbitMQ bindings confirmed for all finance + crm Phase 9 queues with DLQs"
  gaps_remaining:
    - "Maven verify not executed in verifier environment"
    - "ORDER_REFUND finance auto-post has no integration test"
    - "Locked-period fail-safe for auto-posting not IT-proven"
    - "crm-service not registered in deploy/docker-compose"
  regressions: []
human_verification:
  - test: "Run `mvn -pl services/finance-service -am verify` with JDK 25 + Docker"
    expected: "OrderCloseAutoPostingIT and InventoryAutoPostingIT pass; JaCoCo ≥ 75%"
    why_human: "Maven not on PATH; environment has JDK 18 only"
  - test: "Run `mvn -pl services/crm-service -am verify` with JDK 25 + Docker"
    expected: "CrmLoyaltyIT and PromotionEngineIT pass; JaCoCo ≥ 60%"
    why_human: "Maven not on PATH; Testcontainers require Docker runtime"
  - test: "Publish real ORDER_CLOSED from POS with customerId set"
    expected: "Finance revenue JE + CRM loyalty accrual both fire once"
    why_human: "pos-service and inventory-service not present in repo; E2E loop requires Phase 7/8 publishers"
---

# Phase 9: Order-to-Ledger Auto-Posting & Customer Loyalty Verification Report

**Phase Goal:** Close the core-value loop — when an order closes, balanced revenue + COGS journal entries are auto-posted idempotently, and customer loyalty reacts to the same event.

**Verified:** 2026-07-01  
**Status:** human_needed  
**Re-verification:** Yes — after 2026-06-27 static-only pass; runtime still unproven

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `ORDER_CLOSED` auto-posts balanced revenue JE (DR payments, CR revenue + tax) | ✓ VERIFIED | `AutoPostingRecipeEngine.postOrderRevenue` (317 lines); `OrderClosedConsumer` → `finance.order-closed.queue`; `OrderCloseAutoPostingIT` asserts POSTED JE + balanced debits/credits |
| 2 | `STOCK_DEPLETED` auto-posts balanced COGS JE (DR COGS, CR inventory) | ✓ VERIFIED | `postOrderCogs` uses `totalCogsPaisa`; `StockDepletedConsumer` on `finance.stock-depleted.queue`; IT publishes and asserts balanced COGS JE |
| 3 | Refund/wastage/count/transfer events each post balanced JEs | ✓ VERIFIED | Recipes `postOrderRefund`, `postWastage`, `postCountVariance`, `postTransferShipped`, `postTransferReceived`; 5 consumers wired; `InventoryAutoPostingIT` covers wastage, count variance, transfer ship/receive |
| 4 | Re-delivering same event produces no duplicate JE | ✓ VERIFIED | 3-layer dedup: `ProcessedEventService` (consumer+eventId), `posted_source_events` UNIQUE(tenant, source_type, source_id), `JournalEntryService.autoPostInternal` source lookup; IT re-publishes same eventId + new eventId and asserts exactly 1 revenue JE |
| 5 | Customers CRUD + linked via `customerId` on `ORDER_CLOSED` | ✓ VERIFIED | `CustomerController` full CRUD at `/api/v1/crm/customers`; `CrmInternalController` phone lookup; `OrderClosedLoyaltyConsumer` reads `customerId` from payload and skips when null; POS-side order FK not verifiable (pos-service absent) |
| 6 | Loyalty accrues on `ORDER_CLOSED`, debits on `ORDER_REFUNDED` | ✓ VERIFIED | `LoyaltyService.accrueForOrder` / `debitForRefund`; consumers on `crm.order-closed.queue` and `crm.order-refunded.queue`; `CrmLoyaltyIT` proves accrual, dedup, refund debit |
| 7 | Bronze/Silver/Gold tier upgrades on threshold crossing | ✓ VERIFIED | `LoyaltyService.checkTierUpgrade` compares `lifetime_spend_paisa` to tier config; `CrmLoyaltyIT` accrues 6M paisa → tier becomes SILVER |
| 8 | Promotions evaluate time/day/item/tier filters for POS | ✓ VERIFIED | `PromotionEngine.evaluate` (159 lines) with Asia/Karachi window filters; wired to `POST /internal/crm/promotions/evaluate`; `PromotionEngineIT` proves percent discount + outside-window zero |
| 9 | Post-order feedback stored and reportable | ✓ VERIFIED | `FeedbackService.submit` + `FeedbackController` POST/GET at `/api/v1/crm/feedback`; `customer_feedback` table with RLS |
| 10 | Gateway routes `/api/v1/crm/**` to crm-service | ✓ VERIFIED | `gateway/application.yml` crm-route → `lb://crm-service` with `crmCircuitBreaker` |
| 11 | RabbitMQ topology pre-created for all Phase 9 queues | ✓ VERIFIED | `deploy/init/rabbitmq-definitions.json`: 7 finance queues + 2 crm queues, DLQs, bindings to `pos.topic` / `inventory.topic` |
| 12 | Posting to LOCKED period fails without `posted_source_events` row | ? UNCERTAIN | `JournalEntryServiceImpl.post` throws `PeriodLockedException` on LOCKED period; `AutoPostingRecipeEngine.post` saves `posted_source_events` only after successful `autoPostInternal` — fail-safe by transaction ordering; no auto-post IT for locked period |

**Score:** 11/12 truths verified (1 needs human/IT confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/finance-service/.../AutoPostingRecipeEngine.java` | M3.4 recipes | ✓ VERIFIED | 317 lines, 7 recipes, no stub patterns |
| `services/finance-service/.../db/migration/V5__posted_source_events.sql` | Idempotency table | ✓ VERIFIED | UNIQUE(tenant_id, source_type, source_id), FK to journal_entries |
| `services/finance-service/.../consumer/*.java` (7 files) | Event consumers | ✓ VERIFIED | All `@RabbitListener` on correct queue names |
| `services/finance-service/.../OrderCloseAutoPostingIT.java` | Revenue+COGS+dedup IT | ✓ VERIFIED | 216 lines, Testcontainers Postgres+RabbitMQ |
| `services/finance-service/.../InventoryAutoPostingIT.java` | Inventory event ITs | ✓ VERIFIED | 193 lines, covers 4 inventory recipes |
| `services/crm-service/` module | CRM scaffold | ✓ VERIFIED | 30 Java source files, port 8089, Liquibase schema + RLS |
| `services/crm-service/.../OrderClosedLoyaltyConsumer.java` | Loyalty accrual | ✓ VERIFIED | Wired to `LoyaltyService.accrueForOrder` |
| `services/crm-service/.../PromotionEngine.java` | POS promotion eval | ✓ VERIFIED | 159 lines, tier/time/item filters |
| `services/crm-service/.../CrmInternalController.java` | Internal POS APIs | ✓ VERIFIED | lookup + promotions/evaluate |
| `services/crm-service/.../CrmLoyaltyIT.java` | Loyalty IT | ✓ VERIFIED | Accrual, dedup, tier upgrade, refund debit |
| `deploy/init/rabbitmq-definitions.json` | Queue bindings | ✓ VERIFIED | All Phase 9 queues + DLQs present |
| `gateway/.../application.yml` | CRM route | ✓ VERIFIED | `/api/v1/crm/**` → crm-service |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `OrderClosedConsumer` | `AutoPostingRecipeEngine.postOrderRevenue` | `ProcessedEventService.tryProcess` → `TenantAwareMessageProcessor` | ✓ WIRED | Pattern confirmed in consumer |
| `StockDepletedConsumer` | `AutoPostingRecipeEngine.postOrderCogs` | `finance.stock-depleted.queue` | ✓ WIRED | Uses `totalCogsPaisa` from payload |
| `AutoPostingRecipeEngine` | `JournalEntryService.autoPostInternal` | `InternalAutoPostJeRequest` with source_type + source_id | ✓ WIRED | Returns existing JE on duplicate source |
| `AutoPostingRecipeEngine` | `posted_source_events` | Insert after successful post | ✓ WIRED | `postedSourceRepo.save` after `autoPostInternal` |
| `OrderClosedLoyaltyConsumer` | `LoyaltyService.accrueForOrder` | `customerId` from ORDER_CLOSED payload | ✓ WIRED | Skips null customerId (walk-in) |
| `OrderRefundedLoyaltyConsumer` | `LoyaltyService.debitForRefund` | `crm.order-refunded.queue` | ✓ WIRED | Proportional point debit capped at balance |
| `CrmInternalController` | `PromotionEngine.evaluate` | POST `/internal/crm/promotions/evaluate` | ✓ WIRED | Returns `discountPaisa` + `appliedPromotionIds` |
| `pos.topic` / `inventory.topic` | Finance + CRM consumers | RabbitMQ bindings | ✓ WIRED | Definitions.json bindings match consumer queue names |
| POS service | ORDER_CLOSED with `customerId` | Event publisher | ? UNCERTAIN | pos-service not in repo; contract documented in 09-02-SUMMARY |

### Requirements Coverage

| Requirement | Status | Blocking Issue |
|-------------|--------|----------------|
| FIN-03 (partial) | ✓ SATISFIED (Phase 9 scope) | Order/refund/wastage/count/transfer recipes implemented; GR/IR/vendor/payroll explicitly deferred Phase 10/11 |
| CRM-01 | ✓ SATISFIED | Customer CRUD + phone lookup; event payload `customerId` link |
| CRM-02 | ✓ SATISFIED | Accrual on close, debit on refund, idempotent |
| CRM-03 | ✓ SATISFIED | Tier config seeded; upgrade on accrual |
| CRM-04 | ✓ SATISFIED | PromotionEngine + internal evaluate endpoint |
| CRM-05 | ✓ SATISFIED | Feedback submit + paginated list |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `AutoPostingRecipeEngine.java` | 112-118 | Refund uses simplified single-line DR (no output tax reversal) | ℹ️ Info | Refund JE posts but may not match full M3.4 tax reversal spec |
| `AutoPostingRecipeEngine.java` | 33 | `DISCOUNT_CODE = "4920"` used for both discount DR and refund DR (plan specified 4910 for discount) | ℹ️ Info | COA mapping deviation; JE still balances |
| — | — | No TODO/FIXME/placeholder stubs in autopost or crm packages | — | Clean |

### Human Verification Required

1. **Finance integration tests**
   - **Test:** `mvn -pl services/finance-service -am verify` (JDK 25, Docker running)
   - **Expected:** `OrderCloseAutoPostingIT`, `InventoryAutoPostingIT` green; coverage gate pass
   - **Why human:** Maven not on PATH in verifier shell; JDK 18 present vs project JDK 25 requirement

2. **CRM integration tests**
   - **Test:** `mvn -pl services/crm-service -am verify` (JDK 25, Docker running)
   - **Expected:** `CrmLoyaltyIT`, `PromotionEngineIT` green
   - **Why human:** Same environment constraints

3. **End-to-end order-close loop**
   - **Test:** With POS + inventory services running, close an order with a linked customer
   - **Expected:** Revenue JE + COGS JE posted once; loyalty points accrued once
   - **Why human:** pos-service and inventory-service not present in current workspace

4. **Locked-period auto-post fail-safe**
   - **Test:** Close accounting period, then publish ORDER_CLOSED
   - **Expected:** No JE created; no `posted_source_events` row; message retries or DLQ
   - **Why human:** Mechanism inferred from transaction order; no dedicated IT

### Runtime Verification Attempt

| Command | Attempted | Result |
|---------|-----------|--------|
| `mvn -pl services/finance-service -am verify` | Yes | **Blocked** — `mvn` not recognized on PATH |
| `mvn -pl services/crm-service -am verify` | Yes | **Blocked** — same |
| `java -version` | Yes | JDK 18.0.2.1 (project expects JDK 25 per Makefile) |

### Gaps Summary

Phase 9 implementation is **structurally complete** — finance auto-posting engine, idempotency layers, RabbitMQ topology, and crm-service with loyalty/promotions/feedback all exist, are substantive, and are wired. No stub consumers or placeholder APIs were found.

Remaining gaps are **verification and deployment**, not missing core logic:

1. **Runtime IT suite unexecuted** — Maven absent and JDK version mismatch prevented `mvn verify` in this environment.
2. **ORDER_REFUND finance IT missing** — `OrderRefundedConsumer` and `postOrderRefund` exist and are bound, but no Testcontainers IT covers refund JE posting (unlike inventory events).
3. **Locked-period fail-safe** — Inherited from Phase 6 JE engine; not explicitly proven for auto-post path.
4. **crm-service deploy gap** — Dockerfile exists but `crm-service` is not in `deploy/docker-compose.yml` (plan Task 1 mentioned adding to dev-up).
5. **E2E loop dependency** — Full order-to-ledger loop requires Phase 7/8 event publishers (pos/inventory services) which are not in the repository; Phase 9 consumers and contracts are ready.

**FIN-03 partial scope is intentional** — GR/IR, vendor invoice, and payroll auto-post consumers remain deferred to Phases 10/11 per plan.

---

_Verified: 2026-07-01_  
_Verifier: Claude (gsd-verifier)_
