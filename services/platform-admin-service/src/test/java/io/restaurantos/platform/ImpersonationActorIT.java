package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.service.ProvisioningService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * D-34 — the impersonation audit trail names the REAL platform actor.
 *
 * <p><b>The defect.</b> Both impersonation controllers passed {@code req.targetUserId()} in the
 * acting-administrator position. {@code ImpersonationService}'s parameters were correctly named, so
 * nothing about the call site looked wrong — but every {@code impersonation_log} row said the
 * impersonated user had impersonated themselves, and the {@code impersonated_by} claim on the issued
 * token said the same. The audit's phrasing is that the trail could not answer who impersonated
 * whom.
 *
 * <p><b>Why these assertions and not others.</b> A one-line caller fix is exactly the kind that is
 * made without a test, so each case here is written so that reverting the fix turns it red:
 * <ul>
 *   <li>the persisted row's acting column equals the SuperAdmin id AND differs from the target;</li>
 *   <li>the {@code impersonatedBy} auth-service is told to stamp into the token is likewise the
 *       SuperAdmin. That request body is what determines the token's claim —
 *       {@code JwtSigningService.signImpersonationToken} stamps what it is given — so asserting it
 *       here and asserting the decoded claim live in {@code phase13-subscription-e2e.sh} covers both
 *       halves without a stub pretending to be a signer;</li>
 *   <li>the acting id comes from the VERIFIED token, so a caller cannot name someone else;</li>
 *   <li>with no resolvable platform principal, and on the internal channel with no acting id
 *       supplied, the operation is refused rather than defaulted to anything.</li>
 * </ul>
 */
class ImpersonationActorIT extends BasePlatformIT {

    @Autowired ProvisioningService provisioningService;

    private static final UUID SUPER_ADMIN_ID = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");

    @Test
    void impersonating_recordsTheAuthenticatedSuperAdminAsTheActor_notTheTarget() {
        UUID tenantId = provisionTenant("Impersonation Actor");
        UUID targetUserId = UUID.randomUUID();
        stubAuthImpersonate();

        var res = httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/impersonate",
            Map.of("tenantId", tenantId.toString(),
                   "targetUserId", targetUserId.toString(),
                   "reason", "customer reported a broken report"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);

        // Read the PERSISTED row. The defect was that the wrong value was written, so a response
        // assertion would not have caught it.
        Map<String, Object> row = jdbc.queryForMap(
            "SELECT platform_user_id, target_user_id FROM impersonation_log WHERE tenant_id = ?",
            tenantId);

        assertThat(row.get("platform_user_id"))
            .as("the acting administrator is the authenticated SuperAdmin")
            .isEqualTo(SUPER_ADMIN_ID);
        assertThat(row.get("target_user_id")).isEqualTo(targetUserId);
        assertThat(row.get("platform_user_id"))
            .as("...and is a DIFFERENT id from the target — the whole of D-34 in one line")
            .isNotEqualTo(row.get("target_user_id"));
    }

    @Test
    void theTokenAuthServiceIsAskedToMint_carriesTheSuperAdminAsImpersonatedBy() {
        UUID tenantId = provisionTenant("Impersonation Claim");
        UUID targetUserId = UUID.randomUUID();
        stubAuthImpersonate();

        httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/impersonate",
            Map.of("tenantId", tenantId.toString(),
                   "targetUserId", targetUserId.toString(),
                   "reason", "why"));

        var requests = WIREMOCK.findAll(WireMock.postRequestedFor(
            WireMock.urlPathEqualTo("/internal/auth/users/" + targetUserId + "/impersonate")));
        assertThat(requests).hasSize(1);
        String body = requests.get(0).getBodyAsString();

