# ResturantOS — Integration Seam Map

**Scope:** where modules fail to connect. Event bus topology, publish→consume closure, the money
path, inventory depletion, HR→finance, the outbox relay, and Feign clients pointing at endpoints
that do not exist.

**Method:** every claim below is grounded in a file I opened in this repo at commit `5fba4a9`
(branch `phase-13-access-repair`). Paths are absolute-from-repo-root. Where I could not verify
something I say so explicitly rather than guessing — see [§13 Not verified](#13-what-i-could-not-verify).

**No external sources were fetched.** Every statement here is about this repository.

---

## 1. The bus at a glance

**Publisher side.** There is exactly one publishing mechanism: the transactional outbox.

- `shared-lib/src/main/java/io/restaurantos/shared/event/DomainEventPublisher.java` — the only
  implementation of `EventPublisher`. `publish(exchange, routingKey, eventType, branchId, payload)`
  writes an `EventEnvelope` JSON row into `event_outbox` with `status='PENDING'`. It never touches
  RabbitMQ.
- `shared-lib/src/main/java/io/restaurantos/shared/event/OutboxRelay.java` — `@Scheduled(fixedDelay = 1000)`,
  `findTop200ByStatusOrderByCreatedAtAsc("PENDING")`, `rabbitTemplate.send(...)`, `status='SENT'`.
- Both are registered unconditionally in
  `shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java:178-188`,
  which is itself `@EnableScheduling` (line 50) and listed in
  `shared-lib/src/main/resources/META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`.

**Consumer side.** 24 `@RabbitListener` methods across 7 services. There is no other consumer
mechanism (no Kafka, no Spring Cloud Stream, no polling readers).

**Exchanges** (`deploy/init/rabbitmq-definitions.json`): `pos.topic`, `inventory.topic`,
`finance.topic`, `purchasing.topic`, `hr.topic`, `auth.topic`, `platform.topic`, `kitchen.topic`,
`notifications.topic`, `restaurantos.dlx`.

### 1a. Canonical payload contracts

`shared-lib/src/main/java/io/restaurantos/shared/event/payload/` holds six files. Four are typed
contract holders, two are standalone records:

| File | Exchange | Event types declared |
|---|---|---|
| `PosEventContract.java` | `pos.topic` | `ORDER_CLOSED`, `ORDER_REFUNDED`, `TILL_CLOSED` |
| `InventoryEventContract.java` | `inventory.topic` | `STOCK_DEPLETED`, `STOCK_RECEIVED`, `LOW_STOCK_ALERT`, `EXPIRY_ALERT`, `COUNT_VARIANCE_POSTED`, `WASTAGE_RECORDED`, `TRANSFER_SHIPPED`, `TRANSFER_RECEIVED`, `TRANSFER_VARIANCE`, `DEPLETION_INCOMPLETE` |
| `PurchasingEventContract.java` | `purchasing.topic` | `GRN_RECEIVED`, `VENDOR_INVOICE_MATCHED`, `PO_APPROVED`, `PO_CLOSED`, `AP_PAYMENT_PROCESSED` |
| `HrEventContract.java` | `hr.topic` | `PAYROLL_RUN_APPROVED`, `PAYROLL_RUN_PAID` |
| `PasswordResetRequestedPayload.java` | `auth.topic` | `PASSWORD_RESET_REQUESTED` |
| `AdminPasswordResetPayload.java` | `auth.topic` | `ADMIN_PASSWORD_RESET` |

**Seam already visible here:** 15 of the ~28 routing keys actually published by services have **no
shared contract record at all** — `pos.order.created`, `pos.order.sent_to_kds`, `pos.order.voided`,
`pos.order.item_served`, `pos.order.item_cancelled`, `pos.till.opened`, `pos.till.reviewed`,
`pos.menu_item.upserted`, `pos.menu_item.deleted`, `kitchen.order.ready`,
`kitchen.item.status-changed`, `hr.employee.joined`, `hr.employee.left`, `hr.attendance.punched`,
`finance.period.closed`, `finance.journal.posted`, `platform.tenant.provisioned`. Several of those
DO have live consumers (kitchen consumes five POS keys, pos consumes two kitchen keys) and are
carried as ad-hoc records/`HashMap`s local to each service — e.g.
`services/finance-service/.../JournalEntryServiceImpl.java:296-308` builds a `HashMap<String,Object>`
payload. The compile-time producer/consumer coupling that `PosEventContract` exists to give you
does not cover the pos↔kitchen path at all.

---

## 2. Full publish → consume matrix

Publishers were found by grepping every `eventPublisher.publish(` call site in `src/main`.
Consumers were found from `@RabbitListener(queues = …)` plus the queue→exchange→routing-key
bindings in each service's Rabbit config and in `deploy/init/rabbitmq-definitions.json`.

`audit.all-events.queue` is bound `#` to all nine topic exchanges
(`deploy/init/rabbitmq-definitions.json`), so audit-service archives everything. It is excluded
from the "consumed" column below because archiving is not a functional consumer — the events below
marked ORPHAN reach audit and nothing else.

| Routing key | Published by | Functional consumers |
|---|---|---|
| `pos.order.created` | `pos/service/OrderServiceImpl.java:309` | **none — ORPHAN** |
| `pos.order.sent_to_kds` | `OrderServiceImpl.java:529` | kitchen `OrderSentToKdsConsumer` |
| `pos.order.voided` | `OrderServiceImpl.java:679` | kitchen `OrderVoidedConsumer` |
| `pos.order.item_served` | `OrderServiceImpl.java:814` | kitchen `OrderItemServedConsumer` |
| `pos.order.item_cancelled` | `OrderServiceImpl.java:851` | kitchen `OrderItemCancelledConsumer` |
| `pos.order.closed` | `OrderServiceImpl.java:780` | kitchen, inventory, finance, crm, reporting |
| `pos.order.refunded` | `pos/service/RefundServiceImpl.java:120` | finance, crm |
| `pos.till.opened` | `pos/service/TillServiceImpl.java:86` | **none — ORPHAN** |
| `pos.till.closed` | `TillServiceImpl.java:131` | reporting `TillClosedConsumer` |
| `pos.till.reviewed` | `pos/service/TillReviewService.java:104` | **none — ORPHAN** |
| `pos.menu_item.upserted` | `pos/service/MenuServiceImpl.java:303` | inventory `MenuItemCatalogConsumer` |
| `pos.menu_item.deleted` | `MenuServiceImpl.java:234` | inventory `MenuItemCatalogConsumer` |
| `kitchen.order.ready` | `kitchen/service/TicketServiceImpl.java:255` | pos `OrderReadyConsumer` |
| `kitchen.item.status-changed` | `TicketServiceImpl.java:92` | pos `KitchenItemStatusConsumer` |
| `inventory.stock.depleted` | `inventory/service/DepletionService.java:197` | finance `StockDepletedConsumer` |
| `inventory.stock.received` | `inventory/service/ReceiptService.java:108` | finance `StockReceivedConsumer` |
| `inventory.wastage.recorded` | `inventory/service/WastageService.java:145` | finance `WastageConsumer` |
| `inventory.count.variance` | `inventory/service/StockCountService.java:190` | finance `CountVarianceConsumer` |
| `inventory.transfer.shipped` | `inventory/service/TransferService.java:171` | finance `TransferShippedConsumer` |
| `inventory.transfer.received` | `TransferService.java:284` | finance `TransferReceivedConsumer` |
| `inventory.transfer.variance` | `TransferService.java:294` | **none — ORPHAN** |
| `inventory.stock.low` | `DepletionService.java:179` | **queue exists, no consumer — ORPHAN** |
| `inventory.lot.expiry` | `inventory/service/ExpirySweepService.java:123` | **none — ORPHAN** |
| `inventory.depletion.incomplete` | `DepletionService.java:209` | **none — ORPHAN** |
| `purchasing.grn.received` | `purchasing/service/GrnReceiptSimulator.java:189` | inventory `GrnReceivedConsumer` |
| `purchasing.invoice.matched` | `purchasing/service/VendorInvoiceService.java:172` | reporting `VendorInvoiceMatchedConsumer` |
| `purchasing.po.approved` | `purchasing/service/PoApprovalService.java:123` | **none — ORPHAN** |
| `purchasing.po.closed` | `purchasing/service/PurchaseOrderService.java:257` | **none — ORPHAN** |
| `purchasing.payment.processed` | `purchasing/service/ApPaymentService.java:103` | **none — ORPHAN** |
| `hr.payroll.approved` | `hr/service/PayrollRunService.java:214` | finance `PayrollApprovedConsumer` |
| `hr.payroll.paid` | `PayrollRunService.java:235` | finance `PayrollPaidConsumer` |
| `hr.employee.joined` | `hr/service/EmployeeService.java:63` | **none — ORPHAN** |
| `hr.employee.left` | `EmployeeService.java:108` | **none — ORPHAN** |
| `hr.attendance.punched` | `hr/service/PunchIngestService.java:141` | **none — ORPHAN** |
| `finance.period.closed` | `finance/service/PeriodCloseService.java:107` | **none — ORPHAN** |
| `finance.journal.posted` | `finance/service/JournalEntryServiceImpl.java:303` | **none — ORPHAN** |
| `auth.user.login_succeeded` | `auth/service/LoginEventPublisher.java:29` | **none — ORPHAN** |
| `auth.user.login_failed` | `LoginEventPublisher.java:35` | **none — ORPHAN** |
| `auth.user.password_changed` | `auth/service/PasswordChangeService.java:124` | **none — ORPHAN** |
| `auth.user.password_reset_requested` | `auth/service/PasswordResetService.java:246` | **none — ORPHAN (documented, D-31)** |
| `auth.user.password_reset_by_admin` | `auth/service/AdminPasswordResetService.java:246` | **none — ORPHAN (documented, D-31)** |
| `platform.tenant.provisioned` | `platform/service/ProvisioningService.java:276` | **none — ORPHAN** |

**Count: 41 routing keys published, 18 with a functional consumer, 23 orphaned.**

I verified each ORPHAN by grepping the full string across all `src/main` Java and all JSON under
`deploy/` — no queue binds them and no `@RabbitListener` reads them.

---

## 3. Consumers / queues waiting for events nobody sends

There is exactly one, and it is broker-side rather than code-side:

**`notification.low-stock.queue`** is declared and bound `inventory.topic --[inventory.stock.low]-->`
in `deploy/init/rabbitmq-definitions.json`. `services/notification-service/` contains only
`pom.xml` and `README.md` — **no `src/` directory at all**. So `LOW_STOCK_ALERT` is published on
every reorder-point breach (`DepletionService.java:179`), routed into a durable queue with no
`x-message-ttl` and no `x-max-length`, and never read. That queue grows without bound for the life
of the broker.

This is the one gap that is already written down: `services/notification-service/README.md` and
`Docs/known-gaps/notification-delivery.md` record it as decision D-31 (email delivery declared out
of scope). The README is candid that "the self-service *forgot password* flow is end-to-end dead."
What the README does **not** mention is the unbounded low-stock queue — that is a second, separate
consequence of the same missing service.

Note also `deploy/docker-compose.yml:210` runs a **mailpit** SMTP catcher on 1025/8025. Nothing in
the repo can send to it: `grep -rln "JavaMailSender|SendGrid|Twilio|smtp"` over all of `services/`
returns zero files. The infrastructure for email exists; the code does not.

**No `@RabbitListener` in the repo is bound to a routing key nobody publishes.** Every one of the
24 listeners is reachable. The failures are all on the publish side.

---

## 4. THE MONEY PATH — order → payment → ORDER_CLOSED → journal entry

### 4a. The chain

1. `pos/service/OrderServiceImpl.java:739` — on close, `businessDate = BusinessDay.of(closedAt)`.
2. `:740` — `FinancePeriodClient.assertPeriodOpen(...)` over Feign to
   `GET /internal/finance/periods/status` (endpoint exists:
   `finance/web/InternalFinanceController.java:96`).
3. `:762-778` — builds `PosEventContract.OrderClosedPayload`.
4. `:780` — `eventPublisher.publish(pos.topic, pos.order.closed, ORDER_CLOSED, branchId, payload)`
   → row in `event_outbox`.
5. `OutboxRelay` picks it up within ~1s → `pos.topic`.
6. `finance.order-closed.queue` (bound in both `FinanceRabbitConfig.java:55` and the broker
   definitions) → `finance/autopost/consumer/OrderClosedConsumer.java:42`.
7. → `AutoPostingRecipeEngine.postOrderRevenue` →
   `JournalEntryServiceImpl.autoPostInternal` → `create()` DRAFT → `post()` sets `POSTED`.
8. At COMMIT, the deferred constraint trigger `trg_je_balance_on_post`
   (`finance/src/main/resources/db/migration/V1__finance_schema.sql:187`) checks `SUM(debit) = SUM(credit)`.

**The chain is fully wired. It does not balance.**

### 4b. BROKEN SEAM — every discounted order fails to post to the ledger

`AutoPostingRecipeEngine.postOrderRevenue`
(`services/finance-service/src/main/java/io/restaurantos/finance/autopost/AutoPostingRecipeEngine.java:94-120`):

```java
long netRevenue = p.subtotalPaisa() - p.discountPaisa();

List<CreateJeLineRequest> lines = new ArrayList<>();
addPaymentDebits(p, lines);                                              // DR sum(payments) == totalPaisa

if (p.discountPaisa() > 0) {
    lines.add(line(tag("DISCOUNT"), "Discount", p.discountPaisa(), 0));  // DR discount
}
if (netRevenue > 0) {
    lines.add(line(tag("REVENUE"), "Sales revenue", 0, netRevenue));     // CR subtotal - discount
}
if (p.serviceChargePaisa() > 0) { ... 0, p.serviceChargePaisa() }        // CR service charge
if (p.taxPaisa() > 0)          { ... 0, p.taxPaisa() }                   // CR tax
```

The producer's invariant, stated in `PosEventContract.java:37-42` and enforced in
`pos/service/OrderPricingCalculator.java:99-111`:

```java
subtotal += item.getLineTotalPaisa() + item.getDiscountPaisa() - item.getTaxPaisa();  // GROSS
long total = Math.max(0L, subtotal - totalDiscount + tax + serviceChargePaisa);
```

so `subtotalPaisa` is **gross, before discount**, and `totalPaisa = subtotal − discount + tax + sc`,
and `sum(payments) == totalPaisa`.

Substituting:

```
DR = totalPaisa + discount = (subtotal − discount + tax + sc) + discount = subtotal + tax + sc
CR = (subtotal − discount) + sc + tax
DR − CR = discountPaisa
```

**The entry is out of balance by exactly the discount, on every order with a discount.** The
`DISCOUNT` debit is a contra-revenue line, which is correct — but then the revenue credit must be
the **gross** `subtotalPaisa`, not `subtotalPaisa − discountPaisa`. The discount is being subtracted
twice.

What happens at runtime:

1. `post()` sets `status='POSTED'`. There is **no Java-side balance check** — I read
   `JournalEntryServiceImpl.post(UUID)` and it validates only "already posted" and "period locked".
   The DB trigger is the sole gate.
2. At COMMIT, `fn_check_balance_on_post` raises `JE_UNBALANCED … ERRCODE = 'check_violation'`
   (23514) → `DataIntegrityViolationException` out of the listener.
3. `services/finance-service/src/main/resources/application.yml` has **no
   `spring.rabbitmq.listener` block at all** (I checked lines 30-41: only host/port/username/password).
   So Spring Boot's default `default-requeue-rejected=true` applies and the message is
   **requeued forever**, not dead-lettered.

This is the exact failure mode the code's own doc comment describes for a different cause
(`AutoPostingRecipeEngine.java:85-88`): *"the deferred balance trigger rejected the entry, and the
message was redelivered ~17 times a second indefinitely."* That incident was fixed by capping
over-tender in pos. The discount arithmetic re-creates the same loop.

**Why no test caught it.** The only ORDER_CLOSED integration test,
`services/finance-service/src/test/java/io/restaurantos/finance/autopost/OrderCloseAutoPostingIT.java:163-176`,
hard-codes `subtotal = 80_000`, `tax = 5_600`, `serviceCharge = 4_000`,
`total = subtotal + tax + serviceCharge`, and passes `0L` for discount. `grep -rn "discountPaisa"`
across `services/finance-service/src/test` returns **one hit, and it is a doc comment**
(`OrderCloseAutoPostingIT.java:158`). There is no unit test on `postOrderRevenue`.

**Severity: highest in this report.** Any tenant that applies a single discount produces an order
that (a) never reaches the general ledger, (b) pins a finance-service consumer thread in a
redelivery hot loop, and (c) leaves finance's carefully-declared `finance.order-closed.queue.dlq`
empty, because requeue-on-reject means nothing ever dead-letters.

### 4c. Also on the money path — `TILL_CLOSED` variance never reaches the ledger

`PosEventContract.TillClosedPayload` (`PosEventContract.java:120-126`) carries
`expectedCashPaisa`, `countedCashPaisa`, `variancePaisa`. The only consumer is
`reporting/consumer/TillClosedConsumer.java`. `FinanceRabbitConfig.SUBSCRIPTIONS` (lines 55-64) has
no till subscription. Cash over/short is a P&L item; here it is recorded in the reporting star
schema and never journalled. `pos.till.reviewed` (`TillReviewService.java:104`) — the *approval* of
that variance — has no consumer at all.

---

## 5. Inventory depletion — this one works

`ORDER_CLOSED` → `inventory.order-closed.queue` → `inventory/consumer/OrderClosedConsumer.java:46`
→ `DepletionService.deplete(branchId, payload)`
(`services/inventory-service/src/main/java/io/restaurantos/inventory/service/DepletionService.java:100-215`).

Verified end to end in source:

- resolves an effective recipe per `ItemEntry` via `recipeService.resolveEffectiveRecipe(menuItemId, closedAt)` (`:102`)
- converts recipe-line UOM to base units through `UomConverter.effectiveBaseQty` (`:119`)
- locks ingredients in sorted UUID order before writing (`:129`, explicit deadlock avoidance)
- FEFO lot walk floored at zero, aggregate `qty_on_hand` decremented by the full requirement (`:145-152`)
- COGS at the aggregate moving-average cost (`:155`), writes a signed-negative `DEPLETION` movement (`:158-168`)
- publishes `STOCK_DEPLETED` with per-line GL account codes (`:197`) → finance
  `postOrderCogs` (`AutoPostingRecipeEngine.java:138-188`), which re-checks that per-line costs sum
  to the header and throws if not.

There is a live proof test: `services/inventory-service/src/test/java/io/restaurantos/inventory/LiveDepletionProofIT.java`.

**Gap in this otherwise-good path:** when a menu item has no effective recipe the line is skipped
and `DEPLETION_INCOMPLETE` is published (`DepletionService.java:209`) specifically so the hole is
"visible rather than silent" — but **nothing consumes `inventory.depletion.incomplete`**. There is
no queue bound to it in any Rabbit config or in the broker definitions. The alert is written to the
outbox, relayed to `inventory.topic`, and lands only in the audit archive. Nobody is told. Same
story for `EXPIRY_ALERT` (`ExpirySweepService.java:123`) and `TRANSFER_VARIANCE`
(`TransferService.java:294`).

**Refunds do not touch stock.** There is no inventory consumer on `pos.order.refunded`. That is a
deliberate accounting decision for COGS — `AutoPostingRecipeEngine.java:207-209` argues *"Refunding
a meal does not un-consume the ingredients"* — but it means a refunded-and-returned item has no
path back into stock at all except a manual wastage or receipt entry.

---

## 6. HR payroll → finance — this one works

`PayrollRunService.approve` (`services/hr-service/.../PayrollRunService.java:202-215`) publishes
`HrEventContract.PayrollApprovedPayload` with all six components (gross, net, tax, EOBI, advances,
late-arrival). `pay()` (`:218-236`) publishes `PayrollPaidPayload`.

Finance binds both (`FinanceRabbitConfig.java:63-64`) and
`AutoPostingRecipeEngine.postPayrollApproved` (`:403-470`) re-derives and asserts the identity
`gross − lateArrival == net + tax + eobi + advances` before posting, throwing loudly on a mismatch
rather than posting a plausible number. `postPayrollPaid` (`:476+`) clears wages payable.

**One topology drift, not a break:** `finance.payroll-paid.queue` is declared in
`FinanceRabbitConfig.java:47` and in `SUBSCRIPTIONS` (line 64), but it is **absent from
`deploy/init/rabbitmq-definitions.json`** — that file has `finance.payroll-approved.queue` only.
Spring's `Declarables` bean (`FinanceRabbitConfig.java:74`) will create it at finance-service
startup, so it works — but the definitions file is a stale partial snapshot. Eight queues declared
in code are missing from it entirely: `finance.payroll-paid.queue`,
`inventory.grn-received.queue`, `reporting.till-closed.queue`,
`reporting.invoice-matched.queue`, `kitchen.item-cancelled.queue`, `kitchen.item-served.queue`,
`kitchen.order-closed.queue`, `pos.kitchen-item-status.queue`. Anything that provisions a broker
from that file alone and then inspects it will conclude those flows do not exist.

---

## 7. BROKEN SEAM — purchasing double-posts every goods receipt

This is the second-worst finding, and it is a genuine "looks wired but isn't" — it looks wired
*twice*.

One user action, `POST /api/v1/purchasing/purchase-orders/{poId}/mock-receive`
(`purchasing/web/MockGrnController.java:31`, reachable through the gateway's
`Path=/api/v1/purchasing/**` route at `gateway/src/main/resources/application.yml:265`, driven by
the live UI component `frontend/components/purchasing/MockGrnReceivePanel.tsx`), triggers **two
independent inventory postings**:

**Path A — direct Feign, hardcoded account codes.**
`purchasing/service/GrnReceiptSimulator.java:111-121`:

```java
financeInternalClient.autoPost(tenantId, new FinanceInternalClient.AutoPostJeRequest(
        po.getBranchId(), LocalDate.now(), "GRN receipt " + batchGrnId, "GRN", batchGrnId,
        List.of(new FinanceInternalClient.JeLine("1300", "Inventory",       inventoryAmount, 0L),
                new FinanceInternalClient.JeLine("1700", "GR/IR Clearing",  0L, inventoryAmount))));
```

**Path B — event chain.** The same method then publishes `GRN_RECEIVED` (`:189`) →
`inventory/consumer/GrnReceivedConsumer.java:69` → `ReceiptService.receive(...)` per line →
`ReceiptService.java:108` publishes `STOCK_RECEIVED` → `finance.stock-received.queue` →
`AutoPostingRecipeEngine.postStockReceipt` (`:244-260`):

```java
line(tag("INVENTORY"), "Stock received", p.totalCostPaisa(), 0),
line(tag("GR_IR"),     "GR/IR clearing", 0, p.totalCostPaisa()));
```

`tag("INVENTORY")` resolves to **1300** and `tag("GR_IR")` to **1700** — I confirmed both:
`finance/seed/PakistanRestaurantCoaTemplate.java:45` seeds `("1700", "GR/IR Clearing", ASSET, "1000", true, "GR_IR")`,
and `V8__auto_posting_account_tags.sql:37-42` explicitly keeps 1300 on the `INVENTORY` tag
*because* "purchasing-service hardcodes the literal '1300'".

So both paths hit the **same two accounts**. The idempotency guard cannot catch it: path A is keyed
`(sourceType="GRN", sourceId=batchGrnId)` and path B `(sourceType="STOCK_RECEIPT", sourceId=lotId)`
(`AutoPostingRecipeEngine.alreadyPosted`, `:583-586`). Two different keys, two entries, one physical
receipt.

Consequences: inventory (1300) is debited twice per receipt; GR/IR (1700) is credited twice while
the vendor invoice (`VendorInvoiceService.java:160`, `JeLine("1700", …, net, 0L)`) debits it once —
so **GR/IR carries a permanent, monotonically growing credit balance equal to the sum of all
receipts**, and the inventory control account permanently doubles against the inventory sub-ledger.

That is structurally the same failure as the pre-V9 payroll drift the code documents at
`V9__payroll_statutory_accounts.sql:14` — both entries balance individually, no trigger fires, no
consumer errors, and the ledger just drifts.

**Related, lower-severity:** purchasing posts to finance with **hardcoded literal account codes**
in all three of its recipes — `1300`/`1700` (`GrnReceiptSimulator.java:119-120`),
`1700`/`1710`/`2100` (`VendorInvoiceService.java:160-162`), `2100`/bank
(`ApPaymentService.java:87-88`). Finance's own engine resolves every account by `system_tag`
precisely because the chart of accounts is tenant-editable
(`AutoPostingRecipeEngine.java:38-44`). A tenant who renumbers or deactivates 1700 breaks
purchasing silently while finance keeps working.

---

## 8. Outbox relay audit — is every service's outbox drained?

**Table present in all 16 services.** I checked each: seven via Flyway
(`db/migration/V*_shared_infra_tables.sql`, plus `pos` V2, `kitchen` V2, `reporting` V1) and eight
via Liquibase (`db/changelog/v1.0.0/*shared-infra-tables.xml`). `notification-service` has none —
correct, it has no code.

**No RLS on `event_outbox`.** `services/finance-service/src/main/resources/db/migration/V2__shared_infra_tables.sql:1-2`
states it explicitly: *"NON-RLS per Doc 8 §8.9 — relay and idempotency run outside tenant request
context."* `services/hr-service/.../020-shared-infra-tables.xml` likewise creates the table with a
plain `GRANT` and no policy. So the relay's tenant-less scheduler thread **can** see rows. This was
my main suspicion for a silent-drop and it is **not** a bug.

**Relay is registered everywhere shared-lib is on the classpath**, unconditionally
(`SharedAutoConfiguration.java:185-188`) with `@EnableScheduling` on the same class (line 50).

Four real defects in the relay itself
(`shared-lib/src/main/java/io/restaurantos/shared/event/OutboxRelay.java`, 40 lines, no tests —
`find . -name "*Outbox*"` returns only the three production classes):

1. **No publisher confirms.** `rabbitTemplate.send(...)` then `e.setStatus("SENT")` unconditionally.
   `grep -rn "publisher-confirm|publisherConfirm|publisher-returns"` across `services/`,
   `shared-lib/`, `config-server/` returns **zero hits**. An unroutable message or a wrong exchange
   name fails asynchronously at the channel level; the row is already marked SENT. The outbox
   guarantees the row was written, not that the event was delivered.
2. **No distributed lock.** `grep -rn "shedlock|SchedulerLock"` over all `pom.xml` and Java returns
   **zero hits**. `findTop200ByStatusOrderByCreatedAtAsc` has no `FOR UPDATE SKIP LOCKED`. Two
   replicas of any service publish every event twice. Consumers are idempotent via `processed_events`
   so this is survivable — but the duplicate is deduped per-consumer, and the ORPHAN events in §2
   have no dedup at all.
3. **No failure isolation.** One entry whose send throws rolls back the whole `@Transactional`
   batch; the next tick re-reads the same 200 rows in the same order. A permanently poisonous entry
   (e.g. an exchange that does not exist) blocks every event behind it forever. There is no `FAILED`
   status, no attempt counter, no dead-letter path for the outbox.
4. **`@Scheduled(fixedDelay = 1000)` is fixed at 1s with no configurability** and no backpressure —
   noted, not a defect.

**Verdict: every service's outbox IS being drained. The relay is single-threaded, unconfirmed, and
unlocked.**

---

## 9. Feign clients — one points at an endpoint that does not exist

I enumerated all 21 `@FeignClient` interfaces and all `@RequestMapping`/`@*Mapping` pairs on every
`/internal` controller, then matched them.

### 9a. BROKEN — `InventoryGrnClient` calls a route no service serves

`services/purchasing-service/src/main/java/io/restaurantos/purchasing/feign/InventoryGrnClient.java:18`

```java
@GetMapping("/internal/inventory/po-lines/{poLineId}/grn-summary")
```

inventory-service's four internal controllers are:

| Controller | Effective paths |
|---|---|
| `web/InternalUomController.java` | `/internal/inventory/uom-codes` |
| `web/InternalIngredientCategoryController.java` | `/internal/inventory/ingredient-categories` |
| `web/InternalGrnController.java` | `/internal/grn/pending-count` |
| `web/InternalReorderController.java` | `/internal/inventory/reorder-shortfalls` |

`grep -rn "grn-summary"` across the whole repo returns **exactly one hit — the Feign declaration
itself**. `grep -rn "po-lines"` likewise. The endpoint has never existed.

It is reached through `adapter/InventoryGrnClientAdapter.java:26`, which is
`@ConditionalOnProperty(name = "restaurantos.inventory.integration-mode", havingValue = "feign")`.
The default is **`mock`** (`purchasing/config/InventoryIntegrationProperties.java:18` and
`purchasing/src/main/resources/application.yml:72`, `${INVENTORY_INTEGRATION_MODE:mock}`), and
`PurchasingTestBase.java:51` pins every IT to `mock`. So today three-way matching reads
`mock_grn_receipts` rows written by `GrnReceiptSimulator` and never consults real inventory GRN
data — and the moment anyone flips `INVENTORY_INTEGRATION_MODE=feign` to make it real, every
three-way match 404s.

This is the same shape as the documented "compensation that could never fire because Feign cannot
send PATCH": a code path that is structurally present, conditionally disabled, and would fail
immediately if enabled.

Note the asymmetry: purchasing's other three feign seams (`InventoryUomClient`,
`InventoryCategoryClient`, `InventoryReorderClient`) **do** have real endpoints. Only GRN is
dangling. `InventoryReorderClient.java:16` even has a comment acknowledging these adapters "exist
because purchasing shipped before the real inventory endpoints" — the GRN one is the one that never
got its endpoint.

