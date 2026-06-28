# Phase 7: Point of Sale & Kitchen Display — Research

**Researched:** 2026-06-28
**Domain:** Spring Boot 4 microservices (pos-service + kitchen-service), event-driven POS, offline PWA (Next.js 16 Service Worker + IndexedDB), real-time KDS
**Confidence:** HIGH (all findings sourced from in-repo spec docs, existing finance-service implementation, and shared-lib source — not training data)

> This is the MOST CRITICAL phase. `ORDER_CLOSED` is consumed by Inventory (depletion, Phase 8), Finance (auto-posting, Phase 9), CRM (loyalty, Phase 9), and Reporting (Phase 12). The event envelope + payload defined here is a hard contract those phases already assume. Get the payload field names exactly right.

---

## Summary

Phase 7 builds **two new Java microservices** that did not previously exist: `pos-service` (port 8084, `pos_db`) and `kitchen-service` (port 8090, `kitchen_db`). The roadmap split (07-01..07-04) treats them as one phase; KDS (07-04) is its own service per the spec's service registry (Doc 1 §, line 400: "Kitchen Service | 8090 | kitchen_db | POS, KDS UI") and its own `kitchen.topic` exchange that emits `ORDER_READY`. Plans must scaffold both, mirroring the canonical service skeleton already proven by `finance-service` (Maven module under parent POM, Flyway migrations, RLS-or-fail, Testcontainers static-singleton IT base, Eureka/Config wiring, `shared-lib` auto-config).

The menu/catalog (`menu_categories`, `menu_items`, `modifier_groups`, `modifiers`, `branch_menu_overrides`, `dining_tables`) lives **inside `pos_db`** — there is no separate catalog service. POS owns orders, order_items, order_item_modifiers, order_payments, till_sessions, and the menu reference. The order state machine (`DRAFT→OPEN→SENT_TO_KDS→PARTIAL_READY→READY→SERVED→CLOSED`, plus `VOIDED`/`REFUNDED`) is fully specified in FD-3. Money is `BIGINT` paisa everywhere; tax is per-line floored half-up (BLR-1); discounts can never push a line below zero (POS-05, US-2.4 AC5); split-tender close is idempotent via `Idempotency-Key = client_order_id` and the `orders.client_order_id` UNIQUE constraint (BLR-9). Period-lock is respected by POS calling Finance's existing internal endpoint `GET /internal/finance/periods/status` (returns OPEN|LOCKED) and mapping LOCKED → 423 `PERIOD_LOCKED`.

**Primary recommendation:** Build pos-service first (orders/tables/state-machine/discount-floor → tills/payments/void/refund), then kitchen-service (KDS), then the offline PWA layer last (it depends on the POS REST contract being stable). Reuse `shared-lib` primitives verbatim (`EventPublisher` transactional outbox, `TenantAwareMessageProcessor`, `IdempotencyService`, `OpaClient`, `MoneyUtils`); do NOT hand-roll any of them. Extend the existing `policies/restaurantos/pos.rego` to add refund + discount-override threshold rules (it currently only covers `void.own`/`void.any`).

---

## New Service(s) — Confirmed Topology

| Service | Port | DB | Exchange | Eureka name | Builds in |
|---|---|---|---|---|---|
| `pos-service` | **8084** | `pos_db` | `pos.topic` | `pos-service` | 07-01, 07-02, 07-03 |
| `kitchen-service` | **8090** | `kitchen_db` | `kitchen.topic` | `kitchen-service` | 07-04 |

Sources: spec service registry (`Docs/RestaurantERP_SaaS_Specification.md` L394–400), event registry exchanges (`Docs/agent-specs/02-event-schema-registry.md` §2.2), internal API contracts (`Docs/agent-specs/04-internal-api-contracts.md` §4.2 "POS Service ... http://pos-service:8084").

**Decision for planner:** KDS is a **separate service** (`kitchen-service`), not a module inside pos-service. Evidence: distinct port (8090), distinct DB (`kitchen_db`), distinct exchange (`kitchen.topic`), and FD-11 shows "Kitchen Service consumes event" as a separate actor. POS publishes `ORDER_SENT_TO_KDS` on `pos.topic`; kitchen-service consumes via queue `kitchen.order-sent.queue` (already declared in topology), creates `kds_tickets`, and emits `ORDER_READY` on `kitchen.topic`. POS consumes `ORDER_READY` back to flip order status and notify the cashier.

**Scaffold wiring (both services), mirroring finance-service:**
- Parent `pom.xml`: add `pos-service` and `kitchen-service` to `<modules>`.
- `<parent>`: `io.restaurantos:restaurantos-parent:1.0.0`, `<relativePath>../../pom.xml</relativePath>`.
- Dependencies (copy finance-service `pom.xml` verbatim): `shared-lib`, `spring-boot-starter-web/data-jpa/validation/actuator/data-redis/amqp`, `spring-cloud-starter-netflix-eureka-client`, `spring-cloud-starter-config`, `spring-cloud-starter-openfeign`, `springdoc-openapi-starter-webmvc-ui:2.8.9`, `spring-boot-flyway` + `flyway-core` + `flyway-database-postgresql`, `postgresql` (runtime), `lombok`, test: `spring-boot-starter-test`, `testcontainers:junit-jupiter`, `testcontainers:postgresql`. Surefire excludes `**/*IT.java`; failsafe includes them with `TESTCONTAINERS_RYUK_DISABLED=true`.
- `application.yml`: pattern from `services/finance-service/src/main/resources/application.yml` — `server.port: ${SERVER_PORT:8084}`, `spring.application.name: pos-service`, datasource `${POS_DB_URL:jdbc:postgresql://localhost:5432/pos_db}` / `pos_user` / `pos_pass`, `jpa.hibernate.ddl-auto: validate`, `flyway.locations: classpath:db/migration`, Eureka `${EUREKA_URI:http://localhost:8761/eureka}`, Config `${CONFIG_URI:http://localhost:8888}`, `restaurantos.internal.secret`, `jwks.uri`.
- Application class: `@SpringBootApplication @EnableFeignClients(basePackages = "io.restaurantos.pos.feign")`. Do NOT add `@EnableJpaAuditing` — `SharedAutoConfiguration` is authoritative (decision [03-02-D]).
- Package root: `io.restaurantos.pos` / `io.restaurantos.kitchen`.
- `pos_db` and `kitchen_db` are pre-created by Phase-1 `init-db.sql` with least-privilege roles; migrations only create tables. Add both services to `docker/docker-compose.yml`.

