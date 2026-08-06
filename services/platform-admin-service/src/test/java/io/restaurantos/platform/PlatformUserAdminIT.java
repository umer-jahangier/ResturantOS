package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.entity.TenantEntity;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Platform-tier password reset (13-13, D-16) — {@link
 * io.restaurantos.platform.controller.PlatformUserAdminController}.
 *
 * <h2>What this file asserts, and what it deliberately does not</h2>
 *
 * <p>The reset itself belongs to auth-service and is pinned there by {@code AdminPasswordResetIT}
 * (7 tests) and live. What is asserted here is the half platform-admin-service owns and the only
 * half it CAN own:
 *
 * <ul>
 *   <li><b>WHO</b> is forwarded — the subject of the verified control-plane token, never a body
 *       field. This is the assertion that would go red if 13-14's D-34 defect were reintroduced in
 *       a new place;</li>
 *   <li><b>which tier</b> is asserted — the constant {@code PLATFORM}, which is what exempts the
 *       call from the role ceiling upstream. A caller who could set it could switch the ceiling
 *       off;</li>
 *   <li><b>who may call it</b> — a tenant token, however valid, is refused, and so is an
 *       anonymous one;</li>
 *   <li><b>what a refusal looks like</b> — an upstream 404 must not arrive as a 500. This service
 *       had no Feign error handling at all before 13-13, so the hole 13-12 closed in user-service
 *       was open here the moment platform-admin grew a delegating write.</li>
 * </ul>
 *
 * <p>The tenant token used below is a <b>real, valid, signature-verified</b> credential carrying a
 * genuine tenant-admin permission set. A test that presented a malformed token would prove the
 * signature check works, not the authority gate.
 */
class PlatformUserAdminIT extends BasePlatformIT {

    private static final UUID SUPER_ADMIN_ID = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");
    private static final UUID TARGET_USER_ID = UUID.fromString("c0000002-0000-4000-8000-000000000002");
    private static final String RESET_PATH_PATTERN = "/internal/auth/users/.*/password-reset";

    @Test
    void aSuperAdminResetsATenantAdmin_andTheActorForwardedIsTheVerifiedPlatformPrincipal() {
        UUID tenantId = insertTenant("platform-reset-a");
        stubUpstreamReset(200, resetBody());

        ResponseEntity<String> res = httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            resetUri(tenantId, TARGET_USER_ID),
            Map.of("reason", "tenant lost its owner password"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("\"tempPassword\":\"zEHaY&6?CzqWe8p2\"");
        assertThat(res.getBody())
            .as("the forced-change flag bounds the temporary credential's life")
            .contains("\"mustChangePassword\":true");

        WIREMOCK.verify(WireMock.postRequestedFor(
                WireMock.urlPathEqualTo("/internal/auth/users/" + TARGET_USER_ID + "/password-reset"))
            .withHeader("X-Tenant-Id", WireMock.equalTo(tenantId.toString()))
            .withHeader("X-Acting-User-Id", WireMock.equalTo(SUPER_ADMIN_ID.toString()))
            .withRequestBody(WireMock.matching("(?s).*\"actorTier\":\"PLATFORM\".*"))
            .withRequestBody(WireMock.matching("(?s).*\"reason\":\"tenant lost its owner password\".*")));
    }

    /**
     * The one that would catch D-34 reappearing here: the caller names somebody else, and the
     * somebody else must not reach the audit trail in any position.
     */
    @Test
    void theActingAdministratorIsNeverTakenFromTheRequestBody() {
        UUID tenantId = insertTenant("platform-reset-spoof");
        UUID impostor = UUID.fromString("dddddddd-0000-4000-8000-00000000dddd");
        stubUpstreamReset(200, resetBody());

        httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            resetUri(tenantId, TARGET_USER_ID),
            Map.of("reason", "spoof attempt",
                   "actingUserId", impostor.toString(),
                   "actingPlatformUserId", impostor.toString(),
                   "actorTier", "TENANT"));

        WIREMOCK.verify(WireMock.postRequestedFor(WireMock.urlMatching(RESET_PATH_PATTERN))
            .withHeader("X-Acting-User-Id", WireMock.equalTo(SUPER_ADMIN_ID.toString()))
            .withRequestBody(WireMock.matching("(?s).*\"actorTier\":\"PLATFORM\".*")));
        WIREMOCK.verify(0, WireMock.anyRequestedFor(WireMock.anyUrl())
            .withRequestBody(WireMock.matching("(?s).*" + impostor + ".*")));
        WIREMOCK.verify(0, WireMock.anyRequestedFor(WireMock.anyUrl())
            .withHeader("X-Acting-User-Id", WireMock.equalTo(impostor.toString())));
    }

