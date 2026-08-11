package io.restaurantos.gateway.filter;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The boundary of the print-agent JWT exemption (26-11, threat T-26-11-E), asserted without a
 * Spring context — the idiom {@code JwtGlobalFilterTenantOptionalPathTest} established, for the
 * reason stated there.
 *
 * <p><b>This test replaces an empty-git-diff gate the plan originally carried.</b> That gate
 * asserted `JwtGlobalFilter.java` could not change while simultaneously requiring a change to it,
 * so it could never have passed. What is here is strictly stronger: it survives the commit, and it
 * fails on a LATER widening that a one-off diff check would never have seen.
 */
class JwtGlobalFilterAgentPathTest {

    /** Constructed with nulls on purpose: the predicates touch neither collaborator. */
    private final JwtGlobalFilter filter = new JwtGlobalFilter(null, null);

    // ══ The two paths classify ═══════════════════════════════════════════════════════════════

    @ParameterizedTest
    @ValueSource(strings = {
            "/api/v1/pos/print-agent/claim",
            "/api/v1/pos/print-agent/ack"
    })
    @DisplayName("each agent path classifies as an agent path")
    void agentPaths_classify(String path) {
        assertThat(filter.isAgentPath(path)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "/api/v1/pos/print-agent/claim",
            "/api/v1/pos/print-agent/ack"
    })
    @DisplayName("an agent path is NEITHER public NOR tenant-optional")
    void agentPaths_areNotPublicAndNotTenantOptional(String path) {
        // The exemption they get is narrower than either of those, and it must not be reachable
        // through either list. If somebody "simplifies" by adding them to PUBLIC_PATHS, this fails.
        assertThat(filter.isPublicPath(path))
                .as("an agent path must not be public — PUBLIC_PATHS is prefix-matched")
                .isFalse();
        assertThat(filter.isTenantOptionalPath(path))
                .as("an agent path must not inherit the tenant-less exemption")
                .isFalse();
    }

    // ══ Every near miss is refused ═══════════════════════════════════════════════════════════

    @ParameterizedTest
    @ValueSource(strings = {
            // A trailing extra segment — what a RESTful rewrite of the ack endpoint would produce.
            "/api/v1/pos/print-agent/ack/2f1c8b90-0000-4000-8000-000000000001",
            "/api/v1/pos/print-agent/claim/all",
            // A trailing character with no separator — what a bare startsWith would admit.
            "/api/v1/pos/print-agent/claimx",
            "/api/v1/pos/print-agent/ackx",
            "/api/v1/pos/print-agent/claim2",
            // A trailing slash. Not the same resource, and not exempt.
            "/api/v1/pos/print-agent/claim/",
            // The same path under a different service prefix.
            "/api/v1/kitchen/print-agent/claim",
            "/api/v1/hr/print-agent/ack",
            // The parent, and the sibling that does not exist.
            "/api/v1/pos/print-agent",
            "/api/v1/pos/print-agent/",
            "/api/v1/pos/print-agents/claim",
            // Ordinary POS traffic, which must keep needing a token.
            "/api/v1/pos/orders",
            "/api/v1/pos/orders/2f1c8b90-0000-4000-8000-000000000001/send-to-kds",
            "/api/v1/pos/print-jobs/2f1c8b90-0000-4000-8000-000000000001",
            // Dot-dot: WebFlux does not collapse these, so the gateway and the upstream could
            // otherwise disagree about which resource is addressed.
            "/api/v1/pos/print-agent/../print-agent/claim",
            "/api/v1/pos/print-agent/claim/..",
            "/api/v1/pos/orders/../print-agent/claim"
    })
    @DisplayName("no near-miss variant classifies as an agent path")
    void nearMisses_doNotClassify(String path) {
        assertThat(filter.isAgentPath(path)).isFalse();
    }

    @Test
    @DisplayName("a null path is refused rather than throwing")
    void nullPath_isRefused() {
        assertThat(filter.isAgentPath(null)).isFalse();
    }

    // ══ The neighbouring lists are provably unchanged ════════════════════════════════════════

    /**
     * The guard that matters most for a reader six months from now.
     *
     * <p>26-11 added a list beside {@code PUBLIC_PATHS}. The risk it introduces is not the new list
     * — it is that somebody later finds it easier to append to the OLD one. A literal count fails
     * loudly on that, where a code review does not.
     */
    @Test
    @DisplayName("PUBLIC_PATHS still has exactly the 13 entries it had before 26-11")
    void publicPaths_areUnchanged() {
        assertThat(JwtGlobalFilter.PUBLIC_PATHS)
                .as("an entry added here fails OPEN silently — no error, no log, just an endpoint "
                        + "that stopped asking for a token")
                .containsExactly(
                        "/api/v1/auth/login",
                        "/api/v1/auth/refresh",
                        "/api/v1/auth/reset-password",
                        "/api/v1/auth/tenants",
                        "/api/v1/auth/2fa/bootstrap",
                        "/.well-known",
                        "/actuator/health",
                        "/actuator/prometheus",
                        "/fallback",
                        "/iclock",
                        "/internal/attendance/ingest",
                        "/api/v1/platform/auth/login",
                        "/api/v1/auth/change-password/forced");
    }

    @Test
    @DisplayName("WS_UPGRADE_PATHS still has exactly the 3 entries it had before 26-11")
    void wsUpgradePaths_areUnchanged() {
        assertThat(JwtGlobalFilter.WS_UPGRADE_PATHS)
                .as("the POS live-order socket was only just repaired; this list is not the place "
                        + "for an HTTP endpoint")
                .containsExactly(
                        "/api/v1/reporting/dashboard/",
                        "/api/v1/kitchen/",
                        "/api/v1/pos/ws/orders/");
    }

    @Test
    @DisplayName("AGENT_PATHS holds exactly two paths and neither is a prefix of a wider surface")
    void agentPaths_areExactlyTwo() {
        assertThat(JwtGlobalFilter.AGENT_PATHS).hasSize(2);
        // Not decoration: if either entry ever ends in a separator it stops being a leaf and starts
        // reading like a prefix, which is how the next reader talks themselves into prefix matching.
        assertThat(JwtGlobalFilter.AGENT_PATHS).allSatisfy(p ->
                assertThat(p).doesNotEndWith("/").startsWith("/api/v1/pos/print-agent/"));
    }
}
