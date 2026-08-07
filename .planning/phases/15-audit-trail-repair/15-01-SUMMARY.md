---
phase: 15-audit-trail-repair
plan: 01
subsystem: audit-pipeline
status: complete
tags: [audit, event-sourcing, outbox, rbac, tenant-isolation, credentials, closure-test, impersonation, liquibase]
requires:
  - running dev stack (postgres, rabbitmq, redis, eureka)
  - "shared-lib: DomainEventPublisher, EventEnvelope, OutboxRelay, TenantContext"
  - "13-11: X-Acting-User-Id on the internal seam; RoleCeiling"
  - "13-09 (D-19): the raw reset token already removed from PASSWORD_RESET_REQUESTED"
provides:
  - "DomainEventPublisher(source = spring.application.name) — every event names its producer"
  - "EventEnvelope.actorId + .impersonatedBy — who acted, and who was really behind it"
  - "AuditEventCatalog — THE must-audit list, in shared-lib where both sides can see it"
  - "AuditAllowListClosureTest — allow-list <-> publisher drift is now a build failure"
  - "CredentialRedactor — one definition of a credential field name, applied at build time and at ingestion"
  - "UserLifecycleEventContract + 5 typed payloads (USER_CREATED/UPDATED/DEACTIVATED/REACTIVATED, ROLE_GRANTED/REVOKED)"
  - "UserLifecycleEventPublisher (auth-service) — publishes inside the write transaction"
  - "IMPERSONATION_STARTED from platform-admin-service"
  - "audit_events.impersonated_by column + partial index"
  - "audit_writer SELECT on audit_events and every partition, present and future"
  - "GET /api/v1/audit/events — tenant-scoped, audit.log.view"
  - "audit-route in the gateway (the log was unreachable from outside the cluster)"
  - "audit.log.view permission (changeset 059), OWNER + TENANT_ADMIN"
  - "AuditReadPathIT — 13 tests as the real non-superuser runtime role"
affects:
  - "every service publishing domain events: source is now its own name, not 'shared-lib'"
  - "audit volume: ALWAYS_AUDIT_SOURCES works for the first time — see W-15-07 on retention"
  - "Phase 14 frontend: /api/v1/audit/events is the audit-log screen's endpoint"
tech-stack:
  added: []
  patterns:
    - "closure test over two vocabularies parsed from the repository tree (PermissionCatalogClosureTest)"
    - "consumer-side redaction: a consumer of long-lived queued messages does not trust its producers"
    - "integration test runs as the real non-superuser DB role, not the Testcontainers superuser"
key-files:
  created:
    - shared-lib/src/main/java/io/restaurantos/shared/event/AuditEventCatalog.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/CredentialRedactor.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/payload/UserLifecycleEventContract.java
    - shared-lib/src/test/java/io/restaurantos/shared/event/AuditAllowListClosureTest.java
    - shared-lib/src/test/java/io/restaurantos/shared/event/payload/EventPayloadNoCredentialsTest.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/UserLifecycleEventPublisher.java
    - services/auth-service/src/main/resources/db/changelog/v1.0.0/059-audit-log-view-permission.xml
    - services/audit-service/src/main/java/io/restaurantos/audit/controller/AuditQueryController.java
    - services/audit-service/src/main/java/io/restaurantos/audit/dto/AuditEventView.java
    - services/audit-service/src/main/resources/db/changelog/v1.0.0/013-audit-readable-and-attributable.xml
    - services/audit-service/src/test/java/io/restaurantos/audit/AuditReadPathIT.java
  modified:
    - shared-lib/src/main/java/io/restaurantos/shared/event/DomainEventPublisher.java
    - shared-lib/src/main/java/io/restaurantos/shared/event/EventEnvelope.java
    - shared-lib/src/main/java/io/restaurantos/shared/config/SharedAutoConfiguration.java
    - services/audit-service/src/main/java/io/restaurantos/audit/service/AuditIngestionService.java
    - services/audit-service/src/main/java/io/restaurantos/audit/config/AuditSecurityConfig.java
    - services/auth-service/src/main/java/io/restaurantos/auth/service/{UserLifecycleService,BranchRoleAdminService,PasswordPolicyService}.java
    - services/platform-admin-service/src/main/java/io/restaurantos/platform/service/ImpersonationService.java
    - gateway/src/main/resources/application.yml
