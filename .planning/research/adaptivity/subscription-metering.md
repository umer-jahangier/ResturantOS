# SuperAdmin Control of Subscriptions, Features and Per-Feature Usage

**Status:** research / design. Nothing here is implemented.
**Scope:** usage metering, quota enforcement, the SuperAdmin usage dashboard, the subscription
lifecycle, billing periods / proration / invoices, and the auth-service user-count endpoint that
13-14 left open.
**Written against:** `phase-13-access-repair` @ `5fba4a9`, every claim below cited to a file that was
read. Where I could not verify something I say so in the sentence.

**Explicitly NOT covered here** (parallel research owns them): FBR e-invoicing, POS thermal printing,
biometric attendance, ERP module gaps, cross-module integration gaps, UI/UX visual direction,
frontend component stack, current tenant configurability, testing strategy. Referenced as
dependencies where they touch this design.

---

## Part 1 — Ground truth: what exists today

### 1.1 Tier state, and who owns it

`services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierLimits.java:37-44`
is the single tier table for numeric ceilings:

| Tier | maxBranches | maxUsers | storageGb | nlqQuota |
|---|---|---|---|---|
| STARTER | 1 | 10 | 5 | 1,000 |
| GROWTH | 5 | 50 | 20 | 5,000 |
| ENTERPRISE | 50 | 500 | 100 | 50,000 |
| CUSTOM | 999 | 9,999 | 999 | 999,999 |

`TierLimits.applyTo` (`TierLimits.java:47-53`) stamps all four onto the tenant row
(`TenantEntity.java:71-81` — `max_branches`, `max_users`, `storage_gb`, `nlq_quota`).

`TierFeatureDefaults.java` is the qualitative half — 20 feature codes across three sets:
9 in `ALL_TIERS_ON` (`:31-51`), 9 in `GROWTH_AND_ABOVE` (`:54-76`), 2 in `ENTERPRISE_AND_ABOVE`
(`:79-82`). `FeatureCodeClosureTest` fails the build if the gateway's `RouteFeatureMap` gates a
prefix on a code this file does not define (13-03).

### 1.2 What `changeTier` actually does — verified working

`services/platform-admin-service/src/main/java/io/restaurantos/platform/service/TenantSubscriptionService.java:151-202`:

1. Refuses CANCELLED / PURGED (`:82-83`, `:153-156`); idempotent on same-tier (`:159-166`).
2. `usageViolations` (`:226-242`) — **branch count only**, from
   `userClient.listBranches(tenantId)`; an unobtainable count **refuses** the change rather than
   assuming safety (`:232-237`). `force` overrides.
3. `tierLimits.applyTo(tenant)` (`:182`).
4. `featureFlagAdminService.reconcileToTierDefaults` (`:188`) — skips `is_override` rows **in both
   directions** (`FeatureFlagAdminService.java:128-133`), creates missing rows at the tier default,
   and re-writes both Redis key shapes only for codes that actually moved (`:150-153`).
5. `writeQuotaKey` (`:251-253`) writes `tenant:nlq_quota:{tenantId}` directly — **with no TTL**.

`tenant_features.is_override` is changeset `030-001`; `FeatureFlagAdminService.setFeature:76` is the
only writer that sets it, and it is reachable only from the two SuperAdmin endpoints
(`PlatformAdminController:192-199`, `PlatformInternalController:71-78`).

This is the part of the system that is genuinely finished. 13-14-SUMMARY reports 51 PASS / 0 FAIL
live through the real gateway, twice consecutively, with the feature-gate open/close proved with no
restart and no TTL wait.

### 1.3 The gateway's enforcement points

`gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java:32-51` — 14 path-prefix →
feature mappings, first match wins. `isQuotaBearing` (`:69-71`) returns true for **exactly one
prefix**, `/api/v1/nlq/`, hardcoded.

`gateway/src/main/java/io/restaurantos/gateway/filter/FeatureFlagGlobalFilter.java`, order
`HIGHEST_PRECEDENCE + 20`:

| Step | Key | Outcome |
|---|---|---|
| status | `tenant:status:{tid}` (5-min TTL on gateway writes, `:60`, `:379`) | not `"ACTIVE"` → **403 `TENANT_SUSPENDED`** (`:164-169`); undeterminable → **503 `TENANT_STATUS_UNAVAILABLE`**, nothing cached (`:145-161`) |
| feature | `tenant_features:{tid}:{code}` | disabled → **403 `FEATURE_DISABLED`** + `X-Upgrade-CTA-URL: https://app.restaurantos.io/billing?feature={CODE}` (`:61`, `:183-186`) |
| quota (NLQ only) | limit `tenant:nlq_quota:{tid}`, counter `nlq_quota:{tid}:monthly_count` | `count >= limit` → **429 `QUOTA_EXCEEDED`** + same CTA header (`:242-247`); limit or counter undeterminable → **503 `NLQ_QUOTA_UNAVAILABLE`** (`:258-269`) |

One fail-open lever, `restaurantos.fail-open-on-platform-down`, default `false`, read in exactly one
class and governing all three paths (`:95-105`). **This is 13-03's decision and every design below
honours it.**

`isActive()` (`:341-343`) is `"ACTIVE".equalsIgnoreCase(status)` — **only that one word**, in any
case. Every other status — `PENDING_SETUP`, `SUSPENDED`, `CANCELLED`, `PURGED`,
`PROVISIONING_FAILED` — is a 403. This one line constrains the entire lifecycle design in Part 5.

Rate limiting (`gateway/src/main/java/io/restaurantos/gateway/config/RateLimitConfig.java`) is keyed
on **client IP** (`:41-54`) and on the biometric device serial (`:63-68`). **There is no per-tenant
rate limit or API-call counter anywhere in the gateway.**

### 1.4 The usage subsystem that exists and is completely dead

This is the single most important ground-truth finding, and it is the exact failure mode the brief
warns about: structurally present, never called.

| Artefact | Path | State |
|---|---|---|
| `usage_records` table | `.../db/changelog/v1.0.0/010-create-platform-tables.xml:115-139` | Created. `id BIGINT`, `tenant_id UUID`, `resource VARCHAR(50)`, `qty NUMERIC(20,4)`, `recorded_at TIMESTAMPTZ`. **No index beyond the PK. No period column. No unique constraint.** |
| `UsageRecordEntity` | `.../entity/UsageRecordEntity.java` | Exists, correctly not extending `TenantAuditableEntity` (asserted by `PlatformDbIsolationIT:82-85`) |
| `UsageRecordRepository` | `.../repository/UsageRecordRepository.java` | `sumQtyByTenantIdAndResource` (`:16-17`) — **never called by anything** |
| `UsageService` | `.../service/UsageService.java` | Wired as a bean, reachable from one controller |
| `POST /internal/platform/tenants/{tenantId}/usage` | `.../controller/PlatformInternalController.java:106-112` | Mapped. **Zero callers.** |

**Verified with a repo-wide grep** (`grep -rn "UsageService\|UsageRecord\|usage_records" --include=*.java
--include=*.xml --include=*.ts` across `services/`, `gateway/`, `frontend/`, excluding `target/` and
worktrees): the only references outside platform-admin-service's own files are in
`PlatformDbIsolationIT`. **No service, no consumer, no scheduled job, and no frontend page calls this
endpoint.** Not one usage row has ever been written by the running system.

