-- Phase 12 (Reporting, Dashboards & NLQ) analytics fact tables.
--
-- Engine: ReplacingMergeTree — a safety net. reporting-service's ETL consumers guard idempotency
-- via their own Postgres `processed_events` table (tenant/consumer/event_id), but ClickHouse has
-- no transactions, so a crash between the Postgres commit and the ClickHouse INSERT could cause a
-- duplicate row to land on RabbitMQ redelivery. ReplacingMergeTree collapses duplicate rows
-- (same sort key) on merge/OPTIMIZE — an eventual-consistency safety net, not a hard guarantee
-- (duplicates can be visible between merges); acceptable for analytics facts, per 12-RESEARCH
-- Pattern 1.
--
-- Every table:
--   - PARTITION BY toYYYYMM(business_date)
--   - ORDER BY (tenant_id, branch_id, business_date, <entity key>) — tenant_id/branch_id MUST be
--     the leading sort columns so every tenant/branch-filtered scan is a prefix seek, and so the
--     NLQ auto-injected tenant/branch predicates (12-07) are cheap.
--   - All money as Int64 paisa (PROJECT.md: never Double/Float/Decimal).
--   - event_id UUID — carries the source EventEnvelope.eventId, for ReplacingMergeTree dedup and
--     for tracing a fact row back to its source event.
--
-- Column provenance: every column below is verified against REAL, currently-publishing event
-- payloads (grep'd from the actual service source, not invented from spec prose):
--   - sales_order_facts / sales_item_facts  <- OrderClosedPayload (PosClosePayloads.java, ORDER_CLOSED)
--   - till_session_facts                    <- TillServiceImpl.closeTill's Map.of(...) payload (TILL_CLOSED)
--   - purchase_tax_facts                    <- VendorInvoiceService.publishMatched's payload (VENDOR_INVOICE_MATCHED)
-- tenant_id/branch_id/event_id/business_date are NOT payload fields — they come from the
-- EventEnvelope (tenantId, branchId, eventId) that wraps every payload, and business_date is
-- derived by the ETL from the envelope's occurredAt using PROJECT.md's business-day formula
-- (DATE(occurredAt AT TIME ZONE branch.timezone - INTERVAL '4 hours')).
--
-- Deliberately NOT created: any table fed by STOCK_DEPLETED / LOW_STOCK_ALERT / WASTAGE_RECORDED /
-- COUNT_VARIANCE_POSTED / TRANSFER_* (Phase 8, not started — `grep -rn "STOCK_DEPLETED" services/`
-- returns zero matches; a table nothing can ever fill is a liability, not an asset).

CREATE DATABASE IF NOT EXISTS clickhouse_analytics;

-- =============================================================================================
-- sales_order_facts — one row per ORDER_CLOSED (order grain).
-- Revenue + OUTPUT TAX source for the FBR Tax Summary report.
-- =============================================================================================
CREATE TABLE IF NOT EXISTS clickhouse_analytics.sales_order_facts
(
    tenant_id           UUID,
    branch_id           UUID,
    business_date       Date,
    order_id            UUID,
    order_no            String,
    order_type          LowCardinality(String),
    customer_id         Nullable(UUID),
    subtotal_paisa      Int64,
    discount_paisa      Int64,
    service_charge_paisa Int64,
    tax_paisa           Int64,
    total_paisa         Int64,
    till_session_id     UUID,
    cashier_id          UUID,
    closed_at           DateTime64(3, 'UTC'),
    event_id            UUID
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(business_date)
ORDER BY (tenant_id, branch_id, business_date, order_id);

-- =============================================================================================
-- sales_item_facts — one row per line in OrderClosedPayload.items (item grain).
-- =============================================================================================
CREATE TABLE IF NOT EXISTS clickhouse_analytics.sales_item_facts
(
    tenant_id           UUID,
    branch_id           UUID,
    business_date       Date,
    order_id            UUID,
    line_no             UInt16,
    menu_item_id        UUID,
    item_name           String,
    qty                 Int32,
    unit_price_paisa    Int64,
    line_total_paisa    Int64,
    -- Populated by Phase 8 (Inventory & Recipe). ORDER_CLOSED's ItemEntry carries no
    -- cogs/margin/category today, so the ETL writes NULL. Margin reports must render these as
    -- "—", never as 0.
    cogs_paisa          Nullable(Int64),
    gross_margin_paisa  Nullable(Int64),
    category_name       Nullable(String),
    closed_at           DateTime64(3, 'UTC'),
    event_id            UUID
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(business_date)
ORDER BY (tenant_id, branch_id, business_date, order_id, line_no);

-- =============================================================================================
-- purchase_tax_facts — one row per VENDOR_INVOICE_MATCHED.
-- INPUT TAX source for the FBR Tax Summary report.
--
-- Column provenance (VendorInvoiceService.publishMatched's Map<String,Object> payload — the ONLY
-- fields actually published today): invoiceId, poId, amountPaisa, inputTaxPaisa, matchStatus.
-- vendor_id / invoice_no / invoice_date / subtotal_paisa are NOT in the published payload (they
-- exist on the VendorInvoice entity but are never put into the event map) — per the plan's
-- explicit instruction ("if a column has no source field, drop it"), they are omitted here rather
-- than invented. purchase_order_id is non-nullable because VendorInvoice.purchaseOrderId is a
-- NOT NULL column and 'poId' is always present in the payload.
-- =============================================================================================
CREATE TABLE IF NOT EXISTS clickhouse_analytics.purchase_tax_facts
(
    tenant_id           UUID,
    branch_id           UUID,
    business_date       Date,
    invoice_id          UUID,
    purchase_order_id   UUID,
    input_tax_paisa     Int64,
    total_paisa         Int64,
    match_status        LowCardinality(String),
    matched_at          DateTime64(3, 'UTC'),
    event_id            UUID
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(business_date)
ORDER BY (tenant_id, branch_id, business_date, invoice_id);

-- =============================================================================================
-- till_session_facts — one row per TILL_CLOSED. Feeds the dashboard's cash-position tile.
--
-- Column provenance (TillServiceImpl.closeTill's Map.of(...) payload — the ONLY fields actually
-- published today): tillSessionId, expectedCashPaisa, countedCashPaisa, variancePaisa, cashierId.
-- =============================================================================================
CREATE TABLE IF NOT EXISTS clickhouse_analytics.till_session_facts
(
    tenant_id            UUID,
    branch_id            UUID,
    business_date        Date,
    till_session_id      UUID,
    cashier_id           UUID,
    expected_cash_paisa  Int64,
    counted_cash_paisa   Int64,
    variance_paisa       Int64,
    closed_at            DateTime64(3, 'UTC'),
    event_id             UUID
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(business_date)
ORDER BY (tenant_id, branch_id, business_date, till_session_id);
