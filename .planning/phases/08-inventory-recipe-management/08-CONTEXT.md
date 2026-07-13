# Phase 8: Inventory & Recipe Management - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a **new `inventory-service`** (Java 25 / Spring Boot 4, port `8085`, DB `inventory_db`)
that gives RestaurantOS perpetual, recipe-driven inventory with accurate stock quantities and
moving-average valuation, reacting to POS sales.

In scope (INV-01…INV-07):
- Ingredient master + units-of-measure (with conversion) + reorder points; opening stock via an
  `OPENING_BALANCE` movement (INV-01, INV-07).
- Versioned recipes/BOM; depletion uses the recipe version effective at order time (INV-02).
- `ORDER_CLOSED` depletion consumer: `SELECT FOR UPDATE` on stock, moving-average cost (MAC),
  idempotent on duplicate delivery; publishes `STOCK_DEPLETED` with `cogsPaisa` (INV-03).
- Stock receipts update MAC + publish `STOCK_RECEIVED`; inter-branch transfers ship/receive with
  in-transit accounting and variance (INV-04, INV-05).
- Stock counts post variances; low-stock and expiry alerts (INV-06).
- **Lot tracking + FEFO depletion** (user-elevated this phase — see D-04).
- `GET /internal/grn/pending-count` to satisfy the finance period-close pre-check stub.

Out of scope (explicit):
- **Finance-side ledger auto-posting of revenue+COGS** from `ORDER_CLOSED` — that is **Phase 9**
  ("Order-to-Ledger Auto-Posting"). Phase 8 only *computes* COGS and *publishes* `STOCK_DEPLETED`;
  finance has no consumer yet. (A synchronous `POST /internal/finance/journal-entries` fallback
  exists and may be used for count-variance / transfer / wastage JEs where the spec's GL mapping
  requires an immediate entry — planner's call.)
- Purchasing / PO / GRN 3-way match — Phase 10 (Vendor & Supply Chain). Phase 8 receipts are the
  inventory-side stock-in, not the purchasing workflow.
- Full inventory management UI beyond the Inventory Manager surface defined in UI/UX §7.5 (roadmap
  plans 08-01/02/03 are backend-weighted; UI depth is planner discretion within §7.5).

</domain>

<decisions>
## Implementation Decisions

### Recipe versioning (INV-02)
- **D-01: Resolve the recipe version by order timestamp.** On depletion, select the recipe version
  whose `effective_from` window covers the order's time (recipes already carry `version` +
  `is_current` + `effective_from`) rather than always using `is_current`. This honors INV-02
  ("version effective at order time") **without** changing the POS service or the `ORDER_CLOSED`
  event. Rejected alternatives: (a) always-current (violates INV-02 on mid-service recipe edits);
  (b) stamp version onto the order at order-open time (most precise but spills a change into
  pos-service + the event contract — deferred).
  - Note: the `ORDER_CLOSED` payload carries only `menuItemId` + `qty` and `closedAt` (no
    `openedAt`, no recipe ref). The planner must decide the resolution instant — `closedAt` is the
    only order timestamp on the event today; if strict order-open semantics are required later,
    that needs the stamp-on-order approach (deferred). Using `closedAt` against `effective_from`
    is the accepted v1 behavior.

### Oversell / negative stock (INV-03)
- **D-02: Allow stock to go negative on oversell, and fire a low-stock alert.** The meal was already
  served; blocking cannot un-sell it and would make inventory lie. Negative on-hand is a *signal to
  recount*, not an error. Aggregate `qty_on_hand` may go negative; **lot rows floor at zero** (a
  shortfall beyond available lots drives only the aggregate negative). Matches the spec's sample
  depletion (plain subtract). Rejected: clamp-at-zero (under-records real consumption).

### Depletion reliability (INV-03)
- **D-03: Async depletion failures auto-retry, then dead-letter + alert** — the house consumer
  pattern (3 retries, exponential backoff 2s×2 max 10s, `default-requeue-rejected=false`,
  dead-letter to `restaurantos.dlx`, `stateless=true`), then a notification. Nothing is lost and it
  self-heals almost always. Rejected: manual-resolution-per-failure (heavy ops for a rare event).
  - The depletion consumer is **idempotent** via the existing `processed_events` pattern
    (`ProcessedEventService.tryProcess(consumer, envelope.eventId, …)`), consumer name
    `inventory.depletion`, dedup key `(consumer, eventId)` — safe on duplicate delivery (INV-03).

