package io.restaurantos.platform;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.entity.TenantEntity;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The platform-tier lifecycle mutations on a tenant user: deactivate, reactivate, unlock,
 * revoke-sessions — and the audit row every one of them writes.
 *
 * <h2>What this file owns, and what it does not</h2>
 *
 * <p>The mutations themselves belong to auth-service and are pinned there by
 * {@code PlatformRbacAndUserSecurityIT} against a real database — including the role-ceiling
 * exemption, which is the security-interesting half and cannot be measured through a stub. What is
 * asserted here is the half platform-admin-service owns:
 *
 * <ul>
 *   <li><b>WHO</b> is forwarded — the subject of the verified control-plane token, never a body
 *       field. The same assertion {@code PlatformUserAdminIT} makes about the reset, extended to
 *       the four operations added since, because D-34 reappearing in a NEW place is the likely
 *       shape of that defect returning;</li>
 *   <li><b>which door</b> is used — {@code /internal/auth/platform/users/...}, not the tenant-tier
 *       path. That is what makes the ceiling exemption structural rather than a body flag, and a
 *       regression to the tenant path would silently start failing every real account;</li>
 *   <li><b>the audit row</b>, on success AND on refusal. A trail of successes cannot show an
 *       operator repeatedly attempting something they are refused, which is the pattern an abuse
 *       review looks for;</li>
 *   <li><b>the mandatory reason</b>, and that a refusal delegates nothing.</li>
 * </ul>
 */
class PlatformUserLifecycleIT extends BasePlatformIT {

    private static final UUID SUPER_ADMIN_ID = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");
    private static final UUID TARGET = UUID.fromString("c0000002-0000-4000-8000-000000000002");
    private static final String PLATFORM_PATH = "/internal/auth/platform/users/";
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test
    void deactivateGoesThroughThePlatformDoorAndForwardsTheVerifiedPrincipal() {
        UUID tenantId = insertTenant("life-deact");
        stubPlatformWrite("deactivate", 200, userDetailBody(false));

        ResponseEntity<String> res = post(tenantId, "deactivate", Map.of("reason", "fraud review"));

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        WIREMOCK.verify(WireMock.postRequestedFor(
                WireMock.urlPathEqualTo(PLATFORM_PATH + TARGET + "/deactivate"))
            .withHeader("X-Tenant-Id", WireMock.equalTo(tenantId.toString()))
            .withHeader("X-Acting-User-Id", WireMock.equalTo(SUPER_ADMIN_ID.toString())));
        // The tenant-tier door keeps its role ceiling and must not be the one used: a platform id
        // resolves the empty permission set there and would be refused for every real account.
        WIREMOCK.verify(0, WireMock.postRequestedFor(
            WireMock.urlPathEqualTo("/internal/auth/users/" + TARGET + "/deactivate")));

        assertThat(auditRow(tenantId, "USER_DEACTIVATED"))
            .containsEntry("outcome", "SUCCEEDED")
            .containsEntry("reason", "fraud review")
            .containsEntry("platform_user_id", SUPER_ADMIN_ID)
            .containsEntry("target_user_id", TARGET);
    }

    @Test
    void theActingAdministratorIsNeverTakenFromTheRequestBody() {
        UUID tenantId = insertTenant("life-spoof");
        UUID impostor = UUID.fromString("dddddddd-0000-4000-8000-00000000dddd");
        stubPlatformWrite("deactivate", 200, userDetailBody(false));

        post(tenantId, "deactivate", Map.of(
            "reason", "spoof attempt",
            "actingUserId", impostor.toString(),
            "actingPlatformUserId", impostor.toString(),
            "platformUserId", impostor.toString()));

        WIREMOCK.verify(WireMock.postRequestedFor(WireMock.urlMatching(PLATFORM_PATH + ".*"))
            .withHeader("X-Acting-User-Id", WireMock.equalTo(SUPER_ADMIN_ID.toString())));
        WIREMOCK.verify(0, WireMock.anyRequestedFor(WireMock.anyUrl())
            .withHeader("X-Acting-User-Id", WireMock.equalTo(impostor.toString())));
        assertThat(auditRow(tenantId, "USER_DEACTIVATED"))
            .as("a repudiation control whose subject can choose what it says is not one")
            .containsEntry("platform_user_id", SUPER_ADMIN_ID);
    }