Three defects inside the dead code, which matter because a future plan will be tempted to "just wire
it up":

1. **`UsageService.record` returns the wrong number.** `UsageService.java:41` returns
   `countByTenantIdAndResource` — a **row count**. Recording a single `delta = 500` returns `1`. The
   method that computes the actual total, `sumQtyByTenantIdAndResource`, is never invoked.
   `getTotal` (`:44-47`) has the identical bug.
2. **The limit is a constant.** `PlatformInternalController.java:111` returns
   `new UsageRecordResponse(newCount, Long.MAX_VALUE)`. There has never been a limit in that
   response.
3. **`qty NUMERIC(20,4)` is the wrong type for every meter this platform has.** Orders, users,
   branches, queries, bytes and messages are all integral. A fractional column invites a value that
   `INCRBY` cannot represent and that no invoice line can render.

**And it is marked complete.** `.planning/REQUIREMENTS.md:41` has `- [x] **PLATFORM-06**: SuperAdmin
can view platform telemetry`, and
`.planning/phases/03-.../03-VERIFICATION.md:144` records
`PLATFORM-06: Usage telemetry | 03-02 | ✓ SATISFIED | UsageService + PlatformInternalController POST /usage`.
The plan that specified it (`03-02-PLAN.md:247`) also called for a `telemetry(tenantId)` aggregate
method for the SuperAdmin view — **that method was never written.** PLATFORM-06 is not satisfied by
any reading of the running system.

### 1.5 The two meters that DO work, and what is wrong with each

**NLQ** — `services/nlq-service/src/main/java/io/restaurantos/nlq/quota/NlqQuotaService.java`.
Reserve-then-rollback around the Claude call. `monthlyKey` = `nlq_quota:{tenantId}:monthly_count`,
TTL set on first increment to the end of the **UTC calendar month** (`secondsUntilEndOfUtcMonth`), so
the counter resets without the key shape ever changing. Redis unreachable → `QuotaServiceUnavailable`
→ 503, fails closed. `effectiveMonthlyLimit` reads `tenant:nlq_quota:{tid}` and falls back to
`restaurantos.nlq.monthly-quota-default`, a number below every tier's allowance so the fallback
throttles early rather than unmetering.

> **The counter exists only in Redis.** There is no Postgres record of NLQ consumption anywhere in
> this repository. A `FLUSHALL`, an eviction under `maxmemory`, or a Redis restart without AOF/RDB
> silently grants every tenant on the platform a fresh month. Nothing detects it and nothing can
> reconstruct it.

**Storage** — `services/file-service/src/main/java/io/restaurantos/file/service/QuotaService.java`.
`storage:bytes:{tenantId}` INCRBY before the MinIO write, DECRBY on failure. Limit from
`TierStorageProperties.getLimitForTier(tier)`.

Two problems, both live:

1. **There are two disagreeing storage tier tables, and the tenant row loses.**

   | Tier | `TierLimits.storageGb` (platform-admin) | `TierStorageProperties` (file-service) |
   |---|---|---|
   | STARTER | 5 GB | 10 GiB (`10_737_418_240`) |
   | GROWTH | 20 GB | 50 GiB (`53_687_091_200`) |
   | ENTERPRISE | 100 GB | 500 GiB (`536_870_912_000`) |
   | CUSTOM | 999 GB | 100 GiB (`107_374_182_400`) |

   A repo-wide grep for `storageGb` / `storage_gb` finds writers (`TierLimits.applyTo:51`) and DTO
   echoes (`PlatformDtos.java:145,156,170,179`) and **no reader that enforces anything**.
   `tenants.storage_gb` is decoration. CUSTOM is enforced at **one tenth** of what the tenant row
   says. This is the identical defect 13-14 fixed for NLQ, still live for storage.

2. **The Redis counter has no reconciler.** `QuotaService`'s own class comment
   (`QuotaService.java:22-25`) says drift "may occur if a service restarts mid-upload; a periodic
   reconciliation job **can** correct this". It was never written.
   `FileMetadataRepository.sumSizeBytesByTenantId()` exists and is called by nothing. A Redis restart
   zeroes every tenant's storage usage.

### 1.6 What auth-service actually exposes (13-14's "left open #2" is smaller than recorded)

13-14-SUMMARY states: *"There is **no equivalent for users**: the `users` table lives in `auth_db`
and auth-service exposes no tenant user count on any internal channel."* That was a scoping
statement — 13-09 and 13-11 were editing auth-service concurrently — and it is **no longer accurate
as of the code on this branch**:

`services/auth-service/src/main/java/io/restaurantos/auth/controller/UserLifecycleInternalController.java:130-145`
exposes `GET /internal/auth/users`, takes `X-Tenant-Id`, and returns
`meta.totalCount = result.getTotalElements()`. `UserLifecycleService.list:105-112` calls
`setTenantGuc(tenantId)` before querying, so the count is RLS-correct at the producer — the same
property that makes `listBranches` authoritative. `activeOnly` is already a parameter. Page size
clamps to `DEFAULT_PAGE_SIZE = 50`, cap `MAX_PAGE_SIZE = 200` (`:71-72`, `:343-345`).

So the missing piece is not "a count does not exist" — it is "the count comes wrapped in a page of
user summaries". Part 6 designs the dedicated endpoint and says why the existing one should not
simply be called.

### 1.7 Infrastructure already available in platform-admin-service

- `platform_db` has **no RLS at all** — `tenants`, `tenant_features`, `impersonation_log`,
  `event_outbox` are all `rls=false force=false`, measured by 13-10 and asserted on every build by
  `PlatformDbIsolationIT` (9/9). Tenant scoping in this service is a `WHERE tenant_id = ?` predicate
  the code must write itself.
- `event_outbox`, `idempotency_keys`, `processed_events` all exist
  (`020-shared-infra-tables.xml` changesets `020`, `020b`, `020c`), so this service can both publish
  through the transactional outbox and consume idempotently.
- `DomainEventPublisher.publish` requires `TenantContext.requireTenantId()`
  (`shared-lib/.../DomainEventPublisher.java:36`); `ProvisioningService:270-276` shows the
  set-context-then-publish idiom platform-admin already uses.
- `OutboxRelay` is `@Scheduled(fixedDelay = 1000)`.
- **There is no ShedLock and no distributed lock anywhere in the repo.** The precedent for a
  replica-safe scheduled job is `services/hr-service/src/main/resources/db/changelog/v1.0.0/013-leave-accrual-idempotency.xml`:
  a UNIQUE constraint on `(tenant, subject, period)` **is** the lock — the racing replica loses the
  insert and skips the increment, and it survives a replica dying mid-run because the marker and the
  effect commit together. Every scheduled job in this design uses that instrument.
- `FeignSharedConfig.JdkHttpFeignClient` is what makes PATCH possible at all; any new Feign client in
  platform-admin **must** carry `configuration = FeignSharedConfig.class` or PATCH dies at the client
  with `ProtocolException` before a byte reaches the network.
