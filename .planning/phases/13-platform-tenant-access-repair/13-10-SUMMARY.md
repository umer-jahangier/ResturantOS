---
phase: 13-platform-tenant-access-repair
plan: 10
subsystem: provisioning-saga
status: complete
tags: [provisioning, saga, compensation, b2, sc2, d-04, d-05, d-06, d-07, d-08, d-09, d-10, rls, feign]
requires:
  - running dev stack (postgres, redis, rabbitmq, eureka) + gateway, auth-service, user-service, finance-service, platform-admin-service
  - "13-05: platform_login, POST /api/v1/platform/auth/login"
  - "13-06: POST /internal/auth/tenants, PATCH /internal/auth/tenants/{id}/status, the extended provision-admin"
  - "13-08: the forced-change gate a provisioned admin's first login now meets"
provides:
  - "POST /api/v1/platform/tenants now returns {tenantId, slug, adminEmail, tempPassword, loginUrl}"
  - "DELETE /internal/users/branches/{branchId} (soft, idempotent, X-Tenant-Id required)"
  - "ProvisioningService.ManualRepairRecord + ProvisioningException.manualRepairs()"
  - "typed UserInternalClient / AuthInternalClient contracts for the whole saga seam"
  - "FeignSharedConfig.JdkHttpFeignClient — a feign.Client that can send PATCH"
  - scripts/e2e/phase13-provisioning-e2e.sh
affects:
  - "13-15: the seed script can now drive the real provisioning API; the response shape is below"
  - "tenant suspension propagation to auth-service, which was impossible over Feign until the PATCH fix"
  - "every platform-admin-service Feign call — they now go through the JDK HTTP client"
tech-stack:
  added: []
  patterns:
    - a typed Feign return turns a producer-side rename into a compile error, not a silent parse miss
    - delete the fallback; a saga that substitutes an identifier corrupts everything downstream of it
    - assert a configuration flag by its behaviour at BOTH values, never by reading the annotation
    - compensation is only real if a test forced the failure that triggers it
    - a manual-repair record names the resource; "manual cleanup needed" names nothing
    - never let a credential reach a durable store just because it rode along in a result object
key-files:
  created:
    - scripts/e2e/phase13-provisioning-e2e.sh
  modified:
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ProvisioningService.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/controller/PlatformAdminController.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/client/AuthInternalClient.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/client/UserInternalClient.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/client/FeignSharedConfig.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/dto/PlatformDtos.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/ProvisioningSagaIT.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/BasePlatformIT.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/TenantLifecycleIT.java
    - services/platform-admin-service/src/test/java/io/restaurantos/platform/FeatureFlagInvalidationIT.java
    - services/platform-admin-service/src/test/resources/application-test.yml
    - services/user-service/src/main/java/io/restaurantos/user/controller/BranchInternalController.java
    - services/user-service/src/main/java/io/restaurantos/user/service/BranchService.java
decisions: [D-04, D-05, D-06, D-07, D-08, D-09, D-10, D-29a, D-30]
requirements: [PLATFORM-01, AUTH-01, USER-01, USER-03]
metrics:
  duration: ~2h
  completed: 2026-08-07
  tasks: 3
  commits: 3
---

# Phase 13 Plan 10: Provisioning Saga Repair — Summary

**Blocker B2 is closed and refuted point by point by live evidence.** A tenant provisioned through
`POST /api/v1/platform/tenants` on the real gateway now logs in: **27 PASS / 0 FAIL, exit 0, three
consecutive runs**, ending with a real token carrying `roles: [OWNER]`, **65** permission codes and
the new tenant's id, which then opens a tenant-scoped endpoint with a 200.

`application.yml` was not touched — its key was already correct. The `@Value` was wrong.

## The endpoint's new response shape (13-15 codes against this)

```jsonc
POST /api/v1/platform/tenants
  Idempotency-Key: <optional>
  {"brandName": "...", "adminEmail": "...", "tier": "GROWTH"}

→ 201
{"data": {
   "tenantId":     "<uuid>",
   "slug":         "<slug>",
   "adminEmail":   "owner@example.local",
   "tempPassword": "<one-time credential>",
   "loginUrl":     "https://app.restaurantos.io/login?tenant=<slug>"
 }, "meta": null, "warnings": []}
```

