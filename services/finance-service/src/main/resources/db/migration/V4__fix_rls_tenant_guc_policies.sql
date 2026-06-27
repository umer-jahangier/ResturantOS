-- Empty GUC must not cast to uuid (""::uuid throws). Match auth-service 053 pattern.

DROP POLICY IF EXISTS tenant_isolation ON chart_of_accounts;
CREATE POLICY tenant_isolation ON chart_of_accounts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON accounting_periods;
CREATE POLICY tenant_isolation ON accounting_periods
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON je_sequences;
CREATE POLICY tenant_isolation ON je_sequences
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON journal_entries;
CREATE POLICY tenant_isolation ON journal_entries
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON journal_lines;
CREATE POLICY tenant_isolation ON journal_lines
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