- `platform_users.role` accepts `SUPER_ADMIN`, `SUPPORT`, `BILLING`
  (`010-create-platform-tables.xml:108-109` CHECK constraint), but `PlatformAuthService.MINTABLE_ROLE
  = SUPER_ADMIN` (`:94-101`) refuses to mint a token for the other two, and `PlatformAdminController`
  is class-level `@PreAuthorize("hasAuthority('SUPER_ADMIN')")` (`:35`). **A BILLING platform user
  can log in to nothing today.**

### 1.8 The frontend surface

`frontend/app/(platform)/` contains exactly two files: `layout.tsx` and
`platform/dashboard/page.tsx`. The latter is **9 lines** and says "SuperAdmin shell placeholder."

There is **no** `platform.repository.ts`, **no** `platform.adapter.ts`, **no**
`lib/api-client/schemas/platform.schema.ts`, and **no** `lib/hooks/platform/`. The 4-layer boundary
is enforced by `frontend/eslint.config.mjs:17-35` — `no-restricted-imports` blocks `@/lib/api-client*`
and `@/lib/repositories*` from anything that is not the adjacent layer, so a page must import a hook
and nothing else.

### 1.9 Two things that are true and surprising

- **`notification-service` has zero source files.** `find services/notification-service/src -name
  "*.java"` returns 0. `PlatformAdminController:69-71` records the consequence for provisioning.
  Any SMS/email meter has no producer and no consumer to build against.
- **Suspension is never propagated to auth-service.** `TenantLifecycleService.suspend:45-55` writes
  the platform row, the `tenant:status:` Redis key, and invalidates feature flags. It does **not**
  call `AuthInternalClient.setTenantStatus` — the constructor (`:36-42`) does not even take that
  client. Login filters on auth-service's own mirror (`AuthServiceImpl.java:91`, `:251` —
  `.filter(t -> "ACTIVE".equals(t.getStatus()))`), which a platform suspension never touches. So a
  suspended tenant's users **can still authenticate** and then receive 403 on every gated route at
  the gateway. Part 5 depends on this being true, and Part 8 lists it as a question.

---

## Part 2 — Usage metering

### 2.1 The distinction the current schema is missing: counters vs gauges

`usage_records` has one `qty` column, one `recorded_at`, and no notion of a period. That is why it
cannot express what needs metering. There are two different kinds of quantity here and they need
different storage, different reset semantics and different enforcement:

- **Counters (flows).** Accumulate within a billing period and reset at the boundary. Overage is
  meaningful. Orders, NLQ queries, API calls, SMS, email.
- **Gauges (levels).** A current value that moves up and down. There is no period and no reset;
  "usage" is the level right now. Users, branches, storage bytes.

Conflating them is what makes a downgrade check hard: `usageViolations` compares a **gauge** (live
branch count) against a ceiling, which is correct, and there is nowhere in the schema that could
have held it.

### 2.2 The meter catalogue

| Meter code | Kind | Unit | Entitlement source | Producer (owns the truth) | Exists today? |
|---|---|---|---|---|---|
| `ORDERS` | counter | orders/period | new tier column | pos-service, `ORDER_CLOSED` | ❌ nothing counts orders |
| `USERS` | gauge | count | `TierLimits.maxUsers` | auth-service (`auth_db.users`) | ❌ no count endpoint |
| `BRANCHES` | gauge | count | `TierLimits.maxBranches` | user-service `GET /internal/users/tenants/{id}/branches` | ✅ read by `usageViolations` |
| `NLQ_QUERIES` | counter | queries/month | `TierLimits.nlqQuota` | nlq-service | ✅ Redis only |
| `STORAGE_BYTES` | gauge | bytes | `TierLimits.storageGb` | file-service | ⚠️ Redis only, wrong limit table |
| `API_CALLS` | counter | requests/period | new tier column | gateway | ❌ nothing counts |
| `SMS_SENT` | counter | messages/period | new tier column | notification-service | ❌ service does not exist |
| `EMAIL_SENT` | counter | messages/period | new tier column | notification-service | ❌ service does not exist |

`TierLimits.Limits` gains four fields — `maxOrdersPerPeriod`, `maxApiCallsPerPeriod`,
`maxSmsPerPeriod`, `maxEmailPerPeriod`. Adding them to the record is a compile-time break at both
call sites (`TierLimits.applyTo`, `TenantSubscriptionService.changeTier`) and in
`TierChangeResponse.from`, which is the desired behaviour — a new ceiling that nothing stamps is
exactly the `storage_gb` bug.

`SMS_SENT` and `EMAIL_SENT` are defined in the catalogue and **left unwired**, with the meter
registry raising a startup warning for any meter whose producer service has no registered writer.
A code with no producer is the phantom-flag shape (`TierFeatureDefaults.java:18-25`), and naming it
in a registry that can detect the absence is safer than leaving it undefined.

### 2.3 Where the counter lives

**Redis for the hot path, Postgres for the billing record, and the event is the source of truth for
both.**

```
Redis (hot, enforcement)
  usage:ctr:{tenantId}:{METER}:{YYYYMM}   -> integer, TTL = period end + 45d
  usage:gauge:{tenantId}:{METER}          -> integer, no TTL
  -- grandfathered, NOT migrated:
  nlq_quota:{tenantId}:monthly_count      -- nlq-service writes, gateway reads (verbatim contract)
  nlq_quota:{tenantId}:{userId}:hourly_count
  storage:bytes:{tenantId}                -- file-service writes and reads
  tenant:nlq_quota:{tenantId}             -- the ALLOWANCE, written by changeTier

Postgres platform_db (record of account)
  usage_counters   -- one row per (tenant, meter, period)
  usage_gauges     -- one row per (tenant, meter), latest observed level
```

**The three legacy keys are not renamed.** `NlqQuotaService`'s javadoc and
`FeatureFlagGlobalFilter:66-73` both describe those shapes as verbatim contracts across three
components, and 13-14 records what happens when one side changes: the other silently falls back to a
compiled-in constant. The metering layer resolves a meter to its key through a
`MeterKeyResolver` that returns the legacy key for `NLQ_QUERIES` and `STORAGE_BYTES` and the new
shape for everything else. One read path, no key migration, no coordination risk.

**Postgres schema** (all money and all quantities `BIGINT`; `NUMERIC` appears nowhere):

```sql
CREATE TABLE usage_counters (
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meter          VARCHAR(40) NOT NULL,
  period_start   DATE        NOT NULL,
  period_end     DATE        NOT NULL,
  qty            BIGINT      NOT NULL DEFAULT 0,
  last_event_at  TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, meter, period_start)
);
CREATE INDEX idx_usage_counters_period ON usage_counters (period_start, meter);

CREATE TABLE usage_gauges (
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  meter        VARCHAR(40) NOT NULL,
  qty          BIGINT      NOT NULL,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, meter)
);
```

`BIGINT`, not `NUMERIC(20,4)`. Every meter is integral; a fractional quantity cannot be represented
by `INCRBY`, cannot be rendered on an invoice line, and cannot be reconciled against a Redis counter.
`usage_records` is superseded — see Part 8, question 5, for whether to drop it.

**`usage_counters` is the primary key of the whole design.** The composite PK
`(tenant_id, meter, period_start)` is simultaneously the upsert target, the tenant isolation
predicate, and — following the hr-013 precedent — the concurrency control. No lock table, no
ShedLock.

### 2.4 The write path, and why the order matters

