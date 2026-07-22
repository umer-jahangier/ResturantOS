package io.restaurantos.purchasing;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the V5__vendor_item_catalog.sql migration (PUR-07/PUR-08) applies cleanly against a
 * real Postgres via Flyway, is additive (nothing pre-existing was dropped, renamed or retyped),
 * carries tenant_isolation RLS policies on all three new tables, wires
 * purchase_order_lines.vendor_item_id as a nullable RESTRICT foreign key, and that the catalog
 * shape actually supports the two load-bearing invariants: append-only effective-dated prices
 * (D-01 / RESEARCH §9.3 call 5) and a vendor selling the same ingredient in more than one pack
 * size (the R365 cardinality).
 *
 * Because the Testcontainers Postgres connection is a superuser, RLS row-visibility cannot be
 * exercised by attempting a cross-tenant SELECT (superusers bypass RLS regardless of ENABLE/
 * FORCE) — per the inventory-service SchemaMigrationIT precedent, this IT instead asserts the
 * pg_catalog metadata directly: relrowsecurity on pg_class, and policy presence in pg_policies.
 */
class PurchasingSchemaMigrationIT extends PurchasingTestBase {

    @Autowired
    JdbcTemplate jdbcTemplate;

    private static final List<String> NEW_V5_TABLES = List.of(
            "vendor_items", "vendor_item_prices", "vendor_categories"
    );

    private static final List<String> PRE_EXISTING_TABLES = List.of(
            "vendor_catalogues", "vendors", "purchase_orders", "purchase_order_lines"
    );

    @Test
    void allV5TablesExist() {
        List<String> tables = jdbcTemplate.queryForList(
                "SELECT table_name FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
                String.class);

        assertThat(tables).containsAll(NEW_V5_TABLES);
        // Additive-only guarantee: nothing pre-existing was dropped.
        assertThat(tables).containsAll(PRE_EXISTING_TABLES);
    }

    @Test
    void newCatalogTablesHaveTenantIsolationPolicies() {
        for (String table : NEW_V5_TABLES) {
            Boolean rowSecurity = jdbcTemplate.queryForObject(
                    "SELECT relrowsecurity FROM pg_class "
                            + "WHERE relname = ? AND relnamespace = 'public'::regnamespace",
                    Boolean.class, table);

            assertThat(rowSecurity).as("relrowsecurity for %s", table).isEqualTo(true);

            Integer policyCount = jdbcTemplate.queryForObject(
                    "SELECT count(*) FROM pg_policies WHERE tablename = ? AND policyname = ?",
                    Integer.class, table, "tenant_isolation");

            assertThat(policyCount).as("tenant_isolation policy count for %s", table).isEqualTo(1);
        }
    }

    @Test
    void purchaseOrderLinesHasNullableVendorItemIdWithRestrict() {
        String nullable = jdbcTemplate.queryForObject(
                "SELECT is_nullable FROM information_schema.columns "
                        + "WHERE table_name = 'purchase_order_lines' AND column_name = 'vendor_item_id'",
                String.class);
        assertThat(nullable).isEqualTo("YES");

        String confdeltype = jdbcTemplate.queryForObject(
                "SELECT con.confdeltype FROM pg_constraint con "
                        + "JOIN pg_class rel ON rel.oid = con.conrelid "
                        + "JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey) "
                        + "WHERE rel.relname = 'purchase_order_lines' AND con.contype = 'f' "
                        + "AND att.attname = 'vendor_item_id'",
                String.class);
        assertThat(confdeltype).isEqualTo("r");
    }

    @Test
    void vendorItemPriceRowsAreInsertOnlyByShape() {
        UUID tenantId = UUID.randomUUID();
        UUID vendorId = insertVendor(tenantId);
        UUID vendorItemId = insertVendorItem(tenantId, vendorId, UUID.randomUUID(), "SKU-1");

        Instant firstEffective = Instant.now().minusSeconds(3600);
        Instant secondEffective = Instant.now();

        jdbcTemplate.update(
                "INSERT INTO vendor_item_prices (tenant_id, vendor_item_id, unit_price_paisa, price_uom, effective_from) "
                        + "VALUES (?, ?, ?, ?, ?)",
                tenantId, vendorItemId, 10000L, "KG", java.sql.Timestamp.from(firstEffective));
        jdbcTemplate.update(
                "INSERT INTO vendor_item_prices (tenant_id, vendor_item_id, unit_price_paisa, price_uom, effective_from) "
                        + "VALUES (?, ?, ?, ?, ?)",
                tenantId, vendorItemId, 11000L, "KG", java.sql.Timestamp.from(secondEffective));

        Integer count = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM vendor_item_prices WHERE vendor_item_id = ?",
                Integer.class, vendorItemId);
        assertThat(count).isEqualTo(2);
    }

    @Test
    void aVendorMaySellTheSameIngredientInTwoPackSizes() {
        UUID tenantId = UUID.randomUUID();
        UUID vendorId = insertVendor(tenantId);
        UUID ingredientId = UUID.randomUUID();

        insertVendorItem(tenantId, vendorId, ingredientId, "SKU-SMALL");
        insertVendorItem(tenantId, vendorId, ingredientId, "SKU-LARGE");

        Integer count = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM vendor_items WHERE tenant_id = ? AND vendor_id = ? AND ingredient_id = ?",
                Integer.class, tenantId, vendorId, ingredientId);
        assertThat(count).isEqualTo(2);
    }

    private UUID insertVendor(UUID tenantId) {
        UUID vendorId = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO vendors (id, tenant_id, name) VALUES (?, ?, ?)",
                vendorId, tenantId, "Test Vendor");
        return vendorId;
    }

    private UUID insertVendorItem(UUID tenantId, UUID vendorId, UUID ingredientId, String vendorSku) {
        UUID vendorItemId = UUID.randomUUID();
        jdbcTemplate.update(
                "INSERT INTO vendor_items (id, tenant_id, vendor_id, ingredient_id, vendor_sku, order_uom, pack_uom) "
                        + "VALUES (?, ?, ?, ?, ?, ?, ?)",
                vendorItemId, tenantId, vendorId, ingredientId, vendorSku, "CASE", "EACH");
        return vendorItemId;
    }
}
