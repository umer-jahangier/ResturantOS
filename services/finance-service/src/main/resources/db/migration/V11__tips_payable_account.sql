-- ============================================================================
-- F20 — 2330 "Tips Payable", for every tenant that already exists.
-- ============================================================================
-- pos-service can now take a tip on a tender (V24 there). A tip is the STAFF's money, held by
-- the restaurant until it is handed on: it is not revenue, it is not the restaurant's to keep,
-- and crediting it to 4100 alongside the sale would both overstate income and levy income tax
-- on money the business never earned.
--
-- AutoPostingRecipeEngine.postOrderRevenue therefore debits the tender for
-- `amountPaisa + tipPaisa` — the cash IS in the drawer, the card slip IS for the larger figure —
-- and credits the difference here. Without this row that recipe resolves TIPS_PAYABLE to
-- nothing, throws AccountNotConfiguredException, and every tipped order dead-letters instead of
-- posting: the shape V8's own header describes, where a missing account turns a working feature
-- into a silent consumer failure.
--
-- New tenants get 2330 from PakistanRestaurantCoaTemplate, which this mirrors exactly — the two
-- must stay in step or a tenant provisioned before/after F20 gets a different chart. V8's
-- section (3) is the template for this whole file, including the RLS window below.

-- chart_of_accounts carries FORCE ROW LEVEL SECURITY and Flyway runs as the table owner with no
-- `app.current_tenant_id` GUC, so a plain INSERT..SELECT sees zero existing rows, backfills
-- nothing, and reports success. Same window V8 opens, closed in the same file. See V8's header
-- for why this class of bug is invisible to the IT suite and bites only real databases.
ALTER TABLE chart_of_accounts NO FORCE ROW LEVEL SECURITY;

INSERT INTO chart_of_accounts (tenant_id, code, name, account_type, parent_code, system, system_tag, active)
SELECT t.tenant_id, v.code, v.name, v.account_type, v.parent_code, TRUE, v.system_tag, TRUE
  FROM (SELECT DISTINCT tenant_id FROM chart_of_accounts) t
 CROSS JOIN (VALUES
        ('2330', 'Tips Payable', 'LIABILITY', '2000', 'TIPS_PAYABLE')
     ) AS v(code, name, account_type, parent_code, system_tag)
 WHERE NOT EXISTS (
        SELECT 1 FROM chart_of_accounts c
         WHERE c.tenant_id = t.tenant_id AND c.code = v.code);

-- Mandatory: close the window immediately. NO FORCE is table-wide, not session-scoped, so any
-- other connection reading through this role while it is open sees every tenant's rows.
ALTER TABLE chart_of_accounts FORCE ROW LEVEL SECURITY;

-- Fail the migration if the tag landed on no tenant that has a chart. A tag that resolves to
-- nothing produces a clean AccountNotConfiguredException at posting time, which reads as an
-- ordinary configuration problem and not as a migration that quietly did nothing — the exact
-- failure mode V8 and auth changeset 091 each added a verification step for.
DO $$
DECLARE charted INT; tipped INT;
BEGIN
    SELECT count(DISTINCT tenant_id) INTO charted FROM chart_of_accounts;
    SELECT count(DISTINCT tenant_id) INTO tipped
      FROM chart_of_accounts WHERE system_tag = 'TIPS_PAYABLE';
    IF charted > 0 AND tipped < charted THEN
        RAISE EXCEPTION
          'TIPS_PAYABLE is missing for % of % tenants with a chart of accounts. Every tipped order would dead-letter in AutoPostingRecipeEngine with AccountNotConfiguredException, and the tip would sit in the drawer with no ledger row anywhere.',
          charted - tipped, charted;
    END IF;
END $$;
