# Authorization & Audit — Current-State Research

**Researched:** 2026-08-07
**Branch at time of research:** `phase-13-access-repair` (HEAD `5fba4a9`)
**Domain:** RBAC (permission claims + Spring method security), ABAC (OPA/Rego), audit trail (event-sourced `audit_events`), role-driven UI visibility
**Confidence:** HIGH for everything marked `[VERIFIED]` (proved against the running Postgres/OPA/RabbitMQ stack or by exhaustive source scan); MEDIUM/LOW where noted

---

## Summary

The authorization system is **two independent systems that were built to compose and never were wired to**. RBAC is real and broadly enforced: 182 `@PreAuthorize` annotations across 10 services, backed by a 65-permission catalog with 232 grants, and `PermissionCatalogClosureTest` mechanically prevents the "enforced code that no role holds" defect class that caused five prior outages. ABAC is **not** a peer layer — it is enforced at exactly **10 call sites in 5 services**, and 4 of the 8 Rego policy modules have rules that are evaluated by no code path at all. There is no defined composition order because in most of the system only one of the two layers is present.

The audit trail is **empty**. Not sparse — empty. `audit_db.audit_events` contains **0 rows** while `auth_db.event_outbox` alone holds 1,173 SENT events including 898 successful logins and 110 failed ones, and `audit.all-events.queue` holds a **1,809-message backlog with 0 consumers**. Two independent, statically provable defects guarantee it would stay near-empty even with the consumer running: (a) `DomainEventPublisher` hard-codes `source = "shared-lib"` on every event, so `AuditIngestionService.ALWAYS_AUDIT_SOURCES = {auth-service, platform-admin-service}` can never match; and (b) 4 of the 8 event types in the explicit allow-list (`RBAC_CHANGED`, `IMPERSONATION_STARTED`, `VOID_CREATED`, `REFUND_CREATED`) are published by **no service** — POS actually emits `ORDER_VOIDED`/`ORDER_REFUNDED`. Separately, the only audit **read** API cannot work: `audit_writer`, the runtime DB role, has `INSERT` and no `SELECT` — proved live with `ERROR: permission denied for table audit_events`. And `user-service` — the service that creates users, deactivates them, and grants/revokes roles — publishes **no events at all**, so the single most important category of security event produces no record anywhere in the system.

Role-visible functionality is the healthiest of the three. The sidebar is genuinely permission-driven (`use-nav-visibility.ts` composes permission ∧ feature ∧ role). Its defects are UX gaps, not security gaps — MANAGER and ACCOUNTANT hold real `hr.*` permissions but the HR nav item is still hard-gated to `roles: ["OWNER","TENANT_ADMIN"]` — with one exception: the platform (SuperAdmin) nav gates on `platform:tenant:read` / `platform:admin`, permission codes that exist in **no token and no catalog**, and the config is imported by nothing anyway.

**Primary recommendation:** Treat this as three separable workstreams with different risk profiles. (1) **Repair the audit pipeline first** — it is the only area where a *correctness* fix (not a design change) converts a completely non-functional subsystem into a working one, and every other finding becomes verifiable once there is a log. (2) **Define the RBAC/ABAC composition contract explicitly** — "`@PreAuthorize` answers *may this role ever*; OPA answers *may this principal, on this resource, now*" — then close the ABAC coverage gap service by service, starting with hr-service (encrypted PII, cross-branch readable today). (3) **Fix the four dead permissions/roles and the nav drift** as low-risk cleanup.

---

## Verification of the claims in the brief

Every number the brief asked me to verify, checked against the live stack rather than the source.

| Claim | Verdict | Evidence |
|---|---|---|
| 65 permissions, 232 grants | **CONFIRMED** | `SELECT count(*) FROM permissions` → 65; `FROM role_permissions` → 232. Per-role: OWNER 65, TENANT_ADMIN 64, MANAGER 49, ACCOUNTANT 24, CASHIER 14, WAITER 7, INVENTORY_MANAGER 5, FINANCE_VIEWER 2, KITCHEN_STAFF 2 (sums to 232). `[VERIFIED: live auth_db]` |
| 139 Rego tests, 100% coverage | **CONFIRMED** | `opa test /policies` → `PASS: 139/139`; `--coverage` → `covered_lines: 781, not_covered_lines: 0, coverage: 100`. OPA 1.17.1, Rego v1. `[VERIFIED: opa 1.17.1]` |
| `hr.rego` exists and is enforced nowhere | **CONFIRMED** | 28 tests in `policies/tests/hr_test.rego`; `hr-service/src/main` contains **zero** references to `OpaClient`, `AuthorizationService`, or any authorization Feign client. `[VERIFIED: exhaustive grep]` |
| `OpaTimeoutFailClosedIT` proves 2 s fail-closed | **PARTIALLY — see below** | It points OPA at `http://127.0.0.1:1` (`OpaTimeoutFailClosedIT.java:79`), an unreachable port that yields **connection-refused instantly**. It proves fail-closed on *connection failure*, not on a slow or hung OPA, and it exercises only `authorization-service` — the one service that actually sets a read timeout. `[VERIFIED: source]` |
| `AuditImmutabilityIT` exists | **CONFIRMED, but narrow** | It runs the Spring datasource as the Testcontainers **superuser** (`r.add("spring.datasource.username", POSTGRES::getUsername)`), and asserts `has_table_privilege` for UPDATE/DELETE only. It never asserts SELECT and never exercises the read controller — which is why the broken read path is invisible to it. `[VERIFIED: source]` |
| `X-Impersonated-By` propagation exists in the gateway | **CONFIRMED, and read by nobody** | Injected at `JwtGlobalFilter.java:226-228`. Exhaustive grep: **no service reads that header**. nlq-service records impersonation but sources it from `JwtClaims.impersonatedBy()`, not the header. `[VERIFIED: exhaustive grep]` |
| `/api/v1/platform/**` reachability (audit blocker B1) | **FIXED** | `JwtAuthenticationFilter.toAuthorities()` now unions `permissions` ∪ `roles` (`JwtAuthenticationFilter.java:115-122`), and `signPlatformToken` emits `SUPER_ADMIN` in both claims (`JwtSigningService.java:103-104`). |
| TENANT_ADMIN could assign itself OWNER | **FIXED** | `RoleCeiling.requireAssignable` / `requireMayAdminister` recompute the acting user's permissions server-side and are called from both read and write paths. |

---

## Part 1 — RBAC: current state

### 1.1 Where authorities come from

`shared-lib/.../security/JwtAuthenticationFilter.java:115-122` is the **single** place Spring authorities are derived, as a `LinkedHashSet` union of the `permissions` and `roles` claims. This is the correct invariant and it is documented as such in the file. The gateway (`gateway/.../filter/JwtGlobalFilter.java:263-292`) parses the same claims independently with Nimbus, but does **not** derive authorities — it only validates the signature and injects `X-Tenant-Id`, `X-User-Id`, `X-TOTP-Verified`, and optionally `X-Impersonated-By`. There is no permission enforcement at the edge; the gateway is an authentication boundary only.

### 1.2 Role → permission matrix `[VERIFIED: live auth_db]`