### 9b. Verified-good Feign edges

All of these resolve to a real controller mapping (path shown as the client declares it):

| Caller → target | Path | Serving controller |
|---|---|---|
| purchasing → finance | `POST /internal/finance/journal-entries` | `finance/web/InternalFinanceController.java:56` |
| purchasing → finance | `GET /internal/finance/accounts/search` | `InternalFinanceController.java:123` |
| purchasing → inventory | `GET /internal/inventory/uom-codes` | `InternalUomController.java:44` |
| purchasing → inventory | `GET /internal/inventory/ingredient-categories` | `InternalIngredientCategoryController.java:46` |
| purchasing → inventory | `GET /internal/inventory/reorder-shortfalls` | `InternalReorderController.java:41` |
| purchasing/finance → authorization | `POST /internal/authorize` | `authz/controller/InternalAuthorizeController.java:26` |
| pos → finance | `GET /internal/finance/periods/status` | `InternalFinanceController.java:96` |
| pos → finance | `POST /internal/finance/ar/charges` | `InternalFinanceController.java:84` |
| pos → crm | `POST /internal/crm/promotions/evaluate` | `crm/controller/internal/CrmInternalController.java:33` |
| inventory → finance | `GET /accounts/search`, `POST /accounts/resolve`, `POST /accounts/resolve-by-id` | `InternalFinanceController.java:123,145,158` |
| finance → pos | `GET /internal/orders/open-count` | `pos/web/InternalPosController.java:40` |
| finance → purchasing | `GET /internal/purchasing/invoices/unmatched-count`, `/grn/pending-count` | `InternalPurchasingController.java:69,84` |
| platform-admin → auth | 8 routes under `/internal/auth/**` | `AuthProvisioningInternalController`, `AuthInternalController`, `PlatformTokenInternalController`, `AdminPasswordResetInternalController` |
| platform-admin → user | `POST/DELETE /internal/users/branches*`, `GET /internal/users/tenants/{id}/branches` | `user/controller/BranchInternalController.java:46,91,102` |
| platform-admin → finance | `POST /internal/finance/tenants/{tenantId}/seed-coa` | `finance/web/InternalProvisioningController.java:45` |
| user → auth | 11 routes under `/internal/auth/users**` | `UserLifecycleInternalController`, `AuthInternalController` |
| reporting → user | `GET /internal/users/branches/{branchId}` | `BranchInternalController.java:58` |
| file → platform-admin | `GET /internal/platform/tenants/{tenantId}/status` | `PlatformInternalController.java:55` |
| shared-lib → platform-admin | `GET /internal/platform/tenants/{id}/features` | `PlatformInternalController.java:64` (via `PlatformAdminFeatureResolver.java:22`) |

