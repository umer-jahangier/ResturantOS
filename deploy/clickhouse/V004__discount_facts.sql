-- =============================================================================================
-- V004 — sales_discount_facts (B3)
--
-- The Discount Summary report read sales_order_facts and could therefore only ever answer
-- "how much was discounted on each day". The question an owner actually asks — WHY did we give
-- Rs 950 away, and WHO authorised it — had no answer anywhere in the product, because
-- ORDER_CLOSED carried only the total and `order_discounts` carried no reason at all until
-- pos-service V22.
--
-- One row per discount on a closed check (discount grain). Fed by ORDER_CLOSED's new
-- `discounts[]` — see SalesFactWriter — so it is dated by the SAME business_date the order fact
-- and the journal entry use, and a discount can never be filed to a different day than its sale.
--
-- ReplacingMergeTree keyed by (tenant, branch, date, order, discount_no) — the same shape
-- sales_item_facts uses for its `line_no`, and for the same two reasons: a replayed ORDER_CLOSED
-- collapses instead of double-counting, and two discounts on one check keep separate rows. The
-- ordinal is used rather than (scope, order_item_id) because a Nullable column cannot sit in a
-- sorting key without `allow_nullable_key`, and a whole-check discount has no line.
-- =============================================================================================
CREATE TABLE IF NOT EXISTS clickhouse_analytics.sales_discount_facts
(
    tenant_id           UUID,
    branch_id           UUID,
    business_date       Date,
    order_id            UUID,
    -- Position within the check's discount list. Stable across a replay of the same event.
    discount_no         UInt16,
    order_no            String,
    -- LINE or ORDER.
    scope               LowCardinality(String),
    -- NULL for a whole-check discount; the line it came off for a LINE discount.
    order_item_id       Nullable(UUID),
    item_name           Nullable(String),
    -- FLAT, PERCENT, or PROMOTION for the automatic engine's rows.
    discount_type       LowCardinality(String),
    -- What was ASKED for: rupees for FLAT, percent for PERCENT.
    discount_value      Decimal(12, 4),
    -- What actually came OFF the bill, in paisa, after capping. The two differ whenever the
    -- discount was larger than what was left of the line, and a report showing only one of them
    -- cannot explain the other.
    amount_paisa        Int64,
    -- Free text supplied by the operator. Never blank for a discount applied after pos V22;
    -- rows migrated from before it carry an explicit "not recorded" sentence, never a guess.
    reason              String,
    applied_by          Nullable(UUID),
    -- Display name snapshotted at the time of the discount, so the report still names the right
    -- person after they leave. NULL when the staff directory was unreachable — render the id.
    applied_by_name     Nullable(String),
    closed_at           DateTime64(3, 'UTC'),
    event_id            UUID
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(business_date)
ORDER BY (tenant_id, branch_id, business_date, order_id, discount_no);

GRANT SELECT ON clickhouse_analytics.sales_discount_facts TO nlq_readonly;