For an event-sourced counter (`ORDERS`):

```
consumer receives ORDER_CLOSED (pos.topic)
  └─ ProcessedEventService.tryProcess("platform.usage.orders", envelope.eventId(), ...)
       └─ ONE transaction:
            INSERT INTO processed_events ...                    -- idempotency, existing table
            INSERT INTO usage_counters (...) VALUES (...,1)
              ON CONFLICT (tenant_id, meter, period_start)
              DO UPDATE SET qty = usage_counters.qty + 1,
                            last_event_at = EXCLUDED.last_event_at,
                            updated_at = now()
  └─ after commit: Redis INCRBY usage:ctr:{t}:ORDERS:{YYYYMM}
```

Postgres first, Redis second. **This is the opposite of what nlq-service and file-service do today,
and the inversion is the point.** If the Redis write is lost — restart, eviction, network — the
Postgres row is still right and the reconciler (2.5) repairs Redis from it. If Redis were written
first, a lost Redis write is a lost billing event with no record anywhere, which is precisely the
state NLQ is in today.

`ORDER_REFUNDED` decrements by the same path with its own `processed_events` consumer name. Whether
a refunded order should decrement the *billing* count is a commercial decision — Part 8, question 2.

**NLQ is the deliberate exception and stays as it is.** It must reserve in Redis *before* the Claude
call, because the whole point is to refuse a request that would cost money. Redis stays the
reservation ledger; the Postgres row becomes the *settled* record, written by a consumer of a new
`NLQ_QUERY_SETTLED` event that nlq-service publishes after a successful answer (i.e. after any
rollback has or has not happened). The two numbers legitimately differ by the in-flight reservations,
which is a small, bounded, explainable gap — unlike today's gap, which is "everything".

### 2.5 How it survives a restart

**A `@Scheduled` reconciler in platform-admin-service, running every 5 minutes and once at startup**,
that repairs Redis from Postgres. `platform_db` has no RLS and `tenants` is itself the tenant
registry, so this job needs neither a GUC nor inventory-service's `TenantRegistryService` workaround
(`services/inventory-service/.../TenantRegistryService.java:9-23` explains why that class had to
exist there and why it does not here).

Two repair modes, and the difference is not cosmetic:

| Meter class | Repair | Why |
|---|---|---|
| Postgres-first counters (`ORDERS`, `API_CALLS`, `SMS_SENT`, `EMAIL_SENT`) | `SET key = db_qty` | Postgres is written first, so an increment Redis does not know about does not exist. A plain `SET` is idempotent and safe on every replica — no lock needed. |
| Redis-first counters (`NLQ_QUERIES`) | `SET key = max(redis, db)` via a 3-line Lua script | Redis holds in-flight reservations Postgres has not settled yet. A plain `SET` would erase them and hand back a free allowance. Never repair a reservation ledger downward. |
| Gauges (`USERS`, `BRANCHES`, `STORAGE_BYTES`) | re-query the owning service, write both Redis and `usage_gauges` | The owning service's table is the truth; the gauge is a cache of it. `STORAGE_BYTES` finally gives `FileMetadataRepository.sumSizeBytesByTenantId()` its first caller. |

The reconciler also restores the TTL on any counter key that is missing one, since a key written by
`SET` without an expiry never resets and would carry a tenant's usage into the following period
forever. (`TenantSubscriptionService.writeQuotaKey:252` and
`TenantLifecycleService.updateStatusKey:112` both already write TTL-less keys today; that is correct
for an allowance and a status, which are re-asserted on change, but it would be a bug for a counter.)

**Redis is therefore a cache in every case except the NLQ in-flight window.** Losing it costs a
5-minute window of enforcement precision, never a billing record.

### 2.6 What ORDERS metering must NOT do

