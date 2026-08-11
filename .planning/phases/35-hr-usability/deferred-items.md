## RlsForcedInvariantIT#configurationTablesAreEmptyAfterMigration is order-dependent (found 35-06)

The test asserts departments/designations/salary_components/employee_salary_components hold zero
rows "after migration". Failsafe shares ONE Postgres container across every IT class in the JVM, and
`HrConfigListsIT` and `EmployeeLookupMigrationIT` create departments. Whether it passes depends on
which class failsafe happens to run first — adding `TaxConfigIT` in 35-06 changed that order and the
assertion started reporting 14 departments and 2 designations.

Not caused by 35-06's code; exposed by 35-06's new test class. The invariant it asserts (nothing is
seeded by a migration) is worth keeping. The fix is to assert it against a pristine schema — a
migration-time snapshot, a dedicated container, or a check run before any other class writes — not
to relax the assertion. Owner: 35-02's file.

## attendance_quarantine lost FORCE ROW LEVEL SECURITY (not phase 35)

`RlsForcedInvariantIT#everyRlsEnabledTableIsForced` reports it. The owning agent's own changelog
`035-restore-force-rls-attendance-quarantine.xml` documents that they dropped FORCE in 034 for a
backfill and did not restore it. They are fixing it. Recorded here only so a later reader does not
attribute the red to phase 35.