    @Test
    void aTenantTokenIsRefused_andAnAnonymousCallerToo_andNothingIsDelegated() {
        UUID tenantId = insertTenant("platform-reset-gate");
        stubUpstreamReset(200, resetBody());

        // A genuinely valid tenant-admin token: signed by the same key, verified for real, carrying
        // the strongest tenant permission there is. It simply is not a platform credential.
        String tenantAdmin = tenantToken(UUID.randomUUID(), tenantId, "TENANT_ADMIN",
            List.of("rbac.manage", "rbac.user.manage", "rbac.role.manage"));

        assertThat(httpPostAs(tenantAdmin, resetUri(tenantId, TARGET_USER_ID),
                Map.of("reason", "not mine to do")).getStatusCode().value())
            .as("a tenant token, however privileged inside its tenant, is not a platform one")
            .isEqualTo(403);
        assertThat(httpPost(resetUri(tenantId, TARGET_USER_ID), Map.of("reason", "anonymous"))
            .getStatusCode().value())
            .isEqualTo(401);

        // A refusal must be a refusal, not a request that reached auth-service and was answered
        // there. Nothing was delegated by either.
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlMatching(RESET_PATH_PATTERN)));
    }

    @Test
    void aResetWithoutAReasonIsRefused_andNothingIsDelegated() {
        UUID tenantId = insertTenant("platform-reset-noreason");
        stubUpstreamReset(200, resetBody());

        assertThat(httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
                resetUri(tenantId, TARGET_USER_ID), Map.of()).getStatusCode().value())
            .as("every reset is audited by actor, target and reason (T-13-13-E)")
            .isEqualTo(400);
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlMatching(RESET_PATH_PATTERN)));
    }

    /**
     * An unknown tenant is refused HERE, before the upstream is called at all — otherwise a
     * well-formed but wrong tenant id produces a call that quietly resets nothing.
     */
    @Test
    void anUnknownTenantIs404_beforeAnythingIsDelegated() {
        stubUpstreamReset(200, resetBody());

        assertThat(httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
                resetUri(UUID.randomUUID(), TARGET_USER_ID), Map.of("reason", "no such tenant"))
            .getStatusCode().value())
            .isEqualTo(404);
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlMatching(RESET_PATH_PATTERN)));
    }

    /**
     * The hole 13-12 closed in user-service, closed here too.
     *
     * <p>platform-admin-service had no Feign error handling of any kind, so an upstream refusal was
     * an ordinary {@code RuntimeException} to shared-lib's catch-all and came back as
     * <b>500 INTERNAL_ERROR</b> — making "that user is not in that tenant" indistinguishable from
     * "the platform is broken", to the operator and on a dashboard alike.
     */
    @Test
    void anUpstreamRefusalKeepsItsStatusAndCodeAndLeaksNothingInternal() {
        UUID tenantId = insertTenant("platform-reset-404");
        stubUpstreamReset(404, """
            {"error":{"code":"NOT_FOUND","message":"User not found: %s","details":[],"traceId":"t"}}"""
            .formatted(TARGET_USER_ID));

        ResponseEntity<String> res = httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            resetUri(tenantId, TARGET_USER_ID), Map.of("reason", "wrong tenant"));

        assertThat(res.getStatusCode().value()).isEqualTo(404);
        assertThat(res.getBody()).contains("NOT_FOUND");
        // FeignException.getMessage() names the internal scheme, host, port and path. It is logged,
        // never returned.
        assertThat(res.getBody()).doesNotContain("/internal/auth");
        assertThat(res.getBody()).doesNotContain("127.0.0.1");
        assertThat(res.getBody()).doesNotContain("AuthInternalClient");
    }

    /**
     * And the other direction, which matters just as much: a server fault must never be reported as
     * a client fault. Downgrading it tells the operator to rewrite a correct request forever and
     * removes a real outage from every 5xx alert in the platform.
     */
    @Test
    void anUpstreamFaultIsA502_neverA4xx() {
        UUID tenantId = insertTenant("platform-reset-502");
        stubUpstreamReset(500, """
            {"error":{"code":"INTERNAL_ERROR","message":"boom","details":[],"traceId":"t"}}""");

        ResponseEntity<String> res = httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            resetUri(tenantId, TARGET_USER_ID), Map.of("reason", "upstream is down"));

        assertThat(res.getStatusCode().value()).isEqualTo(502);
        assertThat(res.getBody()).contains("UPSTREAM_ERROR");
    }

    /**
     * A 403 that describes OUR misconfiguration is not echoed at the operator either. Asking an
     * authenticated SuperAdmin to go and obtain an authority, over a fault they cannot see and
     * cannot fix, is worse than telling them the platform failed — because it is not true.
     */
    @Test
    void anUpstreamRefusalOfOurOwnCredentialsIsA502_notA403() {
        UUID tenantId = insertTenant("platform-reset-misconfig");
        stubUpstreamReset(403, """
            {"error":{"code":"ACTING_USER_REQUIRED","message":"…","details":[],"traceId":"t"}}""");

        ResponseEntity<String> res = httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            resetUri(tenantId, TARGET_USER_ID), Map.of("reason", "our bug, not theirs"));

        assertThat(res.getStatusCode().value()).isEqualTo(502);
        assertThat(res.getBody()).contains("UPSTREAM_ERROR");
        assertThat(res.getBody()).doesNotContain("ACTING_USER_REQUIRED");
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    private static String resetUri(UUID tenantId, UUID userId) {
        return "/api/v1/platform/tenants/" + tenantId + "/users/" + userId + "/reset-password";
    }

    private void stubUpstreamReset(int status, String body) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlMatching(RESET_PATH_PATTERN))
            .willReturn(WireMock.aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json")
                .withBody(body)));
    }

    private static String resetBody() {
        return """
            {"data":{"userId":"%s","email":"owner@t.local","tempPassword":"zEHaY&6?CzqWe8p2",
                     "mustChangePassword":true},"meta":null,"warnings":[]}"""
            .formatted(TARGET_USER_ID);
    }

    /**
     * A tenant row, written directly rather than provisioned through the saga.
     *
     * <p>This suite is about the reset endpoint, and running six stubbed sagas to obtain six tenant
     * ids would make every test here depend on provisioning's behaviour — which
     * {@code ProvisioningSagaIT} already owns, and whose failure would be reported by this file as
     * a reset defect.
     */
    private UUID insertTenant(String slugPrefix) {
        TenantEntity tenant = new TenantEntity();
        tenant.setSlug(slugPrefix + "-" + UUID.randomUUID().toString().substring(0, 8));
        tenant.setBrandName("Platform Reset " + tenant.getSlug());
        tenant.setStatus(TenantEntity.TenantStatus.ACTIVE);
        tenant.setTier(TenantEntity.TierType.STARTER);
        return tenantRepository.saveAndFlush(tenant).getId();
    }
}