Metering orders at the **gateway** (counting `POST /api/v1/pos/orders`) would count attempts,
retries, voided orders and failed validations. The meter must sit on the same
`ORDER_CLOSED` seam finance, inventory, crm and reporting already consume
(`shared-lib/.../PosEventContract.java:33-38` — "emitted exactly once per close, from the single
`maybeCloseOrder` (Paid AND Served) seam"). Reusing an event four services already consume means the
meter cannot disagree with revenue.

---

## Part 3 — Quota enforcement

### 3.1 The rule that decides fail-closed vs fail-open

13-03 established that an undeterminable answer is not a permissive one, and every design here
honours that. But "fail closed" needs a sharper statement than "always refuse", because applying it
uniformly would let a Redis blip stop a restaurant taking orders on a Friday night.

**The dividing line is entitlement versus volume:**

- **Entitlement questions fail CLOSED, without exception.** *Has this tenant bought this module? Is
  this tenant in good standing?* An unknown must never grant. This is the existing behaviour of
  `getTenantStatus` and `isFeatureEnabled` and nothing in this design touches it.
- **Volume questions split by who bears the cost:**
  - **Cost meters** — every unit spends the platform's money: `NLQ_QUERIES` (LLM tokens),
    `STORAGE_BYTES` (disk), `SMS_SENT` (carrier fees). Undeterminable → **refuse, 503**. This is
    already what nlq-service and file-service do and it is right: an unmetered LLM endpoint is a
    billing incident, not a degraded feature.
  - **Revenue meters** — the unit costs the platform ~nothing and blocking it destroys the tenant's
    business: `ORDERS`, `API_CALLS`. Undeterminable → **allow, record, alert**. And at the hard
    limit → **allow, bill the overage**. The platform should never automatically stop a restaurant
    from taking money over a volume dispute; that is a commercial decision a human makes.

Stating this explicitly matters because the naive reading of "fail closed, consistent with 13-03"
produces a POS that stops working during a Redis restart.

### 3.2 Soft and hard limits

`tier_meter_limits` gains a soft threshold per meter, defaulting to 80% of the entitlement and
overridable per tenant by a SuperAdmin (the same override philosophy as
`tenant_features.is_override`).

| Band | Effect | Delivery |
|---|---|---|
| < soft | nothing | — |
| soft ≤ used < hard | **warn, never block** | response header `X-Usage-Warning: {METER};{used};{limit}` on the metered route; `TENANT_USAGE_THRESHOLD_CROSSED` published once per (tenant, meter, period) through the outbox; in-app banner from the self-serve usage endpoint |
| used ≥ hard, cost meter | **block** | 429 `QUOTA_EXCEEDED` + `X-Upgrade-CTA-URL` — byte-identical to the NLQ shape the gateway already emits (`FeatureFlagGlobalFilter:242-247`), so the frontend needs one handler |
| used ≥ hard, revenue meter | **allow + accrue overage** | header `X-Usage-Overage: {METER};{overage}`; an `OVERAGE` invoice line at period close |

"Once per (tenant, meter, period)" is enforced by a `usage_alerts` row with
`UNIQUE (tenant_id, meter, period_start, threshold)` — the hr-013 instrument again, so a second
replica crossing the same threshold loses the insert and does not send a duplicate.

### 3.3 Where each meter is enforced

**Not everything belongs at the gateway.** The gateway sees paths; a cap on a business object has to
be enforced where the object is created or it counts the wrong thing.

| Meter | Enforcement point | Mechanism |
|---|---|---|
| `NLQ_QUERIES` | gateway + nlq-service | already shipped, unchanged |
| `API_CALLS` | gateway | new — generalise `isQuotaBearing` into a `RouteQuotaMap` |
| `STORAGE_BYTES` | file-service | already shipped; fix the limit source (3.5) |
| `ORDERS` | metered at the `ORDER_CLOSED` consumer, **never blocked** | revenue meter |
| `USERS` | auth-service, at `UserLifecycleService.create` | gauge check before insert |
| `BRANCHES` | user-service, at branch create | gauge check before insert |
| `SMS_SENT` / `EMAIL_SENT` | notification-service | does not exist |

The gateway change is small and mechanical: replace `RouteFeatureMap.isQuotaBearing(String)` — a
hardcoded `path.startsWith("/api/v1/nlq/")` (`:69-71`) — with
`Optional<String> quotaMeterFor(String path)` returning a meter code, and drive `checkQuota` from
that. The NLQ branch keeps its existing keys and its existing 503 code
(`NLQ_QUOTA_UNAVAILABLE`) for backward compatibility; new meters get
`QUOTA_UNAVAILABLE` with the meter named in the body.

**`FeatureFlagGlobalFilter` must be treated as CRITICAL blast radius regardless of what GitNexus
says.** 13-01, 13-03 and 13-14 all recorded that it reports LOW upstream impact because it is a
Spring `GlobalFilter` with no static callers; its real reach is every authenticated tenant request
that crosses the gateway.

### 3.4 The user and branch caps

`TierLimits.maxUsers` and `maxBranches` are ceilings **nothing enforces at creation time**, which
`TenantSubscriptionService:216-218` says in as many words. So a tenant on STARTER (cap 10) can create
an eleventh user today and nothing objects. Two halves:

- **Creation-time**: auth-service checks the gauge before inserting a user; user-service before
  inserting a branch. Both fail closed on an unobtainable limit — this is an entitlement question
  (may you have an eleventh user?), not a volume one.
- **Downgrade-time**: `usageViolations` gains its second violation — Part 6.

**Grandfathering is mandatory.** `changeTier(force = true)` deliberately leaves a tenant above its
own ceiling (`TenantSubscriptionService:176-179`, and 13-14 asserts live that both branches survive a
forced downgrade to a cap of 1). A creation-time check must refuse the *next* create, never
retroactively break the existing rows — nothing is ever deleted, which is the stated contract of a
downgrade.

### 3.5 Storage: delete the second tier table

`TierStorageProperties` must go. file-service should read the tenant's own `storageGb` from the
status response it already fetches — `PlatformAdminClient.getTenantStatus` is already called on every
upload (`QuotaService.getStorageLimitBytes`), and `StatusResponse` already carries `nlqQuota` for
exactly this reason (`PlatformInternalController:55-61`). Adding `storageGb` beside it costs no extra
round trip.

This is the same fix, the same shape and the same justification as 13-14's NLQ repair, and it should
be done with the same care: **fixing only platform-admin leaves the lower of two constants
governing**, which is the trap 13-14 recorded as deviation #5. Both sides change or neither does.

---

## Part 4 — The SuperAdmin usage dashboard

### 4.1 API

New `PlatformUsageController` under `/api/v1/platform`, inheriting the class-level
`@PreAuthorize("hasAuthority('SUPER_ADMIN')")` — or, if the BILLING persona is activated (Part 8,
question 6), `hasAnyAuthority('SUPER_ADMIN','BILLING')` on this controller only.

```jsonc
GET /api/v1/platform/usage?period=2026-08&meter=NLQ_QUERIES&nearLimit=true&page=0&size=50
→ { "data": [ { "tenantId", "slug", "brandName", "tier", "status", "billingState",
                "meters": [ { "meter":"NLQ_QUERIES", "used":4210, "limit":5000,
                              "pct":84, "band":"SOFT", "kind":"COUNTER" } ] } ],
    "meta": { "page": {...}, "totalCount": 37 } }

GET /api/v1/platform/tenants/{tenantId}/usage?periods=6
→ per-meter series, 6 closed periods + the open one, for a sparkline

GET /api/v1/platform/usage/alerts?since=2026-08-01
→ rows from usage_alerts: who crossed which threshold, when, and whether it was actioned
```

`nearLimit=true` is served from `usage_counters` joined to the tenant's limits — an indexed read on
`(period_start, meter)`, not a fan-out to every service. This is the question the dashboard exists to
answer ("who is about to hit a wall") and it must be one query.

**Freshness must be stated on the response, not assumed.** Each meter carries `asOf` — for
Postgres-first counters that is `updated_at`; for gauges it is `observed_at` and can be up to one
reconciler interval stale. A dashboard that silently mixes real-time and 5-minute-old numbers is how
an operator makes a wrong call about a tenant.

### 4.2 Frontend, inside the 4-layer boundary

Nothing platform-facing exists in the frontend today (1.8). Four new files per the ESLint rule
(`frontend/eslint.config.mjs:17-35`), in dependency order:

```
lib/api-client/schemas/platform.schema.ts   zod: apiTenantUsageSchema, apiUsageRowSchema
lib/adapters/platform.adapter.ts            adaptTenantUsage — paisa -> display, band -> variant
lib/repositories/platform.repository.ts     PlatformRepository.getUsage / getTenantUsage / getAlerts
lib/hooks/platform/use-platform-usage.ts    TanStack Query hooks; the ONLY thing a page may import
app/(platform)/platform/usage/page.tsx      the fleet table
app/(platform)/platform/tenants/[id]/page.tsx   one tenant: entitlement vs consumption + trend
```

Three rules the adapter layer must carry, because they are project invariants rather than
preferences:

1. **Money arrives as `*Paisa: number` and is formatted in the adapter**, never in a component. The
   backend never sends a decimal.
2. **`limit` and `used` are integers; `pct` is computed server-side.** Two clients computing a
   percentage from a large byte count in JS floats will disagree at the boundary, and the boundary is
   the only place it matters.
3. **The band (`OK` / `SOFT` / `HARD` / `OVERAGE`) is computed server-side and sent as an enum.** The
   threshold is tenant-overridable; a client that re-derives it from `used/limit` will be wrong for
   every tenant with an override.

Visual direction, table/chart component choice and the sparkline primitive are owned by the parallel
UI/UX and frontend-component-stack research — this design specifies the data contract only.

---

## Part 5 — Subscription lifecycle

### 5.1 The trap: do not add states to `tenants.status`

`FeatureFlagGlobalFilter.isActive():341-343` accepts **only** the word `"ACTIVE"`. Adding `TRIAL`
or `PAST_DUE` to `TenantEntity.TenantStatus` would 403 every affected tenant at the gateway from the
moment the enum value is first written — a total, silent outage for exactly the cohorts a SaaS most
wants to keep. It is one line of code and it would pass every existing test, because no test asserts
that a *trialing* tenant can reach anything.

**Therefore: a second, independent axis.**

```
tenants.status         -- ACCESS. Unchanged. PENDING_SETUP | ACTIVE | SUSPENDED |
                       -- CANCELLED | PURGED | PROVISIONING_FAILED. The gateway reads this and
                       -- only this. No new values.
tenants.billing_state  -- COMMERCIAL. New column. TRIALING | ACTIVE | PAST_DUE | GRACE |
                       -- SUSPENDED_NONPAYMENT | CANCELLED. The gateway never reads it.
```

The dunning job is the **only** thing that translates one into the other, and it does so by calling
the existing `TenantLifecycleService.suspend(...)`, which already writes the Redis status key and
invalidates the feature cache (`:45-55`). No new enforcement path, no second place where access can
be decided, and the gateway needs no change at all.

### 5.2 What each state does to access

| billing_state | tenants.status | Gateway | Can log in? | What the tenant sees |
|---|---|---|---|---|
| `TRIALING` | ACTIVE | full tier entitlement | yes | countdown banner from `trial_ends_at` |
| `ACTIVE` | ACTIVE | full | yes | nothing |
| `PAST_DUE` (invoice unpaid, day 1–7) | **ACTIVE** | full + `X-Billing-Warning` | yes | dismissible banner |
| `GRACE` (day 8–14) | **ACTIVE** | full; cost meters (`NLQ`, new `STORAGE`) hard-capped at current usage | yes | blocking modal, dismissable once/session |
| `SUSPENDED_NONPAYMENT` (day 15+) | **SUSPENDED** | 403 `TENANT_SUSPENDED` on every gated route | see 5.3 | suspension page |
| `CANCELLED` | CANCELLED | 403 | no | export window, then purge |
| — | PURGED | 403 | no | — |

Two properties this preserves:

- **Tenant status already fails closed and stays that way.** An undeterminable status is still 503
  `TENANT_STATUS_UNAVAILABLE`, never a grant. Nothing here adds a second fail-open lever — 13-03's
  reasoning about two levers that can disagree applies verbatim.
- **A downgrade and a suspension still delete nothing.** `TenantSubscriptionService`'s class javadoc
  (`:50-57`) states this and 13-14 asserted it live. Non-payment gates; it does not destroy.

### 5.3 The dead end: a suspended tenant cannot pay

`AuthServiceImpl.login:91` filters on `"ACTIVE".equals(t.getStatus())` against **auth-service's own
mirror** in `auth_db.auth_tenants`. A platform suspension never writes that mirror (1.9), so today a
suspended tenant's users *can* still log in and then receive 403 everywhere. That is an inconsistency
— but it is also the only reason a self-service payment page is reachable at all.

Both possible futures are dead ends unless designed for:

- If suspension **is** propagated to auth-service (which correctness argues for), the tenant cannot
  log in, so no in-app billing page can ever be reached.
- If it is **not** propagated, the tenant logs in and every route 403s, because the gateway's
  `PUBLIC_PREFIXES` (`FeatureFlagGlobalFilter:82-87`) contains only `/api/v1/auth/`,
  `/.well-known/`, `/actuator/` and `/fallback/`. **There is no billing route exempt from the status
  check.**

**Design:** a third list in the filter, checked *after* the status resolves, never before:

```java
// Checked only when the status is DETERMINED and equals SUSPENDED. An UNKNOWN status still 503s
// — this list must never become a way to skip the status check itself.
private static final List<String> SUSPENDED_ALLOWED_PREFIXES = List.of("/api/v1/billing/self/");
```

Placement is load-bearing. Putting `/api/v1/billing/` into `PUBLIC_PREFIXES` would skip the status
check *and* the feature check for everyone, which is a hole; putting it after the resolution keeps
the fail-closed property for the UNKNOWN case and exempts only the SUSPENDED case. CANCELLED and
PURGED are **not** exempted — there is nothing left to buy.

For the propagated-suspension future, the self-serve surface has to be reachable without a tenant
login: a signed, single-purpose, time-limited billing link emailed at suspension. That needs
notification-service, which does not exist (1.9), so **v1's answer is that a suspended tenant is
restored by a SuperAdmin action after payment is confirmed out of band.** Saying so is better than
designing a self-service flow that cannot run.

### 5.4 Trial

`tenants.trial_ends_at` already exists (`TenantEntity:52-53`, changeset `010-001`) and is editable
through `PATCH /api/v1/platform/tenants/{id}` (`TenantSubscriptionService.update:132-134`). It is
read by nothing.

A trial is `billing_state = TRIALING` **and** `status = ACTIVE`. The dunning job moves
`TRIALING → PAST_DUE` when `trial_ends_at` passes with no payment method on file, entering the same
7/14-day ladder. No new status value, no gateway change, and a trial tenant has the full entitlement
of its tier throughout — which is the point of a trial.

---

## Part 6 — The auth-service user count (13-14 "Left open #2")

### 6.1 What to build

```
GET /internal/auth/tenants/{tenantId}/user-count?activeOnly=true
Headers: X-Internal-Service: <shared secret>   (InternalServiceFilter, constant-time)
→ 200 { "data": { "tenantId": "...", "total": 47, "active": 44, "asOf": "2026-08-07T09:12:03Z" } }
```

Path-variable tenant, **no `X-Tenant-Id` header** — deliberately mirroring
`GET /internal/users/tenants/{id}/branches`, whose contract `UserInternalClient:53-61` explains: the
producer sets the RLS GUC itself from the path variable, so the consumer needs no header. The
alternative (header-scoped, like the branch *delete* beside it) is for endpoints that address a row
by its own id. Consistency here is not aesthetic — 13-10 records a bug caused by a consumer guessing
the wrong one of these two conventions.

`UserLifecycleService` gains:

```java
public UserCounts countForTenant(UUID tenantId) {
    setTenantGuc(tenantId);                      // same first line as list(), :106
    return userRepository.countsForTenant(tenantId);   // one SELECT count(*) FILTER (WHERE is_active)
}
public record UserCounts(long total, long active) {}
```

### 6.2 Why not just call the existing list endpoint

`GET /internal/auth/users?size=1` already returns `meta.totalCount` (1.6), so this could be done with
no producer change. It should not be, for three reasons:

1. It ships a page of `UserSummary` records — email addresses among them — across a service boundary
   for a call that needs one integer. Least data is not a nicety in a multi-tenant system.
2. `totalCount` is `Page.getTotalElements()`, which is a side effect of a paginated query. A count
   endpoint that a caller depends on should be a count query, not a by-product that a future
   pagination change can alter.
3. It cannot answer `active` and `total` separately without a second call, and the downgrade check
   wants `active` (a deactivated user consumes no seat) while the dashboard wants both.

Cost of the dedicated endpoint: one repository method, one service method, one controller method,
one Feign method. Roughly half a day including tests.

### 6.3 Wiring it into the downgrade guard

`TenantSubscriptionService.usageViolations:226-242` is already shaped for a second violation — 13-14
says so explicitly. The addition:

```java
long userCount;
try {
    userCount = authClient.userCount(tenantId, true).data().active();
} catch (Exception ex) {
    log.warn("[subscription] tenant={} user count unavailable ({}) — refusing the tier change", tenantId, ex.toString());
    return List.of(new Violation("users (count unavailable: " + ex.getClass().getSimpleName() + ")", -1, target.maxUsers()));
}
if (userCount > target.maxUsers()) {
    violations.add(new Violation("users", userCount, target.maxUsers()));
}
```

Same fail-closed posture as the branch check, same `force` escape hatch, same `Violation` record, and
the existing 409 `TIER_LIMIT_EXCEEDED` message already names limit and usage.

**One behavioural change to call out before it is built:** today a tier change survives an
auth-service outage. After this, it does not (without `force`). That is the correct trade — an
undeterminable usage is not a permissive one — but it means a tier change now depends on **two**
services being up instead of one, and an operator must know that `force` is the lever. Worth an
explicit line in the 409 message.

The new client method goes on the existing `AuthInternalClient`, which already carries
`configuration = FeignSharedConfig.class` (`AuthInternalClient:14-18`). A GET needs no PATCH support,
but a client declared without that configuration would also lose the `X-Internal-Service` interceptor
and get a 403 that looks like an authorization bug.

---

## Part 7 — Billing periods, proration, invoices

### 7.1 Period boundary

**Recommendation: calendar-month periods for v1**, `renews_at` normalised to the 1st.

- nlq-service already resets on a calendar month (`secondsUntilEndOfUtcMonth`). Anniversary billing
  would require a per-tenant period embedded in every counter key and a rewrite of that TTL logic —
  and that key shape is a verbatim three-way contract.
- One boundary for the whole platform means one invoice run, one reconciliation window, and a
  proration formula that is a day count.
- Anniversary billing is a real v2 feature. It is not a v1 blocker.

**The unresolved sub-question is the timezone.** nlq-service's boundary is **UTC**, which cuts at
05:00 Asia/Karachi — mid-service for a restaurant. The platform already owns a business-day concept
(`shared-lib`'s `BusinessDay`, used by pos-service to date the ledger and by reporting-service to
bucket facts). For *billing* a period is a period and UTC is defensible; for a *usage dashboard* that
says "this month" it is not, because a tenant's Friday-night orders after 05:00 PKT Saturday land in
the wrong bucket. Changing it means changing `secondsUntilEndOfUtcMonth` to an
`Asia/Karachi`-anchored calculation. Small change, real decision — Part 8, question 1.

### 7.2 Proration, in paisa

Money is `BIGINT` paisa throughout — `plan_price_paisa`, `amount_paisa`, `unit_price_paisa`,
`total_paisa`. No `NUMERIC`, no `double`, and **no decimal in any event payload**
(`shared-lib/.../MoneyUtils.java` — "Never use double/float for money calculations").

`MoneyUtils` has no proration helper today. Add one beside `multiplyBps`:

```java
/** Prorate a paisa amount over remainingDays of periodDays. Integer in, integer out, HALF_UP once. */
public static long proratePaisa(long amountPaisa, int remainingDays, int periodDays) {
    if (periodDays <= 0) throw new IllegalArgumentException("periodDays must be positive");
    return BigDecimal.valueOf(amountPaisa)
        .multiply(BigDecimal.valueOf(remainingDays))
        .divide(BigDecimal.valueOf(periodDays), 0, RoundingMode.HALF_UP)
        .longValueExact();
}
```

`BigDecimal` as an intermediate, rounded exactly once at the end, `longValueExact()` so an overflow
throws rather than wrapping. This matches how `MoneyUtils.fromPkr` already behaves.

| Change | Entitlement | Money |
|---|---|---|
| Upgrade mid-period | **immediate** — this is what `changeTier` already does | debit `prorate(newPrice - oldPrice, remainingDays, periodDays)` as an invoice line on the next invoice |
| Downgrade mid-period | **immediate** — matches current behaviour; deferring it would mean a second scheduled state machine and a window where the row and the entitlement disagree | credit `prorate(oldPrice - newPrice, ...)` as a negative line on the next invoice. **A credit, not a refund** — refunds require a payment gateway |
| Downgrade with `force` over limits | immediate, tenant left over its ceiling | same credit; the over-limit condition is a separate operational alert |

### 7.3 The history that does not exist yet

`changeTier` currently writes a log line and nothing else (`TenantSubscriptionService:196-198`). The
tier a tenant was on for the first 12 days of a period is **unrecoverable from the data**. You cannot
prorate what you cannot reconstruct, and you cannot defend an invoice a tenant disputes.

```sql
CREATE TABLE subscription_changes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_tier          VARCHAR(30),                -- null on the first row (provisioning)
  to_tier            VARCHAR(30) NOT NULL,
  from_price_paisa   BIGINT,
  to_price_paisa     BIGINT      NOT NULL,
  effective_at       TIMESTAMPTZ NOT NULL,
  period_start       DATE        NOT NULL,
  forced_over_limits BOOLEAN     NOT NULL DEFAULT FALSE,
  actor_platform_user_id UUID,                   -- from JwtClaims.subject(), never from the body
  reason             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`actor_platform_user_id` comes from `PlatformAdminController.requirePlatformPrincipal():244-253` —
the identical treatment D-34 required for impersonation, for the identical reason: a record whose
subject can choose the name on it is not a record. `ProvisioningService` writes the first row so
every tenant's tier history starts at provisioning rather than at the first change.

### 7.4 Invoices

```sql
CREATE TABLE invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id),
  invoice_no       VARCHAR(40) NOT NULL UNIQUE,       -- INV-{YYYYMM}-{seq}
  period_start     DATE        NOT NULL,
  period_end       DATE        NOT NULL,
  subtotal_paisa   BIGINT      NOT NULL,
  tax_paisa        BIGINT      NOT NULL DEFAULT 0,
  total_paisa      BIGINT      NOT NULL,
  currency         CHAR(3)     NOT NULL DEFAULT 'PKR',
  state            VARCHAR(20) NOT NULL,               -- DRAFT|ISSUED|PAID|VOID|WRITTEN_OFF
  issued_at        TIMESTAMPTZ,
  due_at           TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  external_ref     VARCHAR(100),                       -- mirrors tenants.billing_ref
  CONSTRAINT uq_invoice_tenant_period UNIQUE (tenant_id, period_start)
);

