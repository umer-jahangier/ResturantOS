# RestaurantOS — Document 8: Database Migration Guide (Liquibase)

> Every Java service uses Liquibase for schema management. Migrations run on service startup; startup fails if migration fails (intentional, spec D1.5). XML format is mandatory (not SQL or YAML changelogs) for consistent rollback support.

## 8.1 Changelog Directory Structure

Under `src/main/resources/db/changelog/`:

```
db/changelog/
├── db.changelog-master.xml
└── changes/
    ├── v1.0.0/
    │   ├── 001-create-orders-table.xml
    │   ├── 002-enable-rls-orders.xml
    │   ├── 003-create-order-items-table.xml
    │   ├── 004-add-order-indexes.xml
    │   └── 005-seed-default-data.xml
    └── v1.0.1/
        └── 001-add-client-order-id-column.xml
```

Rule: one logical change per file. The numeric prefix is the execution order within a version folder. The RLS changeset for a table immediately follows that table's create changeset (§8.6).

## 8.2 Master Changelog

```xml
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
        xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
            http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.29.xsd">

    <includeAll path="db/changelog/changes/v1.0.0/" relativeToChangelogFile="false"/>
    <includeAll path="db/changelog/changes/v1.0.1/" relativeToChangelogFile="false"/>

</databaseChangeLog>
```

Rule: add a new `<includeAll>` line per new version folder, in ascending version order.

## 8.3 Changeset Naming Convention

Changeset `id` format: `{service-name}-{version}-{sequence}-{description}`, e.g. `pos-1.0.0-001-create-orders-table`. `author` is always `restaurantos-agent`.

Create table:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<databaseChangeLog
        xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
            http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.29.xsd">

    <changeSet id="pos-1.0.0-001-create-orders-table" author="restaurantos-agent">
        <createTable tableName="orders">
            <column name="id" type="UUID" defaultValueComputed="gen_random_uuid()">
                <constraints primaryKey="true" nullable="false"/>
            </column>
            <column name="tenant_id" type="UUID"><constraints nullable="false"/></column>
            <column name="branch_id" type="UUID"><constraints nullable="false"/></column>
            <column name="order_no" type="TEXT"><constraints nullable="false"/></column>
            <column name="type" type="TEXT"><constraints nullable="false"/></column>
            <column name="status" type="TEXT"><constraints nullable="false"/></column>
            <column name="table_id" type="UUID"/>
            <column name="customer_id" type="UUID"/>            <!-- CRIT-03 fix -->
            <column name="cover_count" type="INTEGER"/>
            <column name="cashier_id" type="UUID"><constraints nullable="false"/></column>
            <column name="till_session_id" type="UUID"><constraints nullable="false"/></column>
            <column name="subtotal_paisa" type="BIGINT" defaultValueNumeric="0"><constraints nullable="false"/></column>
            <column name="tax_paisa" type="BIGINT" defaultValueNumeric="0"><constraints nullable="false"/></column>
            <column name="discount_paisa" type="BIGINT" defaultValueNumeric="0"><constraints nullable="false"/></column>
            <column name="service_charge_paisa" type="BIGINT" defaultValueNumeric="0"><constraints nullable="false"/></column>
            <column name="total_paisa" type="BIGINT" defaultValueNumeric="0"><constraints nullable="false"/></column>
            <column name="notes" type="TEXT"/>
            <column name="opened_at" type="TIMESTAMPTZ" defaultValueComputed="NOW()"><constraints nullable="false"/></column>
            <column name="sent_to_kds_at" type="TIMESTAMPTZ"/>
            <column name="closed_at" type="TIMESTAMPTZ"/>
            <column name="voided_at" type="TIMESTAMPTZ"/>
            <column name="void_reason" type="TEXT"/>
            <column name="client_order_id" type="UUID"/>
            <column name="version" type="BIGINT" defaultValueNumeric="0"><constraints nullable="false"/></column>
            <column name="created_at" type="TIMESTAMPTZ" defaultValueComputed="NOW()"><constraints nullable="false"/></column>
            <column name="updated_at" type="TIMESTAMPTZ" defaultValueComputed="NOW()"><constraints nullable="false"/></column>
            <column name="created_by" type="UUID"/>
            <column name="updated_by" type="UUID"/>
            <column name="deleted_at" type="TIMESTAMPTZ"/>
        </createTable>

        <addUniqueConstraint tableName="orders" columnNames="client_order_id"
                             constraintName="uq_orders_client_order_id"/>

        <rollback>
            <dropTable tableName="orders"/>
        </rollback>
    </changeSet>

