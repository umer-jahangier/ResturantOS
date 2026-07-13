# Phase 10: Purchasing & Accounts Payable — Research

**Researched:** 2026-07-01  
**Domain:** Vendor master, PO approval workflow, three-way match, AP payment, spend analytics — Spring Boot 4 microservice + finance auto-post integration  
**Confidence:** HIGH (spec M4, US-5, FD-8, finance auto-post API, permission catalogue verified against repo)

---

## Summary

Phase 10 delivers `purchasing-service` (port **8087**, `purchasing_db`) — the procurement module that every restaurant tenant uses for vendor management, purchase orders, vendor invoicing, three-way match, and AP payments. Finance auto-posting (Phase 6) already exposes `POST /internal/finance/journal-entries` with idempotent `sourceType` + `sourceId`; purchasing must call it for vendor-invoice match (GR/IR → AP) and AP payment (AP → Bank).

**Phase 8 is NOT an execution blocker.** ROADMAP lists Inventory as a logical dependency, but Phase 10 executes **mock-first**: purchasing simulates GRN receipt, `STOCK_RECEIVED`, and GR/IR on receipt using in-service mock data + real finance auto-post. When Phase 8 ships, flip `restaurantos.inventory.integration-mode` from `mock` → `feign` — same contracts, no purchasing logic rewrite.

Two plans:
- **10-01 (wave 1):** Service scaffold, vendor master, PO lifecycle, OPA approval, **mock GRN schema + config foundation**.
- **10-02 (wave 2):** **Mock GRN receipt simulator** (full PO→receive→invoice→pay), vendor invoices + three-way match, AP payments, analytics, FIN-05, frontend + MSW fixtures. See `10-MOCK-FIXTURES.md`.

---

## Standard Stack

| Layer | Use | Notes |
|-------|-----|-------|
| Java 25 + Spring Boot 4 | purchasing-service | Mirror `finance-service` structure |
| Flyway | `purchasing_db` migrations | Liquibase NOT used in finance — stay consistent |
| PostgreSQL 18 + RLS | All tenant tables | `tenant_id` via GUC; never client-supplied |
| shared-lib | TenantContext, MoneyUtils, EncryptionService, OpaClient, DomainEventPublisher, IdempotencyService | `@RequiresFeature("FEATURE_VENDOR")` |
| OpenFeign | finance auto-post, authz authorize, inventory GRN summary | FeignSharedConfig from shared-lib |
| RabbitMQ | `PO_APPROVED`, `VENDOR_INVOICE_MATCHED`, consume nothing critical in 10 | Outbox via DomainEventPublisher |
| MapStruct + Lombok | DTO mapping | Same as finance-service |
| Next.js 16 frontend | Four-layer abstraction | Zod → adapter → repository → hook → component |
| Testcontainers | IT suite | Colima: `TESTCONTAINERS_RYUK_DISABLED=true` |

---

## Architecture Patterns

### Service ownership split (do NOT merge into finance)

| Concern | Owner | Phase |
|---------|-------|-------|
| Vendor master, PO, vendor invoice, match, AP payment | purchasing-service | 10 |
| GRN record + stock qty update + `STOCK_RECEIVED` event | inventory-service (Phase 8) **OR mock layer in purchasing (Phase 10 default)** | 8 / 10-mock |
| GR/IR JE on goods receipt | finance auto-post — triggered by mock simulator or Phase 8 consumer | 10-mock / 8 |
| GR/IR → AP JE on invoice match | purchasing → finance auto-post | 10 |
| AP → Bank JE on payment | purchasing → finance auto-post | 10 |
| AP/AR balance reads | finance-service (FIN-05) | 10-02 extends finance |

### PO state machine (spec M4.2 + FD-8)

```
DRAFT → PENDING_APPROVAL → APPROVED → SENT → PARTIALLY_RECEIVED → FULLY_RECEIVED → CLOSED
              ↓
           REJECTED → (revise) → DRAFT
```

Status transitions driven by: submit, approve/reject (OPA), send-to-vendor, GRN progress (from inventory callback or Feign poll), manual close.

