package io.restaurantos.kitchen;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Guards the defect class phase 17b closed in kitchen_db: {@code kds_stations},
 * {@code kds_tickets} and {@code kds_ticket_items} had RLS ENABLEd but not FORCEd, while
 * kitchen-service connects as {@code kitchen_user} — the role that owns them. PostgreSQL
 * exempts a table's owner from its own policies unless FORCE is set, so a tenant owning 25
 * tickets could read all 112.
 *
 * <p>The KDS HTTP endpoints take an explicit branchId and filter on it in the service layer,
 * which masked the hole for those particular reads — a good reminder that a service-layer
 * filter on one path is not isolation, because every other path (event consumers, lookups by
 * ticket or order id, native queries) still saw everything.
 *
 * <p>Testcontainers hands back a superuser and superusers bypass RLS unconditionally, so this
 * asserts the schema invariant, which is superuser-independent. The behavioural proof — a
 * NOSUPERUSER owner failing to see another tenant's rows — lives in pos-service's
 * {@code RlsForcedInvariantIT}.
 */
class RlsForcedInvariantIT extends KitchenTestBase {

    @Test
    @DisplayName("every RLS-enabled table in kitchen_db is also FORCE ROW LEVEL SECURITY")
    void everyRlsEnabledTableIsForced() throws SQLException {
        List<String> unforced = new ArrayList<>();
        try (Connection c = DriverManager.getConnection(
                     postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
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
                    RLS is ENABLED but not FORCED on these tables. kitchen-service connects as \
                    the role that OWNS them, and PostgreSQL exempts a table's owner from its own \
                    policies unless FORCE is set — so their tenant_isolation policies do nothing \
                    and every tenant can read and write every other tenant's rows. Add the table \
                    to V8__force_rls_all_tenant_tables.sql.""")
                .isEmpty();
    }
}