</databaseChangeLog>
```

Add a column:

```xml
<changeSet id="pos-1.0.1-001-add-client-order-id-column" author="restaurantos-agent">
    <addColumn tableName="orders">
        <column name="client_order_id" type="UUID"/>
    </addColumn>
    <rollback>
        <dropColumn tableName="orders" columnName="client_order_id"/>
    </rollback>
</changeSet>
```

Add an index:

```xml
<changeSet id="pos-1.0.0-004-add-order-indexes" author="restaurantos-agent">
    <createIndex tableName="orders" indexName="idx_orders_tenant_branch_status">
        <column name="tenant_id"/>
        <column name="branch_id"/>
        <column name="status"/>
    </createIndex>
    <createIndex tableName="orders" indexName="idx_orders_open_opened_at">
        <column name="status"/>
        <column name="opened_at"/>
    </createIndex>
    <rollback>
        <dropIndex tableName="orders" indexName="idx_orders_tenant_branch_status"/>
        <dropIndex tableName="orders" indexName="idx_orders_open_opened_at"/>
    </rollback>
</changeSet>
```

Insert seed data:

```xml
<changeSet id="finance-1.0.0-010-seed-coa-system-accounts" author="restaurantos-agent" runOnChange="false">
    <insert tableName="chart_of_accounts">
        <column name="tenant_id" valueComputed="'00000000-0000-0000-0000-000000000000'"/>
        <column name="code" value="1010"/>
        <column name="name" value="Cash on Hand"/>
        <column name="account_type" value="ASSET"/>
        <column name="is_system" valueBoolean="true"/>
        <column name="system_tag" value="CASH"/>
    </insert>
    <rollback>
        <delete tableName="chart_of_accounts">
            <where>code='1010' AND tenant_id='00000000-0000-0000-0000-000000000000'</where>
        </delete>
    </rollback>
</changeSet>
```

## 8.4 Required Columns Rule

Every tenant-scoped table must include the standard columns from `TenantAuditableEntity`: `tenant_id`, `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` (plus `version` for editable entities).

Practical rule for agents: include the five audit columns (plus `tenant_id`, plus `version` if editable) directly in every `createTable` changeset, exactly as shown in §8.3. The CI entity-scan test (BLR-2) fails the build if any entity extending `TenantAuditableEntity` maps to a table missing these columns. This is simpler and more reviewable than parameterised includes.

## 8.5 Rollback Policy

Every changeset must have a `<rollback>` block:

| Change | Rollback |
|---|---|
| `createTable` | `dropTable` |
| `addColumn` | `dropColumn` |
| `createIndex` | `dropIndex` |
| `addUniqueConstraint` | `dropUniqueConstraint` |
| `createProcedure`/raw SQL | explicit reverse SQL in `<rollback>` |
| `insert` (seed) | `delete` with the same `where` |

Destructive migrations require a `-- DESTRUCTIVE` comment and a data-preservation step before the drop:

```xml
<changeSet id="hr-1.2.0-003-drop-legacy-salary-column" author="restaurantos-agent">
    <!-- DESTRUCTIVE: preserves data before dropping. -->
    <sql>
        CREATE TABLE IF NOT EXISTS employees_legacy_salary_archive AS
        SELECT id, tenant_id, legacy_salary_paisa, NOW() AS archived_at
        FROM employees WHERE legacy_salary_paisa IS NOT NULL;
    </sql>
    <dropColumn tableName="employees" columnName="legacy_salary_paisa"/>
    <rollback>
        <addColumn tableName="employees">
            <column name="legacy_salary_paisa" type="BIGINT"/>
        </addColumn>
        <sql>
            UPDATE employees e SET legacy_salary_paisa = a.legacy_salary_paisa
            FROM employees_legacy_salary_archive a WHERE a.id = e.id;
        </sql>
    </rollback>