`tempPassword` **replaces nothing and is additive** — the record previously carried `loginUrl` *in
place of* the credential, which is D-08. It is null on exactly one path: an idempotent replay made
after the credential's one-hour retention window. **13-15 must clear two gates after provisioning,
in this order: the 13-08 forced change first, then the D-29a TOTP enrolment.** The e2e script is a
working, dependency-free recipe for both.

## Where each of B2's seven defects died

| Defect | What was wrong | Now |
|---|---|---|
| **D-06** | `extractBranchId` parsed `{"data":{"id"}}`; the producer returns a bare `{"branchId"}`. It never matched, so `UUID.randomUUID()` fired on **every** provision and became the event's aggregate id | Typed Feign return; **the fallback is deleted** — an unreadable response aborts the saga |
| **D-07** | `isHq` never sent (HQ persisted `is_hq=false`); an `addressLine1` sent that the request record does not declare, and was silently dropped | Typed request: `{tenantId, name, isHq:true}`, nothing else |
| **D-09** | `@Value("${provisioning.seed-coa.enabled:true}")` bound nothing; the default of `true` always won | `restaurantos.provisioning.seed-coa.enabled`, asserted by behaviour at both values in tests **and live** |
| **D-04** | Nothing in application code ever wrote the `auth_tenants` row login resolves a tenant by slug from | A saga step, placed **before** the admin so a slug collision fails cheaply |
| **D-05** | No `user_branch_roles` row, so `PermissionResolver` refused every provisioned admin outright | The real branch id and `OWNER` are passed to 13-06's extended `provision-admin`, which writes user + assignment in one transaction |
| **D-08** | The controller discarded the temp password and substituted a hardcoded login url | Returned to the SuperAdmin, once |
| **D-10** | Two `log.warn("manual cleanup needed")` stubs | Real deactivation of branch, auth tenant and admin assignment; a failed compensation becomes a `ManualRepairRecord` |

## How I convinced myself this works against a database that really enforces RLS

The plan warned that Testcontainers hides RLS, and it is right — five paths in this phase have
already shipped green-but-broken that way. Three independent things hold this one down:

1. **Measured, not assumed.** On the live databases: `branches` `rls=true force=true`;
   `chart_of_accounts` and `accounting_periods` `true/true`; `users` and `user_branch_roles`
   `true/true` (13-06). `tenants`, `tenant_features`, `event_outbox` and `idempotency_keys` in
   platform_db are all `false/false` — so platform-admin's own writes need no GUC, which is why the
   saga sets none for them and that is correct rather than a repeat of the bug.
2. **The one new write path sets the GUC the way the one beside it does.**
   `DELETE /internal/users/branches/{id}` requires `X-Tenant-Id` and calls the same `setTenantGuc`
   helper `createBranch` uses. That helper's load-bearing half is `tenantContext.set(...)`:
   `TenantAwareDataSource` writes the GUC with `is_local=false` at **connection checkout**, because
   Spring checks a connection out *before* `BEGIN` and a transaction-local `set_config` would be
   discarded by the `BEGIN` that follows. Mirroring the existing path exactly means whatever makes
   the create work makes the delete work.
3. **Every row is asserted over live HTTP against non-superuser roles.** `auth_user`,
   `user_service`, `platform_admin` and `finance_user` are all `rolsuper=false rolbypassrls=false`,
   verified in this session. The e2e script reads the branch, the assignment, the auth tenant, the
   outbox row and the chart of accounts as those roles, with the GUC set. A superuser-backed test
   cannot vouch for any of it; this can.

The compensating delete is proved the same way and not by reading the code: B2.9 forces a real
mid-saga failure and then asserts, as `user_service`, that the branch is absent from the live set
**and** present as soft-deleted.

## Two defects found while doing this, both required for the above to work

### 1. Feign's default client cannot send PATCH — the auth-tenant compensation could never run

`feign.Client.Default` is built on `HttpURLConnection`, whose method allow-list has never included
PATCH; it throws before a byte reaches the network. Spring Cloud OpenFeign would hand this to Apache
HttpClient 5 or the JDK HTTP2 client, but both need an adapter artifact (`feign-hc5` /
`feign-java11`) that is not on this classpath.

13-06 put the auth-side tenant status behind `PATCH /internal/auth/tenants/{id}/status`. **Found by
the forced-failure test**, which reported exactly what a manual-repair record is for:

```
[saga][MANUAL-REPAIR-REQUIRED] tenantId=26025601-… resourceKind=auth-tenant
    resourceId=26025601-… reason=RetryableException: Invalid HTTP method: PATCH
```

The repair machinery worked; the compensation did not. Fixed with a ~40-line `feign.Client` over the
JDK's `java.net.http.HttpClient` in `FeignSharedConfig` — **no new dependency**, because adding one
is a package install and `T-13-10-SC` does not permit that on a whim. Registered per-client via
`configuration = FeignSharedConfig.class`, so it affects only platform-admin-service's three
internal clients. Restricted headers (`content-length` and friends, which `HttpRequest.Builder`
refuses) are filtered; the read timeout stays per-request.

This also unblocks something larger: **propagating a platform suspension to auth-service was
impossible over Feign** before it, and tenant suspension is the platform's primary non-payment lever.

### 2. The temporary password would have been persisted in plaintext, indefinitely

The plan asked me to name the idempotency store and said "if it is Redis, say so explicitly". **It is
not Redis.** `DefaultIdempotencyService` is JPA-backed: `platform_db.idempotency_keys.response_json`,
a plain `text` column. The row carries `expires_at` — and **nothing in this codebase ever reads it**;
there is no purge job in any service. Serialising the credential into the stored result (which the
result record used to do) would have written a plaintext password into a relational table and left
it there forever, violating this plan's own prohibition.

So the two are split:

- the **durable** idempotency record holds identifiers only. `ProvisionResult.tempPassword` carries
  `@JsonIgnore`, so `toJson()` *cannot* emit it — structural, not a rule someone has to remember;
- the credential lives in **Redis** under `provisioning:temp-password:{idempotencyKey}` with a hard
  **3600-second TTL**, matching the idempotency window. A replay inside the window returns the same
  usable credential; a replay after it returns the tenant with a null password, which is correct for
  a one-time credential that has aged out.

**Residual exposure, named:** for one hour a Redis reader can see the credential of any tenant
provisioned in that window. That is `T-13-10-B` as the register anticipated it, minus the durable
half. The e2e asserts live that the password appears in **neither** the outbox payload nor
`idempotency_keys` — 13-06 recorded that outbox grep as owing; it is now paid.

## The compensation record format

Logged at ERROR under a fixed, greppable marker and carried on the thrown exception so it can be
asserted rather than scraped:

```
[saga][MANUAL-REPAIR-REQUIRED] tenantId=<uuid> resourceKind=<kind> resourceId=<id> reason=<class>: <message>
```

`resourceKind` is one of `admin-user`, `auth-tenant`, `branch`, `tenant-features` — the four
compensable steps, run in reverse. `ProvisioningException.manualRepairs()` returns them as
`ManualRepairRecord(tenantId, resourceKind, resourceId, reason)`, never null. A compensation failure
does **not** abort the remaining compensations: the branch still gets cleaned up when revoking the
admin's role failed.

**It is not persisted to a table.** This plan adds no migration and platform_db has no repair-log
table. Named limitation, not an oversight — the record is complete enough for an operator to act on,
and a table for it belongs with whoever exposes the retry endpoint.

## What I did not touch, and why

**auth-service was not edited** (13-09 is working in it concurrently). The plan's "call an
auth-service internal deactivation" has no endpoint to call — there is no internal user-deactivation
path. Rather than add one, compensation uses two that already exist and together mean the same thing
for a login:

- `DELETE /internal/auth/users/{id}/branch-roles` revokes the admin's only assignment, so
  `PermissionResolver` refuses it — the exact failure B2 is about, aimed deliberately;
- `PATCH /internal/auth/tenants/{id}/status` → `PROVISIONING_FAILED`, so `AuthServiceImpl.login`
  refuses the whole tenant.

Both are idempotent at the producer (`revoke` is `ifPresent`; `setStatus` is a plain update), which
matters because a compensating action is retried. **If you want a true `users.is_active=false`
internal endpoint on auth-service, that is the one thing I would have added there and did not.**