| Role | Permissions | Notes |
|---|---:|---|
| OWNER | 65 / 65 | Holds the entire catalog, including `rbac.manage` |
| TENANT_ADMIN | 64 / 65 | Everything **except** `rbac.manage` — a deliberate split (see §1.5) |
| MANAGER | 49 | No `finance.journal.*`, no `finance.coa.manage`, no `rbac.*`, no `branch.manage`, no `hr.employee.manage`, no `hr.payroll.approve` |
| ACCOUNTANT | 24 | Full finance + `hr.payroll.run/view` + `hr.employee.view` + reporting + `nlq.query.run` |
| CASHIER | 14 | POS order/till + `crm.customer.manage` + `pos.order.void.own` |
| WAITER | 7 | `pos.order.{create,update,view,send_to_kds}`, `pos.tables.manage`, `pos.menu.view`, `pos.kds.view` |
| INVENTORY_MANAGER | 5 | `inventory.item.{view,manage}`, `vendor.{view,po.create,grn.receive}` |
| KITCHEN_STAFF | 2 | `pos.kds.{view,update}` |
| **FINANCE_VIEWER** | 2 | **ORPHAN — see GAP-R1** |

`SUPER_ADMIN` is not in this table: it is a *platform* role from `platform_db.platform_users`, minted by `JwtSigningService.signPlatformToken` into both claims, and gated only by two class-level `@PreAuthorize("hasAuthority('SUPER_ADMIN')")` annotations in platform-admin-service.

### 1.3 Permission → endpoint enforcement `[VERIFIED: exhaustive AST-ish scan of services/*/src/main]`

182 `@PreAuthorize` annotations, distributed:

| Service | `@PreAuthorize` | Controllers | Enforcement model |
|---|---:|---:|---|
| pos-service | 49 | 7 | RBAC on every REST endpoint + OPA for void/refund |
| hr-service | 39 | 11 | **RBAC only — no ABAC** |
| purchasing-service | 32 | 10 | RBAC + OPA (via Feign) for PO approve/short-close |
| finance-service | 29 | 9 | RBAC + OPA (via Feign) for expense approve only |
| user-service | 13 | 3 | RBAC only |
| crm-service | 11 | 4 | RBAC only |
| reporting-service | 4 | 2 | RBAC only |
| auth-service | 2 | 13 | RBAC on the role/permission catalog; `/internal/**` uses a shared secret |
| platform-admin-service | 2 (class-level) | 5 | `SUPER_ADMIN` authority |
| nlq-service | 1 | 1 | RBAC only |
| **inventory-service** | **0** | 17 | **OPA only** (all 39 non-internal endpoints call `InventoryAuthorizationService`) |
| **kitchen-service** | **0** | 1 | **OPA only** (7 calls across 6 endpoints) |
| **file-service** | **0** | 1 | **Neither — `authenticated()` only. GAP-A4** |
| **audit-service** | **0** | 1 | Internal shared-secret only |
| authorization-service | 0 | 1 | Internal shared-secret + `authenticated()` |
| notification-service | 0 | 0 | n/a |

Per-service HTTP-layer rules are consistent (`anyRequest().authenticated()` with narrow `permitAll` for `/internal/**`, `/actuator/**`, and two WebSocket prefixes). `@EnableMethodSecurity` is present on all 14 services that have a `SecurityConfig` except **audit-service** — which is correct, since it has no user-facing endpoints — and notification-service, which has no controllers.

### 1.4 Permissions that gate nothing `[VERIFIED: set difference]`

Union of every permission code appearing in a `has(Any)Authority(...)` SpEL (59) and every code appearing in a Rego `has_permission(input, "…")` (32) = 63 distinct. Set difference against the 65-code catalog:

| Permission | Held by | Reality |
|---|---|---|
| `pos.till.reconcile.override` | MANAGER, OWNER, TENANT_ADMIN | **Zero references anywhere in `src/main`.** A permission that grants nothing. |
| `pos.order.view.all` | MANAGER, OWNER, TENANT_ADMIN | *False positive.* Enforced as a plain claims check via `PosAuthorizationService.hasPermission()` at `OrderServiceImpl.java:616`, not SpEL. Working as intended. |

The reverse direction (enforced-but-undeclared) is **empty**, and is mechanically protected by `services/auth-service/src/test/java/io/restaurantos/auth/PermissionCatalogClosureTest.java`. That test is the single best piece of authorization infrastructure in this repo and its docstring is an accurate history of the defect class.

### 1.5 The `rbac.manage` / TOTP interaction

`AuthServiceImpl.requiresTotpStepUp` (`AuthServiceImpl.java:384-390`) triggers step-up when the user holds `rbac.manage`, `finance.period.close`, or `hr.payroll.approve`. TENANT_ADMIN deliberately does **not** hold `rbac.manage` (changeset `055`) so that tenant admins are not forced into TOTP — but TENANT_ADMIN **does** hold `finance.period.close` and `hr.payroll.approve`, so step-up is triggered anyway. The comment at `AuthServiceImpl.java:373-377` states this explicitly and is correct. Net effect: withholding `rbac.manage` from TENANT_ADMIN buys nothing operationally (they still get challenged) and costs one real capability (`rbac.rego`'s first `allow` rule, and `RoleCatalogController`'s `ADMINISTRATION_GATE`, both of which also accept `rbac.user.manage`, so no actual loss). Worth revisiting as a design question, not a defect.

---

## Part 2 — ABAC: policy → enforcement point

### 2.1 The enforcement map `[VERIFIED: exhaustive grep of `.authorize(` and `OpaClient` in `src/main`]`

There are exactly **two** ways a service reaches OPA:

* **Direct** — inject `shared-lib`'s `AuthorizationService` (needs `restaurantos.opa.url` set, per `SharedAutoConfiguration.java:163`). Used by pos, inventory, kitchen.
* **Indirect** — Feign `POST /internal/authorize` to authorization-service. Used by purchasing, finance.

Everything else reaches OPA never.

| Rego module | Rule (action) | Enforcement point | Live? |
|---|---|---|---|
| `common.rego` | helpers | imported by all 7 policy modules | ✅ |
| `pos.rego` | `void.own` / `void.any` (action `void`) | `PosAuthorizationService.authorizeVoid` → `OrderServiceImpl.java:662` | ✅ |
| `pos.rego` | `pos.order.refund` | `PosAuthorizationService.authorizeRefund` → `RefundServiceImpl.java:88` | ✅ |
| `pos.rego` | `pos.order.discount.override` | **none** | ❌ **dead letter** |
| `pos.rego` | `pos.order.split_bill` | **none** (RBAC-only via `PaymentController.java:91`) | ❌ **dead letter** |
| `inventory.rego` | `inventory.item.view` / `.manage` | `InventoryAuthorizationService` — called on **all 39** non-internal endpoints across 14 controllers | ✅ |
| `kds.rego` | `pos.kds.view` / `.update` | `KdsAuthorizationService` — called on all 6 `KdsController` endpoints | ✅ |
| `vendor.rego` | `approve_po` | `PoApprovalService.java:105` (Feign) | ✅ |
| `vendor.rego` | `close_po` | `PurchaseOrderService.java:236` (Feign), short-close only | ✅ |
| `vendor.rego` | `manage` | **none** (RBAC-only: `vendor.manage` × 7 `@PreAuthorize`) | ❌ **dead letter** |
| `finance.rego` | `approve` (expense) | `ExpenseService.java:159` (Feign) | ✅ |
| `finance.rego` | `close_period` | **none** | ❌ **dead letter** |
| `finance.rego` | `view_coa` / `manage_coa` | **none** | ❌ **dead letter** |
| `finance.rego` | `view_journal` / `post_journal` / `reverse_journal` | **none** | ❌ **dead letter** |
| `hr.rego` | **all 9 actions** | **none — hr-service has no OPA client of any kind** | ❌ **dead letter** |
| `rbac.rego` | all 4 rules | **none — no caller evaluates module `rbac`** | ❌ **dead letter** |

