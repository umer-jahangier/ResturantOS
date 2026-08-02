# RabbitMQ topology

`rabbitmq-definitions.json` pre-provisions every exchange, queue, binding and DLQ at broker boot.
It is a convenience, NOT the source of truth: each service also declares the topology it owns as
idempotent `@Bean`s (`InventoryRabbitConfig`, `KitchenRabbitConfig`, `ReportingRabbitConfig`,
`FinanceRabbitConfig`, `CrmRabbitConfig`, `PosKitchenTopologyConfig`), so a service brought up
against a broker that was never seeded from this file still works.

finance-service and crm-service did not always do that, and it mattered: on any broker not booted
from this file their listeners never attached and the services still reported healthy.

## Queues intentionally without a consumer

`rabbitmqctl list_queues name consumers` should show exactly two non-DLQ queues at zero, and both
are future phases rather than defects:

| Queue | Why it has no consumer |
|---|---|
| `finance.payroll-approved.queue` | Phase 11 (HR & Payroll) is not started. |
| `notification.low-stock.queue`   | Phase 5 (notifications) is not started — `notification-service` has no `src/main` yet. |

Anything else at zero is a bug. A bound queue nobody drains grows without limit, and the messages
on it look delivered to every producer. `TopologyClosureTest` in finance-service enforces the
inverse for that service — every declared queue has a listener, and every listener has a declared
queue — and is the pattern to copy when a service gains consumers.

### Retired

`finance.invoice-matched.queue` was removed on 2026-08-02. purchasing-service posts the AP journal
entry synchronously through `POST /internal/finance/journal-entries` when an invoice matches, so a
finance consumer for `VENDOR_INVOICE_MATCHED` would have double-posted it. The queue was
speculative, had never had a listener, and had accumulated a real message.
reporting-service still consumes that event on its own queue for the purchase-fact ETL.
