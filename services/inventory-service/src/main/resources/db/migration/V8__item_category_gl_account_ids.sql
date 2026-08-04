-- Inventory Service - V8 Migration: store GL accounts by immutable id, not just by code
--
-- `item_categories` referenced finance-service's chart of accounts by CODE only, typed free-hand
-- into three unvalidated text inputs. Two separate problems came out of that:
--
--   1. Nothing checked the code existed, was active, or was even the right ACCOUNT TYPE. '1400',
--      '14OO' (letter O) and 'banana' all saved identically, and would only surface once Phase 9
--      began posting journal entries against them — long after anyone could say where the bad
--      value came from. That half is fixed in ItemCategoryService, which now resolves every code
--      through finance-service before persisting it.
--
--   2. Account codes are not stable. A chart-of-accounts restructure renumbers them, and a stored
--      code silently detaches from the account it was chosen to mean. The id does not move.
--
-- So the id becomes the reference and the code stays as a denormalised display cache, refreshed
-- from the resolved account on every write. Doing this now is close to free: nothing has posted
-- against these accounts yet, so there is no journal history to reconcile. After Phase 9 it would
-- not be.
--
-- NO FOREIGN KEY, deliberately: chart_of_accounts lives in finance_db, a different database owned
-- by a different service. Referential integrity here is enforced at write time by
-- ItemCategoryService via the /internal/finance/accounts/resolve seam, not by the schema.
--
-- NO BACKFILL, for the same reason — a Flyway migration in inventory_db cannot see finance_db to
-- translate codes into ids. Existing rows keep their code and get an id the next time the category
-- is saved; until then every read path falls back to the code, so nothing breaks in the meantime.

ALTER TABLE item_categories
    ADD COLUMN default_inventory_account_id UUID,
    ADD COLUMN default_cost_account_id      UUID,
    ADD COLUMN default_waste_account_id     UUID;

COMMENT ON COLUMN item_categories.default_inventory_account_id IS
    'finance_db chart_of_accounts.id — authoritative reference. default_inventory_account_code is a display cache. No FK: cross-database.';
COMMENT ON COLUMN item_categories.default_cost_account_id IS
    'finance_db chart_of_accounts.id — authoritative reference. default_cost_account_code is a display cache. No FK: cross-database.';
COMMENT ON COLUMN item_categories.default_waste_account_id IS
    'finance_db chart_of_accounts.id — authoritative reference. default_waste_account_code is a display cache. No FK: cross-database.';
