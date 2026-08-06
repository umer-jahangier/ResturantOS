package io.restaurantos.gateway.filter;

import io.restaurantos.gateway.support.RouteFeatureMap;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The three edge properties of the role/permission catalog route (D-14), asserted without a Spring
 * context, a container or a network — for the reason
 * {@link JwtGlobalFilterTenantOptionalPathTest} gives: the security-critical facts about a path
 * must not be verifiable only through a harness that intermittently cannot run on this machine.
 *
 * <p>All three are things the route's YAML cannot state and that fail SILENTLY:
 *
 * <ul>
 *   <li>Public — an endpoint that stops asking for a token produces no error and no log. The
 *       permission catalog enumerates the platform's entire authorization surface (T-13-07-A).</li>
 *   <li>Tenant-optional — a tenant-less token would reach a tenant-scoped read, and the roles query
 *       would then see the system roles of no tenant in particular (D-02, T-13-01-A).</li>
 *   <li>Feature-gated — role discovery would become a function of the tenant's subscription tier,
 *       so a downgrade would make user administration unreachable rather than merely smaller
 *       (T-13-07-E). Two prefixes in {@code RouteFeatureMap} already gate on {@code FEATURE_*}
 *       codes that were absent from the tier matrix, and that exact bug has occurred twice.</li>
 * </ul>
 */
class RoleCatalogRouteTest {

    /** Constructed with nulls on purpose: neither predicate touches a collaborator. */
    private final JwtGlobalFilter filter = new JwtGlobalFilter(null, null);
    private final RouteFeatureMap routeFeatureMap = new RouteFeatureMap();

    @ParameterizedTest
    @ValueSource(strings = {"/api/v1/roles", "/api/v1/permissions"})
    void catalogPaths_requireAToken(String path) {
        assertThat(filter.isPublicPath(path))
                .as("%s must NOT be in PUBLIC_PATHS — it publishes the authorization surface", path)
                .isFalse();
    }

    /**
     * The control for the assertion above. {@code isPublicPath} returning false for everything
     * would satisfy it while meaning the predicate is broken, not that the paths are protected.
     */
    @Test
    void thePublicPathPredicateStillRecognisesAGenuinelyPublicPath() {
        assertThat(filter.isPublicPath("/api/v1/auth/login")).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/v1/roles", "/api/v1/permissions"})
    void catalogPaths_requireATenantBearingToken(String path) {
        assertThat(filter.isTenantOptionalPath(path))
                .as("tenant-less tokens are permitted on /api/v1/platform and nowhere else")
                .isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/v1/roles", "/api/v1/permissions"})
    void catalogPaths_carryNoFeatureGate(String path) {
        assertThat(routeFeatureMap.featureFor(path))
                .as("role discovery must not depend on a tenant's module entitlement")
                .isEmpty();
    }

    /**
     * The control for the assertion above: a map that gated nothing would pass it trivially.
     */
    @Test
    void theFeatureMapStillGatesAGenuinelyGatedPath() {
        assertThat(routeFeatureMap.featureFor("/api/v1/finance/journal-entries"))
                .contains("FEATURE_FINANCE");
    }
}
