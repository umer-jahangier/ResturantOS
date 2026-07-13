# Phase 8: Inventory & Recipe Management - Pattern Map

**Mapped:** 2026-07-13
**Files analyzed:** ~28 (new `services/inventory-service` module)
**Analogs found:** 22 / 28 (6 have no direct analog — see § No Analog Found)

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|-----------------|---------------|
| `inventory-service/pom.xml` | config | — | `services/kitchen-service/pom.xml` | exact |
| `InventoryServiceApplication.java` | config | — | `services/kitchen-service/.../KitchenServiceApplication.java` | exact |
| `application.yml` | config | — | `services/kitchen-service/src/main/resources/application.yml` | exact |
| `config/InventoryRabbitConfig.java` | config | event-driven | `services/kitchen-service/.../config/KitchenRabbitConfig.java` | exact |
| `consumer/OrderClosedConsumer.java` | event consumer | event-driven | `services/kitchen-service/.../consumer/OrderClosedConsumer.java` | exact |
| `service/ProcessedEventService.java` | service (idempotency) | event-driven | `services/kitchen-service/.../service/ProcessedEventService.java` | exact (copy verbatim, rename package) |
| `entity/ProcessedEventEntity.java` + `repository/ProcessedEventJpaRepository.java` | model/repository | event-driven | `services/kitchen-service/.../entity/ProcessedEventEntity.java` + repo | exact |
| `domain/model/IngredientBranchStock.java` | model | CRUD | `shared-lib/.../entity/TenantAuditableEntity.java` (base) + `services/pos-service/.../domain/model/OrderSequence.java` (composite-key stock row shape) | role-match |
| `repository/IngredientBranchStockRepository.java` (`findForUpdate`) | repository | CRUD (pessimistic lock) | `services/pos-service/.../repository/OrderSequenceRepository.java` | exact |
| `repository/StockLotRepository.java` (FEFO query) | repository | CRUD | `services/pos-service/.../repository/OrderSequenceRepository.java` (query-method shape); no FEFO precedent exists | partial |
| `repository/RecipeRepository.java` (`findEffectiveVersionsDesc`) | repository | CRUD | no direct precedent — see spec query in RESEARCH.md | no analog (fresh query, JPQL style mirrors `OrderSequenceRepository`) |
| `service/DepletionService.java` | service | event-driven + CRUD | `services/kitchen-service/.../service/TicketRoutingService.java` (orchestration shape) + MAC/FEFO domain math is genuinely new | partial |
| `service/MacCalculator.java` | utility | transform | `shared-lib/.../money/MoneyUtils.java` (rounding-mode convention only; no weighted-avg helper exists) | no analog (new domain math) |
| `service/ReceiptService.java` | service | CRUD | `services/pos-service/.../service/OrderServiceImpl.java` (transactional write + outbox publish shape) | role-match |
| `service/TransferService.java` | service | CRUD | `services/pos-service/.../service/OrderServiceImpl.java` (transactional write + outbox publish shape) | role-match |
| `service/StockCountService.java` | service | CRUD | `services/pos-service/.../service/OrderServiceImpl.java` | role-match |
| `service/ExpirySweepService.java` (`@Scheduled`) | service | batch | no direct `@Scheduled` sweep precedent found in this repo — nearest structural cousin is the outbox-relay batch-poll pattern (`OutboxRelay`, not read this pass) | no analog (new — first scheduled sweep in repo) |
| `event/InventoryEventPayloads.java` | model (DTO/records) | event-driven | `services/pos-service/.../event/PosClosePayloads.java` (`services/kitchen-service/.../event/KitchenEventPayloads.java` also valid) | exact |
| `web/InternalGrnController.java` (`GET /internal/grn/pending-count`) | controller | request-response | `services/pos-service/.../web/InternalPosController.java` | exact |
| `web/IngredientController.java`, `RecipeController.java`, `ReceiptController.java`, `TransferController.java`, `StockCountController.java` | controller | CRUD / request-response | `services/pos-service/.../web/MenuController.java` (recently modified, CRUD + DTO validation shape) | role-match |
| `db/migration/V1__inventory_schema.sql` | migration | — | `services/finance-service/.../V1__finance_schema.sql` (RLS block) — but see Pitfall 2: **add FORCE clause, finance's V1 omits it** | role-match (with a required deviation) |
| `db/migration/V2__shared_infra_tables.sql` | migration | — | `services/finance-service/.../V2__shared_infra_tables.sql` | exact (copy verbatim, swap `finance_user` → `inventory_user`) |
| `test/.../InventoryTestBase.java` | test (IT base) | — | `services/kitchen-service/src/test/java/.../KitchenTestBase.java` | exact |
| `test/.../DepletionServiceIT.java`, `MacRecomputeIT.java`, etc. | test | CRUD/event-driven | `services/kitchen-service/src/test/java/.../TicketLifecycleIT.java`, `StationProjectionRoutingIT.java` | role-match |

