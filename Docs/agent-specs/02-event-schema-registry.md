# RestaurantOS — Document 2: Event Schema Registry

> Single source of truth for every RabbitMQ event. Inter-service communication depends on exact agreement here. Every event uses the common envelope; payloads are defined per event type. All money is integer paisa; all timestamps are ISO8601 UTC.

## 2.1 Event Envelope (Base Structure)

Every message published to any exchange is an `EventEnvelope`:

| Field | Type | Required | Description |
|---|---|---|---|
| `eventId` | UUID (v7) | yes | Unique per event; used for consumer idempotency |
| `eventType` | string enum | yes | e.g. `ORDER_CLOSED` |
| `tenantId` | UUID | yes | Owning tenant; consumers set RLS from this |
| `branchId` | UUID | no | Branch scope; null for tenant-wide events |
| `occurredAt` | ISO8601 UTC | yes | When the event occurred |
| `correlationId` | UUID | yes | Trace id propagated across the causal chain |
| `schemaVersion` | int | yes | Starts at 1; bump on breaking payload change |
| `source` | string enum | yes | Emitting service, e.g. `POS_SERVICE` |
| `payload` | object | yes | Event-type-specific body |

Example:

```json
{
  "eventId": "018f3a2b-7c10-7e3a-9f21-2a1b3c4d5e6f",
  "eventType": "ORDER_CLOSED",
  "tenantId": "11111111-1111-1111-1111-111111111111",
  "branchId": "22222222-2222-2222-2222-222222222222",
  "occurredAt": "2026-04-29T08:15:30Z",
  "correlationId": "33333333-3333-3333-3333-333333333333",
  "schemaVersion": 1,
  "source": "POS_SERVICE",
  "payload": { "orderId": "..." }
}
```

## 2.2 RabbitMQ Topology

Exchanges (all `topic`, `durable=true`, `auto_delete=false`):

| Exchange | Emitting service |
|---|---|
| `pos.topic` | POS |
| `inventory.topic` | Inventory |
| `finance.topic` | Finance |
| `purchasing.topic` | Purchasing |
| `hr.topic` | HR |
| `auth.topic` | Auth |
| `platform.topic` | Platform Admin |
| `kitchen.topic` | Kitchen |
| `notifications.topic` | Notification |
| `restaurantos.dlx` | (dead-letter exchange) |

Representative queues (each `durable`, bound with `x-dead-letter-exchange=restaurantos.dlx` and a `.dlq` sibling):

| Queue | Source exchange | Routing key | Consumer |
|---|---|---|---|
| `inventory.order-closed.queue` | `pos.topic` | `pos.order.closed` | Inventory (depletion) |
| `finance.order-closed.queue` | `pos.topic` | `pos.order.closed` | Finance (auto-posting) |
| `crm.order-closed.queue` | `pos.topic` | `pos.order.closed` | CRM (loyalty) |
| `reporting.order-closed.queue` | `pos.topic` | `pos.order.closed` | Reporting (sales facts) |
| `kitchen.order-sent.queue` | `pos.topic` | `pos.order.sent_to_kds` | Kitchen (KDS routing) |
| `finance.stock-received.queue` | `inventory.topic` | `inventory.stock.received` | Finance (GR/IR) |
| `notification.low-stock.queue` | `inventory.topic` | `inventory.stock.low` | Notification |
| `finance.invoice-matched.queue` | `purchasing.topic` | `purchasing.invoice.matched` | Finance (AP) |
| `finance.payroll-approved.queue` | `hr.topic` | `hr.payroll.approved` | Finance (wages) |
| `audit.all-events.queue` | all topics | `#` | Audit (immutable log) |

Per-queue DLQ pattern: declare `{queue}` with `x-dead-letter-exchange=restaurantos.dlx` and `x-dead-letter-routing-key={queue}.dlq`; declare `{queue}.dlq`; bind `{queue}.dlq` to `restaurantos.dlx` with routing key `{queue}.dlq`.

## 2.3 Complete Event Schemas (by domain)

### POS events (`pos.topic`)

`ORDER_CREATED` (`pos.order.created`)
```json
{ "orderId": "UUID", "orderNo": "string", "type": "DINE_IN|TAKEAWAY|DELIVERY", "tableId": "UUID|null", "cashierId": "UUID", "tillSessionId": "UUID" }
```

`ORDER_SENT_TO_KDS` (`pos.order.sent_to_kds`)
```json
{ "orderId": "UUID", "items": [{ "orderItemId": "UUID", "menuItemId": "UUID", "name": "string", "qty": 1, "kdsStation": "GRILL", "modifiers": ["string"], "notes": "string|null" }] }
```

