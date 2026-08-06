---
phase: 13-platform-tenant-access-repair
plan: 14
subsystem: platform-subscription
status: complete
tags: [tier, subscription, platform-10, impersonation, d-34, d-35, nlq-quota, fail-closed, retry]
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service, finance-service, platform-admin-service
  - "13-03: TierFeatureDefaults' 20 codes and the StatusResolution/UNKNOWN fail-closed posture"
  - "13-05: platform_login, POST /api/v1/platform/auth/login"
  - "13-10: the repaired saga, the JDK-backed feign.Client, ProvisionResult.tempPassword"
provides:
  - "PATCH /api/v1/platform/tenants/{id} — brand, billingRef, trialEndsAt, renewsAt"
  - "POST  /api/v1/platform/tenants/{id}/tier — {tier, force} -> TierChangeResponse"
  - "POST  /api/v1/platform/tenants/{id}/retry-provisioning — {adminEmail}"
  - "TenantSubscriptionService + TierLimits (the tier table, extracted)"
  - "tenant_features.is_override (030-001) and tenants.renews_at (030-002)"
  - "FeatureFlagAdminService.reconcileToTierDefaults — PLATFORM-10 reconciliation"
  - "409 TIER_LIMIT_EXCEEDED and 409 PROVISIONING_FAILED instead of 500"
  - "GET /internal/platform/tenants/{id}/status now returns nlqQuota"
  - "Redis contract tenant:nlq_quota:{tenantId} — written by platform-admin and the gateway, read by both and by nlq-service"
  - "503 NLQ_QUOTA_UNAVAILABLE as a distinct gateway error code"
  - "user_db partial unique index uk_branches_tenant_name_live (012-001)"
  - scripts/e2e/phase13-subscription-e2e.sh
affects:
  - "13-15: the seed script can now set tiers and subscription fields through the API; three tenants with different module sets no longer need direct SQL"
  - "every FEATURE_DISABLED response — the X-Upgrade-CTA-URL header finally has a destination"
  - "every /api/v1/nlq/ request — the quota is per-tenant and fails closed"
  - "any future feature toggle — a SuperAdmin PATCH now marks the row as an override"
tech-stack:
  added: []
  patterns:
    - a marker column is the only thing that lets reconciliation distinguish a decision from a default
    - an undeterminable usage is not a permissive one — the same posture as an undeterminable status
    - extract the table the moment it acquires a second caller, or the copies diverge silently
    - a test DB user that owns the schema hides every privilege the runtime user lacks
    - MockWebServer's queue dispatcher must fail fast, or one missing stub becomes six unrelated timeouts
    - assert a cumulative counter as a delta, never as an absolute
key-files:
  created:
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/TenantSubscriptionService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/config/TierLimits.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/exception/TierLimitExceededException.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/exception/PlatformAdminExceptionHandler.java
    - services/platform-admin-service/src/main/resources/db/changelog/v1.0.0/030-tenant-feature-override-flag.xml
    - services/user-service/src/main/resources/db/changelog/v1.0.0/012-branch-name-unique-excludes-deleted.xml
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/TenantSubscriptionIT.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/ImpersonationActorIT.java
    - scripts/e2e/phase13-subscription-e2e.sh
  modified:
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAdminController.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformInternalController.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ProvisioningService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/FeatureFlagAdminService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ImpersonationService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/entity/TenantEntity.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/entity/TenantFeatureEntity.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/client/UserInternalClient.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/dto/PlatformDtos.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/BasePlatformIT.java
    - gateway/src/main/java/io/restaurantos/gateway/filter/FeatureFlagGlobalFilter.java
    - gateway/src/main/java/io/restaurantos/gateway/client/PlatformAdminClient.java
    - gateway/src/test/java/io/restaurantos/gateway/FeatureFlagFilterIT.java
    - services/nlq-service/src/main/java/io/restaurantos/nlq/quota/NlqQuotaService.java
    - services/nlq-service/src/test/java/io/restaurantos/nlq/quota/NlqQuotaServiceTest.java