CREATE TABLE invoice_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id        UUID        NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind              VARCHAR(20) NOT NULL,   -- SUBSCRIPTION|PRORATION_DEBIT|PRORATION_CREDIT|OVERAGE|ADJUSTMENT
  meter             VARCHAR(40),            -- null for SUBSCRIPTION and PRORATION_*
  description       TEXT        NOT NULL,
  qty               BIGINT      NOT NULL DEFAULT 1,
  unit_price_paisa  BIGINT      NOT NULL,
  amount_paisa      BIGINT      NOT NULL    -- signed; credits are negative
);
```

`UNIQUE (tenant_id, period_start)` is the whole concurrency design: the generation job runs on every
replica, the second one loses the insert and skips the tenant. No ShedLock, no Redis lock, and it
survives a replica dying mid-run — the hr-013 instrument, applied to the same class of problem.

The job runs at 02:00 on the 1st (mirroring `AuditArchivalService`'s `@Scheduled(cron = "0 0 2 1 * ?")`
in audit-service), iterates `tenants` where `status IN (ACTIVE, SUSPENDED)`, closes the period's
`usage_counters`, and emits `DRAFT` invoices. A SuperAdmin issues them.

**Sales tax on the platform's own invoice is out of scope here** and belongs with the FBR
e-invoicing research (parallel swarm). `tax_paisa` exists as a column with a default of 0 so that
work has somewhere to land without a migration.

### 7.5 Payment-gateway integration: DEFERRED, and why

**Deferred to a later phase. Not designed here, not planned here.**

1. **No provider is chosen.** A grep across `.planning/REQUIREMENTS.md`, `.planning/PROJECT.md` and
   the service tree finds no payment provider, no SDK, no configuration, and no requirement. The only
   `invoice` hits in REQUIREMENTS.md are `PUR-04` and `FIN-03`, both about *vendor* invoices in the
   tenant's own ledger — a different thing entirely.
2. **The integration point already exists and is enough.** `tenants.billing_ref` (`TenantEntity:49-50`)
   is an opaque external customer reference, editable through the shipped PATCH endpoint, and
   13-14-SUMMARY records `T-13-14-G` as accepted precisely on the grounds that "no payment material is
   stored". Everything in Part 7 works with that reference and nothing more.
3. **Card data must never touch this system.** Whatever provider is chosen, the only acceptable
   shapes are hosted checkout or a redirect flow where the card is entered on the provider's domain.
   That is a constraint on the future design, and it should be written down before anyone starts.

**v1 payment handling is manual**: a `BILLING` platform user (a role the schema already permits and
nothing can currently log in as — 1.7) marks an invoice `PAID` with an external reference, which
clears `billing_state` back to `ACTIVE` and, if the tenant was suspended for non-payment, calls the
existing `TenantLifecycleService.reactivate`. Webhook ingestion replaces that one method later
without touching the state machine.

---

## Part 8 — Open questions

These are genuinely open. Each needs a decision before the corresponding piece can be planned.

1. **Period boundary timezone.** UTC (matching nlq-service today) or `Asia/Karachi` (matching
   `BusinessDay`, which pos-service and reporting-service already use to date the ledger)? Changing
   it means changing `NlqQuotaService.secondsUntilEndOfUtcMonth`. ~0.5d either way, but the two
   answers produce different invoices.
2. **Does a refunded or voided order decrement the billing count?** `ORDER_REFUNDED` exists on the
   contract and a consumer is trivial. It is a commercial question, not a technical one.
3. **Grandfathering.** A tenant force-downgraded below its user or branch count is legitimately over
   its cap (13-14 asserts this state is reachable and that nothing is deleted). Does the new
   creation-time check refuse the next create for that tenant, or is there a grace period? Refusing is
   the simple answer; it may also be the one that generates the support ticket.
4. **Payment provider and timing.** Nothing in the repo names one. Until it is chosen, Part 7 ships
   with manual reconciliation.
5. **Drop `usage_records`, or keep it?** Nothing has ever written to it in this codebase — but that is
   a claim about the code, not about any production database, and I could not check a production
   database. Verify `SELECT count(*) FROM usage_records` before dropping. If non-empty, something
   outside this repo is writing it and that needs finding first.
6. **Activate the `BILLING` platform role?** The schema permits it, `PlatformAuthService` refuses to
   mint a token for it, and `PlatformAdminController` is class-level SUPER_ADMIN. A billing dashboard
   is the first genuine use case. Its authorization model is deferred to Phase 14 per 13-CONTEXT.
7. **Should suspension be propagated to auth-service?** Today it is not (1.9), so a suspended
   tenant's users can still obtain a token. That is an inconsistency between two stores — and also the
   only thing that makes any in-app billing surface reachable (5.3). Whichever way it is decided, both
   halves must be decided together.
8. **Per-tenant API rate limiting** — is it wanted at all? Today rate limiting is per-IP and
   per-device (`RateLimitConfig`). `API_CALLS` as a *billing* meter and `API_CALLS` as a *rate limit*
   are different features with different data structures (period counter vs token bucket), and only
   the first is designed here.

---

## Part 9 — Build order and effort

Sequenced so nothing depends on something that does not exist yet. Days are engineering days
including tests, in the style this phase has established (integration tests against a real
RLS-enforcing database plus a live `scripts/e2e/` script).

| # | Slice | Depends on | Days |
|---|---|---|---|
| 1 | Meter registry, `usage_counters` / `usage_gauges` / `usage_alerts` migrations, `MeterKeyResolver` (legacy keys preserved), reconciler `@Scheduled` | — | 3 |
| 2 | `ORDERS` consumer on `ORDER_CLOSED` via existing `processed_events`; refund handling per Q2 | 1 | 1.5 |
| 3 | auth-service `GET /internal/auth/tenants/{id}/user-count` + Feign method + `usageViolations` second violation (**closes 13-14 "Left open #2"**) | — | 1 |
| 4 | Gauge writers + creation-time caps for `USERS` / `BRANCHES`, with grandfathering | 1, 3 | 2 |
| 5 | Storage unification: delete `TierStorageProperties`, add `storageGb` to `StatusResponse`, file-service reads the tenant's own limit, first caller for `sumSizeBytesByTenantId` | 1 | 1 |
| 6 | Gateway `RouteQuotaMap` + soft/hard bands + `X-Usage-Warning` / `X-Usage-Overage` headers; `API_CALLS` meter | 1 | 2 |
| 7 | `tenants.billing_state`, dunning job, `SUSPENDED_ALLOWED_PREFIXES`, trial expiry | 1 | 3 |
| 8 | `subscription_changes` history (write from `changeTier` and `ProvisioningService`) | — | 1 |
| 9 | `invoices` + `invoice_lines` + `MoneyUtils.proratePaisa` + generation job + manual mark-paid | 7, 8 | 4 |
| 10 | SuperAdmin usage API (`/usage`, `/tenants/{id}/usage`, `/usage/alerts`) | 1, 2 | 2 |
| 11 | Frontend: 4 layers + fleet usage page + per-tenant page | 10 | 4 |
| 12 | Tenant self-serve `/api/v1/billing/self/usage` + banner | 6, 7 | 1.5 |
| | | **Total** | **26** |

Slices 1–3 are the ones with standalone value: 1 gives every meter a durable record for the first
time, 2 makes orders billable, and **3 closes a named gap from the previous plan for one day of
work.** Slice 5 removes a live enforcement divergence and is nearly free.

### Verification this design must be held to

The brief's warning is the operative one, and this repository has earned it: an entire API
unreachable from one wrong JWT claim, provisioning that never worked against a real database,
compensation that could never fire because Feign cannot send PATCH — and, documented here for the
first time, **a usage-metering subsystem that has been marked `[x]` complete since Phase 3 and has
never recorded a single row.**

So: no meter counts as delivered until a live script asserts the number **read back out of Postgres
as a non-superuser**, in the manner of `scripts/e2e/phase13-subscription-e2e.sh`. Specifically —

- an order placed through the real gateway moves `usage_counters.qty` by exactly one;
- `FLUSHDB` followed by one reconciler cycle restores the Redis counter to the Postgres value, and
  the NLQ counter is restored to `max(redis, db)` rather than clobbered;
- a tenant at 80% receives `X-Usage-Warning` and is **not** blocked;
- a cost meter at 100% receives 429 with `X-Upgrade-CTA-URL`; a revenue meter at 100% receives 200
  and an `OVERAGE` line appears on the invoice;
- a downgrade below the live **user** count is refused 409 `TIER_LIMIT_EXCEEDED` naming both numbers,
  and is refused again when auth-service is stopped;
- the invoice job run twice produces one invoice.

A test that passes because a class exists is the specific failure this document is written against.
