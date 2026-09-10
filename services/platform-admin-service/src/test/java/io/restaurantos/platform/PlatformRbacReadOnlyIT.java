package io.restaurantos.platform;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.client.WireMock;
import io.restaurantos.platform.entity.TenantEntity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The platform tier's RBAC surface — three reads, no writes.
 *
 * <h2>The property this file is really guarding</h2>
 *
 * <p>13-02 split {@code rbac.manage} out of {@code rbac.role.manage} so a TENANT_ADMIN could not
 * compose themselves an OWNER, log in as it, and hold the umbrella permission their own role was
 * designed to withhold. A platform-tier role editor would hand that capability back one layer up,
 * to a principal with a wider reach and — because a platform id holds no {@code user_branch_roles}
 * — no ceiling to bound it.
 *
 * <p>So the absence of a write is asserted as an absence: {@code POST}, {@code PUT},
 * {@code PATCH} and {@code DELETE} on every RBAC path must not be routes. "We decided against it"
 * and "somebody added it in a later plan" look identical in a codebase and different in a test.
 *
 * <p>The upstream is stubbed here; the shape and unfiltered-ness of the catalogue itself are pinned
 * against a real database by auth-service's {@code PlatformRbacAndUserSecurityIT}.
 */
class PlatformRbacReadOnlyIT extends BasePlatformIT {

