package io.restaurantos.platform;

import io.restaurantos.platform.entity.TenantEntity.TenantStatus;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.service.FeatureFlagAdminService;
import io.restaurantos.platform.service.ProvisioningService;
import io.restaurantos.platform.service.TenantSubscriptionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Tenant subscription and tier management (13-14 / D-35, PLATFORM-02/03/10).
 *
 * <p>The behaviours, and what each one is guarding:
 *
 * <ol>
 *   <li>A tenant's brand, billing reference, trial end and renewal date can be edited and read
 *       back — three columns nothing in this codebase read or wrote before.</li>
 *   <li>The slug is not editable, because login resolves a tenant by it.</li>
 *   <li>An upgrade enables the codes the higher tier unlocks and re-applies the numeric limits.</li>
 *   <li>A downgrade disables the codes the lower tier no longer covers, and deletes nothing.</li>
 *   <li>A feature a SuperAdmin overrode survives a tier change IN BOTH DIRECTIONS — PLATFORM-10's
 *       authoritative-override rule, and the assertion a naive reconciliation fails.</li>
 *   <li>Both Redis key shapes are written for every code that moved, so the gateway sees the change
 *       on the next request rather than after a five-minute TTL.</li>
 *   <li>A downgrade below current usage is refused, naming the limit and the usage, and applied
 *       when {@code force} is set.</li>
 *   <li>Retry is reachable through the API, re-drives the SAME tenant row, and refuses a tenant
 *       that is not in the failed state.</li>
 * </ol>
 *
 * <p><b>And the gate on all of it.</b> Every one of these endpoints changes what a tenant is
 * entitled to, so {@code superAdminGate_*} asserts that a tenant OWNER and a TENANT_ADMIN — both
 * holding REAL, correctly signed tokens — are refused. Those two cases are written against a live
 * JWKS precisely so they cannot pass for the wrong reason: with the old empty key set every token
 * failed verification and a 401 would have masqueraded as an authorization refusal.
 */
class TenantSubscriptionIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;
    @Autowired TenantSubscriptionService subscriptionService;
    @Autowired FeatureFlagAdminService featureFlagService;

    private static final UUID SUPER_ADMIN_ID = UUID.randomUUID();

    /** GROWTH-only in the tier matrix; STARTER does not get it. */
    private static final String GROWTH_ONLY = "FEATURE_MULTI_BRANCH";
    /** ENTERPRISE-only; neither STARTER nor GROWTH gets it by default. */
    private static final String ENTERPRISE_ONLY = "FEATURE_WHITE_LABEL_DOMAIN";
    /** On at every tier — the control that proves reconciliation is selective, not indiscriminate. */
    private static final String ALWAYS_ON = "FEATURE_POS";

    // ── 1 + 2: the editable profile ─────────────────────────────────────────────────────────

    @Test
    void update_setsBillingReferenceTrialEndAndRenewal_andReadsThemBack() {
        UUID tenantId = provisionStarter("Subscription Update");
        Instant trialEnd = Instant.now().plus(14, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        Instant renewal  = Instant.now().plus(365, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);

        var res = httpPatchAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId,
            Map.of("brandName", "Renamed Brand",
                   "billingRef", "cus_ABC123",
                   "trialEndsAt", trialEnd.toString(),
                   "renewsAt", renewal.toString()));

        assertThat(res.getStatusCode().value()).isEqualTo(200);

        var reread = httpGetAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId);
        assertThat(reread.getBody())
            .contains("Renamed Brand")
            .contains("cus_ABC123")
            .contains(trialEnd.toString())
            .contains(renewal.toString());

        // Read from the row itself, not only from the response the same request produced.
        var row = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(row.getBillingRef()).isEqualTo("cus_ABC123");
        assertThat(row.getTrialEndsAt()).isEqualTo(trialEnd);
        assertThat(row.getRenewsAt()).isEqualTo(renewal);
    }

    @Test
    void update_cannotChangeTheSlug_becauseLoginResolvesByIt() {
        UUID tenantId = provisionStarter("Subscription Slug");
        String originalSlug = tenantRepository.findById(tenantId).orElseThrow().getSlug();

        // A client sending a slug gets it ignored, not honoured: UpdateTenantRequest declares no
        // such component, so Jackson drops it. Asserting the ROW is what makes this meaningful —
        // a 200 alone would be equally consistent with the rename having worked.
        var res = httpPatchAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId,
            Map.of("slug", "attacker-chosen-slug", "brandName", "Still Editable"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        var row = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(row.getSlug()).isEqualTo(originalSlug);
        assertThat(row.getBrandName()).isEqualTo("Still Editable");
    }

    // ── 3 + 6: upgrading ────────────────────────────────────────────────────────────────────

    @Test
    void changeTier_upgrade_enablesTheNewTiersCodes_reAppliesLimits_andInvalidatesBothCacheKeys() {
        UUID tenantId = provisionStarter("Subscription Upgrade");
        assertThat(featureFlagService.getFeatures(tenantId).get(GROWTH_ONLY)).isFalse();

        var res = httpPostAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/tier",
            Map.of("tier", "GROWTH"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains(GROWTH_ONLY).contains("\"previousTier\":\"STARTER\"");

        var row = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(row.getTier()).isEqualTo(TierType.GROWTH);
        // The numeric half — previously stamped only at provisioning, so a tier change left a
        // GROWTH tenant on STARTER's ceilings.
        assertThat(row.getMaxBranches()).isEqualTo(5);
        assertThat(row.getMaxUsers()).isEqualTo(50);
        assertThat(row.getNlqQuota()).isEqualTo(5000);

        assertThat(featureFlagService.getFeatures(tenantId).get(GROWTH_ONLY)).isTrue();
        assertBothCacheKeys(tenantId, GROWTH_ONLY, "true");
        // The tenant's new allowance is published for the gateway and nlq-service at once.
        assertThat(redis.opsForValue().get(TenantSubscriptionService.QUOTA_KEY_PREFIX + tenantId))
            .isEqualTo("5000");
    }

    // ── 4: downgrading disables, and destroys nothing ───────────────────────────────────────

    @Test
    void changeTier_downgrade_disablesTheCodesTheLowerTierDoesNotCover_andDeletesNoRows() {
        UUID tenantId = provisionGrowth("Subscription Downgrade");
        int rowsBefore = featureFlagService.getFeatures(tenantId).size();
        assertThat(featureFlagService.getFeatures(tenantId).get(GROWTH_ONLY)).isTrue();

        subscriptionService.changeTier(tenantId, TierType.STARTER, false);

        Map<String, Boolean> after = featureFlagService.getFeatures(tenantId);
        assertThat(after.get(GROWTH_ONLY)).isFalse();
        assertThat(after.get(ALWAYS_ON))
            .as("an all-tiers code must be untouched — a reconciliation that disabled everything "
                + "would otherwise pass the assertion above")
            .isTrue();
        assertThat(after)
            .as("disabling a module gates access; it does not delete the row, and re-upgrading "
                + "must restore the tenant exactly")
            .hasSize(rowsBefore);
        assertBothCacheKeys(tenantId, GROWTH_ONLY, "false");

        var row = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(row.getMaxBranches()).isEqualTo(1);
        assertThat(row.getNlqQuota()).isEqualTo(1000);
    }

    // ── 5: the override rule, in both directions ────────────────────────────────────────────

    @Test
    void changeTier_preservesAnOverriddenFeature_whenTierDefaultsWouldDisableIt() {
        UUID tenantId = provisionGrowth("Subscription Override Down");

        // The SuperAdmin grants an ENTERPRISE-only feature to a GROWTH tenant, through the same
        // endpoint an administrator would use.
        var toggled = httpPatchAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/features/" + ENTERPRISE_ONLY,
            Map.of("enabled", true));
        assertThat(toggled.getStatusCode().value()).isEqualTo(200);

        subscriptionService.changeTier(tenantId, TierType.STARTER, false);

        Map<String, Boolean> after = featureFlagService.getFeatures(tenantId);
        assertThat(after.get(ENTERPRISE_ONLY))
            .as("PLATFORM-10: a SuperAdmin override is authoritative over the tier default, so a "
                + "deliberately granted feature survives a downgrade")
            .isTrue();
        assertThat(after.get(GROWTH_ONLY))
            .as("...while a merely tier-derived feature does not — otherwise 'preserved' would "
                + "just mean 'the downgrade did nothing'")
            .isFalse();
        assertBothCacheKeys(tenantId, ENTERPRISE_ONLY, "true");
    }

    @Test
    void changeTier_preservesAnOverriddenFeature_whenTierDefaultsWouldEnableIt() {
        UUID tenantId = provisionStarter("Subscription Override Up");

        // The other direction, and the half a partial implementation gets wrong: an administrator
        // deliberately switched a module OFF. An upgrade must not switch it back on.
        featureFlagService.setFeature(tenantId, ALWAYS_ON, false);

        subscriptionService.changeTier(tenantId, TierType.ENTERPRISE, false);

        Map<String, Boolean> after = featureFlagService.getFeatures(tenantId);
        assertThat(after.get(ALWAYS_ON))
            .as("an override is authoritative in BOTH directions; re-enabling here would undo a "
                + "decision an administrator made on purpose")
            .isFalse();
        assertThat(after.get(ENTERPRISE_ONLY))
            .as("the tier-derived codes still move, so this is not passing because nothing happened")
            .isTrue();
    }

    // ── 7: the refused downgrade ────────────────────────────────────────────────────────────

    @Test
    void changeTier_downgradeBelowCurrentUsage_isRefusedNamingTheLimitAndUsage_andForceOverridesIt() {
        UUID tenantId = provisionGrowth("Subscription Overlimit");
        // Three live branches; STARTER allows one.
        stubBranchCount(tenantId, 3);

        var refused = httpPostAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/tier",
            Map.of("tier", "STARTER"));

        assertThat(refused.getStatusCode().value()).isEqualTo(409);
        assertThat(refused.getBody())
            .contains("TIER_LIMIT_EXCEEDED")
            .contains("branches")
            .contains("in use 3")
            .contains("allows 1");
        assertThat(tenantRepository.findById(tenantId).orElseThrow().getTier())
            .as("a refusal must not have applied half the change")
            .isEqualTo(TierType.GROWTH);

        var forced = httpPostAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/tier",
            Map.of("tier", "STARTER", "force", true));

        assertThat(forced.getStatusCode().value()).isEqualTo(200);
        assertThat(forced.getBody()).contains("\"forcedOverLimits\":true");
        assertThat(tenantRepository.findById(tenantId).orElseThrow().getTier()).isEqualTo(TierType.STARTER);
    }

    @Test
    void changeTier_refusesTheDowngrade_whenTheBranchCountCannotBeObtained() {
        UUID tenantId = provisionGrowth("Subscription Usage Unknown");
        stubBranchCountUnavailable(tenantId);

        assertThatThrownBy(() -> subscriptionService.changeTier(tenantId, TierType.STARTER, false))
            .as("an undeterminable usage is not a permissive one — the same posture 13-03 "
                + "established for tenant status")
            .isInstanceOf(io.restaurantos.platform.exception.TierLimitExceededException.class)
            .hasMessageContaining("count unavailable");

        assertThat(tenantRepository.findById(tenantId).orElseThrow().getTier()).isEqualTo(TierType.GROWTH);
    }

    @Test
    void changeTier_upgradeIsNotBlockedByUsage() {
        UUID tenantId = provisionStarter("Subscription Upgrade Overlimit");
        // Already over STARTER's cap. Raising the ceiling is the fix, not the problem.
        stubBranchCount(tenantId, 4);

        var res = httpPostAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/tier",
            Map.of("tier", "GROWTH"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);
    }

    // ── 8: retry ────────────────────────────────────────────────────────────────────────────

    @Test
    void retryProvisioning_reDrivesTheSameTenantRow_ratherThanCreatingASecond() {
        UUID tenantId = provisionFailed("Subscription Retry");
        String slugBefore = tenantRepository.findById(tenantId).orElseThrow().getSlug();
        long tenantsBefore = tenantRepository.count();

        stubProvisioningSagaHappyPath(UUID.randomUUID(), UUID.randomUUID(), "T#retry1");
        stubFinanceSeedCoaAnyTenant();

        var res = httpPostAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/retry-provisioning",
            Map.of("adminEmail", "owner@retry.local"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        var row = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(row.getStatus()).isEqualTo(TenantStatus.ACTIVE);
        assertThat(row.getSlug())
            .as("a retry that produces a new tenant with a '-1' slug has abandoned the one the "
                + "operator asked about — 13-10 recorded this defect and left it for whoever "
                + "exposed the endpoint")
            .isEqualTo(slugBefore);
        assertThat(tenantRepository.count()).isEqualTo(tenantsBefore);
    }

    @Test
    void retryProvisioning_refusesATenantThatIsNotInTheFailedState() {
        UUID tenantId = provisionStarter("Subscription Retry Active");

        var res = httpPostAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/retry-provisioning",
            Map.of("adminEmail", "owner@retry.local"));

        assertThat(res.getStatusCode().value()).isEqualTo(409);
        assertThat(res.getBody()).contains("PROVISIONING_FAILED");
    }

    // ── The gate ────────────────────────────────────────────────────────────────────────────

    @Test
    void superAdminGate_aTenantOwnerIsRefusedEveryTierAndSubscriptionEndpoint() {
        UUID tenantId = provisionStarter("Subscription Gate Owner");
        String ownerToken = tenantToken(UUID.randomUUID(), tenantId, "OWNER",
            List.of("rbac.manage", "rbac.user.manage", "pos.order.create"));

        assertRefused(ownerToken, tenantId);
    }

    @Test
    void superAdminGate_aTenantAdminIsRefusedEveryTierAndSubscriptionEndpoint() {
        UUID tenantId = provisionStarter("Subscription Gate Admin");
        String adminToken = tenantToken(UUID.randomUUID(), tenantId, "TENANT_ADMIN",
            List.of("rbac.user.manage", "branch.manage", "finance.period.close"));

        assertRefused(adminToken, tenantId);
    }

    /**
     * The negative control for both gate tests. Without it, a bug that made EVERY request 403 would
     * turn them green — so this asserts the same SuperAdmin token, on the same endpoints, is
     * accepted.
     */
    @Test
    void superAdminGate_theSuperAdminTokenItselfIsAccepted() {
        UUID tenantId = provisionStarter("Subscription Gate Positive");

        assertThat(httpGetAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId)
            .getStatusCode().value()).isEqualTo(200);
        assertThat(httpPatchAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId,
            Map.of("brandName", "Accepted")).getStatusCode().value()).isEqualTo(200);
        assertThat(httpPostAs(superAdminToken(), "/api/v1/platform/tenants/" + tenantId + "/tier",
            Map.of("tier", "GROWTH")).getStatusCode().value()).isEqualTo(200);
    }

    private void assertRefused(String token, UUID tenantId) {
        assertThat(httpPatchAs(token, "/api/v1/platform/tenants/" + tenantId,
            Map.of("brandName", "Should Not Apply")).getStatusCode().value())
            .as("editing a tenant's subscription is a SUPER_ADMIN operation")
            .isEqualTo(403);

        assertThat(httpPostAs(token, "/api/v1/platform/tenants/" + tenantId + "/tier",
            Map.of("tier", "ENTERPRISE")).getStatusCode().value())
            .as("a tenant granting itself a higher tier is the elevation this gate exists for")
            .isEqualTo(403);

        assertThat(httpPatchAs(token,
            "/api/v1/platform/tenants/" + tenantId + "/features/" + ENTERPRISE_ONLY,
            Map.of("enabled", true)).getStatusCode().value())
            .as("the module set is a SUPER_ADMIN operation too")
            .isEqualTo(403);

        assertThat(httpPostAs(token, "/api/v1/platform/tenants/" + tenantId + "/suspend",
            Map.of("reason", "nope")).getStatusCode().value())
            .as("so is a tenant's status")
            .isEqualTo(403);

        // And nothing moved.
        var row = tenantRepository.findById(tenantId).orElseThrow();
        assertThat(row.getTier()).isEqualTo(TierType.STARTER);
        assertThat(row.getStatus()).isEqualTo(TenantStatus.ACTIVE);
        assertThat(row.getBrandName()).doesNotContain("Should Not Apply");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────

    private String superAdminToken() {
        return platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN");
    }

    /** Both Redis key shapes the gateway and the @RequiresFeature aspect read. */
    private void assertBothCacheKeys(UUID tenantId, String code, String expected) {
        assertThat(redis.opsForValue().get("tenant_features:" + tenantId + ":" + code))
            .as("the gateway's key shape")
            .isEqualTo(expected);
        assertThat(redis.opsForValue().get("feature:" + tenantId + ":" + code))
            .as("the service/aspect key shape — writing only one leaves the other serving the "
                + "previous answer, which is indistinguishable from the change not taking effect")
            .isEqualTo(expected);
    }

    private UUID provisionStarter(String brand) {
        return provision(brand, "STARTER");
    }

    private UUID provisionGrowth(String brand) {
        return provision(brand, "GROWTH");
    }

    private UUID provision(String brand, String tier) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        stubProvisioningSagaHappyPath(UUID.randomUUID(), UUID.randomUUID(), "T#123");
        stubFinanceSeedCoaAnyTenant();
        UUID tenantId = provisioningService
            .provision("sub-" + UUID.randomUUID(), brand + " " + UUID.randomUUID(),
                "admin@sub.local", tier)
            .tenantId();
        // Zero live branches unless a test says otherwise, so a downgrade is permitted by default.
        stubBranchCount(tenantId, 0);
        return tenantId;
    }

    /** A tenant whose provisioning genuinely failed — the branch call 500s mid-saga. */
    private UUID provisionFailed(String brand) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        stubProvisioningSagaHappyPath(UUID.randomUUID(), UUID.randomUUID(), "T#123");
        stubUserCreateBranchFail();
        String uniqueBrand = brand + " " + UUID.randomUUID();
        try {
            provisioningService.provision("sub-fail-" + UUID.randomUUID(), uniqueBrand,
                "owner@retry.local", "STARTER");
        } catch (RuntimeException expected) {
            // The saga is supposed to fail here; that is the fixture.
        }
        return tenantRepository.findAll().stream()
            .filter(t -> uniqueBrand.equals(t.getBrandName()))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("the failed tenant row was not written"))
            .getId();
    }

    private void stubBranchCount(UUID tenantId, int count) {
        StringBuilder body = new StringBuilder("[");
        for (int i = 0; i < count; i++) {
            if (i > 0) body.append(',');
            body.append("{\"id\":\"").append(UUID.randomUUID()).append("\",\"name\":\"B").append(i).append("\"}");
        }
        body.append(']');
        WIREMOCK.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(
                com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo(
                    "/internal/users/tenants/" + tenantId + "/branches"))
            .willReturn(com.github.tomakehurst.wiremock.client.WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody(body.toString())));
    }

    private void stubBranchCountUnavailable(UUID tenantId) {
        WIREMOCK.stubFor(com.github.tomakehurst.wiremock.client.WireMock.get(
                com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo(
                    "/internal/users/tenants/" + tenantId + "/branches"))
            .willReturn(com.github.tomakehurst.wiremock.client.WireMock.aResponse()
                .withStatus(500).withBody("{\"error\":\"simulated\"}")));
    }
}