### 9c. Internal endpoints nobody calls (the mirror-image seam)

Built, secured, routed — and dead. `grep` for each path across `services/`, `frontend/`, `gateway/`
found no caller outside the defining file:

| Endpoint | File |
|---|---|
| `GET /internal/audit/events` | `audit/controller/AuditInternalController.java:38` |
| `GET /internal/crm/customers/lookup` | `crm/controller/internal/CrmInternalController.java:28` |
| `GET /internal/purchasing/branches/{branchId}/open-receipts` | `InternalPurchasingController.java:47` |
| `GET /internal/purchasing/branches/{branchId}/pending-match-invoices` | `InternalPurchasingController.java:57` |
| `GET /internal/periods/current` | `finance/web/PeriodController.java:108` |
| `POST /internal/tenants/{tenantId}/provision` | `finance/web/InternalProvisioningController.java:29` |
| `POST /internal/menu-items/republish` | `pos/web/InternalPosController.java:61` (plausibly an ops tool) |
| `GET /internal/hr/labour-cost/branch/{branchId}` | `hr/controller/internal/HrInternalController.java:28` |

### 9d. The audit trail is write-only

`audit-service` ingests every event on every exchange (`audit/consumer/AllEventsConsumer.java:45`,
queue bound `#` to all nine topics) into an append-only table
(`audit-service/src/test/.../AuditImmutabilityIT.java` asserts UPDATE and DELETE raise). But:

- its **only** controller is `AuditInternalController` at `/internal/audit` — no `/api/v1/**` surface;
- `gateway/src/main/resources/application.yml` has **no route to `audit-service`** at all (I listed
  every `- id:`/`uri: lb://` pair — auth, jwks, role-catalog, authorization, platform×3, user, file,
  finance, purchasing, pos, kitchen, inventory, crm, hr×3, reporting, nlq; no audit);
- `find frontend -ipath "*audit*"` returns nothing.

So the compliance trail is being written and cannot be read by any UI, any service, or anything
through the gateway. That is the same class of defect as the documented "whole API unreachable
because of a role-claim bug", arrived at by a different route: the route simply was never added.

---

## 10. Cross-cutting seams found while tracing

### 10a. Three services requeue forever instead of dead-lettering

Every service declares DLQs and `x-dead-letter-exchange` arguments. Whether they are ever used
depends on `default-requeue-rejected`, and it is set in only half the services:

| Service | `acknowledge-mode` | `default-requeue-rejected` | retry | Effect on a business exception |
|---|---|---|---|---|
| pos (`application.yml:40-47`) | auto | **false** | 3 attempts, backoff | → DLQ |
| kitchen (`:41-48`) | auto | **false** | 3 attempts, backoff | → DLQ |
| inventory (`:48-49`) | auto | **false** | present | → DLQ |
| audit (`:49`) | auto | **absent** | absent | **infinite requeue** |
| finance | *no `listener` block at all* | default true | none | **infinite requeue** |
| crm | *no `listener` block at all* | default true | none | **infinite requeue** |
| reporting | *no `listener` block at all* | default true | none | **infinite requeue** |