    @Test
    void everyLifecycleActionRequiresAReason_andDelegatesNothingWithoutOne() {
        UUID tenantId = insertTenant("life-noreason");
        for (String verb : List.of("deactivate", "reactivate", "unlock", "revoke-sessions")) {
            stubPlatformWrite(verb, 200, userDetailBody(true));
            assertThat(post(tenantId, verb, Map.of()).getStatusCode().value())
                .as("%s without a reason", verb).isEqualTo(400);
            assertThat(post(tenantId, verb, Map.of("reason", "   ")).getStatusCode().value())
                .as("%s with a blank reason — a body of spaces is not a reason", verb)
                .isEqualTo(400);
        }
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlMatching(PLATFORM_PATH + ".*")));
        assertThat(auditCount(tenantId)).isZero();
    }

    @Test
    void anUnknownTenantIs404_delegatesNothing_andIsSTILLAudited() {
        UUID unknown = UUID.randomUUID();
        stubPlatformWrite("deactivate", 200, userDetailBody(false));

        assertThat(post(unknown, "deactivate", Map.of("reason", "no such tenant"))
            .getStatusCode().value()).isEqualTo(404);
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlMatching(PLATFORM_PATH + ".*")));

        assertThat(auditRow(unknown, "USER_DEACTIVATED"))
            .as("an operator repeatedly aiming at ids that do not resolve is exactly the pattern "
                + "an abuse review looks for; a trail of successes cannot show it")
            .containsEntry("outcome", "REFUSED");
    }

    @Test
    void anUpstreamRefusalKeepsItsStatus_andIsRecordedAsARefusal() {
        UUID tenantId = insertTenant("life-upstream404");
        stubPlatformWrite("deactivate", 404,
            "{\"error\":{\"code\":\"NOT_FOUND\",\"message\":\"User not found\",\"traceId\":\"t\"}}");

        ResponseEntity<String> res = post(tenantId, "deactivate", Map.of("reason", "wrong user"));

        assertThat(res.getStatusCode().value())
            .as("'that user is not in that tenant' must not be indistinguishable from 'the "
                + "platform is broken'")
            .isEqualTo(404);
        assertThat(res.getBody()).contains("NOT_FOUND");
        assertThat(res.getBody()).doesNotContain("/internal/auth");
        assertThat(res.getBody()).doesNotContain("127.0.0.1");

        var row = auditRow(tenantId, "USER_DEACTIVATED");
        assertThat(row).containsEntry("outcome", "REFUSED");
        assertThat(String.valueOf(row.get("detail"))).contains("404");
    }

    @Test
    void unlockAndRevokeSessionsReportStateRatherThanBareSuccess() {
        UUID tenantId = insertTenant("life-security");
        stubPlatformWrite("unlock", 200, """
            {"data":{"userId":"%s","email":"o@t.local","active":true,"lockedUntil":null,
                     "failedLoginCount":0,"sessionsRevoked":0}}""".formatted(TARGET));
        stubPlatformWrite("revoke-sessions", 200, """
            {"data":{"userId":"%s","email":"o@t.local","active":true,"lockedUntil":null,
                     "failedLoginCount":0,"sessionsRevoked":3}}""".formatted(TARGET));

        JsonNode unlocked = parse(post(tenantId, "unlock", Map.of("reason", "user called in")));
        assertThat(unlocked.path("data").path("lockedUntil").isNull())
            .as("null lockedUntil is the state 'not locked', not a missing value").isTrue();
        assertThat(unlocked.path("data").path("active").asBoolean())
            .as("clearing a cooldown is not disabling an account").isTrue();

        JsonNode revoked = parse(post(tenantId, "revoke-sessions",
            Map.of("reason", "laptop stolen")));
        assertThat(revoked.path("data").path("sessionsRevoked").asInt()).isEqualTo(3);

        assertThat(String.valueOf(auditRow(tenantId, "USER_SESSIONS_REVOKED").get("detail")))
            .as("the platform_admin_audit row is the ONLY record of these two — neither publishes "
                + "a tenant-side event, and that asymmetry is stated rather than hidden")
            .contains("sessionsRevoked=3");
        assertThat(auditRow(tenantId, "USER_UNLOCKED")).containsEntry("outcome", "SUCCEEDED");
    }

    @Test
    void noAuditRowEverCarriesACredential() {
        UUID tenantId = insertTenant("life-nocreds");
        WIREMOCK.stubFor(WireMock.post(WireMock.urlMatching("/internal/auth/users/.*/password-reset"))
            .willReturn(WireMock.aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("""
                    {"data":{"userId":"%s","email":"o@t.local","tempPassword":"zEHaY&6?CzqWe8p2",
                             "mustChangePassword":true}}""".formatted(TARGET))));

        ResponseEntity<String> res = httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
            "/api/v1/platform/tenants/" + tenantId + "/users/" + TARGET + "/reset-password",
            Map.of("reason", "owner locked out"));
        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("zEHaY&6?CzqWe8p2");

        var row = auditRow(tenantId, "USER_PASSWORD_RESET");
        assertThat(row).containsEntry("outcome", "SUCCEEDED");
        assertThat(String.valueOf(row.get("detail")))
            .as("platform_admin_audit is plain text that nothing purges — the same property that "
                + "keeps a credential out of idempotency_keys.response_json (13-10)")
            .doesNotContain("zEHaY")
            .contains("mustChangePassword=true");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM platform_admin_audit WHERE detail LIKE '%zEHaY%' "
                    + "OR reason LIKE '%zEHaY%'", Long.class))
            .isZero();
    }

    /** The trail must survive the people it holds accountable — changeset 050, layer 2. */
    @Test
    void auditRowsCannotBeRewrittenOrDeleted() {
        UUID tenantId = insertTenant("life-immutable");
        stubPlatformWrite("deactivate", 200, userDetailBody(false));
        post(tenantId, "deactivate", Map.of("reason", "will try to erase this"));

        assertThatThrows(() -> jdbc.update(
            "UPDATE platform_admin_audit SET reason = 'routine' WHERE tenant_id = ?", tenantId));
        assertThatThrows(() -> jdbc.update(
            "DELETE FROM platform_admin_audit WHERE tenant_id = ?", tenantId));
        assertThatThrows(() -> jdbc.execute("TRUNCATE platform_admin_audit"));

        assertThat(auditCount(tenantId)).isEqualTo(1);
    }

    @Test
    void everyLifecycleEndpointIsRefusedToATenantTokenAndToAnAnonymousCaller() {
        UUID tenantId = insertTenant("life-gate");
        String tenantAdmin = tenantToken(UUID.randomUUID(), tenantId, "TENANT_ADMIN",
            List.of("rbac.manage", "rbac.user.manage", "rbac.role.manage"));

        for (String verb : List.of("deactivate", "reactivate", "unlock", "revoke-sessions")) {
            stubPlatformWrite(verb, 200, userDetailBody(true));
            String uri = uri(tenantId, verb);
            assertThat(httpPostAs(tenantAdmin, uri, Map.of("reason", "not mine to do"))
                .getStatusCode().value()).as("%s with a tenant token", verb).isEqualTo(403);
            assertThat(httpPost(uri, Map.of("reason", "anonymous")).getStatusCode().value())
                .as("%s anonymous", verb).isEqualTo(401);
        }
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlMatching(PLATFORM_PATH + ".*")));
        assertThat(auditCount(tenantId))
            .as("a refusal at the gate never reached the service, so there is nothing to record")
            .isZero();
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    private ResponseEntity<String> post(UUID tenantId, String verb, Object body) {
        return httpPostAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"), uri(tenantId, verb), body);
    }

    private static String uri(UUID tenantId, String verb) {
        return "/api/v1/platform/tenants/" + tenantId + "/users/" + TARGET + "/" + verb;
    }

    private void stubPlatformWrite(String verb, int status, String body) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo(PLATFORM_PATH + TARGET + "/" + verb))
            .willReturn(WireMock.aResponse().withStatus(status)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static String userDetailBody(boolean active) {
        return """
            {"data":{"user":{"id":"%s","email":"o@t.local","fullName":"Owner","locale":"en",
                             "active":%s,"mustChangePassword":false,"totpEnabled":false,
                             "lastLoginAt":null,"createdAt":"2026-01-01T00:00:00Z"},
                     "assignments":[]}}""".formatted(TARGET, active);
    }

    private Map<String, Object> auditRow(UUID tenantId, String action) {
        List<Map<String, Object>> rows = jdbc.queryForList(
            "SELECT * FROM platform_admin_audit WHERE tenant_id = ? AND action = ? "
                + "ORDER BY occurred_at DESC", tenantId, action);
        assertThat(rows).as("expected an audit row for %s on tenant %s", action, tenantId)
            .isNotEmpty();
        return rows.get(0);
    }

    private long auditCount(UUID tenantId) {
        return jdbc.queryForObject(
            "SELECT count(*) FROM platform_admin_audit WHERE tenant_id = ?", Long.class, tenantId);
    }

    private static void assertThatThrows(Runnable action) {
        try {
            action.run();
            throw new AssertionError("expected the append-only trigger to refuse this statement");
        } catch (AssertionError rethrow) {
            throw rethrow;
        } catch (RuntimeException expected) {
            assertThat(expected.getMessage()).contains("PLATFORM_ADMIN_AUDIT_IMMUTABLE");
        }
    }

    private UUID insertTenant(String slugPrefix) {
        TenantEntity tenant = new TenantEntity();
        tenant.setSlug(slugPrefix + "-" + UUID.randomUUID().toString().substring(0, 8));
        tenant.setBrandName("Lifecycle " + tenant.getSlug());
        tenant.setStatus(TenantEntity.TenantStatus.ACTIVE);
        tenant.setTier(TenantEntity.TierType.STARTER);
        return tenantRepository.saveAndFlush(tenant).getId();
    }

    private static JsonNode parse(ResponseEntity<String> response) {
        try {
            return JSON.readTree(response.getBody());
        } catch (Exception e) {
            throw new AssertionError("Not JSON: " + response.getBody(), e);
        }
    }
}