decisions: [D-1, D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9, D-10, D-11]
metrics:
  audit_events_before: 0
  audit_events_after: 2600
  queue_backlog_before: 3202
  queue_backlog_drained_to: 0
  dlq_depth: 0
  tests_added: 20
---

# Phase 15 Plan 01: Audit Trail Repair — Summary

The audit trail held **0 rows** against a 3,202-message backlog and could not be read at all; it now
holds **2,600 rows across 11 action types**, is readable by the role that actually runs in
production, is reachable through the gateway, and its two silent-drift failure modes are build
failures.

## 1. The headline number

| | Before | After |
|---|---:|---:|
| `audit_events` rows | **0** | **2,600** |
| Distinct action types recorded | 0 | 11 |
| `audit.all-events.queue` depth | 3,202 | 0 (drained in ~15 s) |
| `audit.all-events.queue.dlq` | 0 | 0 |
| `SELECT` as `audit_writer` | `ERROR: permission denied` | 2,600 |

Real output, before:

```
$ docker exec restaurantos-postgres psql -U postgres -d audit_db -tAc "SELECT count(*) FROM audit_events;"
0
$ docker exec restaurantos-postgres psql -U audit_writer -d audit_db -c "SELECT count(*) FROM audit_events;"
ERROR:  permission denied for table audit_events
$ rabbitmqctl list_queues | grep audit.all-events
audit.all-events.queue      3202    0
```

After (the identical `audit_writer` query — the one that could never have worked):

```
$ docker exec restaurantos-postgres psql -U audit_writer -d audit_db -c "SELECT count(*) FROM audit_events;"
 rows_visible_to_runtime_role
------------------------------
                         2600
```

Draining, measured at 5-second intervals:

```
t+5s   queue=1143  audit_events=1667
t+10s  queue=105   audit_events=2521
t+15s  queue=0     audit_events=2574     DRAINED
```

Current distribution:

| action | rows |
|---|---:|
| USER_LOGIN_SUCCEEDED | 1648 |
| USER_LOGIN_FAILED | 507 |
| PASSWORD_CHANGED | 229 |
| JOURNAL_POSTED | 72 |
| TENANT_PROVISIONED | 69 |
| PASSWORD_RESET_REQUESTED | 30 |
| ADMIN_PASSWORD_RESET | 26 |
| TILL_OPENED | 14 |
| ROLE_GRANTED | 2 |
| USER_CREATED | 2 |
| USER_DEACTIVATED | 1 |

The 3,202 → 2,574 difference is **not loss**. It is the allow-list doing its job: `ORDER_CREATED`,
`STOCK_DEPLETED`, `MENU_ITEM_UPSERTED` and the rest are classified `NOT_AUDIT_RELEVANT` and are
consumed without producing a row. The DLQ is empty, so nothing failed.

## 2. What history does and does not say — read this before quoting the number

**The 2,575 rows recovered from the backlog do not have a usable `source`.** Every one records
`shared-lib`, because that is the literal string `DomainEventPublisher` stamped on every event ever
published. No fix can recover an origin that was never written down.

```
$ psql -d audit_db -tAc "SELECT metadata->>'source', count(*) FROM audit_events GROUP BY 1;"
shared-lib|2575
```

Those rows are attributable **by type, by actor (where the payload happened to name one) and by
timestamp**, and are **not** attributable by service. Nothing here recovered history; the pipeline
was repaired and a backlog that had been accumulating against a broken consumer was processed.

Events published after the fix are correct — verified live, §4.

## 3. The four defects