`EventEnvelopeReader` throws `AmqpRejectAndDontRequeueException` for unparseable messages, so
*poison* messages still dead-letter everywhere. It is **business** exceptions — an unbalanced JE, a
missing account tag, `AccountNotConfiguredException` — that loop. Finance is the service where those
exceptions actually happen, and it is the one with no configuration. Its ten DLQs are decorative.

audit-service is the worst multiplier: it is the `#` catch-all for every exchange, so one event it
cannot ingest stalls the entire audit trail behind it.

### 10b. Only two of seven consuming services watch their DLQs

`PosDeadLetterMonitor` (`pos/consumer/PosDeadLetterMonitor.java`) and `KitchenDeadLetterMonitor`
(`kitchen/consumer/KitchenDeadLetterMonitor.java`) each `@RabbitListener` their own `.dlq` queues and
log at ERROR. Finance (10 DLQs), inventory (3), crm (2), reporting (3) and audit (1) have **no DLQ
monitor** — `grep -rn "DeadLetterMonitor"` finds only those two classes. Kitchen's own comment
(`:20`) names the risk: *"Without a monitor those DLQs sit silent."*

### 10c. `businessDate` is derived twice, differently, from the same event

- **pos** (producer): `BusinessDay.of(closedAt)` → `shared-lib/.../time/BusinessDay.java:18`
  → `of(at, ZoneOffset.UTC, 4)`. **UTC minus 4h.** This same value is what
  `FinancePeriodClient.assertPeriodOpen` validates and what rides on the payload.