**Score: 6 of 22 policy rules are reachable at runtime. 16 are dead letters, covering 4 entire modules (`hr`, `rbac`, and the majority of `finance` and `vendor`).**

All 139 tests pass against all 22 rules. Policy test coverage measures the *policy*, not the *system*; 100 % Rego coverage and 27 % runtime reachability are entirely consistent, which is exactly the trap the brief warns about.

### 2.2 Concrete consequence of a dead `hr.rego` `[VERIFIED: source]`

`hr.rego` demands `same_tenant_and_branch` on every action. hr-service enforces branch only where a developer happened to write it:

* `EmployeeService.list()` → `repository.findAllByBranchId(requireBranch())` — branch-scoped ✅
* `EmployeeService.load(id)` → `repository.findByIdAndTenantId(id, requireTenant())` — **tenant-scoped only** ❌

So `GET /api/v1/hr/employees/{id}`, `PUT …/{id}`, and the deactivate path resolve any employee in the tenant regardless of branch. The employee record carries AES-256-GCM-encrypted CNIC and bank account (masked on read, so this is not a PII dump) plus `basicSalaryPaisa` in the clear. A MANAGER at Branch A can read and modify a MANAGER's salary at Branch B. `hr.rego` would have refused this on every one of its 9 actions. This is the single clearest demonstration in the codebase of what "a policy enforced nowhere" costs.

### 2.3 OPA failure semantics — fail-closed, but not uniformly `[VERIFIED: source]`

| Path | Timeout | On failure |
|---|---|---|
| authorization-service (`OpaConfig.java:19-34`) | **connect 2 s + read 2 s**, `@Primary` | `DefaultOpaClient` throws `PermissionDeniedException`; `AuthorizeService.java:43-45` catches it and returns `allow:false`, HTTP 200 |
| pos / inventory / kitchen (`SharedAutoConfiguration.java:163-166`) | **none** — `RestClient.builder().baseUrl(opaUrl).build()` | `DefaultOpaClient` throws `PermissionDeniedException` → 403. Fail-closed **if it ever returns** |
| purchasing / finance (Feign) | Feign defaults | Non-`allow` → `ApprovalLimitExceededException`. A Feign transport exception propagates as a 5xx — closed in effect, wrong status code |

**The 2-second budget in AUTHZ-04 holds only inside authorization-service.** The three services that talk to OPA directly have no read timeout, so a hung (as opposed to refused) OPA blocks a Tomcat worker indefinitely. `OpaTimeoutFailClosedIT` cannot detect this: it tests the one service that *does* set a timeout, and it uses connection-refusal rather than a slow responder.

### 2.4 The dual gate on `/internal/authorize` — verified sound

`authorization-service/config/SecurityConfig.java:44-47` requires `.authenticated()` **and** the `X-Internal-Service` secret. Both `FeignClientConfig`s (purchasing, finance) forward the end user's bearer token (`forwardCallerJwt`). The design is right: a service credential cannot authorize a user action. Both files carry an accurate post-mortem of the outage caused by omitting the forward.

---

## Part 3 — The fusion (RBAC × ABAC)

### 3.1 What actually happens today

There is **no defined composition order**, because in 12 of 16 services only one layer exists.

Where both exist, the pattern is: Spring method security runs first (`@PreAuthorize` on the controller), then the service layer calls OPA. Both must pass — logical AND, RBAC first. Concretely, only three flows have both:

| Flow | RBAC gate | ABAC gate |
|---|---|---|
| POS void | `@PreAuthorize("hasAnyAuthority('pos.order.void.own','pos.order.void.any')")` | `pos.rego` — owner + status + tenant + branch |
| POS refund | `@PreAuthorize("hasAuthority('pos.order.refund')")` | `pos.rego` — tenant + branch + `approval_limit_paisa` |
| PO approve | `@PreAuthorize("hasAuthority('vendor.po.approve')")` | `vendor.rego` — tenant + branch + `approval_limit_paisa` |

Expense-approve is OPA-only at the service layer plus `@PreAuthorize("hasAuthority('finance.expense.approve')")` at the controller — same shape. Inventory and KDS are **ABAC-only** (no `@PreAuthorize` at all), which works because the Rego rules re-check `has_permission` themselves — the permission check is inside the policy. That is the one place the two layers are genuinely fused rather than stacked.

### 3.2 Does one shadow the other?

**Yes, in one direction and it matters.** Because `common.has_permission` re-tests the permission claim inside Rego, an OPA-gated path is strictly stronger than the equivalent `@PreAuthorize`. So:

* Adding OPA to an RBAC-gated endpoint can only *narrow* access → safe, incremental.
* Removing `@PreAuthorize` from an OPA-gated endpoint is safe **only** if the Rego rule tests the permission — which all 22 current rules do.
* An RBAC-only endpoint is **strictly weaker** than the policy that was written for it. Every dead-letter rule in §2.1 is an endpoint running at the weaker level while a stronger policy sits unused and 100 %-tested.

The `attributes` claim (`approval_limit_paisa`) is **only** readable by OPA — `@PreAuthorize` never inspects it. So every amount-bounded authority in this system (expense approve, PO approve, POS refund) is enforceable *only* through the ABAC layer. There is no RBAC fallback for them. `finance.rego`'s `close_period` being dead means period close is bounded by nothing but a permission code and a TOTP header.

### 3.3 Recommended target design

> **Contract.** `@PreAuthorize` answers *"may a principal holding this role ever perform this class of action?"* — a coarse, static, resource-independent gate. OPA answers *"may **this** principal perform **this** action on **this** resource **now**?"* — tenant, branch, ownership, status, amount, time. Both must pass. RBAC first (cheap, no network). OPA is authoritative for anything resource-scoped.

Four rules that follow from it:

1. **Every endpoint carries a `@PreAuthorize`.** Including inventory and kitchen, which today have none — an OPA outage there currently means a 403 from an exception rather than a deny from a policy, and there is no cheap first gate. Cost: 45 annotations, zero behaviour change.
2. **Every write to a tenant- or branch-scoped resource calls OPA.** This is the whole content of the ABAC gap. Reads follow where the policy already exists (`hr.rego`, `finance.rego` both cover reads).
3. **One OPA client configuration.** Move the 2 s connect+read timeout from `authorization-service/config/OpaConfig.java` into `SharedAutoConfiguration.opaClient` so a direct-OPA service cannot be built without it. The `@Primary` override in authorization-service then becomes redundant and should be deleted rather than left as a second source of truth.
4. **Choose one integration style per service and record it.** Direct-OPA (pos/inventory/kitchen) is lower-latency; Feign-to-authorization-service (purchasing/finance) centralises the policy bundle version. Both are defensible; having both *undocumented* is how finance-service ended up with a hand-written `AuthorizationClient` whose javadoc explains it exists because `restaurantos.opa.url` was not set.

