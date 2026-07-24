---
status: complete
phase: 09-order-to-ledger-auto-posting-customer-loyalty
source: 09-01-SUMMARY.md, 09-02-SUMMARY.md
started: 2026-07-12T00:00:00Z
updated: 2026-07-12T06:10:00Z
mode: integration-test evidence (no UI surface in Phase 9)
environment:
  docker: dockerd 29.6.1 in WSL distro RestaurantOS-Ubuntu, DOCKER_HOST=tcp://<wsl-ip>:2375
  java: JDK 25.0.3 (Adoptium)
  maven: 3.9.9
  jvm_flag_required: "-XX:+EnableDynamicAgentLoading (JDK 25 blocks Mockito self-attach)"
  pagefile: "E: raised to initial=8192 max=16384 (commit limit was exhausted at 15.7GB)"
  note: |
    Phase 9 is backend-only. The environment blockers cited in 09-VERIFICATION.md
    (no Maven, JDK 18) are GONE — Maven 3.9.9 + JDK 25 + Docker all work now.
    With the environment working, the Phase 9 ITs were executed for the first time.

## Current Test

[testing complete]

## Executed Evidence (2026-07-12)

### FINAL STATE — after repairing the test harness (test files only; production code untouched)

**The auto-posting engine WORKS.** Once a valid accounting period exists, all 6 recipes
post balanced, POSTED journal entries. Observed debits/credits (paisa):

| Recipe | Debits | Credits | Balanced |
|--------|--------|---------|----------|
| ORDER_REVENUE | 85,600 | 85,600 | yes |
| ORDER_COGS | 36,000 | 36,000 | yes |
| WASTAGE | 45,000 | 45,000 | yes |
| COUNT_VARIANCE | 22,500 | 22,500 | yes |
| TRANSFER_SHIP | 225,000 | 225,000 | yes |
| TRANSFER_RECV | 225,000 | 225,000 | yes |

- `OrderCloseAutoPostingIT` PASS (incl. idempotency: duplicate event -> exactly 1 JE)
- `InventoryAutoPostingIT` PASS
- `CrmLoyaltyIT` PASS (accrual, dedup, tier upgrade, refund debit)
- `PromotionEngineIT` PASS (2/2)
- `AccountingPeriodIT` PASS (5/5), `CoaProvisioningIT` PASS (4/4) — Phase 6 regression closed
- Unit tests 6/6 PASS

### INITIAL STATE — as Phase 9 was delivered, NOTHING ran

Before any repair, 0 of 4 Phase 9 ITs executed and 5 Phase 6 ITs were broken.
The defects below were all real and all in the delivered code/tests.

### Root cause A — Phase 9 ITs declare only a subset of the queues their consumers listen on

Phase 9 added `@EnableRabbit` to `FinanceServiceApplication`, which starts ALL 7
`@RabbitListener` endpoints in EVERY Spring context. A listener bound to a
non-existent queue is a FATAL startup error.

- 7 finance consumers: order-closed, stock-depleted, order-refunded, wastage,
  count-variance, transfer-shipped, transfer-received
- `OrderCloseAutoPostingIT` declares only 2 queues (order-closed, stock-depleted)
- `InventoryAutoPostingIT` declares a partial set
- Result: `Failed to declare queue(s):[finance.count-variance.queue]`
  -> `NOT_FOUND - no queue 'finance.count-variance.queue' in vhost '/'`
- Same defect in `CrmLoyaltyIT`: `NOT_FOUND - no queue 'crm.order-closed.queue'`

### Root cause B — ITs with no RabbitMQ container at all

`PromotionEngineIT` (crm) and `FinanceTestBase` (finance) start only a Postgres
container and mock `RabbitTemplate` — but mocking the template does NOT stop the
listener registry from opening a real broker connection.
- Result: `ACCESS_REFUSED - Login was refused using authentication mechanism PLAIN`

### Root cause C — REGRESSION against Phase 6

