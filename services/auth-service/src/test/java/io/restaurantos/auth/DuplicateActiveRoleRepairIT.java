package io.restaurantos.auth;

import io.restaurantos.auth.integration.BaseIntegrationTest;
import io.restaurantos.auth.integration.TestFixtures;
import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.resource.ClassLoaderResourceAccessor;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.sql.Connection;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Changeset 056 applied to a database that already carries duplicates.
 *
 * <p>This is the case the migration exists for and the one nothing else covers. Every other test
 * here runs against a container whose changelog was applied to an empty database, where the repair
 * has nothing to repair — so the repair could be a complete no-op and the whole suite would still
 * be green, right up until the migration ran somewhere real and the unique index failed on data it
 * was supposed to have already fixed. A migration that fails on real data is worse than no
 * migration: it blocks every subsequent changeset for everyone.
 *
 * <p>So this test rewinds 056 on the live container — drops both indexes and the {@code is_primary}
 * column, deletes 056's {@code databasechangelog} rows — plants three active rows for one
 * (user, branch) pair with staggered {@code updated_at}, and runs Liquibase again. It asserts the
 * migration succeeds, that exactly one row survives, and that the survivor is the one the stated
 * retention rule names, not merely "some row".
 *
 * <p>The rewind is over the real schema rather than a scratch copy, because a scratch table would
 * not have this one's RLS configuration or its constraints, and those are exactly what the repair
 * has to work through.
 */
class DuplicateActiveRoleRepairIT extends BaseIntegrationTest {

    private static final String CHANGELOG = "db/changelog/db.changelog-master.xml";

    private static final UUID USER = UUID.fromString("c0000092-0000-4000-8000-000000000092");
    private static final UUID BRANCH = UUID.fromString("b0000037-0000-4000-8000-000000000037");

    /** Deliberately not in id order, so "keep the greatest id" alone cannot pass this. */
    private static final UUID OLDEST = UUID.fromString("d0000091-0000-4000-8000-000000000091");
    private static final UUID NEWEST = UUID.fromString("d0000092-0000-4000-8000-000000000092");
    private static final UUID TIED_LOW = UUID.fromString("d0000093-0000-4000-8000-000000000093");

    @Autowired JdbcTemplate jdbc;
    @Autowired DataSource dataSource;

    @Test
    void theMigrationRepairsPreExistingDuplicatesAndThenTakesHold() throws Exception {
        rewind056();
        seedThreeActiveRowsForOnePair();

        assertThat(activeRows()).as("precondition: the database is dirty").hasSize(3);

        runLiquibase();

        List<Map<String, Object>> survivors = activeRows();
        assertThat(survivors)
                .as("the repair must leave exactly one active row per (user_id, branch_id), or the "
                        + "unique index created immediately after it cannot be built and the whole "
                        + "changeset rolls back")
                .hasSize(1);
        assertThat(survivors.getFirst().get("id"))
                .as("retention rule: keep the greatest (updated_at, id) — the most recently touched "
                        + "assignment, ties broken by the greater id. d0000092 has the latest "
                        + "updated_at; d0000093 has a greater id but an older timestamp, so an "
                        + "implementation that ordered by id alone would keep the wrong row and "
                        + "quietly restore a role someone had moved the user off")
                .isEqualTo(NEWEST);

        assertThat(deactivated())
                .as("the losers are soft-deactivated, never deleted — auth_db has no audit table "
                        + "reachable from a changeset, so the row and its updated_at are the only "
                        + "record that the repair touched it")
                .containsExactlyInAnyOrder(OLDEST, TIED_LOW);

        assertThat(indexExists("uk_user_branch_roles_one_active"))
                .as("and the invariant is now held by the database")
                .isTrue();
        assertThat(indexExists("uk_user_branch_roles_one_primary")).isTrue();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns "
                        + "WHERE table_name = 'user_branch_roles' AND column_name = 'is_primary'",
                Long.class)).isEqualTo(1L);
    }

    // ── Rewind / replay machinery ─────────────────────────────────────────────

    private void rewind056() {
        jdbc.execute("DROP INDEX IF EXISTS uk_user_branch_roles_one_active");
        jdbc.execute("DROP INDEX IF EXISTS uk_user_branch_roles_one_primary");
        jdbc.execute("ALTER TABLE user_branch_roles DROP COLUMN IF EXISTS is_primary");
        jdbc.update("DELETE FROM databasechangelog WHERE id LIKE 'auth-1.0.0-056%'");
    }

    private void seedThreeActiveRowsForOnePair() {
        jdbc.update("INSERT INTO users (id, tenant_id, email, password_hash, full_name, locale, totp_enabled) "
                        + "VALUES (?, ?, 'duplicate-probe@demo.local', 'x', 'Duplicate Probe', 'en', false) "
                        + "ON CONFLICT (id) DO NOTHING",
                USER, TestFixtures.DEMO_TENANT_ID);
        jdbc.update("DELETE FROM user_branch_roles WHERE user_id = ?", USER);

        OffsetDateTime base = OffsetDateTime.now().minusDays(10);
        insertActive(OLDEST, "CASHIER", base);
        insertActive(NEWEST, "MANAGER", base.plusDays(5));
        insertActive(TIED_LOW, "WAITER", base.plusDays(1));
    }

    private void insertActive(UUID id, String roleCode, OffsetDateTime updatedAt) {
        jdbc.update(
                "INSERT INTO user_branch_roles (id, tenant_id, user_id, branch_id, role_code, is_active, updated_at) "
                        + "VALUES (?, ?, ?, ?, ?, true, ?)",
                id, TestFixtures.DEMO_TENANT_ID, USER, BRANCH, roleCode, updatedAt);
    }

    private void runLiquibase() throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            Database database = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            try (Liquibase liquibase =
                         new Liquibase(CHANGELOG, new ClassLoaderResourceAccessor(), database)) {
                liquibase.update(new Contexts("seed"), new LabelExpression());
            }
        }
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    private List<Map<String, Object>> activeRows() {
        return jdbc.queryForList(
                "SELECT id, role_code FROM user_branch_roles WHERE user_id = ? AND branch_id = ? AND is_active",
                USER, BRANCH);
    }

    private List<UUID> deactivated() {
        return jdbc.queryForList(
                "SELECT id FROM user_branch_roles WHERE user_id = ? AND branch_id = ? AND NOT is_active",
                UUID.class, USER, BRANCH);
    }

    private boolean indexExists(String name) {
        return jdbc.queryForObject(
                "SELECT COUNT(*) FROM pg_indexes WHERE tablename = 'user_branch_roles' AND indexname = ?",
                Long.class, name) == 1L;
    }
}