`ORDER_CLOSED` (`pos.order.closed`)
```json
{
  "orderId": "UUID", "orderNo": "string", "type": "DINE_IN|TAKEAWAY|DELIVERY",
  "customerId": "UUID|null",
  "subtotalPaisa": 80000, "discountPaisa": 0, "serviceChargePaisa": 0, "taxPaisa": 5600, "totalPaisa": 85600,
  "payments": [{ "method": "CASH|CARD|WALLET", "amountPaisa": 85600, "referenceNo": "string|null" }],
  "items": [{ "menuItemId": "UUID", "name": "string", "qty": 1, "unitPricePaisa": 80000, "lineTotalPaisa": 80000 }],
  "tillSessionId": "UUID", "cashierId": "UUID", "closedAt": "ISO8601"
}
```

`ORDER_VOIDED` (`pos.order.voided`)
```json
{ "orderId": "UUID", "reason": "string", "voidedBy": "UUID" }
```

`ORDER_REFUNDED` (`pos.order.refunded`)
```json
{ "orderId": "UUID", "refundPaisa": 85600, "reason": "string", "refundedBy": "UUID" }
```

`TILL_OPENED` (`pos.till.opened`)
```json
{ "tillSessionId": "UUID", "openingFloatPaisa": 500000, "cashierId": "UUID" }
```

`TILL_CLOSED` (`pos.till.closed`)
```json
{ "tillSessionId": "UUID", "expectedCashPaisa": 1200000, "countedCashPaisa": 1195000, "variancePaisa": -5000, "cashierId": "UUID" }
```

### Inventory events (`inventory.topic`)

`STOCK_RECEIVED` (`inventory.stock.received`)
```json
{ "grnId": "UUID", "poId": "UUID|null", "lines": [{ "ingredientId": "UUID", "qty": 10.0, "unitCostPaisa": 45000 }] }
```

`STOCK_DEPLETED` (`inventory.stock.depleted`)
```json
{ "orderId": "UUID", "lines": [{ "ingredientId": "UUID", "qty": 0.8, "cogsPaisa": 36000 }], "totalCogsPaisa": 36000 }
```

`LOW_STOCK_ALERT` (`inventory.stock.low`)
```json
{ "ingredientId": "UUID", "name": "string", "qtyOnHand": 3.5, "reorderPoint": 5.0 }
```

`EXPIRY_ALERT` (`inventory.stock.expiry`)
```json
{ "ingredientId": "UUID", "lotId": "UUID", "expiresOn": "ISO8601-date", "qty": 2.0 }
```

`COUNT_VARIANCE_POSTED` (`inventory.count.variance`)
```json
{ "countId": "UUID", "lines": [{ "ingredientId": "UUID", "systemQty": 10.0, "countedQty": 9.5, "varianceQty": -0.5, "variancePaisa": -22500 }] }
```

`WASTAGE_RECORDED` (`inventory.wastage.recorded`)
```json
{ "wastageId": "UUID", "ingredientId": "UUID", "qty": 1.0, "costPaisa": 45000, "reason": "SPOILAGE" }
```

`TRANSFER_SHIPPED` (`inventory.transfer.shipped`)
```json
{ "transferId": "UUID", "fromBranchId": "UUID", "toBranchId": "UUID", "lines": [{ "ingredientId": "UUID", "qty": 5.0, "costPaisa": 225000 }] }
```

`TRANSFER_RECEIVED` (`inventory.transfer.received`)
```json
{ "transferId": "UUID", "toBranchId": "UUID", "lines": [{ "ingredientId": "UUID", "qtyReceived": 5.0 }] }
```

`TRANSFER_VARIANCE` (`inventory.transfer.variance`)
```json
{ "transferId": "UUID", "lines": [{ "ingredientId": "UUID", "qtyShipped": 5.0, "qtyReceived": 4.8, "varianceQty": -0.2, "variancePaisa": -9000 }] }
```

### Finance events (`finance.topic`)

`JOURNAL_POSTED` (`finance.journal.posted`)
```json
{ "jeId": "UUID", "entryNo": "string", "sourceType": "ORDER|GRN|PAYROLL", "sourceId": "UUID", "totalDebitPaisa": 85600, "totalCreditPaisa": 85600 }
```

`PERIOD_CLOSED` (`finance.period.closed`)
```json
{ "periodId": "UUID", "fiscalYear": 2026, "periodNo": 10, "closedBy": "UUID" }
```

