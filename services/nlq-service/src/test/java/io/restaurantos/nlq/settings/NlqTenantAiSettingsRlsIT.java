package io.restaurantos.nlq.settings;

import io.restaurantos.shared.security.EncryptionService;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * V3's two guarantees, proved against a real PostgreSQL: <b>the stored bytes are not the key</b>,
 * and <b>one tenant cannot read another's AI settings row</b>.
 *
 * <h3>Why the canary role — and why a test without it would prove nothing</h3>
 *
 * <p>Testcontainers hands back a PostgreSQL <b>superuser</b>, and PostgreSQL exempts superusers
 * from row level security unconditionally, {@code FORCE} included. {@code NlqServiceIT} connects as
 * {@code nlq_user}, created as a superuser by the official image — so any RLS assertion written in
 * that harness passes with the policy deleted. That is precisely how 33 tables in this repository
 * shipped with inert RLS and a green suite.
 *
 * <p>So this test creates a {@code LOGIN NOSUPERUSER NOBYPASSRLS} role, hands it ownership of the
 * two tables (production's shape — nlq-service connects as the role that owns them, which is what
 * makes {@code FORCE} load-bearing), and <b>guard-asserts {@code rolsuper OR rolbypassrls = false}
 * before asserting anything else</b>. If the guard is what fires, the harness is the bug, not the
 * policy — and you find that out instead of collecting a false pass.
 *
 * <h3>Plain JDBC + Flyway, no Spring context</h3>
 *
 * <p>The full {@code NlqServiceApplication} context needs Redis, ClickHouse and RabbitMQ. None of
 * them can influence whether a Postgres policy is enforced, and the shared Postgres on this machine
 * is already contended. Flyway is invoked directly against the container, so what is under test is
 * the migration file itself.
 */
class NlqTenantAiSettingsRlsIT {

    private static final String CANARY_ROLE = "nlq_rls_canary";
    private static final String CANARY_PASSWORD = "nlq_rls_canary_pw";
    private static final List<String> RLS_TABLES =
            List.of("nlq_tenant_ai_settings", "nlq_ai_settings_events");

    private static final UUID TENANT_A = UUID.randomUUID();
    private static final UUID TENANT_B = UUID.randomUUID();

    /** A fake key. Only ever used as a string to assert the ABSENCE of in the stored bytes. */
    private static final String FAKE_KEY_A = "sk-ant-TEST-tenant-a-key-000000000000";
    private static final String FAKE_KEY_B = "sk-ant-TEST-tenant-b-key-111111111111";

    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("nlq_db")
                    .withUsername("nlq_user")
                    .withPassword("test-pass");

    private static EncryptionService encryption;

    @BeforeAll
    static void startAndMigrate() throws SQLException {
        POSTGRES.start();
        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .locations("classpath:db/migration")
                .load()
                .migrate();

        // A throwaway AES key for this test only.
        byte[] raw = new byte[32];
        for (int i = 0; i < raw.length; i++) {
            raw[i] = (byte) i;
        }
        encryption = new EncryptionService(Base64.getEncoder().encodeToString(raw));

        try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
            dropCanaryRole(s);
            s.execute("CREATE ROLE " + CANARY_ROLE
                    + " LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '" + CANARY_PASSWORD + "'");
            s.execute("GRANT ALL ON SCHEMA public TO " + CANARY_ROLE);
        }

        // Seeded as superuser, deliberately: setup must reach PAST the policy to plant the row a
        // leak would leak.
        seedSettings(TENANT_A, FAKE_KEY_A);
        seedSettings(TENANT_B, FAKE_KEY_B);

