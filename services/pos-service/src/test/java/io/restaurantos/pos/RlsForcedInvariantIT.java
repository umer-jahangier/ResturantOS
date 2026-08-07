package io.restaurantos.pos;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards the defect class that phase 17b closed: RLS enabled but not FORCEd on tables the
 * application's own role owns.
 *
 * <p><b>Why this test has to work this hard.</b> Testcontainers starts PostgreSQL and hands
 * back a <i>superuser</i>, and PostgreSQL bypasses row-level security unconditionally for
 * superusers. Every existing integration test in this repository therefore runs in a world
 * where RLS never applies at all — which is exactly why 33 tables shipped with inert tenant
 * isolation and no test noticed. A green suite was not evidence. So this test does two things
 * that the ordinary harness cannot:
 *
 * <ol>
 *   <li>asserts the schema invariant directly — every RLS-enabled table must also be FORCEd,
 *       which catches a <em>new</em> table being added with {@code ENABLE} only; and</li>
 *   <li>reproduces production's ownership model — a NOSUPERUSER role that <em>owns</em> the
 *       table it queries — and proves tenant isolation actually holds for it. Under
 *       {@code FORCE} it does; with {@code ENABLE} alone the owner bypasses the policy and the
 *       assertion fails, which is precisely the production defect.</li>
 * </ol>
 */
class RlsForcedInvariantIT extends PosTestBase {

    private static final String CANARY_ROLE = "rls_canary";
    private static final String CANARY_PASSWORD = "rls_canary_pw";

    private Connection asSuperuser() throws SQLException {
        return DriverManager.getConnection(
                postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }

    @Test
    @DisplayName("every RLS-enabled table in pos_db is also FORCE ROW LEVEL SECURITY")
    void everyRlsEnabledTableIsForced() throws SQLException {
        List<String> unforced = new ArrayList<>();
        try (Connection c = asSuperuser();
             Statement s = c.createStatement();
             ResultSet rs = s.executeQuery("""
                     SELECT c.relname
                     FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relkind = 'r'
                       AND n.nspname = 'public'
                       AND c.relrowsecurity
                       AND NOT c.relforcerowsecurity
                     ORDER BY c.relname
                     """)) {
            while (rs.next()) {
                unforced.add(rs.getString(1));
            }
        }

        assertThat(unforced)
                .as("""
                    RLS is ENABLED but not FORCED on these tables. pos-service connects as the \
                    role that OWNS them, and PostgreSQL exempts a table's owner from its own \
                    policies unless FORCE is set — so their tenant_isolation policies do nothing \
                    and every tenant can read and write every other tenant's rows. Add the table \
                    to the FORCE migration (see V11__force_rls_all_tenant_tables.sql).""")
                .isEmpty();
    }

    @Test
    @DisplayName("a NOSUPERUSER table OWNER cannot see another tenant's rows (FORCE is effective)")
    void tableOwnerCannotBypassTenantIsolation() throws SQLException {
        UUID tenantA = UUID.randomUUID();
        UUID tenantB = UUID.randomUUID();
        UUID categoryA = UUID.randomUUID();
        UUID categoryB = UUID.randomUUID();

        try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
            // A role that is NOT a superuser and has no BYPASSRLS — like pos_user in production.
            dropCanaryRole(s);
            s.execute("CREATE ROLE " + CANARY_ROLE
                    + " LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '" + CANARY_PASSWORD + "'");
            s.execute("GRANT ALL ON SCHEMA public TO " + CANARY_ROLE);

            // Seed one row per tenant. Done as superuser so RLS cannot interfere with setup.
            s.execute("INSERT INTO menu_categories (id, tenant_id, name, sort_order) VALUES ('"
                    + categoryA + "','" + tenantA + "','Cat A',1)");
            s.execute("INSERT INTO menu_categories (id, tenant_id, name, sort_order) VALUES ('"
                    + categoryB + "','" + tenantB + "','Cat B',1)");
            s.execute("INSERT INTO menu_items (id, tenant_id, category_id, name, base_price_paisa)"
                    + " VALUES ('" + UUID.randomUUID() + "','" + tenantA + "','" + categoryA
                    + "','Tenant A item',1000)");
            s.execute("INSERT INTO menu_items (id, tenant_id, category_id, name, base_price_paisa)"
                    + " VALUES ('" + UUID.randomUUID() + "','" + tenantB + "','" + categoryB
                    + "','Tenant B item',2000)");

            // The production shape: the querying role OWNS the table it reads.
            s.execute("ALTER TABLE menu_items OWNER TO " + CANARY_ROLE);
            s.execute("GRANT SELECT ON menu_categories TO " + CANARY_ROLE);
        }

        try {
            try (Connection owner = DriverManager.getConnection(
                    postgres.getJdbcUrl(), CANARY_ROLE, CANARY_PASSWORD);
                 Statement s = owner.createStatement()) {

                // Sanity: this role really is the owner and really cannot bypass RLS by attribute.
                try (ResultSet rs = s.executeQuery(
                        "SELECT pg_get_userbyid(relowner) = current_user,"
                                + " (SELECT rolsuper OR rolbypassrls FROM pg_roles"
                                + "  WHERE rolname = current_user)"
                                + " FROM pg_class WHERE relname = 'menu_items'")) {
                    assertThat(rs.next()).isTrue();
                    assertThat(rs.getBoolean(1)).as("canary must own menu_items").isTrue();
                    assertThat(rs.getBoolean(2)).as("canary must not be superuser/bypassrls").isFalse();
                }

                s.execute("SELECT set_config('app.current_tenant_id', '" + tenantA + "', false)");

                try (ResultSet rs = s.executeQuery(
                        "SELECT count(*) FILTER (WHERE tenant_id <> '" + tenantA + "'), count(*)"
                                + " FROM menu_items")) {
                    assertThat(rs.next()).isTrue();
                    long foreign = rs.getLong(1);
                    long visible = rs.getLong(2);

                    assertThat(foreign)
                            .as("""
                                The owning role saw another tenant's menu_items. FORCE ROW LEVEL \
                                SECURITY is missing or was removed — tenant isolation is inert for \
                                the application and this is a live cross-tenant data leak.""")
                            .isZero();
                    assertThat(visible)
                            .as("tenant A's own rows must still be visible — isolation, not a blackout")
                            .isPositive();
                }
            }
        } finally {
            // Hand the table back before the next test class reuses this shared container.
            try (Connection admin = asSuperuser(); Statement s = admin.createStatement()) {
                s.execute("ALTER TABLE menu_items OWNER TO " + postgres.getUsername());
                dropCanaryRole(s);
            }
        }
    }

    /**
     * {@code DROP ROLE} refuses while any privilege is still granted to the role, so the grants
     * have to be surrendered first. {@code DROP OWNED BY} does both — it drops objects the role
     * owns and revokes privileges granted to it — but errors if the role does not exist, hence
     * the catalog check.
     */
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
}
