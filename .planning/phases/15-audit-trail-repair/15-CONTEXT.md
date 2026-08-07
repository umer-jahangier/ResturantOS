# Phase 15: Audit Trail Repair — Context

**Gathered:** 2026-08-07
**Status:** Executed (15-01)
**Source:** `.planning/research/authz-audit/RESEARCH.md` (2026-08-07) + user direction
**Branch:** `phase-13-access-repair`

<domain>
## Phase Boundary

The user's requirement is **"everything logged for audits."** Measured at the start of this phase, the delivered figure was **zero**:

```
audit_db:  SELECT count(*) FROM audit_events   →  0
auth_db:   SELECT count(*) FROM event_outbox   →  1,390  (every row source='shared-lib')
rabbitmq:  audit.all-events.queue              →  3,202 messages, 0 consumers
psql -U audit_writer -d audit_db -c "SELECT count(*) FROM audit_events"
                                               →  ERROR: permission denied for table audit_events
```

The subsystem was not sparse or partially working. It was non-functional at **four independent
layers simultaneously**, each of which would have been sufficient on its own to keep the table
empty. That is the defining fact of this phase and it shapes every decision below: the failure was
never in one place, so no single fix could have been verified by the absence of an error.

**In scope:** the event → outbox → broker → consumer → `audit_events` → read API pipeline, end to
end; the user-lifecycle and privilege events that had no publisher at all; the gateway route that
made the log reachable; and the drift controls that stop all of this recurring silently.

**Out of scope (deliberately):**
- ABAC / OPA dead-letter policies (RESEARCH Wave 2) — a concurrent workstream
- `PERMISSION_DENIED` audit hook (W1-8) — needs a shared `@ControllerAdvice` decision, see W-15-04
- `AuditArchivalService` partition-management privileges (W1-9, latent until 2027-01) — W-15-05
- Frontend audit-log UI (RESEARCH Wave 3)
- pos-service, finance-service, purchasing-service, crm-service, reporting-service source changes —
  concurrent money-path repair. **Nothing in this phase edits them**, and nothing needed to: the
  void/refund defect was in the consumer's allow-list, not in the producers.
</domain>

<decisions>
## Implementation Decisions

### D-1 (LOCKED) — The event source is a bound service identity, not a per-call argument

`DomainEventPublisher` hard-coded `source = "shared-lib"` on every event in the system. Confirmed
live: every row of `event_outbox` in every database read `shared-lib`. audit-service's
`ALWAYS_AUDIT_SOURCES = {auth-service, platform-admin-service}` therefore matched nothing that had
ever been published, and had been inert since the day it was written.

**Decision:** the source is a **constructor argument bound once from `spring.application.name`** in
`SharedAutoConfiguration`, not a parameter on `publish(...)`.

Rejected: adding a `source` parameter to `publish(...)`. There are 43 publish call sites across 10
services. A per-call argument is 43 opportunities to pass the wrong string, with no mechanism that
would ever notice — which is the same failure one indirection further out.

The value is validated at context startup: blank fails, and the literal `"shared-lib"` fails **by
name**, because that is the one string that would silently reinstate the original defect if it were
ever wired back through configuration. All 16 services already set `spring.application.name`, so
there is no default and a service that loses it fails to start rather than publishing anonymously.

### D-2 (LOCKED) — The audit allow-list moves to shared-lib and is closed by a build-time test

Four of the eight allow-listed event types were published by **no service anywhere**:

| Allow-listed | Actually published |
|---|---|
| `VOID_CREATED` | `ORDER_VOIDED` (pos-service) |
| `REFUND_CREATED` | `ORDER_REFUNDED` (pos-service) |
| `RBAC_CHANGED` | nothing — no role-change event existed |
| `IMPERSONATION_STARTED` | nothing — only `platform_db.impersonation_logs` |

Voids and refunds — the two operations an auditor looks at first, and the two that move money out of
the till — were unaudited because of a two-word string mismatch.

**Decision:** `AuditEventCatalog` lives in `shared-lib`, where the allow-list and the publishers are
both visible to one test. `AuditAllowListClosureTest` fails the build in **both** directions:

1. an allow-listed type with no publisher (the defect above);
2. a published type naming a privilege, a credential or a movement of money that is in neither
   `MUST_AUDIT` nor `NOT_AUDIT_RELEVANT`.

Direction 2 needs the explicit opt-out set, so that "not audited" is a decision someone made and can
be argued with, rather than an omission indistinguishable from an oversight.

Modelled on `PermissionCatalogClosureTest`, which ended this exact defect class for permission codes
after five outages. The same reasoning applies verbatim: **no ordinary test can fail on this.** An
allow-list entry nobody publishes throws nothing, breaks nothing and logs nothing — the system
behaves exactly as it would if those operations had never happened.

