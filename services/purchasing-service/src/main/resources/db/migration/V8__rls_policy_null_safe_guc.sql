-- Make every tenant_isolation policy in purchasing_db answer, rather than throw, on a connection
-- that carries no tenant.
--
-- V1, V2 and V5 wrote their policies as a raw cast of the GUC:
--
--     tenant_id = current_setting('app.current_tenant_id', TRUE)::UUID
--
-- The TRUE second argument handles an UNSET GUC — current_setting returns NULL, the comparison is
-- NULL, i.e. not true, so the row is excluded. It does NOT handle an EMPTY STRING, and the empty
-- string is exactly what this runtime writes. shared-lib's TenantAwareDataSource.configureTenant()
-- issues set_config('app.current_tenant_id', '', false) on EVERY checkout where TenantContext holds
-- no tenant, and ResetGucsOnClose writes '' again when the connection returns to the pool.
-- ''::UUID raises
--
--     ERROR: invalid input syntax for type uuid: ""
--
-- so a legitimately tenantless read failed with a cast error instead of returning nothing. Those
-- checkouts are ordinary, not exotic: RabbitMQ consumers before TenantAwareMessageProcessor sets
-- context, scheduled sweeps, actuator probes, and /internal/** handlers that resolve their tenant
-- inside the controller. V7 made every one of these tables FORCE ROW LEVEL SECURITY, so the table
-- owner is subject to the policy too and cannot cast its way out.
--
-- NULLIF(..., '') turns the empty string into NULL, and `tenant_id = NULL` is NULL, which is not
-- true, so the row is excluded. Same fail-closed outcome, expressed as an answer rather than an
-- exception. A non-empty GUC passes through NULLIF untouched, so tenant-scoped behaviour is
-- unchanged.
--
-- Written as a NEW migration rather than an edit to V1/V2/V5: all three are recorded in
-- flyway_schema_history with their checksums, and Spring Boot defaults validate-on-migrate to true,
-- so editing them would stop purchasing-service booting. They stay as the record of what was
-- created; this is the record of the correction. Same shape as finance-service V4.
--
-- All 14 policies are recreated with their original shape — PERMISSIVE, FOR ALL, TO public, no
-- WITH CHECK — verified against pg_policies before this file was written. RLS stays ENABLEd and
-- FORCEd exactly as V1/V2/V5/V7 left it; this migration touches the USING predicate and nothing
-- else.

DROP POLICY IF EXISTS tenant_isolation ON ap_payment_allocations;
CREATE POLICY tenant_isolation ON ap_payment_allocations
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON ap_payments;
CREATE POLICY tenant_isolation ON ap_payments
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON mock_grn_receipts;
CREATE POLICY tenant_isolation ON mock_grn_receipts
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON po_approval_records;
CREATE POLICY tenant_isolation ON po_approval_records
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON po_approval_tiers;
CREATE POLICY tenant_isolation ON po_approval_tiers
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON purchase_order_lines;
CREATE POLICY tenant_isolation ON purchase_order_lines
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON purchase_orders;
CREATE POLICY tenant_isolation ON purchase_orders
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON vendor_catalogues;
CREATE POLICY tenant_isolation ON vendor_catalogues
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON vendor_categories;
CREATE POLICY tenant_isolation ON vendor_categories
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON vendor_invoice_lines;
CREATE POLICY tenant_isolation ON vendor_invoice_lines
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON vendor_invoices;
CREATE POLICY tenant_isolation ON vendor_invoices
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON vendor_item_prices;
CREATE POLICY tenant_isolation ON vendor_item_prices
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON vendor_items;
CREATE POLICY tenant_isolation ON vendor_items
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);

DROP POLICY IF EXISTS tenant_isolation ON vendors;
CREATE POLICY tenant_isolation ON vendors
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', TRUE), '')::UUID);