The same `@EnableRabbit` breaks 5 pre-existing finance ITs that were green at
Phase 6 (STATE.md records them as passing):
`AccountingPeriodIT`, `CoaProvisioningIT`, `InternalAutoPostIT`,
`JournalEntryBalanceTriggerIT`, `JournalEntryImmutabilityIT`

### Consequence for the prior verification

09-VERIFICATION.md marked truths 1-4 "VERIFIED" citing these ITs as evidence
("IT asserts POSTED JE + balanced debits/credits", "asserts exactly 1 revenue JE").
Those assertions have NEVER executed. The verifier read the test source statically
but could not run it. The auto-posting engine has ZERO passing runtime proof.

## Tests

### 1. Order close posts a balanced revenue JE
expected: ORDER_CLOSED event -> POSTED journal entry, DR payments/cash, CR revenue + output tax, debits == credits
result: pass
evidence: "ORDER_REVENUE je=cd8db4f4 debits=85600 credits=85600, status POSTED"
note: "Only provable after fixing the IT's fiscal year. The delivered test never asserted the revenue JE balanced at all — it only asserted the row existed. Balance assertion added."

### 2. Stock depletion posts a balanced COGS JE
expected: STOCK_DEPLETED event -> POSTED journal entry, DR COGS, CR inventory, using totalCogsPaisa; debits == credits
result: pass
evidence: "ORDER_COGS je=3a745122 debits=36000 credits=36000, status POSTED"

### 3. Duplicate event does not double-post
expected: Re-delivering the same ORDER_CLOSED yields exactly ONE revenue JE (3 dedup layers)
result: pass
evidence: "OrderCloseAutoPostingIT idempotency assertion passes — same eventId re-published AND a fresh eventId for the same order both yield exactly 1 revenue JE"

### 4. Inventory events post balanced JEs
expected: WASTAGE_RECORDED, COUNT_VARIANCE_POSTED, TRANSFER_SHIPPED, TRANSFER_RECEIVED each post a balanced JE
result: pass
evidence: "WASTAGE 45000=45000, COUNT_VARIANCE 22500=22500, TRANSFER_SHIP 225000=225000, TRANSFER_RECV 225000=225000"

### 5. Refund posts a reversing JE
expected: ORDER_REFUNDED -> balanced refund JE. Code review finding: recipe posts DR 4920 (discount) / CR cash for the FULL refund and never reverses output tax, so tax liability stays overstated. No IT covers it.
result: [pending]

### 6. Auto-post into a LOCKED period is refused
expected: LOCKED period -> no JE, no posted_source_events row. Code review: mechanism looks sound (autoPostInternal throws PeriodLockedException before the posted_source_events row is written, same transaction). Still unproven.
result: [pending]

### 7. Loyalty points accrue on order close
expected: 1 point per PKR 100 spent, per 09-02-SUMMARY.md
result: issue
severity: major
evidence: "CrmLoyaltyIT PASSES, but asserts 60,000 points for a 6,000,000-paisa (PKR 60,000) order — i.e. 1 point per PKR 1."
reported: "Accrual is 100x the documented rate. points = totalPaisa / points_per_pkr_paisa with points_per_pkr_paisa=100; since 100 paisa = PKR 1 this yields 1 point per rupee. Code and test agree with each other but contradict the spec. Either the seed constant should be 10000, or the doc is wrong. Needs a business decision — this is real money."

### 8. Loyalty tier upgrades at threshold
expected: lifetime spend >= PKR 50,000 -> SILVER; >= PKR 200,000 -> GOLD
result: pass
evidence: "CrmLoyaltyIT: 6,000,000 paisa lifetime spend -> tier becomes SILVER"

### 9. Refund debits loyalty points proportionally
expected: ORDER_REFUNDED -> proportional debit, capped at balance (never negative)
result: pass
evidence: "CrmLoyaltyIT asserts balance drops below the accrued 60,000 after refund; debit capped via Math.min(points, balance)"

### 10. Promotion evaluation respects filters
expected: active-date, day-of-week (Asia/Karachi), hour-window, tier, and item filters; best discount wins; 0 outside window
result: pass
evidence: "PromotionEngineIT 2/2 — percent discount applied in-window, zero outside hour window"

