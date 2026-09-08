package io.restaurantos.auth;

import io.restaurantos.auth.integration.BaseIntegrationTest;
import io.restaurantos.auth.integration.TestFixtures;
import liquibase.Contexts;
import liquibase.LabelExpression;
import liquibase.Liquibase;
import liquibase.database.Database;
import liquibase.database.DatabaseFactory;
import liquibase.database.jvm.JdbcConnection;
import liquibase.Scope;
import liquibase.changelog.ChangeLogHistoryServiceFactory;
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
        try {
            runTheRepairScenario();
        } finally {
            // The rewind above is performed on the SHARED container's real schema, which is what
            // makes this test worth having and also what makes it dangerous: if the replay does
            // not restore `is_primary`, every other class in this module that touches
            // UserBranchRoleEntity dies on "column ubre1_0.is_primary does not exist". That is
            // exactly what happened on CI — this test failed with 3 surviving rows and took six
            // OneActiveRolePerBranchIT tests plus the login suites down with it, turning one
            // honest failure into eight. A test may fail; it may not leave the database broken
            // for everything that runs after it.
            restoreSchemaAfterRewind();
        }
    }

    private void runTheRepairScenario() throws Exception {
        rewind056();
        seedThreeActiveRowsForOnePair();

        assertThat(activeRows()).as("precondition: the database is dirty").hasSize(3);

        runLiquibase();

        // Which of the two remaining explanations is it? Either Liquibase skipped 056 (its rows
        // are still absent afterwards), or it ran and the repair could not SEE the rows — the
        // changeset does ALTER TABLE ... NO FORCE ROW LEVEL SECURITY precisely because RLS would
        // otherwise hide them from a non-owner, and if the UPDATE matches nothing then the DO
        // block's own duplicate count matches nothing either, so it reports success and repairs
        // nothing. "Expected 1 but was 3" cannot tell those apart; this can.
        Long replayed = jdbc.queryForObject(
                "SELECT COUNT(*) FROM databasechangelog WHERE id LIKE 'auth-1.0.0-056%'", Long.class);
        assertThat(replayed)
                .as("Liquibase must re-apply 056 after the rewind — if this is 0 the replay was "
                        + "skipped and nothing below is meaningful; if it is non-zero the "
                        + "changeset ran and the repair could not see the seeded rows")
                .isNotZero();

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

    /**
     * Puts the schema back after {@link #rewind056()}, whatever happened in between.
     *
     * <p>Deliberately restores the COLUMN only, never the two indexes. 056's
     * {@code add-is-primary} carries {@code preConditions onFail="MARK_RAN"} on
     * {@code columnExists}, so a later Liquibase run skips it cleanly when the column is already
     * there — whereas the two index changesets are plain {@code CREATE UNIQUE INDEX}, which would
     * fail against an index this method had recreated. Leaving the indexes to Liquibase keeps a
     * subsequent context start-up able to repair itself; recreating them here would break it.
     *
     * <p>The probe's rows go first: three active rows for one pair are precisely what the partial
     * unique index cannot be built over.
     */
    private void restoreSchemaAfterRewind() {
        try {
            jdbc.update("DELETE FROM user_branch_roles WHERE user_id = ?", USER);

            if (!isPrimaryColumnPresent()) {
                // The proper repair: let the real changeset put back what it owns.
                runLiquibase();
            }
            if (!isPrimaryColumnPresent()) {
                jdbc.execute("ALTER TABLE user_branch_roles "
                        + "ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false");
            }
        } catch (Exception e) {
            // Never let cleanup mask the assertion that actually failed.
            System.err.println("DuplicateActiveRoleRepairIT: could not restore the schema after the "
                    + "056 rewind — sibling classes in this container may now fail on is_primary: " + e);
        }
    }

    private boolean isPrimaryColumnPresent() {
        Long n = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.columns "
                        + "WHERE table_name = 'user_branch_roles' AND column_name = 'is_primary'",
                Long.class);
        return n != null && n == 1L;
    }

    private void rewind056() {
        jdbc.execute("DROP INDEX IF EXISTS uk_user_branch_roles_one_active");
        jdbc.execute("DROP INDEX IF EXISTS uk_user_branch_roles_one_primary");
        jdbc.execute("ALTER TABLE user_branch_roles DROP COLUMN IF EXISTS is_primary");
        int removed = jdbc.update("DELETE FROM databasechangelog WHERE id LIKE 'auth-1.0.0-056%'");
        // If this is ever 0 the replay below is a no-op and every assertion after it is
        // meaningless — the failure then reads "expected 1 but was 3", which points at the
        // migration rather than at the rewind that never happened. Say which it is.
        assertThat(removed)
                .as("the rewind must actually remove 056's databasechangelog rows, or Liquibase "
                        + "will consider the changeset applied and replay nothing")
                .isGreaterThan(0);
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

    /**
     * Replays the changelog on the SAME connection that deleted 056's history rows.
     *
     * <p>The rewind's DELETE and this replay used to run on two different pooled connections, and
     * the replay behaved as though the rows were still there: it applied nothing and inserted
     * nothing, leaving databasechangelog with zero 056 rows afterwards. That number is the tell —
     * a changeset that is merely SKIPPED by a MARK_RAN precondition still records a row, so zero
     * means Liquibase never considered them at all, i.e. it believed they were already applied.
     * Running the delete and the update through one connection removes every question about what
     * one session can see of another's work.
     */
    private void runLiquibase() throws Exception {
        try (Connection connection = dataSource.getConnection()) {
            try (java.sql.Statement clear = connection.createStatement()) {
                clear.executeUpdate("DELETE FROM databasechangelog WHERE id LIKE 'auth-1.0.0-056%'");
            }
            if (!connection.getAutoCommit()) {
                connection.commit();
            }
            Database database = DatabaseFactory.getInstance()
                    .findCorrectDatabaseImplementation(new JdbcConnection(connection));
            // Liquibase caches the ran-changeset history per database. Spring already ran the
            // changelog during context start-up, so that cache still lists 056 as applied — and a
            // replay that trusts it skips every changeset the rewind just deleted, silently. That
            // is the shape of the CI failure: three rows survived and NOTHING threw, even though
            // the repair changeset ends in a DO block that raises if duplicates remain. It cannot
            // have raised, because it cannot have run. Drop the cache so the update re-reads
            // DATABASECHANGELOG from the database it is about to modify.
            Scope.getCurrentScope().getSingleton(ChangeLogHistoryServiceFactory.class).resetAll();
            try (Liquibase liquibase =
                         new Liquibase(CHANGELOG, new ClassLoaderResourceAccessor(), database)) {
                // Ask Liquibase what it believes BEFORE updating. Three explanations for "zero 056
                // rows afterwards" have now been eliminated by measurement — the DELETE does remove
                // rows, contexts match the ones that applied 056 at start-up, and the delete and
                // the update share a connection — so the next question is not why the update did
                // nothing but whether it had anything to do. If 056 is absent from the unrun list,
                // Liquibase considers it applied despite an empty changelog table, and the fault is
                // in changeset identity or a cache this reset does not reach. If it is present,
                // the update ran it and the recording is what failed.
                long unrun056 = liquibase.listUnrunChangeSets(new Contexts("seed"), new LabelExpression())
                        .stream()
                        .filter(cs -> cs.getId() != null && cs.getId().startsWith("auth-1.0.0-056"))
                        .count();
                System.out.println("DIAG_UNRUN_056=" + unrun056);
                liquibase.update(new Contexts("seed"), new LabelExpression());

                // COMMIT. This is the whole bug. The probe above reports 5 unrun changesets, so
                // Liquibase always had work to do — and afterwards databasechangelog held none of
                // them. The work was not skipped, it was discarded: this connection comes from
                // Hikari, Liquibase runs inside a transaction on it, and try-with-resources closes
                // it without committing, at which point the pool rolls the whole thing back. The
                // repair, the column, the indexes and the changelog rows all went with it, which
                // is why the symptom read as "the migration did nothing" for five rounds.
                // Spring's own start-up run never showed this because Spring commits for it.
                database.commit();
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