### Expiry & lot tracking (INV-06) — **elevated scope**
- **D-04: Full lot tracking + FEFO depletion, with MAC valuation retained.**
  - Each stock receipt creates a **lot** row (`qty` + `expiryDate` + `cost`). A `stock_lots` ledger
    is the source of truth for rotation and expiry.
  - **Depletion walks lots oldest-expiry-first (FEFO)** to reduce quantities — this is *physical
    rotation only*.
  - **COGS is still valued at moving-average cost (MAC)** per INV-03 — depletion cost =
    `qtyDepleted × avg_cost_paisa` (aggregate blended cost), **not** the specific lot's purchase
    price. FEFO governs *which lot quantities drop*; MAC governs *what number posts as COGS*. (True
    FIFO/actual-lot costing is explicitly rejected — it would contradict INV-03.)
  - **Expiry alerts fire from a scheduled nightly sweep** — one `@Scheduled`/cron job that queries
    lots with `expiryDate <= today + leadDays` and remaining `qty > 0`, publishing `EXPIRY_ALERT`
    (which already carries `lotId` + `expiresOn`). Lead time is **configurable** (suggest default
    3 days). No per-batch timers.
  - `avg_cost_paisa` (aggregate MAC per base unit) + aggregate `qty_on_hand` remain authoritative
    for valuation and availability; lots reconcile to the aggregate.

### Claude's Discretion
- **UOM conversion + effective-qty rounding.** Follow the spec's `effective_base_qty` formula (M2.4);
  compute in `BigDecimal`, convert cost to paisa with **HALF_UP** (mirror `MoneyUtils.fromPkr`; do NOT
  reuse the FLOOR `taxPerLine` helper). `qty` columns are `NUMERIC(18,4)`, `to_base_factor`
  `NUMERIC(18,8)`.
- **Missing-recipe handling.** A `menuItemId` with no resolvable recipe → skip that line (spec
  default `if (recipe == null) continue`). Planner may add an optional flag/log for manager review;
  not required to block.
- **Transfer-in-transit variance policy** (shrinkage between ship/receive): use `TRANSFER_VARIANCE`
  event + the spec's GL mapping (Inventory in Transit `1320`); auto-post threshold vs manual review
  is planner's call.
- **Which inventory internal-endpoint paths ship in Phase 8.** `GET /internal/grn/pending-count`
  (finance stub contract) is required; the `04-internal-api-contracts.md` paths
  (`/internal/inventory/branches/{id}/stock-levels`, `/internal/inventory/availability-check`) are
  reconcile-and-decide (the finance Feign client only calls `pending-count` today).
- **Whether count-variance / transfer / wastage JEs post synchronously** via
  `POST /internal/finance/journal-entries` (exists, dedup by `sourceType`/`sourceId`) **or** via
  events for a later finance consumer. `STOCK_DEPLETED` (order COGS) is event-only and consumed in
  Phase 9.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Inventory domain spec (data model + algorithms)
- `Docs/RestaurantERP_SaaS_Specification.md` §M2 (lines ~1805–1933) — inventory purpose, data model
  (`units_of_measure`, `ingredients`, `ingredient_branch_stock` w/ `avg_cost_paisa` = MAC,
  `recipes` versioned, `recipe_lines` w/ `yield_pct`, `inventory_movements` typed), and the
  depletion algorithm (M2.4) with `PESSIMISTIC_WRITE` + `effective_base_qty` formula.
- `Docs/RestaurantERP_SaaS_Specification.md` §M3.4 (lines ~2025–2043) — auto-posting GL map:
  Order-close COGS = DR `5100` / CR `1300` at MAC; wastage; stock count loss/gain; inter-branch
  transfer ship/receive via Inventory-in-Transit `1320`.

### Events & messaging
- `Docs/agent-specs/02-event-schema-registry.md` §2.1 (`EventEnvelope`, `eventId` UUIDv7 =
  idempotency key), §2.2 (topology — `inventory.topic`; `inventory.order-closed.queue` already
  declared), §2.3 (inventory event shapes: `STOCK_RECEIVED`, `STOCK_DEPLETED{lines[].cogsPaisa,
  totalCogsPaisa}`, `LOW_STOCK_ALERT`, `EXPIRY_ALERT{lotId,expiresOn}`, `COUNT_VARIANCE_POSTED`,
  `WASTAGE_RECORDED`, `TRANSFER_SHIPPED/RECEIVED/VARIANCE`), §2.4 (`processed_events` idempotency),
  §2.5 (DLQ policy).

