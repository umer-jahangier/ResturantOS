-- Reproduces deploy/init/02-create-roles.sql + 03-grant-schema-privileges.sql for user_db.
--
-- Testcontainers' container user is a SUPERUSER, and PostgreSQL exempts superusers from row
-- level security unconditionally — FORCE included. An integration suite that connects as it is
-- asserting tenant isolation against a connection where isolation is switched off, and will
-- report green no matter what the policies say. That is how 33 tables shipped with inert RLS.
--
-- So the container user stays the bootstrap/owner role and the APPLICATION connects as
-- user_service: LOGIN, NOSUPERUSER, NOBYPASSRLS — the same three attributes production gives it.
-- Liquibase also runs as user_service, which is deliberate: it is what production does
-- (see deploy/init/02-create-roles.sql), and it means user_service OWNS the tables it later
-- queries. An owner is exempt from its own policies unless the table is FORCEd, so this is the
-- shape in which FORCE ROW LEVEL SECURITY is load-bearing and a missing FORCE is observable.
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_service') THEN
        CREATE ROLE user_service LOGIN PASSWORD 'test-pass' NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE user_db TO user_service;
GRANT USAGE, CREATE ON SCHEMA public TO user_service;
