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

## The `rabbitmq-data` volume outlives a database reset

Wiping and reseeding the Postgres databases does **not** touch the broker. The `rabbitmq-data`
Docker volume survives, so every message still queued keeps referring to tenants, orders and GRNs
that no longer exist.

Measured 2026-08-13, the morning after a full reset:

```
finance.order-closed.queue.dlq     3 x ORDER_CLOSED    tenant d108c2e6…  (the OLD floating-terrace id)
inventory.grn-received.queue.dlq   8 x GRN_RECEIVED    tenant d108c2e6…
```

Neither tenant existed any more — the reset had reseeded floating-terrace under a new id — and every
referenced row was gone: **0 of 3 orders, 0 of 7 GRNs, 0 journal entries, 0 vendor invoices**. They
looked exactly like missing revenue postings and goods received that never became stock. They were
debris, and the newest of them predated the reset by seventeen hours.

Replay would have been worse than useless: every payload carries a dead tenant id, so it would
either fail a foreign key or manufacture orphans for a tenant with no registration — and RLS would
refuse them anyway, because no policy can match a tenant that does not exist.

**Two rules follow.**

1. **If you reset the databases, reset the broker in the same operation**, or the next person
   investigates the same phantom messages from scratch.
2. **When a DLQ is non-empty, check whether its tenant still exists before treating a missing row as
   lost work.** Peek non-destructively — `ackmode=reject_requeue_true` against the management API on
   :15672 — never a destructive `get`.

One thing that investigation confirmed as healthy, worth keeping: every `x-death` showed
`count=1`, so each message exhausted the `max-attempts: 3` in-process retry that both finance- and
inventory-service configure, and *then* dead-lettered once. The retry policy works; these were not
poison messages bypassing it.
