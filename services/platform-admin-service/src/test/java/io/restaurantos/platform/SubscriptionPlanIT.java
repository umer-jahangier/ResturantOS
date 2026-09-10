package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.config.TierFeatureDefaults;
import io.restaurantos.platform.config.TierLimits;
import io.restaurantos.platform.entity.TenantEntity.TierType;
import io.restaurantos.platform.repository.SubscriptionPlanRepository;
import io.restaurantos.platform.service.ProvisioningService;
import io.restaurantos.platform.service.SubscriptionPlanService;
import io.restaurantos.platform.service.SubscriptionService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Plans as first-class entities.
 *
 * <ol>
 *   <li>The four tier-aligned plans exist in every environment, and their ceilings are the tier's —
 *       the divergence {@code SeededPlanTierConsistencyTest} guards statically, asserted here against
 *       the database that actually applied the changelog.</li>
 *   <li>A plan's FEATURE set is derived from its tier and is not stored on the plan. There is one
 *       matrix; a second copy is the phantom-flag defect that has shipped twice here.</li>
 *   <li>Creating a plan defaults its ceilings to the tier's, and a bespoke plan can override them —
 *       which is the whole reason a plan is not just a tier.</li>
 *   <li>A duplicate code is refused with the field named, not a raw constraint violation.</li>
 *   <li>A plan is ARCHIVED, never deleted, and archiving is refused while subscriptions name it.</li>
 *   <li>Money is paisa, and a negative price is refused.</li>
 * </ol>
 */
class SubscriptionPlanIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;
    @Autowired SubscriptionPlanService planService;
    @Autowired SubscriptionService subscriptionService;
    @Autowired SubscriptionPlanRepository planRepository;
    @Autowired TierFeatureDefaults tierFeatureDefaults;
    @Autowired TierLimits tierLimits;

    private static final UUID SUPER_ADMIN_ID = UUID.randomUUID();

    @Test
    void theFourTierAlignedPlansAreSeededAndCarryTheirTiersCeilings() {
        var plans = planService.list(false);

        assertThat(plans).extracting("code")
            .as("without at least one plan the whole subscription surface is unusable, so the seed "
                + "is not dev-only and carries no Liquibase context")
            .contains("starter-monthly", "growth-monthly", "enterprise-monthly", "custom");

        var growth = planService.get("growth-monthly");
        var expected = tierLimits.forTier(TierType.GROWTH);
        assertThat(growth.maxBranches()).isEqualTo(expected.maxBranches());
        assertThat(growth.maxUsers()).isEqualTo(expected.maxUsers());
        assertThat(growth.storageGb()).isEqualTo(expected.storageGb());
        assertThat(growth.nlqQuota()).isEqualTo(expected.nlqQuota());
        assertThat(growth.pricePaisa())
            .as("0 is the marker for UNSET: no price for this product exists anywhere in the "
                + "repository, and a placeholder an operator might believe is worse than none")
            .isZero();
        assertThat(growth.currency()).isEqualTo("PKR");
    }

    @Test
    void aPlansFeatureSetIsDerivedFromItsTierAndIsNotStoredOnThePlan() {
        var starter = planService.get("starter-monthly");
        var enterprise = planService.get("enterprise-monthly");

        assertThat(starter.features())
            .as("derived from TierFeatureDefaults — one matrix, no second copy, because a second "
                + "copy is wrong from the first time a code changes tier")
            .isEqualTo(tierFeatureDefaults.defaultsFor("STARTER"));
        assertThat(enterprise.features()).isEqualTo(tierFeatureDefaults.defaultsFor("ENTERPRISE"));
        assertThat(starter.features())
            .as("the two really differ, so the assertion above is not passing because both are empty")
            .isNotEqualTo(enterprise.features());
    }

    @Test
    void creatingAPlanDefaultsItsCeilingsToTheTiers_andABespokePlanCanOverrideThem() {
        String inherited = "it-inherited-" + UUID.randomUUID().toString().substring(0, 8);
        var created = planService.create(new io.restaurantos.platform.dto.SubscriptionDtos
            .CreatePlanRequest(inherited, "Inherited", null, "GROWTH", 4_500_00L, "PKR",
                "MONTHLY", 0, null, null, null, null, null, null));

        var growthDefaults = tierLimits.forTier(TierType.GROWTH);
        assertThat(created.maxBranches())
            .as("most plans are a price attached to an existing tier; making an operator retype the "
                + "tier table by hand is how a plan silently acquires different numbers")
            .isEqualTo(growthDefaults.maxBranches());
        assertThat(created.pricePaisa())
            .as("BIGINT paisa on the wire and in the column — 4500.00 PKR is 450000 paisa")
            .isEqualTo(450_000L);

        String bespoke = "it-bespoke-" + UUID.randomUUID().toString().substring(0, 8);
        var negotiated = planService.create(new io.restaurantos.platform.dto.SubscriptionDtos
            .CreatePlanRequest(bespoke, "Negotiated", null, "ENTERPRISE", 0L, "USD",
                "ANNUAL", 0, 120, 900, 250, 90_000, 40, 500_000));

        assertThat(negotiated.maxBranches())
            .as("a bespoke agreement is precisely a tier whose numbers are NOT the tier's defaults "
                + "— this is the capability a plan adds over a tier")
            .isEqualTo(120);
        assertThat(negotiated.maxTerminals()).isEqualTo(40);
        assertThat(negotiated.maxOrdersPerMonth()).isEqualTo(500_000);
        assertThat(negotiated.currency()).isEqualTo("USD");
    }

    @Test
    void aDuplicatePlanCodeIsRefusedNamingTheField() {
        var res = httpPostAs(superAdminToken(), "/api/v1/platform/plans",
            Map.of("code", "growth-monthly", "name", "Clash", "tier", "GROWTH",
                   "pricePaisa", 1, "billingPeriod", "MONTHLY", "trialDays", 0));

        assertThat(res.getStatusCode().value()).isEqualTo(409);
        assertThat(res.getBody())
            .as("the operator typed the code and can fix it, so the refusal names the field rather "
                + "than surfacing a constraint name")
            .contains("DUPLICATE_VALUE")
            .contains("code");
    }

    @Test
    void aNegativePriceIsRefused_andSoIsAMalformedCurrency() {
        var negative = httpPostAs(superAdminToken(), "/api/v1/platform/plans",
            Map.of("code", "it-negative-" + UUID.randomUUID().toString().substring(0, 8),
                   "name", "Negative", "tier", "STARTER", "pricePaisa", -1,
                   "billingPeriod", "MONTHLY", "trialDays", 0));
        assertThat(negative.getStatusCode().value())
            .as("a negative price is a data-entry accident, not a discount, and it would flow into "
                + "any future aggregate unnoticed")
            .isEqualTo(400);

        var currency = httpPostAs(superAdminToken(), "/api/v1/platform/plans",
            Map.of("code", "it-currency-" + UUID.randomUUID().toString().substring(0, 8),
                   "name", "Bad currency", "tier", "STARTER", "pricePaisa", 100,
                   "currency", "RUPEES", "billingPeriod", "MONTHLY", "trialDays", 0));
        assertThat(currency.getStatusCode().value())
            .as("a 4+ character currency reaching the column is a 500 the operator cannot act on")
            .isEqualTo(400);
    }

    @Test
    void archivingIsRefusedWhileSubscriptionsNameThePlan_andThePlanIsNeverDeleted() {
        String code = "it-archive-" + UUID.randomUUID().toString().substring(0, 8);
        planService.create(new io.restaurantos.platform.dto.SubscriptionDtos
            .CreatePlanRequest(code, "Archive Me", null, "STARTER", 0L, "PKR", "MONTHLY", 0,
                null, null, null, null, null, null));

        UUID tenantId = provisionStarter("Plan Archive");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId, new io.restaurantos.platform.dto.SubscriptionDtos
            .AssignPlanRequest(code, null, false, false, "test"), SUPER_ADMIN_ID);

        var refused = httpPostAs(superAdminToken(), "/api/v1/platform/plans/" + code + "/archive", Map.of());
        assertThat(refused.getStatusCode().value()).isEqualTo(409);
        assertThat(refused.getBody())
            .as("the refusal names the count so an operator knows the size of what they must move "
                + "first — archiving under thirty live tenants is discovered far too late")
            .contains("PLAN_IN_USE")
            .contains("1");

        assertThat(planRepository.findByCode(code))
            .as("nothing was deleted: subscription_history captures prices verbatim and "
                + "tenant_subscriptions.plan_id carries no cascade, so a delete would either be "
                + "refused by the database or destroy the record of what a tenant was sold")
            .isPresent();
    }

    @Test
    void anArchivedPlanCannotBeNewlyAssignedButStaysReadable() {
        String code = "it-archived-" + UUID.randomUUID().toString().substring(0, 8);
        planService.create(new io.restaurantos.platform.dto.SubscriptionDtos
            .CreatePlanRequest(code, "Archived", null, "STARTER", 0L, "PKR", "MONTHLY", 0,
                null, null, null, null, null, null));
        planService.archive(code);

        assertThat(planService.get(code).active()).isFalse();
        assertThat(planService.list(false)).extracting("code").doesNotContain(code);
        assertThat(planService.list(true)).extracting("code")
            .as("archived plans stay readable so historical prices survive")
            .contains(code);

        UUID tenantId = provisionStarter("Plan Archived Assign");
        stubBranchCount(tenantId, 0);
        var refused = httpPostAs(superAdminToken(),
            "/api/v1/platform/tenants/" + tenantId + "/subscription",
            Map.of("planCode", code, "reason", "should be refused"));
        assertThat(refused.getStatusCode().value()).isEqualTo(409);
        assertThat(refused.getBody()).contains("PLAN_ARCHIVED");
    }

    @Test
    void editingAPlansCeilingsDoesNotRestampTenantsAlreadyOnIt() {
        String code = "it-restamp-" + UUID.randomUUID().toString().substring(0, 8);
        planService.create(new io.restaurantos.platform.dto.SubscriptionDtos
            .CreatePlanRequest(code, "Restamp", null, "STARTER", 0L, "PKR", "MONTHLY", 0,
                null, null, null, null, null, null));

        UUID tenantId = provisionStarter("Plan Restamp");
        stubBranchCount(tenantId, 0);
        subscriptionService.assignPlan(tenantId, new io.restaurantos.platform.dto.SubscriptionDtos
            .AssignPlanRequest(code, null, false, false, "initial"), SUPER_ADMIN_ID);
        int before = tenantRepository.findById(tenantId).orElseThrow().getMaxBranches();

        planService.update(code, new io.restaurantos.platform.dto.SubscriptionDtos
            .UpdatePlanRequest(null, null, null, null, null, null, before + 40, null, null, null,
                null, null));

        assertThat(tenantRepository.findById(tenantId).orElseThrow().getMaxBranches())
            .as("widening a plan and having every tenant on it silently gain capacity — with no "
                + "history row, no operator decision and no limit check — is a bulk entitlement "
                + "change disguised as an edit. Re-assign the plan to move a tenant.")
            .isEqualTo(before);
    }

    @Test
    void superAdminGate_aTenantOwnerIsRefusedEveryPlanEndpoint() {
        UUID tenantId = provisionStarter("Plan Gate");
        String ownerToken = tenantToken(UUID.randomUUID(), tenantId, "OWNER",
            List.of("rbac.manage", "pos.order.create"));

        assertThat(httpGetAs(ownerToken, "/api/v1/platform/plans").getStatusCode().value())
            .as("what the platform sells is not a tenant's business")
            .isEqualTo(403);
        assertThat(httpPostAs(ownerToken, "/api/v1/platform/plans",
            Map.of("code", "attacker", "name", "x", "tier", "ENTERPRISE", "pricePaisa", 0,
                   "billingPeriod", "MONTHLY", "trialDays", 0)).getStatusCode().value())
            .as("a tenant minting itself an ENTERPRISE plan is the elevation this gate exists for")
            .isEqualTo(403);
        assertThat(httpPostAs(ownerToken, "/api/v1/platform/plans/growth-monthly/archive", Map.of())
            .getStatusCode().value()).isEqualTo(403);

        assertThat(httpGetAs(superAdminToken(), "/api/v1/platform/plans").getStatusCode().value())
            .as("the negative control: a bug making EVERY request 403 would turn the assertions "
                + "above green")
            .isEqualTo(200);
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────────

    private String superAdminToken() {
        return platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN");
    }

    private UUID provisionStarter(String brand) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        stubProvisioningSagaHappyPath(UUID.randomUUID(), UUID.randomUUID(), "T#plan");
        stubFinanceSeedCoaAnyTenant();
        UUID tenantId = provisioningService
            .provision("plan-" + UUID.randomUUID(), brand + " " + UUID.randomUUID(),
                "admin@plan.local", "STARTER")
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
}
