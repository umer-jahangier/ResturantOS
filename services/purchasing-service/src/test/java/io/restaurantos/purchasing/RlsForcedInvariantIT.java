package io.restaurantos.purchasing;

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
 * Guards the defect class phase 17b closed in purchasing_db: every one of its 14 tenant tables
 * had RLS ENABLEd but not FORCEd, while purchasing-service connects as {@code purchasing_user}
 * — the role that owns them. PostgreSQL exempts a table's owner from its own policies unless
 * FORCE is set, so tenant isolation was inert and a tenant owning one vendor could read all 14.
 *
 * <p>Testcontainers hands back a superuser, and superusers bypass RLS unconditionally, so no
 * behavioural test here can observe that defect. This asserts the schema invariant instead,
 * which is superuser-independent and catches a new table being added with {@code ENABLE} only.
 * The behavioural proof — a NOSUPERUSER owner failing to see another tenant's rows — lives in
 * pos-service's {@code RlsForcedInvariantIT}.
 */
class RlsForcedInvariantIT extends PurchasingTestBase {

    @Test
    @DisplayName("every RLS-enabled table in purchasing_db is also FORCE ROW LEVEL SECURITY")
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
                    RLS is ENABLED but not FORCED on these tables. purchasing-service connects as \
                    the role that OWNS them, and PostgreSQL exempts a table's owner from its own \
                    policies unless FORCE is set — so their tenant_isolation policies do nothing \
                    and every tenant can read and write every other tenant's rows. Add the table \
                    to V7__force_rls_all_tenant_tables.sql.""")
                .isEmpty();
    }
}
