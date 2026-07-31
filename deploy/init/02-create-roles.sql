\set auth_pw `echo "$AUTH_DB_PASSWORD"`
\set user_pw `echo "$USER_DB_PASSWORD"`
\set pos_pw `echo "$POS_DB_PASSWORD"`
\set inv_pw `echo "$INVENTORY_DB_PASSWORD"`
\set fin_pw `echo "$FINANCE_DB_PASSWORD"`
\set pur_pw `echo "$PURCHASING_DB_PASSWORD"`
\set hr_pw `echo "$HR_DB_PASSWORD"`
\set crm_pw `echo "$CRM_DB_PASSWORD"`
\set kit_pw `echo "$KITCHEN_DB_PASSWORD"`
\set notif_pw `echo "$NOTIFICATION_DB_PASSWORD"`
\set audit_pw `echo "$AUDIT_DB_PASSWORD"`
\set file_pw `echo "$FILE_DB_PASSWORD"`
\set platform_pw `echo "$PLATFORM_DB_PASSWORD"`
\set rpt_pw `echo "$REPORTING_DB_PASSWORD"`
\set nlq_pw `echo "$NLQ_DB_PASSWORD"`

CREATE ROLE auth_user        LOGIN PASSWORD :'auth_pw'     NOSUPERUSER NOBYPASSRLS;
CREATE ROLE user_user        LOGIN PASSWORD :'user_pw'     NOSUPERUSER NOBYPASSRLS;
CREATE ROLE pos_user         LOGIN PASSWORD :'pos_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE inventory_user   LOGIN PASSWORD :'inv_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE finance_user     LOGIN PASSWORD :'fin_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE purchasing_user  LOGIN PASSWORD :'pur_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE hr_user          LOGIN PASSWORD :'hr_pw'       NOSUPERUSER NOBYPASSRLS;
CREATE ROLE crm_user         LOGIN PASSWORD :'crm_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE kitchen_user     LOGIN PASSWORD :'kit_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE notification_user LOGIN PASSWORD :'notif_pw'   NOSUPERUSER NOBYPASSRLS;
CREATE ROLE audit_user       LOGIN PASSWORD :'audit_pw'    NOSUPERUSER NOBYPASSRLS;
CREATE ROLE file_user        LOGIN PASSWORD :'file_pw'     NOSUPERUSER NOBYPASSRLS;
CREATE ROLE platform_user    LOGIN PASSWORD :'platform_pw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE reporting_user   LOGIN PASSWORD :'rpt_pw'      NOSUPERUSER NOBYPASSRLS;
CREATE ROLE nlq_user         LOGIN PASSWORD :'nlq_pw'      NOSUPERUSER NOBYPASSRLS;

-- Least-privilege runtime roles referenced by service Liquibase GRANTs.
-- user-service connects as user_service (its application.yml default) and runs Liquibase as it.
CREATE ROLE user_service     LOGIN PASSWORD :'user_pw'    NOSUPERUSER NOBYPASSRLS;
-- audit-service runtime user is INSERT-only on audit_events; DDL is run by an admin datasource.
CREATE ROLE audit_writer     LOGIN PASSWORD :'audit_pw'   NOSUPERUSER NOBYPASSRLS;
-- file-service connects + runs Liquibase as file_service (its application.yml default).
CREATE ROLE file_service     LOGIN PASSWORD :'file_pw'    NOSUPERUSER NOBYPASSRLS;

GRANT ALL PRIVILEGES ON DATABASE auth_db        TO auth_user;
GRANT ALL PRIVILEGES ON DATABASE user_db        TO user_user;
GRANT ALL PRIVILEGES ON DATABASE pos_db         TO pos_user;
GRANT ALL PRIVILEGES ON DATABASE inventory_db   TO inventory_user;
GRANT ALL PRIVILEGES ON DATABASE finance_db     TO finance_user;
GRANT ALL PRIVILEGES ON DATABASE purchasing_db  TO purchasing_user;
GRANT ALL PRIVILEGES ON DATABASE hr_db          TO hr_user;
GRANT ALL PRIVILEGES ON DATABASE crm_db         TO crm_user;
GRANT ALL PRIVILEGES ON DATABASE kitchen_db     TO kitchen_user;
GRANT ALL PRIVILEGES ON DATABASE notification_db TO notification_user;
GRANT ALL PRIVILEGES ON DATABASE audit_db       TO audit_user;
GRANT ALL PRIVILEGES ON DATABASE file_db        TO file_user;
GRANT ALL PRIVILEGES ON DATABASE platform_db    TO platform_user;
GRANT ALL PRIVILEGES ON DATABASE reporting_db   TO reporting_user;
GRANT ALL PRIVILEGES ON DATABASE nlq_db         TO nlq_user;
GRANT ALL PRIVILEGES ON DATABASE user_db        TO user_service;
GRANT ALL PRIVILEGES ON DATABASE file_db        TO file_service;
GRANT CONNECT        ON DATABASE audit_db        TO audit_writer;
-- The authorization-service also connects to auth_db using auth_user.