decisions: [D-30, D-34, D-35]
requirements: [PLATFORM-02, PLATFORM-03, PLATFORM-04, PLATFORM-05, PLATFORM-06, PLATFORM-10]
metrics:
  duration: ~3h
  completed: 2026-08-07
  tasks: 3
  commits: 3
---

# Phase 13 Plan 14: Tenant Subscription, Tier Management & the Impersonation Actor — Summary

**The tier is no longer write-once, and the impersonation trail can answer who impersonated whom.**
Both are proved live: `scripts/e2e/phase13-subscription-e2e.sh` is **51 PASS / 0 FAIL, exit 0, twice
consecutively**, every assertion through the real gateway, with the D-34 actor read back out of
`platform_db` as a non-superuser rather than asserted from a response.

The audit's sharpest phrasing on tier was that the upgrade call-to-action header returned on every
disabled-feature response led nowhere. It now leads to
`POST /api/v1/platform/tenants/{id}/tier`, and the e2e proves the round trip: a STARTER tenant is
refused `FEATURE_NLQ` with the CTA header, the tier changes, and **the same request clears the gate
with no restart and no cache-TTL wait**.

## The new endpoints (13-15 codes against these)

```jsonc
PATCH /api/v1/platform/tenants/{tenantId}
  {"brandName":"…","billingRef":"cus_…","trialEndsAt":"…Z","renewsAt":"…Z"}   // all optional
→ 200 {"data": TenantResponse}          // now also carries billingRef, trialEndsAt, renewsAt

POST  /api/v1/platform/tenants/{tenantId}/tier
  {"tier":"GROWTH","force":false}
→ 200 {"data":{"tenantId","previousTier","tier","changedFeatureCodes":[…],
                "maxBranches","maxUsers","storageGb","nlqQuota","forcedOverLimits"}}
→ 409 TIER_LIMIT_EXCEEDED   // downgrade below current usage, unless force
→ 409 STATE_INVALID         // tenant is CANCELLED or PURGED

POST  /api/v1/platform/tenants/{tenantId}/retry-provisioning
  {"adminEmail":"owner@…"}
→ 200 {"data": ProvisionResult}   // same shape as create, including tempPassword
→ 409 STATE_INVALID               // tenant is not PROVISIONING_FAILED
```

`force` is **boxed** (`Boolean`), not a primitive. As a primitive, this service's Jackson
configuration refused any body that omitted it — every request without an explicit `"force"` came
back 400, which turns the safe default into an error. Measured, not theorised: it was the first
red in the suite.

## The tier reconciliation rule, and the override marker

**A feature-override marker column WAS added** — `tenant_features.is_override`, changeset
`030-001`, `BOOLEAN NOT NULL DEFAULT FALSE`.

Without it, tier reconciliation has exactly two possible implementations and **both are wrong**:
reconcile every row to the new tier's defaults (which silently revokes a feature an administrator
deliberately granted, violating PLATFORM-10), or reconcile nothing (which makes the tier cosmetic —
a downgrade never takes anything away). The marker is the third option.

| Row state | On a tier change |
|---|---|
| `is_override = true` | **Left alone, in BOTH directions.** An enterprise-only feature granted to a starter tenant survives a downgrade; a module an administrator switched OFF is not switched back on by an upgrade. |
| `is_override = false`, value differs from the new tier's default | Set to the default; both Redis key shapes rewritten |
| no row at all | Created at the new tier's default — which also backfills tenants provisioned before a code existed |
| `is_override = false`, already correct | Untouched, and its cache keys are not churned |

`FeatureFlagAdminService.setFeature` — the only path reachable from the two SuperAdmin-facing
endpoints — now marks every row it writes. Provisioning's seeding loop and the reconciler write
through the repository directly and leave the marker at `false`.

