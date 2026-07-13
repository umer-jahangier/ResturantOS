# Phase 8: Inventory & Recipe Management - Research

**Researched:** 2026-07-13
**Domain:** New Java/Spring Boot microservice — perpetual inventory, recipe BOM depletion, moving-average costing, lot/FEFO tracking, RabbitMQ event consumer/producer, RLS multi-tenancy
**Confidence:** HIGH (verified directly against this codebase's existing kitchen-service/pos-service/finance-service source, canonical spec docs, and live migration files — not generic Spring Boot advice)

## Summary

Phase 8 builds a **new `inventory-service`** (port 8085, `inventory_db`) that mirrors the exact
architectural shape already proven three times in this repo (auth/finance/pos/kitchen): Flyway SQL
migrations (NOT the Liquibase XML the canonical doc describes — see Pitfall 1), `TenantAuditableEntity`
+ RLS-via-GUC, transactional-outbox event publishing (`DomainEventPublisher`), and
`processed_events`-backed idempotent `@RabbitListener` consumption via `TenantAwareMessageProcessor`.
Every one of these patterns has a working, copy-paste-ready reference implementation already in
`kitchen-service` or `pos-service` — this research locates the exact file, method, and gotcha for each.

The two genuinely novel pieces of engineering are: (1) the **moving-average-cost (MAC) recompute**
on every stock receipt, which has **no existing helper** in `shared-lib` (must be hand-written in
`BigDecimal`, HALF_UP, mirroring `MoneyUtils.fromPkr` — never `taxPerLine`'s FLOOR), and (2) the
**FEFO lot walk composed with aggregate-MAC costing** (D-04): lots determine *which physical units
deplete first*, but COGS values every depletion at the *blended* `avg_cost_paisa`, never a lot's own
purchase price — these two numbers can diverge and that is by design, not a bug.

A significant, verified pre-existing gap this phase must close: **the API gateway has no live route
for `pos-service` OR the (not-yet-built) `inventory-service`** — both are commented-out stubs in
`gateway/application.yml`. If Phase 8 ships an Inventory Manager UI, the gateway route for
`/api/v1/inventory/**` must be uncommented and activated (see Pitfall 8).

**Primary recommendation:** Copy `kitchen-service`'s V1/V2 Flyway migration pair,
`OrderClosedConsumer` + `ProcessedEventService`, and `application.yml` RabbitMQ listener block
verbatim as the skeleton; layer in a hand-written `BigDecimal` MAC calculator, a `stock_lots` table
+ FEFO repository query, and the `GET /internal/grn/pending-count` controller matching
`InternalPosController`'s exact bare-`Long` contract.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Ingredient/UOM/recipe CRUD | API / Backend (`inventory-service`) | Browser (Inventory Manager UI, §7.5) | Master data owned by inventory-service; UI is a thin CRUD surface |
| `ORDER_CLOSED` depletion + MAC recompute | API / Backend (`inventory-service` consumer) | — | Pure backend reaction to an event; no UI involvement, must be transactional + locked |
| Stock receipts (GRN stock-in) | API / Backend (`inventory-service`) | Browser (receive-stock slide-over, §7.5) | Writes MAC + lots; UI triggers, service computes |
| Transfers (ship/receive/variance) | API / Backend (`inventory-service`) | Browser (transfer workflow, planner discretion) | Two-sided stock movement + in-transit GL account; must be server-authoritative |
| Stock counts + variance posting | API / Backend (`inventory-service`) | Browser (count-sheet entry UI) | Variance JE either sync via Finance internal endpoint or async event (planner discretion) |
| Low-stock / expiry alerts | API / Backend (`inventory-service`, `@Scheduled` sweep) | Notification Service (downstream consumer) | inventory-service publishes; notification-service (Phase 5, already built) renders |
| `GET /internal/grn/pending-count` | API / Backend (`inventory-service`) | — | Consumed synchronously by finance-service's `InventoryInternalClient` during period close |
| Gateway routing for `/api/v1/inventory/**` | CDN / Gateway tier | — | Currently a commented-out stub; must be activated for any UI to reach the service (Pitfall 8) |

## Project Constraints (from CLAUDE.md)

This repo is indexed by GitNexus. Before editing any existing symbol (e.g. if this phase touches
`OrderServiceImpl`, `PeriodCloseService`, or the gateway route config), the executor agent should run
`impact({target: "symbolName", direction: "upstream"})` first and report blast radius, and run
`detect_changes()` before committing. This phase is additive (new service + a few edits to
`pom.xml`/`start-dev.ps1`/gateway YAML/`InventoryInternalClientFallback`), so blast radius on existing
symbols should be LOW, but the `InventoryInternalClientFallback` deletion/replacement and any
`PeriodCloseService` touch should still go through `impact` per CLAUDE.md's **MUST** rule.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 (Recipe versioning, INV-02):** Resolve the recipe version by **order timestamp** — select the
recipe version whose `effective_from` window covers the order's time, not `is_current`. The
`ORDER_CLOSED` payload carries only `closedAt` (no `openedAt`, no recipe ref) — **resolve against
`closedAt`**; this is the accepted v1 behavior. Stamping the version onto the order at open-time is
deferred (would require a pos-service + event-contract change).

**D-02 (Oversell/negative stock, INV-03):** Allow `qty_on_hand` to go negative on oversell and fire a
low-stock alert; do NOT block the depletion. **Lot rows floor at zero** — a shortfall beyond available
lots drives only the aggregate negative, never a negative lot row. Matches the spec's plain-subtract
sample. Rejected: clamp-at-zero.

**D-03 (Depletion reliability, INV-03):** Async depletion failures auto-retry (3 attempts, exponential
backoff 2s×2 up to a max, `default-requeue-rejected=false`), then dead-letter to `restaurantos.dlx` +
notification. The consumer is idempotent via `processed_events`
(`ProcessedEventService.tryProcess(consumer, envelope.eventId, …)`), consumer name
`inventory.depletion`, dedup key `(consumer, eventId)`.

**D-04 (Lot tracking + FEFO, INV-06 — elevated scope):** Every stock receipt creates a **lot** row
(`qty` + `expiryDate` + `cost`); `stock_lots` is the source of truth for rotation/expiry. Depletion
walks lots **oldest-expiry-first (FEFO)** to reduce quantities — physical rotation only. **COGS is
still valued at MAC** (`qtyDepleted × avg_cost_paisa`), never the specific lot's purchase price — true
FIFO/actual-lot costing is explicitly rejected (would contradict INV-03). Expiry alerts fire from a
**single nightly `@Scheduled` sweep** (lots with `expiryDate <= today + leadDays` and `qty > 0`,
configurable lead time, default 3 days) — no per-batch timers.

### Claude's Discretion

- **UOM conversion + effective-qty rounding.** Follow spec's `effective_base_qty` formula (M2.4);
  compute in `BigDecimal`, convert cost to paisa with **HALF_UP** (mirror `MoneyUtils.fromPkr`; do NOT
  reuse the FLOOR `taxPerLine` helper). `qty` columns are `NUMERIC(18,4)`, `to_base_factor`
  `NUMERIC(18,8)`.
- **Missing-recipe handling.** A `menuItemId` with no resolvable recipe → skip that line (spec
  default `if (recipe == null) continue`). Optional flag/log for manager review; not required to block.
- **Transfer-in-transit variance policy** — use `TRANSFER_VARIANCE` event + the spec's GL mapping
  (Inventory in Transit `1320`); auto-post threshold vs manual review is planner's call.
- **Which inventory internal-endpoint paths ship in Phase 8.** `GET /internal/grn/pending-count` is
  required (finance stub contract, currently hard-coded to return `0`). The `04-internal-api-contracts.md`
  paths (`stock-levels`, `availability-check`) are reconcile-and-decide.
- **Whether count-variance / transfer / wastage JEs post synchronously** via
  `POST /internal/finance/journal-entries` (exists, dedup by `sourceType`/`sourceId`) or via events for
  a later finance consumer. `STOCK_DEPLETED` (order COGS) is event-only, consumed in Phase 9.

### Deferred Ideas (OUT OF SCOPE)

- Stamp recipe version onto the order at order-open time (deferred — needs pos-service + event
  contract change).
- Finance revenue+COGS ledger auto-posting from `ORDER_CLOSED` — Phase 9 (needs a
  `finance.stock-depleted.queue` binding + finance consumer).
- True FIFO/actual-lot COGS costing — rejected, contradicts INV-03's mandated MAC.
- Purchasing / PO / GRN 3-way match workflow — Phase 10.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INV-01 | Manager can manage ingredients, UOM, reorder points | §M2.3 data model (`units_of_measure`, `ingredients`); OPA `inventory.item.manage` permission already seeded; Flyway pattern below |
| INV-02 | Recipes/BOM versioned; depletion uses the recipe version effective at order time | D-01 (locked) + M2.4 depletion algorithm; `effective_from` query pattern below |
| INV-03 | `ORDER_CLOSED` consumer depletes stock with `SELECT FOR UPDATE`, MAC maintained | `OrderClosedConsumer`/`ProcessedEventService`/`OrderSequenceRepository.findForUpdate` mirrors; MAC formula below; D-02/D-03 |
| INV-04 | Stock receipts update MAC; `STOCK_RECEIVED` published | MAC recompute formula; `DomainEventPublisher` outbox pattern; event schema §2.3 |
| INV-05 | Stock transfers (ship/receive) with in-transit accounting and variance handling | GL mapping M3.4 (`1320` Inventory in Transit); `TRANSFER_SHIPPED/RECEIVED/VARIANCE` event shapes |
| INV-06 | Stock counts with variance posting; low-stock and expiry alerts | `COUNT_VARIANCE_POSTED` event shape; D-04 nightly `@Scheduled` FEFO sweep |
| INV-07 | Opening stock recorded via `OPENING_BALANCE` movement | `inventory_movements.movement_type` enum (M2.3); no existing event for this — internal-only movement row |
</phase_requirements>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Spring Boot | 4.0.7 | Service framework | Parent POM pin (`pom.xml:15`) — identical across all 10 existing services `[VERIFIED: pom.xml]` |
| Java | 25 | Language/runtime | `<java.version>25</java.version>` in parent POM `[VERIFIED: pom.xml]` |
| Flyway (`flyway-core` + `flyway-database-postgresql`) | matches Boot 4.0.7 BOM | Schema migrations | **NOT Liquibase** despite `08-database-migration-guide.md` — every real service (finance, pos, kitchen) uses Flyway `V{n}__name.sql` `[VERIFIED: services/*/pom.xml, services/*/src/main/resources/db/migration]` |
| Spring Data JPA + Hibernate | Boot-managed | ORM, `PESSIMISTIC_WRITE` locking, tenant `@Filter` | Identical pattern to pos-service `OrderSequenceRepository` |
| Spring AMQP (`spring-boot-starter-amqp`) | Boot-managed | RabbitMQ consumer/producer | Same as kitchen-service |
| `shared-lib` (this repo, `1.0.0`) | internal | `TenantAuditableEntity`, `DomainEventPublisher`, `EventEnvelope`, `MoneyUtils`, `ProcessedEventService`-equivalent scaffolding, `TenantAwareMessageProcessor`, `TenantContext`, `IdempotencyService` | Mandatory base for every service `[VERIFIED: shared-lib/src/main/java]` |
| PostgreSQL 18 driver (`org.postgresql:postgresql`) | Boot-managed, runtime scope | `inventory_db` connectivity | `inventory_db`/`inventory_user` already provisioned in `deploy/init/01-create-databases.sql` + `02-create-roles.sql` `[VERIFIED]` |
| `springdoc-openapi-starter-webmvc-ui` | 2.8.9 | OpenAPI docs | Pinned explicitly in every service pom (not BOM-managed) `[VERIFIED: kitchen-service/pom.xml]` |
| Lombok | Boot-managed | Entity boilerplate | Universal in this codebase |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `spring-cloud-starter-netflix-eureka-client` | Spring Cloud BOM | Service registry | Every service registers; gateway routes via `lb://inventory-service` |
| `spring-cloud-starter-config` | Spring Cloud BOM | Config server client | `optional:configserver:` import, `fail-fast: false` |
| `spring-boot-starter-data-redis` | Boot-managed | Feature-flag cache reads (if `@RequiresFeature` used) | Only if inventory endpoints are feature-gated (`FEATURE_INVENTORY` already exists per PLATFORM-10) |
| `spring-cloud-starter-openfeign` | Spring Cloud BOM | Outbound internal calls | **Only if** inventory needs to call another service (e.g. pos-service for menu-item names); not needed for `pending-count` itself (that's inbound) — finance-service is the pattern to copy if outbound calls are added |
| `org.awaitility:awaitility` | test scope | Async RabbitMQ IT assertions | Matches `10-test-architecture-guide.md §10.3` pattern |
| `org.testcontainers:{junit-jupiter,postgresql,rabbitmq}` | Boot-managed test BOM | IT infra | Kitchen/pos/finance all use this trio; **add `rabbitmq` module** (kitchen's pom only lists `junit-jupiter` + `postgresql` — but kitchen's own IT base class starts a `RabbitMQContainer` directly per `10-test-architecture-guide.md §10.1`, so the explicit `testcontainers:rabbitmq` Maven dependency may not be strictly required if only `junit-jupiter`'s auto-detection is used; verify against kitchen-service's actual `pom.xml` test dependencies before assuming) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Flyway | Liquibase XML (per `08-database-migration-guide.md`) | **Rejected** — every real service in this repo uses Flyway; following the doc literally would break `AbstractRlsCoverageTest`/CI conventions this codebase actually built. The doc is aspirational/stale; the code is authoritative. |
| Hand-written BigDecimal MAC | A shared `InventoryMathUtils` in `shared-lib` | Not built yet — out of scope to retrofit shared-lib this phase; write it local to inventory-service, flag as a `shared-lib` extraction candidate for later (mirrors `[04-02-D]`-style "optional to swap later" decisions logged elsewhere in STATE.md) |
| Lot-level actual cost | Weighted MAC (D-04 locked) | Rejected by user — contradicts INV-03 |

**Installation:** No new *external* npm/pip/cargo packages — this is a pure-Java Maven module inside
the existing multi-module reactor. Add `<module>services/inventory-service</module>` to the root
`pom.xml` (after `<module>services/kitchen-service</module>`, matching the existing declaration order).

**Version verification:** `mvn -f pom.xml help:evaluate -Dexpression=spring-boot.version` was not run
live this session; version `4.0.7` is read directly from `pom.xml:15` (`[VERIFIED: pom.xml]`, not a
registry lookup — this is an internal monorepo parent POM pin, not an external package, so no
npm/PyPI-style registry check applies).

## Package Legitimacy Audit

**Not applicable this phase.** Inventory-service introduces zero new third-party dependencies beyond
what `kitchen-service`/`finance-service`/`pos-service` already declare (all already vetted and running
in production-shape code in this repo). No `npm view` / `pip index` / `cargo search` verification is
needed because no new package names are being introduced — every dependency in the Standard Stack
table above is copy-pasted from an already-building `pom.xml` in this same reactor.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────────┐
                    │                    pos-service                       │
                    │  performClose() → DomainEventPublisher.publish(      │
                    │    "pos.topic", "pos.order.closed", "ORDER_CLOSED")  │
                    │         (writes to pos-service's event_outbox,       │
                    │          same @Transactional as order close)         │
                    └───────────────────────┬───────────────────────────────┘
                                             │ OutboxRelay delivers at-least-once
                                             ▼
                          RabbitMQ  pos.topic  (routing key pos.order.closed)
                                             │
                     ┌───────────────────────┼─────────────────────────────┐
                     ▼                       ▼                             ▼
        inventory.order-closed.queue   finance.order-closed.queue   (crm/reporting/kitchen queues)
        (already declared in                (Phase 9 — not yet
         rabbitmq-definitions.json)           consumed)
                     │
                     ▼
        ┌────────────────────────────────────────────────────────────────┐
        │                      inventory-service                          │
        │  OrderClosedConsumer.onMessage()                                 │
        │    → ProcessedEventService.tryProcess("inventory.depletion",     │
        │        eventId, () -> TenantAwareMessageProcessor.process(env,   │
        │          handler))                                               │
        │         │                                                        │
        │         ▼                                                        │
        │  DepletionService.deplete(envelope.payload)                      │
        │    for each item:                                                │
        │      1. resolve Recipe by (menuItemId, closedAt ∈ effective_from)│
        │      2. for each RecipeLine: effectiveBaseQty = f(line, qty,     │
        │           recipe.yieldServings, uom.toBaseFactor)                │
        │      3. lock stock row: findForUpdate(tenantId, branchId,        │
        │           ingredientId) — PESSIMISTIC_WRITE, deterministic order │
        │      4. walk stock_lots FEFO (expiry_date ASC) to reduce lot qty │
        │           (floor at zero per lot; aggregate may go negative)     │
        │      5. cost = effectiveBaseQty × stock.avgCostPaisa (NOT lot    │
        │           cost) — HALF_UP rounding                               │
        │      6. write inventory_movements(DEPLETION), update qty_on_hand │
        │      7. if qty_on_hand <= reorderPoint → queue LOW_STOCK_ALERT   │
        │    publish STOCK_DEPLETED{lines[].cogsPaisa, totalCogsPaisa}     │
        │         via inventory.topic (same @Transactional as writes,      │
        │         through this service's own event_outbox)                │
        │    ProcessedEventService records (consumer, eventId) — SAME TXN │
        └────────────────────────────────────────────────────────────────┘
                     │                                    ▲
                     │ (separate, synchronous HTTP path)   │ nightly @Scheduled sweep
                     ▼                                    │ (stock_lots WHERE expiry <=
        ┌──────────────────────────┐                      │  today+leadDays AND qty>0)
        │      finance-service      │                      │
        │  PeriodCloseService.close()│              publishes EXPIRY_ALERT{lotId,expiresOn}
        │    → InventoryInternalClient.getPendingGrnCount(periodEnd)
        │      GET /internal/grn/pending-count?periodEnd=  │
        │      (bare `long`, X-Internal-Service header,    │
        │       NOT ApiResponse-wrapped — mirrors           │
        │       InternalPosController's exact contract)     │
        └──────────────────────────┘
```

### Recommended Project Structure

```
services/inventory-service/
├── pom.xml                                    # mirror kitchen-service/pom.xml
└── src/main/
    ├── java/io/restaurantos/inventory/
    │   ├── InventoryServiceApplication.java
    │   ├── config/
    │   │   └── InventoryRabbitConfig.java      # declares inventory.order-closed.queue consumption
    │   │                                        # binding + inventory.topic exchange (idempotent —
    │   │                                        # already exists in rabbitmq-definitions.json)
    │   ├── domain/model/
    │   │   ├── UnitOfMeasure.java
    │   │   ├── Ingredient.java
    │   │   ├── IngredientBranchStock.java       # extends TenantAuditableEntity; qty_on_hand NUMERIC(18,4)
    │   │   ├── StockLot.java                    # NEW vs spec — D-04 elevated scope
    │   │   ├── Recipe.java
    │   │   ├── RecipeLine.java
    │   │   ├── InventoryMovement.java
    │   │   └── (Transfer, StockCount, StockCountLine — planner's call on exact shape)
    │   ├── repository/
    │   │   ├── IngredientBranchStockRepository.java   # findForUpdate(tenantId, branchId, ingredientId)
    │   │   ├── StockLotRepository.java                 # findByStockIdOrderByExpiryDateAsc (FEFO)
    │   │   ├── RecipeRepository.java                   # findEffectiveVersion(tenantId, menuItemId, atInstant)
    │   │   └── ...
    │   ├── consumer/
    │   │   └── OrderClosedConsumer.java          # mirror kitchen-service's exact shape
    │   ├── service/
    │   │   ├── ProcessedEventService.java         # copy verbatim from kitchen-service
    │   │   ├── DepletionService.java              # MAC + FEFO + lock-order logic (core of Phase 8)
    │   │   ├── MacCalculator.java                 # NEW — no shared-lib helper exists
    │   │   ├── ReceiptService.java                 # STOCK_RECEIVED + MAC recompute + lot creation
    │   │   ├── TransferService.java
    │   │   ├── StockCountService.java
    │   │   └── ExpirySweepService.java             # @Scheduled nightly FEFO expiry query
    │   ├── event/
    │   │   └── InventoryEventPayloads.java         # mirror PosClosePayloads.java record style
    │   └── web/
    │       ├── IngredientController.java
    │       ├── RecipeController.java
    │       ├── ReceiptController.java
    │       ├── TransferController.java
    │       ├── StockCountController.java
    │       └── InternalGrnController.java          # GET /internal/grn/pending-count
    └── resources/
        ├── application.yml
        └── db/migration/
            ├── V1__inventory_schema.sql            # domain tables + RLS (WITH FORCE, unlike precedent)
            └── V2__shared_infra_tables.sql          # event_outbox, idempotency_keys, processed_events
```

### Pattern 1: Idempotent RabbitMQ consumer (copy from kitchen-service)

**What:** `@RabbitListener` → deserialize `EventEnvelope<T>` → `ProcessedEventService.tryProcess` →
`TenantAwareMessageProcessor.process` → business handler, all inside the listener's transaction.
**When to use:** Every inbound event this service consumes (`ORDER_CLOSED` only, this phase).
**Example:**
```java
// Source: services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderClosedConsumer.java
@Component
public class OrderClosedConsumer {
    static final String CONSUMER_NAME = "inventory.depletion"; // D-03 locked name

    @RabbitListener(queues = InventoryRabbitConfig.INVENTORY_ORDER_CLOSED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderClosedPayload> envelope = deserialize(message);
        if (envelope == null) { log.warn("could not deserialize — skipping"); return; }
        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
            tenantAwareMessageProcessor.process(envelope, env ->
                depletionService.deplete(env.branchId(), env.payload())
            )
        );
    }
}
```
Note: `InventoryRabbitConfig.INVENTORY_ORDER_CLOSED_QUEUE` should equal the literal string
`"inventory.order-closed.queue"` — this queue is **already declared** in
`deploy/init/rabbitmq-definitions.json` (with its DLQ sibling and the `pos.topic`/`pos.order.closed`
binding), so the `@Configuration` bean declarations in `InventoryRabbitConfig` are a startup no-op
against the pre-provisioned RabbitMQ topology — exactly as kitchen-service's own comment documents
("existing RabbitMQ defs are a no-op").

### Pattern 2: Pessimistic-lock stock mutation (copy from pos-service `OrderSequenceRepository`)

**What:** `@Lock(LockModeType.PESSIMISTIC_WRITE)` JPQL query, always queried by the same
tenant-scoped composite key, in a fixed lock-acquisition order across a transaction.
**When to use:** Any read-then-mutate of `ingredient_branch_stock.qty_on_hand` /
`avg_cost_paisa` — depletion, receipt, transfer, count-variance.
**Example:**
```java
// Source: services/pos-service/src/main/java/io/restaurantos/pos/repository/OrderSequenceRepository.java (pattern)
@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("SELECT s FROM IngredientBranchStock s WHERE s.tenantId = :tenantId "
     + "AND s.branchId = :branchId AND s.ingredientId = :ingredientId")
Optional<IngredientBranchStock> findForUpdate(
        @Param("tenantId") UUID tenantId,
        @Param("branchId") UUID branchId,
        @Param("ingredientId") UUID ingredientId);
```
**Deadlock avoidance:** when one `ORDER_CLOSED` event touches multiple ingredients (multi-line
recipes across multiple order items), lock rows in a **deterministic order** — sort the distinct
`ingredientId` set (e.g. natural UUID ordering) before the depletion loop's lock-acquisition pass,
so two concurrent closes touching overlapping ingredient sets can never form a lock cycle. The M2.4
spec pseudocode locks lazily inside the recipe-line loop with no pre-sort — **do not copy that
verbatim**; pre-sort ingredient IDs first, then lock+mutate in that fixed order.

### Pattern 3: Transactional outbox event publish (copy from pos-service `OrderServiceImpl`)

**What:** `EventPublisher.publish(exchange, routingKey, eventType, branchId, payload)` called inside
the SAME `@Transactional` method that wrote the business-state change.
**When to use:** `STOCK_DEPLETED`, `STOCK_RECEIVED`, `LOW_STOCK_ALERT`, `EXPIRY_ALERT`,
`COUNT_VARIANCE_POSTED`, `WASTAGE_RECORDED`, `TRANSFER_SHIPPED/RECEIVED/VARIANCE` — every inventory
event.
**Example:**
```java
// Source: services/pos-service/.../OrderServiceImpl.java (pattern), shared-lib DomainEventPublisher
eventPublisher.publish("inventory.topic", "inventory.stock.depleted", "STOCK_DEPLETED",
        branchId, new StockDepletedPayload(orderId, lines, totalCogsPaisa));
```
`DomainEventPublisher` (shared-lib) INSERTs into this service's own `event_outbox` row inside the
caller's transaction — publish is reliable even if RabbitMQ is briefly unreachable; the (already-built,
Phase-1) `OutboxRelay` delivers at-least-once after commit. **`eventId` is generated inside
`DomainEventPublisher.publish` itself** (`UUID.randomUUID()`) — do not try to set it from the
inbound `ORDER_CLOSED` envelope's `eventId`; that would make the outbound `STOCK_DEPLETED` share an
id with an unrelated inbound event, breaking any future consumer's own `processed_events` dedup.

### Pattern 4: RLS Flyway migration, WITH the FORCE clause this repo's precedent omits

**What:** `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + tenant-isolation policy +
(optional) explicit `GRANT`.
**When to use:** Every tenant-scoped table (`ingredients`, `ingredient_branch_stock`, `stock_lots`,
`recipes`, `recipe_lines`, `inventory_movements`, transfers, counts). NOT `event_outbox` /
`idempotency_keys` / `processed_events` (RLS-exempt infra tables).
**Example:**
```sql
-- Source: Docs/agent-specs/08-database-migration-guide.md §8.6 (the CORRECT reference — see Pitfall 1)
CREATE TABLE ingredient_branch_stock (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL,
    branch_id       UUID NOT NULL,
    ingredient_id   UUID NOT NULL REFERENCES ingredients(id),
    qty_on_hand     NUMERIC(18,4) NOT NULL DEFAULT 0,
    avg_cost_paisa  BIGINT NOT NULL DEFAULT 0,
    last_counted_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by      UUID,
    updated_by      UUID,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT uq_stock_tenant_branch_ingredient UNIQUE (tenant_id, branch_id, ingredient_id)
);

ALTER TABLE ingredient_branch_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_branch_stock FORCE ROW LEVEL SECURITY;  -- CONTEXT.md explicitly mandates this
                                                                  -- from the start (existing services
                                                                  -- V1 migrations OMIT this — Pitfall 2)
CREATE POLICY tenant_isolation ON ingredient_branch_stock
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
    -- NULLIF(...,'') wrapper is mandatory — see Pitfall 3 (empty-GUC cast crash,
    -- finance-service needed a follow-up V4 migration to add this after shipping without it)
```

### Anti-Patterns to Avoid

- **Locking stock rows inside the recipe-line loop in encounter order (spec's literal M2.4
  pseudocode):** creates a deadlock risk when two orders close concurrently with overlapping
  ingredients locked in different orders. Pre-sort ingredient IDs before locking (Pattern 2).
- **Using `taxPerLine`-style FLOOR rounding for MAC or COGS paisa values:** `MoneyUtils.taxPerLine`
  is FLOOR by design for tax (spec XCUT-03 requires floored per-line tax) — reusing it for MAC/COGS
  would silently under-value inventory. Always HALF_UP for MAC/COGS (mirror `fromPkr`).
- **Treating `avg_cost_paisa` as a lot-level field:** it is an aggregate field on
  `ingredient_branch_stock`, one value per (tenant, branch, ingredient). `stock_lots` rows never carry
  their own "current" cost that participates in COGS calc — only their *original receipt* cost
  (retained for audit/valuation-report purposes, per D-04, but not used in the depletion COGS formula).
- **Publishing `STOCK_DEPLETED` before the depletion transaction commits, or from outside the
  consumer's own `@Transactional` boundary:** breaks the outbox guarantee — always call
  `eventPublisher.publish(...)` inside the same service method that mutates `qty_on_hand`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Event envelope serialization | Custom JSON wrapper | `shared-lib`'s `EventEnvelope<T>` + `DomainEventPublisher` | Already handles outbox insert, eventId/correlationId generation, envelope shape — exact contract every consumer expects |
| Consumer dedup | A custom "seen orderIds" set/cache | `ProcessedEventService` (copy from kitchen-service) + `processed_events` table | Transactional, survives restarts, matches the `(consumer, event_id)` PK every other service uses |
| Tenant scoping in the RabbitMQ consumer | Manual `SET app.current_tenant_id` calls | `TenantAwareMessageProcessor.process(envelope, handler)` | Sets both the Hibernate `tenantFilter` AND the RLS GUC on the same connection, inside the listener's `@Transactional` — hand-rolling this is exactly the CRIT-01 bug class this class was built to close |
| Paisa rounding | Ad-hoc `Math.round`/double math | `BigDecimal` + `RoundingMode.HALF_UP`, mirroring `MoneyUtils.fromPkr` | Money/cost fields are `BIGINT` paisa end-to-end (XCUT-03); `double` arithmetic introduces silent precision loss that will eventually desync MAC from reality |
| Optimistic vs pessimistic concurrency for stock | Version-column optimistic locking + retry loop | `@Lock(PESSIMISTIC_WRITE)` (mirrors `OrderSequenceRepository.findForUpdate`) | The spec (M2.4) and CONTEXT.md both explicitly mandate `SELECT FOR UPDATE`; optimistic locking under concurrent order-close bursts would produce frequent retries/failures at exactly the highest-traffic moment (dinner rush) |
| DLQ / retry policy | Custom retry-count column + manual backoff loop | Spring AMQP's `spring.rabbitmq.listener.simple.retry` block (copy kitchen-service's `application.yml` values) + `restaurantos.dlx` | Battle-tested, matches every other consumer in the repo, DLQ depth already monitored in Grafana per the event-schema-registry doc §2.5 |

**Key insight:** Every non-domain-specific piece of this phase (idempotency, outbox, tenant scoping,
DLQ policy) already has a working, tested implementation elsewhere in this exact repo. The only truly
new code is the domain math: MAC recompute, FEFO lot walk, effective-recipe-version resolution, and
UOM conversion. Spend the planning effort there, not on infrastructure.

## Common Pitfalls

### Pitfall 1: The canonical migration-guide doc describes Liquibase; the actual codebase uses Flyway

**What goes wrong:** Following `Docs/agent-specs/08-database-migration-guide.md` literally produces
`db/changelog/*.xml` files that Spring Boot will never execute, because every real service's
`application.yml` configures `spring.flyway.enabled: true` / `spring.flyway.locations:
classpath:db/migration` and has **no Liquibase dependency at all**.
**Why it happens:** The doc predates the actual Phase-6 (finance) implementation decision `[06-01-A]`
("Flyway (not Liquibase) for finance-service — single SQL migration file cleaner...") which was then
repeated at `[07-01-A]` for pos-service. The doc was never updated.
**How to avoid:** Use Flyway `V{n}__description.sql` files under
`src/main/resources/db/migration/`, one V1 for the domain schema + RLS, one V2 for the three shared
infra tables (`event_outbox`, `idempotency_keys`, `processed_events`) — mirror
`finance-service`'s or `kitchen-service`'s exact V1/V2 pair. Still apply the doc's §8.6 RLS SQL
content (it's correct Postgres SQL, just wrap it in a Flyway file, not a Liquibase changeset).
**Warning signs:** `mvn spring-boot:run` starts cleanly but no tables exist / Hibernate `ddl-auto:
validate` fails at startup with "table does not exist".

### Pitfall 2: Every existing service's RLS migration is missing `FORCE ROW LEVEL SECURITY`

**What goes wrong:** `finance-service/V1__finance_schema.sql` and `kitchen-service/V1__kitchen_schema.sql`
both do `ALTER TABLE t ENABLE ROW LEVEL SECURITY` + `CREATE POLICY ...` but **never** run
`ALTER TABLE t FORCE ROW LEVEL SECURITY`. Service DB roles are already `NOSUPERUSER NOBYPASSRLS`
(`deploy/init/02-create-roles.sql`), so in practice this has not caused a live isolation breach — but
it is a documented defence-in-depth gap versus both `rls-convention.md` and
`08-database-migration-guide.md §8.6`, both of which show FORCE in their reference SQL.
**Why it happens:** Copy-paste drift — the first service (finance, Phase 6) apparently dropped the
FORCE line from the doc's example when writing V1, and every subsequent service copied finance's V1,
not the doc.
**How to avoid:** CONTEXT.md explicitly locks this for Phase 8 ("add `FORCE ROW LEVEL SECURITY` from
the start"). Include `FORCE ROW LEVEL SECURITY` on every domain table in inventory-service's V1 —
this makes inventory-service the *first* service in the repo to actually match the documented
convention. Do not copy kitchen-service's V1 verbatim without adding the FORCE line back in.
**Warning signs:** `AbstractRlsCoverageTest` (if it actually asserts `relforcerowsecurity = true`,
per `rls-convention.md §7`) would fail — but since no existing service passes this today, verify
whether that test currently runs/passes at all before assuming it will catch a regression.

### Pitfall 3: Casting an empty/unset `app.current_tenant_id` GUC to `::uuid` throws, not returns NULL

**What goes wrong:** `current_setting('app.current_tenant_id', TRUE)::UUID` — when the GUC has never
been set on a connection (e.g. Testcontainers superuser test setup, or a health-check probe query),
`current_setting(..., TRUE)` returns an empty string `''`, and `''::uuid` raises a Postgres cast
error, not a NULL comparison. finance-service shipped without this guard in V1 and had to add
`services/finance-service/.../V4__fix_rls_tenant_guc_policies.sql` to retrofit
`NULLIF(current_setting(...), '')::UUID` on every policy.
**Why it happens:** The naive `current_setting('app.current_tenant_id', true)::uuid` pattern from the
doc's own §8.6 example has this exact bug; kitchen-service's V1 (written after finance's V4 fix)
already uses the corrected `NULLIF(...)` form.
**How to avoid:** Write every RLS policy with `NULLIF(current_setting('app.current_tenant_id', TRUE),
'')::UUID` from V1 — do not reproduce finance's original mistake and its follow-up fix migration.
**Warning signs:** `ERROR: invalid input syntax for type uuid: ""` on any query executed on a
connection with no tenant context set (most commonly: test setup/teardown, or an actuator health
check hitting a repository bean).

### Pitfall 4: MAC recompute has no existing `shared-lib` helper — must be hand-written correctly

**What goes wrong:** There is no `InventoryMoneyUtils` or `MacCalculator` anywhere in `shared-lib`.
`MoneyUtils` only has paisa-integer helpers (`add`, `multiplyBps`, `taxPerLine` FLOOR, `fromPkr`
HALF_UP, `roundToRupee`) — none of them compute a weighted average over a *quantity* dimension.
**Why it happens:** MAC needs `BigDecimal` division (`(oldQty*oldAvg + recvQty*recvCost) / (oldQty +
recvQty)`), which mixes a `NUMERIC(18,4)` quantity with a `BIGINT` paisa cost — a type combination no
other service in this repo has needed yet.
**How to avoid:** Write the formula explicitly in `BigDecimal`, converting `avg_cost_paisa` (long) to
`BigDecimal` only for the division, then round the *result* back to a `long` paisa value with
`RoundingMode.HALF_UP` (mirroring `fromPkr`'s exact rounding mode, not its exact code — `fromPkr`
converts PKR→paisa, MAC recompute produces paisa directly and just needs the same rounding mode
applied at the final division step). Guard the `oldQty + recvQty == 0` edge case (should be
unreachable in a receipt flow, since a receipt always adds positive qty, but negative on-hand from
D-02 oversell means `oldQty` CAN be negative going into a receipt — decide explicitly whether a
receipt onto negative stock recomputes MAC using the full formula (mathematically valid, if slightly
unintuitive) or resets MAC to the receipt's own unit cost when `oldQty <= 0`. The spec is silent on
this; document whichever choice is made as a plan-time decision, not a discovered-in-code surprise.
**Warning signs:** `ArithmeticException: Non-terminating decimal expansion` if `BigDecimal.divide` is
called without an explicit scale+rounding mode (always use the 3-arg or 4-arg `divide` overload).

### Pitfall 5: `finance-service`'s Feign clients to pos-service/inventory-service do NOT propagate tenant/JWT

**What goes wrong:** `finance-service`'s `FeignClientConfig` (used by `PosInternalClient` AND
`InventoryInternalClient`) only sets the `X-Internal-Service` header — it does **not** forward
`Authorization` or set `X-Tenant-Id`, unlike the shared `FeignSharedConfig` documented in
`04-internal-api-contracts.md §4.3` (which forwards `Authorization` + `X-Correlation-Id` +
`X-Internal-Service`). This means `GET /internal/grn/pending-count` will arrive at
inventory-service with **no tenant context on the connection at all**.
**Why it happens:** `InternalPosController` (the live precedent for this exact call shape) works
around this by accepting an **optional** `X-Tenant-Id` request param/header and calling
`tenantContext.set(...)` manually if present — but since finance's Feign config doesn't send that
header either, in practice `InternalPosController.countOpenOrders` likely also runs with **no**
tenant context, meaning its `orderRepository.countOpenOrdersByBusinessDateRange` query executes under
FORCE RLS with an empty GUC and (per Pitfall 3, if unpatched, or) returns zero rows for every tenant.
This is a **pre-existing, cross-service systemic gap** in the period-close pre-check chain — not
something Phase 8 introduces, but the new `InternalGrnController` will inherit it, and the effective
behavior end-to-end today is that finance's period-close pre-checks (open orders / pending GRN /
unmatched invoices) may not actually be tenant-scoped correctly in production.
**How to avoid:** Mirror `InternalPosController`'s exact signature (bare `Long`/`long` return type,
optional `@RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId` param, manual
`tenantContext.set(...)` if provided and not already set) for `GET /internal/grn/pending-count` so
inventory-service is at least consistent with the one other service that implements this exact
contract shape today. Flag the finance→{pos,inventory} tenant-propagation gap explicitly as a
cross-cutting pending-todo (do not silently "fix" it in Phase 8 by changing `FeignClientConfig` —
that's a finance-service change outside this phase's scope, and STATE.md already tracks related
finance Feign-fallback TODOs under Phase 6/7/10).
**Warning signs:** `GrnPendingCountIT` (or equivalent) passing with a hard-coded/single-tenant
Testcontainers fixture but the live dev-stack period-close call always returning `0` regardless of
actual pending GRNs.

### Pitfall 6: The M2.4 spec pseudocode's naive per-line locking risks deadlock under concurrent closes

**What goes wrong:** The spec's `onOrderClosed` sample locks `IngredientBranchStock` rows one at a
time, in whatever order `recipe.getLines()` happens to iterate. Two orders closing concurrently, each
touching the same two ingredients (e.g. "Beef Patty" and "Cheese Slice") in *opposite* line order,
can deadlock under Postgres row-level locking.
**Why it happens:** Recipe line order is whatever was inserted, not a canonical/sorted order.
**How to avoid:** Before the lock-acquisition loop, collect the *distinct set* of ingredient IDs
needed across all recipe lines for the whole `ORDER_CLOSED` event, sort them (e.g. by UUID's natural
`compareTo`), then lock+process in that fixed order. See Pattern 2/Anti-Patterns above.
**Warning signs:** Intermittent `PSQLException: deadlock detected` under load-test / concurrent-IT
scenarios that don't reproduce with sequential single-order tests.

### Pitfall 7: The RabbitMQ retry/backoff config's actual "max" value differs slightly from the spec's stated "max 10s"

**What goes wrong:** `Docs/agent-specs/02-event-schema-registry.md §2.5` states "exponential backoff
(initial 2s, multiplier 2, max 10s)" — but kitchen-service's live `application.yml` (the actual
working D-03 precedent) sets `max-interval: 8000` (8s), not 10000.
**Why it happens:** Minor drift between the doc's prose and the implemented value; 2s → 4s → 8s is
the natural 3-attempt sequence with multiplier 2 starting at 2s (the third attempt's computed backoff
of 8s never reaches a 4th attempt where it would be capped at "10s" anyway, since `max-attempts: 3`).
**How to avoid:** Copy kitchen-service's exact `application.yml` retry block
(`initial-interval: 2000, max-attempts: 3, multiplier: 2.0, max-interval: 8000`) — it is internally
consistent with 3 attempts and is the actual running precedent; the doc's "max 10s" is imprecise
description of the same policy, not a different one to reconcile.
**Warning signs:** None functionally — just don't over-think reconciling 8000 vs 10000 during
planning; they describe the same 3-attempt policy.

### Pitfall 8: The API gateway has no live route to `pos-service` OR `inventory-service`

**What goes wrong:** `gateway/src/main/resources/application.yml` has an active route for
`auth-route`, `authorization-route`, `platform-admin-route`, `user-route`, `file-route`,
`feature-flags-route`, and `finance-route` — but the `pos-route` and `inventory-route` blocks are
both **commented out** ("Feature-flagged routes (later phases) — commented stubs"), and there is no
Java-side `RouteLocator` bean or discovery-locator config filling the gap.
**Why it happens:** Appears to be an overlooked wiring step from Phase 7 (pos-service) that was never
closed, and the inventory-route stub was pre-written for Phase 8 but never activated (both are
literally adjacent lines in the same commented block).
**How to avoid:** Phase 8, if it ships an Inventory Manager UI reachable via the gateway (§7.5), MUST
uncomment/activate the `inventory-route` block (`Path=/api/v1/inventory/**`, `lb://inventory-service`,
circuit breaker `inventoryCircuitBreaker`). Whether to also fix the pre-existing `pos-route` gap is a
**planner judgment call** — it predates and is unrelated to Phase 8's own requirements (INV-01..07
never route through `/api/v1/pos/**`), but if left broken, any live E2E/UAT hitting the gateway for
POS screens will keep failing for a reason unrelated to Phase 8's own changes, and a verifier might
misattribute it. Note also that `RouteFeatureMap.java` does NOT list `/api/v1/inventory/` →
`FEATURE_INVENTORY` — if inventory should be feature-gated like finance/hr/crm/nlq, that map needs
a new entry too (it currently only feature-gates finance/hr/crm/nlq/payroll/analytics/loyalty/
kds/ecommerce — inventory, like pos itself, is presently treated as an ungated "core" route family,
consistent with PLATFORM-10's "six primary modules... default ON in all tiers" but still gate-able by
SuperAdmin per-tenant override, so a `FEATURE_INVENTORY` mapping is arguably correct to add).
**Warning signs:** Any frontend `fetch('/api/v1/inventory/...')` through the gateway 404s even though
inventory-service itself is up and Eureka-registered; a raw `curl http://localhost:8085/...` direct
to the service succeeds while the same path through `:8080` fails.

### Pitfall 9: `stock_lots` cost retention is for audit/valuation only — never re-derive COGS from it

**What goes wrong:** It's tempting, once a `stock_lots` table with a `cost` column exists, to compute
COGS by summing `depletedQtyFromLot × lot.cost` across the lots touched by a FEFO walk (true
lot-costing) — this is more "accurate" in a naive sense and is what a from-scratch inventory design
would typically do.
**Why it happens:** D-04 explicitly requires physical FEFO rotation, and once you're already walking
lots to decrement quantities, it's a very small code change to also sum lot cost instead of
multiplying by the aggregate MAC — the "correct" MAC-based line is easy to accidentally skip.
**How to avoid:** COGS = `effectiveBaseQty × stock.avgCostPaisa` (the aggregate MAC), computed
**once per recipe line**, independent of which/how-many lots the FEFO walk touched to satisfy that
quantity. The FEFO lot walk's only job is decrementing `stock_lots.qty` rows (and floor-at-zero per
lot per D-02) — it must not feed its own cost data back into the COGS number. This is the single most
consequential "read the decision twice" item in this phase, per CONTEXT.md's own emphasis
("FEFO for physical rotation + MAC for valuation is a deliberate, explained split — keep them
distinct in the design").
**Warning signs:** `STOCK_DEPLETED.lines[].cogsPaisa` values that don't reduce to
`round(qty × avg_cost_paisa)` in a unit test — any test asserting COGS should assert against the
stock's `avg_cost_paisa` at the time of depletion, never against any lot's own `cost` field.

## Code Examples

### `ORDER_CLOSED` payload — exact wire shape this consumer receives

```java
// Source: services/pos-service/src/main/java/io/restaurantos/pos/event/PosClosePayloads.java (verified live code)
public record OrderClosedPayload(
        UUID orderId, String orderNo, String type, UUID customerId,
        long subtotalPaisa, long discountPaisa, long serviceChargePaisa, long taxPaisa, long totalPaisa,
        List<PaymentEntry> payments,
        List<ItemEntry> items,          // <-- inventory reads THIS list
        UUID tillSessionId, UUID cashierId, Instant closedAt
) {}

public record ItemEntry(
        UUID menuItemId, String name, int qty,     // qty is `int`, NOT BigDecimal
        long unitPricePaisa, long lineTotalPaisa
) {}
```
`branchId` and `tenantId` are on the `EventEnvelope`, not the payload itself — the consumer's
`DepletionService` should take `envelope.branchId()` and `envelope.payload().items()`, resolve a
recipe per `menuItemId`, and use `envelope.payload().closedAt()` for D-01's effective-version lookup.
There is **no `openedAt`** on this event — do not design around it being available.

### Recipe effective-version resolution query (D-01)

```java
// Pattern — no direct precedent exists yet in this repo; write fresh per D-01's locked semantics.
@Query("""
    SELECT r FROM Recipe r WHERE r.tenantId = :tenantId AND r.menuItemId = :menuItemId
      AND r.effectiveFrom <= :atInstant
    ORDER BY r.effectiveFrom DESC
    """)
List<Recipe> findEffectiveVersionsDesc(@Param("tenantId") UUID tenantId,
        @Param("menuItemId") UUID menuItemId, @Param("atInstant") Instant atInstant);
// Take .get(0) if non-empty; empty → "missing recipe, skip line" (Claude's Discretion item).
```
Recall the `recipes` table has `is_current` too — D-01 explicitly says do **not** query by
`is_current`; only `effective_from <= closedAt`, most-recent-first.

### MAC recompute on stock receipt (INV-04) — hand-written, no shared-lib helper exists

```java
// Pattern — write fresh in inventory-service; no MoneyUtils equivalent exists (Pitfall 4).
static long recomputeAvgCostPaisa(BigDecimal oldQty, long oldAvgCostPaisa,
                                   BigDecimal recvQty, long recvUnitCostPaisa) {
    BigDecimal oldValue = oldQty.multiply(BigDecimal.valueOf(oldAvgCostPaisa));
    BigDecimal recvValue = recvQty.multiply(BigDecimal.valueOf(recvUnitCostPaisa));
    BigDecimal newQty = oldQty.add(recvQty);
    if (newQty.signum() == 0) {
        return recvUnitCostPaisa; // degenerate: nothing on hand before and after (shouldn't occur on receipt)
    }
    return oldValue.add(recvValue)
            .divide(newQty, 0, RoundingMode.HALF_UP)   // HALF_UP mirrors MoneyUtils.fromPkr, NOT taxPerLine
            .longValueExact();
}
```

### FEFO lot walk with floor-at-zero (D-02 + D-04 composed)

```java
// Pattern — new domain logic, mirrors the "walk sorted list, subtract, floor" shape used nowhere
// else in this repo yet.
BigDecimal remaining = effectiveBaseQty;
for (StockLot lot : stockLotRepository.findByStockIdOrderByExpiryDateAsc(stockId)) {
    if (remaining.signum() <= 0) break;
    BigDecimal take = lot.getQty().min(remaining);      // floor-at-zero per lot (D-02)
    lot.setQty(lot.getQty().subtract(take));
    remaining = remaining.subtract(take);
}
// `remaining` > 0 here means lots were insufficient — the AGGREGATE qty_on_hand still goes negative
// by the full effectiveBaseQty (D-02), even though lot rows never go below zero individually.
stock.setQtyOnHand(stock.getQtyOnHand().subtract(effectiveBaseQty));
```

### Internal GRN pending-count endpoint — exact contract finance-service expects

```java
// Source: services/finance-service/.../feign/InventoryInternalClient.java (verified live code)
// GET /internal/grn/pending-count?periodEnd=2026-07-31  →  bare `long` body (NOT ApiResponse-wrapped)
@GetMapping("/internal/grn/pending-count")
public ResponseEntity<Long> pendingGrnCount(
        @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd,
        @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
    // mirror InternalPosController's exact pattern — see Pitfall 5 for why tenantId may be null
    if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
        tenantContext.set(tenantId, null, null, null);
    }
    long count = 0L; // Phase 8: purchasing/GRN doesn't exist yet (Phase 10) — always 0 until then,
                      // OR count unposted STOCK_RECEIVED-originated movements if inventory tracks
                      // "pending" receipts itself. Planner's call on what "pending GRN" means before
                      // Phase 10's purchasing-service exists.
    return ResponseEntity.ok(count);
}
```
Note the `InventoryInternalClientFallback` in finance-service currently hard-codes `return 0L` with a
`// TODO Phase 8: implement real inventory endpoint` comment — that fallback class stays in place
unchanged (it's the circuit-breaker fallback, not the real implementation); this phase only needs to
make the *real* call succeed when inventory-service is up.

### OPA policy — this repo has no `inventory.rego` yet; permission codes already exist

```rego
# Pattern — mirror policies/restaurantos/kds.rego's exact shape.
# permission codes already seeded: inventory.item.view, inventory.item.manage
# (services/auth-service/.../030-create-roles-permissions.xml, lines 73-74, 112-113, 124-125)
package restaurantos.inventory

import data.restaurantos.common

default allow := false

allow if {
    common.has_permission(input, "inventory.item.view")
    common.same_tenant_and_branch(input)
}

allow if {
    input.action == "inventory.item.manage"
    common.has_permission(input, "inventory.item.manage")
    common.same_tenant_and_branch(input)
}
```
If write endpoints (receipts/transfers/counts) need a finer-grained permission than the existing
coarse `inventory.item.manage`, new permission codes need a new auth-service Liquibase changeset
(e.g. `045-inventory-receipt-permissions.xml`, mirroring `044-finance-period-open-permission.xml`'s
pattern) — that's a cross-service change the planner should flag as a dependency, not silently skip.
**CI requires OPA coverage = 100%** — any new `.rego` file needs a matching `tests/inventory_test.rego`
with `opa test policies/ --coverage` still reporting 100 (currently policies exist for
common/finance/kds/pos/rbac/vendor only; no inventory.rego = no gap today, but adding one without
100%-covering tests would newly fail CI).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| finance-service V1 RLS without FORCE | inventory-service V1 RLS WITH FORCE (CONTEXT.md D-locked) | This phase | inventory-service becomes the first service matching the documented convention; does not retroactively fix finance/kitchen |
| finance-service V1 RLS without `NULLIF` GUC guard | inventory-service V1 RLS WITH `NULLIF(...,'')` from the start | This phase (following kitchen-service's already-corrected pattern) | Avoids needing a follow-up "V4-style" fix migration like finance needed |
| Spec's naive per-line stock locking | Pre-sorted deterministic lock order across the whole `ORDER_CLOSED` event | Plan-time recommendation, not yet implemented anywhere | Prevents a deadlock class the spec's sample code doesn't defend against |

**Deprecated/outdated:**
- `08-database-migration-guide.md`'s Liquibase XML examples: superseded in practice by Flyway SQL
  since Phase 6 (`[06-01-A]`), never updated in the doc. Use the doc's *SQL content*, not its
  Liquibase XML wrapper.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `GET /internal/grn/pending-count`'s real (non-fallback) semantics before Phase 10's purchasing-service exists should return `0` (no GRN concept exists yet in inventory-service's own domain) | Code Examples | If the planner instead wants inventory-service to track a "pending receipt" concept internally this phase, that changes the schema scope; low risk since CONTEXT.md already scopes GRN/PO to Phase 10 |
| A2 | `AbstractRlsCoverageTest` (mentioned in `rls-convention.md §7`) is either not currently run in CI, or currently passes despite existing services lacking `FORCE ROW LEVEL SECURITY` (contradiction observed, not resolved this session — see Pitfall 2) | Pitfall 2 | If the test DOES run and DOES check for FORCE today, then finance/kitchen/pos would already be failing CI, which contradicts STATE.md showing those phases as verified/complete — most likely the test doesn't check FORCE, or doesn't run at all; planner should not assume it will catch a missing-FORCE regression in inventory-service without verifying that test's actual current behavior first |
| A3 | `RouteFeatureMap` should gain a `/api/v1/inventory/` → `FEATURE_INVENTORY` entry this phase (Pitfall 8) | Pitfall 8 | If inventory is meant to stay an ungated "core" route like `/api/v1/pos/` currently is (no map entry), adding the FEATURE_INVENTORY gate would be an unrequested behavior change; needs explicit planner decision, not silent inclusion |
| A4 | Testcontainers `rabbitmq` Maven test-dependency may not be strictly required in `pom.xml` if `BaseIntegrationTest` starts a `RabbitMQContainer` via the generic Testcontainers core artifact already pulled in transitively | Standard Stack (Supporting) | Low risk — worst case, `mvn test-compile` fails immediately with a clear "cannot resolve symbol RabbitMQContainer" and the fix (add the dependency) is a one-line pom.xml edit; verify against kitchen-service's actual pom.xml before the plan finalizes IT tooling |

**If this table is empty:** N/A — see rows above.

## Open Questions

1. **Does `stock_lots` need its own RLS + audit-column set (full `TenantAuditableEntity`), or is it a
   lightweight child table keyed only through `ingredient_branch_stock`?** — **RESOLVED (planned):**
   plan 08-01 gives `stock_lots` its own `tenant_id`/`branch_id` columns + FORCE RLS (per the
   recommendation below), so the nightly expiry sweep queries lots directly without joining through
   the parent stock row.
   - What we know: D-04 says "each stock receipt creates a lot row" and treats `stock_lots` as a
     first-class ledger ("source of truth for rotation and expiry").
   - What's unclear: Whether it needs full tenant/branch columns of its own (for direct RLS-scoped
     querying by the nightly expiry sweep) or can be scoped transitively via its parent stock row's
     `tenant_id`/`branch_id` FK.
   - Recommendation: Give it its own `tenant_id`/`branch_id` columns + full RLS (matching
     `TenantAuditableEntity`) — the nightly `@Scheduled` sweep needs to query lots directly across
     all stock rows for a tenant, which is far more efficient with lots pre-scoped than joining
     through `ingredient_branch_stock` on every sweep tick.

2. **Should count-variance / transfer / wastage JEs post synchronously (via
   `POST /internal/finance/journal-entries`) or wait for a Phase-9 event consumer?** — **RESOLVED
   (planner's call, per CONTEXT.md):** the plans chose **event-only** — `COUNT_VARIANCE_POSTED`,
   `TRANSFER_*`, and `STOCK_DEPLETED` are published but NO synchronous `POST /internal/finance/journal-entries`
   is made, deferring all inventory→finance GL posting to Phase 9 (ROADMAP Phase 9 SC1 explicitly owns
   refund/wastage/stock-count/transfer auto-posting). This diverges from the synchronous lean recommended
   below; the divergence is deliberate and documented in the plans to keep the Phase 8/9 boundary clean.
   - What we know: The endpoint exists today and is dedup'd by `(sourceType, sourceId)`; `STOCK_DEPLETED`
     (order COGS) is explicitly event-only this phase (finance has no consumer for it yet).
   - What's unclear: Whether count/transfer/wastage JEs are urgent enough (immediate GL accuracy) to
     justify the synchronous coupling, versus staying consistent with the "Phase 9 owns all
     inventory→finance posting" narrative.
   - Recommendation: CONTEXT.md already marks this "planner's call" — lean toward the synchronous
     `POST /internal/finance/journal-entries` path for count/transfer/wastage (lower volume, event-like
     semantics don't add much value here, and the endpoint already exists and is proven from
     Phase 6/7), while `STOCK_DEPLETED` stays event-only per the explicit Phase 9 boundary (order-close
     volume is much higher — synchronous coupling there would slow down order close latency, which
     M1.5's acceptance criteria bounds at "within 3 seconds").

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL (`inventory_db`) | Schema/data | Provisioned (not live-probed this session) | 18 (per `deploy/init`, matches other DBs) | — |
| RabbitMQ (`inventory.order-closed.queue`, `inventory.topic`) | Consumer + publisher | Pre-declared in `deploy/init/rabbitmq-definitions.json` | 4.3 | — |
| Eureka / Config Server | Service registration/config | Already running for other 10 services | — | — |
| Gateway route `/api/v1/inventory/**` | UI reachability | **Missing — commented stub** (Pitfall 8) | — | Direct `curl :8085` works for backend-only verification; UI needs the route activated |

**Missing dependencies with no fallback:**
- Gateway `inventory-route` — must be uncommented/activated for any browser-facing UI to reach the
  service through the standard `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080` path.

**Missing dependencies with fallback:**
- None beyond the gateway route above (backend-only verification can bypass the gateway during
  development, hitting `http://localhost:8085` directly).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | JUnit 5 + Testcontainers (PostgreSQL, RabbitMQ) + AssertJ + Awaitility, matching `BaseIntegrationTest` shape from `10-test-architecture-guide.md §10.1` and every existing service's `src/test/java` |
| Config file | none yet — Wave 0 creates `services/inventory-service/src/test/java/io/restaurantos/inventory/BaseIntegrationTest.java` + `TestFixtures.java` (copy kitchen-service's, rename package) |
| Quick run command | `mvn -pl services/inventory-service -am test` (unit tests only, `*Test.java`, excludes `*IT.java` per surefire config in every existing `pom.xml`) |
| Full suite command | `mvn -pl services/inventory-service -am verify -Dtestcontainers.reuse.enable=false` (runs `*IT.java` via failsafe, requires Docker) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INV-01 | Ingredient/UOM/reorder-point CRUD | integration | `mvn -pl services/inventory-service test -Dtest=IngredientAdminIT` | ❌ Wave 0 |
| INV-02 | Recipe version resolved by `closedAt` window, not `is_current` | unit + integration | `mvn -pl services/inventory-service test -Dtest=RecipeVersionResolutionTest,RecipeVersionResolutionIT` | ❌ Wave 0 |
| INV-03 | Depletion: `SELECT FOR UPDATE`, MAC maintained, idempotent on duplicate `ORDER_CLOSED` | integration | `mvn -pl services/inventory-service test -Dtest=DepletionConsumerIT` (mirrors §10.3's exact example — publish envelope twice, assert single depletion) | ❌ Wave 0 |
| INV-03 (negative stock) | Oversell allows negative aggregate; lots floor at zero (D-02) | unit | `mvn -pl services/inventory-service test -Dtest=FefoLotWalkTest` | ❌ Wave 0 |
| INV-04 | Receipt updates MAC correctly; `STOCK_RECEIVED` published via outbox | unit + integration | `mvn -pl services/inventory-service test -Dtest=MacCalculatorTest,ReceiptServiceIT` | ❌ Wave 0 |
| INV-05 | Transfer ship/receive, in-transit accounting, variance-on-receive | integration | `mvn -pl services/inventory-service test -Dtest=TransferLifecycleIT` | ❌ Wave 0 |
| INV-06 | Count variance posting; low-stock alert threshold; nightly expiry sweep | integration | `mvn -pl services/inventory-service test -Dtest=StockCountIT,ExpirySweepIT,LowStockAlertIT` | ❌ Wave 0 |
| INV-07 | Opening balance recorded as `OPENING_BALANCE` movement | integration | `mvn -pl services/inventory-service test -Dtest=OpeningBalanceIT` | ❌ Wave 0 |
| (finance seam) | `GET /internal/grn/pending-count` returns bare `long`, correct contract | integration | `mvn -pl services/inventory-service test -Dtest=GrnPendingCountIT` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `mvn -pl services/inventory-service -am test` (fast unit tests: MAC math, FEFO
  walk, recipe-version resolution — no Docker needed)
- **Per wave merge:** `mvn -pl services/inventory-service -am verify` (full Testcontainers IT suite)
- **Phase gate:** Full suite green + `mvn -pl services/inventory-service verify -Pcoverage` ≥75% line
  coverage (already forward-declared in `.github/workflows/coverage-gates.json` — no CI config change
  needed, just the module existing and passing) before `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `services/inventory-service/src/test/java/io/restaurantos/inventory/BaseIntegrationTest.java` —
  copy kitchen-service's, adjust package + DB name (`inventory_db`/`inventory_user`)
- [ ] `services/inventory-service/src/test/java/io/restaurantos/inventory/TestFixtures.java` — copy
  verbatim (JWT-building logic is service-agnostic), add an `INVENTORY_MANAGER` role JWT builder
  variant alongside owner/manager/cashier
- [ ] `InventoryFixtures` helper (seed ingredient + stock + recipe rows for tests) — referenced by
  `10-test-architecture-guide.md §10.3`'s own example but doesn't exist yet
- [ ] Framework install: none — Testcontainers/JUnit5/AssertJ/Awaitility all come from the parent POM's
  managed dependency versions already used by kitchen-service/finance-service/pos-service

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Standard JWT filter (shared-lib), same as every other service — internal endpoints ALSO require `X-Internal-Service` header per `04-internal-api-contracts.md §4.1` |
| V3 Session Management | no | No session state owned by this service |
| V4 Access Control | yes | OPA policy (`inventory.rego`, new this phase) + tenant/branch RLS; existing `inventory.item.view`/`inventory.item.manage` permission codes, `MANAGER`+`INVENTORY_MANAGER` role grants |
| V5 Input Validation | yes | `jakarta.validation` `@Valid` on all controller request DTOs (mirrors every other service); reject negative `qty` on receipt/count creation at the API boundary (D-02's "negative allowed" applies only to *depletion-derived* on-hand, not to a manager typing a negative receipt quantity) |
| V6 Cryptography | no | No new secrets/PII fields this phase (ingredients/recipes/stock are not sensitive data classes) |
| V9 Data Protection | yes | RLS (FORCE, per Pitfall 2/D-locked) on every domain table; internal endpoint tenant isolation caveat per Pitfall 5 |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-tenant stock read/write via a guessed `ingredientId`/`stockId` UUID | Elevation of Privilege | RLS FORCE + policy on every table; repository queries additionally scope by `tenantId` explicitly (defense in depth, matches every existing repository's `WHERE s.tenantId = :tenantId` pattern) |
| Replayed/duplicated `ORDER_CLOSED` delivery double-depleting stock | Repudiation / Tampering | `processed_events` idempotency (D-03, already locked) — this is the primary mitigation, verified via `DepletionConsumerIT`'s duplicate-publish test |
| Internal endpoint (`/internal/grn/pending-count`) called without the shared secret | Spoofing | `X-Internal-Service` header, constant-time comparison — mirrors every other `/internal/*` endpoint in this repo |
| Race between concurrent receipts and depletions producing a torn MAC read/write | Tampering (data integrity) | `PESSIMISTIC_WRITE` row lock on `ingredient_branch_stock` for the *entire* read-modify-write of both `qty_on_hand` and `avg_cost_paisa` together — never split into two separate transactions |

## Sources

### Primary (HIGH confidence — read directly from this repo's live source this session)

- `services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderClosedConsumer.java` — idempotent consumer pattern
- `services/kitchen-service/src/main/java/io/restaurantos/kitchen/service/ProcessedEventService.java` — dedup pattern
- `services/kitchen-service/src/main/resources/db/migration/V1__kitchen_schema.sql`, `V2__kitchen_infra_tables.sql` — Flyway RLS + infra-table pattern (post-fix, correct `NULLIF` GUC guard)
- `services/kitchen-service/src/main/resources/application.yml` — RabbitMQ listener retry/backoff config
- `services/finance-service/src/main/resources/db/migration/V1__finance_schema.sql`, `V4__fix_rls_tenant_guc_policies.sql` — the original RLS bug + its fix (Pitfall 3)
- `services/finance-service/src/main/java/io/restaurantos/finance/feign/InventoryInternalClient.java`, `InventoryInternalClientFallback.java`, `service/PeriodCloseService.java`, `config/FeignClientConfig.java` — exact `/internal/grn/pending-count` contract + tenant-propagation gap
- `services/pos-service/src/main/java/io/restaurantos/pos/web/InternalPosController.java` — the working precedent for the bare-`Long` internal-endpoint contract
- `services/pos-service/src/main/java/io/restaurantos/pos/repository/OrderSequenceRepository.java` — `PESSIMISTIC_WRITE` pattern
- `services/pos-service/src/main/java/io/restaurantos/pos/event/PosClosePayloads.java` — exact `ORDER_CLOSED` wire shape
- `shared-lib/src/main/java/io/restaurantos/shared/{money/MoneyUtils,entity/TenantAuditableEntity,event/DomainEventPublisher,event/EventPublisher,tenant/TenantAwareMessageProcessor,tenant/TenantContext}.java`
- `gateway/src/main/resources/application.yml`, `gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java` — confirmed missing pos/inventory routes (Pitfall 8)
- `deploy/init/{01-create-databases,02-create-roles,03-grant-schema-privileges}.sql`, `deploy/init/rabbitmq-definitions.json` — confirmed inventory_db/inventory_user + queue pre-provisioning
- `.github/workflows/coverage-gates.json` — confirmed 75% inventory-service gate already forward-declared
- `services/auth-service/src/main/resources/db/changelog/v1.0.0/030-create-roles-permissions.xml` — confirmed existing `inventory.item.view`/`inventory.item.manage` permission codes + `INVENTORY_MANAGER` role
- `policies/restaurantos/{common,kds}.rego` — OPA policy shape to mirror for `inventory.rego`
- `Docs/RestaurantERP_SaaS_Specification.md` §M2 (data model, M2.4 depletion algorithm), §M3.4 (GL auto-posting map)
- `Docs/agent-specs/02-event-schema-registry.md` (envelope, topology, event shapes, idempotency, DLQ policy)
- `Docs/agent-specs/04-internal-api-contracts.md` (internal endpoint convention, `FeignSharedConfig` reference)
- `Docs/agent-specs/08-database-migration-guide.md` (RLS SQL content — correct despite Liquibase wrapper being stale, Pitfall 1)
- `Docs/agent-specs/10-test-architecture-guide.md` (Testcontainers base pattern, coverage table, RabbitMQ consumer test pattern)
- `Docs/conventions/rls-convention.md` (RLS convention, RLS-exempt infra tables)
- `Docs/RestaurantOS_UI_UX_Design_System.md` §7.5 (Inventory Manager UX)
- `.planning/phases/08-inventory-recipe-management/08-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

### Secondary (MEDIUM confidence)

- None — this research relied entirely on direct repo inspection (Primary sources); no external web
  search was needed since every question was answerable from this codebase's own committed history
  and canonical spec docs.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency verified by reading a live, building `pom.xml` in this repo
- Architecture: HIGH — every pattern (outbox, idempotent consumer, pessimistic lock, RLS) has a direct, cited, working precedent in kitchen-service/pos-service/finance-service
- Pitfalls: HIGH — Pitfalls 1-3, 5, 7-8 are all confirmed by direct code inspection (not inferred); Pitfall 4/6/9 are domain-logic risks inferred from the spec + D-04's explicit emphasis, not yet code-verified since no MAC/FEFO code exists anywhere in this repo yet

**Research date:** 2026-07-13
**Valid until:** 30 days (stable internal-monorepo conventions; re-verify if `finance-service` or
`kitchen-service` migrations change again before Phase 8 planning executes, since several pitfalls
here are pinned to their exact current file contents)