### OPA approval (US-5.3)

Before approve action: `POST /internal/authorize` with action `vendor.po.approve`, resource `{ amount_paisa, branch_id }`. Policy checks `expense.amount <= user.attributes.approval_limit_paisa`. Multi-tier: PO total vs tenant-configured thresholds determines required approvers (`tier1`, `tier2`); status stays `PENDING_APPROVAL` until all tiers satisfied.

Use permissions from Appendix B: `vendor.po.approve.tier1|tier2|tier3` (auth DB already has `vendor.manage`, `vendor.po.approve` — extend changelog in 10-01 if tier permissions missing).

### Finance auto-post recipes (M3.4 — purchasing triggers)

| Trigger | DR | CR | sourceType |
|---------|----|----|------------|
| Vendor invoice MATCHED | GR/IR (1700) + Input Tax (1710) | AP (2100) | `VENDOR_INVOICE` |
| Vendor payment | AP (2100) | Bank (1100) | `AP_PAYMENT` |

Call `POST /internal/finance/journal-entries` with `X-Tenant-Id` header. Resolve account codes via `system_tag` (`GR_IR`, `INPUT_TAX`, `AP`, `BANK`) — same pattern as Phase 6 COA seed.

**Idempotency:** `(tenant_id, source_type, source_id)` in finance `posted_source_events` — pass invoice ID / payment ID as `sourceId`.

### Three-way match (M4.3 — implement verbatim logic)

Per invoice line: find PO line → sum GRN qty for PO line (from inventory) → compare qty/price vs tenant tolerances.

Default tolerances: qty_over 0%, qty_under 5%, price_over 2%, price_under 10% — store in `tenant_match_tolerances` table.

Overall invoice status: all lines OK → `MATCHED`; any fail → `MISMATCHED`; override with `vendor.invoice.override_match` + mandatory justification → `APPROVED_FOR_PAYMENT`.

### Internal endpoints (period close — replace finance stub)

Finance `PurchasingInternalClient` currently calls:
- `GET /internal/invoices/unmatched-count?periodEnd=`

Agent-spec 04 also documents (align both in 10-02):
- `GET /internal/purchasing/branches/{branchId}/open-receipts`
- `GET /internal/purchasing/branches/{branchId}/pending-match-invoices?olderThanHours=48`

**Decision:** Implement all three; update finance Feign client paths to match agent-spec (breaking change from Phase 6 stub path — acceptable, stub was TODO).

### Mock-first inventory integration (Phase 10 default)

**Config:** `restaurantos.inventory.integration-mode: mock | feign`  
Default `mock` in `application.yml`, `application-dev.yml`, and test profile.

| Mode | GRN source | Receipt flow |
|------|------------|--------------|
| `mock` | `mock_grn_receipts` table in `purchasing_db` + `MockGrnAdapter` | `GrnReceiptSimulator` in purchasing-service |
| `feign` | `InventoryGrnClient` → inventory-service (Phase 8) | inventory-service owns receipt |

**Mock GRN table** (`mock_grn_receipts`): po_id, po_line_id, grn_id, received_qty, received_at, idempotency_key — tenant-scoped RLS.

**Mock receive API** (dev/test + IT):  
`POST /api/v1/purchasing/purchase-orders/{poId}/mock-receive`  
Body: `{ lines: [{ poLineId, receivedQty }] }`  
Guard: only when `integration-mode=mock`; returns 404 in `feign` mode.

**GrnReceiptSimulator** (on mock receive):
1. Upsert `mock_grn_receipts`
2. Transition PO → `PARTIALLY_RECEIVED` or `FULLY_RECEIVED`
3. Publish `STOCK_RECEIVED` (outbox, schema-compliant payload)
4. Call finance `POST /internal/finance/journal-entries` — DR Inventory (1300) / CR GR/IR (1700), `sourceType=GRN`, idempotent on `grnId`

**Three-way match** reads GRN via `GrnDataPort` interface — implemented by `MockGrnAdapter` (mock mode) or `InventoryGrnClientAdapter` (feign mode).

