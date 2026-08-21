CREATE DATABASE platform_db;
CREATE DATABASE auth_db;        -- shared by Auth + Authorization services
CREATE DATABASE user_db;
CREATE DATABASE pos_db;
CREATE DATABASE inventory_db;
CREATE DATABASE finance_db;
CREATE DATABASE purchasing_db;
CREATE DATABASE hr_db;
CREATE DATABASE crm_db;
CREATE DATABASE kitchen_db;
CREATE DATABASE notification_db;
CREATE DATABASE audit_db;
CREATE DATABASE file_db;
CREATE DATABASE reporting_db;  -- Phase 12: report definitions + run log (analytics facts live in ClickHouse)
CREATE DATABASE nlq_db;         -- Phase 12: nlq_query_log + nlq_allowed_tables