**No Feign `ErrorDecoder` was added.** The prompt flagged that `400 UNKNOWN_ROLE_CODE` reaches
callers as `500`. That is about platform-admin's *outward* response (`ProvisioningException` is
unmapped, so shared-lib's catch-all renders 500); **in-process the status is not lost** — Feign's
default decoder throws `FeignException.Conflict` / `.BadRequest` carrying `status()` and the body.
Nothing in my compensation branches on status, so a decoder would be scope without a purpose. It
does mean the e2e's collision case asserts "not 2xx" and observes 500; mapping `ProvisioningException`
to a 409/422 is a worthwhile follow-up and belongs with whoever exposes retry.

## Task-by-task

### Task 1 — the four silent defects (D-06, D-07, D-09, request shape)

**RED, measured: 9 run, 6 real failures.** Five of them were `404`/`500` from finance — because
moving the seed-coa key to its correct prefix left the old unprefixed test property binding nothing,
so the flag defaulted to `true` and the saga started calling a service the tests had never stubbed.
That is the cleanest possible demonstration that the key was inert: the *test suite's* control over
it vanished the moment the production binding was corrected.

The base class's branch stub returned `{"data":{"id":…}}` — **it mirrored the defect**, which is why
the suite agreed with the bug and disagreed with production. Corrected to the producer's real shape,
and a second stub keeps the old enveloped form as the "unparseable" case, so the deleted fallback's
exact input is now the input that must abort.

### Task 2 — the tenant you can log into (D-04, D-05, D-08, D-10)

Step order is `branch → auth tenant → admin`. The auth tenant before the admin is the plan's
requirement; the branch before the auth tenant is mine, and deliberate: it makes a slug collision
land *after* something compensable exists, which is what gives B2.9 a real branch to clean up.

`requireBranchId` and `requireAdminData` both throw rather than substitute. The second is beyond the
plan's list (Rule 2): the old `extractTempPassword` returned the literal string `"(see admin)"` when
it could not read one, which would now be *returned to the SuperAdmin as a password* — a tenant
reported ready that nobody can log into, which is the exact prohibition.

`ProvisioningSagaIT`: **6 → 14**, every new case forcing the failure it claims to handle.

### Task 3 — SC2 proved live (D-30)

`scripts/e2e/phase13-provisioning-e2e.sh`, 27 assertions, all through `${GATEWAY}`.

**Two harness bugs found and fixed rather than explained away:**

1. **The provisioning POST is not retried on a 503.** `curl_retry`'s blind retry is right for a GET
   and wrong here: the gateway answers 503 both when a request never arrived *and* when the backend
   exceeds the route's time limiter, and provisioning is a six-step saga across four services. On
   the first run it was the latter — the saga was in flight, went on to register the auth tenant,
   and the "retry" provisioned a **second** tenant that collided with the first one's slug. A
   harness that manufactures the failure it is meant to detect is worse than none. The cold-pool
   case is now handled by warming the route first, which removes the ambiguity instead of hiding it.
2. **Bodies are built straight from python, never `json("$( … )")`.** Nesting a command substitution
   containing a dict literal lets bash brace-expand it before python sees it; the first run reported
   a confident authentication failure for a request that was never valid. Same class of bug 13-02
   and 13-07 recorded.

**I verified the harness can fail, twice, and one of them is also a production assertion.** With
`GATEWAY` at a dead port: **exit 1**, trap still cleaned up. And with platform-admin restarted under
`PROVISIONING_SEED_COA_ENABLED=false`: **26 PASS / 1 FAIL, exit 1**, failing precisely on
`[B2.7] no chart of accounts`. That is D-09 proved *in production* rather than only in a test — the
operator's setting was inert before this plan and now governs behaviour. Restored afterwards and
re-verified at 27/0.

Cleanup runs in an `EXIT` trap **and** at start-up, across four databases. Verified afterwards: 0
rows left behind in `platform_db.tenants` and `auth_db.auth_tenants`.

## Verification actually run

Every number is from a command executed in the state being reported, with `JAVA_HOME=openjdk@25`,
`TESTCONTAINERS_RYUK_DISABLED=true`, `TESTCONTAINERS_HOST_OVERRIDE=192.168.64.2`.