**Future Feign contract** (Phase 8 must match):
```
GET /internal/inventory/po-lines/{poLineId}/grn-summary
→ { receivedQty, receivedAt, grnId, orderedQty, expectedDeliveryDate }
```

Fixture scenarios F1–F7: see `10-MOCK-FIXTURES.md`.

---

## Data Model (purchasing_db)

All tables: `tenant_id UUID NOT NULL`, RLS policy `tenant_id = current_setting('app.current_tenant_id')::uuid`, extend `TenantAuditableEntity`.

| Table | Purpose |
|-------|---------|
| `vendors` | name, contact, phone, email, address, payment_terms, ntn, strn, lead_time_days, bank_account_no (encrypted), notes, active |
| `vendor_catalogues` | vendor_id, ingredient_id (UUID ref, no FK cross-DB), unit_price_paisa, valid_from, valid_to |
| `purchase_orders` | vendor_id, branch_id, status, expected_delivery_date, total_paisa, notes, requester_id, submitted_at |
| `purchase_order_lines` | po_id, ingredient_id, qty, uom, unit_price_paisa, line_total_paisa |
| `po_approval_records` | po_id, tier, approver_id, action APPROVED/REJECTED, reason, acted_at |
| `po_approval_tiers` | tenant config: tier_no, min_amount_paisa, max_amount_paisa, required_role |
| `tenant_match_tolerances` | qty_over_pct, qty_under_pct, price_over_pct, price_under_pct (one row per tenant) |
| `vendor_invoices` | vendor_id, branch_id, po_id, invoice_no, invoice_date, due_date, status, total_paisa, input_tax_paisa, override_reason |
| `vendor_invoice_lines` | invoice_id, po_line_id, qty, unit_price_paisa, line_total_paisa, match_status |
| `ap_payments` | vendor_id, branch_id, payment_date, method, bank_account_code, total_paisa, idempotency_key |
| `ap_payment_allocations` | payment_id, invoice_id, amount_paisa |

Money: **BIGINT paisa** everywhere. PO/invoice totals denormalized, recomputed on line change in same transaction.

---

## Event Contracts

Publish via `DomainEventPublisher` (outbox):

| Event | When | Payload (per 02-event-schema-registry) |
|-------|------|----------------------------------------|
| `PO_APPROVED` | PO reaches APPROVED | poId, vendorId, totalPaisa, approvedBy |
| `VENDOR_INVOICE_MATCHED` | Match succeeds or override | invoiceId, poId, grnId?, amountPaisa, inputTaxPaisa, matchStatus |
| `AP_PAYMENT_PROCESSED` | Payment saved | paymentId, vendorId, amountPaisa, method |

Finance publishes `JOURNAL_POSTED` — purchasing does not duplicate.

---

## Don't Hand-Roll

| Problem | Use instead |
|---------|-------------|
| Field encryption for bank account | `EncryptionService` from shared-lib (Phase 2 pattern for totp_secret) |
| Approval limit checks | OPA via authorization-service — never inline if/else on role alone |
| Idempotent payment | `IdempotencyService` + `Idempotency-Key` header |
| Balanced JE | finance deferred trigger — never post unbalanced lines from purchasing |
| Tenant isolation | Hibernate filter + RLS — never trust `tenantId` from request body |
| Match tolerance math | Spec algorithm in M4.3 — copy structure, use BigDecimal for qty ratios |
| Frontend API access | Four-layer stack — ESLint blocks components importing api-client |

---

## Common Pitfalls

1. **Forgetting to gate mock receive API** — `mock-receive` must 404 when `integration-mode=feign`; never expose mock paths in production config without explicit override.
2. **Cross-DB FKs** — `ingredient_id` is logical reference to inventory_db; validate via Feign on PO line create when inventory exists.
3. **Double GL post** — GR/IR on receipt (inventory event) AND on invoice match must not duplicate; invoice match DRs GR/IR (clears clearing), CRs AP — receipt already DR Inventory CR GR/IR.
4. **Feign path drift** — finance stub uses `/internal/invoices/unmatched-count`; agent-spec uses branch-scoped paths — reconcile in 10-02.
5. **Permission gap** — sidebar uses `FEATURE_VENDOR` only; wire `vendor.po.view`, `vendor.invoice.book`, etc. from Appendix B in `@PreAuthorize` / PermissionGuard.
6. **Period locked** — finance returns 423 on auto-post if period LOCKED; purchasing must surface `PERIOD_LOCKED` on invoice match/payment.
7. **Partial payment** — invoice status `PARTIALLY_PAID`; allocation table tracks remaining AP per invoice.