A fifth, larger question the planner should surface to the user rather than assume: **should `common.rego` gain a `default deny` shim that services call for every request** (a single `restaurantos/authz/allow` entry point taking `module` + `action`), instead of 22 module-specific rules each re-implementing `has_permission ∧ same_tenant_and_branch`? That would make "add a new endpoint" a policy edit rather than a Java edit, and would make dead letters impossible by construction. It is also a rewrite of all 8 policy files and all 139 tests. `[ASSUMED — architectural preference, needs user decision]`

---

## Part 4 — Audit

### 4.1 What exists

* **Table** `audit_db.audit_events` — RANGE-partitioned by `occurred_at`, 13 monthly partitions through 2027-01, columns `id, tenant_id, branch_id, user_id, action, resource_type, resource_id, before_state, after_state, ip_address, user_agent, occurred_at, metadata`. `[VERIFIED: live audit_db]`
* **Immutability** — trigger `audit_events_immutable BEFORE UPDATE OR DELETE … EXECUTE FUNCTION prevent_audit_mutation()` (`011-audit-immutability-trigger.xml`) plus a privilege layer: `audit_writer` has `INSERT` **only**. Two layers, and the privilege layer alone is sufficient. `[VERIFIED: live audit_db]`
* **Ingestion** — `AllEventsConsumer` on `audit.all-events.queue`, bound `#` to all 9 topic exchanges; idempotent via `processed_events`; tenant-aware via `TenantAwareMessageProcessor`; writes with `entityManager.persist()` + `flush()` (the fix for the `merge()`-triggered SELECT that `audit_writer` cannot do).
* **Read API** — `GET /internal/audit/events?tenantId=&from=&to=&page=&size=`, gated by `InternalServiceFilter` (constant-time secret compare).
* **Retention** — `AuditArchivalService`, monthly cron, detaches partitions older than 7 years.

### 4.2 What is broken — four independent defects, all statically or empirically proved

**AUD-1 — the log is empty. `[VERIFIED: live]`**
```
audit_db:  SELECT count(*) FROM audit_events            → 0
auth_db:   SELECT status,count(*) FROM event_outbox     → SENT 1173, PENDING 1
rabbitmq:  audit.all-events.queue                       → 1809 messages, 0 consumers
```
Zero rows against 1,173 delivered events and an 1,809-message backlog. audit-service is listed in `.dev-pids.json` and has a Dockerfile built in CI (`.github/workflows/ci.yml:270`) but is **not** a service in `deploy/docker-compose.yml` (that file is infrastructure only) and was not running during this research.

**AUD-2 — `ALWAYS_AUDIT_SOURCES` can never match. `[VERIFIED: source + live]`**
`AuditIngestionService.java:44-47` audits every event whose `source` is `auth-service` or `platform-admin-service`. `DomainEventPublisher.java:41` hard-codes `"shared-lib"` as the source on **every** event, and `OutboxEntry.setSource("shared-lib")` on line 55. Live confirmation across three databases: every single `event_outbox` row has `source = 'shared-lib'`. The topic-based auditing rule is inert. Only the 8-entry `EXPLICITLY_AUDITABLE` set applies.

**AUD-3 — half the explicit allow-list names events that do not exist. `[VERIFIED: exhaustive grep]`**

| Allow-list entry | Published by |
|---|---|
| `USER_LOGIN_SUCCEEDED` | `LoginEventPublisher.java:29` ✅ |
| `USER_LOGIN_FAILED` | `LoginEventPublisher.java:35` ✅ |
| `TENANT_PROVISIONED` | `ProvisioningService.java:276` ✅ |
| `TILL_REVIEWED` | `TillReviewService.java:36` ✅ |
| `RBAC_CHANGED` | **nowhere** ❌ |
| `IMPERSONATION_STARTED` | **nowhere** ❌ |
| `VOID_CREATED` | **nowhere** ❌ — POS emits `ORDER_VOIDED` (`OrderServiceImpl.java:51`) |
| `REFUND_CREATED` | **nowhere** ❌ — POS emits `ORDER_REFUNDED` (`RefundServiceImpl.java:31`) |

Two of those four are money movement. Voids and refunds are unaudited by a string mismatch.

**AUD-4 — the read API cannot work. `[VERIFIED: live]`**
`audit-service/src/main/resources/application.yml:10` → `username: ${AUDIT_DB_USER:audit_writer}`. `audit_writer` holds `INSERT` and nothing else, on the parent and on all 13 partitions.
```
$ psql -U audit_writer -d audit_db -c "SELECT count(*) FROM audit_events;"
ERROR:  permission denied for table audit_events
```
`AuditInternalController.getEvents` uses `auditEventRepository` on that same datasource. **The only way to read the audit log is broken by construction** — the identical defect class (a privilege the runtime role does not hold, surfacing only at HTTP call time) that made ingestion silently drop everything. `AuditImmutabilityIT` cannot catch it because it runs as the superuser. `AuditArchivalService` is exposed to the same problem: `ALTER TABLE … DETACH PARTITION` and `create_audit_partition()` require ownership; it has not fired yet because partitions run to 2027-01.

