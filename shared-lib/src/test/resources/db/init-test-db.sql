-- Non-superuser app role for integration tests (matches production NOSUPERUSER NOBYPASSRLS roles).
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'shared_test_user') THEN
        CREATE ROLE shared_test_user LOGIN PASSWORD 'test-pass' NOSUPERUSER NOBYPASSRLS;
    END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE shared_test_db TO shared_test_user;
GRANT USAGE, CREATE ON SCHEMA public TO shared_test_user;