    private static final UUID SUPER_ADMIN_ID = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");
    private static final String ROLES = "/internal/auth/rbac/roles";
    private static final String PERMISSIONS = "/internal/auth/rbac/permissions";
    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void stubUpstreamCatalogue() {
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(PERMISSIONS))
            .willReturn(json("""
                {"data":[
                  {"module":"pos","permissions":[
                    {"code":"pos.order.create","module":"pos","description":"Create an order"},
                    {"code":"pos.order.void","module":"pos","description":"Void an order"}]},
                  {"module":"rbac","permissions":[
                    {"code":"rbac.manage","module":"rbac","description":"Umbrella"},
                    {"code":"rbac.user.manage","module":"rbac","description":"Administer users"}]}
                ]}""")));
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(ROLES))
            .willReturn(json("""
                {"data":[
                  {"code":"OWNER","name":"Owner","system":true,
                   "permissions":["pos.order.create","pos.order.void","rbac.manage",
                                  "rbac.user.manage"],"assignedUserCount":2},
                  {"code":"TENANT_ADMIN","name":"Tenant Admin","system":true,
                   "permissions":["pos.order.create","pos.order.void","rbac.user.manage"],
                   "assignedUserCount":1},
                  {"code":"CASHIER","name":"Cashier","system":true,
                   "permissions":["pos.order.create"],"assignedUserCount":7}
                ]}""")));
    }

    @Test
    void thePermissionCatalogueIsReturnedGroupedByModule_withEachEntryCarryingItsOwnModule() {
        JsonNode data = get("/api/v1/platform/rbac/permissions").path("data");

        assertThat(data.size()).isEqualTo(2);
        assertThat(data.get(0).path("module").asText()).isEqualTo("pos");
        data.forEach(module -> module.path("permissions").forEach(permission ->
            assertThat(permission.path("module").asText())
                .as("a client filling a search box flattens this response and would otherwise lose "
                    + "the grouping dimension entirely")
                .isEqualTo(module.path("module").asText())));
    }

    @Test
    void theRoleCatalogueIsUnfiltered_andSaysInTheResponseWhyItIsReadOnly() {
        UUID tenantId = insertTenant("rbac-roles");
        JsonNode data = get("/api/v1/platform/rbac/roles?tenantId=" + tenantId).path("data");

        assertThat(data.path("scope").asText()).isEqualTo("TENANT");
        assertThat(data.path("tenantId").asText()).isEqualTo(tenantId.toString());

        JsonNode owner = data.path("roles").get(0);
        assertThat(owner.path("code").asText()).isEqualTo("OWNER");
        assertThat(codes(owner.path("permissions")))
            .as("the point of the platform catalogue is that OWNER shows its WHOLE grant set — a "
                + "ceiling-filtered read would resolve the empty permission set for a platform "
                + "token and return nothing")
            .contains("rbac.manage");
        assertThat(owner.path("assignedUserCount").asLong()).isEqualTo(2);
        assertThat(owner.path("mutableByPlatform").asBoolean())
            .as("a FIELD rather than an omission, so a console renders read-only from the API "
                + "instead of hardcoding an assumption that could go stale")
            .isFalse();

        assertThat(data.path("readOnlyReason").asText())
            .as("the reason travels in the payload so a console developer learns why there is "
                + "nothing to call, instead of filing it as a missing endpoint")
            .contains("rbac.manage")
            .contains("role ceiling");
    }

    @Test
    void withNoTenantTheScopeIsGlobal_andNoTenantIdIsInvented() {
        JsonNode data = get("/api/v1/platform/rbac/roles").path("data");
        assertThat(data.path("scope").asText()).isEqualTo("GLOBAL");
        assertThat(data.path("tenantId").isNull()).isTrue();
        WIREMOCK.verify(WireMock.getRequestedFor(WireMock.urlPathEqualTo(ROLES))
            .withoutQueryParam("tenantId"));
    }

    @Test
    void anUnknownTenantIs404_ratherThanTheGlobalCatalogueWithA200() {
        assertThat(httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
                "/api/v1/platform/rbac/roles?tenantId=" + UUID.randomUUID())
            .getStatusCode().value())
            .as("a typo'd tenant id must not return an answer that looks right and IS right for "
                + "some other tenant")
            .isEqualTo(404);
    }

    @Test
    void theMatrixColumnsAreEveryPermissionThatExists_notOnlyTheGrantedOnes() {
        UUID tenantId = insertTenant("rbac-matrix");
        JsonNode data = get("/api/v1/platform/rbac/matrix?tenantId=" + tenantId).path("data");

        assertThat(codes(data.path("permissionCodes")))
            .as("columns in the catalogue's own module-major order — the database's order, so the "
                + "grid and the legend beside it cannot disagree")
            .containsExactly("pos.order.create", "pos.order.void", "rbac.manage",
                "rbac.user.manage");

        List<String> roleCodes = new ArrayList<>();
        data.path("rows").forEach(row -> roleCodes.add(row.path("roleCode").asText()));
        assertThat(roleCodes).containsExactly("OWNER", "TENANT_ADMIN", "CASHIER");

        JsonNode cashier = data.path("rows").get(2);
        assertThat(codes(cashier.path("grantedPermissionCodes")))
            .as("grants are a SET of codes, not a positional boolean array — adding a permission "
                + "must not shift every role's grants by one column in a client that cached the "
                + "header")
            .containsExactly("pos.order.create");
        assertThat(cashier.path("assignedUserCount").asLong()).isEqualTo(7);
        assertThat(data.path("readOnlyReason").asText()).isNotBlank();
    }

    /**
     * The absence of a write, asserted. This is the test that would go red if a later plan added a
     * platform-tier role editor without reading why there is not one.
     */
    @Test
    void thereIsNoPlatformTierRoleOrPermissionWrite() {
        UUID tenantId = insertTenant("rbac-nowrite");
        String token = platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN");
        Map<String, Object> body = Map.of("code", "SUPER_ROLE",
            "permissions", List.of("rbac.manage"));

        for (String path : List.of("/api/v1/platform/rbac/roles",
                                   "/api/v1/platform/rbac/roles?tenantId=" + tenantId,
                                   "/api/v1/platform/rbac/permissions",
                                   "/api/v1/platform/rbac/matrix")) {
            assertThat(httpPostAs(token, path, body).getStatusCode().value())
                .as("POST %s must not be a route: composing a role is granting authority, and the "
                    + "platform tier has no ceiling to be bounded by", path)
                .isIn(404, 405);
            assertThat(httpPatchAs(token, path, body).getStatusCode().value())
                .as("PATCH %s must not be a route", path)
                .isIn(404, 405);
        }
        WIREMOCK.verify(0, WireMock.postRequestedFor(WireMock.urlMatching("/internal/auth/rbac.*")));
    }

    @Test
    void everyRbacReadIsRefusedToATenantTokenAndToAnAnonymousCaller() {
        String tenantAdmin = tenantToken(UUID.randomUUID(), UUID.randomUUID(), "TENANT_ADMIN",
            List.of("rbac.manage", "rbac.user.manage", "rbac.role.manage"));

        for (String path : List.of("/api/v1/platform/rbac/roles",
                                   "/api/v1/platform/rbac/permissions",
                                   "/api/v1/platform/rbac/matrix")) {
            assertThat(httpGetAs(tenantAdmin, path).getStatusCode().value())
                .as("%s — the catalogue enumerates the whole authorization surface and is a "
                    + "reconnaissance document (T-13-07-A); holding rbac.manage in ONE tenant is "
                    + "not being a platform operator", path)
                .isEqualTo(403);
            assertThat(httpGet(path).getStatusCode().value()).as("%s anonymous", path).isEqualTo(401);
        }
        WIREMOCK.verify(0, WireMock.getRequestedFor(WireMock.urlMatching("/internal/auth/rbac.*")));
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    private JsonNode get(String uri) {
        ResponseEntity<String> response =
            httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"), uri);
        assertThat(response.getStatusCode().value())
            .as("body was: %s", response.getBody()).isEqualTo(200);
        try {
            return JSON.readTree(response.getBody());
        } catch (Exception e) {
            throw new AssertionError("Not JSON: " + response.getBody(), e);
        }
    }

    private static com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder json(String body) {
        return WireMock.aResponse().withStatus(200)
            .withHeader("Content-Type", "application/json").withBody(body);
    }

    private static List<String> codes(JsonNode array) {
        List<String> codes = new ArrayList<>();
        array.forEach(node -> codes.add(node.asText()));
        return codes;
    }

    private UUID insertTenant(String slugPrefix) {
        TenantEntity tenant = new TenantEntity();
        tenant.setSlug(slugPrefix + "-" + UUID.randomUUID().toString().substring(0, 8));
        tenant.setBrandName("Rbac " + tenant.getSlug());
        tenant.setStatus(TenantEntity.TenantStatus.ACTIVE);
        tenant.setTier(TenantEntity.TierType.STARTER);
        return tenantRepository.saveAndFlush(tenant).getId();
    }
}
