-- Idempotent E2E fixture: one category + 3 menu items with clean tax math (10% tax rate),
-- run once against pos_db before scripts/e2e/phase12-reporting-e2e.sh. The base prices are chosen
-- so perLineTax (OrderPricingCalculator: net * taxRatePct/100, HALF_UP) lands exactly on the
-- plan's illustrative tax figures (1000 / 2500 / 500 paisa).
-- tenant a0000001-0000-4000-8000-000000000001, branch b0000001-0000-4000-8000-000000000001
INSERT INTO menu_categories (id, tenant_id, name, sort_order, active)
VALUES ('e2e00001-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'E2E Test Category', 0, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_items (id, tenant_id, category_id, name, base_price_paisa, tax_rate_pct, active)
VALUES
  ('e2e00002-0000-4000-8000-000000000001', 'a0000001-0000-4000-8000-000000000001', 'e2e00001-0000-4000-8000-000000000001', 'E2E Item A (tax 1000)', 10000, 10.00, true),
  ('e2e00002-0000-4000-8000-000000000002', 'a0000001-0000-4000-8000-000000000001', 'e2e00001-0000-4000-8000-000000000001', 'E2E Item B (tax 2500)', 25000, 10.00, true),
  ('e2e00002-0000-4000-8000-000000000003', 'a0000001-0000-4000-8000-000000000001', 'e2e00001-0000-4000-8000-000000000001', 'E2E Item C (tax 500)', 5000, 10.00, true)
ON CONFLICT (id) DO NOTHING;