| Suite | Result |
|---|---|
| `mvn -pl services/platform-admin-service -am verify` | **BUILD SUCCESS** |
| ├ platform-admin ITs | **50/50** (was 40; `ProvisioningSagaIT` 6 → 14) |
| │  ├ `ProvisioningSagaIT` | **14/14** |
| │  ├ `PlatformAuthIT` | 18/18 |
| │  ├ `PlatformDbIsolationIT` | 9/9 |
| │  ├ `TenantLifecycleIT` | 6/6 |
| │  └ `FeatureFlagInvalidationIT` | 3/3 |
| ├ platform-admin unit (`FeatureCodeClosureTest`) | 4/4 |
| └ shared-lib | unit **38/38**, IT **11/11** |
| `mvn -pl services/user-service -am verify` | **BUILD SUCCESS** — unit 3/3, IT **11/11** |
| `bash scripts/e2e/phase13-provisioning-e2e.sh` | **27 PASS / 0 FAIL, exit 0** ×3 consecutive |
| same, `GATEWAY` at a dead port | **exit 1** — the harness can fail |
| same, `PROVISIONING_SEED_COA_ENABLED=false` | **26/1, exit 1** on B2.7 — the flag binds in production |
| `scripts/e2e/phase13-auth-provisioning-seam-e2e.sh` (13-06) | **20 PASS / 0 FAIL, exit 0** |
| `scripts/e2e/phase13-superadmin-e2e.sh` (13-05) | **21 PASS / 0 FAIL, exit 0** |
| `scripts/e2e/phase13-forced-change-e2e.sh` (13-08) | **25 PASS / 0 FAIL, exit 0** |
| `scripts/e2e/phase13-feature-gating-e2e.sh` | **11 PASS / 0 FAIL, exit 0** |
| `scripts/e2e/phase13-role-catalog-e2e.sh` | **26 PASS / 2 FAIL** — the known 13-12 red, unchanged |
| `opa test policies/` | **139/139** (no `.rego` touched) |
| Live RLS posture | `branches`, `chart_of_accounts`, `accounting_periods` true/true; platform_db tables false/false |
| Live role posture | `auth_user`, `user_service`, `platform_admin`, `finance_user` all NOSUPERUSER NOBYPASSRLS |
| Demo tenant after all runs | `demo:ACTIVE`, `test:ACTIVE` in both platform_db and auth_db — unaffected |
| `detect_changes` before committing | 19 files, 114 symbols, **0 affected processes, risk LOW** |

`detect_changes`'s 19 files include 13-09's uncommitted auth-service work, which is not this plan's.

### Human-check (task 3)

Every process is newer than its jar: platform-admin jar 02:27 / process 02:47; user-service jar
02:30 / process 02:32; finance-service restarted 02:41 on its untouched jar. auth-service and the
gateway were **not** restarted — auth-service already carried 13-06's endpoints (verified by a live
200 from `POST /internal/auth/tenants` before any change), and 13-09 is working in it concurrently.
The trap removed both test tenants; verified 0 rows remaining.

### GitNexus impact, run before editing (per CLAUDE.md)

| Target | Upstream | Risk |
|---|---|---|
| `ProvisioningService` (platform, disambiguated by uid — the bare name resolves to finance-service's) | 4 | **LOW** |
| `PlatformAdminController` | 0 | LOW |
| `BranchService` (user-service) | 4 | LOW |
| `BranchInternalController` | 0 | LOW |

0 affected processes on every one; nothing HIGH or CRITICAL, so no warning was owed. The LOW on
`ProvisioningService` understates it in the same way 13-01's and 13-06's results did — this method
is the only writer of three databases it does not own — so it was treated accordingly: every new
step got a compensating action, and every one of those was proved by forcing its failure.

The index is stale (last built at `5fba4a9`). Not refreshed, for the reason 13-01 through 13-06 all
gave: `gitnexus analyze` rewrites `CLAUDE.md`, `AGENTS.md` and six skill files, which 13-01 had to
revert.

## Deviations from plan

**1. [Rule 3 — blocker] A `feign.Client` over the JDK HTTP client.** Not in the plan's file list.
Without it the auth-tenant compensation cannot execute at all, which fails the plan's own acceptance
criterion. Full detail above. No dependency added. Commit `4b41faf`.

**2. [Rule 2 — security] The temp password no longer reaches the durable idempotency record.** The
plan told me to name the store and accept the exposure; naming it revealed it was Postgres with no
purge, i.e. permanent, which the plan's own prohibition forbids. Split to Redis with a TTL. Commit
`4b41faf`.

**3. [Rule 2 — correctness] `requireAdminData` aborts when no credential comes back**, instead of the
old `"(see admin)"` placeholder. That placeholder would now be returned to the caller *as the
password*. Commit `4b41faf`.

**4. [Rule 1 — bug, adjacent] `ProvisioningService.retry` now takes an admin email.** It passed the
literal `"(retry)"`, which the extended `provision-admin` would turn into an account named
`(retry)`. It has no caller and no endpoint. A second defect in it is **recorded and deliberately
not fixed**: `provision()` always constructs a new `TenantEntity`, so retry produces a duplicate
tenant with a `-1` slug. Whoever exposes it must fix that first; there is nothing to regress
meanwhile. Commit `4b41faf`.

**5. [Scope — file list] `services/platform-admin-service/src/main/resources/application.yml` was
listed as modified and was not touched.** Its key was already `restaurantos.provisioning.seed-coa.
enabled`; the defect was the `@Value` reading an unprefixed key, plus the *test* yaml agreeing with
the wrong one. Both corrected instead.

**6. [Scope — file list] Three test files beyond the plan's list.** `BasePlatformIT` (the branch stub
mirrored the defect; plus the new stubs), and `TenantLifecycleIT` / `FeatureFlagInvalidationIT`,
which broke because each had hand-rolled its own partial stub set for `provision()`. The saga's stub
set now lives in one base-class helper, so the next saga step is added once rather than silently
missed by whichever class happens to drive the saga for its own setup.

