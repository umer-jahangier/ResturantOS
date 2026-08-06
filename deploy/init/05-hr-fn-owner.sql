-- HR SECURITY DEFINER functions must be owned by postgres so they actually bypass FORCE RLS,
-- and must NOT be callable by PUBLIC.
--
-- Why this file exists (two distinct defects, both fatal):
--
--  1. SECURITY DEFINER runs as the function OWNER. Liquibase for hr-service connects as the app
--     datasource user (services/hr-service/src/main/resources/application.yml -> hr_user; no
--     separate spring.liquibase.user), so hr_user OWNS these functions. deploy/init/02-create-roles.sql
--     creates hr_user NOSUPERUSER NOBYPASSRLS, and 011-enable-rls-hr-tables.xml applies FORCE RLS —
--     which binds the table owner too. Net effect: resolve_device() returns ZERO rows for every
--     device serial (DeviceAuthResolver then throws "Unknown device serial", killing all biometric
--     ingest), and hr_tenant_ids() returns zero tenants (LeaveAccrualScheduler silently accrues
--     for nobody).
--
--     This is invisible to the integration suite: HrTestBase uses
--     PostgreSQLContainer.withUsername("hr_user"), and Testcontainers makes POSTGRES_USER a
--     SUPERUSER — so the tests exercise a role that FORCE RLS does not constrain.
--
--  2. Postgres grants EXECUTE to PUBLIC by default on CREATE FUNCTION. The migrations only add a
--     redundant GRANT to hr_user; neither revokes. Once (1) is fixed and the owner is a superuser,
--     ANY role with a connection to hr_db could call resolve_device('<serial>') and read the full
--     attendance_devices row — device_token, tenant_id, branch_id — for ANY tenant, and enumerate
--     every tenant via hr_tenant_ids(). The REVOKE below is what closes that.
--
-- Mirrors deploy/init/04-auth-refresh-lookup-owner.sql, which solves the identical problem for
-- auth-service's refresh-session lookup.
--
-- ORDERING: unlike 04, this CANNOT be relied on from docker-entrypoint-initdb.d — the functions do
-- not exist until hr-service's Liquibase migrations have run. It is invoked from
-- deploy/scripts/ensure-dev-infra.sh, which runs after service boot. The to_regprocedure() guards
-- make it a safe no-op when the functions are not there yet, so a fresh-cluster run is harmless and
-- the script must simply be re-run (or the service restarted) once migrations have applied.

DO $$
BEGIN
  IF to_regprocedure('public.resolve_device(text)') IS NOT NULL THEN
    ALTER FUNCTION public.resolve_device(TEXT) OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.resolve_device(TEXT) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.resolve_device(TEXT) TO hr_user;
  ELSE
    RAISE NOTICE 'resolve_device(text) not present yet — re-run after hr-service migrations apply.';
  END IF;

  IF to_regprocedure('public.hr_tenant_ids()') IS NOT NULL THEN
    ALTER FUNCTION public.hr_tenant_ids() OWNER TO postgres;
    REVOKE ALL ON FUNCTION public.hr_tenant_ids() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.hr_tenant_ids() TO hr_user;
  ELSE
    RAISE NOTICE 'hr_tenant_ids() not present yet — re-run after hr-service migrations apply.';
  END IF;
END $$;