- **finance** (consumer): uses the payload's `businessDate` verbatim
  (`AutoPostingRecipeEngine.post(...)`, `:528-532`) — correct, and explicitly designed that way.
- **reporting** (consumer): **ignores the payload field** and re-derives —
  `reporting/consumer/OrderClosedConsumer.java:75`:
  `businessDay.businessDate(env.payload().closedAt(), zone)` where `zone` comes from
  `BranchTimeZoneResolver.resolve(branchId)`. **Branch-local minus 4h**, via reporting's own
  `support/BusinessDay.java:30`.

For a UTC+5 branch these disagree for any order closed between roughly 04:00 and 09:00 local: pos
assigns it to the previous business day, reporting to the current one. The GL and the sales
dashboard will not tie out for those orders, and no test compares them. Reporting's `TillClosedConsumer.java:74`
and `VendorInvoiceMatchedConsumer.java:70` derive from `env.occurredAt()` (the *publish* timestamp),
which drifts further under any outbox backlog.

Also minor: `postOrderRefund` (`AutoPostingRecipeEngine.java:232`) calls the 5-arg `post(...)`
without a business date, so refunds are dated from `envelope.occurredAt()` while sales are dated
from the payload's `businessDate`.

### 10d. Deployment topology is infrastructure-only

`deploy/docker-compose.yml` defines postgres, redis, rabbitmq, minio, opa, eureka, config-server,
clickhouse, mailpit, pgadmin — and **no application service**. Every service has a `Dockerfile`, but
nothing composes them. I could not find a manifest that runs the 15 deployable services together;
see §13.