**Backfilled `false`, deliberately.** Every existing row was written by provisioning's seeding loop
or by the demo/dev seed changesets, both of which are tier defaults; rows written through
`setFeature` since the beginning of time are indistinguishable from seeded ones in the data.
Backfilling `true` would freeze every tenant's current feature set against every future tier change
— the more damaging of the two errors and the harder one to notice. A SuperAdmin with an override
they care about re-asserts it with one PATCH.

## What a downgrade does to tenant data: nothing

Stated plainly because the plan asks for it explicitly.

A downgrade changes **four integer ceilings** on the tenant row and flips
`tenant_features.is_enabled` for the codes the lower tier does not cover. **Nothing is deleted
anywhere.** Branches, users, orders, ledger entries and every record belonging to a now-disabled
module stay exactly as they were. Disabling a module **gates** it — the gateway answers 403
`FEATURE_DISABLED` at the edge — and re-upgrading restores access to the same rows. Asserted live:
after a forced downgrade to STARTER (cap 1), **both branches are still live** in `user_db`, read as
`user_service` with the RLS GUC set.

The one thing a downgrade *can* leave behind is a tenant above its own new ceiling, which is what
the usage check exists for.

## The refused downgrade, and the half of it that is not enforced

A downgrade whose branch cap falls below the tenant's live branch count is refused **409
`TIER_LIMIT_EXCEEDED`**, naming the limit and the usage:

```
Downgrade to STARTER refused — the tenant is already over the target tier's limits
(branches: in use 2, target tier allows 1). Reduce usage first, or repeat the request
with force=true to apply the tier anyway.
```

`force: true` applies it and the response says `"forcedOverLimits": true` rather than reporting an
ordinary success. **An unobtainable branch count also refuses** — the same posture 13-03
established for tenant status: an undeterminable answer is not a permissive one. `force` still
overrides that, so an operator is never locked out of a tier change by an outage.

🔴 **The USER cap is not enforced, and this is a gap rather than an oversight.** user-service
exposes `GET /internal/users/tenants/{id}/branches`, so the branch count is authoritative and read
with RLS enforced at the producer. There is **no equivalent for users**: the `users` table lives in
`auth_db` and auth-service exposes no tenant user count on any internal channel. Adding one was out
of bounds (13-09 and 13-11 were working in auth-service concurrently). The consequence: a downgrade
whose `max_users` is below the tenant's headcount is applied without a refusal. Nothing is deleted
by it and no login breaks — `max_users` is a ceiling nothing enforces at creation time either — but
the prohibition "tier limits MUST NOT be lowered below current usage without an explicit refusal"
is only half satisfied. **The missing piece is one internal endpoint on auth-service**, and
`usageViolations` is already shaped to take a second violation.

## D-34: the impersonation actor, and two defects underneath it

Both impersonation controllers passed `req.targetUserId()` in the **acting-administrator** position.
The service's parameters were correctly named, which is exactly why nothing about the call site
looked wrong — and every `impersonation_log` row said the impersonated user had impersonated
themselves, as did the token's `impersonated_by` claim.

- **Public endpoint:** the acting id now comes from the verified platform principal
  (`JwtClaims.subject()` — the `sub` of the RS256 control-plane token, checked against JWKS). It is
  **not** read from the body: `theActingIdComesFromTheToken_notFromTheRequestBody` sends a
  *different* administrator's id in `actingAdminUserId` and asserts the persisted row still names
  the authenticated one. A repudiation control whose subject can choose the name on the record is
  not a control.
- **Internal endpoint** (`/internal/platform/**`, gated by the shared secret, no token to read):
  the caller must supply `actingAdminUserId` and is **refused 400** without it.
- **The service refuses `adminUserId == targetUserId`** outright. That is the exact shape of the
  D-34 bug, made impossible to reintroduce without a test going red.

**Two defects found by the first tests to exercise these paths over HTTP:**

1. 🔴 **The audit row could never be written at all.** `ImpersonationService` called
   `entry.setId(UUID.randomUUID())` on an entity annotated `@GeneratedValue(GenerationType.UUID)`,
   so Spring Data saw a non-new entity and called `merge()`; Hibernate issued an `UPDATE` for a row
   that does not exist and it surfaced as an `OptimisticLockingFailure` → **409 to the caller**.
   Every impersonation failed at the point of recording itself. Same trap `ProvisioningService`
   documents on `TenantEntity`. Nothing had ever exercised this path over HTTP.
