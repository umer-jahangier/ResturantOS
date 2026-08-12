-- Reproduces deploy/init/02-create-roles.sql + 03-grant-schema-privileges.sql for audit_db.
--
-- Testcontainers' container user is a SUPERUSER, and PostgreSQL exempts superusers from row
-- level security unconditionally — FORCE included. An integration suite that connects as it is
-- asserting tenant isolation against a connection where isolation is switched off, and will
-- report green no matter what the policies say. That is how 33 tables shipped with inert RLS,
-- and it is why AuditConsumerIT — which connects as the container superuser — cannot tell you
-- anything about whether the policies on audit_events work.
--
-- So the container user (test_owner) stays the bootstrap role and nothing the application does
-- runs as it. Two unprivileged roles are created here, mirroring production:
--
--   audit_admin   Liquibase AND the application datasource connect as this. It therefore OWNS
--                 audit_events and every partition. An owner is exempt from its own policies
--                 unless the table is FORCEd, so this is precisely the shape in which
--                 FORCE ROW LEVEL SECURITY is load-bearing and a missing FORCE is observable.
--                 (In production Liquibase runs as audit_admin and the app as audit_writer; the
--                 app is pointed at the OWNER here on purpose, because the owner is the harder
--                 case. If isolation holds for the owner it holds for the non-owner.)
--
--   audit_writer  The production runtime role. It must exist before Liquibase runs: changeset
--                 010 has issued GRANT INSERT ON audit_events TO audit_writer since 05-02, and a
--                 GRANT to a role that does not exist is an error, not a no-op.
--
-- Both are NOSUPERUSER NOBYPASSRLS — the two attributes that decide whether any of this is real.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_admin') THEN
        CREATE ROLE audit_admin LOGIN PASSWORD 'test-admin-pass' NOSUPERUSER NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN
        CREATE ROLE audit_writer LOGIN PASSWORD 'test-writer-pass' NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE audit_db TO audit_admin;
GRANT USAGE, CREATE ON SCHEMA public TO audit_admin;

-- audit_writer gets USAGE only. It deliberately does NOT get CREATE: production measured
-- has_schema_privilege('audit_writer','public','CREATE') = false, and create_audit_partition()
-- is SECURITY DEFINER precisely so that the monthly job works anyway. Granting CREATE here would
-- hide that.
GRANT USAGE ON SCHEMA public TO audit_writer;
