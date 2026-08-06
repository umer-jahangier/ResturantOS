-- ============================================================
-- Finance Service - V9
-- Payroll statutory accounts: stop Wages Payable (2300) from drifting every payroll cycle.
--
-- The defect this closes, in AutoPostingRecipeEngine:
--
--   PAYROLL_RUN_APPROVED posted the GROSS to 2300 "Wages Payable"
--       DR 6200 Salary expense (gross) / CR 2300 Wages payable (gross)
--   PAYROLL_RUN_PAID cleared only the NET
--       DR 2300 Wages payable (net)    / CR 1110 Bank (net)
--
--   The withheld difference — income tax, the EOBI employee share, advance recovery, and the
--   late-arrival deduction — was never credited to any statutory-payable account, so 2300
--   accumulated a permanently growing balance, one run at a time. Both entries balanced on their
--   own, so nothing ever errored and no reconciliation ever failed loudly. Same silent-drift shape
--   as the pre-V8 loyalty liability (which drifted the other way, negative, for the mirror-image
--   reason: a liability debited by redemptions that nothing ever credited).
--
--   Fixing the recipe needs somewhere for those credits to LAND, which is what this migration adds.
--   The corrected entry is
--       DR 6200 Salary expense (gross - lateArrival)
--       CR 2300 Wages payable (net) · 2310 PAYE (tax) · 2320 EOBI (eobi) · 1750 Advances (advances)
--   and it balances because net + tax + eobi + advances = gross - lateArrival by construction in
--   hr-service's PayrollRunService.calculate. 2300 then clears to exactly zero on payment.
--
-- Additive only: no account is deleted or renumbered.
-- ============================================================

-- ── NO FORCE window ─────────────────────────────────────────────────────────
-- chart_of_accounts has been FORCE ROW LEVEL SECURITY since V3 and the Flyway user owns it, so
-- FORCE applies to this session too. No migration sets app.current_tenant_id, which makes the
-- tenant_isolation predicate NULL for every row: without this window the INSERT below is rejected
-- outright (42501) and the WHERE NOT EXISTS probe sees nothing. Same window V8 opens, for the same
-- reason — and the same blind spot, since a fresh Testcontainers schema has no tenant rows to miss.
ALTER TABLE chart_of_accounts NO FORCE ROW LEVEL SECURITY;

-- ── backfill the payroll accounts for every existing tenant ─────────────────
-- One row per existing tenant, driven off the tenants already present in the chart. New tenants
-- get these from PakistanRestaurantCoaTemplate, which this migration mirrors exactly — the two
-- must stay in step or a tenant provisioned before/after V9 gets a different chart.
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, parent_code, system, system_tag, active)
SELECT t.tenant_id, v.code, v.name, v.account_type, v.parent_code, TRUE, v.system_tag, TRUE
  FROM (SELECT DISTINCT tenant_id FROM chart_of_accounts) t
 CROSS JOIN (VALUES
        ('1750', 'Employee Advances',           'ASSET',     '1000', 'EMPLOYEE_ADVANCES'),
        ('2310', 'Income Tax Withheld Payable', 'LIABILITY', '2000', 'PAYE_PAYABLE'),
        ('2320', 'EOBI Payable',                'LIABILITY', '2000', 'EOBI_PAYABLE')
     ) AS v(code, name, account_type, parent_code, system_tag)
 WHERE NOT EXISTS (
        SELECT 1 FROM chart_of_accounts c
         WHERE c.tenant_id = t.tenant_id AND c.code = v.code);

-- Mandatory: close the window immediately. NO FORCE is table-wide, not session-scoped, so any
-- other connection reading through this role while it is open sees every tenant's rows.
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;