### Contracts, migrations, conventions
- `Docs/agent-specs/04-internal-api-contracts.md` — `inventory-service` @ `http://inventory-service:8085`;
  documented inventory internal endpoints (reconcile with finance's `GET /internal/grn/pending-count`).
- `Docs/conventions/rls-convention.md` — RLS + `TenantAuditableEntity` pattern; RLS-exempt infra
  tables (`event_outbox`, `idempotency_keys`, `processed_events`); money = `BIGINT` paisa **except
  inventory qty = `NUMERIC(18,4)`**; add `FORCE ROW LEVEL SECURITY` from the start.
- `Docs/agent-specs/08-database-migration-guide.md` — Flyway (`V1__inventory_schema.sql`, `V2__shared_infra_tables.sql`, …).
- `Docs/agent-specs/03-shared-lib-specification.md` — `TenantAuditableEntity`, `EventEnvelope`,
  `MoneyUtils`, `TenantAwareMessageProcessor`.
- `Docs/agent-specs/07-coding-standards.md` and `Docs/agent-specs/10-test-architecture-guide.md` —
  coding standards + IT/Testcontainers architecture (inventory CI gate **≥75%** line coverage).

### UI
- `Docs/RestaurantOS_UI_UX_Design_System.md` §7.5 — Inventory Manager surface (dense tables, 4px
  left-border stock-health rows, `[PO+]` quick-add, reorder progress bar, receive-stock slide-over)
  and §empty-states ("Add First Ingredient").

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (copy/mirror — from codebase scout)
- **Idempotent consumer:** `services/kitchen-service/.../consumer/OrderClosedConsumer.java` +
  `.../service/ProcessedEventService.java` (`tryProcess`) — copy into inventory-service; consumer
  name `inventory.depletion`.
- **Pessimistic lock:** `services/pos-service/.../repository/OrderSequenceRepository.java`
  `findForUpdate` (`@Lock(PESSIMISTIC_WRITE)`) — mirror as a stock/lot `findForUpdate` before
  mutating qty + MAC.
- **Base entity / RLS:** `shared-lib/.../entity/TenantAuditableEntity.java` (extend on every tenant
  table); finance `V1__finance_schema.sql` RLS block + `V2__shared_infra_tables.sql` (infra tables).
- **Money:** `shared-lib/.../money/MoneyUtils.java` (`fromPkr` HALF_UP; `taxPerLine` FLOOR — do not
  reuse for MAC). No moving-average helper exists — compute MAC in `BigDecimal`, round HALF_UP.
- **Sync auto-post seam:** finance `InternalFinanceController` `POST /internal/finance/journal-entries`
  (`InternalAutoPostJeRequest`, header `X-Tenant-Id`) — app-level dedup by `(tenantId, sourceType, sourceId)`.

### Established Patterns
- **`ORDER_CLOSED` producer:** `services/pos-service/.../service/OrderServiceImpl.java` (exchange
  `pos.topic`, rk `pos.order.closed`, type `ORDER_CLOSED`, transactional outbox — exactly one per
  close). Payload `services/pos-service/.../event/PosClosePayloads.java`:
  `OrderClosedPayload{ orderId, items:[ItemEntry{menuItemId,name,qty,unitPricePaisa,lineTotalPaisa}],
  closedAt, … }`. **No recipe/ingredient refs on the event** → inventory resolves recipes locally
  from `menuItemId`+`qty`. `tenantId`/`branchId`/`eventId`/`occurredAt` come from the envelope.
- **Consumer RLS:** `TenantAwareMessageProcessor` sets `app.current_tenant_id` GUC per consumer txn.
- **Flyway** (not Liquibase) for service migrations; **host-run** dev stack via `scripts/start-dev.ps1`.

### Integration Points (new wiring this phase must add)
- New Maven module `services/inventory-service` → add to root `pom.xml` `<modules>` and to
  `scripts/start-dev.ps1` (port **8085**; `inventory_db`/`inventory_user` already provisioned in
  `deploy/init/`).
- **Consumes** `inventory.order-closed.queue` (already declared in `deploy/init/rabbitmq-definitions.json`,
  bound `pos.topic`/`pos.order.closed`, `.dlq` sibling present).
- **Publishes** `inventory.topic` events (`STOCK_DEPLETED`, `STOCK_RECEIVED`, `LOW_STOCK_ALERT`,
  `EXPIRY_ALERT`, `COUNT_VARIANCE_POSTED`, `WASTAGE_RECORDED`, `TRANSFER_*`).
- **Implements** `GET /internal/grn/pending-count?periodEnd=` — consumed by finance
  `PeriodCloseService` via `InventoryInternalClient` (currently a stub returning 0). Without it,
  periods can close over unposted GRNs.
- No `finance.stock-depleted.queue` binding exists yet — Phase 9 will add it.

</code_context>

<specifics>
## Specific Ideas

- The user's own proposal drove D-04: a **scheduler that triggers on batch expiry dates**. Confirmed
  as the enterprise-standard shape (Toast / Lightspeed / Restaurant365 / Oracle Simphony run
  scheduled shelf-life sweeps), implemented as **one nightly sweep query** (not per-batch timers) —
  restart-safe and scalable. This is the required implementation approach for expiry alerts.
- FEFO for physical rotation + MAC for valuation is a deliberate, explained split — keep them
  distinct in the design.

</specifics>

<deferred>
## Deferred Ideas

- **Stamp recipe version onto the order at order-open time** (most precise INV-02 semantics) —
  deferred; would require a pos-service + `ORDER_CLOSED` event-contract change. Revisit if
  timestamp-resolution proves insufficient.
- **Finance revenue+COGS ledger auto-posting from `ORDER_CLOSED`** — Phase 9 ("Order-to-Ledger
  Auto-Posting"); needs a `finance.stock-depleted.queue` binding + finance consumer.
- **True FIFO/actual-lot COGS costing** — rejected (contradicts INV-03's mandated MAC); not a future
  item unless the accounting policy changes.
- **Purchasing / PO / GRN 3-way match workflow** — Phase 10 (Vendor & Supply Chain).

*None of the above were dropped silently — each is recorded for its owning phase.*

</deferred>

---

*Phase: 08-inventory-recipe-management*
*Context gathered: 2026-07-13*