### 3.1 Every event's source was the literal string `shared-lib`

`DomainEventPublisher` hard-coded it, so `ALWAYS_AUDIT_SOURCES = {auth-service,
platform-admin-service}` could never match and had been inert since it was written.

Fixed by binding the source **once** from `spring.application.name` as a constructor argument, not a
`publish(...)` parameter — 43 call sites are 43 chances to pass the wrong string with nothing that
would notice. Validated at startup: blank fails, and `"shared-lib"` fails **by name**, so the exact
defect cannot be reinstated through configuration.

### 3.2 Four of eight allow-listed types had no publisher

`VOID_CREATED` → pos-service publishes `ORDER_VOIDED`. `REFUND_CREATED` → `ORDER_REFUNDED`. Voids and
refunds — the two operations an auditor looks at first — were unaudited by a two-word mismatch.
`RBAC_CHANGED` and `IMPERSONATION_STARTED` were published by nothing at all.

All four resolved: the two renamed to what pos-service actually emits (**no pos-service source
change was needed or made** — the defect was in the consumer), `RBAC_CHANGED` superseded by real
`ROLE_GRANTED`/`ROLE_REVOKED` events, and `IMPERSONATION_STARTED` now published from
platform-admin-service inside the transaction that writes `impersonation_logs`.

`AuditAllowListClosureTest` now fails the build in both directions. It is proven non-vacuous — it
failed on all four entries before they were fixed — and it caught a real error in the research
document: hr-service publishes `PAYROLL_RUN_APPROVED`/`PAYROLL_RUN_PAID`, not
`PAYROLL_APPROVED`/`PAYROLL_PAID`. Trusting the document would have shipped two more dead entries.

### 3.3 The read API could not work

`audit_writer` held `INSERT` and nothing else. Changeset 013 grants `SELECT` on the parent and on
every partition found via `pg_inherits` (not a hardcoded list — 010b named 13 by hand and
`create_audit_partition()` has been adding more), and amends that function to grant `INSERT, SELECT`
so next month's partition is not INSERT-only again.

**Append-only is unchanged**, verified live after the grant:

```
$ psql -U audit_writer -d audit_db -c "UPDATE audit_events SET action='tampered' WHERE ..."
ERROR:  permission denied for table audit_events
$ psql -U audit_writer -d audit_db -c "DELETE FROM audit_events WHERE ..."
ERROR:  permission denied for table audit_events
```

`AuditReadPathIT` runs the datasource as a genuine non-superuser `audit_writer`. That is the test
whose absence let this ship: `AuditImmutabilityIT` runs as the Testcontainers **superuser** (which
bypasses privilege checks entirely) and asserted only the **negative** privileges — a role holding
*nothing at all* satisfied every one of its assertions. Both layers are now asserted separately:
privileges as `audit_writer`, and the `prevent_audit_mutation` trigger over an admin connection,
because the privilege layer stops `audit_writer` before the trigger is reached and a test running
only as `audit_writer` cannot tell two layers from one.

### 3.4 user lifecycle produced no event anywhere

`USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, `ROLE_GRANTED`,
`ROLE_REVOKED` — typed records in `shared-lib`, published through the existing outbox.

**Published from auth-service, not user-service** (D-5). user-service owns none of this data; every
one of its writes is a Feign delegation to auth-service. Publishing there could only happen *after* a
remote commit, with no transaction to make the event and the write agree — producing an event for a
rolled-back write, or a committed write whose event was lost. From auth-service, inside the
`@Transactional` method, they commit together. It also captures provisioning, which creates a
tenant's first OWNER by calling auth-service directly and never touches user-service.

## 4. Live end-to-end proof

**Source, before and after, on the same table.** A real login (HTTP 200) against a rebuilt
auth-service, next to the rows the still-running old build had produced minutes earlier:

```
    source    |      event_type      |          created_at