2. **`IllegalArgumentException` was unmapped.** shared-lib's advice handles Spring's own
   malformed-request family but not this, so a rejected argument — an unknown tier name, a missing
   acting administrator, a tenant id that resolves to nothing — came back **500**. Now 400 via
   `PlatformAdminExceptionHandler`.

## The NLQ quota: the tenant's own number, and three ways it used to grant

The gateway compared the counter against a compiled-in `NLQ_DEFAULT_MONTHLY_LIMIT = 5000` while
every tenant row carried an `nlq_quota` column nothing read. **But nlq-service has its own
compiled-in limit too** — `restaurantos.nlq.monthly-quota-default`, defaulting to **500** — so the
lower constant governed and **every tenant on the platform was capped at 500 regardless of tier**,
an ENTERPRISE tenant paying for 50,000 included. Fixing only the gateway would have left that cap
in place and made the fix invisible in production, which is why nlq-service is in this plan's diff
and was not in its file list.

- platform-admin's status response carries `nlqQuota` beside the tier it already returned, so the
  limit rides along with the lookup the gateway already makes and caches — no extra round trip, no
  second cache-miss path.
- Cached at **`tenant:nlq_quota:{tenantId}`**, a verbatim key contract with two other components.
  `TenantSubscriptionService.changeTier` writes it directly on a tier change, so an upgrade is
  enforced at its new allowance on the very next request.
- nlq-service reads the same key and falls back to its configured default — a number smaller than
  every tier's allowance, so the fallback throttles early and never unmeters.

**Three paths that used to grant now fail closed**, all honouring the single existing
`restaurantos.fail-open-on-platform-down` lever:

