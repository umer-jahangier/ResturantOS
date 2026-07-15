# 09-01 Summary — Finance Auto-Posting Engine

**Completed:** 2026-06-27  
**Plan:** 09-01 (finance-service extension)

## Delivered

### Schema
- `V5__posted_source_events.sql` — `posted_source_events(tenant_id, source_type, source_id, je_id)` with UNIQUE constraint (NON-RLS)

### Auto-posting package (`io.restaurantos.finance.autopost`)
| Component | Purpose |
|-----------|---------|
| `AccountResolver` | Resolve COA codes by `system_tag` or fixed code |
| `ProcessedEventService` | Consumer dedup via `processed_events` |
| `AutoPostingRecipeEngine` | M3.4 recipe implementations |
| `PostedSourceEventRepository` | Business-level idempotency layer |

### Recipes & source_type values
| Recipe | Trigger | source_type |
|--------|---------|-------------|
| Order revenue | `ORDER_CLOSED` | `ORDER_REVENUE` |
| Order COGS | `STOCK_DEPLETED` | `ORDER_COGS` |
| Refund | `ORDER_REFUNDED` | `ORDER_REFUND` |
| Wastage | `WASTAGE_RECORDED` | `WASTAGE` |
| Count variance | `COUNT_VARIANCE_POSTED` | `COUNT_VARIANCE` |
| Transfer ship | `TRANSFER_SHIPPED` | `TRANSFER_SHIP` |
| Transfer receive | `TRANSFER_RECEIVED` | `TRANSFER_RECV` |

### RabbitMQ consumers (7)
- `finance.order-closed.queue` (existing)
- `finance.stock-depleted.queue` (new)
- `finance.order-refunded.queue` (new)
- `finance.wastage.queue` (new)
- `finance.count-variance.queue` (new)
- `finance.transfer-shipped.queue` (new)
- `finance.transfer-received.queue` (new)

All bindings added to `deploy/init/rabbitmq-definitions.json` with DLQ pattern.

### Idempotency (3 layers)
1. `ProcessedEventService` — `(consumer, eventId)`
2. `posted_source_events` — `(tenant_id, source_type, source_id)`
3. `JournalEntryService.autoPostInternal` — JE `(source_type, source_id)`

### Integration tests
- `OrderCloseAutoPostingIT` — revenue JE + COGS JE + dedup
- `InventoryAutoPostingIT` — wastage, count variance, transfer ship/receive

## Explicit deferrals (Phase 10/11 FIN-03)
- GR/IR (`finance.stock-received` — queue exists, consumer not implemented)
- Vendor invoice match (`finance.invoice-matched`)
- Payroll (`finance.payroll-approved`)

## Verification
Run: `mvn -pl services/finance-service -am verify` (requires JDK 25 + Maven + Docker for Testcontainers)