        assertThat(body)
            .as("signImpersonationToken stamps the id it is given into impersonated_by, so this "
                + "body IS the token's acting claim")
            .contains("\"impersonatedBy\":\"" + SUPER_ADMIN_ID + "\"")
            .doesNotContain("\"impersonatedBy\":\"" + targetUserId + "\"");
    }

    @Test
    void theActingIdComesFromTheToken_notFromTheRequestBody() {
        UUID tenantId = provisionTenant("Impersonation Body Ignored");
        UUID targetUserId = UUID.randomUUID();
        UUID someoneElse  = UUID.randomUUID();
        stubAuthImpersonate();

        // A caller naming a different administrator in the body must not be believed: a repudiation
        // control whose subject can choose the name on the record is not a control.
        httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/impersonate",
            Map.of("tenantId", tenantId.toString(),
                   "targetUserId", targetUserId.toString(),
                   "actingAdminUserId", someoneElse.toString(),
                   "reason", "attempted attribution to someone else"));

        Map<String, Object> row = jdbc.queryForMap(
            "SELECT platform_user_id FROM impersonation_log WHERE tenant_id = ?", tenantId);
        assertThat(row.get("platform_user_id")).isEqualTo(SUPER_ADMIN_ID);
        assertThat(row.get("platform_user_id")).isNotEqualTo(someoneElse);
    }

    @Test
    void theInternalEndpointRefusesWhenNoActingAdministratorIsSupplied() {
        UUID tenantId = provisionTenant("Impersonation Internal Refusal");
        UUID targetUserId = UUID.randomUUID();
        stubAuthImpersonate();

        var res = httpPostInternal("/internal/platform/tenants/" + tenantId + "/impersonate",
            Map.of("tenantId", tenantId.toString(),
                   "targetUserId", targetUserId.toString(),
                   "reason", "no actor named"));

        assertThat(res.getStatusCode().value())
            .as("the internal channel has no token to read the actor from, so it must be told — "
                + "and inferring it from the target is precisely the defect")
            .isEqualTo(400);
        assertThat(res.getBody()).contains("actingAdminUserId");

        Integer rows = jdbc.queryForObject(
            "SELECT count(*) FROM impersonation_log WHERE tenant_id = ?", Integer.class, tenantId);
        assertThat(rows).as("a refused impersonation writes no audit row").isZero();
    }

    @Test
    void theServiceRefusesAnActingIdEqualToTheTarget_evenIfACallerEverPassesOneAgain() {
        UUID tenantId = provisionTenant("Impersonation Self");
        UUID sameId = UUID.randomUUID();
        stubAuthImpersonate();

        var res = httpPostInternal("/internal/platform/tenants/" + tenantId + "/impersonate",
            Map.of("tenantId", tenantId.toString(),
                   "targetUserId", sameId.toString(),
                   "actingAdminUserId", sameId.toString(),
                   "reason", "the exact shape of the D-34 bug"));

        assertThat(res.getStatusCode().value()).isEqualTo(400);
        Integer rows = jdbc.queryForObject(
            "SELECT count(*) FROM impersonation_log WHERE tenant_id = ?", Integer.class, tenantId);
        assertThat(rows).isZero();
    }

    @Test
    void aTenantTokenCannotImpersonateAtAll() {
        UUID tenantId = provisionTenant("Impersonation Gate");
        String ownerToken = tenantToken(UUID.randomUUID(), tenantId, "OWNER", List.of("rbac.manage"));
        stubAuthImpersonate();

        var res = httpPostAs(ownerToken, "/api/v1/platform/tenants/" + tenantId + "/impersonate",
            Map.of("tenantId", tenantId.toString(),
                   "targetUserId", UUID.randomUUID().toString(),
                   "reason", "nope"));

        assertThat(res.getStatusCode().value()).isEqualTo(403);
    }

    // --- Helpers ---

    private void stubAuthImpersonate() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/auth/users/.*/impersonate"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"token\":\"stub.impersonation.token\",\"expiresIn\":1800}}")));
    }

    private UUID provisionTenant(String brand) {
        WIREMOCK.resetAll();
        wireMockStubJwks();
        stubProvisioningSagaHappyPath(UUID.randomUUID(), UUID.randomUUID(), "T#123");
        stubFinanceSeedCoaAnyTenant();
        return provisioningService.provision("imp-" + UUID.randomUUID(),
            brand + " " + UUID.randomUUID(), "admin@imp.local", "STARTER").tenantId();
    }
}
