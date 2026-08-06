package io.restaurantos.platform.config;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Every feature code the gateway GATES on is one the tier matrix actually defines.
 *
 * <p>This defect class has already shipped twice in this repository, and both times it was found by
 * a human clicking the feature and being refused:
 *
 * <ul>
 *   <li>{@code FEATURE_PURCHASING} — the "phantom flag" of decision 10-11-A. The frontend gated the
 *       Purchasing nav item on a code no backend ever granted, so the nav item never rendered for
 *       anyone, on any tier.</li>
 *   <li>{@code FEATURE_NLQ} — {@code RouteFeatureMap} gated {@code /api/v1/nlq/} on a code that
 *       appeared in no tier set here, so {@code tenant_features} was never seeded with it and every
 *       NLQ request came back {@code 403 FEATURE_DISABLED}. See the comment on
 *       {@code GROWTH_AND_ABOVE} in {@link TierFeatureDefaults}.</li>
 * </ul>
 *
 * <p>Nothing about this shape fails a normal test. A gate naming a code the matrix never defines does
 * not throw at startup, breaks no unit test, and produces a clean, confident 403 at runtime — the
 * system behaves exactly like one where the tenant genuinely has not bought the module. The only way
 * to catch it is to compare the two vocabularies directly, which is what this does, in the same idiom
 * as {@code PermissionCatalogClosureTest} in auth-service.
 *
 * <p><b>Why the gateway source is read off disk rather than imported.</b> platform-admin-service does
 * not depend on the gateway module and must not start to — the gateway depends on this service's HTTP
 * contract, and a compile dependency the other way would be a cycle. Reading the file keeps this a
 * fast unit test that needs no database, no container and no network, and fails on the branch that
 * introduces the drift rather than in whichever environment someone first clicks the feature.
 *
 * <p><b>Why {@code frontend/__tests__/lib/nav-feature-flags.test.ts} does not already cover this.</b>
 * That guard builds its backend set as the <i>union</i> of TierFeatureDefaults.java and
 * RouteFeatureMap.java. A code present only in the route map is therefore in its union and passes —
 * which is precisely the orphan case. The union answers "does this code exist anywhere"; this test
 * answers "can a tenant ever be granted it", and only the second question decides whether a request
 * gets through.
 */
class FeatureCodeClosureTest {

    /** {@code PREFIX_TO_FEATURE.put("/api/v1/x/", "FEATURE_X");} — prefix in group 1, code in group 2. */
    private static final Pattern ROUTE_FEATURE_PUT = Pattern.compile(
            "PREFIX_TO_FEATURE\\s*\\.\\s*put\\(\\s*\"([^\"]*)\"\\s*,\\s*\"([^\"]*)\"\\s*\\)");

    /** The literal call site, counted independently so a regex that stops matching cannot pass silently. */
    private static final Pattern ROUTE_FEATURE_PUT_CALL = Pattern.compile("PREFIX_TO_FEATURE\\s*\\.\\s*put\\(");

    private static final Path REPO_ROOT = Path.of("..", "..").toAbsolutePath().normalize();

    private static final Path ROUTE_FEATURE_MAP =
            REPO_ROOT.resolve("gateway/src/main/java/io/restaurantos/gateway/support/RouteFeatureMap.java");

    @Test
    void everyGatedFeatureCodeExistsInTheTierMatrix() throws IOException {
        Map<String, String> gated = parseRouteFeatureMap(Files.readString(ROUTE_FEATURE_MAP, StandardCharsets.UTF_8));

        assertThat(gated)
                .as("route→feature mappings parsed from %s. A small or empty set means the scan broke, "
                        + "not that the gateway stopped gating anything.", ROUTE_FEATURE_MAP)
                .hasSizeGreaterThan(8);

        Set<String> matrix = new TierFeatureDefaults().allFeatureCodes();
        assertThat(matrix).as("tier matrix codes").hasSizeGreaterThan(10);

        assertThat(orphans(gated, matrix))
                .as("Feature codes the gateway GATES a route prefix on that TierFeatureDefaults never "
                        + "defines. No tenant on any tier can be granted these, because provisioning seeds "
                        + "tenant_features from defaultsFor(tier) — so every request to the mapped prefix "
                        + "comes back 403 FEATURE_DISABLED for everyone, forever, and looks exactly like a "
                        + "tenant who has not bought the module. Either add the code to a tier set in "
                        + "TierFeatureDefaults, or correct the mapping in RouteFeatureMap to name a code "
                        + "that exists. Deleting the mapping is NOT a fix: it ungates the prefix.")
                .isEmpty();
    }

