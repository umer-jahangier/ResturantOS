-- Locked-down `nlq_readonly` ClickHouse user — the last line of defence if the nlq-service
-- 7-stage AST validator (12-07) is ever bypassed. Defence in depth per PROJECT.md's Security
-- constraint: table access is allowlisted at the database layer via per-table GRANTs, not just
-- validated in application code.
--
-- GRAMMAR VERIFIED EMPIRICALLY against the live ClickHouse 25.9 container (RESOLVES 12-RESEARCH
-- Open Question 1 — the docs page fetched during research showed only the XML users.xml form,
-- not the SQL-driven CREATE statement grammar):
--
--   CREATE SETTINGS PROFILE <name> SETTINGS
--       <setting> = <value> CONST,
--       <setting> = <value> MAX <max_value>,
--       ...
--
--   CREATE USER <name> IDENTIFIED WITH plaintext_password BY '<password>'
--       SETTINGS PROFILE '<profile_name>'
--
-- Confirmed against the container:
--   - `<setting> = <value> MAX <n>` sets both the default AND an upper bound the client cannot
--     exceed via a `SETTINGS` clause on an individual query — attempting
--     `SELECT 1 SETTINGS max_execution_time = 600` against a user on this profile is REJECTED
--     with `Code: 164. DB::Exception: Cannot modify 'max_execution_time' setting in readonly
--     mode. (READONLY)` (the MAX constraint makes the setting effectively read-only from the
--     client's perspective once it's already at the ceiling — i.e. non-overridable).
--   - `<setting> = <value> CONST` makes the setting completely fixed — used for `readonly` and
--     `result_overflow_mode`, which must never be changeable by the client under any
--     circumstance (a client cannot even try to un-set readonly mode).
--   - The single-setting form `SETTINGS max_execution_time = 5 MAX` (no explicit numeric bound
--     after MAX) is a SYNTAX ERROR on 25.9 — `MAX`/`MIN` require an explicit bound value
--     (`MAX <n>`), confirmed via `Code: 62. DB::Exception: Syntax error ... Expected one of:
--     token, Equals, literal, ...`.
--
-- PREREQUISITE (a REAL finding, recorded here and in the SUMMARY, not assumed from docs): the
-- stock clickhouse/clickhouse-server:25.9 image ships with SQL-driven access control DISABLED
-- for the default user (`access_management` defaults to 0 — confirmed via `SHOW ACCESS` on first
-- boot returning `Code: 497 ... Not enough privileges ... SHOW ACCESS ON *.*`). Without it, EVERY
-- statement in this file fails identically. apply.sh enables it (see
-- deploy/clickhouse/zz-access-management.xml) before running this migration — this file assumes
-- access_management is already on.

-- ------------------------------------------------------------------------------------------------
-- Settings profile: constrains, not merely defaults.
--   readonly = 1               -> no INSERT/ALTER/CREATE/DROP, CONST so it cannot be relaxed.
--   max_execution_time = 5     -> NLQ-02's 5s timeout, MAX-bounded so it cannot be raised.
--   max_result_rows = 10000    -> NLQ-02's 10k row cap, MAX-bounded so it cannot be raised.
--   result_overflow_mode='throw' -> the cap must ERROR, not silently truncate (CONST).
-- ------------------------------------------------------------------------------------------------
CREATE SETTINGS PROFILE IF NOT EXISTS nlq_readonly_profile SETTINGS
    readonly = 1 CONST,
    max_execution_time = 5 MAX 5,
    max_result_rows = 10000 MAX 10000,
    result_overflow_mode = 'throw' CONST;

-- ------------------------------------------------------------------------------------------------
-- User: password substituted by apply.sh from ${CLICKHOUSE_READONLY_PASSWORD} (envsubst) — never
-- a literal secret in this file. CREATE OR REPLACE so re-running the file rotates the password
-- cleanly and re-applies the profile without needing a separate ALTER.
-- ------------------------------------------------------------------------------------------------
CREATE USER OR REPLACE nlq_readonly
    IDENTIFIED WITH plaintext_password BY '${CLICKHOUSE_READONLY_PASSWORD}'
    SETTINGS PROFILE 'nlq_readonly_profile';

-- ------------------------------------------------------------------------------------------------
-- Per-table SELECT grants — deliberately NEVER `ON clickhouse_analytics.*`. This makes the table
-- allowlist enforced at the database layer too: even a total failure of the AST validator's
-- stage-3 allowlist (nlq-service) cannot read a table we never granted here.
-- No INSERT, CREATE, DROP, ALTER, or system.* access is ever granted to this user.
-- ------------------------------------------------------------------------------------------------
GRANT SELECT ON clickhouse_analytics.sales_order_facts TO nlq_readonly;
GRANT SELECT ON clickhouse_analytics.sales_item_facts  TO nlq_readonly;
GRANT SELECT ON clickhouse_analytics.purchase_tax_facts TO nlq_readonly;
GRANT SELECT ON clickhouse_analytics.till_session_facts TO nlq_readonly;