--------------+----------------------+-------------------------------
 auth-service | USER_LOGIN_SUCCEEDED | 2026-08-07 01:48:06.719144+00   <- rebuilt
 shared-lib   | USER_LOGIN_SUCCEEDED | 2026-08-07 01:47:09.853808+00   <- old build
```

**Full user lifecycle through the real endpoint** (create with role, then deactivate; HTTP 201 /
HTTP 200), showing correct actor and source on all three:

```
      action      |                actor                 |    source
------------------+--------------------------------------+--------------
 ROLE_GRANTED     | 61334688-...-e93208ba5324 (the OWNER) | auth-service
 USER_CREATED     | 61334688-...-e93208ba5324             | auth-service
 USER_DEACTIVATED | 61334688-...-e93208ba5324             | auth-service
```

**No credential reached the outbox or the audit log.** The create call returned temp password
`6PwUvpd#@8%n&qe6` in its HTTP response:

```
occurrences in auth_db.event_outbox:   0
occurrences in audit_db.audit_events:  0
```

**Redaction, end to end.** A payload carrying a raw token published to `auth.topic` (`{"routed":true}`)
and consumed:

```
 PASSWORD_RESET_REQUESTED | {"email": "x@terrace.local", "token": "[REDACTED]",
                             "userId": "61334688-...", "tokenId": "8b1c9e00-..."}
```