The test found a real error in the research document itself: hr-service publishes
`PAYROLL_RUN_APPROVED` / `PAYROLL_RUN_PAID`, not `PAYROLL_APPROVED` / `PAYROLL_PAID`. Had the
research's names been trusted, this phase would have shipped two more dead entries.

### D-3 (LOCKED) — How "audit failures must be loud" and "must not roll back a sale" are reconciled

These look opposed and are not, because **a commit separates them in time**.

- **Before the commit** — `DomainEventPublisher` INSERTs the outbox row inside the caller's
  transaction. The sale and its event commit together or neither does; that is the entire purpose of
  the outbox pattern. The only failure possible at this point is payload serialization, which is a
  deterministic programming error in a payload record, caught by the contract tests, never a
  transient runtime condition.
- **After the commit** — everything that can genuinely fail transiently (broker delivery, audit
  ingestion, the audit database) happens asynchronously, when the sale is already durable. There is
  no transaction left to roll back.

Which frees the failure to be as loud as it should be: `AuditIngestionService.ingest` **does not
catch**. It throws, the listener does not acknowledge, the broker redelivers, and the message
eventually lands in `audit.all-events.queue.dlq`. A non-empty DLQ and a climbing queue depth are the
alarm. Swallowing would ACK and destroy the event — one log line and silent data loss, the failure
mode `EventEnvelopeReader` was extracted to stop nine consumers from having.

### D-4 (LOCKED) — `audit_writer` gains SELECT; append-only is unchanged

`audit_writer` held `INSERT` and nothing else, on the parent and all 13 partitions, so
`AuditInternalController` — the only way to read the log — was broken by construction from the day
it was written.

**Decision:** grant `SELECT`. Append-only means **no UPDATE and no DELETE**, both of which remain
revoked and are independently blocked by the `prevent_audit_mutation` trigger. Reading is not a
mutation; it is the point. A log that cannot be read is not a stricter audit log — it is an
expensive way to write to `/dev/null`.

The grant is applied to existing partitions by **enumerating `pg_inherits`, not by listing names**,
and `create_audit_partition()` is amended to grant `INSERT, SELECT`. Without the second part the fix
lasts until the next month rolls over and then fails again, in production, on a date nobody is
watching — and the newest partition is the one every recent-events query reads.

**Why the existing tests could not see this:** `AuditImmutabilityIT` runs the Spring datasource as
the Testcontainers **superuser**, which bypasses privilege checks entirely, and asserts only the
NEGATIVE privileges — a role holding *nothing at all* satisfied every one of its assertions.
`AuditReadPathIT` connects as a genuine non-superuser `audit_writer` with Liquibase on the admin
connection, exactly as production splits them.

### D-5 (LOCKED) — User-lifecycle events are published from auth-service, not user-service

The brief said "user-service publishes no events at all." That is true, and user-service is
nonetheless the wrong place to fix it.

user-service **owns none of this data**. `users` and `user_branch_roles` live in `auth_db`, and every
user-service write is a Feign delegation to auth-service — `UserAdminService` documents that
ownership at length and `UserAdminDelegationIT` asserts it. Publishing from user-service would mean
publishing *after* a remote call had already committed, outside any transaction that could make the
event and the write agree. That produces two failure modes the trail cannot distinguish from truth:
an event for a write that was rolled back, and a committed write whose event was lost.

**Decision:** publish from auth-service, inside the `@Transactional` method that performs the write.
The row change and the outbox row then commit together. It also captures writes that never pass
through user-service at all — tenant provisioning creates the first OWNER by calling auth-service
directly.

`USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `USER_REACTIVATED`, `ROLE_GRANTED`,
`ROLE_REVOKED`, via typed records in `shared-lib` and the existing outbox.

### D-6 (LOCKED) — No credential in any payload, enforced at both ends

Producer side: the payload records have no field a credential could occupy, and
`EventPayloadNoCredentialsTest` asserts it reflectively plus over the sources, so a future
`tempPassword` field fails the build.

Consumer side (added mid-phase, see D-9): `CredentialRedactor` strips credential-named values at
ingestion. Both use **one definition** of what a credential field name looks like, so a term added
for one cannot be missing from the other.

The detector splits camelCase into words rather than matching substrings, after its first run
flagged `tillSessionId` (a till's business id) and `PasswordResetRequestedPayload.tokenId` — which is
D-19's *fix*, a row handle rather than the token. A check that cries wolf on correct code is a check
somebody turns off.

### D-7 (LOCKED) — The audit read API takes no tenant parameter

**Decision:** `GET /api/v1/audit/events` derives the tenant from `TenantContext` — the verified JWT
claim — and has **no tenant parameter at all**. That is the whole of the cross-tenant control and it
is structural: there is no code path that could be persuaded to read another tenant's rows, because
there is nothing for a caller to influence. `AuditReadPathIT` asserts it twice — behaviourally, and
reflectively over the method signature.

The pre-existing `/internal/audit/events` takes `tenantId` as a query parameter. That is defensible
only because the secret gating it is held by services rather than users; repeating the shape on a
user-facing endpoint would have made every tenant admin a reader of every other tenant's audit log.
`/internal/**` is deliberately **not** routed at the gateway.

### D-8 (LOCKED) — `audit.log.view`, granted to OWNER and TENANT_ADMIN only

Reading the audit log is implied by no existing capability: it shows every login, void, refund, role
change and password reset in the tenant, including the reader's own. It is both the surface a
compromised administrator account would most want and the record that would expose the compromise.

MANAGER is deliberately excluded. A manager holds `pos.order.void.any` and `finance.expense.approve`
— a manager is a *subject* of this log, and a manager who could also read it could see whether
anyone had looked, which is the one property an audit trail must not have. ACCOUNTANT likewise: a
financial reviewer needs the ledger, not the security log. If either turns out to be wrong it is one
grant to add, and adding a grant later is recoverable in a way that un-disclosing a log is not.

The route is **not** in `PUBLIC_PATHS` and `TENANT_OPTIONAL_PATHS` is untouched.

### D-9 (LOCKED, added mid-execution) — audit-service does not trust its producers

Discovered by running the fix rather than reading it. Draining the 3,202-message backlog carried
**three raw password-reset tokens** into `audit_events` — from pre-D-19 messages that had been
sitting in the broker since before 13-09 removed the raw token from that payload. The producer-side
rule was correct, current, and did not help, because the messages predated it.

The general shape matters more than the incident: audit-service consumes from nine exchanges and ten
services it does not control, over a broker that holds messages indefinitely. Any payload it writes
may have been authored by code that no longer exists, under rules that have since changed. **A
consumer that assumes its producers are current is assuming something it cannot check** — and this
consumer writes to the one table in the system that cannot be corrected afterwards.

**Decision:** redact at ingestion, before the row exists. Redacted rather than dropped — the key
survives with the value replaced, because a redaction and an absence are different facts and an
auditor should be able to tell them apart.

### D-10 (LOCKED) — Impersonation comes from the signed claim, never the header

The brief noted `X-Impersonated-By` is propagated by the gateway and read by no service.

**Decision:** wire impersonation into the audit record from the **`impersonated_by` JWT claim** (via
`TenantContext`), not from the header. The gateway does emit the header, but it is transport and the
claim is signature-verified end to end; reading the header would make the field only as trustworthy
as the weakest hop that could set it.

`audit_events` gains an `impersonated_by` column **alongside** `user_id`, not replacing it.
`user_id` stays the account acted AS; `impersonated_by` is the real human. Both are needed:
attributing the action solely to the impersonated account is the D-34 defect that recorded every user
in `impersonation_logs` as their own impersonator.

### D-11 (RESOLVED) — Historical events are not recoverable, and this is stated plainly

Every one of the 2,575 rows recovered from the backlog carries `source: "shared-lib"`, because that
is what was recorded at publish time. **No fix can recover the true origin of an event that never
had it written down.** The backlog drained and produced rows; those rows are attributable by type,
actor (where the payload named one) and timestamp, and are **not** attributable by service. Nothing
in this phase should be read as recovering history.
</decisions>

<open-questions>
## Deferred, with owners

| Ref | Item | Why not now |
|---|---|---|
| **W-15-01** | 3 audit rows (id 109, 112, 117) carry raw pre-D-19 reset tokens | Removing them means deliberately breaking append-only. That is a decision for the user, not the executor — see 15-01-SUMMARY §7 |
| **W-15-02** | `ROLE_REVOKED` records a null actor | `AuthInternalClient.revokeBranchRole` sends no `X-Acting-User-Id`, unlike every other write. Fixing it changes the internal Feign contract + user-service; recorded honestly as null in the meantime |
| **W-15-03** | audit-service is not in `deploy/docker-compose.yml` | "The consumer is running" is a property of a dev script, not the deployment topology (RESEARCH M7) |
| **W-15-04** | No `PERMISSION_DENIED` audit hook | Needs a shared `@ControllerAdvice` in shared-lib and a feedback-loop guard (RESEARCH H2/W1-8) |
| **W-15-05** | `AuditArchivalService` cannot manage partitions as `audit_writer` | Latent until 2027-01 (RESEARCH M2/W1-9) |
| **W-15-06** | `/internal/audit/events` has no tenant authorization | Secret-holder reads any tenant. Mitigated by not routing it at the edge (RESEARCH H7) |
| **W-15-07** | Retention/volume sizing | `ALWAYS_AUDIT_SOURCES` now works, so auth-service volume rises sharply. RESEARCH open question 2 — needs a compliance-regime answer first |
</open-questions>
