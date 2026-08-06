package io.restaurantos.gateway.filter;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The boundary of the tenant-less exemption (threat T-13-01-A), asserted without a Spring context.
 *
 * <p>Why a separate class from {@code JwtGlobalFilterTest}: that one is a full
 * {@code @SpringBootTest} with Testcontainers Redis and a MockWebServer upstream, and it currently
 * errors on this machine for a pre-existing environmental reason unrelated to this work
 * (reactor-netty {@code PrematureCloseException}, reproducible on origin/prod). The single most
 * security-critical property of this change — that the exemption covers the platform prefix and
 * NOTHING else — should not be verifiable only through a harness that cannot run. This class needs
 * no network, no container and no context, so it runs everywhere.
 */
class JwtGlobalFilterTenantOptionalPathTest {

    /** Constructed with nulls on purpose: the predicate touches neither collaborator. */
    private final JwtGlobalFilter filter = new JwtGlobalFilter(null, null);

    @ParameterizedTest
    @ValueSource(strings = {
            "/api/v1/platform",
            "/api/v1/platform/tenants",
            "/api/v1/platform/tenants/2f1c8b90-0000-4000-8000-000000000001/features",
            "/api/v1/platform/auth/login"
    })
    void platformPaths_areTenantOptional(String path) {
        assertThat(filter.isTenantOptionalPath(path)).isTrue();
    }

    /**
     * Every tenant-scoped prefix the audit named, plus the near-miss strings a bare
     * {@code startsWith} would have wrongly admitted. A tenant-less token reaching any of these
     * must still be rejected — that is the D-02 prohibition, and it is enforced by this predicate
     * returning false rather than by anything downstream.
     */
    @ParameterizedTest
    @ValueSource(strings = {
            "/api/v1/pos/orders",
            "/api/v1/orders",
            "/api/v1/users",
            "/api/v1/users/me",
            "/api/v1/finance/journal-entries",
            "/api/v1/hr/employees",
            "/api/v1/inventory/ingredients",
            "/api/v1/kitchen/tickets",
            "/api/v1/reporting/reports/sales-by-day",
            "/api/v1/feature-flags",
            // near-misses: same character prefix, different resource
            "/api/v1/platformish",
            "/api/v1/platform-admin",
            "/api/v1/platformx/tenants"
    })
    void everythingElse_isNotTenantOptional(String path) {
        assertThat(filter.isTenantOptionalPath(path)).isFalse();
    }

    /**
     * WebFlux does not collapse dot segments, so {@code getPath().value()} is literally what the
     * client sent. A path that carries the platform prefix here but resolves elsewhere for anything
     * downstream that DOES normalise must not inherit the exemption — in either direction.
     * Refusing is fail-closed: such a request falls through to ordinary tenant resolution, which
     * 401s a tenant-less token.
     */
    @Test
    void traversalShapedPaths_areNotTenantOptional() {
        assertThat(filter.isTenantOptionalPath("/api/v1/platform/../pos/orders")).isFalse();
        assertThat(filter.isTenantOptionalPath("/api/v1/pos/../platform/tenants")).isFalse();
        assertThat(filter.isTenantOptionalPath("/api/v1/platform/..")).isFalse();
    }
}
