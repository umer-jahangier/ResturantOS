package io.restaurantos.inventory;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the 08-01 schema (V1__inventory_schema.sql + V2__shared_infra_tables.sql) applies
 * cleanly against a real Postgres via Flyway, AND that FORCE ROW LEVEL SECURITY + the
 * tenant_isolation policy are actually enforced at the pg_catalog level on domain tables —
 * the runtime proof of the T-8-XTEN mitigation (08-01's FORCE-RLS-from-V1 guarantee).
 *
 * Because the Testcontainers Postgres connection is a superuser, RLS row-visibility cannot
 * be exercised by attempting a cross-tenant SELECT (superusers bypass RLS regardless of
 * FORCE) — per RESEARCH.md Assumption A2 / decision [03-03-B], this IT instead asserts the
 * pg_catalog metadata directly: relrowsecurity/relforcerowsecurity flags on pg_class, and
 * policy presence in pg_policies.
 */
class SchemaMigrationIT extends InventoryTestBase {

    @Autowired
    JdbcTemplate jdbcTemplate;

    private static final List<String> DOMAIN_TABLES = List.of(
            "units_of_measure", "ingredients", "ingredient_branch_stock", "stock_lots",
            "recipes", "recipe_lines", "inventory_movements", "stock_transfers",
            "stock_transfer_lines", "stock_counts", "stock_count_lines"
    );

    private static final List<String> INFRA_TABLES = List.of(
            "event_outbox", "idempotency_keys", "processed_events"
    );

    @Test
    void allFourteenExpectedTablesExist() {
        List<String> tables = jdbcTemplate.queryForList(
                "SELECT table_name FROM information_schema.tables "
                        + "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
                String.class);

        Set<String> expected = new java.util.HashSet<>();
        expected.addAll(DOMAIN_TABLES);
        expected.addAll(INFRA_TABLES);

        assertThat(tables).containsAll(expected);
        assertThat(DOMAIN_TABLES).hasSize(11);
        assertThat(INFRA_TABLES).hasSize(3);
    }

    @Test
    void ingredientBranchStock_hasForceRlsAndTenantIsolationPolicy() {
        var rlsFlags = jdbcTemplate.queryForMap(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                        + "WHERE relname = ? AND relnamespace = 'public'::regnamespace",
                "ingredient_branch_stock");

        assertThat(rlsFlags.get("relrowsecurity")).isEqualTo(true);
        assertThat(rlsFlags.get("relforcerowsecurity")).isEqualTo(true);

        Integer policyCount = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM pg_policies WHERE tablename = ? AND policyname = ?",
                Integer.class, "ingredient_branch_stock", "tenant_isolation");

        assertThat(policyCount).isEqualTo(1);
    }

    @Test
    void allDomainTables_haveForceRlsAndTenantIsolationPolicy() {
        for (String table : DOMAIN_TABLES) {
            var rlsFlags = jdbcTemplate.queryForMap(
                    "SELECT relrowsecurity, relforcerowsecurity FROM pg_class "
                            + "WHERE relname = ? AND relnamespace = 'public'::regnamespace",
                    table);

            assertThat(rlsFlags.get("relrowsecurity"))
                    .as("relrowsecurity for %s", table).isEqualTo(true);
            assertThat(rlsFlags.get("relforcerowsecurity"))
                    .as("relforcerowsecurity for %s", table).isEqualTo(true);

            Integer policyCount = jdbcTemplate.queryForObject(
                    "SELECT count(*) FROM pg_policies WHERE tablename = ? AND policyname = ?",
                    Integer.class, table, "tenant_isolation");

            assertThat(policyCount).as("tenant_isolation policy count for %s", table).isEqualTo(1);
        }
    }

    @Test
    void infraTables_areRlsExempt() {
        for (String table : INFRA_TABLES) {
            Boolean rowSecurity = jdbcTemplate.queryForObject(
                    "SELECT relrowsecurity FROM pg_class "
                            + "WHERE relname = ? AND relnamespace = 'public'::regnamespace",
                    Boolean.class, table);

            assertThat(rowSecurity).as("relrowsecurity for %s", table).isEqualTo(false);
        }
    }
}