## Pattern Assignments

### `consumer/OrderClosedConsumer.java` (event consumer, event-driven)

**Analog:** `services/kitchen-service/src/main/java/io/restaurantos/kitchen/consumer/OrderClosedConsumer.java` (full file, 73 lines — read in full, small file)

Copy this file's shape verbatim, retargeting package/imports and swapping the business handler call:

```java
// Imports (lines 1-14)
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.event.InventoryEventPayloads.OrderClosedPayload;
import io.restaurantos.inventory.service.ProcessedEventService;
import io.restaurantos.inventory.service.DepletionService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

// Core pattern (lines 43-59) — CONSUMER_NAME per D-03 must be "inventory.depletion"
static final String CONSUMER_NAME = "inventory.depletion";

@RabbitListener(queues = InventoryRabbitConfig.INVENTORY_ORDER_CLOSED_QUEUE)
public void onMessage(Message message) {
    EventEnvelope<OrderClosedPayload> envelope = deserialize(message);
    if (envelope == null) {
        log.warn("OrderClosedConsumer: could not deserialize message — skipping");
        return;
    }
    processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
            tenantAwareMessageProcessor.process(envelope, env ->
                    depletionService.deplete(env.branchId(), env.payload())
            )
    );
}

// Deserialize helper (lines 61-71) — copy verbatim, same try/catch-log-null-return shape
```

Note: unlike kitchen's payload (`OrderClosedPayload` with just `orderId`), inventory's `OrderClosedPayload`
must mirror `PosClosePayloads.OrderClosedPayload` exactly (see event payload excerpt below) since
`items[]` + `closedAt` are both required for depletion.

---

### `service/ProcessedEventService.java` (service, idempotency — shared cross-cutting)

**Analog:** `services/kitchen-service/src/main/java/io/restaurantos/kitchen/service/ProcessedEventService.java` (full file, 37 lines)

Copy **verbatim**, only changing the package declaration and the entity/repository import paths:

```java
@Service
public class ProcessedEventService {
    private final ProcessedEventJpaRepository repository;

    public ProcessedEventService(ProcessedEventJpaRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public boolean tryProcess(String consumerName, UUID eventId, Runnable action) {
        if (repository.existsByConsumerAndEventId(consumerName, eventId)) {
            return false;
        }
        action.run();
        repository.save(ProcessedEventEntity.builder()
                .consumer(consumerName)
                .eventId(eventId)
                .build());
        return true;
    }
}
```

Requires a matching `ProcessedEventEntity` (`entity/`) and `ProcessedEventJpaRepository`
(`repository/` with `existsByConsumerAndEventId`) — also copy those two small files verbatim from
kitchen-service.

---

### `repository/IngredientBranchStockRepository.java` (repository, pessimistic-lock CRUD)

**Analog:** `services/pos-service/src/main/java/io/restaurantos/pos/repository/OrderSequenceRepository.java` (full file, 26 lines)

```java
@Repository
public interface IngredientBranchStockRepository extends JpaRepository<IngredientBranchStock, UUID> {

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT s FROM IngredientBranchStock s WHERE s.tenantId = :tenantId "
         + "AND s.branchId = :branchId AND s.ingredientId = :ingredientId")
    Optional<IngredientBranchStock> findForUpdate(
            @Param("tenantId") UUID tenantId,
            @Param("branchId") UUID branchId,
            @Param("ingredientId") UUID ingredientId);
}
```