</changeSet>
```

## 8.6 RLS Policy Changeset (and the deferred JE balance trigger — resolves CRIT-02)

Immediately after a tenant-scoped table's `createTable`, enable RLS, force it, create the isolation policy, and grant the service role:

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

For `finance_db`, the JE balance check MUST be a deferred constraint trigger so it evaluates at commit, after all lines are inserted (CRIT-02 fix):

```xml
<changeSet id="finance-1.0.0-020-je-balance-deferred-trigger" author="restaurantos-agent">
    <sql splitStatements="false">
        CREATE OR REPLACE FUNCTION check_je_balance() RETURNS trigger AS $$
        DECLARE
            v_debit  BIGINT;
            v_credit BIGINT;
        BEGIN
            SELECT COALESCE(SUM(debit_paisa),0), COALESCE(SUM(credit_paisa),0)
              INTO v_debit, v_credit
              FROM journal_lines
             WHERE je_id = COALESCE(NEW.je_id, OLD.je_id);
            IF v_debit &lt;&gt; v_credit THEN
                RAISE EXCEPTION 'Journal entry % is not balanced: debit=% credit=%',
                    COALESCE(NEW.je_id, OLD.je_id), v_debit, v_credit;
            END IF;
            RETURN NULL;
        END;
        $$ LANGUAGE plpgsql;
    </sql>
    <sql splitStatements="true" endDelimiter=";">
        CREATE CONSTRAINT TRIGGER trg_je_balance
            AFTER INSERT OR UPDATE OR DELETE ON journal_lines
            DEFERRABLE INITIALLY DEFERRED
            FOR EACH ROW EXECUTE FUNCTION check_je_balance();
    </sql>
    <rollback>
        <sql splitStatements="true" endDelimiter=";">
            DROP TRIGGER IF EXISTS trg_je_balance ON journal_lines;
            DROP FUNCTION IF EXISTS check_je_balance();
        </sql>
    </rollback>
</changeSet>
```

Audit immutability (INSERT-only) for the audit service:

```xml
<changeSet id="audit-1.0.0-005-audit-immutability" author="restaurantos-agent">
    <sql splitStatements="true" endDelimiter=";">
        REVOKE UPDATE, DELETE ON audit_events FROM audit_user;
        GRANT INSERT, SELECT ON audit_events TO audit_user;

        CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $func$
        BEGIN
            RAISE EXCEPTION 'audit_events is append-only; % is not permitted', TG_OP;
        END;
        $func$ LANGUAGE plpgsql;

        CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_events
            FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();
    </sql>
    <rollback>
        <sql splitStatements="true" endDelimiter=";">
            DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_events;
            DROP FUNCTION IF EXISTS block_audit_mutation();
        </sql>
    </rollback>
</changeSet>
```

## 8.7 Seed Data Changesets

Seed data uses `runOnChange="false"` so it executes exactly once, and `context="seed"` so it can be excluded from environments that don't want it.

```xml
<changeSet id="auth-1.0.0-030-seed-system-roles" author="restaurantos-agent" runOnChange="false" context="seed">
    <insert tableName="roles">
        <column name="code" value="OWNER"/>
        <column name="name" value="Owner"/>
        <column name="is_system" valueBoolean="true"/>
    </insert>
    <insert tableName="roles">
        <column name="code" value="BRANCH_MANAGER"/>
        <column name="name" value="Branch Manager"/>
        <column name="is_system" valueBoolean="true"/>
    </insert>
    <!-- ... CASHIER, CHEF, ACCOUNTANT, INVENTORY_MANAGER, HR_MANAGER, CRM_MANAGER ... -->
    <rollback>
        <delete tableName="roles"><where>is_system = true</where></delete>
    </rollback>