Two secondary notes on the read API: it takes `tenantId` as a query parameter with no check that the caller is entitled to that tenant (secret-holder ⇒ read any tenant's audit log), and there is no gateway route to `/internal/**`, so it is reachable only from inside the network.

**AUD-5 — the ingested record is thin.** `AuditIngestionService.ingest` populates `occurredAt, tenantId, branchId, userId, action, afterState` and leaves `resource_type`, `resource_id`, `before_state`, `ip_address`, `user_agent`, `metadata` NULL. `userId` is extracted by fishing for a `"userId"` key in the payload map (`extractUserId`, lines 128-141) — so a payload that names it `actorId`, `approvedBy`, `closedBy` or `createdBy` yields a **null actor**. There is no `impersonated_by` column at all.

### 4.3 Action → audit record matrix

This is the table the brief asked for. "Event published" is what the domain service emits; "Audited" is whether an `audit_events` row would result **given a running consumer and today's allow-list**.

| Auditor requirement | Event published | Audited today | Where the truth lives now |
|---|---|---|---|
| Login success | `USER_LOGIN_SUCCEEDED` | ✅ (allow-listed) | `LoginEventPublisher.java:29` |
| Login failure | `USER_LOGIN_FAILED` | ✅ (allow-listed) | `LoginEventPublisher.java:35` |
| Account lockout | **none** | ❌ | Lockout counter in Redis; `ACCOUNT_LOCKED` is an error code, not an event |
| **Permission denied (403)** | **none** | ❌ | Nothing. No service emits on `PermissionDeniedException` / `AccessDeniedException` |
| **User created** | **none** | ❌ | `user-service` publishes **zero events** (verified: no `EventPublisher` usage in `src/main`) |
| **User deactivated / reactivated** | **none** | ❌ | same |
| **Role granted / revoked** | **none** | ❌ | `UserAdminController` `POST`/`DELETE /{userId}/branch-roles` → no event. `RBAC_CHANGED` is allow-listed and emitted by nobody |
| Password changed (self) | `PASSWORD_CHANGED` | ❌ not allow-listed | `PasswordChangeService.java:124`; 121 rows in `auth_db.event_outbox` |
| Password reset requested | `PASSWORD_RESET_REQUESTED` | ❌ not allow-listed | `PasswordResetService.java:246` |
| **Admin password reset** | `ADMIN_PASSWORD_RESET` | ❌ not allow-listed | `AdminPasswordResetService.java:246` |
| **Impersonation started** | **none** | ❌ | `platform_db.impersonation_logs` only (`ImpersonationService.java:88-97`) — a service-local table, not the central trail |
| Impersonation *used* (per-request) | n/a | ❌ | `X-Impersonated-By` propagated by the gateway, **read by no service** |
| Tenant provisioned | `TENANT_PROVISIONED` | ✅ (allow-listed) | `ProvisioningService.java:276` |
| **Tenant tier / feature change** | **none** | ❌ | platform-admin-service publishes only `TENANT_PROVISIONED` |
| **Order void** | `ORDER_VOIDED` | ❌ allow-list says `VOID_CREATED` | `OrderServiceImpl.java:679` |
| **Order refund** | `ORDER_REFUNDED` | ❌ allow-list says `REFUND_CREATED` | `RefundServiceImpl.java:31` |
| **Discount applied / overridden** | **none** | ❌ | `PROMOTION` is a discount *type* constant, not an event |
| Till opened / closed | `TILL_OPENED` / `TILL_CLOSED` | ❌ not allow-listed | `TillServiceImpl.java:36,38` |
| Till reviewed | `TILL_REVIEWED` | ✅ (allow-listed) | `TillReviewService.java:36` |
| **Accounting period close** | `PERIOD_CLOSED` | ❌ not allow-listed | `PeriodCloseService.java:30` |
| Journal posted | `JOURNAL_POSTED` | ❌ not allow-listed | `JournalEntryServiceImpl.java:48`; 46 rows in `finance_db` |
| **Payroll approved** | `PAYROLL_APPROVED` | ❌ not allow-listed | hr-service |
| Payroll paid | `PAYROLL_PAID` | ❌ not allow-listed | hr-service |
| PO approved / closed | `PO_APPROVED` / `PO_CLOSED` | ❌ not allow-listed | `PoApprovalService.java`, `PurchaseOrderService.java` |
| AP payment processed | `AP_PAYMENT_PROCESSED` | ❌ not allow-listed | `ApPaymentService.java` |
| Vendor invoice matched | `VENDOR_INVOICE_MATCHED` | ❌ not allow-listed | `VendorInvoiceService.java` |
| **Data export / report run** | **none** | ❌ | `ReportController` `POST /{code}/run` and FBR summary emit nothing |
| NLQ query run | n/a | partial | `nlq_db.nlq_query_log` — a service-local log that *does* record `impersonated_by` correctly |

**Score: 4 of 29 auditor-relevant actions would produce a central audit record even with a healthy consumer. Today: 0.**

The three most serious absences, in order: **role grant/revoke and user lifecycle** (no event exists at all — the highest-privilege operations in the system leave no trace anywhere), **void and refund** (money, one-word fix), **permission denied** (an auditor's primary detection signal for probing, and there is no hook of any kind).

---

## Part 5 — Role-visible functionality (frontend)

### 5.1 How it works `[VERIFIED: source]`

`frontend/lib/hooks/auth/use-nav-visibility.ts` composes three predicates per nav item: `hasRole(item.roles)` ∧ `hasPermission(item.permission)` ∧ `hasFeature(item.feature)`, plus a `comingSoon` kill switch. Permissions come from `useCurrentUser()`, which decodes the in-memory access JWT — the same `permissions` claim the API enforces on. `components/shared/sidebar.tsx:119` uses `useNavGroupVisibility`, and hides a whole group when it has no visible items. This is the right design.

`proxy.ts` is explicitly documented as **not** a security boundary (only a `has_session` cookie redirect), which is accurate and honest.

### 5.2 Findings

| # | Finding | Class |
|---|---|---|
| N1 | **`Dashboard` (`/app/dashboard`) has no `permission`, no `roles`, no `feature`** — visible to every role including KITCHEN_STAFF and WAITER | UX / minor info-leak |
| N2 | **HR nav is `roles: ["OWNER","TENANT_ADMIN"]`** with the stale comment *"HR permissions not yet in DB catalog"*. They **are** in the catalog (changeset `045-hr-permissions.xml`). MANAGER holds `hr.employee.view`, `hr.attendance.manage`, `hr.leave.approve`; ACCOUNTANT holds `hr.payroll.view`, `hr.employee.view`. Neither can see the module. | **UX gap — granted capability is invisible** |
| N3 | Same stale-comment pattern on the `Reporting` item (also `comingSoon: true`, so hidden from everyone) | UX |
| N4 | **All 6 Finance nav items gate on `finance.journal.view`**, which MANAGER does not hold. But MANAGER holds `finance.ar.view` and `finance.expense.approve`, and the AP-Aging and Expenses APIs enforce exactly those. MANAGER can call them; the nav never shows them. | **UX gap — nav permission ≠ API permission** |
| N5 | **`platformNavItems` gates on `platform:tenant:read` and `platform:admin`** (`sidebar-nav-items.ts:354-366`). `signPlatformToken` emits `permissions: ["SUPER_ADMIN"]`. Neither code exists in any token or in the 65-permission catalog. Moreover the export is **imported by nothing** — `app/(platform)/layout.tsx` renders a bare header with no sidebar. Dead config referencing non-existent permissions. | Dead code + latent bug |
| N6 | `Settings → Users` gates on `rbac.manage` (OWNER only) while `UserAdminController` accepts `rbac.manage` **or** `rbac.user.manage` (TENANT_ADMIN). Moot today — `comingSoon: true`. | UX (latent) |
| N7 | **`failOpenOnFeatureError` defaults to `true`** (`use-nav-visibility.ts:45,68`): if `/api/v1/platform/features` errors, feature-gated items are **shown**. Deliberate and arguably right for UX, but it is a fail-**open** default in an authorization-adjacent path and should be a recorded decision. | Design decision to confirm |
| N8 | **No page-level permission guards** in most modules: `finance` 12 pages / 0 guarded files, `hr` 5 / 0, `crm` 1 / 0, `menu` 1 / 0, `nlq` 1 / 0. Direct URL navigation renders the shell; data calls then 403. Not a security gap (the API refuses) but a bad experience and it discloses module structure. `purchasing` (5/10), `kitchen` (3/3), `reports` (2/3) do guard. | UX / consistency |

**No case was found where the UI renders a module the API would wrongly allow.** Every nav gap is UI-stricter-than-API or nav-permission-mismatched-with-API. That is the safe direction.

---

## Part 6 — Prioritised gap list

Severity: **CRITICAL** = a real privilege or accountability boundary is unenforced. **HIGH** = a designed control is inert or a compliance requirement is unmet. **MEDIUM** = correctness/consistency. **LOW** = cleanup.

### CRITICAL

| ID | Gap | Evidence | Why critical |
|---|---|---|---|
| **C1** | **The audit trail is empty and cannot be read.** 0 rows; `audit_writer` has no `SELECT`; consumer not running; 1,809-message backlog. | `audit_db` live query; `application.yml:10`; `psql -U audit_writer` → permission denied | "Everything logged for audits" is 0 % met. There is no accountability record for any action in this system. |
| **C2** | **User lifecycle and role changes produce no event and no audit record.** user-service publishes nothing; `RBAC_CHANGED` is allow-listed and emitted by nobody. | exhaustive grep of `services/user-service/src/main` | Privilege escalation, account creation, and account deactivation — the highest-value events for any auditor — leave no trace whatsoever. `RoleCeiling` *prevents* escalation; nothing *records* the attempts it permits. |
| **C3** | **Voids and refunds are unaudited** because the allow-list names `VOID_CREATED`/`REFUND_CREATED` and POS emits `ORDER_VOIDED`/`ORDER_REFUNDED`. | `AuditIngestionService.java:35-42` vs `OrderServiceImpl.java:51`, `RefundServiceImpl.java:31` | Money movement, unlogged, by a two-word string mismatch. |
| **C4** | **`hr.rego` is enforced nowhere**, and hr-service's own branch scoping is incomplete: `EmployeeService.load(id)` is tenant-scoped only. | `hr-service/src/main` has zero OPA references; `EmployeeService.java:108-111` | Cross-branch read **and write** of employee records including `basicSalaryPaisa`. A real, currently-open privilege boundary. 28 passing Rego tests protect nothing. |
| **C5** | **`rbac.rego` is enforced nowhere.** No caller evaluates module `rbac`. | exhaustive grep | The policy governing who may administer users and branches is not consulted. Role administration is protected by `@PreAuthorize` + `RoleCeiling` only — which is *actually* decent, but the tenant/branch isolation clause in `rbac.rego` is not applied. |

### HIGH

| ID | Gap | Evidence |
|---|---|---|
| **H1** | **`ALWAYS_AUDIT_SOURCES` is permanently inert** — `DomainEventPublisher` hard-codes `source="shared-lib"`. Every "audit all auth/platform events" guarantee is false. | `DomainEventPublisher.java:41,55`; live `event_outbox` across 3 DBs |
| **H2** | **No `PERMISSION_DENIED` audit hook anywhere.** No service emits on `AccessDeniedException` / `PermissionDeniedException`. | exhaustive grep |
| **H3** | **Impersonation is not in the central audit trail.** `IMPERSONATION_STARTED` published nowhere; record lives only in `platform_db.impersonation_logs`. `X-Impersonated-By` is propagated by the gateway and read by **no service**, so no downstream action is attributable to the impersonator. | `ImpersonationService.java:88-97`; `JwtGlobalFilter.java:226`; exhaustive grep |
| **H4** | **`finance.rego` is 6/7 dead** — `close_period`, `view_coa`, `manage_coa`, `view_journal`, `post_journal`, `reverse_journal` are all unreachable. Period close, the money-moving control, is bounded only by a permission code and the TOTP header. | §2.1 |
| **H5** | **No OPA read timeout in the three direct-OPA services.** `SharedAutoConfiguration.opaClient` builds a `RestClient` with no timeouts; only `authorization-service` sets 2 s. AUTHZ-04's "fail closed on OPA timeout (2 s)" is unverified for pos/inventory/kitchen. | `SharedAutoConfiguration.java:163-166` vs `OpaConfig.java:19-34` |
| **H6** | **`file-service` has no authorization beyond `authenticated()`.** Upload, list, download, delete, quota — 5 endpoints, 0 `@PreAuthorize`, 0 OPA, and no `file.*` permission exists in the 65-code catalog. Any KITCHEN_STAFF token can delete any file in the tenant. | `FileController.java:49-92`; `FileSecurityConfig.java:57-60` |
| **H7** | **Audit read API has no tenant authorization.** `getEvents(@RequestParam UUID tenantId, …)` — anyone with the internal secret reads any tenant's log. | `AuditInternalController.java:38` |

### MEDIUM

| ID | Gap | Evidence |
|---|---|---|
| **M1** | `vendor.rego` `manage` rule dead; `pos.rego` `discount.override` and `split_bill` rules dead. | §2.1 |
| **M2** | `AuditArchivalService` will fail when it first fires — `audit_writer` cannot `ALTER TABLE … DETACH PARTITION` or run `create_audit_partition()`. Latent until 2027-01. | `AuditArchivalService.java:51-56`; live grants |
| **M3** | Audit rows are thin: `resource_type`, `resource_id`, `before_state`, `ip_address`, `user_agent`, `metadata` never populated; `user_id` extracted by fishing for a `"userId"` key, so most payloads yield a null actor; no `impersonated_by` column. | `AuditIngestionService.java:74-90,128-141`; live `\d audit_events` |
| **M4** | Nav↔API permission mismatch: Finance items gate on `finance.journal.view` while the APIs behind them enforce `finance.ar.view` / `finance.expense.approve` (N4). HR items role-gated despite real permissions existing (N2). | §5.2 |
| **M5** | `platformNavItems` references `platform:tenant:read` / `platform:admin`, codes that exist nowhere; the export is imported by nothing (N5). | `sidebar-nav-items.ts:354-366` |
| **M6** | inventory-service and kitchen-service carry **no** `@PreAuthorize` — the coarse gate is absent, so an OPA fault is the only thing between a request and the data. Defence in depth is one layer deep. | §1.3 |
| **M7** | audit-service is not in `deploy/docker-compose.yml`; it exists only in `scripts/start-dev.*` and as a CI-built image. Nothing in the deployment topology guarantees the audit consumer runs. | `deploy/docker-compose.yml`; `.github/workflows/ci.yml:270` |

### LOW

| ID | Gap | Evidence |
|---|---|---|
| **L1** | **`FINANCE_VIEWER` is an orphan role_code**: 2 rows in `role_permissions` (`finance.coa.view`, `hr.payroll.view`), **no row in `roles`**. It cannot be assigned (`RoleCatalog.requireKnown` rejects it) and no user holds it. `PermissionCatalogClosureTest` checks permission closure, not **role** closure, so this drift is invisible to CI. | live `auth_db` |
| **L2** | `pos.till.reconcile.override` is granted to 3 roles and referenced by zero lines of `src/main`. | §1.4 |
| **L3** | `Dashboard` nav item is ungated (N1). | `sidebar-nav-items.ts:60` |
| **L4** | `failOpenOnFeatureError: true` is an undocumented fail-open default (N7). | `use-nav-visibility.ts:45` |
| **L5** | Duplicated Liquibase prefixes (`045`, `046` used twice) — harmless per the master changelog's own comment, but a readability tax. | `db.changelog-master.xml` |

---

## Part 7 — Concrete work items for the planner

Grouped into waves by dependency. Each item is independently verifiable.

### Wave 0 — make the failure modes testable (prerequisite for everything else)

* **W0-1** Add `AuditReadPathIT` that runs the Spring datasource as **`audit_writer`**, not the superuser, and asserts `GET /internal/audit/events` returns 200 with rows. This is the test whose absence let C1/AUD-4 ship. Extend `AuditImmutabilityIT` to assert the *positive* privilege set too (`SELECT` = true), not only the negatives.
* **W0-2** Add `PolicyReachabilityTest` (sibling to `PermissionCatalogClosureTest`): parse every `allow if { input.action == "X" }` in `policies/restaurantos/*.rego`, parse every `authorize("module", "action", …)` / `AuthorizePayload("module","action",…)` in `services/*/src/main`, and fail on any policy rule with no caller. **This is the single highest-leverage item in this document** — it converts "dead letter" from an invisible class into a build failure, exactly as `PermissionCatalogClosureTest` did for permission drift.
* **W0-3** Add `RoleCatalogClosureTest`: every `role_permissions.role_code` must exist in `roles`. Catches L1 and its future recurrences.
* **W0-4** Add a slow-responder OPA test (a stub server that sleeps 10 s) against **pos-service**, asserting deny within ~2 s. The existing `OpaTimeoutFailClosedIT` cannot detect H5.

### Wave 1 — audit pipeline repair (unblocks the user's "everything logged" requirement)

* **W1-1** Grant `audit_writer` `SELECT` on `audit_events` and all partitions (or split into a distinct `audit_reader` role and give the read controller its own datasource — decide explicitly). Fixes AUD-4/C1.
* **W1-2** Give `DomainEventPublisher` a real `source`. Options: a `spring.application.name`-derived constructor arg (preferred — one place, no call-site churn), or an overload. Then `ALWAYS_AUDIT_SOURCES` starts working. Fixes H1. **Note:** this widens audit volume substantially — decide retention/partition sizing at the same time.
* **W1-3** Correct the allow-list: `VOID_CREATED`→`ORDER_VOIDED`, `REFUND_CREATED`→`ORDER_REFUNDED`. Fixes C3. Delete `RBAC_CHANGED`/`IMPERSONATION_STARTED` from the list or (better) make them real in W1-5/W1-6.
* **W1-4** Add the money-movement and security event types to the allow-list: `PERIOD_CLOSED`, `PAYROLL_APPROVED`, `PAYROLL_PAID`, `PO_APPROVED`, `PO_CLOSED`, `AP_PAYMENT_PROCESSED`, `VENDOR_INVOICE_MATCHED`, `JOURNAL_POSTED`, `TILL_OPENED`, `TILL_CLOSED`, `PASSWORD_CHANGED`, `ADMIN_PASSWORD_RESET`, `PASSWORD_RESET_REQUESTED`. (Largely subsumed by W1-2 for auth-service events; still needed for pos/finance/hr/purchasing.)
* **W1-5** **user-service must publish events.** `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, `ROLE_GRANTED`, `ROLE_REVOKED`, `ADMIN_PASSWORD_RESET` — via the transactional outbox, inside the existing `@Transactional` write. Fixes C2. **This is the largest single audit gap and should be sequenced first within this wave.**
* **W1-6** Publish `IMPERSONATION_STARTED` from `ImpersonationService.impersonate` alongside the existing `impersonation_logs` row. Fixes half of H3.
* **W1-7** Enrich `AuditIngestionService`: add an `impersonated_by` column + migration; populate `resource_type`/`resource_id` from the envelope; replace the `"userId"`-key fishing with a documented envelope contract (add `actorId` to `EventEnvelope`, defaulted from `TenantContext.getUserId()` in `DomainEventPublisher`). Fixes M3.
* **W1-8** Emit an audit event on authorization denial. Cheapest correct hook: a shared `@ControllerAdvice` in `shared-lib`'s `GlobalExceptionHandler` for `AccessDeniedException` + `PermissionDeniedException` that publishes `PERMISSION_DENIED` with path, method, required authority, and actor. Fixes H2. **Guard against feedback loops** (an audit-write failure must not itself emit).
* **W1-9** Grant `audit_writer` partition-management rights or move `AuditArchivalService` to a separate maintenance datasource. Fixes M2.
* **W1-10** Add tenant authorization to `GET /internal/audit/events` — derive `tenantId` from the forwarded JWT rather than the query param, or require `SUPER_ADMIN` for a cross-tenant read. Fixes H7.
* **W1-11** Add audit-service to the deployment topology so "the consumer is running" is a property of the deployment, not of a dev script. Fixes M7.

### Wave 2 — ABAC coverage (close the dead letters)

Order chosen by privilege boundary at risk, not by effort.

* **W2-1** **hr-service gets an OPA client and calls it on all 9 `hr.rego` actions.** Mirror `InventoryAuthorizationService` exactly — it is the cleanest existing template (a thin `@Service` wrapper, one method per action, called first in each controller method). Also fix `EmployeeService.load(id)` to be branch-scoped. Fixes C4.
* **W2-2** **finance-service calls OPA for `close_period`, `view_coa`, `manage_coa`, `view_journal`, `post_journal`, `reverse_journal`.** finance-service already has an `AuthorizationClient`; this is 6 new call sites, not new infrastructure. Fixes H4.
* **W2-3** **purchasing-service calls OPA for `vendor.manage`.** Fixes part of M1.
* **W2-4** **pos-service calls OPA for `pos.order.discount.override` and `pos.order.split_bill`.** Fixes the rest of M1.
* **W2-5** **Decide `rbac.rego`'s fate.** Either wire user-service/auth-service to evaluate module `rbac` on role and branch administration, or delete the module and its 11 tests and record that `RoleCeiling` + `@PreAuthorize` is the chosen control. Leaving a tested-but-unused policy is the state this whole document is about. Fixes C5. `[Needs user decision]`
* **W2-6** Move the 2 s connect+read timeout into `SharedAutoConfiguration.opaClient`; delete the now-redundant `@Primary` override in `authorization-service/config/OpaConfig.java`. Fixes H5.
* **W2-7** Add `@PreAuthorize` to inventory-service (39 endpoints) and kitchen-service (6) as the coarse first gate. Pure addition; the Rego rules already test the same codes, so no behaviour change. Fixes M6.
* **W2-8** **file-service authorization.** Add `file.upload` / `file.view` / `file.manage` to the permission catalog with grants, gate the 5 endpoints, and decide whether file access needs a Rego module (ownership/branch scoping of uploaded documents). Fixes H6. `[Needs user decision on the permission granularity]`

### Wave 3 — RBAC/nav cleanup

* **W3-1** Delete the `FINANCE_VIEWER` grants, or add the `roles` row — decide which. (L1)
* **W3-2** Delete `pos.till.reconcile.override` or implement the endpoint it was meant to gate. (L2)
* **W3-3** Replace HR/Reporting `roles: [...]` nav gates with the real permission codes; align the Finance group's gates with the permissions its APIs actually enforce. (N2, N3, N4 / M4)
* **W3-4** Delete `platformNavItems` or rewrite it to gate on `SUPER_ADMIN` and actually import it into `app/(platform)/layout.tsx`. (N5 / M5)
* **W3-5** Add a permission gate to the Dashboard nav item, or record that a dashboard for every role is intentional. (N1) `[Needs user decision]`
* **W3-6** Introduce a `<RequirePermission>` page-guard component and apply it to the 20 unguarded pages in `finance`, `hr`, `crm`, `menu`, `nlq`. UX only. (N8)
* **W3-7** Make `failOpenOnFeatureError` an explicit, documented decision rather than a default. (N7 / L4)
* **W3-8** Revisit whether TENANT_ADMIN should hold `rbac.manage` (§1.5) — the reason for withholding it no longer applies. `[Needs user decision]`

---

## Project constraints (from `CLAUDE.md`)

`CLAUDE.md` mandates GitNexus MCP usage: `impact({target, direction:"upstream"})` before editing any symbol, `detect_changes()` before committing, no find-and-replace renames, and escalation on HIGH/CRITICAL risk. **The planner must include these as explicit task steps**, not as ambient expectations. Several work items above touch high-fan-in symbols where this matters concretely:

* `DomainEventPublisher.publish` (W1-2) — every service's write path.
* `AuditIngestionService.ingest` / `isAuditable` (W1-3/4/7).
* `SharedAutoConfiguration.opaClient` (W2-6) — pos, inventory, kitchen all resolve this bean.
* `EventEnvelope` (W1-7) — a record change touches every publisher and consumer.

---

## Assumptions log

| # | Claim | Section | Risk if wrong |
|---|---|---|---|
| A1 | audit-service being absent from the running process list means the queue backlog is an environment artefact, not proof the consumer would crash. The 0-row count is nonetheless real, and AUD-2/3/4 are proved statically. | §4.2 | Low — the static defects stand independently |
| A2 | `audit_user` (full privileges on `audit_events`) is unused at runtime; only `audit_writer` and the Liquibase admin connect. Inferred from `application.yml:10`; not proved against a live connection. | §4.1 | Medium — if any process connects as `audit_user`, immutability is one `TRUNCATE` away (row triggers do not fire on TRUNCATE) |
| A3 | The proposed unified-`authz`-entrypoint Rego refactor (§3.3 item 5) is an architectural preference, not a discovered requirement. | §3.3 | Low — flagged for user decision |
| A4 | "What a real auditor needs" (§4.3 left column) is derived from general practice, not from a stated compliance regime for this product. Pakistan/FBR obligations may add or remove rows. | §4.3 | **Medium-high** — retention (7 years is coded), export format, and required fields should be confirmed with the user before the audit schema is extended |
| A5 | The 2-second OPA budget is treated as the target because ROADMAP Phase 2 SC4 states it. No independent latency requirement was found. | §2.3 | Low |
| A6 | `pos.rego`'s `void.own`/`void.any` rules have no `input.action` guard, so *any* action reaching module `pos` with `pos.order.void.any` is allowed. Only `authorizeVoid`/`authorizeRefund` call module `pos` today, so this is latent, not live. | §2.1 | Medium if new `pos` actions are added — worth a Rego fix in W2-4 |

---

## Open questions for the user

1. **Compliance regime.** Is there a named standard (FBR record-keeping, PCI-DSS for card tenders, a customer contract) that dictates audit retention, required fields, or export format? The 7-year retention in `AuditArchivalService` is unexplained in code. This changes W1-7's schema.
2. **Audit volume vs. fidelity.** W1-2 makes *every* auth-service and platform-admin event auditable, which is what the code intends. Combined with W1-4 and W1-8 (`PERMISSION_DENIED` on every 403), volume rises by roughly an order of magnitude. Confirm that "everything logged" means everything, and size partitions/retention accordingly.
3. **`rbac.rego`: wire it or delete it?** (W2-5)
4. **file-service permission granularity** — one `file.manage`, or per-operation codes, or resource-scoped OPA? (W2-8)
5. **Is a role-agnostic Dashboard intentional?** (W3-5)
6. **Should TENANT_ADMIN hold `rbac.manage`?** The original reason for withholding it (avoiding forced TOTP) no longer holds. (W3-8)

---

## Sources

All findings were obtained in this session. No external documentation was consulted; every claim is grounded in this repository or the running local stack.

**Live-stack evidence (HIGHEST confidence)**
- `docker exec restaurantos-postgres psql -U postgres -d auth_db` — permission catalog (65), grants (232), role table (8), orphan `FINANCE_VIEWER`, outbox contents and `source` values
- `docker exec restaurantos-postgres psql -U postgres -d audit_db` — `audit_events` schema, partitions, triggers, grants, **0 rows**
- `docker exec restaurantos-postgres psql -U audit_writer -d audit_db` — `ERROR: permission denied for table audit_events`
- `docker exec restaurantos-rabbitmq rabbitmqctl list_queues` — `audit.all-events.queue`: 1809 messages, 0 consumers
- `docker run openpolicyagent/opa:1.17.1 test /policies --coverage` — 139/139 PASS, 100 % coverage, 781 lines

**Source evidence (HIGH confidence — exhaustive scans, not samples)**
- `shared-lib/src/main/java/io/restaurantos/shared/security/{JwtAuthenticationFilter,JwtClaims}.java`
- `shared-lib/src/main/java/io/restaurantos/shared/authz/{AuthorizationService,DefaultOpaClient,OpaClient,OpaInput}.java`
- `shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java:163-166`
- `shared-lib/src/main/java/io/restaurantos/shared/event/{DomainEventPublisher,EventPublisher,EventEnvelope,OutboxEntry}.java`
- `gateway/src/main/java/io/restaurantos/gateway/filter/{JwtGlobalFilter,StripInternalHeaderFilter}.java`, `config/GatewaySecurityConfig.java`
- `policies/restaurantos/*.rego` (8 files), `policies/tests/*_test.rego` (8 files)
- All 16 `services/*/…/config/*SecurityConfig.java`
- `services/audit-service/src/main/**` (15 files) + `src/test/{AuditConsumerIT,AuditImmutabilityIT}.java` + `db/changelog/v1.0.0/*.xml`
- `services/authorization-service/src/main/**` + `src/test/…/OpaTimeoutFailClosedIT.java`
- `services/auth-service/src/main/java/io/restaurantos/auth/service/{JwtSigningService,AuthServiceImpl,RoleCeiling,LoginEventPublisher}.java`
- `services/auth-service/src/test/java/io/restaurantos/auth/PermissionCatalogClosureTest.java`
- `services/auth-service/src/main/resources/db/changelog/**` (34 changesets)
- `services/{pos,inventory,kitchen}-service/…/authz/*AuthorizationService.java` and every caller
- `services/{purchasing,finance}-service/…/feign/AuthorizationClient.java`, `config/FeignClientConfig.java`, and both `assertOpaAllows` sites
- `services/hr-service/src/main/java/io/restaurantos/hr/service/EmployeeService.java`
- `services/file-service/…/FileController.java`
- `frontend/components/shared/{sidebar-nav-items.ts,sidebar.tsx}`, `frontend/lib/hooks/auth/{use-nav-visibility,use-current-user}.ts`, `frontend/proxy.ts`, `frontend/app/(platform)/layout.tsx`

**Derived set operations (scripted, reproducible)**
- Catalog (65) vs `has(Any)Authority` codes (59) vs Rego `has_permission` codes (32) → 63-code union, 2-code gap
- `@PreAuthorize` annotation census: 182 across 10 services
- Published-event-type census across all 16 services' `src/main`

---

## Metadata

**Confidence breakdown**
- Live-stack facts (row counts, grants, queue depth, OPA test results): **HIGH** — reproduced directly
- Enforcement-point map (§2.1): **HIGH** — exhaustive grep over `src/main`, excluding tests and `target/`, with each hit read in context
- Audit action matrix (§4.3): **HIGH** for "event published"/"allow-listed"; **MEDIUM** for "what an auditor needs" (see A4)
- Frontend findings: **HIGH** — the nav config and the visibility hook are each a single file
- Target design (§3.3): **MEDIUM** — a recommendation, not a discovery

**Research date:** 2026-08-07
**Valid until:** ~2026-09-06, or the next merge that touches `policies/`, `AuditIngestionService`, or any `*SecurityConfig` — whichever is first.
