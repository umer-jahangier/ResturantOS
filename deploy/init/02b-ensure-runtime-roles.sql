-- Idempotent: runtime roles added after older dev volumes were first provisioned.
-- Runs as postgres superuser before 03-grant-schema-privileges.sql on every dev-up.
-- Passwords are supplied via psql -v from ensure-dev-infra (same values as 02-create-roles.sql).

SELECT format(
  'CREATE ROLE user_service LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS',
  :'user_pw'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_service')
\gexec

SELECT 'GRANT ALL PRIVILEGES ON DATABASE user_db TO user_service'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'user_service')
\gexec

SELECT format(
  'CREATE ROLE audit_writer LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS',
  :'audit_pw'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer')
\gexec

SELECT 'GRANT CONNECT ON DATABASE audit_db TO audit_writer'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer')
\gexec

SELECT format(
  'CREATE ROLE file_service LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS',
  :'file_pw'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'file_service')
\gexec

SELECT 'GRANT ALL PRIVILEGES ON DATABASE file_db TO file_service'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'file_service')
\gexec

-- Phase 12 (reporting-service, nlq-service): create their databases and roles idempotently so dev
-- volumes provisioned before Phase 12 (where 01/02 will not re-run) still get them. CREATE DATABASE
-- runs first so the DATABASE grants below cannot abort under ON_ERROR_STOP on a missing database.
SELECT 'CREATE DATABASE reporting_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'reporting_db')
\gexec

SELECT 'CREATE DATABASE nlq_db'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nlq_db')
\gexec

SELECT format(
  'CREATE ROLE reporting_user LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS',
  :'rpt_pw'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'reporting_user')
\gexec

SELECT 'GRANT ALL PRIVILEGES ON DATABASE reporting_db TO reporting_user'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'reporting_user')
\gexec

SELECT format(
  'CREATE ROLE nlq_user LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS',
  :'nlq_pw'
)
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'nlq_user')
\gexec

SELECT 'GRANT ALL PRIVILEGES ON DATABASE nlq_db TO nlq_user'
WHERE EXISTS (SELECT FROM pg_roles WHERE rolname = 'nlq_user')
\gexec