**Deviation from analog required (Pitfall 6 / Pattern 2 in RESEARCH.md):** `OrderSequenceRepository`
is only ever called for a single composite key per transaction, so lock-ordering is a non-issue there.
`IngredientBranchStockRepository.findForUpdate` will be called in a loop across multiple ingredients
per `ORDER_CLOSED` event — the caller (`DepletionService`) MUST pre-sort the distinct `ingredientId`
set before the lock-acquisition loop. Do not copy the "lock lazily per line" shape from the M2.4 spec
pseudocode.

---

### `event/InventoryEventPayloads.java` (model/DTO, event-driven)

**Analog:** `services/pos-service/src/main/java/io/restaurantos/pos/event/PosClosePayloads.java` (record-style event payloads)

The exact inbound wire shape this consumer must deserialize (verified live code, `PosClosePayloads.java`):

```java
public record OrderClosedPayload(
        UUID orderId, String orderNo, String type, UUID customerId,
        long subtotalPaisa, long discountPaisa, long serviceChargePaisa, long taxPaisa, long totalPaisa,
        List<PaymentEntry> payments,
        List<ItemEntry> items,          // inventory reads THIS list
        UUID tillSessionId, UUID cashierId, Instant closedAt
) {}

public record ItemEntry(
        UUID menuItemId, String name, int qty,     // qty is int, NOT BigDecimal
        long unitPricePaisa, long lineTotalPaisa
) {}
```

`InventoryEventPayloads.java` should define this same `OrderClosedPayload`/`ItemEntry` shape
(inbound, for deserialization) PLUS the outbound records: `StockDepletedPayload`,
`StockReceivedPayload`, `LowStockAlertPayload`, `ExpiryAlertPayload{lotId, expiresOn}`,
`CountVariancePostedPayload`, `WastageRecordedPayload`, `TransferShippedPayload`,
`TransferReceivedPayload`, `TransferVariancePayload` — follow the same flat Java `record` style as
`KitchenEventPayloads.java`.

---

### `service/ReceiptService.java` / `TransferService.java` / `StockCountService.java` (service, CRUD + outbox publish)

**Analog:** `services/pos-service/src/main/java/io/restaurantos/pos/service/OrderServiceImpl.java`, lines 655-680 (outbox publish call site — read directly, not the whole 700+ line file)

```java
var payload = new PosClosePayloads.OrderClosedPayload(
        finalOrder.getId(), finalOrder.getOrderNo(), finalOrder.getType().name(),
        finalOrder.getCustomerId(), finalOrder.getSubtotalPaisa(), finalOrder.getDiscountPaisa(),
        finalOrder.getServiceChargePaisa(), finalOrder.getTaxPaisa(), finalOrder.getTotalPaisa(),
        paymentEntries, itemEntries, finalOrder.getTillSessionId(), finalOrder.getCashierId(), closedAt
);

eventPublisher.publish(POS_EXCHANGE, ORDER_CLOSED_KEY, ORDER_CLOSED_TYPE,
        finalOrder.getBranchId(), payload);

return finalOrder;
```

Pattern to replicate: build the outbound payload record from already-mutated entity state, call
`eventPublisher.publish(exchange, routingKey, eventType, branchId, payload)` as the LAST statement
inside the same `@Transactional` method that wrote the business-state change (never after commit,
never from a separate method) — this is `DomainEventPublisher`'s outbox-insert contract. For
inventory: `ReceiptService.receive(...)` publishes `STOCK_RECEIVED`, `TransferService.ship/receive`
publishes `TRANSFER_SHIPPED`/`TRANSFER_RECEIVED`/`TRANSFER_VARIANCE`, `StockCountService.postVariance`
publishes `COUNT_VARIANCE_POSTED`.

---

### `web/InternalGrnController.java` (controller, request-response — REQUIRED, INV endpoint)

**Analog:** `services/pos-service/src/main/java/io/restaurantos/pos/web/InternalPosController.java` (full file, 48 lines)

This is the exact contract to mirror — bare `Long`/`long` return (NOT `ApiResponse`-wrapped), optional
`X-Tenant-Id` header with manual `tenantContext.set(...)`:

```java
@RestController
@RequestMapping("/internal")
public class InternalGrnController {

    private final GrnPendingCountRepository grnPendingCountRepository; // or ReceiptRepository query
    private final TenantContext tenantContext;

    @GetMapping("/grn/pending-count")
    public ResponseEntity<Long> pendingGrnCount(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate periodEnd,
            @RequestHeader(value = "X-Tenant-Id", required = false) UUID tenantId) {
        if (tenantId != null && tenantContext.getTenantId().isEmpty()) {
            tenantContext.set(tenantId, null, null, null);
        }
        long count = grnPendingCountRepository.countPendingAsOf(periodEnd);
        return ResponseEntity.ok(count);
    }
}
```

**Note (Pitfall 5 in RESEARCH.md):** finance's Feign client does not forward `X-Tenant-Id` today, so
in production this header will likely arrive null and the query will run with no tenant GUC set under
FORCE RLS — this is a pre-existing cross-service gap, not something to silently patch in this
controller. Match `InternalPosController`'s behavior exactly (including the gap) for consistency;
flag it as a known cross-cutting issue, do not touch `FeignClientConfig` in finance-service.

Do NOT use `InternalFinanceController`'s pattern (`@RequestHeader("X-Tenant-Id") UUID tenantId`
required + `ApiResponse`-wrapped + `tenantHelper.activate/clear`) for this specific endpoint —
finance's own client only ever calls the pos-shaped bare-`Long` contract for this kind of pre-check.
`InternalFinanceController`'s `activate/clear` pattern IS the right analog if inventory ever needs to
add its own required-header/`ApiResponse`-wrapped internal endpoints later (e.g. a hypothetical
inventory endpoint another service calls with guaranteed tenant propagation).

---

### `db/migration/V1__inventory_schema.sql` (migration — RLS, tenant-scoped tables)

**Analog:** `services/finance-service/src/main/resources/db/migration/V1__finance_schema.sql` (RLS block pattern; not fully read this pass — RESEARCH.md already extracted and verified the exact block, reproduced below) — **required deviation: add FORCE**

```sql
ALTER TABLE ingredient_branch_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_branch_stock FORCE ROW LEVEL SECURITY;  -- finance/kitchen V1 OMIT this — Pitfall 2
                                                                 -- CONTEXT.md mandates it from V1 here
CREATE POLICY tenant_isolation ON ingredient_branch_stock
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
    -- NULLIF(...,'') wrapper mandatory — Pitfall 3 (finance shipped without it, needed a V4 hotfix)
```

Apply this ENABLE + FORCE + NULLIF-guarded POLICY block to every domain table: `ingredients`,
`units_of_measure`, `ingredient_branch_stock`, `stock_lots`, `recipes`, `recipe_lines`,
`inventory_movements`, transfer tables, count tables. Do NOT copy finance's or kitchen's actual V1 SQL
verbatim — both are missing the FORCE line; inventory-service is intended to be the first service in
the repo that matches the documented convention exactly.

---

### `db/migration/V2__shared_infra_tables.sql` (migration — RLS-exempt infra tables)

**Analog:** `services/finance-service/src/main/resources/db/migration/V2__shared_infra_tables.sql` (full file, 47 lines)

Copy **verbatim**, only substituting `finance_user` → `inventory_user` in the three `GRANT` statements
and updating the index name comment prefix (`idx_finance_...` → `idx_inventory_...`, cosmetic):

```sql
CREATE TABLE event_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), event_id UUID NOT NULL, exchange TEXT NOT NULL,
    routing_key TEXT NOT NULL, event_type TEXT NOT NULL, tenant_id UUID NOT NULL, branch_id UUID,
    correlation_id UUID NOT NULL, source TEXT NOT NULL, envelope_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), sent_at TIMESTAMPTZ
);
CREATE INDEX idx_inventory_event_outbox_status_created ON event_outbox (status, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON event_outbox TO inventory_user;

CREATE TABLE idempotency_keys (
    idem_key VARCHAR(200) PRIMARY KEY, request_hash VARCHAR(64) NOT NULL, status VARCHAR(20) NOT NULL,
    response_json TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_inventory_idempotency_expires_at ON idempotency_keys (expires_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO inventory_user;

CREATE TABLE processed_events (
    consumer TEXT NOT NULL, event_id UUID NOT NULL, source_type TEXT, source_id UUID,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (consumer, event_id)
);
GRANT SELECT, INSERT ON processed_events TO inventory_user;
```
These three tables are NON-RLS (relay/idempotency run outside tenant request context) — do not add
`ENABLE ROW LEVEL SECURITY` to any of them.

