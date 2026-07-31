package io.restaurantos.inventory;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.MigrationVersion;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;

import java.math.BigDecimal;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves V7__uom_measure_type.sql can migrate a database that ALREADY HAS UNITS — the only kind
 * that exists outside a test.
 *
 * <p>V7 shipped without the {@code NO FORCE ROW LEVEL SECURITY} window V5 and V10 use around their
 * backfills. {@code units_of_measure} has been FORCE RLS since V1 and the migration user owns it,
 * so FORCE applies to the migration's own session; no migration sets {@code app.current_tenant_id},
 * which leaves the tenant_isolation predicate NULL for every row. The backfill therefore matched
 * nothing and the {@code SET NOT NULL} that follows failed with "column measure_type contains null
 * values" — on a live database, mid-deploy.
 *
 * <p>Every other IT in this module missed it, and could not have caught it, for two independent
 * reasons. {@link InventoryTestBase} migrates a FRESH schema, where a backfill over zero rows is
 * indistinguishable from a backfill that touched nothing; and its Postgres connection is the
 * container SUPERUSER, which bypasses RLS outright, so FORCE is inert there no matter what.
 *
 * <p>So this test reconstructs the two production conditions the rest of the suite lacks: it runs
 * Flyway as a NOSUPERUSER NOBYPASSRLS role that owns the schema, and it seeds real rows at V6
 * before letting V7 run. Both halves are load-bearing — drop either and the bug walks straight
 * through again.
 */
class UomMeasureTypeBackfillIT {

    /**
     * Its own container rather than {@link InventoryTestBase}'s shared one: that container is
     * migrated to head in a {@code @BeforeAll}, and this test needs to stop at V6 and control who
     * runs the migration.
     */
    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("inventory_db")
            .withUsername("inventory_user")
            .withPassword("inventory_pass");

    /** Mirrors the real deployment role. The container's own `inventory_user` is a superuser. */
    private static final String MIGRATOR = "inventory_migrator";
    private static final String MIGRATOR_PASSWORD = "migrator_pass";

    private static final UUID TENANT = UUID.randomUUID();

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
        postgres.start();
    }

    @AfterAll
    static void stopContainer() {
        postgres.stop();
    }

    private static Connection asSuperuser() throws Exception {
        return DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    private static void migrateTo(String version) {
        Flyway.configure()
                // As the migrator role, NOT the superuser — otherwise RLS is bypassed and this
                // whole test proves nothing.
                .dataSource(postgres.getJdbcUrl(), MIGRATOR, MIGRATOR_PASSWORD)
                .locations("classpath:db/migration")
                .target(MigrationVersion.fromVersion(version))
                .baselineOnMigrate(false)
                .load()
                .migrate();
    }

    @BeforeAll
    static void migrateWithDataAlreadyPresent() throws Exception {
        try (Connection admin = asSuperuser(); Statement sql = admin.createStatement()) {
            // NOBYPASSRLS is the point: without it Postgres lets the role read straight past every
            // policy and the migration would appear to work.
            sql.execute("CREATE ROLE " + MIGRATOR + " LOGIN PASSWORD '" + MIGRATOR_PASSWORD
                    + "' NOSUPERUSER NOBYPASSRLS");
            sql.execute("GRANT ALL ON SCHEMA public TO " + MIGRATOR);
            sql.execute("ALTER SCHEMA public OWNER TO " + MIGRATOR);
        }

        migrateTo("6");

        // Seeded as the superuser, standing in for rows the running application wrote with the
        // tenant GUC set. What matters is only that they EXIST when V7 runs.
        try (Connection admin = asSuperuser(); Statement sql = admin.createStatement()) {
            insertUom(sql, "kg", "Kilogram");
            insertUom(sql, "ml", "Millilitre");
            insertUom(sql, "EACH", "Each");

            UUID categoryId = UUID.randomUUID();
            sql.execute("INSERT INTO item_categories (id, tenant_id, parent_id, level, name) VALUES ('"
                    + categoryId + "', '" + TENANT + "', NULL, 1, 'Dry Goods')");
            // measure_type COUNT beside a base unit of kg — exactly the disagreement V7 step (4)
            // exists to repair, and which it silently skipped while the read was RLS-filtered.
            sql.execute("INSERT INTO ingredients (id, tenant_id, name, base_uom_code, reorder_point, "
                    + "category_id, measure_type) VALUES ('" + UUID.randomUUID() + "', '" + TENANT
                    + "', 'Flour', 'kg', " + BigDecimal.ZERO + ", '" + categoryId + "', 'COUNT')");
        }

        // The regression itself: before the fix this threw, and no assertion below was ever reached.
        migrateTo("7");
    }

    private static void insertUom(Statement sql, String code, String name) throws Exception {
        sql.execute("INSERT INTO units_of_measure (id, tenant_id, code, name) VALUES ('"
                + UUID.randomUUID() + "', '" + TENANT + "', '" + code + "', '" + name + "')");
    }

    private static String scalar(String query) throws Exception {
        try (Connection admin = asSuperuser();
             Statement sql = admin.createStatement();
             ResultSet rs = sql.executeQuery(query)) {
            assertThat(rs.next()).as("query returned no row: %s", query).isTrue();
            return rs.getString(1);
        }
    }

    @Test
    void unitsThatExistedBeforeV7GetADimensionRatherThanANullColumn() throws Exception {
        assertThat(scalar("SELECT measure_type FROM units_of_measure WHERE code = 'kg'"))
                .isEqualTo("WEIGHT");
        assertThat(scalar("SELECT measure_type FROM units_of_measure WHERE code = 'ml'"))
                .isEqualTo("VOLUME");
        // Nothing recognisable in the code, so V6's own default applies.
        assertThat(scalar("SELECT measure_type FROM units_of_measure WHERE code = 'EACH'"))
                .isEqualTo("COUNT");
    }

    @Test
    void theIngredientRepairActuallyRunsInsteadOfSilentlyMatchingNothing() throws Exception {
        // The quieter half of the same bug. Left unrepaired, this row stays un-editable through the
        // UI forever: the form offers only COUNT units and the service rejects the save.
        assertThat(scalar("SELECT measure_type FROM ingredients WHERE name = 'Flour'"))
                .isEqualTo("WEIGHT");
    }

    @Test
    void everyTableV7TouchedIsBackUnderForceRls() throws Exception {
        // A migration that opens a NO FORCE window and forgets to close it disables tenant
        // isolation for the whole table, permanently and silently.
        for (String table : new String[] {"units_of_measure", "ingredients"}) {
            assertThat(scalar("SELECT relforcerowsecurity::text FROM pg_class WHERE relname = '"
                    + table + "' AND relnamespace = 'public'::regnamespace"))
                    .as("%s must not be left with FORCE ROW LEVEL SECURITY disabled", table)
                    .isEqualTo("true");
            assertThat(scalar("SELECT relrowsecurity::text FROM pg_class WHERE relname = '"
                    + table + "' AND relnamespace = 'public'::regnamespace"))
                    .as("%s must still have RLS enabled", table)
                    .isEqualTo("true");
        }
    }
}