---

## Frontend (§8.4 + four-layer pattern)

Routes under `frontend/app/(tenant)/app/purchasing/` (sidebar already points to `/app/purchasing`):

| Page | Purpose |
|------|---------|
| `/purchasing/vendors` | Vendor list + create/edit |
| `/purchasing/purchase-orders` | PO list, create, submit, approve |
| `/purchasing/purchase-orders/[id]` | PO detail + approval actions |
| `/purchasing/invoices` | Invoice list |
| `/purchasing/invoices/[id]` | Three-way match UI — PO \| GRN \| Invoice columns, green/amber/red (§8.4) |
| `/purchasing/payments` | Payment run |
| `/purchasing/analytics` | Scorecard + spend by vendor/category |

Mirror finance: `lib/api-client/schemas/purchasing.schema.ts`, `lib/adapters/purchasing.adapter.ts`, `lib/repositories/purchasing.repository.ts`, `lib/hooks/purchasing/*.ts`, `components/purchasing/*`.

---

## FIN-05 (AP/AR — finance-service extension in 10-02)

Add to finance-service (small scope, same plan wave 2):
- `GET /api/v1/finance/ap/aging?branchId=` — buckets 0-30, 31-60, 61-90, 90+
- `GET /api/v1/finance/ap/balances` — vendor AP totals from posted JEs on account 2100
- `GET /api/v1/finance/ar/balances` — AR on account 1200 (read-only; AR collection is later)
- Expense approval: `POST /api/v1/finance/expenses` + OPA `finance.expense.approve` — minimal expense entity if not present

---

## Gateway & Feature Flag

Add to `RouteFeatureMap`:
```java
PREFIX_TO_FEATURE.put("/api/v1/purchasing/", "FEATURE_VENDOR");
```

Register Eureka service `purchasing-service`, gateway route `/api/v1/purchasing/**` → upstream, docker-compose service entry, `pom.xml` module, `coverage-gates.json` entry (≥60% default).

---

## Code Examples

### Finance auto-post from purchasing (invoice matched)

```java
InternalAutoPostJeRequest req = new InternalAutoPostJeRequest(
    branchId, invoiceDate, "Vendor invoice " + invoiceNo,
    "VENDOR_INVOICE", invoiceId,
    List.of(
        new CreateJeLineRequest("1700", "GR/IR Clearing", netPaisa, 0L),
        new CreateJeLineRequest("1710", "Input Tax", inputTaxPaisa, 0L),
        new CreateJeLineRequest("2100", "Accounts Payable", 0L, totalPaisa)
    ));
financeClient.autoPost(tenantId, req);
```

### OPA check before PO approve

```java
OpaDecision decision = opaClient.authorize(AuthorizeRequest.builder()
    .action("vendor.po.approve")
    .resource(Map.of("amount_paisa", po.getTotalPaisa(), "branch_id", po.getBranchId()))
    .build());
if (!decision.allowed()) throw new ForbiddenException("APPROVAL_LIMIT_EXCEEDED");
```

---

## Plan Structure Recommendation

| Plan | Wave | Depends | Scope |
|------|------|---------|-------|
| 10-01 | 1 | Phase 6 | Scaffold, vendors, catalogue, PO CRUD + submit + OPA approval + PO_APPROVED event + vendor/PO APIs + gateway |
| 10-02 | 2 | 10-01 | Mock GRN simulator + full PO→receive→invoice→pay, invoices, match, payments, analytics, finance AP aging, MSW fixtures, frontend |

---

## RESEARCH COMPLETE
