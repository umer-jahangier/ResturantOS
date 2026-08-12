package io.restaurantos.shared.integration;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The other half of {@link TenantGucNeverInheritedIT}. That class proves a tenant's GUC does not
 * survive ACROSS checkouts; this one proves the GUC tracks {@code TenantContext} WITHIN one
 * checkout — that a connection borrowed before the tenant was known, or borrowed for one tenant and
 * then reused for another, is not stuck with the value it was handed at checkout.
 *
 * <p>Both are the same defect seen from opposite ends: {@code TenantAwareDataSource} decides the GUC
 * once, at JDBC checkout, from whatever {@code TenantContext} held at that instant. Checkout is
 * routinely EARLIER than the tenant:
 *
 * <ul>
 *   <li>{@code TenantAwareMessageProcessor} is {@code @Transactional} — Spring has already checked
 *       the connection out before its body reads {@code envelope.tenantId()};</li>
 *   <li>{@code ExpirySweepService} deliberately runs every tenant inside ONE transaction, so the
 *       context changes several times on one already-borrowed connection;</li>
 *   <li>{@code /internal/**} controllers and {@code DeviceAuthResolver} resolve their tenant in the
 *       handler, after the transaction opened;</li>
 *   <li>every class-level {@code @Transactional} test — Spring's
 *       {@code TransactionalTestExecutionListener} opens the transaction in {@code beforeTestMethod},
 *       which runs BEFORE {@code @BeforeEach} sets the tenant.</li>
 * </ul>
 *
 * <p>The codebase compensates for this by hand, in roughly twenty-five places, with a native
 * {@code set_config(..., true)} or a {@link io.restaurantos.shared.tenant.TenantGucHelper#apply}
 * call. That is a control every future author has to remember — the exact shape of defect this
 * codebase keeps producing. These tests pin the DataSource doing it instead.
 *
 * <p>MEASURED, before the fix: thread context {@code 11111111-…-111111111111}, row
 * {@code tenant_id 11111111-…-111111111111}, connection GUC {@code ''} → {@code SQLSTATE 42501,
 * "new row violates row-level security policy for table widgets"}. Two of the three agreed; the GUC
 * was the liar, and it was the liar because it was decided before either of the other two existed.
 */
class TenantGucFollowsTheContextIT extends BaseIntegrationTest {

    private static final UUID TENANT_A = UUID.fromString("aaaa0000-0000-4000-8000-00000000000a");
    private static final UUID TENANT_B = UUID.fromString("bbbb0000-0000-4000-8000-00000000000b");

    @PersistenceContext private EntityManager em;
    @Autowired private TransactionTemplate txTemplate;

    private String gucNow() {
        return (String) em.createNativeQuery(
                "SELECT current_setting('app.current_tenant_id', true)").getSingleResult();
    }

    private void insertWidget(UUID tenantId, String name) {
        em.createNativeQuery("INSERT INTO widgets (id, tenant_id, name, created_at, updated_at)"
                        + " VALUES (gen_random_uuid(), :tid, :name, NOW(), NOW())")
                .setParameter("tid", tenantId).setParameter("name", name).executeUpdate();
    }

    /**
     * The wrong state is set up DELIBERATELY: the transaction is opened with the context cleared, so
     * the connection is provably handed out carrying {@code ''}, and only then does the tenant
     * become known. Without that first assertion this test could pass on a connection that happened
     * to be carrying the right tenant already, and would be proving nothing.
     */
    @Test
    @DisplayName("a tenant that becomes known AFTER checkout still reaches the connection")
    void aTenantSetAfterCheckoutReachesTheConnection() {
        tenantContext.clear();

        txTemplate.executeWithoutResult(tx -> {
            assertThat(gucNow())
                    .as("precondition: the connection must start this transaction with NO tenant, "
                            + "otherwise the assertion below proves nothing")
                    .isNullOrEmpty();

            tenantContext.set(TENANT_A, null, null, null);

            assertThat(gucNow())
                    .as("""
                        The tenant is now on the thread, on a connection that was checked out \
                        before it existed, and the connection still reports '%s'. \
                        TenantAwareDataSource decided this GUC once, at checkout, and never looked \
                        at TenantContext again — so every RLS policy on this transaction is \
                        answering for the wrong caller for the rest of its life.""", gucNow())
                    .isEqualTo(TENANT_A.toString());
        });

        tenantContext.clear();
    }

    /**
     * The same ordering expressed as the symptom it actually produces in service code: an INSERT
     * whose row tenant_id, thread context and — everyone assumes — connection GUC all agree, refused
     * by PostgreSQL with SQLSTATE 42501.
     */
    @Test
    @DisplayName("a write is accepted when the tenant is set after the connection is borrowed")
    void aWriteIsAcceptedWhenTheTenantArrivesAfterTheCheckout() {
        tenantContext.clear();

        txTemplate.executeWithoutResult(tx -> {
            assertThat(gucNow())
                    .as("precondition: borrowed with no tenant")
                    .isNullOrEmpty();

            tenantContext.set(TENANT_A, null, null, null);

            // Row tenant_id == thread context. The third value, the GUC, is the one under test.
            insertWidget(TENANT_A, "arrives-late");
            em.flush();
        });

        tenantContext.clear();
    }

    /**
     * THE ISOLATION CASE, and the one {@link TenantGucNeverInheritedIT} does not reach: that class
     * only ever makes the SECOND borrower tenantless, so it says nothing about a connection that
     * serves tenant A and then tenant B without going back to the pool in between.
     *
     * <p>That is not a contrived ordering. {@code ExpirySweepService.sweep} holds ONE transaction
     * open across every tenant in the registry on purpose. Today it stays correct only because it
     * remembers to call {@code TenantGucHelper.apply} on each iteration; a sweep, consumer or
     * admin flow written without that call reads the previous tenant's rows, and nothing fails.
     *
     * <p>No pooling is involved here — the switch happens inside a single transaction, so it is the
     * same physical backend by construction, and the test cannot pass by being handed a fresh
     * connection.
     */
    @Test
    @DisplayName("a connection reused for tenant B does not keep answering as tenant A")
    void aConnectionReusedForAnotherTenantDoesNotKeepTheFirstTenantsGuc() {
        tenantContext.set(TENANT_A, null, null, null);
        txTemplate.executeWithoutResult(tx -> {
            em.createNativeQuery("DELETE FROM widgets WHERE name = 'switch-probe'").executeUpdate();
            insertWidget(TENANT_A, "switch-probe");
        });
        tenantContext.clear();

        tenantContext.set(TENANT_A, null, null, null);
        List<?> seenByB = txTemplate.execute(tx -> {
            int backendBefore = ((Number) em.createNativeQuery("SELECT pg_backend_pid()")
                    .getSingleResult()).intValue();
            assertThat(gucNow())
                    .as("precondition: this connection really is serving tenant A first")
                    .isEqualTo(TENANT_A.toString());

            // Same thread, same open transaction, same backend — only the tenant changes.
            tenantContext.set(TENANT_B, null, null, null);

            int backendAfter = ((Number) em.createNativeQuery("SELECT pg_backend_pid()")
                    .getSingleResult()).intValue();
            assertThat(backendAfter)
                    .as("precondition: tenant B must be running on the SAME backend that just "
                            + "served tenant A, or this proves nothing about inheritance")
                    .isEqualTo(backendBefore);

            return em.createNativeQuery("SELECT name FROM widgets WHERE name = 'switch-probe'")
                    .getResultList();
        });
        tenantContext.clear();

        assertThat(seenByB)
                .as("""
                    Tenant B read tenant A's row. The connection was borrowed while the thread held \
                    tenant A, and TenantAwareDataSource never revisited that decision — so when the \
                    thread became tenant B the GUC stayed A and RLS admitted A's rows without \
                    violating anything. The policy was not broken, it was pointed at the wrong \
                    tenant.""")
                .isEmpty();
    }
}