    /**
     * A prefix with no gateway route today is still checked.
     *
     * <p>{@code /api/v1/payroll/} has no route in {@code gateway/src/main/resources/application.yml};
     * payroll is served under {@code /api/v1/hr/payroll-runs} and therefore gates on {@code FEATURE_HR}.
     * That is why the orphan {@code FEATURE_PAYROLL} mapping has never produced a live 403 — an accident
     * of routing, not a guarantee. The day a payroll route is added, the mapping starts being consulted
     * and the tenant is refused. Drift must fail here, when the code is written, not there.
     */
    @Test
    void closureIsCheckedForPrefixesThatHaveNoRouteYet() throws IOException {
        Map<String, String> gated = parseRouteFeatureMap(Files.readString(ROUTE_FEATURE_MAP, StandardCharsets.UTF_8));
        assertThat(gated).containsEntry("/api/v1/payroll/", "FEATURE_PAYROLL");
        assertThat(new TierFeatureDefaults().allFeatureCodes()).contains("FEATURE_PAYROLL");
    }

    /**
     * The parse is counted against the raw call sites, so a mapping written in a form the regex cannot
     * read fails loudly instead of vanishing from the comparison.
     */
    @Test
    void everyPutCallSiteIsParsed() throws IOException {
        String source = Files.readString(ROUTE_FEATURE_MAP, StandardCharsets.UTF_8);
        assertThat(parseRouteFeatureMap(source))
                .as("every PREFIX_TO_FEATURE.put(...) call site must be parsed; an unparsed mapping is a "
                        + "gate this test cannot see, which is the same blind spot it exists to close")
                .hasSize(countPutCallSites(source));
    }

    /**
     * The negative control: this test must be able to fail, and must name the offender when it does.
     *
     * <p>Run against a synthetic source rather than by mutating the real file, so the guard against a
     * silently-vacuous assertion is itself permanent and runs on every build.
     */
    @Test
    void driftIsReportedWithBothTheCodeAndItsPrefix() {
        String bogusSource = """
                PREFIX_TO_FEATURE.put("/api/v1/finance/",  "FEATURE_FINANCE");
                PREFIX_TO_FEATURE.put("/api/v1/widgets/",  "FEATURE_WIDGETS");
                """;

        Map<String, String> gated = parseRouteFeatureMap(bogusSource);
        assertThat(gated).hasSize(2).hasSize(countPutCallSites(bogusSource));

        Map<String, String> orphans = orphans(gated, new TierFeatureDefaults().allFeatureCodes());
        assertThat(orphans).containsExactly(Map.entry("FEATURE_WIDGETS", "/api/v1/widgets/"));
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────────

    /** prefix → feature code, in declaration order. */
    private static Map<String, String> parseRouteFeatureMap(String source) {
        Map<String, String> mappings = new LinkedHashMap<>();
        Matcher m = ROUTE_FEATURE_PUT.matcher(source);
        while (m.find()) {
            mappings.put(m.group(1), m.group(2));
        }
        return mappings;
    }

    private static int countPutCallSites(String source) {
        int count = 0;
        Matcher m = ROUTE_FEATURE_PUT_CALL.matcher(source);
        while (m.find()) {
            count++;
        }
        return count;
    }

    /** Gated codes absent from the matrix, as code → the first prefix that demands it. */
    private static Map<String, String> orphans(Map<String, String> gated, Set<String> matrix) {
        Map<String, String> orphans = new TreeMap<>();
        gated.forEach((prefix, code) -> {
            if (!matrix.contains(code)) {
                orphans.putIfAbsent(code, prefix);
            }
        });
        return orphans;
    }
}
