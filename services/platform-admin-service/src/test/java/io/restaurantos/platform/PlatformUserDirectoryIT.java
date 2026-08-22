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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The cross-tenant user directory ({@code GET /api/v1/platform/users} and the per-tenant list).
 *
 * <h2>What this file exists to pin</h2>
 *
 * <p>There is no cross-tenant user query in this product — {@code auth_db.users} is FORCE row-level
 * security, {@code platform_db} has no bridge to {@code auth_db}, and the only door returns ONE
 * tenant's page. So the fleet list is a fan-out, and every interesting property is about what
 * happens when part of that fan-out fails:
 *
 * <ul>
 *   <li>a complete scan reports an EXACT total;</li>
 *   <li>a scan missing a tenant reports <b>no total at all</b>, names the tenant, and says why.
 *       This is the D-38-16 assertion: a smaller number that looks complete is the one outcome the
 *       scan block exists to refuse, and it is the assertion that would go red if somebody
 *       "simplified" the response by summing what it did manage to read;</li>
 *   <li>the filters are pushed UPSTREAM, not applied here — verified by inspecting the outbound
 *       request, because a filter applied locally produces a total describing a different set from
 *       its own rows;</li>
 *   <li>on the detail, "we could not read the station scopes" and "this user is unrestricted" are
 *       different answers and are not allowed to look the same.</li>
 * </ul>
 *
 * <p>Every test stubs a catch-all empty page for tenants it did not create, so the seeded tenants
 * in this database contribute nothing and the concatenation is deterministic. Tenant order is by
 * SLUG, and the fixtures are named so that order is known in advance.
 */
class PlatformUserDirectoryIT extends BasePlatformIT {

    private static final UUID SUPER_ADMIN_ID = UUID.fromString("eca6bbf2-ce62-5d16-8f4c-d052521d16ad");
    private static final String USERS_PATH = "/internal/auth/users";
    private static final ObjectMapper JSON = new ObjectMapper();

