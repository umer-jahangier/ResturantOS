-- =============================================================================================
-- V005 — sales_discount_facts.discount_source
--
-- V004 documented `discount_type` as "FLAT, PERCENT, or PROMOTION for the automatic engine's
-- rows". That third value could never arrive: `order_discounts.type` in pos_db has carried
-- CHECK (type IN ('FLAT','PERCENT')) since pos V1, so the promotion path 500'd at flush on every
-- call and no PROMOTION row was ever written, let alone closed and shipped here. pos V30 fixes
-- that the other way round — `type` keeps its two values and stays the unit discriminator for
-- `discount_value` ("rupees for FLAT, percent for PERCENT", as the column comment beside it still
-- says), and WHO decided the discount moves to its own column.
--
-- This mirrors that split. Without it the Discount Summary could not answer the question the
-- promotion engine exists to raise: of the money this branch gave away, how much did the machine
-- decide and how much did a manager?
--
-- DEFAULT 'MANUAL' backfills every existing row, and that is a statement of fact rather than a
-- guess: until pos V30 the automatic path could not insert a discount row at all, so every row
-- already in this table was decided by a person.
-- =============================================================================================
ALTER TABLE clickhouse_analytics.sales_discount_facts
    ADD COLUMN IF NOT EXISTS discount_source LowCardinality(String) DEFAULT 'MANUAL'
    AFTER discount_type;

ALTER TABLE clickhouse_analytics.sales_discount_facts
    COMMENT COLUMN discount_source
        'MANUAL for a discount a person decided on, PROMOTION for one the crm-service promotion engine applied automatically. Orthogonal to discount_type, which is only ever the pricing formula.';