---

## Complete Data Model

### `pos_db` (source: spec M1.3, L1636–1778; all money `BIGINT` paisa, all tables `tenant_id UUID NOT NULL` + 5 audit columns + RLS)

| Table | Key columns | Notes / FKs |
|---|---|---|
| `menu_categories` | `name`, `display_order`, `is_active`, `branch_id` (NULL=all branches), `icon_file_id` | catalog reference, lives in pos_db |
| `menu_items` | `category_id→menu_categories`, `name`, `base_price_paisa`, `tax_rate_code`, `tax_rate_pct NUMERIC(5,2)`, `is_active`, `is_combo`, `image_file_id`, `pos_display_order` | `tax_rate_pct` denormalised from finance; **add `kds_station TEXT`** (US-2.3 AC3 routes by `menu_item.kds_station`) |
| `branch_menu_overrides` | `branch_id`, `menu_item_id→menu_items`, `price_paisa` (NULL=base), `is_available` | `UNIQUE(tenant_id,branch_id,menu_item_id)`; effective price = `COALESCE(override.price_paisa, base_price_paisa)` (US-2.2 AC6) |
| `modifier_groups` | `name`, `selection_type` SINGLE/MULTI, `is_required`, `min_selections`, `max_selections` | |
| `modifiers` | `group_id→modifier_groups`, `name`, `price_delta_paisa`, `is_active` | |
| `dining_tables` | `branch_id`, `label`, `capacity`, `status` (AVAILABLE/OCCUPIED), `floor_plan_x/y`, `floor_plan_shape` | floor plan |
| `orders` | `branch_id`, `order_no` (`ORD-YYYYMMDD-NNNN` per-branch daily seq), `type` DINE_IN/TAKEAWAY/DELIVERY, `status`, `table_id→dining_tables`, `cover_count`, `cashier_id`, `till_session_id→till_sessions`, `subtotal_paisa`, `tax_paisa`, `discount_paisa`, `service_charge_paisa`, `total_paisa`, `notes`, `opened_at`, `sent_to_kds_at`, `closed_at`, `voided_at`, `void_reason`, **`client_order_id UUID UNIQUE`** | offline dedup key (BLR-9); `customer_id UUID` must be ADDED (POS-08 / `ORDER_CLOSED.customerId`) |
| `order_items` | `order_id→orders ON DELETE CASCADE`, `menu_item_id`, `item_name_snapshot`, `unit_price_snapshot`, `quantity`, `discount_paisa`, `tax_paisa`, `line_total_paisa`, `kds_station`, `kds_status` (default PENDING), `notes` | price/name snapshotted at add-time (BLR-9 offline price stability) |
| `order_item_modifiers` | `order_item_id→order_items ON DELETE CASCADE`, `modifier_id`, `modifier_name_snapshot`, `price_delta_paisa` | |
| `order_payments` | `order_id→orders`, `method` CASH/CARD/LOYALTY_POINTS/BANK_TRANSFER/VOUCHER, `amount_paisa`, `reference_no`, `recorded_at` | split-tender = multiple rows |
| `till_sessions` | `branch_id`, `cashier_id`, `opening_float_paisa`, `expected_closing_paisa`, `declared_closing_paisa`, `variance_paisa` (GENERATED STORED = declared − expected), `opened_at`, `closed_at`, `status` (OPEN/CLOSED) | one OPEN per cashier (US-2.1 AC3) |
| `order_discounts` | `order_id`, scope (LINE/ORDER), `order_item_id?`, type (FLAT/PERCENT), `value`, `amount_paisa`, `applied_by` | referenced by US-2.4 AC6 ("stored in `order_discounts`"); not in M1.3 DDL — **planner must define this table** |

Plus `shared-lib` infra tables (Doc 3 §3.10 note — NOT RLS-scoped): `event_outbox`, `idempotency_keys`, `processed_events`. Create via Flyway in BOTH services.

### `kitchen_db` (source: spec M10.3, L2521 — "`kds_stations` (station config, menu item mappings), `kds_tickets` (order-station pairing, item statuses, timestamps)")

The spec gives only table names, not full DDL. Recommended columns (planner finalises):
| Table | Columns |
|---|---|
| `kds_stations` | `id`, `tenant_id`, `branch_id`, `code` (GRILL/SALADS/BAKERY/DRINKS/DEFAULT), `name`, `is_active`, `escalation_threshold_seconds` (auto-red, M10.2) |
| `kds_tickets` | `id`, `tenant_id`, `branch_id`, `order_id`, `order_no`, `station_code`, `status` (PENDING/COOKING/READY/CANCELLED), `priority` (bool/rush flag), `received_at`, `started_at`, `ready_at` |
| `kds_ticket_items` | `id`, `tenant_id`, `ticket_id→kds_tickets`, `order_item_id`, `name`, `qty`, `modifiers` (text/jsonb), `notes`, `status` (PENDING/COOKING/READY) |
| `processed_events` | consumer idempotency for `ORDER_SENT_TO_KDS` / void cancellation |