The credential is gone; `tokenId` (a row handle, D-19's fix) and the non-credential fields survive.

## 5. The tension the brief asked about, and how it is resolved

**A commit separates the two requirements**, so they never actually meet.

Before the commit, the outbox INSERT is inside the caller's transaction — sale and event commit
together, which is the whole point of the outbox pattern. The only thing that can fail there is
payload serialization: a deterministic programming error, caught by the contract tests, never a
transient condition. After the commit, everything that can genuinely fail — broker delivery, audit
ingestion, the audit database — is asynchronous and the sale is already durable. There is no
transaction left to roll back.

That frees the failure to be loud. `AuditIngestionService.ingest` **does not catch**: it throws, the
listener does not ack, the broker redelivers, and the message lands in
`audit.all-events.queue.dlq`. A non-empty DLQ and a climbing queue are the alarm. Swallowing would
ACK and destroy the event — one log line and silent data loss.

## 6. Guardrails

| Guardrail | Status | Evidence |
|---|---|---|
| Append-only: no UPDATE, no DELETE | **Held** | Live `permission denied` on both after the SELECT grant; `AuditReadPathIT` asserts privilege layer AND trigger layer separately |
| Audit failure visible, never rolls back a sale | **Held** | §5; DLQ = 0 |
| No credentials/PII in payloads | **Held, plus a finding** | 0 occurrences of the live temp password; `EventPayloadNoCredentialsTest` (5 tests); redaction proven live. **But see §7** |
| Tenant isolation on audit reads | **Held** | `AuditReadPathIT`: A never sees B's rows, disjoint result sets, and the endpoint has no tenant parameter (asserted reflectively) |
| Not in `PUBLIC_PATHS`; `TENANT_OPTIONAL_PATHS` untouched | **Held** | `audit-route` is an ordinary authenticated tenant-bearing route; verified both lists unchanged |
| No pos/finance/purchasing/crm/reporting source edits | **Held** | `git show --stat` on all four commits |
| shared-lib changed additively and rebuilt early | **Held** | 9-arg `EventEnvelope` constructor retained for ~30 call sites; consumers parse with `FAIL_ON_UNKNOWN_PROPERTIES` disabled; installed and committed first, ~25 min in |

## 7. One finding that needs your decision — 3 rows carry raw reset tokens

**Draining the backlog copied three raw password-reset tokens into `audit_events`.** They came from
pre-D-19 `PASSWORD_RESET_REQUESTED` messages sitting in the broker since before 13-09 removed the raw
token from that payload. The producer-side rule was correct, current, and did not help, because the
messages predated it. This is a regression introduced by this phase and I am reporting it rather than
quietly leaving it.

```
  id  | occurred_at |     status
------+-------------+-----------------
  109 | 2026-08-06  | RAW CREDENTIAL
  112 | 2026-08-06  | RAW CREDENTIAL
  117 | 2026-08-06  | RAW CREDENTIAL
 2600 | 2026-08-07  | redacted (safe)   <- post-fix, correctly [REDACTED]
```

All three are tenant `a0000001-...` (the demo tenant), user `manager@demo.local`, dated 2026-08-06.
Reset tokens are single-use and time-limited, so these are near-certainly spent — but they are
credential material in a table with seven-year retention.

**Recurrence is closed** (`CredentialRedactor`, proven live). **The three existing rows are not**,
and I did not remove them: the table is append-only by your explicit guardrail, and deleting audit
rows is a decision for you, not for me. If you want them gone, it requires the table owner and a
deliberate suspension of immutability:

```sql
-- as audit_admin / the table owner, NOT audit_writer
ALTER TABLE audit_events DISABLE TRIGGER audit_events_immutable;
DELETE FROM audit_events WHERE id IN (109, 112, 117);
ALTER TABLE audit_events ENABLE TRIGGER audit_events_immutable;
```

The same three raw tokens are also still in `auth_db.event_outbox`, which is not append-only and can
be cleaned without ceremony.

## 8. Deviations from plan

| Rule | What | Why |
|---|---|---|
| **Rule 2** (missing critical security) | `CredentialRedactor` + consumer-side redaction | Not in the brief. Found by running the fix: audit-service consumes from ten services it does not control over a broker holding messages indefinitely, and writes to the one table that cannot be corrected. §7 |
| **Rule 1** (bug) | `ROLE_GRANTED` recorded a **null actor** | `/internal/auth/**` carries no JWT, so `TenantContext.getUserId()` is empty on every role grant made through user-service. A privilege escalation that cannot say who performed it is the row that most needs to. Actor now threaded explicitly from `assignAsActingUser` |
| **Rule 3** (blocking) | `AuditConsumerIT` had not run in a long time | Two independent pre-existing faults, each masking the other: it never created the `audit_writer` role that changeset 010 has granted to since 05-02 (Liquibase aborted the context), and its `@RabbitListener` started before `@BeforeEach` declared the queue. The only integration coverage of the audit consumer was itself not running |
| **Rule 3** (blocking) | Stale `TestFixtures 2.class` in `services/auth-service/target/test-classes` | Pre-existing build residue (surefire dumps from 00:08, before this phase) crashing the forked VM. Removed the stale artifact only; no source change |
| **Design** (D-5) | User events published from **auth-service**, not user-service as the brief said | user-service owns none of this data and has no transaction to bind an event to. Same outcome, correct atomicity. Rationale in 15-CONTEXT D-5 |
| **Design** (D-10) | Impersonation read from the **JWT claim**, not `X-Impersonated-By` | The header is transport; the claim is signature-verified end to end. Reading the header would make the field only as trustworthy as the weakest hop that could set it |

## 9. Tests

| Suite | Result |
|---|---|
| audit-service (`clean verify`) | **23 tests, 0 failures** — AuditImmutabilityIT 7, AuditReadPathIT 13, AuditConsumerIT 3 |
| auth-service (`test`) | **28 tests, 0 failures** — including `PermissionCatalogClosureTest`, which validates the new `audit.log.view` code |
| shared-lib (new tests) | **7 tests, 0 failures** — `AuditAllowListClosureTest` 2, `EventPayloadNoCredentialsTest` 5 |

Not run: the full reactor (explicitly out of bounds), and the other services' suites — no source
file of theirs was touched. shared-lib was rebuilt and installed before any of them compiled against
it.

## 10. Self-Check: PASSED

All 11 created files exist on disk. All four commits present:
`7081429`, `1199450`, `a23cf85`, `68a0e8c`.

Every number in §1 and §4 is pasted from real command output captured during execution.
