package io.restaurantos.shared.tenant;

import org.springframework.jdbc.datasource.DelegatingDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;

/**
 * Sets {@code app.current_tenant_id} on every JDBC connection checkout when
 * {@link TenantContext} holds a tenant. Ensures PostgreSQL RLS sees the GUC on
 * the same connection Hibernate uses inside {@code @Transactional} scope.
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
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT set_config('app.current_tenant_id', ?, true)")) {
            ps.setString(1, tenantId.toString());
            ps.execute();
        } catch (SQLException ex) {
            connection.close();
            throw ex;
        }
        return connection;
    }
}
