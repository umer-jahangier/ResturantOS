-- PostgreSQL 15+ revokes CREATE on schema public from PUBLIC.
-- Service roles need explicit grants before Liquibase can create tables.
-- Runs as postgres superuser during first container init.

\c auth_db
GRANT ALL ON SCHEMA public TO auth_user;
GRANT CREATE ON SCHEMA public TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO auth_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO auth_user;

\c user_db
GRANT ALL ON SCHEMA public TO user_user;
GRANT CREATE ON SCHEMA public TO user_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO user_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO user_user;
-- user_service is the application.yml default runtime/migration role for user-service.
GRANT ALL ON SCHEMA public TO user_service;
GRANT CREATE ON SCHEMA public TO user_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO user_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO user_service;

\c pos_db
GRANT ALL ON SCHEMA public TO pos_user;
GRANT CREATE ON SCHEMA public TO pos_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO pos_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO pos_user;

\c inventory_db
GRANT ALL ON SCHEMA public TO inventory_user;
GRANT CREATE ON SCHEMA public TO inventory_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO inventory_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO inventory_user;

\c finance_db
GRANT ALL ON SCHEMA public TO finance_user;
GRANT CREATE ON SCHEMA public TO finance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO finance_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO finance_user;

\c purchasing_db
GRANT ALL ON SCHEMA public TO purchasing_user;
GRANT CREATE ON SCHEMA public TO purchasing_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO purchasing_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO purchasing_user;

\c hr_db
GRANT ALL ON SCHEMA public TO hr_user;
GRANT CREATE ON SCHEMA public TO hr_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hr_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hr_user;

\c crm_db
GRANT ALL ON SCHEMA public TO crm_user;
GRANT CREATE ON SCHEMA public TO crm_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO crm_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO crm_user;

\c kitchen_db
GRANT ALL ON SCHEMA public TO kitchen_user;
GRANT CREATE ON SCHEMA public TO kitchen_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO kitchen_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO kitchen_user;

\c notification_db
GRANT ALL ON SCHEMA public TO notification_user;
GRANT CREATE ON SCHEMA public TO notification_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO notification_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO notification_user;

\c audit_db
GRANT ALL ON SCHEMA public TO audit_user;
GRANT CREATE ON SCHEMA public TO audit_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO audit_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO audit_user;
-- audit_writer is the INSERT-only runtime role; needs schema USAGE (table/sequence
-- INSERT grants are issued by the audit-service Liquibase migrations).
GRANT USAGE ON SCHEMA public TO audit_writer;

\c file_db
GRANT ALL ON SCHEMA public TO file_user;
GRANT CREATE ON SCHEMA public TO file_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO file_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO file_user;
-- file_service is the application.yml default runtime/migration role for file-service.
GRANT ALL ON SCHEMA public TO file_service;
GRANT CREATE ON SCHEMA public TO file_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO file_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO file_service;

\c platform_db
GRANT ALL ON SCHEMA public TO platform_user;
GRANT CREATE ON SCHEMA public TO platform_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO platform_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO platform_user;

\c reporting_db
GRANT ALL ON SCHEMA public TO reporting_user;
GRANT CREATE ON SCHEMA public TO reporting_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO reporting_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO reporting_user;

\c nlq_db
GRANT ALL ON SCHEMA public TO nlq_user;
GRANT CREATE ON SCHEMA public TO nlq_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO nlq_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO nlq_user;