### 11. Customer CRUD, phone lookup, and feedback APIs
expected: CRUD /api/v1/crm/customers, GET /internal/crm/customers/lookup?phone=, POST/GET /api/v1/crm/feedback
result: issue
severity: minor
reported: "Controllers exist and compile, but NO test exercises any HTTP endpoint in crm-service. CrmLoyaltyIT drives services directly, not the API. Customer CRUD, phone lookup, and feedback endpoints have zero runtime coverage — RLS/permission behaviour on those routes is unverified."

### 12. crm-service is deployable and routed
expected: gateway routes /api/v1/crm/** -> lb://crm-service, and crm-service starts in the dev stack
result: issue
severity: major
status_now: FIXED on branch Ammar/phase-9-order-to-ledger-auto-posting-customer-loyalty
reported: "Gateway route IS present (gateway/application.yml, crmCircuitBreaker configured). crm-service did not start in the dev stack."
correction: |
  09-VERIFICATION.md called this 'crm-service not registered in deploy/docker-compose.yml'.
  That diagnosis was WRONG — deploy/docker-compose.yml contains ONLY infrastructure
  (postgres, redis, rabbitmq, minio, opa, eureka, config-server, clickhouse, mailpit,
  pgadmin). NO application service is declared there, not even finance-service.
  Application services are launched by scripts/start-dev.ps1.
  The real gap: crm-service was absent from start-dev.ps1 ($DevMavenModules + the
  Start-ServiceWindow list). crm_db already exists in deploy/init/01-create-databases.sql.
  FIXED: crm-service added to both lists in scripts/start-dev.ps1.

## Summary

total: 12
passed: 7
issues: 5
pending: 0
skipped: 0

## Gaps

- truth: "Phase 9 integration tests execute at all"
  status: failed
  reason: "0 of 4 Phase 9 ITs could start. @EnableRabbit starts all 7 finance consumers in EVERY context; ITs declare only a subset of the queues, and a listener on a missing queue is a FATAL startup error. CrmLoyaltyIT same (crm.order-closed.queue). PromotionEngineIT and FinanceTestBase run no broker at all and died on ACCESS_REFUSED."
  severity: blocker
  test: 1
  root_cause: "Test harness never accounted for @EnableRabbit activating all listeners."
  artifacts:
    - path: "services/finance-service/src/test/java/io/restaurantos/finance/autopost/OrderCloseAutoPostingIT.java"
      issue: "declares 2 of 7 queues"
    - path: "services/finance-service/src/test/java/io/restaurantos/finance/FinanceTestBase.java"
      issue: "no broker; mocking RabbitTemplate does not stop the listener registry"
    - path: "services/crm-service/src/test/java/io/restaurantos/crm/PromotionEngineIT.java"
      issue: "no broker"
  missing:
    - "spring.rabbitmq.listener.simple.missing-queues-fatal=false where a broker exists"
    - "spring.rabbitmq.listener.simple.auto-startup=false where no broker exists"
  status_now: "FIXED in working tree (uncommitted)"

- truth: "Phase 6 finance ITs stay green"
  status: failed
  reason: "REGRESSION. Phase 9 added @EnableRabbit to FinanceServiceApplication, breaking 5 previously-green Phase 6 ITs (AccountingPeriodIT, CoaProvisioningIT, InternalAutoPostIT, JournalEntryBalanceTriggerIT, JournalEntryImmutabilityIT) with ACCESS_REFUSED."
  severity: blocker
  test: 1
  root_cause: "@EnableRabbit on FinanceServiceApplication activates listeners in test contexts that have no broker."
  status_now: "AccountingPeriodIT + CoaProvisioningIT restored to green. 3 still failing — see below."

- truth: "Auto-posting survives a fiscal-year rollover"
  status: failed
  reason: "Both autopost ITs hardcoded provision(tenantId, 2026) while publishing events stamped Instant.now(). Pakistan FY2026 = Jul 2025..Jun 2026, so from 2026-07-01 onward NO period covers 'today' and every event failed with 'No accounting period found for date: 2026-07-12'. The test was a time bomb: written 2026-06-27, dead 4 days later."
  severity: blocker
  test: 1
  root_cause: "Hardcoded fiscal year vs Instant.now() event timestamps."
  status_now: "FIXED in working tree — fiscal year now derived from today."

- truth: "Missing accounting period is handled safely in production"
  status: failed
  reason: "JournalEntryServiceImpl.create() throws a bare RuntimeException when no period matches the entry date, and the consumer has NO backoff — it retried 718 times in ~2.6 minutes, a hot loop. In production, the first order closed after a fiscal-year rollover (before someone seeds the new year's periods) would spin like this and never post revenue. Silent, unbounded, and it hits the project's core value loop."
  severity: major
  test: 1
  artifacts:
    - path: "services/finance-service/src/main/java/io/restaurantos/finance/service/JournalEntryServiceImpl.java"
      line: 107
      issue: "bare RuntimeException; no DLQ/backoff on the consumer path"
  missing:
    - "Typed exception + DLQ routing / bounded retry for the no-period case"
    - "Auto-seed or alert when an event arrives for an unseeded fiscal year"

- truth: "Refund reverses output tax"
  status: failed
  reason: "postOrderRefund posts DR 4920 (discount) / CR cash for the FULL refund amount and never reverses output tax. The JE balances, but the tax liability booked at sale is never reduced — VAT/GST liability stays overstated. Code comment admits the simplification. No IT covers refund posting at all."
  severity: major
  test: 5
  artifacts:
    - path: "services/finance-service/src/main/java/io/restaurantos/finance/autopost/AutoPostingRecipeEngine.java"
      line: 100
      issue: "no output-tax reversal; also reuses DISCOUNT_CODE 4920 where the plan specified 4910"
  missing:
    - "Tax-reversal line in the refund recipe"
    - "An IT for ORDER_REFUNDED finance posting"

- truth: "Loyalty accrual matches the documented rate"
  status: failed
  reason: "1 point per PKR 1, not per PKR 100. See test 7."
  severity: major
  test: 7

- truth: "crm-service runs in the dev stack"
  status: failed
  reason: "Not registered in deploy/docker-compose.yml, so the gateway's /api/v1/crm/** route resolves to nothing."
  severity: major
  test: 12

- truth: "Locked-period auto-post fail-safe"
  status: unproven
  reason: "Mechanism reads correctly (autoPostInternal throws PeriodLockedException before posted_source_events is written, same transaction) but still has NO test."
  severity: minor
  test: 6

- truth: "Pre-existing Phase 6 ITs pass"
  status: failed
  reason: "NOT a Phase 9 defect — attribution verified by git. InternalAutoPostIT, JournalEntryBalanceTriggerIT, and JournalEntryImmutabilityIT all fail with IllegalStateException 'Branch context required'. In isolation, with the listener issue fixed, they still fail. JournalEntryServiceImpl, shared-lib TenantContext, and these 3 test files are ALL UNMODIFIED by Phase 9 (git diff clean). requireBranchId() demands a branch in TenantContext and ignores the branchId passed in the request; these tests set a tenant but no branch. They were broken before Phase 9 and nobody knew, because the ITs had never been executed (no Maven/Docker in the verifier environment). Phase 6 was marked COMPLETE in STATE.md with 3 broken ITs."
  severity: major
  test: 0
  artifacts:
    - path: "services/finance-service/src/main/java/io/restaurantos/finance/service/JournalEntryServiceImpl.java"
      line: 81
      issue: "requireBranchId ignores req.branchId() unless it equals the TenantContext branch; event path only works because TenantAwareMessageProcessor sets branch from the envelope. Any event published without branchId will fail here."
  missing:
    - "Decide: should autoPostInternal trust req.branchId() when no session branch exists?"
    - "Set branch context in the 3 Phase 6 ITs"
