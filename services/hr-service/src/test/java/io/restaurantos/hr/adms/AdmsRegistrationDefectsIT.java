package io.restaurantos.hr.adms;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DEFECT REGISTRY — what an installer is handed, and what guards the path they are pointed at.
 * <b>Owner: plan 25-08.</b>
 *
 * <p><b>Inversion protocol.</b> Every case asserts a defect <em>still reproduces</em>; red means fixed.
 * Plan 25-08 inverts each case and <b>deletes it</b>, and deletes this class when the last one goes.
 *
 * <p>Two of the three cases are asserted against gateway source text rather than over HTTP. That is
 * deliberate and it is the honest form of the assertion: both defects are <em>absences of effect</em>
 * in a service this test JVM does not run, and the gateway's own suite cannot see them because from
 * inside the gateway both filters behave exactly as written. What is wrong is the pairing of a filter
 * with a path whose requests never satisfy that filter's precondition. A source-level assertion names
 * the pairing, which is the thing that has to change.
 */
class AdmsRegistrationDefectsIT extends AdmsWireTestBase {

    /**
     * ADMS-REG-01 — registration hands the installer a placeholder instead of an address.
     *
     * <p>{@code AttendanceDeviceService} defaults {@code restaurantos.hr.device-server-url} to
     * {@code https://REPLACE-WITH-GATEWAY-HOST/iclock}, and a repository-wide search finds the property
     * set in no yml, no yaml, no env file and no deployment manifest. So the one screen in the product
     * whose entire job is to tell somebody what to type into a terminal tells them to replace something.
     * The device token beside it is correct and is shown exactly once, which makes this worse rather
     * than better: the installer copies both, one of them works, and re-registering to get a fresh
     * token is the only way back.
     */
    @Test
    void registrationHandsBackAPlaceholderHostRatherThanAReachableAddress() throws Exception {
        Fixture fx = register(null);

        assertThat(fx.serverUrl())
                .as("what the installer is told to configure on the terminal")
                .contains("REPLACE-WITH-GATEWAY-HOST");
    }

    /**
     * ADMS-REG-02 — the FEATURE_HR gate on the device prefix cannot ever fire.
     *
     * <p>{@code RouteFeatureMap} maps {@code /iclock/} to {@code FEATURE_HR}, and three separate
     * comments in the gateway describe the device path as feature-gated. {@code FeatureFlagGlobalFilter}
     * reads the tenant from the {@code X-Tenant-Id} header and returns
     * {@code chain.filter(exchange)} — pass, ungated — the moment that header is absent. On this path
     * it is always absent: the whole point of {@code /iclock} is that a terminal carries no JWT and no
     * tenant header, which is why {@code JwtGlobalFilter} exempts it in the first place. The filter's
     * own comment calls the null branch a "safety check only", which is true of every other route and
     * false of this one.
     *
     * <p>Cost: a tenant whose HR module is switched off, or who has stopped paying for it, keeps
     * ingesting attendance. The entitlement is decorative on the one path that has no other guard.
     */
    @Test
    void theDevicePrefixIsMappedToFeatureHrByAFilterThatAlwaysPassesItThrough() throws Exception {
        String routeMap = read("gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java");
        String filter = read("gateway/src/main/java/io/restaurantos/gateway/filter/FeatureFlagGlobalFilter.java");

        assertThat(routeMap)
                .as("the mapping that makes the gate look present")
                .contains("PREFIX_TO_FEATURE.put(\"/iclock/\"");

        int tenantHeaderRead = filter.indexOf("getFirst(\"X-Tenant-Id\")");
        assertThat(tenantHeaderRead).as("the filter reads the tenant from a header").isGreaterThan(-1);
        String afterHeaderRead = filter.substring(tenantHeaderRead, Math.min(filter.length(), tenantHeaderRead + 400));
        assertThat(afterHeaderRead)
                .as("and passes straight through when it is absent, which on /iclock it always is")
                .contains("tenantIdHeader == null")
                .contains("return chain.filter(exchange)");

        assertThat(filter)
                .as("nothing derives a tenant for a device request, so the gate has nothing to gate on")
                .doesNotContain("serial")
                .doesNotContain("SN");
    }

    /**
     * ADMS-REG-03 — the per-device rate limit degrades to one shared bucket on the JSON bridge route.
     *
     * <p>{@code deviceKeyResolver} reads the serial from the {@code SN} <em>query parameter</em>, which
     * the ADMS protocol carries on every {@code /iclock} call. The {@code /internal/attendance/ingest}
     * route uses the same resolver, but its serial arrives in a JSON <em>body</em> — so the resolver
     * finds nothing and falls back to the literal key {@code "unknown"}. Every bridge agent in every
     * tenant on the platform therefore shares a single 120-request bucket, and one busy branch starves
     * the rest. The route's own comment states the opposite: "Rate-limited per DEVICE (SN query param)
     * so one device cannot exhaust a branch's shared per-IP budget."
     */
    @Test
    void theBridgeRouteSharesOneRateLimitBucketAcrossEveryTenant() throws Exception {
        String rateLimit = read("gateway/src/main/java/io/restaurantos/gateway/config/RateLimitConfig.java");
        String routes = read("gateway/src/main/resources/application.yml");

        assertThat(rateLimit)
                .as("the resolver looks only in the query string")
                .contains("getQueryParams().getFirst(\"SN\")")
                .contains("\"unknown\"");

        int ingestRoute = routes.indexOf("Path=/internal/attendance/ingest");
        assertThat(ingestRoute).as("the JSON bridge route exists").isGreaterThan(-1);
        assertThat(routes.substring(ingestRoute, Math.min(routes.length(), ingestRoute + 400)))
                .as("and is keyed by the same query-parameter resolver, on a request that carries no query string")
                .contains("#{@deviceKeyResolver}");
    }

    /** Reads a file relative to the repository root, from a test whose cwd is services/hr-service. */
    private static String read(String repoRelative) throws Exception {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(
                cwd.resolve("../..").normalize(),
                cwd,
                cwd.resolve("../../..").normalize())) {
            Path f = candidate.resolve(repoRelative);
            if (Files.exists(f)) {
                return Files.readString(f);
            }
        }
        throw new IllegalStateException("Could not locate " + repoRelative + " from " + cwd);
    }
}
