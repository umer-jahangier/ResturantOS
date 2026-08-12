# platform_db: least privilege, and the impersonation read path

**Status:** design settled, build not started.
**Date:** 2026-08-12.

> **Provenance, stated plainly.** Two agents investigated these live and produced ~21 KB and ~15 KB
> of findings. Their reports were **lost to a tool failure that was my fault** — I gave them an
> output schema that wanted long prose in single string fields, and the payloads failed to parse
> five times each. Only the opening ~2 KB of each survived in the transcript. What follows is
> **recovered, and therefore partial**. Every measurement below is quoted from what survived; the
> supporting detail behind some of it is gone. Where something is incomplete it says so.
>
> The lesson is recorded in [`../FLEET-LOG.md`](../FLEET-LOG.md): a structured-output schema is a
> place for *short* fields and a **file path**, not for a report.

---

## Part 1 — Least privilege in platform_db

### The finding, reproduced by a real login (not `SET ROLE`)

`platform_user` — the role platform-admin-service connects as — is a member of `platform_admin`,
which owns every table. Measured on `restaurantos-postgres` 18.4, over the container socket:

```
BEGIN; DELETE FROM impersonation_log;   ROLLBACK;  ->  DELETE 0   (privilege check PASSED)
BEGIN; TRUNCATE impersonation_log;      ROLLBACK;  ->  ERROR: IMPERSONATION_LOG_IMMUTABLE
```

`role_table_grants` reports `INSERT, REFERENCES, SELECT, TRIGGER`.
`has_table_privilege(… 'DELETE')` returns **true**.
`pg_has_role('platform_user','platform_admin','USAGE')` returns **true**.

So **DELETE is permitted by the grant layer and stopped by nothing; TRUNCATE is stopped by the
trigger.** The catalogue view a reviewer would check reports a control that enforces nothing.

### The RLS trap, made executable

The agent built an isolated probe database (`lp_probe`) reproducing the topology — owner owns the
table, runtime is a member — then removed the membership and measured both sides. **The probe was
created and dropped; the shared `platform_db` was never mutated.** That is the right way to run this
experiment and it is worth copying.

| | membership present | membership revoked |
|---|---|---|
| `has_table_privilege(… DELETE)` | `t` | `f` |
| real login `DELETE` | `DELETE 1` | `ERROR: permission denied` |
| `ENABLE RLS` (no FORCE), GUC `''` | runtime sees **1 row** | runtime sees **0 rows** |
| runtime `INSERT` under that policy | allowed | `ERROR: new row violates row-level security policy` |

**Today, `ALTER TABLE … ENABLE ROW LEVEL SECURITY` anywhere in platform_db changes nothing at all.**
Not "is weak" — changes nothing. This is the same defect that shipped 33 tables with inert RLS across
16 tenants, pre-armed for whoever adds the first policy here.

### The trap that would make the fix inert too

The highest-value finding, and the one most likely to be skipped:

> With the membership fully revoked and least-privilege grants written per table, a table created
> **afterwards** still came back with `DELETE` and `TRUNCATE` for the runtime role — because of
> `ALTER DEFAULT PRIVILEGES`.

So a per-table grant sweep fixes today's tables and **silently re-widens on the next migration**.
Any fix must address default privileges, not just current grants, or it becomes another control that
reads correctly and enforces nothing. *(The full detail of the recommended `ALTER DEFAULT PRIVILEGES`
form was in the lost portion and needs re-deriving.)*

### The decision

**Split the identity. Do not revoke the membership as the first move.**

Adopt audit-service's shape verbatim — a migration/owner identity that is *not* the runtime identity,
delivered through Spring Boot's second Liquibase datasource. The membership revoke then becomes safe
**as a consequence, not as a cause**.

It is fixable. It is a **two-phase rollout**, not a one-line change.

Why not simply revoke: `deploy/init/02b-ensure-runtime-roles.sql:71-89` grants the membership
deliberately, because tables are owned by `platform_admin` on machines where that role was created by
hand while both the service *and* Liquibase connect as `platform_user` — so any migration that
`ALTER`s an existing table fails without it. And on a **clean** machine `02b` is a no-op and
`platform_user` owns the tables outright, which is inert for the same reason by a different route.
**There is no deployment shape in which a grant-based control on platform_db works today.**

---

## Part 2 — The impersonation read path

### The finding was inverted, and this was measured

The agent drove **two real impersonations through the gateway**
(`superadmin@softxlogic.com` → `cashier@terrace.local`, tenant `floating-terrace`);
`impersonation_log` went from 0 rows to 2. Then:

**The tenant-facing half is already shipped and working.** The chain fires end to end —
`impersonation_log` row written, `platform_db.event_outbox` `IMPERSONATION_STARTED` at status `SENT`,
`audit_db.audit_events` id 12270 with `tenant_id` = the **target** tenant, `resource_type=IMPERSONATION`,
`impersonated_by=adminUserId`. Over real HTTP:

| principal | call | result |
|---|---|---|
| Floating Terrace OWNER | `GET /api/v1/audit/events?action=IMPERSONATION_STARTED` | **200, totalCount 1**, the row |
| Control Bistro OWNER | same | **200, totalCount 0** (cross-tenant negative control) |
| SUPER_ADMIN | same | **401** |
| SUPER_ADMIN | `GET /api/v1/platform/tenants/{id}/impersonations` | **404** |

> **The only principal with no read path is the platform SuperAdmin — the inverse of what the
> original finding assumed.**

This is why the brief's "check before duplicating" step mattered: building a tenant-facing view would
have duplicated a working one.

### Why the SuperAdmin read still belongs on platform_db

`audit_events` is per-tenant with **FORCED** RLS, so *"every impersonation by admin X across all
tenants"* is **structurally unanswerable** there without iterating 21 tenants with 21 tokens.
`impersonation_log` answers it in one query, and is the immutable record written in the same
transaction that mints the token.

Split by the question being asked:

- *"Who came into **my** restaurant?"* → **audit-service. Already built. Do not rebuild.**
- *"Where has **admin X** been?"* → **platform_db. Build this.**

### The shape

```
GET /api/v1/platform/tenants/{tenantId}/impersonations
GET /api/v1/platform/impersonations?adminUserId=&from=&to=
```

On `PlatformAdminController`, inheriting the class-level `@PreAuthorize("hasAuthority('SUPER_ADMIN')")`.
`ApiResponse.paginated` + `PageMeta`, matching `AuditQueryController`. Unknown `tenantId` → **404**.
**Never return the token.**

**Derive status from `expires_at` (ACTIVE/EXPIRED), never from `ended_at`.** *(The reasoning was
numbered (5) in the lost portion. The conclusion is unambiguous and consistent with `ended_at` having
no writer anywhere in the product — so a status derived from it would read ACTIVE forever.)*

### Explicit non-goals

- **Do not build anything tenant-facing** — it exists and works.
- **Do not give `ended_at` a writer.** If that changes later, the grant it needs is column-scoped and
  nothing wider: `GRANT UPDATE (ended_at) ON impersonation_log TO platform_user;` — the immutability
  trigger already permits exactly that transition and nothing else, so the two agree. Note this grant
  is inert today for the reasons in Part 1.

---

## What is NOT settled

- The exact `ALTER DEFAULT PRIVILEGES` form for Part 1 — lost with the report, needs re-deriving.
- The console screen for Part 2.
- Whether a tenant's own OWNER should see impersonations of their users **beyond** what
  audit-service already gives them. Product decision; not answered here.