| Situation | Before | Now |
|---|---|---|
| limit undeterminable (platform-admin down) | compiled-in 5000 applied | 503 `NLQ_QUOTA_UNAVAILABLE`, nothing cached |
| platform-admin returns a null quota | n/a (never asked) | 503 — a null column is a non-answer, not "no limit" |
| counter unreadable / not a number | `count = 0`, i.e. a full month granted | 503 |
| counter READ fails | escaped the filter → **401 UNAUTHENTICATED** at `JwtGlobalFilter` | 503 (this is 13-03's "left open" #3, for the quota path) |

An **absent** counter is deliberately still read as zero: that legitimately means no usage yet this
month, and it is a real answer rather than a missing one.

## Provisioning retry, and the constraint that made it unusable

13-10 recorded two defects in `ProvisioningService.retry` and declined to fix the second on the
grounds that retry had no endpoint. This plan gives it one, so both are paid:

- `provision()` always constructed a **new** `TenantEntity`, so a retry produced a second tenant
  with a `-1`-suffixed slug and abandoned the failed one. The saga body is now `executeSaga(key,
  tenant, adminEmail)` and retry re-drives **the same row**, keeping its id and its slug — which is
  the entire point of a retry. Asserted live: one row, same slug, ACTIVE.
- Retrying a tenant that is not `PROVISIONING_FAILED` is refused 409, not silently re-run against
  live infrastructure.

🔴 **And a third defect, which made the endpoint unusable in practice.** `uk_branches_tenant_name`
in `user_db` was a plain `UNIQUE (tenant_id, name)` while deletion in that service is **soft** —
`deactivateInternal` sets `deleted_at`, deliberately, because a branch may already be referenced.
The two together mean a branch name is consumed **permanently**. The saga's compensation
soft-deletes the HQ branch it created, so a retry tried to create `"<Brand> HQ"` again and was
refused 409 — **retry could only ever have succeeded for a failure that happened before the branch
step, which is none of the realistic ones.** Changeset `012-001` replaces the constraint with a
partial unique index `WHERE deleted_at IS NULL`: strictly weaker (two *live* branches of a name are
still refused), the same instrument 13-CONTEXT prescribes for `user_branch_roles`, and a bug in its
own right beyond retry — delete a branch today and you can never recreate it with the same name.

Found by the e2e, not by reading: the first run failed S11 with
`Branch 'Phase13 Subscription Retry HQ' already exists`.

## Only a SUPER_ADMIN, asserted so it would fail if the check were removed

The plan's guardrail. Both `TenantSubscriptionIT` gate tests present **real, correctly signed**
tokens: `BasePlatformIT` now serves a genuine JWKS and mints RS256 tokens. That matters — with the
previous `{"keys":[]}` stub every token failed verification, so a 401 would have masqueraded as an
authorization refusal and the test would have passed for the wrong reason.

| Persona | tier | subscription | features | suspend |
|---|---|---|---|---|
| tenant `OWNER` (with `rbac.manage`) | 403 | 403 | 403 | 403 |
| `TENANT_ADMIN` | 403 | 403 | 403 | 403 |
| platform `SUPER_ADMIN` | 200 | 200 | 200 | — |

Each gate test also asserts the tenant row **did not move** afterwards, and
`superAdminGate_theSuperAdminTokenItselfIsAccepted` is the negative control: without it, a bug that
403'd every request would turn both gate tests green. The live script repeats all of it through the
real gateway with a real tenant OWNER token.

## How I convinced myself against a real RLS-enforcing database

The plan warns that Testcontainers runs as SUPERUSER and hides RLS, and that five paths this phase
shipped green-but-broken that way. Four things:

1. **Measured, not assumed.** `platform_db` has no RLS at all — `tenants`, `tenant_features`,
   `impersonation_log`, `event_outbox` are all `rls=false force=false`, which 13-10 measured and
   `PlatformDbIsolationIT` (9/9) asserts on every build. So this plan's own writes need no GUC and
   the absence of one is correct rather than a repeat of the bug.
2. **The one cross-service read sets no GUC because the PRODUCER does.**
   `GET /internal/users/tenants/{id}/branches` takes the tenant in the path and
   `BranchInternalController` calls `setTenantGuc(tenantId)` itself before querying — unlike the
   delete beside it, which addresses a branch by its own id and therefore needs `X-Tenant-Id`.
   Mirroring the producer's existing contract rather than inventing a header.
3. **Every live assertion reads as a non-superuser.** `platform_admin`, `auth_user`,
   `user_service` and `finance_user` are all NOSUPERUSER NOBYPASSRLS; the e2e reads the
   impersonation row, the tenant row, the feature rows and both branches as those roles, with the
   GUC set where the table is RLS-scoped. A superuser-backed test cannot vouch for any of it.
4. 🔴 **The test database hid a privilege problem, exactly as warned — just not an RLS one.**
   `BasePlatformIT` connects as `platform_admin`, which **owns** every table in `platform_db`. The
   running service connects as `platform_user`, which does not. Changeset `030` therefore passed
   every test and then **failed to start the service**: `ERROR: must be owner of table
   tenant_features`. It had never surfaced before because no previous changeset ALTERed an existing
   table. Repaired on this machine with `GRANT platform_admin TO platform_user`. See "Left open" —
   this is an environment/deployment finding, not an application bug, and it is not represented in
   `deploy/init/`.

## Deviations from plan

**1. [Rule 3 — blocking] `tenants.renews_at` did not exist.** The plan describes billing reference,
trial end and renewal date as "columns that exist today and are never read or written". The first
two do (010-001). The renewal date does not — no column, no entity field. Added as changeset
`030-002` rather than dropped from the plan: a subscription record that can express a trial end but
not a renewal cannot describe the state a paying tenant is actually in. Nullable with no default,
because a trialing tenant genuinely has no renewal date and `NOW()` would be a fabricated one.

**2. [Rule 1 — bug] `ImpersonationService` assigned an id to a `@GeneratedValue` entity**, so the
audit row could never be written and every impersonation returned 409. Detail above. Not in the
plan's list; the plan's own acceptance criterion ("the impersonation log row names the SuperAdmin")
is unreachable without it.

**3. [Rule 2 — correctness] `IllegalArgumentException` → 400, and `ProvisioningException` → 409
`PROVISIONING_FAILED`** (naming any resource a compensating action could not clean up). 13-10
recorded the second as "a worthwhile follow-up [that] belongs with whoever exposes retry". That is
this plan. A retry endpoint whose expected failure mode is an opaque 500 is not usable.

**4. [Rule 1 — bug, out of the plan's file list] `user_db`'s branch-name uniqueness ignored soft
deletes**, which made the retry endpoint unusable for every realistic failure. Full detail above.
user-service was safe to touch (13-09/13-11 were in auth-service); its suite was re-run green.

**5. [Rule 1 — bug, out of the plan's file list] nlq-service enforced its own compiled-in 500.**
The plan scoped the quota fix to the gateway. Fixing only the gateway leaves the *lower* of two
constants governing, so must_have truth #4 ("a tenant whose quota is above the old compiled-in
constant is not throttled at that constant") would have been false in production while true in the
gateway's tests. The prompt permitted nlq-service "if the quota work requires it"; it did.

**6. [Rule 2 — verifiability] `BasePlatformIT` now serves a real JWKS and mints RS256 tokens.** The
`{"keys":[]}` stub makes an authorization gate untestable: every token 401s, so a 403 that *should*
come from `@PreAuthorize` is indistinguishable from a signature failure. The plan's guardrail
demands tests "that would fail if the check were removed"; this is what makes that possible.

**7. [Rule 1 — bug in an existing test harness] Two `FeatureFlagFilterIT` problems that hid failures
rather than finding them.** MockWebServer's default `QueueDispatcher` **blocks** on an unstubbed
call, so one missing stub cascaded into six unrelated tests timing out at 5s each and the real cause
was invisible — `setFailFast(true)` now makes an unstubbed call fail in the test that made it, and
the class runs in 3s instead of 37s. And `featureEnabled_requestForwarded` asserted an **absolute**
cumulative `getRequestCount()`, so it broke the moment any forwarding test was added ahead of it;
every other case in the class was already a delta.

**8. [Rule 3 — blocking, environment only, no source touched] `GRANT platform_admin TO
platform_user`.** See point 4 of the RLS section and "Left open" #1.

**9. [Rule 3 — blocking, no source touched] 158 macOS duplicate build artifacts** (`" 2"` / `" 3"`
suffixed copies under `*/target/`) broke `nlq-service`'s `repackage` with "Unable to find main
class". Same failure 13-01 and 13-03 recorded. Deleted only paths inside `target/`, after confirming
none was tracked.

**10. [Scope — file list] `ImpersonationActorIT` is a second test class**, not assertions added to
`TenantSubscriptionIT` as the plan's verify command implies. Six impersonation cases in a class
named for subscriptions would be misfiled. Both classes are run in every command below.

**11. [Out of plan scope, no source touched] Services rebuilt and restarted:**
platform-admin-service, gateway, user-service (for the 012 migration) and finance-service, which
was found in the wedged state the prompt describes — `/actuator/health` answering while every other
path hung. auth-service was **not** restarted; 13-09/13-11 were working in it.

## Verification actually run

Every number is from a command executed in the state being reported, with `JAVA_HOME=openjdk@25`,
`TESTCONTAINERS_RYUK_DISABLED=true`, `TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl platform-admin,gateway,user-service,nlq-service -am verify` | **BUILD SUCCESS**, all 6 modules |
| ├ shared-lib | unit **38/38**, IT **11/11** |
| ├ gateway | unit **52/52**, IT **22/22** (`FeatureFlagFilterIT` 10 → **17**) |
| ├ user-service | unit **3/3**, IT **11/11** |
| ├ platform-admin-service | unit **4/4**, IT **70/70** (was 50) |
| │  ├ `TenantSubscriptionIT` | **14/14** (new) |
| │  ├ `ImpersonationActorIT` | **6/6** (new) |
| │  ├ `ProvisioningSagaIT` | 14/14 |
| │  ├ `PlatformAuthIT` | 18/18 |
| │  ├ `PlatformDbIsolationIT` | 9/9 |
| │  ├ `TenantLifecycleIT` | 6/6 |
| │  └ `FeatureFlagInvalidationIT` | 3/3 |
| └ nlq-service | unit **63/63**, IT **14/14** |
| `bash scripts/e2e/phase13-subscription-e2e.sh` | **51 PASS / 0 FAIL, exit 0** ×2 consecutive |
| same, `GATEWAY` at a dead port | **exit 1** — the harness can fail; trap still cleaned up |
| `scripts/e2e/phase13-provisioning-e2e.sh` (13-10) | **27 PASS / 0 FAIL, exit 0** — unchanged |
| `scripts/e2e/phase13-feature-gating-e2e.sh` (13-03) | **11 PASS / 0 FAIL, exit 0** — unchanged |
| `scripts/e2e/phase13-superadmin-e2e.sh` (13-05) | **21 PASS / 0 FAIL, exit 0** — unchanged |
| `opa test policies/` | **139/139** (no `.rego` touched) |
| Demo/test tenants after every run | `demo:ACTIVE`, `test:ACTIVE` — unaffected |
| Throwaway tenants left behind | **0** |

### The tests were verified able to fail

Not a chronological RED — the code was written first — so both headline claims were **mutated
instead**, which is the stronger evidence:

| Mutation | Result |
|---|---|
| `if (row != null && row.isOverride())` → `if (false)` in the reconciler | `changeTier_preservesAnOverriddenFeature_whenTierDefaultsWouldDisableIt` **and** `…WouldEnableIt` go red; nothing else moves |
| controller passes `req.targetUserId()` in the acting position again (the literal D-34 defect) | `impersonating_recordsTheAuthenticatedSuperAdminAsTheActor_notTheTarget`, `theTokenAuthServiceIsAskedToMint_carriesTheSuperAdminAsImpersonatedBy` and `theActingIdComesFromTheToken_notFromTheRequestBody` go red |

Both mutations were reverted and the suite re-run at 70/70 before committing.

The e2e's own first two runs were red for real reasons and are recorded rather than smoothed over:
S8 and S11 failed on the branch-name constraint and on `NOAUTH` from an unauthenticated `redis-cli`
— the second of which reads *exactly* like a missing key and would have scored the working dual-key
invalidation as broken.

### GitNexus (run per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `TenantLifecycleService` | 0 | LOW |
| `FeatureFlagAdminService` | 0 | **MEDIUM** |
| `ProvisioningService` | 0 | **MEDIUM** |
| `ImpersonationService` | 0 | LOW |
| `FeatureFlagGlobalFilter` | 0 | LOW |
| `PlatformAdminController` | 0 | LOW |
| `NlqQuotaService` | 0 | LOW |

`detect-changes -s compare -b c8a8490` → 30 files, 45 symbols, 9 affected processes, **risk high** —
but that window also contains 13-11's two commits, including its `StripInternalHeaderFilter` change,
which is where most of it comes from.

🔴 **The `FeatureFlagGlobalFilter` LOW is wrong in the way that matters**, exactly as 13-03 and
13-01 recorded for it and for `JwtGlobalFilter`. It is a Spring `GlobalFilter` dispatched by the
framework, so it has no static callers; the graph reports LOW because nothing *calls* it, not
because little depends on it. Its real blast radius is **every authenticated tenant request that
crosses the gateway**. Treated as CRITICAL: the change is fenced by 17 integration cases against a
real Redis and a real HTTP platform-admin stub, plus 51 live assertions through the running gateway.

The index is stale (last built at `5fba4a9`). Not refreshed, for the reason 13-01 through 13-10 all
gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01 had to
revert.

## Left open, and not claimed to work

### 1. The runtime DB user cannot run its own migrations

`platform_db`'s tables are all owned by `platform_admin`; the service connects as `platform_user`
(`scripts/local-service-env.sh:PLATFORM_DB_USER`), while `application.yml`'s own default is
`platform_admin`. Changeset `030` is the first to ALTER an existing table, so it is the first thing
that ever needed ownership — and it **failed to start the service** until I ran
`GRANT platform_admin TO platform_user`.

`platform_admin` does **not exist in `deploy/init/02-create-roles.sql`** at all, so this is drift
between the committed infra and this machine, and I could not fix it in code without risking a
fresh environment. **It is a deployment-blocking condition for any future migration on this
service** and it deserves a decision: either `local-service-env.sh` should stop overriding the user,
or `02-create-roles.sql` should create `platform_admin` and grant membership. I did neither, because
guessing which is intended is how a fresh `make dev-up` breaks.

### 2. The user-count half of the downgrade guard

Detail above. One internal endpoint on auth-service closes it; `usageViolations` is already shaped
for a second violation.

### 3. The immediacy assertion's "after" state is a 503, not a 200

nlq-service is not running on this machine, so after the upgrade the gateway routes and finds no
instance. The assertion is on the **error code** — it must no longer be `FEATURE_DISABLED` — which
is 13-03's rule (three layers answer 403 on these routes, so a status-only assertion cannot tell
them apart) and is the honest form. It proves the gate opened and the request reached routing; it
does not prove nlq-service answers. The reverse direction (S7) *is* a clean `FEATURE_DISABLED`.

### 4. A retry after the admin user was created will still fail

If the original attempt failed *after* provision-admin, compensation revokes the admin's branch-role
but no internal endpoint exists to deactivate the account (13-10 named this gap and it is unchanged
— auth-service was off-limits again). The retry then fails at provision-admin on the duplicate
email, reported as a 409 rather than silently producing a half-tenant. The e2e's retry case forces a
failure at the auth-tenant step, which is before the admin.

### 5. Existing tenants still have no rows for codes added after they were provisioned

13-03 recorded this. `reconcileToTierDefaults` now creates a missing row at the tier default, so a
tier change **incidentally backfills** a tenant — but a tenant whose tier never changes is still
missing them. No migration was written for it here.

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test, by a live HTTP
assertion, or both. `TierLimits.forTier` is the sole tier table and is read by both callers;
`is_override` is written by `setFeature` and read by the reconciler, and both halves are asserted
from the database.

## Threat flags

None beyond the plan's register. Where each entry is closed:

- **T-13-14-A** (impersonation actor inversion) — closed. Acting id from the verified principal;
  refused when unresolvable; refused when it equals the target; refused on the internal channel
  without one. Asserted against the persisted row **and** against the decoded token, live.
- **T-13-14-B** (tier change granting entitlements) — closed. Class-level `SUPER_ADMIN` gate,
  asserted 403 for a tenant OWNER and a TENANT_ADMIN holding **valid** tokens, in the IT and live.
- **T-13-14-C** (stale feature cache) — closed. Reuses the existing dual-key path; immediacy
  asserted live in both directions with no restart and no TTL wait; both key shapes read back.
- **T-13-14-D** (reconciliation wiping overrides) — closed. `is_override` skipped in both
  directions; asserted in both, and mutation-tested.
- **T-13-14-E** (a downgrade leaving a tenant over its limits) — **partly** closed. Branches:
  refused with the limit and the usage named. Users: not enforced — see "Left open" #2.
- **T-13-14-F** (quota lookup failure granting unlimited access) — closed, and widened: the limit,
  the counter and a null quota all fail closed under the single existing lever.
- **T-13-14-G** (billing reference on the tenant row) — accepted as planned. An opaque external
  reference; no payment material is stored.
- **T-13-14-SC** — **no package of any kind was installed**, in any ecosystem.

## Self-Check: PASSED

All 9 created files exist on disk (verified with `test -f`), and all 3 commits exist in `git log`:
`c914370`, `c8a8490`, `5f1e4e3`.