</changeSet>
```

Note: tenant-specific seed data is created via the provisioning API (Document 11), NOT via Liquibase. Liquibase seeds only system-global rows and the templates used by provisioning.

## 8.9 Shared Infrastructure Tables (MUST exist in every service)

`shared-lib` defines three JPA entities but ships NO migrations (Document 3 §3.10). Every service must create the tables its responsibilities require, or the service will fail at runtime (Hibernate `ddl-auto` is `none` / `validate`). These tables are NOT tenant-scoped and get NO RLS policy — the outbox relay and idempotency/dedup checks run outside a tenant request context.

Decision matrix:

| Table | Required in services that... | Backing entity |
|---|---|---|
| `event_outbox` | publish any event (POS, Inventory, Finance, Purchasing, HR, Auth, Platform, Kitchen) | `OutboxEntry` |
| `idempotency_keys` | expose mutating endpoints needing `Idempotency-Key` (POS, Finance, Purchasing, HR, Inventory) | `IdempotencyKey` |
| `processed_events` | consume any event (Inventory, Finance, CRM, Reporting, Kitchen, Notification, Audit) | (consumer-managed) |

Place these in a `_shared` changeset file included early in each service's `v1.0.0` folder, e.g. `000-create-shared-infra-tables.xml` (run before business tables so the outbox/idempotency wiring is available):

```xml
<changeSet id="pos-1.0.0-000-create-event-outbox" author="restaurantos-agent">
    <createTable tableName="event_outbox">
        <column name="id" type="UUID" defaultValueComputed="gen_random_uuid()">
            <constraints primaryKey="true" nullable="false"/>
        </column>
        <column name="event_id" type="UUID"><constraints nullable="false"/></column>
        <column name="exchange" type="TEXT"><constraints nullable="false"/></column>
        <column name="routing_key" type="TEXT"><constraints nullable="false"/></column>
        <column name="event_type" type="TEXT"><constraints nullable="false"/></column>
        <column name="tenant_id" type="UUID"><constraints nullable="false"/></column>
        <column name="branch_id" type="UUID"/>
        <column name="correlation_id" type="UUID"><constraints nullable="false"/></column>
        <column name="source" type="TEXT"><constraints nullable="false"/></column>
        <column name="envelope_json" type="TEXT"><constraints nullable="false"/></column>
        <column name="status" type="TEXT" defaultValue="PENDING"><constraints nullable="false"/></column>
        <column name="created_at" type="TIMESTAMPTZ" defaultValueComputed="NOW()"><constraints nullable="false"/></column>
        <column name="sent_at" type="TIMESTAMPTZ"/>
    </createTable>
    <!-- Index for the relay's poll query: WHERE status='PENDING' ORDER BY created_at -->
    <createIndex tableName="event_outbox" indexName="idx_event_outbox_status_created">
        <column name="status"/>
        <column name="created_at"/>
    </createIndex>
    <sql>GRANT SELECT, INSERT, UPDATE, DELETE ON event_outbox TO pos_user;</sql>
    <rollback>
        <dropIndex tableName="event_outbox" indexName="idx_event_outbox_status_created"/>
        <dropTable tableName="event_outbox"/>
    </rollback>
</changeSet>

<changeSet id="pos-1.0.0-000b-create-idempotency-keys" author="restaurantos-agent">
    <createTable tableName="idempotency_keys">
        <column name="idem_key" type="VARCHAR(200)"><constraints primaryKey="true" nullable="false"/></column>
        <column name="request_hash" type="VARCHAR(64)"><constraints nullable="false"/></column>
        <column name="status" type="VARCHAR(20)"><constraints nullable="false"/></column>
        <column name="response_json" type="TEXT"/>
        <column name="created_at" type="TIMESTAMPTZ" defaultValueComputed="NOW()"><constraints nullable="false"/></column>
        <column name="expires_at" type="TIMESTAMPTZ"><constraints nullable="false"/></column>
    </createTable>
    <createIndex tableName="idempotency_keys" indexName="idx_idempotency_expires_at">
        <column name="expires_at"/>
    </createIndex>
    <sql>GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO pos_user;</sql>
    <rollback>
        <dropIndex tableName="idempotency_keys" indexName="idx_idempotency_expires_at"/>
        <dropTable tableName="idempotency_keys"/>
    </rollback>
