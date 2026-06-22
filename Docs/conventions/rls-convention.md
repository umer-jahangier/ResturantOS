# Row-Level Security (RLS) Convention

> **Normative.** Every engineer authoring a Liquibase migration for a tenant-scoped table MUST follow this convention. Deviation fails the build (see `AbstractRlsCoverageTest`).

## 1. The Mandatory Sequence

Immediately after every tenant-scoped `createTable` changeset, add an RLS changeset in the **next file** (e.g. `002-enable-rls-orders.xml` directly after `001-create-orders-table.xml`). The sequence is always:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <table>
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON <table> TO <svc>_user;
```

### In Liquibase XML

```xml
<changeSet id="pos-1.0.0-002-enable-rls-orders" author="restaurantos-agent">
    <sql splitStatements="true" endDelimiter=";">
        ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
        ALTER TABLE orders FORCE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation ON orders
            USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
        GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO pos_user;
    </sql>
    <rollback>
        <sql splitStatements="true" endDelimiter=";">
            DROP POLICY IF EXISTS tenant_isolation ON orders;
            ALTER TABLE orders NO FORCE ROW LEVEL SECURITY;
            ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
        </sql>
    </rollback>
</changeSet>
```

The changeset ID follows the pattern: `{service}-{version}-{seq}-enable-rls-{table}`.

## 2. The Four Steps Explained

| Step | SQL | Why |
|------|-----|-----|
| ENABLE ROW LEVEL SECURITY | `ALTER TABLE t ENABLE ROW LEVEL SECURITY` | Activates the RLS machinery on the table |
| FORCE ROW LEVEL SECURITY | `ALTER TABLE t FORCE ROW LEVEL SECURITY` | Applies policies even to the table owner (postgres superuser bypasses without FORCE; service roles are `NOBYPASSRLS` but FORCE is defence-in-depth) |
| CREATE POLICY | `CREATE POLICY tenant_isolation ON t USING (...)` | The actual row filter; `current_setting('app.current_tenant_id', true)` reads the transaction-local GUC set by `TenantFilterInterceptor` / `TenantAwareMessageProcessor` |
| GRANT | `GRANT SELECT, INSERT, UPDATE, DELETE ON t TO <svc>_user` | DML permissions for the service role; without this the role cannot touch the table at all |

## 3. How the Tenant GUC Is Set

Service roles are `NOSUPERUSER NOBYPASSRLS` (see `deploy/init/02-create-roles.sql`). They **cannot** bypass RLS. The `app.current_tenant_id` GUC is set **per-transaction** (not statically via `ALTER ROLE SET`):

- **HTTP requests** — `TenantFilterInterceptor.preHandle()` calls `set_config('app.current_tenant_id', tenantId, true)` on the Hibernate session connection. The `true` flag makes it transaction-local; it resets when the connection returns to the pool.
- **RabbitMQ consumers** — `TenantAwareMessageProcessor.process()` does the same inside the consumer `@Transactional`.
- **`@Async` tasks** — `TenantTaskDecorator` propagates the `TenantContext` snapshot; the first service call that opens a transaction repeats the `set_config`.

## 4. RLS-Exempt Infrastructure Tables

The following three tables are intentionally **NOT** tenant-scoped and MUST NOT receive an RLS policy:

| Table | Reason |
|-------|--------|
| `event_outbox` | The outbox relay runs outside a tenant request context; tenant is stored in the envelope payload |
| `idempotency_keys` | Idempotency checks cross tenant boundaries (gateway-level dedup) |
| `processed_events` | Consumer-side dedup; keyed by `(consumer, event_id)`, not tenant |

`AbstractRlsCoverageTest` automatically excludes these three tables from its coverage check.

## 5. Money, Timestamps, and Financial FK Rules

From agent-spec 08 §8.12 — applied to every table in every service:

| Concern | Rule |
|---------|------|
| **Money** | Always `BIGINT paisa` (1 PKR = 100 paisa). Never `DECIMAL`/`NUMERIC`/`FLOAT` for monetary values. Exception: inventory quantities use `NUMERIC(18,4)`. |
| **Timestamps** | Always `TIMESTAMPTZ`. Never `TIMESTAMP` (timezone-naive). |
| **Financial FKs** | Use `ON DELETE RESTRICT` + soft-delete via `deleted_at`. Never `CASCADE DELETE` toward financial records. |

## 6. Seeding Under FORCE RLS (Pitfall — Relevant for Finance/HR)

When inserting seed rows into a table that has `FORCE ROW LEVEL SECURITY` enabled, the `app.current_tenant_id` GUC must be set for the INSERT to pass the policy:

```sql
-- Seed approach 1: set GUC before seeding
SELECT set_config('app.current_tenant_id', '00000000-0000-0000-0000-000000000000', true);
INSERT INTO chart_of_accounts (...) VALUES (...);

-- Seed approach 2: seed BEFORE enabling RLS (in the createTable changeset, before the RLS changeset runs)
```

The system-default tenant UUID `00000000-0000-0000-0000-000000000000` is used for platform-wide seeds (e.g., Chart of Accounts system accounts in Finance). This pitfall is **not relevant for Phase 1** but becomes important for Finance and HR seeds in later phases.

## 7. Build Guard

`AbstractRlsCoverageTest` (in `shared-lib/src/test/.../testsupport/`) runs after Liquibase against a Testcontainers Postgres instance. It:

1. Queries `information_schema.columns` for tables with a `tenant_id` column.
2. Excludes `event_outbox`, `idempotency_keys`, `processed_events`.
3. For each remaining table, asserts `relrowsecurity = true` AND `relforcerowsecurity = true` (via `pg_class`) AND at least one policy exists (via `pg_policies`).
4. Fails `mvn verify` with a list of every offending table if any assertion fails.

**A tenant-scoped table without an immediate RLS changeset breaks the build.** (SC4)
