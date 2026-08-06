package io.restaurantos.user.integration;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import io.jsonwebtoken.Jwts;
import io.restaurantos.user.BaseUserIT;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.absent;
import static com.github.tomakehurst.wiremock.client.WireMock.anyRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.anyUrl;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.getRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.matching;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlMatching;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.verify;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * The public tenant-admin user surface, end to end through the real filter chain (blocker B3).
 *
 * <h2>Why these tests carry a real signed JWT rather than a mocked SecurityContext</h2>
 *
 * <p>Three of the eight behaviours are <em>about</em> the filter chain: 401 for an anonymous
 * caller, 403 for an authenticated one without the authority, and — the important one — the tenant
 * being taken from the verified token and from nowhere a client can reach. A test that installs an
 * {@code Authentication} directly asserts none of them: it cannot fail if
 * {@code JwtAuthenticationFilter} stops populating {@code TenantContext}, which is the single
 * failure that would make every endpoint here scope to the wrong tenant. So the tests mint RS256
 * tokens against a keypair whose public half is served as a JWKS by the same WireMock that stands
 * in for auth-service, and the service verifies them for real.
 *
 * <h2>What is stubbed and what is not</h2>
 *
 * <p>auth-service is stubbed, because it is a different process and its own behaviour is pinned by
 * {@code UserLifecycleIT} (22 tests) and by the live scripts. What is NOT stubbed is anything in
 * this service: the filter chain, method security, the Feign client, the error decoder and the
 * exception advice all run. The assertions are therefore about the seam — which tenant is sent,
 * which identity is sent, and what the client is told when the upstream refuses.
 *
 * <p><b>Cross-tenant isolation is enforced upstream and cannot be proven here</b>, and this file
 * does not pretend otherwise: the WireMock stubs assert which tenant id user-service SENT, which is
 * the half this service is responsible for. That another tenant's rows are actually unreachable is
 * proven where the row-level-security policy and the query predicate live — in
 * {@code UserLifecycleIT}, and, because Testcontainers runs as a SUPERUSER and the policy is inert
 * there, against the real RLS-enforcing database by
 * {@code scripts/e2e/phase13-tenant-admin-users-e2e.sh}.
 */
class UserAdminIT extends BaseUserIT {

    private static final String KID = "test-key-1";
    private static final KeyPair KEY_PAIR = generateKeyPair();
    private static final WireMockServer WIRE_MOCK;

    /** The caller: a tenant admin of TENANT_A. */
    private static final UUID ADMIN_ID = UUID.fromString("aa000001-0000-4000-8000-0000000000ad");
    private static final UUID TARGET_ID = UUID.fromString("aa000001-0000-4000-8000-0000000000c1");
    /** A user of TENANT_B. Everything about it must be invisible to TENANT_A's admin. */
    private static final UUID FOREIGN_ID = UUID.fromString("bb000001-0000-4000-8000-0000000000bb");
    private static final UUID BRANCH_ID = UUID.fromString("aa000001-0000-4000-8000-0000000000b1");

    private static final List<String> USER_ADMIN_PERMISSIONS = List.of("rbac.user.manage", "rbac.role.manage");
    private static final List<String> CASHIER_PERMISSIONS = List.of("pos.order.create", "pos.till.open");

    static {
        // Loopback bind: the wildcard socket is filtered by the macOS firewall and fails
        // intermittently with a silent EOF. See DEV-STACK-RUNBOOK.md, "The silent EOF".
        WIRE_MOCK = new WireMockServer(WireMockConfiguration.wireMockConfig()
            .bindAddress("127.0.0.1").dynamicPort());
        WIRE_MOCK.start();
        WireMock.configureFor("127.0.0.1", WIRE_MOCK.port());
        // One WireMock serves both roles: the JWKS the filter chain verifies tokens against, and
        // auth-service's internal API. Assigned here rather than in a second
        // @DynamicPropertySource — see BaseUserIT#jwksUri for why that ordering cannot be relied on.
        authServiceUri = "http://127.0.0.1:" + WIRE_MOCK.port();
        jwksUri = "http://127.0.0.1:" + WIRE_MOCK.port() + "/.well-known/jwks.json";
    }

