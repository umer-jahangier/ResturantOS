# Phase 25 — items found but deliberately NOT fixed here

Each entry says what it is, why it is out of this phase's scope, and what it costs to leave.

---

## 1. hr-service will not start: `015b-backfill-from-free-text` dies on any database with a session GUC

**Found:** 2026-08-12, during 25-06, restarting hr-service onto a fresh jar to apply changelog 034.
**Owner:** plan 35-05 (tenant-managed department and designation lists), commits `e048ad66` / `7d06ebb7`.
**Severity: BLOCKING.** hr-service is currently DOWN and cannot start. This is on committed HEAD, so
the next restart by *any* agent hits it — it was not caused by 25-06 and 25-06 cannot route around it.

```
Migration failed for changeset
  db/changelog/v1.0.0/015-employee-department-designation-fk.xml::hr-1.0.0-015b-backfill-from-free-text
Reason: ERROR: invalid input syntax for type uuid: ""
  Where: SQL statement "SELECT DISTINCT tenant_id FROM employees"
         PL/pgSQL function inline_code_block line 5 at FOR over SELECT rows
```

Reproduced in one command against the live `hr_db`:

```
$ docker exec restaurantos-postgres psql -U hr_user -d hr_db -c "
    SELECT set_config('app.current_tenant_id','',false);
    SELECT count(*) FROM employees;"
 set_config
------------

ERROR:  invalid input syntax for type uuid: ""
```

**Why it happens.** The changeset's comment states its assumption plainly — *"Liquibase runs as hr_user
with NO tenant context"*. The assumption is wrong in one specific way: the connection Liquibase is
handed does not carry *no* tenant, it carries the **empty string**. A custom Postgres GUC that has been
set and reset reads back as `''`, not NULL, and every hr policy is
`USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)` — so `''::uuid` throws
before the policy can evaluate to false. The changeset's own trailing
`PERFORM set_config('app.current_tenant_id', '', false)` is one way the session reaches that state.

**Why the test suite is green anyway, and this is the more important half.** `HrTestBase` migrates a
container whose `employees` table is **empty**, so `FOR t IN SELECT DISTINCT tenant_id FROM employees`
iterates zero times and the driving query never has to see a row. The whole backfill is a no-op under
test and its failure mode is structurally invisible there.

**There is a second, quieter defect underneath the first.** `employees` is under FORCE row-level
security, so even with the GUC unset the driving query returns **zero rows to `hr_user`** — the loop
cannot see any tenant it is supposed to iterate. Changeset `015c` then drops the free-text
`department` and `designation` columns believing the backfill ran. On the current dev database nothing
is lost (`count(department) = 0`), but on a customer database that sequence is silent data loss:
a green migration, a dropped column, and no department on any employee.

**Not fixed here, deliberately.** Making the loop see every tenant requires either a `SECURITY DEFINER`
helper (which changes what
`deploy/scripts/verify-security-definer-owners.sh` audits) or running the backfill from an
administrative connection. Both are design decisions inside 35-05, and 25's binding constraints forbid
casual changes to RLS. A one-line patch that merely stops the *error* would leave the loop blind and
hand `015c` a green light to drop the columns — trading a loud failure for a quiet one, which is the
exact trade this project keeps losing.

**What 25-06 did instead.** Verified changelog 034 against a throwaway database built to the pre-034
shape and seeded with the duplicates the defect produces — see `25-06-SUMMARY.md`. Every 034 claim is
proven; none of it is proven against the shared dev stack, because the shared dev stack cannot start.

---

## 2. `RlsForcedInvariantIT.configurationTablesAreEmptyAfterMigration` fails

**Owner:** 35-05. `departments` = 14 rows, `designations` = 2 rows straight after migration in a
shared-container run. Unrelated to attendance. hr-service is otherwise 113/114 green.
