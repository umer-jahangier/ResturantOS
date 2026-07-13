package io.restaurantos.shared.tenant;

import org.springframework.jdbc.datasource.DelegatingDataSource;

import javax.sql.DataSource;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.UUID;

/**
 * Sets {@code app.current_tenant_id} (and, when present, {@code app.current_branch_id}) on
 * every JDBC connection checkout when {@link TenantContext} holds a tenant, so PostgreSQL RLS
 * sees both GUCs on the connection Hibernate uses inside {@code @Transactional} scope.
 *
 * <p><b>Why the GUCs are session-scoped, not transaction-local.</b> Spring's transaction manager
 * checks a connection out of the pool <i>before</i> it issues {@code BEGIN}. A GUC written with
 * {@code set_config(key, value, true)} (transaction-local) at checkout therefore lands in its own
 * implicit transaction and is discarded the moment that statement completes — the subsequent
 * {@code BEGIN} starts with no tenant GUC at all. Every RLS-protected read inside a write
 * transaction then matched zero rows. (Observed as {@code INVALID_ACCOUNT_CODE} on expense
 * creation: the code being validated was present and active, but RLS hid it from the validating
 * SELECT. Postgres statement log showed {@code set_config(...,true)} → {@code BEGIN} → SELECT.)
 *
 * <p>So the GUCs are set with {@code is_local = false}, which persists them for the life of the
 * database session — i.e. across the {@code BEGIN} that follows. Because sessions are pooled, the
 * returned {@link Connection} is proxied so that {@code close()} resets both GUCs to empty before
 * handing the connection back. A tenant's value can therefore never be observed by a later request
 * that reuses the same physical connection: RLS policies read the GUC via
 * {@code NULLIF(current_setting(..., true), '')}, so an empty value is treated as "no tenant" and
 * fails closed.
 *
 * <p>Branch is set only when the context carries one; when unset, branch-aware RLS policies (which
 * are permissive on an empty branch GUC) fall back to tenant-only scoping — preserving legitimate
 * cross-branch flows (reporting, all-branch views) that run without a branch context.
 */
public class TenantAwareDataSource extends DelegatingDataSource {

    private static final String TENANT_GUC = "app.current_tenant_id";
    private static final String BRANCH_GUC = "app.current_branch_id";

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
            setConfig(connection, TENANT_GUC, tenantId.toString());
            if (branchId != null) {
                setConfig(connection, BRANCH_GUC, branchId.toString());
            }
        } catch (SQLException ex) {
            connection.close();
            throw ex;
        }
        return proxyResettingOnClose(connection);
    }

    /**
     * Wraps the connection so returning it to the pool clears the session GUCs first. Without this,
     * a pooled connection would carry one request's tenant into the next.
     */
    private static Connection proxyResettingOnClose(Connection connection) {
        return (Connection) Proxy.newProxyInstance(
                TenantAwareDataSource.class.getClassLoader(),
                new Class<?>[]{Connection.class},
                new ResetGucsOnClose(connection));
    }

    private record ResetGucsOnClose(Connection delegate) implements InvocationHandler {

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            if ("close".equals(method.getName())) {
                resetGucs();
                return method.invoke(delegate, args);
            }
            // Identity methods must operate on the proxy, not the delegate, so pooled-connection
            // bookkeeping that compares references still behaves.
            if ("equals".equals(method.getName())) {
                return proxy == args[0];
            }
            if ("hashCode".equals(method.getName())) {
                return System.identityHashCode(proxy);
            }
            try {
                return method.invoke(delegate, args);
            } catch (java.lang.reflect.InvocationTargetException ex) {
                throw ex.getTargetException();
            }
        }

        private void resetGucs() {
            // Best-effort: a connection already broken (aborted txn, network loss) is being
            // discarded by the pool anyway, so a failure to reset here is not actionable — and
            // must not mask the caller's original close().
            try {
                if (delegate.isClosed()) {
                    return;
                }
                setConfig(delegate, TENANT_GUC, "");
                setConfig(delegate, BRANCH_GUC, "");
            } catch (SQLException ignored) {
                // fall through to close
            }
        }
    }

    private static void setConfig(Connection connection, String key, String value) throws SQLException {
        // is_local = false: must survive the BEGIN that Spring issues after checkout. Reset on
        // close() keeps this from leaking across pooled requests.
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT set_config(?, ?, false)")) {
            ps.setString(1, key);
            ps.setString(2, value);
            ps.execute();
        }
    }
}