`AP_PAYMENT_PROCESSED` (`finance.ap.payment_processed`)
```json
{ "paymentId": "UUID", "vendorId": "UUID", "amountPaisa": 500000, "method": "BANK_TRANSFER" }
```

`EXPENSE_APPROVED` (`finance.expense.approved`)
```json
{ "expenseId": "UUID", "amountPaisa": 250000, "approvedBy": "UUID" }
```

### Purchasing events (`purchasing.topic`)

`PO_APPROVED` (`purchasing.po.approved`)
```json
{ "poId": "UUID", "vendorId": "UUID", "totalPaisa": 5000000, "approvedBy": "UUID" }
```

`VENDOR_INVOICE_MATCHED` (`purchasing.invoice.matched`)
```json
{ "invoiceId": "UUID", "poId": "UUID", "grnId": "UUID", "amountPaisa": 5000000, "inputTaxPaisa": 650000, "matchStatus": "MATCHED|VARIANCE" }
```

### HR events (`hr.topic`)

`PAYROLL_RUN_APPROVED` (`hr.payroll.approved`)
```json
{ "payrollRunId": "UUID", "periodLabel": "2026-04", "grossPaisa": 50000000, "taxPaisa": 5000000, "netPaisa": 45000000 }
```

`PAYROLL_RUN_PAID` (`hr.payroll.paid`)
```json
{ "payrollRunId": "UUID", "paidPaisa": 45000000, "method": "BANK_TRANSFER" }
```

`EMPLOYEE_JOINED` / `EMPLOYEE_LEFT` (`hr.employee.joined` / `hr.employee.left`)
```json
{ "employeeId": "UUID", "effectiveDate": "ISO8601-date" }
```

### Auth events (`auth.topic`)

`USER_LOGIN_SUCCEEDED` / `USER_LOGIN_FAILED` / `USER_LOCKED` (`auth.user.*`)
```json
{ "userId": "UUID|null", "email": "string", "ip": "string" }
```

`RBAC_CHANGED` (`auth.rbac.changed`)
```json
{ "userId": "UUID", "roleCodes": ["string"], "changedBy": "UUID" }
```

`IMPERSONATION_STARTED` / `IMPERSONATION_ENDED` (`auth.impersonation.*`)
```json
{ "targetUserId": "UUID", "superAdminId": "UUID" }
```

### Platform events (`platform.topic`)

`TENANT_PROVISIONED` / `TENANT_SUSPENDED` / `TENANT_REACTIVATED` / `TENANT_CANCELLED` (`platform.tenant.*`)
```json
{ "tenantId": "UUID", "tier": "STARTER|GROWTH|ENTERPRISE" }
```

`QUOTA_WARNING` / `QUOTA_EXCEEDED` (`platform.quota.*`)
```json
{ "tenantId": "UUID", "resource": "NLQ_QUERIES", "used": 480, "limit": 500 }
```

### Kitchen events (`kitchen.topic`)

`ORDER_READY` (`kitchen.order.ready`)
```json
{ "orderId": "UUID", "station": "GRILL", "readyAt": "ISO8601" }
```

## 2.4 Consumer Idempotency Pattern

Every consumer records processed event ids in a `processed_events` table and skips duplicates. Processing and recording happen in the SAME transaction.

`processed_events` schema:

| Column | Type | Notes |
|---|---|---|
| `consumer` | TEXT | consumer name, e.g. `inventory.depletion` |
| `event_id` | UUID | from envelope |
| `source_type` | TEXT | optional source entity type |
| `source_id` | UUID | optional source entity id |
| `processed_at` | TIMESTAMPTZ | default NOW() |

Primary key `(consumer, event_id)`.

Pseudocode:

```
@Transactional
process(envelope):
    if alreadyProcessed(consumer, envelope.eventId): return     # idempotent skip
    doBusinessLogic(envelope.payload)
    recordProcessed(consumer, envelope.eventId)                 # same tx
```

## 2.5 DLQ Handling Policy

- Listener retry: 3 attempts, exponential backoff (initial 2s, multiplier 2, max 10s), `stateless=true`.
- On final failure the message is rejected (`default-requeue-rejected=false`) and dead-lettered to `restaurantos.dlx` → `{queue}.dlq`.
- DLQ depth is monitored in Grafana; an alert fires when any `.dlq` depth > 0.
- Resolution is manual: inspect, fix root cause, and replay from the DLQ. Never auto-requeue indefinitely.