---

### `test/.../InventoryTestBase.java` (test, IT infrastructure)

**Analog:** `services/kitchen-service/src/test/java/io/restaurantos/kitchen/KitchenTestBase.java` (full file, 70 lines)

Copy verbatim, retargeting: database name (`inventory_db`/`inventory_user`/`inventory_pass`), and
note this base class does NOT start a `RabbitMQContainer` (kitchen mocks `RabbitTemplate` instead —
`@MockitoBean protected RabbitTemplate rabbitTemplate;`). If inventory's `OrderClosedConsumer` IT
needs to test actual message delivery (not just direct method invocation), a `RabbitMQContainer` must
be added — no existing base class in this repo demonstrates that; `10-test-architecture-guide.md
§10.1` referenced in RESEARCH.md's Standard Stack table describes the pattern but was not directly
read this pass. Flag this as a planner decision: either (a) mock `RabbitTemplate` and test
`DepletionService`/`ProcessedEventService` directly (mirrors `KitchenTestBase`'s exact approach,
lower complexity), or (b) add a live `RabbitMQContainer` for true end-to-end consumer IT (higher
fidelity, not yet precedented in this repo).

```java
@SpringBootTest
public abstract class InventoryTestBase {
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("inventory_db")
            .withUsername("inventory_user")
            .withPassword("inventory_pass");

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
        postgres.start();
    }

    @BeforeAll
    static void applyMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .cleanDisabled(false).baselineOnMigrate(false).load();
        flyway.clean();
        flyway.migrate();
    }

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("eureka.client.enabled", () -> "false");
        registry.add("spring.cloud.config.enabled", () -> "false");
        registry.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
        registry.add("restaurantos.opa.url", () -> "http://127.0.0.1:1");
    }

    @MockitoBean protected RabbitTemplate rabbitTemplate;
    @MockitoBean protected StringRedisTemplate stringRedisTemplate;
    @MockitoBean protected OpaClient opaClient;
}
```

---

## Shared Patterns

### Idempotent consumer + processed_events dedup
**Source:** `services/kitchen-service/.../consumer/OrderClosedConsumer.java` + `.../service/ProcessedEventService.java`
**Apply to:** `inventory-service`'s single consumer (`OrderClosedConsumer` → `inventory.depletion`).
Copy the `tryProcess(consumerName, eventId, Runnable)` wrapping pattern exactly — do not hand-roll a
seen-ids cache.