    @BeforeEach
    void everyOtherTenantIsEmpty() {
        // Priority 10: the lowest-priority match, so a per-tenant stub registered by a test always
        // wins. Without this the seeded tenants would 404 on the fan-out and every test in this
        // class would be measuring an "unreachable tenant" it did not create.
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(USERS_PATH))
            .atPriority(10)
            .willReturn(page(List.of(), 0)));
    }

    // ── The single-tenant path ───────────────────────────────────────────────────────────────

    @Test
    void aSingleTenantListIsOneCall_andItsRowsCarryTheTenantTheyBelongTo() {
        UUID tenantId = insertTenant("dir-single");
        stubTenantUsers(tenantId, List.of(user("ann@t.local", "Ann"), user("bob@t.local", "Bob")), 2);

        JsonNode body = get("/api/v1/platform/users?tenantId=" + tenantId);

        assertThat(emailsOf(body)).containsExactly("ann@t.local", "bob@t.local");
        assertThat(body.path("data").path("users").get(0).path("tenantId").asText())
            .isEqualTo(tenantId.toString());
        assertThat(body.path("data").path("users").get(0).path("tenantSlug").asText())
            .as("a cross-tenant grid whose rows say only a user id forces the reader to resolve "
                + "tenant ids by eye; the slug is what an operator recognises")
            .startsWith("dir-single");

        JsonNode scan = body.path("data").path("scan");
        assertThat(scan.path("tenantsMatched").asInt()).isEqualTo(1);
        assertThat(scan.path("truncated").asBoolean()).isFalse();
        assertThat(scan.path("unreachable")).isEmpty();
        assertThat(scan.path("totalCount").asLong()).isEqualTo(2);
    }

    @Test
    void anUnknownTenantIs404_notAnEmptyPage() {
        assertThat(httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
                "/api/v1/platform/users?tenantId=" + UUID.randomUUID())
            .getStatusCode().value())
            .as("on this screen 'no such tenant' and 'that tenant has no users' mean opposite "
                + "things and must not look the same")
            .isEqualTo(404);
    }

    // ── The fan-out ──────────────────────────────────────────────────────────────────────────

    @Test
    void theFleetListConcatenatesTenantsInSlugOrder_andTheTotalIsTheSum() {
        UUID first = insertTenant("dirscan-1");
        UUID second = insertTenant("dirscan-2");
        stubTenantUsers(first, List.of(user("a@one.local", "A")), 1);
        stubTenantUsers(second, List.of(user("b@two.local", "B"), user("c@two.local", "C")), 2);

        JsonNode body = get("/api/v1/platform/users?size=50");

        assertThat(emailsOf(body))
            .as("slug order is what makes offset paging over the concatenation stable — an "
                + "unstable outer order makes page 2 omit and repeat whole tenants")
            .containsExactly("a@one.local", "b@two.local", "c@two.local");

        JsonNode scan = body.path("data").path("scan");
        assertThat(scan.path("totalCount").asLong()).isEqualTo(3);
        assertThat(scan.path("totalCountNote").isNull()).isTrue();
        assertThat(scan.path("tenantsMatched").asInt()).isGreaterThanOrEqualTo(2);
        assertThat(scan.path("tenantsScanned").asInt())
            .isEqualTo(scan.path("tenantsMatched").asInt());
    }

    @Test
    void pagingWalksAcrossATenantBoundaryWithoutOmittingOrRepeatingARow() {
        UUID first = insertTenant("dirpage-1");
        UUID second = insertTenant("dirpage-2");
        stubTenantUsers(first, List.of(user("p1@one.local", "P1"), user("p2@one.local", "P2")), 2);
        stubTenantUsers(second, List.of(user("p3@two.local", "P3"), user("p4@two.local", "P4")), 2);

        List<String> pageOne = emailsOf(get("/api/v1/platform/users?page=0&size=3"));
        List<String> pageTwo = emailsOf(get("/api/v1/platform/users?page=1&size=3"));

        assertThat(pageOne).containsExactly("p1@one.local", "p2@one.local", "p3@two.local");
        assertThat(pageTwo)
            .as("the second page resumes INSIDE the second tenant — the boundary is an offset in "
                + "a concatenation, not a page break")
            .containsExactly("p4@two.local");
        assertThat(pageOne).doesNotContainAnyElementsOf(pageTwo);
    }

    /**
     * The one that matters most. A partial scan must not produce a total that looks whole.
     */
    @Test
    void anUnreachableTenantWithholdsTheTotalEntirely_andIsNamed() {
        UUID reachable = insertTenant("dirfail-1");
        UUID broken = insertTenant("dirfail-2");
        stubTenantUsers(reachable, List.of(user("ok@one.local", "Ok")), 1);
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(USERS_PATH))
            .atPriority(1)
            .withHeader("X-Tenant-Id", WireMock.equalTo(broken.toString()))
            .willReturn(WireMock.aResponse().withStatus(503).withBody("{\"error\":\"down\"}")));

        JsonNode body = get("/api/v1/platform/users?size=50");
        JsonNode scan = body.path("data").path("scan");

        assertThat(emailsOf(body))
            .as("one unreachable tenant must not blank the whole directory")
            .contains("ok@one.local");
        assertThat(scan.path("totalCount").isNull())
            .as("D-38-16: a figure the system cannot compute renders as a stated absence, never as "
                + "a number. Summing what was readable would report a smaller total that a reader "
                + "cannot tell from a complete one")
            .isTrue();
        assertThat(scan.path("totalCountNote").asText()).isNotBlank();

        List<String> unreachableIds = new ArrayList<>();
        scan.path("unreachable").forEach(node -> unreachableIds.add(node.path("tenantId").asText()));
        assertThat(unreachableIds)
            .as("named, not counted — '3 tenants unreachable' says the list is wrong; naming them "
                + "says WHICH restaurant is missing from it")
            .containsExactly(broken.toString());
        assertThat(scan.path("unreachable").get(0).path("tenantSlug").asText())
            .startsWith("dirfail-2");
        assertThat(scan.path("unreachable").get(0).path("detail").asText())
            .as("the upstream status, never a raw exception message — those name the internal "
                + "scheme, host and port")
            .contains("503");
    }

    // ── Filters are pushed upstream ──────────────────────────────────────────────────────────

    @Test
    void everyFilterIsForwardedToTheProducer_notAppliedHere() {
        UUID tenantId = insertTenant("dir-filter");
        stubTenantUsers(tenantId, List.of(user("m@t.local", "M")), 1);

        get("/api/v1/platform/users?tenantId=" + tenantId
            + "&status=LOCKED&roleCode=MANAGER&search=ann");

        WIREMOCK.verify(WireMock.getRequestedFor(WireMock.urlPathEqualTo(USERS_PATH))
            .withHeader("X-Tenant-Id", WireMock.equalTo(tenantId.toString()))
            .withQueryParam("status", WireMock.equalTo("LOCKED"))
            .withQueryParam("roleCode", WireMock.equalTo("MANAGER"))
            .withQueryParam("search", WireMock.equalTo("ann")));
    }

    @Test
    void anUnknownTenantStatusIsRefusedRatherThanIgnored() {
        assertThat(httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"),
                "/api/v1/platform/users?tenantStatus=MOSTLY_FINE").getStatusCode().value())
            .as("a caller who asked for SUSPENDED tenants and received every tenant has been told "
                + "the opposite of the truth and cannot tell")
            .isEqualTo(400);
    }

    // ── Detail ───────────────────────────────────────────────────────────────────────────────

    @Test
    void detailReportsTheTenantTheAssignmentsAndTheOneActivitySignalThatExists() {
        UUID tenantId = insertTenant("dir-detail");
        UUID userId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        stubUserDetail(tenantId, userId, """
            {"data":{"user":{"id":"%s","email":"chef@t.local","fullName":"Chef","locale":"en",
                             "active":true,"mustChangePassword":false,"totpEnabled":false,
                             "lastLoginAt":null,"createdAt":"2026-01-01T00:00:00Z"},
                     "assignments":[{"branchId":"%s","roleCode":"KITCHEN_STAFF","primary":true,
                                     "approvalLimitPaisa":null}]}}"""
            .formatted(userId, branchId));
        stubStations(userId, "[{\"branchId\":\"" + branchId + "\",\"stationCodes\":[\"GRILL\"]}]");

        JsonNode data = get("/api/v1/platform/tenants/" + tenantId + "/users/" + userId)
            .path("data");

        assertThat(data.path("tenant").path("tenantId").asText()).isEqualTo(tenantId.toString());
        assertThat(data.path("tenant").path("status").asText()).isEqualTo("ACTIVE");
        assertThat(data.path("branchRoles").get(0).path("roleCode").asText())
            .isEqualTo("KITCHEN_STAFF");
        assertThat(data.path("stationScopes").get(0).path("stationCodes").get(0).asText())
            .isEqualTo("GRILL");
        assertThat(data.path("stationScopes").get(0).path("unrestricted").asBoolean()).isFalse();

        assertThat(data.path("activity").path("lastLoginAt").isNull()).isTrue();
        assertThat(data.path("activity").path("hasEverSignedIn").asBoolean())
            .as("null lastLoginAt is the STATE 'never signed in' — the shape of a provisioned but "
                + "unused account — and must not render as a blank date")
            .isFalse();
        assertThat(data.path("activity").path("note").asText())
            .as("the standing caveat: attempt-level login history lives in audit_db and the "
                + "platform plane cannot read it")
            .contains("audit_db");
        assertThat(data.path("loginable").asBoolean()).isTrue();
    }

    @Test
    void unreadableStationScopesAreNULL_notAnEmptyListThatWouldReadAsUnrestricted() {
        UUID tenantId = insertTenant("dir-stations-down");
        UUID userId = UUID.randomUUID();
        stubUserDetail(tenantId, userId, minimalUserDetail(userId, true, true));
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(
                "/internal/auth/users/" + userId + "/stations"))
            .willReturn(WireMock.aResponse().withStatus(500).withBody("{\"error\":\"down\"}")));

        JsonNode data = get("/api/v1/platform/tenants/" + tenantId + "/users/" + userId)
            .path("data");

        assertThat(data.path("stationScopes").isNull())
            .as("an EMPTY list means 'unrestricted — this user sees every station at their "
                + "branch'. Rendering an unread value as empty tells an operator a user has full "
                + "station access when nobody knows")
            .isTrue();
        assertThat(data.path("stationScopeNote").asText()).contains("NOT the same as");
    }

    @Test
    void aUserWithNoAssignmentIsReportedUnusable_ratherThanLookingHealthy() {
        UUID tenantId = insertTenant("dir-noroles");
        UUID userId = UUID.randomUUID();
        stubUserDetail(tenantId, userId, minimalUserDetail(userId, true, false));
        stubStations(userId, "[]");

        JsonNode data = get("/api/v1/platform/tenants/" + tenantId + "/users/" + userId)
            .path("data");

        assertThat(data.path("branchRoles")).isEmpty();
        assertThat(data.path("loginable").asBoolean())
            .as("an account with no active assignment looks created and cannot be used — exactly "
                + "the failure blocker B2 was")
            .isFalse();
        assertThat(data.path("loginableNote").asText()).contains("no active branch-role");
    }

    // ── The gate ─────────────────────────────────────────────────────────────────────────────

    @Test
    void aTenantTokenIsRefused_andAnAnonymousCallerToo_andNothingIsDelegated() {
        UUID tenantId = insertTenant("dir-gate");
        stubTenantUsers(tenantId, List.of(user("x@t.local", "X")), 1);

        // A genuinely valid tenant-admin token carrying the strongest tenant permissions there are.
        // It simply is not a platform credential.
        String tenantAdmin = tenantToken(UUID.randomUUID(), tenantId, "TENANT_ADMIN",
            List.of("rbac.manage", "rbac.user.manage", "rbac.role.manage"));

        assertThat(httpGetAs(tenantAdmin, "/api/v1/platform/users?tenantId=" + tenantId)
            .getStatusCode().value()).isEqualTo(403);
        assertThat(httpGet("/api/v1/platform/users?tenantId=" + tenantId)
            .getStatusCode().value()).isEqualTo(401);

        WIREMOCK.verify(0, WireMock.getRequestedFor(WireMock.urlPathEqualTo(USERS_PATH)));
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    private JsonNode get(String uri) {
        ResponseEntity<String> response =
            httpGetAs(platformToken(SUPER_ADMIN_ID, "SUPER_ADMIN"), uri);
        assertThat(response.getStatusCode().value())
            .as("body was: %s", response.getBody())
            .isEqualTo(200);
        return parse(response);
    }

    private void stubTenantUsers(UUID tenantId, List<String> userJson, long totalCount) {
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(USERS_PATH))
            .atPriority(1)
            .withHeader("X-Tenant-Id", WireMock.equalTo(tenantId.toString()))
            .willReturn(page(userJson, totalCount)));
    }

    private void stubUserDetail(UUID tenantId, UUID userId, String body) {
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(USERS_PATH + "/" + userId))
            .withHeader("X-Tenant-Id", WireMock.equalTo(tenantId.toString()))
            .willReturn(WireMock.aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private void stubStations(UUID userId, String body) {
        // Returned UNWRAPPED by AuthInternalController — a bare array, not an ApiResponse envelope.
        // The stub mirrors the producer rather than the convention, because a client that assumes
        // an envelope the producer does not send reads null and reports "no stations", which is a
        // legitimate state and gets triaged as configuration for a week.
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo(
                "/internal/auth/users/" + userId + "/stations"))
            .willReturn(WireMock.aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json").withBody(body)));
    }

    private static com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder page(
            List<String> userJson, long totalCount) {
        return WireMock.aResponse().withStatus(200)
            .withHeader("Content-Type", "application/json")
            .withBody("""
                {"data":[%s],"meta":{"page":{"cursor":"0","nextCursor":null,"limit":200},
                 "totalCount":%d},"warnings":[]}"""
                .formatted(String.join(",", userJson), totalCount));
    }

    private static String user(String email, String fullName) {
        return """
            {"id":"%s","email":"%s","fullName":"%s","locale":"en","active":true,
             "mustChangePassword":false,"totpEnabled":false,"lastLoginAt":null,
             "createdAt":"2026-01-01T00:00:00Z"}"""
            .formatted(UUID.randomUUID(), email, fullName);
    }

    private static String minimalUserDetail(UUID userId, boolean active, boolean withAssignment) {
        String assignments = withAssignment
            ? "[{\"branchId\":\"" + UUID.randomUUID()
                + "\",\"roleCode\":\"CASHIER\",\"primary\":true,\"approvalLimitPaisa\":null}]"
            : "[]";
        return """
            {"data":{"user":{"id":"%s","email":"u@t.local","fullName":"U","locale":"en",
                             "active":%s,"mustChangePassword":false,"totpEnabled":false,
                             "lastLoginAt":null,"createdAt":"2026-01-01T00:00:00Z"},
                     "assignments":%s}}"""
            .formatted(userId, active, assignments);
    }

    /**
     * Slugs are chosen so SLUG ORDER is known in advance — the random suffix comes after the
     * discriminating digit, so {@code dirscan-1-*} always sorts before {@code dirscan-2-*}. A test
     * that asserts concatenation order cannot depend on a random slug.
     */
    private UUID insertTenant(String slugPrefix) {
        TenantEntity tenant = new TenantEntity();
        tenant.setSlug(slugPrefix + "-" + UUID.randomUUID().toString().substring(0, 8));
        tenant.setBrandName("Directory " + tenant.getSlug());
        tenant.setStatus(TenantEntity.TenantStatus.ACTIVE);
        tenant.setTier(TenantEntity.TierType.STARTER);
        return tenantRepository.saveAndFlush(tenant).getId();
    }

    private static List<String> emailsOf(JsonNode body) {
        List<String> emails = new ArrayList<>();
        body.path("data").path("users").forEach(node -> emails.add(node.path("email").asText()));
        return emails;
    }

    private static JsonNode parse(ResponseEntity<String> response) {
        try {
            return JSON.readTree(response.getBody());
        } catch (Exception e) {
            throw new AssertionError("Not JSON: " + response.getBody(), e);
        }
    }
}
