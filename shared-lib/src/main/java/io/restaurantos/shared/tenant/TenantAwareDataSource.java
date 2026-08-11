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
 * Sets {@code app.current_tenant_id} and {@code app.current_branch_id} on EVERY JDBC connection
 * checkout — to the values {@link TenantContext} holds, or to empty when it holds none — so
 * PostgreSQL RLS sees both GUCs on the connection Hibernate uses inside {@code @Transactional}
 * scope, and so a connection never begins life carrying the previous borrower's tenant.
 *
 * <p><b>Why "every" is load-bearing.</b> This class used to hand back the raw connection when the
 * context was empty. That skipped the write AND the proxy, and only proxied connections are reset
 * on close — so a checkout made before the tenant was known inherited whatever the last
 * tenant-bearing borrower had left on that pooled session. Not a missing tenant: someone else's.
 * A stale GUC does not violate an RLS policy, it redirects it, so PostgreSQL returns the wrong
 * tenant's rows while being told, correctly, that the caller is that tenant. Checkouts that precede
 * a tenant are routine — scheduled sweeps, message consumers, actuator, {@code /internal/**}
 * handlers that resolve their tenant in the controller.
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
 * <p>Branch is written as empty when the context carries none, rather than being left alone.
 * Branch-aware RLS policies are permissive on an empty branch GUC, so this preserves the
 * legitimate cross-branch flows (reporting, all-branch views) that run without a branch context —
 * while removing the case where a tenant-only context inherited an earlier request's BRANCH and
 * silently scoped a whole-tenant read down to one site.
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

    /**
     * Writes both GUCs on EVERY checkout — empty when the context has no tenant — and proxies
     * every connection so close() always resets them.
     *
     * <p>This used to return the raw connection untouched when the context was empty, which did two
     * harmful things at once. It wrote no GUC, and — because only proxied connections are reset on
     * close — it left whatever the PREVIOUS borrower of that pooled connection had written. So a
     * checkout made before the tenant is known does not merely lack a tenant: it silently inherits
     * one. Measured directly: a thread holding tenant 6299cf4e… ran a transaction on a connection
     * whose {@code app.current_tenant_id} was bebfbe82…, a tenant from earlier in the same JVM.
     *
     * <p>RLS cannot catch that, for the same reason it could not catch the {@code TenantContext}
     * bleed in {@code JwtAuthenticationFilter}: a stale GUC does not violate the policy, it
     * REDIRECTS it. PostgreSQL returns the other tenant's rows because it was correctly told the
     * caller was that tenant.
     *
     * <p>Checkouts that precede a tenant are ordinary, not exotic — scheduled sweeps, RabbitMQ
     * consumers before {@code TenantAwareMessageProcessor} sets context, actuator probes,
     * {@code /internal/**} endpoints that derive their tenant inside the controller, and any
     * class-level {@code @Transactional} test whose transaction opens before {@code @BeforeEach}.
     *
     * <p>Cost: two {@code set_config} calls per checkout instead of zero on the no-tenant path,
     * issued as one round trip. That is the price of a connection never starting life holding
     * someone else's tenant.
     */
    private Connection configureTenant(Connection connection) throws SQLException {
        UUID tenantId = tenantContext.getTenantId().orElse(null);
        UUID branchId = tenantContext.getBranchId().orElse(null);
        try {
            setGucs(connection,
                    tenantId == null ? "" : tenantId.toString(),
                    branchId == null ? "" : branchId.toString());
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
                setGucs(delegate, "", "");
            } catch (SQLException ignored) {
                // fall through to close
            }
        }
    }

    /**
     * Both GUCs in one round trip. The keys are compile-time constants, never caller input, so
     * inlining them costs nothing and lets a single statement carry both values.
     *
     * <p>{@code is_local = false}: the value must survive the {@code BEGIN} Spring issues after
     * checkout. A transaction-local write would be discarded with its own implicit transaction and
     * every RLS-protected read inside the following transaction would match zero rows. Resetting
     * on close() is what keeps a session-scoped value from outliving its borrower.
     */
    private static void setGucs(Connection connection, String tenantId, String branchId)
            throws SQLException {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT set_config('" + TENANT_GUC + "', ?, false),"
                        + " set_config('" + BRANCH_GUC + "', ?, false)")) {
            ps.setString(1, tenantId);
            ps.setString(2, branchId);
            ps.execute();
        }
    }
}
