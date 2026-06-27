-- Phase 6 gap remediation: CLOSED period status + explicit finance_user grants

ALTER TABLE accounting_periods DROP CONSTRAINT IF EXISTS accounting_periods_status_check;
ALTER TABLE accounting_periods ADD CONSTRAINT accounting_periods_status_check
    CHECK (status IN ('OPEN', 'LOCKED', 'CLOSED'));

GRANT SELECT, INSERT, UPDATE, DELETE ON chart_of_accounts TO finance_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON accounting_periods TO finance_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON je_sequences TO finance_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_entries TO finance_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON journal_lines TO finance_user;

ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE accounting_periods FORCE ROW LEVEL SECURITY;
ALTER TABLE je_sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
