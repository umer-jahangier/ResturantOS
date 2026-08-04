-- ============================================================
-- Finance Service - V8
-- Phase 9 gap closure: give every auto-posting recipe a real, unambiguous account.
--
-- Three defects this closes, all of them in AutoPostingRecipeEngine:
--
--   1. system_tag 'INVENTORY' was carried by BOTH 1300 "Inventory" and 1310 "Raw Materials".
--      AccountResolver.codeBySystemTag does findBySystemTag(...).findFirst() over an unordered
--      query, so which account a COGS or transfer entry credited depended on Postgres row order —
--      while purchasing-service hardcodes the literal '1300' in its GR/IR and invoice entries.
--      The inventory sub-ledger could split across two accounts that never reconcile.
--
--   2. Recipes referenced accounts by hardcoded CODE for concepts that had no account at all:
--      count gains posted to 5221 "Delivery Cost", loyalty redemptions to 2400 "Accrued
--      Liabilities", and sales refunds re-used 4920 "Discounts Given" (making discount analytics
--      unrecoverable). Each now gets its own account and its own tag.
--
--   3. Service charge is added to the order total by OrderPricingCalculator and rides on
--      ORDER_CLOSED, but had no revenue account tagged, so postOrderRevenue could not credit it —
--      an unbalanced JE waiting for the first tenant to switch service charge on.
--
-- Additive only: no account is deleted or renumbered, and 5221 "Delivery Cost" keeps its own
-- meaning now that count gains have somewhere else to go.
-- ============================================================

-- ── NO FORCE window ─────────────────────────────────────────────────────────
-- chart_of_accounts has been FORCE ROW LEVEL SECURITY since V3 and the Flyway user owns it, so
-- FORCE applies to this session too. No migration sets app.current_tenant_id, which makes the
-- tenant_isolation predicate NULL for every row: without this window the UPDATEs below match
-- nothing and the INSERTs are rejected outright (42501). Same window inventory V5/V7/V10 open
-- for their own backfills, for the same reason.
--
-- This class of bug is invisible to the IT suite — on a fresh Testcontainers schema there are no
-- rows to miss — and bites exactly the databases that matter, the ones carrying real tenants.
ALTER TABLE chart_of_accounts NO FORCE ROW LEVEL SECURITY;

-- ── (1) disambiguate INVENTORY ──────────────────────────────────────────────
-- 1300 keeps INVENTORY (the control account purchasing already posts to by code).
-- 1310 becomes INVENTORY_RAW so both remain resolvable, neither collides.
UPDATE chart_of_accounts
   SET system_tag = 'INVENTORY_RAW', updated_at = now()
 WHERE code = '1310' AND system_tag = 'INVENTORY';

-- ── (2) tag accounts that already exist but were never system-tagged ────────
UPDATE chart_of_accounts
   SET system_tag = 'SERVICE_CHARGE', system = TRUE, updated_at = now()
 WHERE code = '4910' AND system_tag IS NULL;

UPDATE chart_of_accounts
   SET system_tag = 'DISCOUNT', system = TRUE, updated_at = now()
 WHERE code = '4920' AND system_tag IS NULL;

UPDATE chart_of_accounts
   SET system_tag = 'WASTAGE', system = TRUE, updated_at = now()
 WHERE code = '5220' AND system_tag IS NULL;

-- ── (3) backfill the accounts the recipes needed and never had ──────────────
-- One row per existing tenant, driven off the tenants already present in the chart. New tenants
-- get these from PakistanRestaurantCoaTemplate, which this migration mirrors exactly — the two
-- must stay in step or a tenant provisioned before/after V8 gets a different chart.
INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, parent_code, system, system_tag, active)
SELECT t.tenant_id, v.code, v.name, v.account_type, v.parent_code, TRUE, v.system_tag, TRUE
  FROM (SELECT DISTINCT tenant_id FROM chart_of_accounts) t
 CROSS JOIN (VALUES
        ('2410', 'Loyalty Points Liability',      'LIABILITY', '2400', 'LOYALTY_LIABILITY'),
        ('2420', 'Customer Vouchers Outstanding', 'LIABILITY', '2400', 'VOUCHER_LIABILITY'),
        ('4930', 'Sales Refunds',                 'REVENUE',   '4900', 'SALES_REFUND'),
        ('5230', 'Inventory Count Gain',          'COGS',      '5000', 'COUNT_GAIN'),
        ('5231', 'Inventory Count Loss',          'COGS',      '5000', 'COUNT_LOSS')
     ) AS v(code, name, account_type, parent_code, system_tag)
 WHERE NOT EXISTS (
        SELECT 1 FROM chart_of_accounts c
         WHERE c.tenant_id = t.tenant_id AND c.code = v.code);

-- Mandatory: close the window immediately. NO FORCE is table-wide, not session-scoped, so any
-- other connection reading through this role while it is open sees every tenant's rows.
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;

-- ── (4) make the ambiguity that caused (1) unrepresentable ──────────────────
-- Partial, because system_tag is NULL for the ~50 non-system accounts in the template and NULLs
-- must stay free to repeat. Any future template edit that reuses a tag now fails the migration
-- instead of silently making a posting non-deterministic.
CREATE UNIQUE INDEX uq_coa_tenant_system_tag
    ON chart_of_accounts (tenant_id, system_tag)
 WHERE system_tag IS NOT NULL;