---

## 11. Ranked list of broken seams

| # | Seam | Severity | Evidence |
|---|---|---|---|
| 1 | Revenue JE is out of balance by `discountPaisa` on every discounted order → JE_UNBALANCED → infinite requeue | **Critical** | `AutoPostingRecipeEngine.java:100-116` vs `OrderPricingCalculator.java:99-111`; only test passes discount=0 |
| 2 | Every goods receipt posts DR 1300 / CR 1700 twice (direct Feign + STOCK_RECEIVED chain) | **Critical** | `GrnReceiptSimulator.java:111-121` + `:189` → `GrnReceivedConsumer.java:69` → `ReceiptService.java:108` → `AutoPostingRecipeEngine.java:257-259` |
| 3 | finance / crm / reporting / audit requeue business exceptions forever; DLQs never used | **Critical** | absent `spring.rabbitmq.listener` block in their `application.yml` |
| 4 | `InventoryGrnClient` → `GET /internal/inventory/po-lines/{id}/grn-summary` — endpoint does not exist | **High** | only repo hit is the declaration; three-way match runs on mock data by default |
| 5 | Outbox relay: no publisher confirms, no lock, no failure isolation, zero tests | **High** | `OutboxRelay.java` (40 lines) |
| 6 | 23 of 41 published routing keys have no consumer | **High** | §2 matrix |
| 7 | `notification.low-stock.queue` bound with no consumer and no TTL/max-length — unbounded growth | **High** | `rabbitmq-definitions.json`; `services/notification-service/` has no `src/` |
| 8 | Audit trail write-only: no gateway route to audit-service, no public controller, no caller | **High** | gateway route list; `AuditInternalController` only |
| 9 | `DEPLETION_INCOMPLETE` / `EXPIRY_ALERT` / `TRANSFER_VARIANCE` published as alerts, nothing listens | **Medium-High** | `DepletionService.java:209`, `ExpirySweepService.java:123`, `TransferService.java:294` |
| 10 | Till cash variance never journalled; `TILL_REVIEWED` orphaned | **Medium-High** | `PosEventContract.java:120-126`; `FinanceRabbitConfig.java:55-64` |
| 11 | `businessDate` derived twice with different rules (UTC-4h vs branch-local-4h) | **Medium-High** | `BusinessDay.java:18` vs `reporting/support/BusinessDay.java:30` |
| 12 | Purchasing posts to finance with hardcoded account literals while finance resolves by tag | **Medium** | `GrnReceiptSimulator.java:119`, `VendorInvoiceService.java:160-162`, `ApPaymentService.java:87-88` |
| 13 | Only pos + kitchen monitor their DLQs | **Medium** | two `*DeadLetterMonitor` classes |
| 14 | 8 code-declared queues absent from `rabbitmq-definitions.json` | **Medium** | §6 |
| 15 | 8 internal endpoints with no caller | **Low-Medium** | §9c |
| 16 | 17 routing keys have no shared contract record; pos↔kitchen coupling is untyped | **Low-Medium** | §1a |
| 17 | Refunds never restock and never reverse COGS | **Low** (documented intent) | `AutoPostingRecipeEngine.java:207-209` |