**7. [Out of plan scope] finance-service was restarted.** It was found in the wedged state 13-05
documented — `/actuator/health` in 21ms while every other path hung indefinitely; `seed-coa` never
returned and the first e2e run timed out at the gateway because of it. After the restart the same
call takes **0.17–0.26s**. Not diagnosed further: it is not this plan's code and the operator's
standing instruction is to restart. user-service and platform-admin-service were rebuilt and
restarted for the human-check. **auth-service and the gateway were deliberately left alone** — 13-09
is working in auth-service concurrently.

**8. [Reporting]** `ProvisioningSagaIT`'s `Tests run: 0` display artifact on the outer class was left
alone as instructed; the counts reconcile (14 reported against the nested class, all 14 executing).

## Known stubs

None. Every symbol this plan created is wired and exercised — by an integration test that forces the
failure it handles, by a live HTTP assertion, or both.

## Threat flags

None beyond the plan's register. Where each entry is closed:

- **T-13-10-A** (password in the response) — returned once over the authenticated SuperAdmin route;
  asserted live to be absent from every event payload and from `idempotency_keys`. Both the DTO and
  the result record carry javadoc marking it out-of-band material, and both override `toString()` to
  redact it so an accidental log line cannot leak it.
- **T-13-10-B** (password in the idempotency cache) — **materially reduced, not merely accepted.**
  It is out of the durable store entirely (`@JsonIgnore`, structural) and in Redis under a 3600s
  TTL. Residual exposure named above.
- **T-13-10-C** (fabricated aggregate id) — fallback deleted; an unreadable response aborts; asserted
  live that `event_outbox.branch_id` equals the `branches` row, and by IT that nothing downstream of
  the branch step runs when the id cannot be read.
- **T-13-10-D** (tenant provisioned into a locked-out state) — the auth tenant row and the OWNER
  assignment are saga steps with compensation; the live script carries the admin all the way to a
  token with 65 permissions and a 200 from a tenant-scoped endpoint.
- **T-13-10-E** (unnamed orphans) — `ManualRepairRecord`, format above, asserted by a test that
  forces a compensating call to fail.
- **T-13-10-F** (the provisioning endpoint) — unchanged: `@PreAuthorize("hasAuthority('SUPER_ADMIN')")`
  behind 13-01/13-05's rate-limited platform route. 13-05's script asserts a tenant token is refused
  403 there; not re-asserted here.
- **T-13-10-G** (slug collision) — the auth registration runs before user creation; the live negative
  case forces exactly this and asserts no orphaned active branch and no orphaned admin.
- **T-13-10-SC** — **no package of any kind was installed**, in any ecosystem. The PATCH problem was
  solved with the JDK rather than with `feign-hc5` specifically to keep it that way, and the TOTP
  helper in the script is pure stdlib for the same reason.

## Self-Check: PASSED

`scripts/e2e/phase13-provisioning-e2e.sh` exists on disk. All 3 commits exist in `git log`:
`bf016c2`, `4b41faf`, `65b2f12`.