        try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
            for (String table : RLS_TABLES) {
                s.execute("ALTER TABLE " + table + " OWNER TO " + CANARY_ROLE);
            }
        }
    }

    @AfterAll
    static void cleanUp() throws SQLException {
        try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
            for (String table : RLS_TABLES) {
                s.execute("ALTER TABLE " + table + " OWNER TO " + POSTGRES.getUsername());
            }
            dropCanaryRole(s);
        }
        POSTGRES.stop();
    }

    private static Connection asSuperuser() throws SQLException {
        return DriverManager.getConnection(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword());
    }

    private static Connection asCanary() throws SQLException {
        return DriverManager.getConnection(POSTGRES.getJdbcUrl(), CANARY_ROLE, CANARY_PASSWORD);
    }

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

    private static void seedSettings(UUID tenantId, String plaintextKey) throws SQLException {
        byte[] ciphertext = encryption.encrypt(plaintextKey);
        try (Connection admin = asSuperuser();
             PreparedStatement ps = admin.prepareStatement("""
                     INSERT INTO nlq_tenant_ai_settings
                       (tenant_id, provider, api_key_ciphertext, api_key_last4,
                        api_key_fingerprint, key_state)
                     VALUES (?, 'ANTHROPIC', ?, ?, ?, 'VERIFIED')
                     """)) {
            ps.setObject(1, tenantId);
            ps.setBytes(2, ciphertext);
            ps.setString(3, plaintextKey.substring(plaintextKey.length() - 4));
            ps.setString(4, "0".repeat(64));
            ps.executeUpdate();
        }
    }

    /** Guards against the whole test passing because RLS was never in the path at all. */
    private static void assertRlsAppliesTo(Statement s, String table) throws SQLException {
        try (ResultSet rs = s.executeQuery(
                "SELECT (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user),"
                        + " pg_get_userbyid(relowner) = current_user, relrowsecurity, relforcerowsecurity"
                        + " FROM pg_class WHERE relname = '" + table + "'")) {
            assertThat(rs.next()).isTrue();
            assertThat(rs.getBoolean(1))
                    .as("the canary must not be superuser/BYPASSRLS, or nothing below measures "
                            + "anything — this is the exact blind spot that let 33 tables ship with "
                            + "inert RLS and a green suite")
                    .isFalse();
            assertThat(rs.getBoolean(2))
                    .as("the canary must OWN " + table + " — production's shape, and what makes "
                            + "FORCE load-bearing")
                    .isTrue();
            assertThat(rs.getBoolean(3)).as(table + " must have RLS ENABLEd").isTrue();
            assertThat(rs.getBoolean(4))
                    .as(table + " must be FORCEd, or the owner is exempt from its own policy")
                    .isTrue();
        }
    }

    // ── 1. The stored bytes are not the key ─────────────────────────────────────

    @Test
    @DisplayName("api_key_ciphertext does not contain the plaintext key")
    void ciphertextColumnDoesNotContainTheKey() throws SQLException {
        try (Connection admin = asSuperuser();
             PreparedStatement ps = admin.prepareStatement(
                     "SELECT api_key_ciphertext FROM nlq_tenant_ai_settings WHERE tenant_id = ?")) {
            ps.setObject(1, TENANT_A);
            try (ResultSet rs = ps.executeQuery()) {
                assertThat(rs.next()).as("the seeded row must exist").isTrue();
                byte[] stored = rs.getBytes(1);

                assertThat(stored).isNotNull().isNotEmpty();

                // Positive control: the ciphertext must round-trip back to the key, so this test
                // cannot pass merely because nothing meaningful was ever written.
                assertThat(encryption.decrypt(stored))
                        .as("the stored ciphertext must decrypt back to the original key")
                        .isEqualTo(FAKE_KEY_A);

                assertThat(new String(stored, StandardCharsets.UTF_8))
                        .as("""
                            The bytes in api_key_ciphertext contained the plaintext API key. \
                            Either the write path stopped calling EncryptionService, or the column \
                            is being fed a raw string. The whole point of a BYTEA-only entity is \
                            that plaintext never reaches this column.""")
                        .doesNotContain(FAKE_KEY_A);
            }
        }
    }

    @Test
    @DisplayName("the audit table stores no key material — not the key, not even the last 4")
    void auditTableHoldsNoKeyMaterial() throws SQLException {
        try (Connection admin = asSuperuser();
             ResultSet rs = admin.createStatement().executeQuery(
                     "SELECT column_name FROM information_schema.columns "
                             + "WHERE table_name = 'nlq_ai_settings_events'")) {
            StringBuilder columns = new StringBuilder();
            while (rs.next()) {
                columns.append(rs.getString(1)).append(',');
            }
            String all = columns.toString();

            assertThat(all).as("the audit table must actually have columns").contains("action");
            // An audit table is long-lived and widely readable — the classic place a credential
            // quietly ends up and is never reviewed again.
            assertThat(all).doesNotContain("api_key").doesNotContain("last4")
                    .doesNotContain("fingerprint").doesNotContain("ciphertext");
        }
    }

    // ── 2. Tenant isolation, measured under a role that RLS actually applies to ──

    @Test
    @DisplayName("tenant A sees its own AI settings row and NOT tenant B's")
    void tenantCannotReadAnotherTenantsAiSettings() throws SQLException {
        try (Connection c = asCanary(); Statement s = c.createStatement()) {
            assertRlsAppliesTo(s, "nlq_tenant_ai_settings");

            s.execute("SELECT set_config('app.current_tenant_id', '" + TENANT_A + "', false)");

            try (ResultSet rs = s.executeQuery(
                    "SELECT count(*) FILTER (WHERE tenant_id = '" + TENANT_A + "'),"
                            + " count(*) FILTER (WHERE tenant_id = '" + TENANT_B + "')"
                            + " FROM nlq_tenant_ai_settings")) {
                assertThat(rs.next()).isTrue();

                // The positive control and the isolation assertion in ONE method. Proving a foreign
                // row is hidden means nothing unless the same connection is shown to still see its
                // own — otherwise "isolated" and "switched off" are indistinguishable, and this
                // repository has produced green tests of both kinds on the same day.
                assertThat(rs.getLong(1))
                        .as("tenant A must still see its OWN settings row")
                        .isEqualTo(1);
                assertThat(rs.getLong(2))
                        .as("""
                            Tenant A could read tenant B's AI settings row. The tenant_isolation \
                            policy on nlq_tenant_ai_settings is missing, or FORCE ROW LEVEL SECURITY \
                            was dropped — the owner is then exempt from its own policy, and this \
                            table holds every tenant's encrypted provider credential.""")
                        .isZero();
            }
        }
    }

    @Test
    @DisplayName("a tenantless connection reads zero rows rather than throwing")
    void tenantlessReadAnswersEmptyRatherThanErroring() throws SQLException {
        try (Connection c = asCanary(); Statement s = c.createStatement()) {
            assertRlsAppliesTo(s, "nlq_tenant_ai_settings");

            // Exactly what TenantAwareDataSource writes on a tenantless checkout, and again on
            // every reset at connection close: the EMPTY STRING, not an absent GUC.
            s.execute("SELECT set_config('app.current_tenant_id', '', false)");

            for (String table : RLS_TABLES) {
                long[] visible = new long[1];
                assertThatCode(() -> visible[0] = countAll(c, table))
                        .as("""
                            Reading %s with an empty tenant GUC threw instead of answering. The \
                            policy is casting the raw GUC — ''::uuid raises "invalid input syntax \
                            for type uuid" — so the NULLIF wrapper is missing. Fail-closed is right; \
                            failing LOUDLY on a legitimately tenantless read is not.""".formatted(table))
                        .doesNotThrowAnyException();
                assertThat(visible[0])
                        .as("a connection carrying no tenant must see no rows in " + table)
                        .isZero();
            }
        }
    }

    private static long countAll(Connection c, String table) throws SQLException {
        try (Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("SELECT count(*) FROM " + table)) {
            rs.next();
            return rs.getLong(1);
        }
    }
}