</changeSet>

<changeSet id="inventory-1.0.0-000c-create-processed-events" author="restaurantos-agent">
    <!-- Consumer-side dedup table (Document 2 §2.4). PK is (consumer, event_id). -->
    <createTable tableName="processed_events">
        <column name="consumer" type="TEXT"><constraints nullable="false"/></column>
        <column name="event_id" type="UUID"><constraints nullable="false"/></column>
        <column name="source_type" type="TEXT"/>
        <column name="source_id" type="UUID"/>
        <column name="processed_at" type="TIMESTAMPTZ" defaultValueComputed="NOW()"><constraints nullable="false"/></column>
    </createTable>
    <addPrimaryKey tableName="processed_events" columnNames="consumer, event_id"
                   constraintName="pk_processed_events"/>
    <sql>GRANT SELECT, INSERT ON processed_events TO inventory_user;</sql>
    <rollback>
        <dropTable tableName="processed_events"/>
    </rollback>
</changeSet>
```

Substitute the correct service role in each `GRANT` (`finance_user`, `purchasing_user`, etc.). A periodic job (or a scheduled `DELETE FROM idempotency_keys WHERE expires_at < NOW()`) garbage-collects expired idempotency rows; sent outbox rows older than 7 days may likewise be pruned.

## 8.11 System Config Tables Required Before Their Module Ships

Two config tables are referenced by the source spec but have no DDL there; define them when their module's sprint begins (NOT needed for the Phase-1 kickoff — Auth/User/Authz/Gateway/Platform/Frontend shell — but listed here so they are not forgotten):

- `finance_db.accounting_periods` — created in the Finance sprint; provisioning seeds 12 `OPEN` periods per fiscal year (Pakistan FY = July–June). Columns: `id, tenant_id, branch_id, fiscal_year, period_no, start_date, end_date, status (OPEN|LOCKED|CLOSED), closed_by, closed_at` + audit columns.
- `hr_db.tax_config` — created in the HR/Payroll sprint; holds Pakistan income-tax slabs and EOBI minimum-wage, updated annually via config (never code). Columns: `id, tenant_id (nullable for platform-default), fiscal_year, slab_no, lower_bound_paisa, upper_bound_paisa, fixed_tax_paisa, marginal_rate_bps, eobi_min_wage_paisa, effective_from, effective_to` + audit columns. Seed the current FY's slabs as part of the HR sprint's seed changeset.

## 8.12 Common Mistakes

1. Mutable changeset — editing a changeset after it has run (Liquibase detects the checksum change and fails startup). Correct: never edit an applied changeset; add a NEW changeset in a new file.

2. Missing rollback. Correct: always provide the inverse (table 8.5).

3. `TIMESTAMP` instead of `TIMESTAMPTZ`:

```xml
<column name="closed_at" type="TIMESTAMP"/>   <!-- WRONG -->
<column name="closed_at" type="TIMESTAMPTZ"/> <!-- CORRECT -->
```

4. `DECIMAL`/`NUMERIC` for money:

```xml
<column name="total" type="NUMERIC(12,2)"/>      <!-- WRONG: money must be BIGINT paisa -->
<column name="total_paisa" type="BIGINT"/>        <!-- CORRECT -->
```
(Exception: inventory quantities are `NUMERIC(18,4)` — those are quantities, not money.)

5. Forgetting the RLS changeset after a tenant-scoped `createTable`, or using `CASCADE DELETE` toward financial records. Financial tables use `ON DELETE RESTRICT`; soft-delete via `deleted_at`; every tenant-scoped table gets its RLS changeset immediately after creation.
