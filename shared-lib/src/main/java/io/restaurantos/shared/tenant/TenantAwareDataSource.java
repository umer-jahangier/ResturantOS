package io.restaurantos.shared.tenant;

import org.springframework.jdbc.datasource.DelegatingDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;

/**
 * Sets {@code app.current_tenant_id} (and, when present, {@code app.current_branch_id}) on
 * every JDBC connection checkout when {@link TenantContext} holds a tenant. Ensures PostgreSQL
 * RLS sees both GUCs on the same connection Hibernate uses inside {@code @Transactional} scope.
 *
 * <p>Both GUCs are set transaction-local ({@code set_config(..., true)}), so a value set for one
 * request never leaks onto a later request that reuses the pooled connection. Branch is set only
 * when the context carries one; when unset, branch-aware RLS policies (which are permissive on an
 * empty branch GUC) fall back to tenant-only scoping — preserving legitimate cross-branch flows
 * (reporting, all-branch views) that run without a branch context.
 */
public class TenantAwareDataSource extends DelegatingDataSource {

    private final TenantContext tenantContext;

    public TenantAwareDataSource(DataSource targetDataSource, TenantContext tenantContext) {
        super(targetDataSource);
        this.tenantContext = tenantContext;
    }

    @Override
    public Connection getConnection() throws SQLException {
        return configureTenant(super.getConnection());
    }

    @Override
    public Connection getConnection(String username, String password) throws SQLException {
        return configureTenant(super.getConnection(username, password));
    }

    private Connection configureTenant(Connection connection) throws SQLException {
        UUID tenantId = tenantContext.getTenantId().orElse(null);
        if (tenantId == null) {
            return connection;
        }
        UUID branchId = tenantContext.getBranchId().orElse(null);
        try {
            setConfig(connection, "app.current_tenant_id", tenantId.toString());
            if (branchId != null) {
                setConfig(connection, "app.current_branch_id", branchId.toString());
            }
        } catch (SQLException ex) {
            connection.close();
            throw ex;
        }
        return connection;
    }

    private static void setConfig(Connection connection, String key, String value) throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT set_config(?, ?, true)")) {
            ps.setString(1, key);
            ps.setString(2, value);
            ps.execute();
        }
    }
}
