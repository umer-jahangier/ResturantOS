package io.restaurantos.shared.integration;

import io.restaurantos.shared.tenant.TenantContext;
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
 * The production shape of the stale-GUC defect: work that reaches the database BEFORE anything has
 * put a tenant on the thread.
 *
 * <p>That is not an edge case. Scheduled sweeps, RabbitMQ consumers before
 * {@code TenantAwareMessageProcessor} sets context, actuator probes and {@code /internal/**}
 * handlers that resolve their tenant inside the controller all check a connection out first.
 * {@code TenantAwareDataSource} used to hand those the raw pooled connection — writing no GUC, and
 * skipping the close-time reset that only proxied connections get. So the connection arrived
 * holding whatever the last tenant-bearing borrower left on it.
 *
 * <p>RLS cannot defend against this. A stale GUC does not violate the {@code tenant_isolation}
 * policy, it REDIRECTS it: PostgreSQL returns the other tenant's rows, correctly, because it was
 * told the caller is that tenant. The same reason the {@code TenantContext} bleed in
 * {@code JwtAuthenticationFilter} was invisible to every RLS-based defence.
 *
 * <p>{@link #aTenantlessCheckoutSeesNoRowsAtAll()} is the one that would have caught the live bug:
 * it does not inspect a GUC, it counts rows a tenantless caller can read after a tenant-bearing
 * caller has used the pool.
 */
class TenantGucNeverInheritedIT extends BaseIntegrationTest {

    private static final UUID TENANT_A = UUID.fromString("11110000-0000-4000-8000-00000000000a");

    @PersistenceContext private EntityManager em;
    @Autowired private TransactionTemplate txTemplate;

    /** Uses the pool as tenant A, exactly as a request would, and gives the connection back. */
    private void aRequestRunsAsTenantA() {
        tenantContext.set(TENANT_A, null, null, null);
        txTemplate.executeWithoutResult(tx ->
                em.createNativeQuery("SELECT 1").getSingleResult());
        tenantContext.clear();
    }

    /**
     * THE DISCRIMINATING TEST. Reverting the {@code TenantAwareDataSource} fix turns this red and
     * leaves every other test in this class green — which is why it exists.
     *
     * <p>The other tests do not discriminate, and finding that out was the useful part. Close-time
     * reset already cleaned the ordinary path: a request that ran as tenant A held a PROXIED
     * connection, so {@code close()} blanked its GUC on the way back to the pool, and the next
     * tenantless borrower saw {@code ''} with or without the fix. The gap is narrower than "any
     * tenantless checkout". It is specifically a connection that acquires a tenant GUC while
     * UNPROXIED — because nothing then resets it, ever.
     *
     * <p>That is not hypothetical. {@code TenantGucHelper}, {@code TenantAwareMessageProcessor} and
     * the {@code /internal/**} controllers all write the GUC themselves with native SQL, and they
     * run on connections checked out before a tenant was known — exactly the checkouts the old code
     * declined to proxy. The tenant they set then outlived the request on that pooled session.
     */
    @Test
    @DisplayName("a GUC written on a tenantless connection does not outlive it")
    void aGucWrittenWithoutAContextIsStillResetOnReturnToThePool() {
        // BaseIntegrationTest seeds a tenant before every test, so "tenantless" has to be made
        // true rather than assumed. Without this the checkouts below are proxied and the GUC read
        // at the end is the fixture's own tenant, correctly set — which is what this test measured
        // on its first run, and it looked exactly like a leak.
        tenantContext.clear();

        // A tenantless checkout that sets the GUC itself, the way TenantGucHelper and the
        // /internal/** controllers do. is_local=false so it persists past this transaction, which
        // is the whole point of those call sites.
        txTemplate.executeWithoutResult(tx ->
                em.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
                        .setParameter("tid", TENANT_A.toString()).getSingleResult());

        String guc = txTemplate.execute(tx -> (String) em
                .createNativeQuery("SELECT current_setting('app.current_tenant_id', true)")
                .getSingleResult());

        assertThat(guc)
                .as("""
                    Tenant A's GUC ('%s') survived on the pooled connection and was handed to the \
                    next borrower, which has no tenant at all. TenantAwareDataSource declined to \
                    proxy that checkout because the context was empty, so close() never reset it. \
                    Everything RLS does on this connection is now scoped to tenant A while the \
                    caller believes it is unscoped — the policy is not violated, it is redirected.""",
                        guc)
                .isNullOrEmpty();
    }

    @Test
    @DisplayName("a checkout with no tenant carries no tenant — not the previous borrower's")
    void aTenantlessCheckoutDoesNotInheritTheLastTenant() {
        aRequestRunsAsTenantA();

        String guc = txTemplate.execute(tx -> (String) em
                .createNativeQuery("SELECT current_setting('app.current_tenant_id', true)")
                .getSingleResult());

        assertThat(guc)
                .as("""
                    A transaction opened with an EMPTY TenantContext is running on a connection \
                    whose app.current_tenant_id is '%s' — tenant A's, left behind by the previous \
                    borrower. Every RLS policy on this connection now resolves to tenant A, so a \
                    scheduled sweep, a consumer or an /internal call with no tenant of its own \
                    reads and writes tenant A's data while believing it is unscoped.""", guc)
                .isNullOrEmpty();
    }

    @Test
    @DisplayName("the branch GUC is not inherited either")
    void aTenantlessCheckoutDoesNotInheritTheLastBranch() {
        tenantContext.set(TENANT_A, UUID.randomUUID(), null, null);
        txTemplate.executeWithoutResult(tx -> em.createNativeQuery("SELECT 1").getSingleResult());
        tenantContext.clear();

        String branch = txTemplate.execute(tx -> (String) em
                .createNativeQuery("SELECT current_setting('app.current_branch_id', true)")
                .getSingleResult());

        assertThat(branch)
                .as("""
                    Branch-aware policies are permissive on an empty branch GUC and restrictive on \
                    a set one, so an inherited branch ('%s') silently narrows a whole-tenant read \
                    to one site — a reporting total that is quietly wrong rather than absent.""",
                        branch)
                .isNullOrEmpty();
    }

    /**
     * The behavioural form. No GUC is inspected: this counts rows, which is the only thing a leak
     * is actually made of.
     */
    @Test
    @DisplayName("a tenantless caller reads no rows, however recently a tenant used the pool")
    void aTenantlessCheckoutSeesNoRowsAtAll() {
        txTemplate.executeWithoutResult(tx -> {
            em.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, true)")
                    .setParameter("tid", TENANT_A.toString()).getSingleResult();
            em.createNativeQuery("DELETE FROM widgets WHERE name = 'inherit-probe'").executeUpdate();
            em.createNativeQuery(
                            "INSERT INTO widgets (id, tenant_id, name, created_at, updated_at)"
                                    + " VALUES (gen_random_uuid(), :tid, 'inherit-probe', NOW(), NOW())")
                    .setParameter("tid", TENANT_A).executeUpdate();
        });

        aRequestRunsAsTenantA();

        // Zero rows, and NOT an exception. A legitimately tenantless read — actuator, a health
        // probe, a platform-scoped query — must come back empty rather than blowing up, and that
        // is what NULLIF(current_setting(...), '')::uuid gives. A policy that casts the GUC
        // directly throws "invalid input syntax for type uuid" on the empty string instead. Both
        // are fail-closed, but only one is a usable answer, and having both forms in one codebase
        // guarantees somebody copies the wrong one.
        //
        // No try/catch here on purpose: swallowing the throw is what let this assertion pass
        // against a policy that could not answer the question at all.
        List<?> visible = txTemplate.execute(tx -> em
                .createNativeQuery("SELECT name FROM widgets WHERE name = 'inherit-probe'")
                .getResultList());

        assertThat(visible)
                .as("""
                    A caller with NO tenant read tenant A's row. The connection it was handed still \
                    carried tenant A's GUC from the previous borrower, so RLS admitted the row — \
                    not by failing, but by being pointed at the wrong tenant. This is the leak in \
                    the form it takes in production.""")
                .isEmpty();
    }
}