---

## 12. What is genuinely well-wired

Worth stating, because it narrows where to look next:

- **ORDER_CLOSED → inventory depletion → STOCK_DEPLETED → finance COGS.** Recipe resolution, UOM
  conversion, sorted locking, FEFO, moving-average cost, per-category GL accounts, and a producer/
  consumer sum reconciliation. Backed by `LiveDepletionProofIT`.
- **HR payroll → finance**, both legs, with the balance identity re-checked in the consumer.
- **pos ↔ kitchen**, five keys out and two back, with DLQ monitors on both ends and correct
  requeue configuration.
- **GRN_RECEIVED → inventory stock write** — the goods actually land in `stock_lots` with correct
  base-unit conversion (`GrnUomResolver`). It is only the *ledger* side that duplicates.
- **The outbox pattern itself** — non-RLS table, publish-inside-transaction, `processed_events`
  dedup with the action running *before* the marker is saved (`ProcessedEventService.tryProcess`),
  tolerant-reader `eventObjectMapper` with `FAIL_ON_UNKNOWN_PROPERTIES` disabled for the bus while
  REST stays strict.

---

## 13. What I could not verify

Stated plainly rather than guessed:

- **Whether the discount imbalance has ever fired in a running system.** I derived it from the
  arithmetic in `postOrderRevenue` against the producer's invariant and confirmed no test covers
  `discountPaisa > 0`. I did not run finance-service or execute the IT suite. The conclusion follows
  from the code, not from an observed failure.
- **Whether the GRN double-post amounts are numerically identical.** Path A uses PO unit price ×
  received qty in *order* units; path B uses base-unit qty × base-unit cost after `GrnUomResolver`
  conversion. They should agree, but I did not trace the rounding through `packFactor`/`toBaseUnits`
  to prove it. The *duplication* is certain regardless of whether the two amounts match exactly.
- **Runtime broker state.** I read `deploy/init/rabbitmq-definitions.json` and every Java
  `Declarables`/`Binding` bean. I did not connect to a broker, so I cannot say which queues exist in
  any particular environment or how deep `notification.low-stock.queue` currently is.
- **How services are actually deployed.** `deploy/docker-compose.yml` contains no application
  services. Every service has a `Dockerfile`, and `AUDIT-REPORT-2026-08-06.md` references a CI image
  matrix, but I did not find the manifest that runs them. Claims about replica counts (relevant to
  the missing outbox lock) are therefore conditional: **if** any service runs more than one replica,
  duplicate publishes follow.
- **Whether the orphaned events are intentional.** Only two of the 23 are documented as such
  (`auth.user.password_reset_requested` and `auth.user.password_reset_by_admin`, D-31 in
  `Docs/known-gaps/notification-delivery.md`). For the other 21 I found no decision record either
  way. I did not read the full `.planning/phases/` history; some may be deliberate reserved
  capacity.
- **`gitnexus` graph cross-check.** I traced call graphs by reading source directly rather than
  querying the MCP index, so nothing here depends on index freshness.
