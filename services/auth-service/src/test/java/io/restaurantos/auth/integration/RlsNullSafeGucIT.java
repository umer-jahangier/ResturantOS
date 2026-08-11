package io.restaurantos.auth.integration;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Proves changeset 087 actually landed on {@code user_station_assignments}, and that every live
 * policy in auth_db now carries the null-safe form.
 *
 * <p><b>The defect.</b> 053 converted the six policies that existed when it was written to
 * {@code NULLIF(current_setting('app.current_tenant_id', true), '')::uuid}. 086 then added
 * {@code user_station_assignments} and, running AFTER 053 in the master changelog, created its
 * policy in the raw-cast form 053 exists to remove — which is what two forms of one condition
 * living side by side reliably produces. The GUC's "no tenant" value is the EMPTY STRING:
 * {@code TenantAwareDataSource} writes it on every tenantless checkout and again on every reset at
 * connection close, and {@code ''::uuid} raises {@code invalid input syntax for type uuid}. So a
 * legitimately tenantless read failed loudly instead of returning nothing. 087 makes the GUC NULL
 * instead, {@code tenant_id = NULL} is NULL, and the row is excluded — the same fail-closed
 * outcome, expressed as an answer.
 *
 * <p><b>Why the canary role.</b> Testcontainers hands back a PostgreSQL <i>superuser</i>, and
 * PostgreSQL exempts superusers from row level security unconditionally, FORCE included. Every
 * other IT in this module therefore runs in a world where these policies never apply at all —
 * asserting one over that connection measures nothing, which is how 33 tables in this repository
 * shipped with inert RLS behind a green suite. So these tests create a NOSUPERUSER NOBYPASSRLS role
 * and hand it ownership of the table (production's shape: auth-service connects as the role that
 * owns it, which is why 086's FORCE is load-bearing), and every assertion is made over that
 * connection. The same shape as pos-service's {@code RlsForcedInvariantIT}.
 *
 * <p><b>Both halves, one test.</b> {@link #aTenantScopedReadIsUnaffectedByTheNullSafeCast()}
 * asserts that tenant A still SEES its own assignment in the same assertion that proves it cannot
 * see tenant B's — the rule {@code KdsAccessIsolationIT}'s javadoc sets out. A check that only
 * asserts an absence cannot tell "isolated" from "switched off", and this repository has produced
 * green tests of both kinds on the same day. The positive control is also what proves NULLIF is a
 * no-op for a non-empty GUC.
 *
 * <p><b>Falsification.</b> Revert 087's SQL to the raw cast, or drop its {@code <include>} from
 * db.changelog-master.xml, and {@link #aTenantlessReadAnswersEmptyRatherThanErroring()} fails with
 * {@code invalid input syntax for type uuid: ""}. Both were run; the second is the one that proves
 * the changeset is actually reached, which SQL-level falsification alone does not.
 *
 * <p>{@link #everyLivePolicyInAuthDbIsNullSafe()} then closes the loop for the whole database, so a
 * future changeset that adds a table with the raw-cast form — precisely what 086 did after 053 —
 * fails here rather than in production.
 */
class RlsNullSafeGucIT extends BaseIntegrationTest {

    private static final String CANARY_ROLE = "rls_canary";
    private static final String CANARY_PASSWORD = "rls_canary_pw";
    private static final String TABLE = "user_station_assignments";

    private static final UUID TENANT_A = UUID.fromString("aa000001-0000-4000-8000-0000000000a1");
    private static final UUID TENANT_B = UUID.fromString("bb000001-0000-4000-8000-0000000000b1");

    private static Connection asSuperuser() throws SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static Connection asCanary() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), CANARY_ROLE, CANARY_PASSWORD);
    }

    /**
     * Seeds one assignment per tenant and hands the table to a NOSUPERUSER role for the duration of
     * the work. Setup runs as superuser precisely because it has to reach past RLS to plant the row
     * a leak would leak. Ownership is handed back in the finally: the container is shared with
     * every other IT class in this fork.
     */
    private static void withCanary(CanaryWork work) throws SQLException {
        UUID assignmentA = UUID.randomUUID();
        UUID assignmentB = UUID.randomUUID();
        UUID userA = UUID.randomUUID();
        UUID userB = UUID.randomUUID();
        try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
            dropCanaryRole(s);
            s.execute("CREATE ROLE " + CANARY_ROLE
                    + " LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '" + CANARY_PASSWORD + "'");
            s.execute("GRANT ALL ON SCHEMA public TO " + CANARY_ROLE);

            insertUser(s, userA, TENANT_A, "rls-canary-a@example.test");
            insertUser(s, userB, TENANT_B, "rls-canary-b@example.test");
            insertAssignment(s, assignmentA, TENANT_A, userA);
            insertAssignment(s, assignmentB, TENANT_B, userB);

            s.execute("ALTER TABLE " + TABLE + " OWNER TO " + CANARY_ROLE);
        }
        try {
            work.run(assignmentA, assignmentB);
        } finally {
            try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
                s.execute("ALTER TABLE " + TABLE + " OWNER TO " + POSTGRES.getUsername());
                s.execute("DELETE FROM " + TABLE + " WHERE user_id IN ('" + userA + "','" + userB + "')");
                s.execute("DELETE FROM users WHERE id IN ('" + userA + "','" + userB + "')");
                dropCanaryRole(s);
            }
        }
    }

    private static void insertUser(Statement s, UUID id, UUID tenant, String email)
            throws SQLException {
        s.execute("INSERT INTO users (id, tenant_id, email, password_hash) VALUES ('"
                + id + "','" + tenant + "','" + email + "','x')");
    }

    private static void insertAssignment(Statement s, UUID id, UUID tenant, UUID userId)
            throws SQLException {
        s.execute("INSERT INTO " + TABLE + " (id, tenant_id, user_id, branch_id, station_code)"
                + " VALUES ('" + id + "','" + tenant + "','" + userId + "','" + UUID.randomUUID()
                + "','GRILL')");
    }

    /** Called before creating the role too, so it has to tolerate the role not existing. */
    private static void dropCanaryRole(Statement s) throws SQLException {
        s.execute(String.format("""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%1$s') THEN
                        DROP OWNED BY %1$s;
                        DROP ROLE %1$s;
                    END IF;
                END $$;
                """, CANARY_ROLE));
    }

    /** Guards against the assertions below passing because RLS was never in the path at all. */
    private static void assertRlsAppliesTo(Statement s) throws SQLException {
        try (ResultSet rs = s.executeQuery(
                "SELECT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),"
                        + " pg_get_userbyid(relowner) = current_user, relforcerowsecurity"
                        + " FROM pg_class WHERE relname = '" + TABLE + "'")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getBoolean(1))
                    .as("the canary must not be superuser/BYPASSRLS, or nothing below measures anything")
                    .isFalse();
            assertThat(rs.getBoolean(2))
                    .as("the canary must own " + TABLE + " — production's shape")
                    .isTrue();
            assertThat(rs.getBoolean(3))
                    .as(TABLE + " must be FORCEd, or the owner is exempt from its own policy")
                    .isTrue();
        }
    }

    @Test
    @DisplayName("a tenantless connection reads zero station assignments without throwing")
    void aTenantlessReadAnswersEmptyRatherThanErroring() throws SQLException {
        withCanary((assignmentA, assignmentB) -> {
            try (Connection c = asCanary(); Statement s = c.createStatement()) {
                assertRlsAppliesTo(s);

                // Exactly what TenantAwareDataSource writes on a tenantless checkout and on every
                // reset at close: the EMPTY STRING, not an absent GUC.
                s.execute("SELECT set_config('app.current_tenant_id', '', false)");

                long[] visible = new long[1];
                assertThatCode(() -> {
                    try (Statement q = c.createStatement();
                         ResultSet rs = q.executeQuery("SELECT count(*) FROM " + TABLE)) {
                        rs.next();
                        visible[0] = rs.getLong(1);
                    }
                })
                        .as("""
                            Reading user_station_assignments with an empty tenant GUC threw instead \
                            of answering. The policy is casting the raw GUC — ''::uuid raises \
                            "invalid input syntax for type uuid" — so changeset 087 either did not \
                            run or was reverted. Fail-closed is right; failing LOUDLY on a \
                            legitimately tenantless read is not.""")
                        .doesNotThrowAnyException();

                assertThat(visible[0])
                        .as("a connection carrying no tenant must see no assignments — and there ARE "
                                + "two rows in the table, so zero here is exclusion, not an empty "
                                + "fixture")
                        .isZero();
            }
        });
    }

    @Test
    @DisplayName("NULLIF changes nothing for a connection that does carry a tenant")
    void aTenantScopedReadIsUnaffectedByTheNullSafeCast() throws SQLException {
        withCanary((assignmentA, assignmentB) -> {
            try (Connection c = asCanary(); Statement s = c.createStatement()) {
                assertRlsAppliesTo(s);
                s.execute("SELECT set_config('app.current_tenant_id', '" + TENANT_A + "', false)");

                try (ResultSet rs = s.executeQuery(
                        "SELECT count(*) FILTER (WHERE id = '" + assignmentA + "'),"
                                + " count(*) FILTER (WHERE id = '" + assignmentB + "')"
                                + " FROM " + TABLE)) {
                    assertThat(rs.next()).isTrue();
                    long own = rs.getLong(1);
                    long foreign = rs.getLong(2);

                    // The positive control and the isolation assertion in one method. Proving a
                    // foreign row is hidden means nothing unless the same connection is shown to
                    // still see its own — otherwise "isolated" and "switched off" look identical,
                    // and NULLIF silently swallowing a valid tenant would read as a pass.
                    assertThat(own)
                            .as("tenant A must still see its own station assignment — NULLIF must be "
                                    + "a no-op for a non-empty GUC")
                            .isOne();
                    assertThat(foreign)
                            .as("tenant A must not see tenant B's station assignment")
                            .isZero();
                }
            }
        });
    }

    /**
     * The whole-database closure. 086 added a policy in the raw-cast form a year of changesets
     * after 053 had removed every other instance of it, and nothing caught that — because nothing
     * was looking at the database as a whole. This looks.
     *
     * <p>Reads {@code pg_policies}, not the changelog files: a migration that was never included,
     * or a policy replaced out of band, diverges from the XML and this is the side that decides.
     */
    @Test
    @DisplayName("every live tenant policy in auth_db reads the GUC through NULLIF")
    void everyLivePolicyInAuthDbIsNullSafe() throws SQLException {
        try (Connection c = asSuperuser();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT tablename || '.' || policyname
                     FROM pg_policies
                     WHERE schemaname = 'public'
                       AND qual LIKE '%current_setting(''app.current_tenant_id''%'
                       AND qual NOT LIKE '%NULLIF%'
                     ORDER BY 1
                     """)) {
            java.util.List<String> rawCast = new java.util.ArrayList<>();
            while (rs.next()) {
                rawCast.add(rs.getString(1));
            }
            assertThat(rawCast)
                    .as("""
                        These policies cast the tenant GUC directly. The GUC's "no tenant" value is \
                        the empty string, and ''::uuid raises "invalid input syntax for type uuid", \
                        so a legitimately tenantless read of these tables throws instead of \
                        returning nothing. Wrap the GUC in NULLIF(..., '') in a NEW changeset — see \
                        087, and 053 before it.""")
                    .isEmpty();
        }
    }

    @FunctionalInterface
    private interface CanaryWork {
        void run(UUID assignmentA, UUID assignmentB) throws SQLException;
    }
}
