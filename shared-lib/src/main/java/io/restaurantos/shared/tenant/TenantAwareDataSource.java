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
 * <p><b>And keeps them there.</b> Checkout is only the first write. The returned connection is
 * proxied, and the proxy re-synchronises both GUCs from {@link TenantContext} whenever the thread's
 * tenant moves while the connection is still checked out — because Spring borrows the connection at
 * transaction start, which is routinely EARLIER than the moment the tenant becomes known
 * (consumers, sweeps, {@code /internal/**} handlers, class-level {@code @Transactional} tests). See
 * {@code TenantGucConnectionHandler} below for the exact rule and its three deliberate limits.
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
        String tenantId = tenantContext.getTenantId().map(UUID::toString).orElse("");
        String branchId = tenantContext.getBranchId().map(UUID::toString).orElse("");
        try {
            setGucs(connection, tenantId, branchId);
        } catch (SQLException ex) {
            connection.close();
            throw ex;
        }
        return proxy(connection, tenantId, branchId);
    }

    /**
     * Wraps the connection so that (a) returning it to the pool clears the session GUCs first —
     * without which a pooled connection would carry one request's tenant into the next — and (b)
     * the GUCs are re-synchronised from {@link TenantContext} if the tenant changes while the
     * connection is still checked out.
     */
    private Connection proxy(Connection connection, String tenantId, String branchId) {
        return (Connection) Proxy.newProxyInstance(
                TenantAwareDataSource.class.getClassLoader(),
                new Class<?>[]{Connection.class},
                new TenantGucConnectionHandler(connection, tenantContext, tenantId, branchId));
    }

    /**
     * Keeps the connection's GUCs equal to what {@link TenantContext} holds, for as long as the
     * connection is checked out, and blanks them on the way back to the pool.
     *
     * <p><b>Why checkout time is not enough.</b> Spring checks a connection out of the pool at
     * transaction start, and transaction start is routinely EARLIER than the moment the tenant
     * becomes known:
     *
     * <ul>
     *   <li>{@code TenantAwareMessageProcessor.process} is {@code @Transactional} — the connection
     *       is already borrowed before its body reads {@code envelope.tenantId()};</li>
     *   <li>{@code ExpirySweepService.sweep} deliberately holds ONE transaction open across every
     *       tenant in the registry, so the context changes repeatedly on one borrowed connection;
     *       </li>
     *   <li>{@code /internal/**} controllers and {@code DeviceAuthResolver} resolve their tenant
     *       inside the handler;</li>
     *   <li>every class-level {@code @Transactional} test — Spring's
     *       {@code TransactionalTestExecutionListener} opens the transaction before
     *       {@code @BeforeEach} runs.</li>
     * </ul>
     *
     * <p>With the GUC frozen at checkout, all of those ran RLS-protected SQL against a connection
     * that said "no tenant" (every read empty, every write refused with SQLSTATE 42501) or, worse,
     * still said the PREVIOUS tenant — which does not violate the policy, it redirects it. About
     * twenty-five call sites compensate by hand with a native {@code set_config} or
     * {@link TenantGucHelper#apply}; that is a control every future author has to remember, and the
     * cost of forgetting it is silent cross-tenant reads rather than a failure.
     *
     * <p><b>The rule.</b> Before a statement is created, if {@link TenantContext} holds a tenant
     * that differs from what THIS handler last wrote, write both GUCs again. Three consequences
     * worth being explicit about:
     *
     * <ul>
     *   <li><b>It fires on change, not on every statement.</b> The comparison is against what this
     *       handler wrote, so a call site that sets the GUC itself is not fought over on the next
     *       statement — the sync only re-asserts when the THREAD's tenant has actually moved, which
     *       is exactly when that call site would have had to re-apply it anyway. Cost in the normal
     *       request is zero extra round trips: the checkout write already matches.</li>
     *   <li><b>It never downgrades to "no tenant" mid-checkout.</b> An empty context is ignored
     *       rather than written, because {@code TenantAwareMessageProcessor} and the sweep services
     *       clear the context in a {@code finally} INSIDE the transaction — blanking the GUC there
     *       would make the commit-time flush fail. A connection that begins life tenantless still
     *       gets an empty GUC written at checkout, so nothing is inherited; this only declines to
     *       take a tenant back off.</li>
     *   <li><b>It is still reset on close.</b> Cross-checkout isolation is unchanged and remains
     *       pinned by {@code TenantGucNeverInheritedIT}.</li>
     * </ul>
     */
    private static final class TenantGucConnectionHandler implements InvocationHandler {

        private final Connection delegate;
        private final TenantContext tenantContext;
        private String writtenTenant;
        private String writtenBranch;

        private TenantGucConnectionHandler(Connection delegate, TenantContext tenantContext,
                                           String writtenTenant, String writtenBranch) {
            this.delegate = delegate;
            this.tenantContext = tenantContext;
            this.writtenTenant = writtenTenant;
            this.writtenBranch = writtenBranch;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
            String name = method.getName();
            if ("close".equals(name)) {
                resetGucs();
                return method.invoke(delegate, args);
            }
            // Identity methods must operate on the proxy, not the delegate, so pooled-connection
            // bookkeeping that compares references still behaves.
            if ("equals".equals(name)) {
                return proxy == args[0];
            }
            if ("hashCode".equals(name)) {
                return System.identityHashCode(proxy);
            }
            // Every route from JDBC to the server goes through one of these three.
            if ("prepareStatement".equals(name)
                    || "createStatement".equals(name)
                    || "prepareCall".equals(name)) {
                syncGucsWithContext();
            }
            try {
                return method.invoke(delegate, args);
            } catch (java.lang.reflect.InvocationTargetException ex) {
                throw ex.getTargetException();
            }
        }

        /**
         * Re-asserts both GUCs when — and only when — the thread's tenant has moved away from the
         * value this handler last wrote. A {@code SQLException} here is deliberately NOT swallowed:
         * a statement that runs with the wrong tenant on the connection is the defect this exists to
         * prevent, so failing to set it must fail the statement, not proceed quietly.
         */
        private void syncGucsWithContext() throws SQLException {
            UUID tenantId = tenantContext.getTenantId().orElse(null);
            if (tenantId == null) {
                return;
            }
            String tenant = tenantId.toString();
            String branch = tenantContext.getBranchId().map(UUID::toString).orElse("");
            if (tenant.equals(writtenTenant) && branch.equals(writtenBranch)) {
                return;
            }
            setGucs(delegate, tenant, branch);
            writtenTenant = tenant;
            writtenBranch = branch;
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
                writtenTenant = "";
                writtenBranch = "";
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