### Tenant scoping on RabbitMQ consumers
**Source:** `shared-lib` `TenantAwareMessageProcessor.process(envelope, handler)` (referenced, not
re-read — same class already used by kitchen's consumer above)
**Apply to:** Every `@RabbitListener` handler body — sets both the Hibernate `tenantFilter` and the
RLS GUC on the same connection inside the listener's transaction.

### Pessimistic-lock read-then-mutate
**Source:** `services/pos-service/.../repository/OrderSequenceRepository.java` `findForUpdate`
**Apply to:** `IngredientBranchStockRepository.findForUpdate` — used by `DepletionService`,
`ReceiptService`, `TransferService`, `StockCountService`. Always lock via a tenant-scoped composite
key; pre-sort multi-row lock sets (deviation noted above).

### Money/paisa rounding discipline
**Source:** `shared-lib/.../money/MoneyUtils.java`
**Apply to:** `MacCalculator` and every COGS/cost computation — use `RoundingMode.HALF_UP` (mirror
`fromPkr`, lines 18-21). Never use `taxPerLine`'s FLOOR (lines 38-41) for MAC/COGS. No shared helper
exists for weighted-average-over-quantity; write it fresh (see RESEARCH.md's `recomputeAvgCostPaisa`
example, already vetted).

### Transactional outbox event publish
**Source:** `services/pos-service/.../service/OrderServiceImpl.java` lines 676-677 (publish call
site pattern)
**Apply to:** Every inventory event (`STOCK_DEPLETED`, `STOCK_RECEIVED`, `LOW_STOCK_ALERT`,
`EXPIRY_ALERT`, `COUNT_VARIANCE_POSTED`, `WASTAGE_RECORDED`, `TRANSFER_*`) — publish call must be the
last statement inside the same `@Transactional` method that mutated stock state, never outside it.

### Internal-service endpoint contract (bare-primitive, header-guarded)
**Source:** `services/pos-service/.../web/InternalPosController.java`
**Apply to:** `web/InternalGrnController.java` (`GET /internal/grn/pending-count`) — bare `Long`
return, optional `X-Tenant-Id` header, manual `tenantContext.set(...)` fallback.

### Tenant-audited entity base
**Source:** `shared-lib/.../entity/TenantAuditableEntity.java`
**Apply to:** Every JPA entity in `domain/model/` (`Ingredient`, `UnitOfMeasure`,
`IngredientBranchStock`, `StockLot`, `Recipe`, `RecipeLine`, `InventoryMovement`, transfer/count
entities) — `extends TenantAuditableEntity`, inherits `tenantId`/audit fields/soft-delete/Hibernate
`tenantFilter`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `service/MacCalculator.java` | service/utility | transform | No weighted-average-over-quantity helper anywhere in `shared-lib` or any service (Pitfall 4). Closest structural cousin is `MoneyUtils`'s rounding-mode convention only — write fresh in `BigDecimal`, HALF_UP, per RESEARCH.md's `recomputeAvgCostPaisa` example. |
| FEFO lot-walk logic inside `DepletionService.deplete(...)` | domain logic | transform | No "walk sorted list, subtract, floor" precedent exists in this repo. Genuinely new (D-04 elevated scope). Composed with, but must stay decoupled from, MAC costing per Pitfall 9 — never re-derive COGS from lot cost. |
| `repository/RecipeRepository.findEffectiveVersionsDesc(...)` | repository | CRUD | No effective-dated-version query precedent exists. Write fresh per D-01's locked JPQL shape (already given in RESEARCH.md § Code Examples — `effectiveFrom <= atInstant ORDER BY effectiveFrom DESC`, take `.get(0)`). |
| `service/ExpirySweepService.java` (`@Scheduled` nightly sweep) | service | batch | No `@Scheduled` batch-sweep precedent found in this repo's read services this pass (the outbox relay is the nearest structural cousin — poll-then-act — but was not read this session; if reused as a template, re-verify its exact `@Scheduled` cron/fixedDelay annotation shape before copying). |
| `service/TransferService.java` in-transit accounting (Inventory-in-Transit GL account `1320`) | domain logic | CRUD | No two-sided ship/receive-with-variance domain precedent exists; `OrderServiceImpl`'s transactional-write + outbox-publish *shape* is reusable (role-match, documented above), but the in-transit accounting math itself is new. |
| `web/InternalGrnController.java`'s underlying query (`countPendingAsOf`) | repository query | CRUD | Depends on Phase 8's own GRN/receipt data model (not yet defined) — no cross-service analog exists since Phase 10 (Vendor & Supply Chain, GRN 3-way match) is explicitly out of scope this phase; this is a lightweight stub query against inventory's own receipt/movement tables. |

## Metadata

**Analog search scope:** `services/kitchen-service`, `services/pos-service`, `services/finance-service`,
`shared-lib` (directories explicitly named in the task prompt as primary donors)
**Files read this pass:** `OrderClosedConsumer.java` (kitchen), `ProcessedEventService.java` (kitchen),
`OrderSequenceRepository.java` (pos), `TenantAuditableEntity.java` (shared-lib), `MoneyUtils.java`
(shared-lib), `InternalFinanceController.java` (finance), `InternalPosController.java` (pos),
`KitchenTestBase.java` (kitchen), `V2__shared_infra_tables.sql` (finance), `OrderServiceImpl.java`
lines 655-680 (pos, targeted read) — plus RESEARCH.md's already-verified excerpts (`PosClosePayloads`,
V1 RLS SQL, MAC formula pattern) reused rather than re-read.
**Pattern extraction date:** 2026-07-13
