-- Make report_run_log's tenant_isolation policy answer, rather than throw, on a connection that
-- carries no tenant.
--
-- V1 wrote the policy as a raw cast of the GUC:
--
--     tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
--
-- The TRUE second argument handles an UNSET GUC — current_setting returns NULL, the comparison is
-- NULL, i.e. not true, so the row is excluded. It does NOT handle an EMPTY STRING, and the empty
-- string is exactly what this runtime writes. shared-lib's TenantAwareDataSource.configureTenant()
-- issues set_config('app.current_tenant_id', '', false) on EVERY checkout where TenantContext holds
-- no tenant, and ResetGucsOnClose writes '' again when the connection returns to the pool.
-- ''::UUID raises
--
--     ERROR: invalid input syntax for type uuid: ""
--
-- reporting-service is the worst place for this to be latent. TenantAwareDataSourcePostProcessor
-- wraps EVERY DataSource bean, and this service runs report generation off schedules and message
-- consumers — checkouts that routinely precede the tenant being known. V1 also made report_run_log
-- FORCE ROW LEVEL SECURITY, so the table owner is subject to the policy too and cannot cast its way
-- out.
--
-- NULLIF(..., '') turns the empty string into NULL, and `tenant_id = NULL` is NULL, which is not
-- true, so the row is excluded. Same fail-closed outcome, expressed as an answer rather than an
-- exception. A non-empty GUC passes through NULLIF untouched, so tenant-scoped behaviour is
-- unchanged.
--
-- Written as a NEW migration rather than an edit to V1: V1 is recorded in flyway_schema_history
-- with its checksum, and Spring Boot defaults validate-on-migrate to true, so editing it would stop
-- reporting-service booting. Same shape as finance-service V4.
--
-- The policy is recreated with its original shape — PERMISSIVE, FOR ALL, TO public, no WITH CHECK —
-- verified against pg_policies before this file was written. RLS stays ENABLEd and FORCEd exactly
-- as V1 left it; this migration touches the USING predicate and nothing else.

DROP POLICY IF EXISTS tenant_isolation ON report_run_log;
CREATE POLICY tenant_isolation ON report_run_log
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