**Item↔station reference (cross-service):** POS publishes `kdsStation` per item INSIDE the `ORDER_SENT_TO_KDS` payload (it's resolved from `menu_items.kds_station` in pos_db). kitchen-service therefore does NOT need to read pos_db — it routes purely from the event payload (FD-11: "Lookup menu_item.kds_station tag" happens POS-side before publish; the payload already carries `kdsStation`). If station tag is null → route to `DEFAULT` station (FD-11 branch H).

---

## Order State Machine (FD-3, authoritative)

| From | To | Trigger / guard | Event emitted |
|---|---|---|---|
| `[*]` | `DRAFT` | Cashier creates order (table selected) | — (table→OCCUPIED) |
| `DRAFT` | `OPEN` | First item added | `ORDER_CREATED` (`pos.order.created`) |
| `OPEN` | `OPEN` | add/remove items, apply discount, change modifiers | — (recompute totals) |
| `OPEN` | `SENT_TO_KDS` | "Send to Kitchen", order has ≥1 item & status OPEN | `ORDER_SENT_TO_KDS` (`pos.order.sent_to_kds`); set `sent_to_kds_at` |
| `SENT_TO_KDS` | `PARTIAL_READY` | some KDS stations mark items READY | (driven by `ORDER_READY` consume / kitchen progress) |
| `SENT_TO_KDS` | `READY` | ALL stations mark ALL items READY | `ORDER_READY` consumed from kitchen.topic |
| `PARTIAL_READY` | `READY` | remaining items READY | |
| `READY` | `SERVED` | waiter confirms delivery | — |
| `SERVED` | `CLOSED` | cashier records payment(s); Σpayments == total_paisa | `ORDER_CLOSED` (`pos.order.closed`); set `closed_at`, table→AVAILABLE |
| `OPEN` | `VOIDED` | cashier voids own OPEN (OPA `void.own`) or manager (`void.any`); reason required | `ORDER_VOIDED` (`pos.order.voided`); table→AVAILABLE, KDS tickets cancelled |
| `SENT_TO_KDS` | `VOIDED` | manager only (`void.any`) | `ORDER_VOIDED` |
| `CLOSED` | `REFUNDED` | manager full refund (OPA `refund` + threshold) | `ORDER_REFUNDED` (`pos.order.refunded`) |
| `CLOSED` | `CLOSED` | partial refund → linked refund record, status stays CLOSED | `ORDER_REFUNDED` (partial) |

Illegal transitions → 409 `STATE_INVALID` (`StateInvalidException`, shared-lib). Note: spec/FD-3 require `SERVED` before `CLOSED` for the happy dine-in path, but TAKEAWAY/DELIVERY and offline flows close directly — planner should allow `OPEN`/`SENT_TO_KDS`/`READY`/`SERVED` → `CLOSED` (US-2.5 does not require SERVED; acceptance "take order, send to kitchen, receive payment, close" — be pragmatic: gate close on `Σpayments == total` and status ∈ {OPEN, SENT_TO_KDS, PARTIAL_READY, READY, SERVED}).

---

## Money / Discount / Tax (BLR-1, US-2.x) — exact algorithms

All in `BIGINT` paisa via `io.restaurantos.shared.money.MoneyUtils` (verified signatures from source, NOT spec):
```java
MoneyUtils.toMoney(long paisa) -> Money(paisa, pkr, formatted)
MoneyUtils.fromPkr(BigDecimal) -> long          // HALF_UP
MoneyUtils.formatPkr(long paisa) -> String      // en-PK currency, 0 fraction digits
MoneyUtils.add(long a, long b) -> long
MoneyUtils.multiplyBps(long paisa, int bps) -> long      // FLOOR; 1 bps = 0.01%
MoneyUtils.taxPerLine(long linePaisa, int taxBps) -> long // FLOOR per-line tax (XCUT-03)
MoneyUtils.roundToRupee(long paisa) -> long      // HALF_UP to whole rupee
```

**Per-line tax (BLR-1, US-2.2 AC7 / US-2.4 AC7):**
`tax_per_line = floor((unit_price_paisa − discount_paisa_per_unit) * quantity * tax_rate_pct / 100)`, half-up at the paisa boundary. NEVER apply tax to the order total. `MoneyUtils.taxPerLine` takes bps — convert `tax_rate_pct` to bps (`pct * 100`). Note BLR-1 says "Half-up rounding" while `taxPerLine` floors — **OPEN QUESTION: reconcile floor vs half-up** (see Open Questions). Recommend: compute the taxable base in paisa then `fromPkr`-style HALF_UP, matching US-2.2 AC7 wording "rounded half-up to nearest paisa".

**Discount floor (POS-05, US-2.4 AC5):** A discount (flat or %) can never make a line negative. Guard: `effective_discount = min(requested_discount_paisa, line_subtotal_paisa)`; `line_total = max(0, subtotal − discount)`. Enforce server-side AND in the OPA-gated path (>10% line or any order-level % requires `pos.order.discount.override`, US-2.4 AC4).

**Split-tender 1-paisa rounding resolution (POS-03, US-2.5 AC2, US-2.6 AC1):**
- Close validation: `Σ order_payments.amount_paisa == orders.total_paisa` exactly, else block (US-2.5 AC2).
- Equal split (US-2.6 AC1 / BLR-1): `share = total_paisa / n` (integer div); `remainder = total_paisa % n` is added to the **first share only** (do NOT distribute — avoids rounding loops). This is THE defined 1-paisa rounding resolution.
- By-item split (US-2.6 AC2): per-diner total includes proportional tax + service charge.

**Order total composition:** `total = subtotal − discount + service_charge + tax` (all paisa).

---

## Idempotency (POS-03, POS-07, POS-04)

Use `io.restaurantos.shared.idempotency.IdempotencyService`:
```java
boolean checkAndLock(String key, String requestHash, int ttlSeconds);  // 86400 default TTL
void markComplete(String key, String responseJson);
Optional<String> getCompletedResponse(String key);
// Conflict (same key, different body hash) → IdempotencyConflictException → 409 IDEMPOTENCY_KEY_CONFLICT
```
- **Offline order creation (POS-07/BLR-9):** `client_order_id` (client UUID v4) sent as `Idempotency-Key` header on create. Server dedups via `orders.client_order_id` UNIQUE — a duplicate insert returns the existing order (not a double-post). Catch `DataIntegrityViolationException` on the unique constraint → return existing order, 200.
- **Idempotent close (POS-03/US-2.5 AC11):** `Idempotency-Key` mandatory on close; duplicate returns the stored original response WITHOUT re-publishing `ORDER_CLOSED`.
- **Idempotent void/refund (POS-04):** events carry `eventId` (UUIDv7); downstream consumers dedup via `processed_events (consumer, event_id)` PK (Doc 2 §2.4). Till close also requires `Idempotency-Key` (US-2.10 AC8).
- **Envelope-based downstream idempotency:** every consumer (kitchen, finance, inventory, crm) records `event_id` in `processed_events` in the SAME `@Transactional` as the business write; see `TenantAwareMessageProcessor`.

---

## OPA / Permissions

Policy file: `policies/restaurantos/pos.rego` — **EXISTS but is incomplete.** Current content only covers void:
```rego
package restaurantos.pos
import data.restaurantos.common
default allow := false
allow if { common.has_permission(input,"pos.order.void.own"); input.resource.created_by==input.user.id; input.resource.status=="OPEN"; common.same_tenant_and_branch(input) }
allow if { common.has_permission(input,"pos.order.void.any"); common.same_tenant_and_branch(input) }
```
**Phase 7 must extend `pos.rego` + `policies/tests/pos_test.rego`** to add: refund (`pos.order.refund`), order-level/over-threshold discount override (`pos.order.discount.override`), and split-bill (`pos.order.split_bill`). Keep `opa test policies/ --coverage` at **100%** (CI gate, Doc 10 L194/L340).

`OpaClient` usage (shared-lib §3.6):
```java
OpaDecision d = opaClient.evaluate("pos", OpaInput.builder()
    .user(new OpaInput.User(userId, tenantId, branchId, permissions, attributes))
    .resource(new OpaInput.Resource("order", orderId, tenantId, branchId, createdBy, status, amountPaisa))
    .action("pos.order.refund")
    .build());
if (!d.allow()) throw new PermissionDeniedException("...");  // fail-closed; OPA timeout/non-200 already throws (BLR-5)
```
Permission catalogue (spec Appendix B.1): `pos.order.create/update/view/send_to_kds/close/void.own/void.any/refund/split_bill/discount.line/discount.order/discount.override`, `pos.kds.view/update`, `pos.till.open/close/reconcile.override`, `pos.tables.manage`, `pos.menu.view/manage`. Discount threshold rule (BLR-5): >10% on a line OR any order-level % discount requires `discount.override`; `resource.amount_paisa` carries the discount amount for the policy.

---

## Period Lock (POS close respects 423 PERIOD_LOCKED)

**Mechanism: synchronous internal API call (NOT event-time).** On order close, pos-service calls Finance:
```
GET /internal/finance/periods/status?branchId={branchId}&date={businessDate}
→ { periodId, status: "OPEN"|"LOCKED"|"CLOSED", fiscalYear, periodNo }
```
(Doc 4 §4.2 Finance; impl `AccountingPeriodServiceImpl.getPeriodStatus`). If `LOCKED`/`CLOSED` → throw `io.restaurantos.shared.exception.PeriodLockedException` → shared `GlobalExceptionHandler` returns **423 PERIOD_LOCKED**. Use a Feign client (`FeignSharedConfig` propagates JWT + `X-Internal-Service`). Wrap in a Resilience4j fallback — but note: an order close blocked by a locked period must FAIL closed (do not silently close into a locked period). Business date uses BLR-10 business-day formula (`opened_at` − branch cutoff, default 4h).

**Reverse contract (Finance period close depends on POS):** POS exposes `GET /internal/pos/branches/{branchId}/open-orders-count?olderThanHours=12 → { count }` (Doc 4 §4.2, resolves CRIT-05). Finance's `PosClient` Feign stub already exists expecting this. FD-14 pre-close check 1 blocks period close if any order is OPEN/SENT_TO_KDS older than 12h. **Plan 07-02 MUST implement this endpoint** or Phase 6 period-close breaks.

---

## Events — exact envelopes + RabbitMQ topology (Doc 2)

**Common envelope** (`io.restaurantos.shared.event.EventEnvelope<T>`): `eventId`(UUIDv7), `eventType`, `tenantId`, `branchId`(nullable), `occurredAt`(ISO8601 UTC), `correlationId`, `schemaVersion`(=1), `source`(`POS_SERVICE`/`KITCHEN_SERVICE`), `payload`.

**Publish via transactional outbox** (`EventPublisher.publish(exchange, routingKey, eventType, branchId, payload)`) inside the same `@Transactional` as the state mutation. `OutboxRelay` (1s poll) ships to RabbitMQ — never call `RabbitTemplate` directly (Doc 3 §3.10).

| Event | Exchange | Routing key | Payload (exact fields) | Consumers / queues |
|---|---|---|---|---|
| `ORDER_CREATED` | `pos.topic` | `pos.order.created` | `{ orderId, orderNo, type, tableId\|null, cashierId, tillSessionId }` | Kitchen, Audit |
| `ORDER_SENT_TO_KDS` | `pos.topic` | `pos.order.sent_to_kds` | `{ orderId, items:[{ orderItemId, menuItemId, name, qty, kdsStation, modifiers:[string], notes\|null }] }` | `kitchen.order-sent.queue` |
| `ORDER_CLOSED` | `pos.topic` | `pos.order.closed` | `{ orderId, orderNo, type, customerId\|null, subtotalPaisa, discountPaisa, serviceChargePaisa, taxPaisa, totalPaisa, payments:[{ method, amountPaisa, referenceNo\|null }], items:[{ menuItemId, name, qty, unitPricePaisa, lineTotalPaisa }], tillSessionId, cashierId, closedAt }` | `inventory.order-closed.queue`, `finance.order-closed.queue`, `crm.order-closed.queue`, `reporting.order-closed.queue`, Audit |
| `ORDER_VOIDED` | `pos.topic` | `pos.order.voided` | `{ orderId, reason, voidedBy }` | Finance, Inventory, Audit |
| `ORDER_REFUNDED` | `pos.topic` | `pos.order.refunded` | `{ orderId, refundPaisa, reason, refundedBy }` | Finance, Audit |
| `TILL_OPENED` | `pos.topic` | `pos.till.opened` | `{ tillSessionId, openingFloatPaisa, cashierId }` | Audit |
| `TILL_CLOSED` | `pos.topic` | `pos.till.closed` | `{ tillSessionId, expectedCashPaisa, countedCashPaisa, variancePaisa, cashierId }` | Finance, Audit |
| `ORDER_READY` | `kitchen.topic` | `kitchen.order.ready` | `{ orderId, station, readyAt }` | POS (back-notify) |

DLQ pattern (Doc 2 §2.2/2.5): each queue declared with `x-dead-letter-exchange=restaurantos.dlx`, `x-dead-letter-routing-key={queue}.dlq`; listener retry 3× exp backoff (2s init, ×2, max 10s), `default-requeue-rejected=false`, dead-letter on final failure. **Note:** `customerId` is on `ORDER_CLOSED` (POS-08) — POS must persist `orders.customer_id` (column to add) even though CRM doesn't exist until Phase 9; it can be null now.

---

## KDS (kitchen-service)

- **Routing (FD-11):** consume `ORDER_SENT_TO_KDS` → for each item, group by `kdsStation` (from payload) → INSERT one `kds_tickets` row per (order, station) with `kds_ticket_items`. Null station → `DEFAULT`.
- **Ticket lifecycle:** ticket item PENDING→COOKING→READY (chef taps). When all items on a ticket READY → ticket READY (auto-bump to done column, archive after 60s, §7.2). When ALL tickets for an order READY → emit `ORDER_READY`; if only some → order is `PARTIAL_READY`.
- **Void propagation:** on `ORDER_VOIDED`, cancel that order's KDS tickets (US-2.7 AC5).
- **ORDER_READY → POS transport:** kitchen emits `ORDER_READY` on `kitchen.topic`; POS consumes it (queue, e.g. `pos.order-ready.queue`) to flip order status and push to the cashier. For the **KDS browser** and the **cashier ready-notification**, use **WebSocket** — spec M10.3 mandates `ws://{host}/api/v1/kitchen/kds/{branchId}/{stationId}` (STOMP/native WS via `spring-boot-starter-websocket`), 2s update target (US-2.3 AC6). KDS UI subscribes per station channel. (Decision: WebSocket, not SSE/polling — explicitly specified.)
- **Coverage:** kitchen-service falls under "all other Java services" → **60%** gate; pos-service → **70%** (Doc 10 L336/L338).

---

## Offline POS (POS-07, US-2.9, FD-5, BLR-9) — Next.js 16 PWA

Stack (spec §, L466–467): **Workbox Service Worker + IndexedDB**; Zustand for the offline queue/cart client state; TanStack Query for online server state.
- **Interception:** SW intercepts all `/api/v1/pos/*` writes when `navigator.onLine === false` (US-2.9 AC1). Mutating requests (create order, add item, close, payment) queued in IndexedDB keyed by `client_order_id` (AC2/AC3).
- **Client IDs:** UUID v4 generated client-side, stored as `client_order_id` (AC3).
- **UI:** amber banner `⚠ Offline — N orders queued` (§7.1, design system §13 "Offline (POS) → amber banner, not modal"); green "X orders synced" on completion.
- **Sync on reconnect (FD-5):** on `online` event, flush IndexedDB outbox **oldest-first** (by `enqueuedAt`, preserves create-before-close causality, BLR-9). Each request carries `Idempotency-Key = client_order_id`.
  - 200/201 → remove from queue, update local cache.
  - 409 `IDEMPOTENCY_KEY_CONFLICT` / already-exists → treat as success, remove (AC6).
  - 409/`STATE_INVALID` (e.g. voided server-side) → per-order error, "review required" (AC9).
  - 5xx/network → leave in queue, increment retry; after >3 → alert cashier "contact manager".
- **Menu cache:** SW caches menu API for ≤30 min (BLR-9); prices at close use `order_items.unit_price_snapshot`, so offline price drift is acceptable.
- **Next 16 specifics:** the project renamed `middleware.ts` → `proxy.ts` (Node runtime; see `frontend/proxy.ts` — it's first-pass route protection only, not a security boundary). Service Worker registration is a client concern (register in a client component / `app` provider). PWA manifest + SW are NOT yet present in the repo — plan must add `public/sw.js` (or Workbox build), `manifest.webmanifest`, and SW registration. Confirm Next 16's handling of SW scope (serve `sw.js` from app root). PWA installability + offline shell are new to this codebase.

---

## Frontend — POS terminal, floor view, payment, till, KDS board

**Four-layer abstraction (enforced, ESLint `no-restricted-imports`):** Zod schema → adapter → repository → TanStack Query hook → component. Verified pattern from finance:
- L1 `lib/api-client/schemas/pos.schema.ts` — Zod schemas for raw API shapes (`apiOrderSchema`, etc.).
- L2 `lib/repositories/pos.repository.ts` — calls `get/getPaginated/post` from `lib/api-client/request`, `schema.parse(raw)`, then `adapt*()`. Pattern: `services/.../finance.repository.ts`. Never exposes raw API types upward.
- `lib/adapters/pos.adapter.ts` — raw → domain model (`lib/models/pos.model.ts`).
- L3 `lib/hooks/pos/use-orders.ts` etc. — `useQuery`/`useMutation`, query keys in `lib/hooks/query-keys.ts`, gate `enabled: isAuthenticated && !!branchId`.
- L4 components in `components/pos/**` consume only hooks. Components importing `lib/api-client` or `lib/repositories` are blocked by ESLint (FE-03). `tsc --noEmit` zero `any`. Money rendered via `<MoneyDisplay paisa={...}>` (`font-mono tabular-nums`).
- **Route group:** add `frontend/app/(tenant)/app/pos/**` and `.../kitchen/**` (or `kds`) page groups, mirroring `app/(tenant)/app/finance/**`. Route protection: `frontend/proxy.ts` already matches `/app/:path*` and redirects when `has_session` cookie absent; real auth is `SessionProvider` + gateway. Pages are `"use client"`.
- **Feature/permission gating:** wrap routes/nav with `FeatureGuard` (`FEATURE_POS`/`FEATURE_KDS`, both default-on all tiers) + `PermissionGuard`.

**Design system (§7.1 POS, §7.2 KDS):**
- POS: touch-first, full-screen, ≤3 taps. Menu cards ≥100×100px; horizontally-scrollable category pills; "SEND TO KITCHEN" `h-12` success-green; "CHARGE NOW" `h-14 text-lg font-bold` tenant-primary; modifiers in bottom sheet (mobile)/right panel (tablet) 44px targets; qty +/− ≥40px, long-press − removes; full-screen fuzzy search; offline indicator; fixed order panel with scrolling items; receipt modal Print/Email/WhatsApp. POS follows user theme. Breakpoint `md`768; menu grid 2/3/4 col.
- KDS: **always dark mode**, no chrome, readable at 2m. Ticket cards: 0–10m green border, 10–15m amber+pulsing glow, 15m+ red border+`red-950/30` bg+shake/30s. Item names `text-2xl`. PENDING→COOKING→READY taps (distinct bg per state). READY auto-moves to done (✓), archives 60s. Optional `AudioContext` cue on new ticket. Grid 1/2/3–4 col.

---

## Don't Hand-Roll

| Problem | Use instead | Why |
|---|---|---|
| Event publishing | `shared-lib` `EventPublisher` + `OutboxRelay` (transactional outbox) | atomic with state change; avoids phantom/lost events (Doc 3 §3.10) |
| Consumer tenant context + RLS | `TenantAwareMessageProcessor.process(envelope, handler)` | sets TenantContext + Hibernate filter + `app.current_tenant_id` GUC in one tx (CRIT-01) |
| Money math | `MoneyUtils` (paisa, floor/half-up) | never use double/float (BLR-1/XCUT-03) |
| Idempotency | `IdempotencyService` + `orders.client_order_id` UNIQUE + `processed_events` | proven dedup; don't invent keys |
| Authorization | `OpaClient` + `pos.rego` | fail-closed ABAC, branch isolation (BLR-5) |
| Period lock | Finance `GET /internal/finance/periods/status` Feign | no cross-service SQL (CRIT-05) |
| Error→HTTP mapping | shared `GlobalExceptionHandler` + exception types | 423 PERIOD_LOCKED, 409 STATE_INVALID/IDEMPOTENCY_KEY_CONFLICT, 403 PERMISSION_DENIED already wired |
| RLS | `TenantAuditableEntity` + per-table policy | RLS-or-fail CI guard |
| Testcontainers | static-singleton base (copy `FinanceTestBase`) | avoids context-cache port conflicts (decision [06-02-A]) |

---

## Common Pitfalls

1. **Close not `@Transactional` around publish** — `ORDER_CLOSED` must be written to `event_outbox` in the same tx as the status update or it's lost/phantom. (Mirror finance `post()` pitfall.)
2. **Raw `@RabbitListener` without `TenantAwareMessageProcessor`** — RLS returns zero rows; consumer silently does nothing (Doc 3 §3.3 anti-pattern).
3. **RLS empty-GUC cast** — use `NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID` (see finance `V4__fix_rls_tenant_guc_policies.sql`); the naive `::uuid` throws on empty GUC.
4. **Tax on order total** — must be per-line floored (BLR-1); summing line taxes ≠ tax on total.
5. **Discount makes line negative** — clamp to zero (POS-05); CI/tests must cover.
6. **Split-tender remainder distributed** — add remainder to first share only (BLR-1), else rounding loops.
7. **Re-sending an already-SENT order** — guard state machine; only OPEN→SENT_TO_KDS legal.
8. **Double close / offline replay** — `Idempotency-Key` + `client_order_id` UNIQUE; duplicate returns original response, no second `ORDER_CLOSED`.
9. **Period locked mid-shift** — close must 423, not silently post into locked period.
10. **`customerId` omitted from `ORDER_CLOSED`** — Phase 9 CRM loyalty depends on it (POS-08); persist `orders.customer_id` (nullable) now.
11. **KDS not dark / not WebSocket** — both are hard spec requirements (§7.2, M10.3).
12. **Forgetting `event_outbox`/`idempotency_keys`/`processed_events` migrations** — shared-lib ships no migrations (Doc 3 §3.10 note); each service must create them, non-RLS.

---

## Edge Cases ("handle every use case")

| Case | Required behaviour | Source |
|---|---|---|
| Empty order close (0 items / total 0) | Block; can't close DRAFT with no items (US-2.5 needs payments==total; total 0 → reject zero-value order) | US-2.3 AC1, FD-3 |
| Double-submit close | Idempotency-Key returns original response, no re-publish | US-2.5 AC11 |
| Partial payment then abandon | Order stays open; remaining balance shown; not closed until Σ==total | US-2.6 AC4/AC5 |
| Refund after close | Only CLOSED→REFUNDED (full) or CLOSED+linked record (partial); OPA `refund` | US-2.8 |
| Void mid-cook | OPEN/SENT_TO_KDS→VOIDED; KDS tickets cancelled; no JE | US-2.7 AC1/AC5/AC6 |
| Offline order referencing deleted item | snapshot price/name on add stored on order_item; close uses snapshot; if item gone server-side, order still valid | BLR-9 |
| Till over/short | `variance_paisa` GENERATED; if > branch threshold → notify Branch Manager | US-2.10 AC6 |
| Concurrent edits same order/table | optimistic version on `orders` (add `version`); table status guards; real-time table status across cashiers (M1.2) | M1.2 |
| Re-send already-sent order | reject (STATE_INVALID); only OPEN→SENT legal | FD-3 |
| Discount stacking (line + order) | both stored in `order_discounts`; recompute; floor at 0; >10% or order-% needs override | US-2.4 |
| Zero-value order | reject close; nothing to tender | inferred from US-2.5 AC2 |
| Network partition during close | offline queue; sync on reconnect with client_order_id; no dup | US-2.9, FD-5 |
| KDS ready out of order | order READY only when ALL tickets READY; else PARTIAL_READY | FD-11 |
| Period lock mid-shift | close 423 PERIOD_LOCKED | FD-14, BLR-4 |
| Second open till per cashier | reject "You already have an open till session" | US-2.1 AC3 |
| Till close with open orders | block till close if non-closed/non-voided orders exist in session | US-2.10 AC4 |
| Cross-tenant order access | 404 (not 403) | M1.5 AC7, BLR-2 |

---

## Conventions a New Service MUST Follow

- **Flyway, not Liquibase.** ⚠️ DISCREPANCY: Doc 3 §3.12 shows `spring.liquibase.change-log` in the *common* config, but the actual built services use **Flyway** (`finance-service/pom.xml` + `application.yml` `flyway.locations: classpath:db/migration`, `V1__..._schema.sql`). Follow Flyway (the implemented reality). Migrations: `Vn__name.sql`, RLS on every tenant table, `DEFERRABLE INITIALLY DEFERRED` constraint triggers where needed.
- **RLS-or-fail:** every tenant table gets `ALTER TABLE x ENABLE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON x USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);`. CI entity-scan (BLR-2) fails build if a `TenantAuditableEntity` maps to a table missing tenant_id/audit columns (Doc 8 §8.3/§8.9).
- **Entities** extend `TenantAuditableEntity` (tenant_id, created/updated_at, created/updated_by, deleted_at). Repositories: JPQL only, NEVER `@Query(nativeQuery=true)` (bypasses tenant filter).
- **Testcontainers IT:** copy `FinanceTestBase` static-singleton pattern (postgres:16, Flyway clean+migrate in `@BeforeAll`, `@DynamicPropertySource`, mock Redis/Rabbit/idempotency/outbox beans). `*IT.java` via failsafe.
- **Coverage gates (CI `mvn verify -Pcoverage`):** `pos-service` **70%**, `kitchen-service` **60%**, OPA **100%**, frontend (repos/adapters/hooks) **70%** (Doc 10 §). Add entries to `.github/workflows/coverage-gates.json` + JaCoCo `coverage` profile in each pom.
- **API:** public routes `/api/v1/pos/**`, `/api/v1/kitchen/**` (gateway-routed); internal `/internal/**` (excluded from gateway, require `X-Internal-Service` secret); `ApiResponse<T>` envelope; `@RequiresFeature("FEATURE_POS")` / `FEATURE_KDS` (Doc 7 §7.4 API rules).
- **Security config:** JWT via JWKS (`jwks.uri`), per-service `SecurityConfig` (copy `FinanceSecurityConfig`).

---

## PLAN.md Format the Planner Must Produce (mirror 06-01/06-02)

YAML frontmatter keys (verified from `06-01-PLAN.md`): `phase`, `plan`, `type: execute`, `wave`, `depends_on: []`, `files_modified: [...]`, `autonomous: true`, then `must_haves:` with `truths:` (testable statements), `artifacts:` (`path`/`provides`/`contains`|`min_lines`), `key_links:` (`from`/`to`/`via`/`pattern`). Body: `<objective>`, `<execution_context>` (@workflow refs), `<context>` (@PROJECT/@ROADMAP/@STATE/@07-RESEARCH), `<tasks>` with `<task type="auto"><name><files><action><verify><done>`, `<verification>`, `<success_criteria>`, `<output>` (SUMMARY.md path). Each plan commits per-task; coverage-gates.json updated in the plan that adds the service.

---

## Open Questions / Decisions for the Planner

1. **Tax rounding: floor vs half-up.** `MoneyUtils.taxPerLine` FLOORs; BLR-1 says "Half-up"; US-2.2 AC7 says "rounded half-up to nearest paisa". RECOMMEND: per-line half-up (use a half-up computation, not `taxPerLine`'s floor) to match the two user-facing specs; flag the `MoneyUtils` mismatch to shared-lib owners. CONFIDENCE: MEDIUM.
2. **`kitchen_db` full DDL** is not specified (only table names, M10.3). Planner finalises columns (proposed above). CONFIDENCE: MEDIUM.
3. **`order_discounts` table** referenced (US-2.4 AC6) but absent from M1.3 DDL — planner defines it. CONFIDENCE: HIGH (it's required).
4. **Receipt generation** (ESC/POS thermal + email/WhatsApp, M1.2) — out of scope for events but UI has a receipt modal. Recommend: defer printing integration; generate a digital receipt payload/URL only. Flag as deferred.
5. **`ORDER_READY → POS` queue name** not in the topology table (only `kitchen.order-sent.queue` listed). Planner declares `pos.order-ready.queue` bound to `kitchen.topic`/`kitchen.order.ready`.
6. **`customer_id` on orders** — add nullable column now; CRM (Phase 9) populates later.
7. **Combo/bundle items** (`is_combo`, M1.2) — minimal support; expand-to-components or treat as single line? Recommend single line for v1.
8. **By-item split proportional tax/service-charge** algorithm (US-2.6 AC2) — define rounding (largest-remainder vs first-share). Recommend first-share remainder (consistent with BLR-1).

---

## Recommended Plan Split (dependency waves)

| Plan | Objective (one line) | Wave | Depends on |
|---|---|---|---|
| **07-01** | Scaffold pos-service (8084, pos_db, Flyway+RLS) + menu/table reference + order CRUD + state machine (DRAFT→…→SENT_TO_KDS) + per-line floored tax + discount-floor (POS-01/02/05) + `ORDER_CREATED`/`ORDER_SENT_TO_KDS` via outbox | 1 | Phase 3 (gateway/auth), Phase 6 (period status endpoint) |
| **07-02** | Tills (open/close, variance, `TILL_OPENED`/`TILL_CLOSED`) + split-tender idempotent close (`ORDER_CLOSED` w/ `customerId`, period-lock 423) + voids/refunds (OPA threshold, extend `pos.rego`) + internal `open-orders-count` endpoint for Finance close (POS-03/04/06/08) | 2 | 07-01 |
| **07-03** | Offline POS PWA — Workbox Service Worker + IndexedDB queue, sync-on-reconnect with `client_order_id` idempotency, offline UI banners, menu cache (POS-07) | 3 | 07-01, 07-02 (REST contract stable) |
| **07-04** | kitchen-service (8090, kitchen_db) — consume `ORDER_SENT_TO_KDS`, station routing, ticket lifecycle PENDING→COOKING→READY, `ORDER_READY` (WebSocket KDS board, always-dark UI) (KDS-01/02) | 2 | 07-01 (emits SENT_TO_KDS) — can run parallel to 07-02 |

Waves: **W1** = 07-01. **W2** = 07-02 + 07-04 (parallel; both depend only on 07-01). **W3** = 07-03 (needs both POS write + close endpoints). Frontend POS terminal/floor/payment/till UI ships within 07-01/07-02; KDS board UI within 07-04; offline shell within 07-03.

---

## Sources

**Primary (HIGH):**
- `Docs/RestaurantERP_SaaS_Specification.md` — M1 POS (L1611–1799), M10 KDS (L2489–2521), service registry (L394–400), permissions (B.1 L2938), feature flags (L2985–3005).
- `Docs/RestaurantERP_UserStories_FlowDiagrams.md` — US-2.1–2.10 (L229–391), FD-3 state machine (L985), FD-4 close fan-out (L1037), FD-5 offline sync (L1096), FD-11 KDS routing (L1416), FD-14 period close (L1554), BLR-1/4/5/9/10 (L1919–2013).
- `Docs/agent-specs/02-event-schema-registry.md` — envelope, topology, POS/Kitchen payloads, idempotency, DLQ.
- `Docs/agent-specs/03-shared-lib-specification.md` — all primitive signatures; `shared-lib/src/main/java/.../MoneyUtils.java` (actual impl).
- `Docs/agent-specs/04-internal-api-contracts.md` — POS/Finance internal endpoints, Feign config.
- `Docs/agent-specs/10-test-architecture-guide.md` — coverage gates (L332–341).
- `services/finance-service/**` — canonical skeleton (pom, application.yml, V1 schema, V4 RLS fix, FinanceTestBase, AccountingPeriodServiceImpl).
- `policies/restaurantos/pos.rego` — existing (incomplete) POS policy.
- `frontend/lib/repositories/finance.repository.ts`, `lib/hooks/finance/use-gl.ts`, `proxy.ts`, design system §7.1/§7.2 — four-layer + UX.
- `.planning/phases/06-finance-core-general-ledger-periods/06-01-PLAN.md` — PLAN format/frontmatter.

**Confidence breakdown:** Stack/skeleton HIGH (in-repo proven). Data model HIGH (spec DDL) except kitchen_db MEDIUM (names only). Events HIGH (registry). Money rounding MEDIUM (floor/half-up spec conflict). Offline PWA MEDIUM (no existing SW in repo; Next 16 PWA is greenfield here).

**Research date:** 2026-06-28 — valid until ~2026-07-28 (stable in-repo specs).
