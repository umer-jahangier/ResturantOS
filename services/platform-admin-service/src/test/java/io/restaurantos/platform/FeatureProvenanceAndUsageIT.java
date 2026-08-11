package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.service.FeatureFlagAdminService;
import io.restaurantos.platform.service.ProvisioningService;
import io.restaurantos.platform.service.UsageService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Feature provenance and honest usage reporting (19c).
 *
 * <p><b>What this suite is guarding, and why each assertion is not redundant.</b>
 *
 * <ol>
 *   <li><b>An override is distinguishable from a tier default on the wire.</b> Before 19c the
 *       endpoint returned {@code Map<String,Boolean>}, so a module an operator deliberately revoked
 *       and a module the tier simply does not include arrived as the same {@code false}. Four rows
 *       in the live database carried {@code is_override = true} and no client could see one of
 *       them. This is the whole reason 13-14 added the column.</li>
 *   <li><b>The legacy map survives.</b> {@code phase13-subscription-e2e.sh} greps this body for
 *       {@code "FEATURE_X":true}. An "improvement" that silently broke a passing gate would be a
 *       poor trade.</li>
 *   <li><b>The gateway's internal twin is untouched.</b> Enforcement does not want provenance, and
 *       a route the whole product depends on is the wrong place to absorb a console's payload.</li>
 *   <li><b>Clearing an override really returns the row to tier control</b>, rather than only
 *       relabelling it — proven by making a tier change move a code it previously skipped.</li>
 *   <li><b>Usage never invents a number.</b> Not-metered, metered-and-zero, and unreadable are
 *       three different answers. Collapsing them into {@code 0} is the defect: a console reporting
 *       "0 / 50 branches" for a tenant with seven is worse than no console, because an operator
 *       would act on it.</li>
 *   <li><b>A summed quantity is not a row count</b> (GA-051) and a real ceiling is not
 *       {@code Long.MAX_VALUE} (GA-052).</li>
 * </ol>
 */
class FeatureProvenanceAndUsageIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;
    @Autowired FeatureFlagAdminService featureFlagService;
    @Autowired UsageService usageService;

    private static final UUID SUPER_ADMIN_ID = UUID.randomUUID();

    /** GROWTH-only in the tier matrix — a STARTER tenant does not get it by default. */
    private static final String GROWTH_ONLY = "FEATURE_MULTI_BRANCH";
    /** On at every tier. A STARTER tenant HAS this, so switching it off is a real revocation. */
    private static final String ALWAYS_ON = "FEATURE_CRM";

    // ── 1. Provenance ───────────────────────────────────────────────────────────────────────

    @Test
    void features_distinguishAnOperatorsRevocationFromAModuleTheTierNeverIncluded() {
        UUID tenantId = provisionStarter("Provenance Revoke");

        // The operator turns OFF a module STARTER genuinely includes.
        featureFlagService.setFeature(tenantId, ALWAYS_ON, false);

        var body = httpGetAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/features")
            .getBody();

        // Both codes are FALSE. Before 19c that was the entire content of the response and the two
        // were indistinguishable — which is precisely the bug.
        assertThat(body).contains("\"" + ALWAYS_ON + "\":false");
        assertThat(body).contains("\"" + GROWTH_ONLY + "\":false");

        assertThat(stateOf(body, ALWAYS_ON))
            .as("a module the operator switched off, which the tier grants — an upgrade must not "
                + "silently switch it back on, and the console must be able to say so")
            .contains("\"source\":\"OVERRIDE_REVOKE\"")
            .contains("\"isOverride\":true")
            .contains("\"tierDefault\":true");

        assertThat(stateOf(body, GROWTH_ONLY))
            .as("the same false, for an entirely different reason: nobody decided this, the tier "
                + "simply does not include it")
            .contains("\"source\":\"TIER_DEFAULT\"")
            .contains("\"isOverride\":false")
            .contains("\"tierDefault\":false");
    }

    @Test
    void features_markAGrantAboveTierAsAGrant() {
        UUID tenantId = provisionStarter("Provenance Grant");
        featureFlagService.setFeature(tenantId, GROWTH_ONLY, true);

        String body = httpGetAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/features").getBody();

        assertThat(stateOf(body, GROWTH_ONLY))
            .as("switched ON above the tier — this is what survives a downgrade under PLATFORM-10")
            .contains("\"source\":\"OVERRIDE_GRANT\"")
            .contains("\"enabled\":true")
            .contains("\"tierDefault\":false");
    }

    @Test
    void features_markAnOverrideThatMerelyAgreesWithTheTier() {
        UUID tenantId = provisionStarter("Provenance Agree");
        // Setting a code to the value it already had still marks the row: the operator touched it,
        // and reconciliation will now skip it forever. That is a real difference from an untouched
        // row of the same value, and the screen has to be able to show it.
        featureFlagService.setFeature(tenantId, ALWAYS_ON, true);

        assertThat(stateOf(httpGetAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/features").getBody(), ALWAYS_ON))
            .as("same value as the tier, but pinned — reverting changes nothing today and "
                + "everything on the next tier change")
            .contains("\"source\":\"OVERRIDE_MATCHES_TIER\"")
            .contains("\"isOverride\":true");
    }

    @Test
    void features_keepTheLegacyMapAndTheTier_soExistingCallersAreUnaffected() {
        UUID tenantId = provisionStarter("Legacy Shape");

        String body = httpGetAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/features").getBody();

        assertThat(body)
            .as("scripts/e2e/phase13-subscription-e2e.sh asserts on exactly this substring")
            .contains("\"features\":{")
            .contains("\"FEATURE_POS\":true");
        assertThat(body)
            .as("the tier the defaults were computed against, so the screen never has to assume "
                + "the separately-fetched tenant row is still current")
            .contains("\"tier\":\"STARTER\"");
    }

    @Test
    void internalFeaturesEndpoint_isUnchanged_becauseTheGatewayReadsIt() {
        UUID tenantId = provisionStarter("Internal Untouched");

        String body = httpGetInternal("/internal/platform/tenants/" + tenantId + "/features")
            .getBody();

        assertThat(body).contains("\"features\":{");
        assertThat(body)
            .as("enforcement does not want provenance; widening this path to serve a console is "
                + "how a route the whole product depends on acquires a bug")
            .doesNotContain("featureStates");
    }

    // ── 2. Clearing an override ─────────────────────────────────────────────────────────────

    @Test
    void clearOverride_returnsTheRowToTierControl_provenByALaterTierChangeMovingIt() {
        UUID tenantId = provisionStarter("Clear Override");
        featureFlagService.setFeature(tenantId, ALWAYS_ON, false);

        var res = rest.method(org.springframework.http.HttpMethod.DELETE)
            .uri("/api/v1/platform/tenants/" + tenantId + "/features/" + ALWAYS_ON + "/override")
            .header("Authorization", "Bearer " + superAdminToken())
            .retrieve()
            .toEntity(String.class);
        assertThat(res.getStatusCode().value()).isEqualTo(200);

        String body = httpGetAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/features").getBody();
        assertThat(stateOf(body, ALWAYS_ON))
            .as("marker gone AND the value back at the tier default — a row claiming to be "
                + "inherited while holding the override's value is contradicted by the next read")
            .contains("\"source\":\"TIER_DEFAULT\"")
            .contains("\"isOverride\":false")
            .contains("\"enabled\":true");

        assertThat(redis.opsForValue().get("tenant_features:" + tenantId + ":" + ALWAYS_ON))
            .as("both Redis shapes are re-written when the value moves, or the gateway keeps "
                + "serving the revoked answer")
            .isEqualTo("true");
        assertThat(redis.opsForValue().get("feature:" + tenantId + ":" + ALWAYS_ON))
            .isEqualTo("true");
    }

    // ── 3. Usage honesty ────────────────────────────────────────────────────────────────────

    @Test
    void usage_reportsNotMetered_ratherThanZero_forEveryResourceNobodyRecords() {
        UUID tenantId = provisionStarter("Usage Honesty");
        stubBranchCount(tenantId, 3);

        var usage = usageService.meters(tenantId);

        var users = meter(usage, "users");
        assertThat(users.metered())
            .as("auth-service exposes no per-tenant user count; claiming a number here would be "
                + "a fabrication an operator could reasonably act on")
            .isFalse();
        assertThat(users.used())
            .as("null, NOT 0 — zero is a claim that we counted and found none")
            .isNull();
        assertThat(users.limit())
            .as("the entitlement half is real even when the usage half is not — GA-083")
            .isEqualTo(10);
        assertThat(users.source()).isNotBlank();

        assertThat(meter(usage, "storage_gb").metered()).isFalse();
        assertThat(meter(usage, "storage_gb").used()).isNull();
        assertThat(meter(usage, "nlq_queries").metered())
            .as("the counter key does not exist — unwired, which is not the same as 'no queries'")
            .isFalse();
    }

    @Test
    void usage_reportsTheOneResourceThatIsReallyCounted() {
        UUID tenantId = provisionStarter("Usage Branches");
        stubBranchCount(tenantId, 3);

        var branches = meter(usageService.meters(tenantId), "branches");

        assertThat(branches.metered()).isTrue();
        assertThat(branches.unavailable()).isFalse();
        assertThat(branches.used())
            .as("the same live count TenantSubscriptionService trusts to refuse a downgrade, so "
                + "this screen and that safety check cannot disagree")
            .isEqualTo(3L);
        assertThat(branches.limit()).isEqualTo(1); // STARTER
    }

    @Test
    void usage_marksAnUnreadableMeterUnavailable_notZero() {
        UUID tenantId = provisionStarter("Usage Unreadable");
        stubBranchCountUnavailable(tenantId);

        var branches = meter(usageService.meters(tenantId), "branches");

        assertThat(branches.unavailable())
            .as("13-03's posture: an undeterminable value is neither zero nor permissive")
            .isTrue();
        assertThat(branches.used()).isNull();
        assertThat(branches.limit())
            .as("the ceiling is still known even when the usage is not")
            .isEqualTo(1);
    }

    // ── 4. GA-051 / GA-052 ──────────────────────────────────────────────────────────────────

    @Test
    void record_returnsTheSummedQuantity_notTheRowCount() {
        UUID tenantId = provisionStarter("Usage Sum");

        usageService.record(tenantId, "orders", new BigDecimal("5"));
        long total = usageService.record(tenantId, "orders", new BigDecimal("3"));

        assertThat(total)
            .as("GA-051: this returned countByTenantIdAndResource — the number of ROWS — so "
                + "5 then 3 answered 2. A quantity and a cardinality agree only while every "
                + "delta is exactly 1, which is the one case metering does not need")
            .isEqualTo(8L);
    }

    @Test
    void recordEndpoint_returnsTheRealTierCeiling_notLongMaxValue() {
        UUID tenantId = provisionStarter("Usage Limit");

        String body = httpPostInternal("/internal/platform/tenants/" + tenantId + "/usage",
            java.util.Map.of("resource", "branches", "delta", 1)).getBody();

        assertThat(body)
            .as("GA-052: Long.MAX_VALUE is the entitlement half of usage-against-entitlement "
                + "thrown away at the moment it becomes useful — a caller comparing the two "
                + "would always continue serving")
            .doesNotContain(String.valueOf(Long.MAX_VALUE));
        assertThat(body)
            .as("STARTER's real branch ceiling, from TierLimits, stamped on the tenant row")
            .contains("\"limit\":1");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────

    /** The JSON object for one code inside {@code featureStates}, as a substring to assert on. */
    private String stateOf(String body, String code) {
        int at = body.indexOf("\"code\":\"" + code + "\"");
        assertThat(at)
            .as("featureStates must carry %s — omitting a code makes an unseeded tenant "
                + "indistinguishable from a tenant with it switched off", code)
            .isGreaterThan(-1);
        int end = body.indexOf('}', at);
        return body.substring(at, end < 0 ? body.length() : end);
    }

    private io.restaurantos.platform.dto.PlatformDtos.UsageMeter meter(
            io.restaurantos.platform.dto.PlatformDtos.TenantUsageResponse usage, String resource) {
        return usage.meters().stream()
            .filter(m -> m.resource().equals(resource))
            .findFirst()
            .orElseThrow(() -> new AssertionError("no meter for " + resource));
    }

    private String superAdminToken() {
        return platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN");
    }

    private UUID provisionStarter(String brand) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        stubProvisioningSagaHappyPath(UUID.randomUUID(), UUID.randomUUID(), "T#123");
        stubFinanceSeedCoaAnyTenant();
        UUID tenantId = provisioningService
            .provision("prov-" + UUID.randomUUID(), brand + " " + UUID.randomUUID(),
                "admin@prov.local", "STARTER")
            .tenantId();
        stubBranchCount(tenantId, 0);
        return tenantId;
    }

    private void stubBranchCount(UUID tenantId, int count) {
        StringBuilder body = new StringBuilder("[");
        for (int i = 0; i < count; i++) {
            if (i > 0) body.append(',');
            body.append("{\"id\":\"").append(UUID.randomUUID()).append("\",\"name\":\"B").append(i).append("\"}");
        }
        body.append(']');
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(
                "/internal/users/tenants/" + tenantId + "/branches"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody(body.toString())));
    }

    private void stubBranchCountUnavailable(UUID tenantId) {
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(
                "/internal/users/tenants/" + tenantId + "/branches"))
            .willReturn(WireMock.aResponse().withStatus(500).withBody("{\"error\":\"simulated\"}")));
    }
}