    @AfterAll
    static void stopWireMock() {
        if (WIRE_MOCK != null) WIRE_MOCK.stop();
    }

    @BeforeEach
    void resetStubs() {
        WIRE_MOCK.resetAll();
        WIRE_MOCK.stubFor(WireMock.get(urlEqualTo("/.well-known/jwks.json"))
            .willReturn(aResponse().withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody(jwks())));
    }

    // ── 1. Listing is scoped to the caller's own tenant ──────────────────────────────────────

    @Test
    @DisplayName("listing users sends the caller's own tenant and returns page metadata")
    void listUsers_isScopedToTheCallersTenant_andCarriesPageMeta() {
        WIRE_MOCK.stubFor(WireMock.get(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Tenant-Id", equalTo(TENANT_A.toString()))
            .willReturn(json(200, """
                {"data":[{"id":"%s","email":"admin@a.local","fullName":"A Admin","locale":"en",
                          "active":true,"mustChangePassword":false,"totpEnabled":false,
                          "lastLoginAt":null,"createdAt":"2026-08-01T00:00:00Z"}],
                 "meta":{"page":{"cursor":"0","nextCursor":null,"limit":50},"totalCount":1},
                 "warnings":[]}""".formatted(ADMIN_ID))));

        ResponseEntity<String> res = getAs(adminToken(), "/api/v1/users?page=0&size=50");

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("admin@a.local").contains("\"totalCount\":1");
        // The tenant that was SENT is the assertion. The stub only matches TENANT_A, so a request
        // carrying anything else would 404 here rather than silently pass.
        verify(getRequestedFor(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Tenant-Id", equalTo(TENANT_A.toString())));
    }

    @Test
    @DisplayName("a tenant id in the query string does not change the tenant that is sent")
    void listUsers_ignoresATenantIdSuppliedByTheCaller() {
        WIRE_MOCK.stubFor(WireMock.get(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(200, emptyPage())));

        getAs(adminToken(), "/api/v1/users?tenantId=" + TENANT_B + "&search=x");

        verify(getRequestedFor(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Tenant-Id", equalTo(TENANT_A.toString())));
        // And the control: the foreign tenant id appears nowhere in what we sent upstream.
        assertThat(WIRE_MOCK.findAll(anyRequestedFor(anyUrl())).stream()
            .noneMatch(rq -> rq.getUrl().contains(TENANT_B.toString())
                || String.valueOf(rq.getBodyAsString()).contains(TENANT_B.toString()))).isTrue();
    }

    // ── 2. Another tenant's user is not found ────────────────────────────────────────────────

    @Test
    @DisplayName("fetching another tenant's user id surfaces as 404, not 403 and not 500")
    void getUser_fromAnotherTenant_isNotFound() {
        // auth-service answers 404 for an id outside the tenant — deliberately, so a 403 cannot be
        // used to confirm that an id names a real account somewhere.
        WIRE_MOCK.stubFor(WireMock.get(urlPathEqualTo("/internal/auth/users/" + FOREIGN_ID))
            .willReturn(json(404, error("NOT_FOUND", "User not found"))));

        ResponseEntity<String> res = getAs(adminToken(), "/api/v1/users/" + FOREIGN_ID);

        assertThat(res.getStatusCode().value()).isEqualTo(404);
        assertThat(res.getBody()).contains("NOT_FOUND");
        // Not the generic 500 this used to be, and nothing about the other tenant leaks.
        assertThat(res.getBody()).doesNotContain("INTERNAL_ERROR").doesNotContain(TENANT_B.toString());
    }

    // ── 3. Create returns 201 with the temporary password ────────────────────────────────────

    @Test
    @DisplayName("creating a user returns 201, the new id and the temporary password")
    void createUser_returns201_withTheTempPassword() {
        WIRE_MOCK.stubFor(WireMock.post(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Tenant-Id", equalTo(TENANT_A.toString()))
            .withHeader("X-Acting-User-Id", equalTo(ADMIN_ID.toString()))
            .willReturn(json(201, """
                {"data":{"id":"%s","email":"new@a.local","tempPassword":"zEHaY&6?CzqWe8p2",
                         "mustChangePassword":true,"branchId":"%s","assignedRoleCode":"CASHIER",
                         "loginable":true},"meta":null,"warnings":[]}"""
                .formatted(TARGET_ID, BRANCH_ID))));

        ResponseEntity<String> res = postAs(adminToken(), "/api/v1/users", """
            {"email":"new@a.local","fullName":"New Cashier","locale":"en","branchId":"%s","roleCode":"CASHIER"}"""
            .formatted(BRANCH_ID));

        assertThat(res.getStatusCode().value()).isEqualTo(201);
        assertThat(res.getBody()).contains(TARGET_ID.toString()).contains("zEHaY&6?CzqWe8p2")
            .contains("\"mustChangePassword\":true");
    }

    @Test
    @DisplayName("create names the acting user from the verified token, never from the request")
    void createUser_forwardsTheCallersIdentity_fromTheToken() {
        WIRE_MOCK.stubFor(WireMock.post(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(201, createdUser())));

        // The body claims to act as somebody else. It must have no effect: the acting user is the
        // subject of the verified JWT, which is the whole basis on which auth-service bounds what
        // this request may grant (13-11).
        postAs(adminToken(), "/api/v1/users", """
            {"email":"new@a.local","actingUserId":"%s","userId":"%s","tenantId":"%s"}"""
            .formatted(FOREIGN_ID, FOREIGN_ID, TENANT_B));

        verify(postRequestedFor(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Acting-User-Id", equalTo(ADMIN_ID.toString()))
            .withHeader("X-Tenant-Id", equalTo(TENANT_A.toString())));
    }

    // ── 4. An unknown role code is 400, naming the code ──────────────────────────────────────

    @Test
    @DisplayName("an unknown role code on create is 400 with the rejected code named")
    void createUser_withAnUnknownRoleCode_is400() {
        WIRE_MOCK.stubFor(WireMock.post(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(400, error("UNKNOWN_ROLE_CODE", "Unknown role code: NOT_A_REAL_ROLE"))));

        ResponseEntity<String> res = postAs(adminToken(), "/api/v1/users", """
            {"email":"new@a.local","branchId":"%s","roleCode":"NOT_A_REAL_ROLE"}""".formatted(BRANCH_ID));

        assertThat(res.getStatusCode().value()).isEqualTo(400);
        assertThat(res.getBody()).contains("UNKNOWN_ROLE_CODE").contains("NOT_A_REAL_ROLE");
    }

    @Test
    @DisplayName("an unknown role code on branch-role assignment is 400, not 500")
    void assignBranchRole_withAnUnknownRoleCode_is400() {
        WIRE_MOCK.stubFor(WireMock.post(urlMatching("/internal/auth/users/.*/branch-roles"))
            .willReturn(json(400, error("UNKNOWN_ROLE_CODE", "Unknown role code: NOT_A_REAL_ROLE"))));

        ResponseEntity<String> res = postAs(adminToken(), "/api/v1/users/" + TARGET_ID + "/branch-roles",
            """
            {"branchId":"%s","roleCode":"NOT_A_REAL_ROLE"}""".formatted(BRANCH_ID));

        assertThat(res.getStatusCode().value()).isEqualTo(400);
        assertThat(res.getBody()).contains("UNKNOWN_ROLE_CODE");
    }

    // ── 5. Update and deactivate return the updated resource ─────────────────────────────────

    @Test
    @DisplayName("updating a user patches the profile and returns the updated resource")
    void updateUser_returnsTheUpdatedResource() {
        WIRE_MOCK.stubFor(WireMock.patch(urlPathEqualTo("/internal/auth/users/" + TARGET_ID))
            .withHeader("X-Acting-User-Id", equalTo(ADMIN_ID.toString()))
            .willReturn(json(200, userDetail("Renamed Person", true))));

        ResponseEntity<String> res = patchAs(adminToken(), "/api/v1/users/" + TARGET_ID,
            "{\"fullName\":\"Renamed Person\"}");

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("Renamed Person").contains("\"active\":true");
        // A field the caller did not send is not invented on the way through — PATCH semantics.
        verify(WireMock.patchRequestedFor(urlPathEqualTo("/internal/auth/users/" + TARGET_ID))
            .withRequestBody(matching("(?s).*\"fullName\":\"Renamed Person\".*"))
            .withRequestBody(matching("(?s).*\"active\":null.*")));
    }

    @Test
    @DisplayName("deactivating a user flips the active flag and returns the updated resource")
    void deactivateUser_flipsTheFlag() {
        WIRE_MOCK.stubFor(WireMock.post(urlPathEqualTo("/internal/auth/users/" + TARGET_ID + "/deactivate"))
            .withHeader("X-Acting-User-Id", equalTo(ADMIN_ID.toString()))
            .willReturn(json(200, userDetail("Target Person", false))));

        ResponseEntity<String> res = postAs(adminToken(),
            "/api/v1/users/" + TARGET_ID + "/deactivate", "");

        assertThat(res.getStatusCode().value()).isEqualTo(200);
        assertThat(res.getBody()).contains("\"active\":false");
    }

    @Test
    @DisplayName("a password field in a profile patch is refused, not silently dropped")
    void updateUser_withAPasswordField_is400_andNothingIsForwarded() {
        WIRE_MOCK.stubFor(WireMock.patch(urlMatching("/internal/auth/users/.*"))
            .willReturn(json(200, userDetail("Target Person", true))));

        ResponseEntity<String> res = patchAs(adminToken(), "/api/v1/users/" + TARGET_ID,
            "{\"fullName\":\"Target Person\",\"password\":\"hunter2\"}");

        assertThat(res.getStatusCode().value()).isEqualTo(400);
        assertThat(res.getBody()).contains("password");
        // The value the caller put on the wire is never echoed back...
        assertThat(res.getBody()).doesNotContain("hunter2");
        // ...and nothing at all was applied: the upstream was never called.
        verify(0, WireMock.patchRequestedFor(urlMatching("/internal/auth/users/.*")));
    }

    // ── 6. Authorization: 403 without the authority, 401 anonymous ───────────────────────────

    @Test
    @DisplayName("every operation is 403 for an authenticated caller without the authority")
    void everyOperation_is403_forACallerWithoutTheUserAdministrationAuthority() {
        String cashier = tokenFor(UUID.randomUUID(), TENANT_A, CASHIER_PERMISSIONS);

        assertThat(getAs(cashier, "/api/v1/users").getStatusCode().value()).isEqualTo(403);
        assertThat(getAs(cashier, "/api/v1/users/" + TARGET_ID).getStatusCode().value()).isEqualTo(403);
        assertThat(postAs(cashier, "/api/v1/users", "{\"email\":\"x@a.local\"}")
            .getStatusCode().value()).isEqualTo(403);
        assertThat(patchAs(cashier, "/api/v1/users/" + TARGET_ID, "{\"fullName\":\"x\"}")
            .getStatusCode().value()).isEqualTo(403);
        assertThat(postAs(cashier, "/api/v1/users/" + TARGET_ID + "/deactivate", "")
            .getStatusCode().value()).isEqualTo(403);
        assertThat(postAs(cashier, "/api/v1/users/" + TARGET_ID + "/reactivate", "")
            .getStatusCode().value()).isEqualTo(403);

        // The control: a denial must be a denial, not a request that reached auth-service and was
        // answered there. Nothing was delegated.
        verify(0, anyRequestedFor(urlMatching("/internal/auth/.*")));
    }

    @Test
    @DisplayName("every operation is 401 for an anonymous caller")
    void everyOperation_is401_forAnAnonymousCaller() {
        assertThat(get("/api/v1/users").getStatusCode().value()).isEqualTo(401);
        assertThat(get("/api/v1/users/" + TARGET_ID).getStatusCode().value()).isEqualTo(401);
        assertThat(post("/api/v1/users", Map.of("email", "x@a.local")).getStatusCode().value()).isEqualTo(401);
        assertThat(post("/api/v1/users/" + TARGET_ID + "/deactivate", Map.of()).getStatusCode().value()).isEqualTo(401);

        verify(0, anyRequestedFor(urlMatching("/internal/auth/.*")));
    }

    // ── 7. The role ceiling refusal reaches the client as a refusal ──────────────────────────

    @Test
    @DisplayName("a tenant admin creating a user in the highest tenant role is refused with 403")
    void createUser_aboveTheCallersCeiling_is403_notA500() {
        // The ceiling itself is auth-service's — it is the only service holding role_permissions
        // and user_branch_roles, and RoleCeiling.permits is its single owner, shared with the role
        // picker so the two cannot drift. What is asserted here is that the refusal ARRIVES as a
        // refusal. Before the error decoder it arrived as 500 INTERNAL_ERROR, and a role picker
        // cannot tell "you may not grant that" from "the platform broke".
        WIRE_MOCK.stubFor(WireMock.post(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(403, error("ROLE_CEILING_EXCEEDED",
                "You cannot assign the role OWNER: it grants 1 permission(s) you do not hold yourself"))));

        ResponseEntity<String> res = postAs(adminToken(), "/api/v1/users", """
            {"email":"owner@a.local","branchId":"%s","roleCode":"OWNER"}""".formatted(BRANCH_ID));

        assertThat(res.getStatusCode().value()).isEqualTo(403);
        assertThat(res.getBody()).contains("ROLE_CEILING_EXCEEDED").contains("OWNER");
        // The message names a COUNT, never the permission codes: naming them would republish
        // exactly what the ceiling withholds.
        assertThat(res.getBody()).doesNotContain("rbac.manage");
    }

    @Test
    @DisplayName("a tenant admin assigning the highest tenant role is refused with 403")
    void assignBranchRole_aboveTheCallersCeiling_is403_notA500() {
        WIRE_MOCK.stubFor(WireMock.post(urlMatching("/internal/auth/users/.*/branch-roles"))
            .willReturn(json(403, error("ROLE_CEILING_EXCEEDED", "You cannot assign the role OWNER"))));

        ResponseEntity<String> res = postAs(adminToken(), "/api/v1/users/" + TARGET_ID + "/branch-roles",
            "{\"branchId\":\"%s\",\"roleCode\":\"OWNER\"}".formatted(BRANCH_ID));

        assertThat(res.getStatusCode().value()).isEqualTo(403);
        assertThat(res.getBody()).contains("ROLE_CEILING_EXCEEDED");
    }

    // ── 8. A 5xx upstream is never reported as a client error ────────────────────────────────

    @Test
    @DisplayName("an upstream 500 becomes a 502, never a 4xx, and leaks nothing")
    void upstreamServerFault_is502_andSaysNothingInternal() {
        WIRE_MOCK.stubFor(WireMock.get(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(500, error("INTERNAL_ERROR", "could not extract ResultSet; SQL [n/a]"))));

        ResponseEntity<String> res = getAs(adminToken(), "/api/v1/users");

        assertThat(res.getStatusCode().value()).isEqualTo(502);
        assertThat(res.getBody()).contains("UPSTREAM_ERROR");
        assertThat(res.getBody())
            .doesNotContain("SQL")
            .doesNotContain("/internal/auth")
            .doesNotContain("127.0.0.1")
            .doesNotContain("feign");
    }

    @Test
    @DisplayName("an upstream that refuses OUR credentials is a 502, not an echoed 401")
    void upstreamRejectingOurSharedSecret_is502() {
        // A 401 here means user-service's X-Internal-Service secret is wrong. Echoing it would ask
        // an authenticated tenant admin to log in again over a fault they cannot see or fix.
        WIRE_MOCK.stubFor(WireMock.get(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(401, error("UNAUTHENTICATED", "Invalid token"))));

        assertThat(getAs(adminToken(), "/api/v1/users").getStatusCode().value()).isEqualTo(502);
    }

    // ── The internal seam is not reachable from outside ──────────────────────────────────────

    @Test
    @DisplayName("a client cannot supply the acting-user header — it is not read from the request")
    void aClientSuppliedActingUserHeaderIsNotForwarded() {
        WIRE_MOCK.stubFor(WireMock.post(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(201, createdUser())));

        rest.post().uri("/api/v1/users")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + adminToken())
            .header("X-Acting-User-Id", FOREIGN_ID.toString())
            .header("X-Tenant-Id", TENANT_B.toString())
            .body("{\"email\":\"new@a.local\"}")
            .exchange((req, res) -> toEntity(res), false);

        // The forwarded values come from the token, not from the headers the client sent. (The
        // gateway also strips both at the edge — StripInternalHeaderFilter, 13-11 — so this is the
        // second of two independent controls, not the only one.)
        verify(postRequestedFor(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Acting-User-Id", equalTo(ADMIN_ID.toString()))
            .withHeader("X-Tenant-Id", equalTo(TENANT_A.toString())));
        verify(0, postRequestedFor(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Acting-User-Id", equalTo(FOREIGN_ID.toString())));
    }

    @Test
    @DisplayName("the shared internal secret is attached to every delegated call")
    void everyDelegatedCallCarriesTheInternalSecret() {
        WIRE_MOCK.stubFor(WireMock.get(urlPathEqualTo("/internal/auth/users"))
            .willReturn(json(200, emptyPage())));

        getAs(adminToken(), "/api/v1/users");

        verify(getRequestedFor(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Internal-Service", equalTo("test-internal-secret")));
        // And the control that the header is not simply absent from the matcher's point of view.
        verify(0, getRequestedFor(urlPathEqualTo("/internal/auth/users"))
            .withHeader("X-Internal-Service", absent()));
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private String adminToken() {
        return tokenFor(ADMIN_ID, TENANT_A, USER_ADMIN_PERMISSIONS);
    }

    /** An RS256 token the service verifies for real against the JWKS WireMock serves. */
    private static String tokenFor(UUID subject, UUID tenantId, List<String> permissions) {
        return Jwts.builder()
            .header().keyId(KID).and()
            .subject(subject.toString())
            .claim("tenant_id", tenantId.toString())
            .claim("branch_id", BRANCH_ID.toString())
            .claim("roles", List.of("TENANT_ADMIN"))
            .claim("permissions", permissions)
            .issuedAt(Date.from(Instant.now()))
            .expiration(Date.from(Instant.now().plusSeconds(600)))
            .signWith(KEY_PAIR.getPrivate(), Jwts.SIG.RS256)
            .compact();
    }

    private static String jwks() {
        return new JWKSet(new RSAKey.Builder((RSAPublicKey) KEY_PAIR.getPublic()).keyID(KID).build())
            .toString();
    }

    private static KeyPair generateKeyPair() {
        try {
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            return gen.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private ResponseEntity<String> getAs(String token, String uri) {
        return rest.get().uri(uri).header("Authorization", "Bearer " + token)
            .exchange((req, res) -> toEntity(res), false);
    }

    private ResponseEntity<String> postAs(String token, String uri, String body) {
        return rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + token)
            .body(body.isEmpty() ? "{}" : body)
            .exchange((req, res) -> toEntity(res), false);
    }

    private ResponseEntity<String> patchAs(String token, String uri, String body) {
        return rest.patch().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + token)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    private static com.github.tomakehurst.wiremock.client.ResponseDefinitionBuilder json(int status, String body) {
        return aResponse().withStatus(status)
            .withHeader("Content-Type", "application/json")
            .withBody(body);
    }

    private static String error(String code, String message) {
        return """
            {"error":{"code":"%s","message":"%s","details":[],"traceId":"t"}}"""
            .formatted(code, message);
    }

    private static String emptyPage() {
        return """
            {"data":[],"meta":{"page":{"cursor":"0","nextCursor":null,"limit":50},"totalCount":0},"warnings":[]}""";
    }

    private static String createdUser() {
        return """
            {"data":{"id":"%s","email":"new@a.local","tempPassword":"zEHaY&6?CzqWe8p2",
                     "mustChangePassword":true,"branchId":null,"assignedRoleCode":null,
                     "loginable":false},"meta":null,"warnings":[]}""".formatted(TARGET_ID);
    }

    private static String userDetail(String fullName, boolean active) {
        return """
            {"data":{"user":{"id":"%s","email":"target@a.local","fullName":"%s","locale":"en",
                             "active":%s,"mustChangePassword":false,"totpEnabled":false,
                             "lastLoginAt":null,"createdAt":"2026-08-01T00:00:00Z"},
                     "assignments":[{"branchId":"%s","roleCode":"CASHIER","primary":true,
                                     "approvalLimitPaisa":null}]},
             "meta":null,"warnings":[]}""".formatted(TARGET_ID, fullName, active, BRANCH_ID);
    }
}
