package io.restaurantos.shared.testsupport;

import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Reusable post-Liquibase guard that fails if any tenant_id-bearing table lacks
 * FORCE ROW LEVEL SECURITY and at least one RLS policy.
 *
 * <p>Extend this class in each service's integration test module (which already
 * inherits Testcontainers + Spring Boot setup from BaseIntegrationTest in 01-04).
 * This class only contains the query+assert logic given an EntityManager — it does
 * NOT wire Testcontainers or Spring bootstrap itself.
 *
 * <p>Usage in a service test:
 * <pre>{@code
 * @SpringBootTest
 * class RlsCoverageTest extends AbstractRlsCoverageTest {
 *     @PersistenceContext EntityManager em;
 *
 *     @Override protected EntityManager entityManager() { return em; }
 * }
 * }</pre>
 *
 * <p>The guard:
 * <ol>
 *   <li>Selects all tables with a {@code tenant_id} column from {@code information_schema.columns}.</li>
 *   <li>Excludes the three shared infra tables that intentionally have no RLS.</li>
 *   <li>For each remaining table asserts {@code relrowsecurity=true} AND
 *       {@code relforcerowsecurity=true} (from {@code pg_class}) AND at least one
 *       policy in {@code pg_policies}.</li>
 *   <li>Fails with a list of all offending tables so a single run reveals all gaps.</li>
 * </ol>
 */
public abstract class AbstractRlsCoverageTest {

    /**
     * Provide the EntityManager from the test's Spring context.
     * The guard runs its native queries through this EntityManager.
     */
    protected abstract EntityManager entityManager();

    /**
     * Tables that intentionally have no RLS policy.
     * Override to extend the exclusion list in a specific service if needed.
     */
    protected Set<String> rlsExemptTables() {
        return Set.of("event_outbox", "idempotency_keys", "processed_events");
    }

    @Test
    void allTenantScopedTablesMustHaveForceRlsAndAPolicy() {
        EntityManager em = entityManager();

        @SuppressWarnings("unchecked")
        List<String> tenantTables = em.createNativeQuery(
                "SELECT table_name " +
                "FROM information_schema.columns " +
                "WHERE column_name = 'tenant_id' " +
                "  AND table_schema = 'public'"
        ).getResultList();

        Set<String> exempt = rlsExemptTables();
        List<String> offenders = new ArrayList<>();

        for (String table : tenantTables) {
            if (exempt.contains(table)) {
                continue;
            }

            Object[] rlsFlags = (Object[]) em.createNativeQuery(
                    "SELECT relrowsecurity, relforcerowsecurity " +
                    "FROM pg_class " +
                    "WHERE relname = :tableName " +
                    "  AND relnamespace = 'public'::regnamespace"
            )
            .setParameter("tableName", table)
            .getSingleResult();

            boolean rowSecurityEnabled  = Boolean.TRUE.equals(rlsFlags[0]);
            boolean rowSecurityForced   = Boolean.TRUE.equals(rlsFlags[1]);

            Number policyCount = (Number) em.createNativeQuery(
                    "SELECT count(*) FROM pg_policies WHERE tablename = :tableName"
            )
            .setParameter("tableName", table)
            .getSingleResult();

            boolean hasPolicy = policyCount != null && policyCount.longValue() >= 1;

            if (!rowSecurityEnabled || !rowSecurityForced || !hasPolicy) {
                offenders.add(String.format(
                        "%s [relrowsecurity=%b, relforcerowsecurity=%b, policies=%d]",
                        table, rowSecurityEnabled, rowSecurityForced,
                        policyCount == null ? 0 : policyCount.longValue()
                ));
            }
        }

        assertTrue(offenders.isEmpty(),
                "The following tenant_id-bearing tables are missing FORCE ROW LEVEL SECURITY " +
                "and/or a tenant_isolation policy — add an RLS changeset immediately after their " +
                "createTable changeset (see docs/conventions/rls-convention.md):\n  " +
                String.join("\n  ", offenders));
    }
}
