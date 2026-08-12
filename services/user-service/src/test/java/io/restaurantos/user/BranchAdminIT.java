package io.restaurantos.user;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import io.jsonwebtoken.Jwts;
import io.restaurantos.user.config.UserInternalServiceFilter;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static com.github.tomakehurst.wiremock.client.WireMock.urlPathMatching;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * Branch administration over HTTP — the four things a tenant does to its own branches.
 *
 * <h2>Why these six assertions and not others</h2>
 *
 * <p>Each one reproduces a defect measured live against the running stack on 2026-08-12, as
 * {@code owner@terrace.local}, through the real gateway. They are written so that each fails
 * against the code as it stood that morning:
 *
 * <ol>
 *   <li><b>Nothing was assigned to a new branch.</b> The switcher is built from
 *       {@code user_branch_roles}; a created branch had no rows there, so the administrator who
 *       created it could not switch to it or take an order on it.</li>
 *   <li><b>Deactivating a branch left it in the switcher.</b> {@code listMine} filtered on
 *       {@code deleted_at} alone.</li>
 *   <li><b>A body that omitted {@code isHq} was a 400</b> reading "Request body is missing or
 *       malformed", because the record declared a primitive {@code boolean} and Jackson passes an
 *       absent creator property as null. The screen never sends that key.</li>
 *   <li><b>{@code timezone} was an unchecked free string,</b> on a field that business dates are
 *       cut on.</li>
 *   <li><b>A colliding rename was a bare 500.</b> {@code save} defers the unique-index violation
 *       to commit, which is outside the service's own catch block.</li>
 * </ol>
 *
 * <p>The sixth defect measured that morning — a plain-text address answering 409 because
 * {@code branches.address} was jsonb — is deliberately NOT asserted here. It is owned by the
 * changeset that converts the column to {@code text}, and duplicating the assertion against a
 * migration this file does not own would make this suite fail for a reason it cannot explain.</p>
 *
 * <h2>What the WireMock stands in for</h2>
 *
 * <p>auth-service is the system of record for {@code user_branch_roles} and user-service reaches
 * it over {@code /internal/auth/**}. Stubbing it here is what lets this file assert the branch
 * <em>call</em> is made with the right acting user, role and branch — the seam that used not to
 * exist at all. {@code AuthInternalBranchRoleIT} owns the other side of that contract.
 */
class BranchAdminIT extends BaseUserIT {

    private static final String KID = "branch-admin-key";
    private static final KeyPair KEY_PAIR = generateKeyPair();
    private static final WireMockServer WIRE_MOCK;
    private static final String INTERNAL_SECRET = "test-internal-secret";

    private static final UUID OWNER_ID = UUID.fromString("aa000001-0000-4000-8000-0000000000b1");
    private static final ObjectMapper JSON = new ObjectMapper();

    /** The expression BranchController's write endpoints enforce. */
    private static final List<String> BRANCH_ADMIN = List.of("branch.manage");

    static {
        WIRE_MOCK = new WireMockServer(WireMockConfiguration.wireMockConfig()
                .bindAddress("127.0.0.1").dynamicPort());
        WIRE_MOCK.start();
        WireMock.configureFor("127.0.0.1", WIRE_MOCK.port());
        // Mutable statics, not a second @DynamicPropertySource — BaseUserIT documents why the
        // ordering of those cannot be relied on.
        jwksUri = "http://127.0.0.1:" + WIRE_MOCK.port() + "/.well-known/jwks.json";
        authServiceUri = "http://127.0.0.1:" + WIRE_MOCK.port();
    }

    /** A marker with no consumer, so Spring builds a context distinct from every other IT's. */
    @DynamicPropertySource
    static void distinctContext(DynamicPropertyRegistry r) {
        r.add("restaurantos.test.suite", () -> "branch-admin-it");
    }

    @AfterAll
    static void stopWireMock() {
        if (WIRE_MOCK != null) WIRE_MOCK.stop();
    }

    @BeforeEach
    void stubUpstreams() {
        WIRE_MOCK.resetAll();
        WIRE_MOCK.stubFor(WireMock.get(urlEqualTo("/.well-known/jwks.json"))
                .willReturn(aResponse().withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody(jwks())));
        // auth-service accepts the grant. The assertion that it was CALLED, and with what, is in
        // the test below — a stub that answers 200 to anything would let a missing call pass.
        WIRE_MOCK.stubFor(WireMock.post(urlPathMatching("/internal/auth/users/.*/branch-roles"))
                .willReturn(aResponse().withStatus(200)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{\"status\":\"ASSIGNED\"}")));
    }

    // ══ 1. The creator lands on the branch they created ═══════════════════════════════════════

    @Test
    @DisplayName("creating a branch puts the creator on it with their own role")
    void theCreatorIsAssignedToTheNewBranch() throws Exception {
        UUID homeBranch = createInternalBranch(TENANT_A, "Home " + UUID.randomUUID());
        stubOwnRoles(List.of(Map.of("branchId", homeBranch.toString(), "roleCode", "OWNER")));

        ResponseEntity<String> created = postAs(ownerToken(homeBranch), "/api/v1/branches",
                JSON.writeValueAsString(Map.of("name", "Assigned " + UUID.randomUUID(), "isHq", false)));
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        String newBranchId = JSON.readTree(created.getBody()).path("data").path("id").asText();

        WIRE_MOCK.verify(WireMock.postRequestedFor(
                        urlEqualTo("/internal/auth/users/" + OWNER_ID + "/branch-roles"))
                .withHeader("X-Acting-User-Id", WireMock.equalTo(OWNER_ID.toString()))
                .withHeader("X-Tenant-Id", WireMock.equalTo(TENANT_A.toString()))
                .withRequestBody(WireMock.matchingJsonPath("$.branchId", WireMock.equalTo(newBranchId)))
                .withRequestBody(WireMock.matchingJsonPath("$.roleCode", WireMock.equalTo("OWNER"))));
    }

    @Test
    @DisplayName("if the role grant is refused the branch is not created either")
    void aRefusedGrantRollsBackTheBranch() throws Exception {
        UUID homeBranch = createInternalBranch(TENANT_A, "RB Home " + UUID.randomUUID());
        stubOwnRoles(List.of(Map.of("branchId", homeBranch.toString(), "roleCode", "OWNER")));
        WIRE_MOCK.stubFor(WireMock.post(urlPathMatching("/internal/auth/users/.*/branch-roles"))
                .willReturn(aResponse().withStatus(403)
                        .withHeader("Content-Type", "application/json")
                        .withBody("{\"error\":{\"code\":\"ROLE_CEILING_EXCEEDED\"}}")));

        String name = "Rollback " + UUID.randomUUID();
        ResponseEntity<String> created = postAs(ownerToken(homeBranch), "/api/v1/branches",
                JSON.writeValueAsString(Map.of("name", name, "isHq", false)));

        assertThat(created.getStatusCode().is2xxSuccessful()).isFalse();
        // A branch that exists and that nobody may reach is worse than a create that failed.
        assertThat(getAs(ownerToken(), "/api/v1/branches").getBody()).doesNotContain(name);
    }

    // ══ 2. Deactivating removes it from the switcher ══════════════════════════════════════════

    @Test
    @DisplayName("a deactivated branch leaves the branch switcher and an active one stays")
    void deactivatedBranch_leavesTheSwitcher() throws Exception {
        UUID keep = createInternalBranch(TENANT_A, "Keep " + UUID.randomUUID());
        UUID retire = createInternalBranch(TENANT_A, "Retire " + UUID.randomUUID());
        stubOwnRoles(List.of(
                Map.of("branchId", keep.toString(), "roleCode", "OWNER"),
                Map.of("branchId", retire.toString(), "roleCode", "OWNER")));

        ResponseEntity<String> before = getAs(ownerToken(keep), "/api/v1/branches/mine");
        assertThat(before.getStatusCode().value()).isEqualTo(200);
        assertThat(before.getBody()).contains(retire.toString());

        assertThat(putAs(ownerToken(keep), "/api/v1/branches/" + retire, "{\"isActive\":false}")
                .getStatusCode().value()).isEqualTo(200);

        ResponseEntity<String> after = getAs(ownerToken(keep), "/api/v1/branches/mine");
        assertThat(after.getStatusCode().value()).isEqualTo(200);
        assertThat(after.getBody())
                .as("a branch nobody may trade on must not be offered as somewhere to work")
                .doesNotContain(retire.toString());
        assertThat(after.getBody()).contains(keep.toString());
        // And never a "Branch 1a2b3c4d" placeholder in its place.
        assertThat(after.getBody()).doesNotContain("\"Branch " + retire.toString().substring(0, 8));
    }

    // ══ 3. A body that omits an optional key ══════════════════════════════════════════════════

    @Test
    @DisplayName("a request that omits isHq is accepted, and the branch is not head office")
    void omittingIsHq_isAccepted() throws Exception {
        stubOwnRoles(List.of());

        // The screen never sends isHq — which branch is head office is settled when the tenant is
        // provisioned. With the record's primitive boolean, omitting it answered
        // 400 "Request body is missing or malformed": a message about the whole body, naming no
        // field, for JSON that was perfectly well-formed.
        ResponseEntity<String> created = postAs(ownerToken(), "/api/v1/branches",
                "{\"name\":\"NoHq " + UUID.randomUUID() + "\",\"timezone\":\"Asia/Karachi\"}");

        assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(JSON.readTree(created.getBody()).path("data").path("isHq").asBoolean()).isFalse();
    }

    // ══ 4. A time zone that exists ════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a time zone that is not an IANA name is refused, naming the field")
    void invalidTimezone_isRefusedNamingTheField() throws Exception {
        stubOwnRoles(List.of());

        ResponseEntity<String> res = postAs(ownerToken(), "/api/v1/branches", JSON.writeValueAsString(
                Map.of("name", "TZ " + UUID.randomUUID(), "isHq", false, "timezone", "Pakistan Time")));

        assertThat(res.getStatusCode().value()).isEqualTo(422);
        assertThat(res.getBody()).contains("timezone").contains("Asia/Karachi");
    }

    // ══ 5. A colliding rename says which field ════════════════════════════════════════════════

    @Test
    @DisplayName("renaming a branch onto an existing name is a 409 that names the field")
    void collidingRename_isAFieldBoundConflict() throws Exception {
        stubOwnRoles(List.of());
        String taken = "Taken " + UUID.randomUUID();
        createViaApi(taken);
        UUID other = createViaApi("Other " + UUID.randomUUID());

        ResponseEntity<String> res = putAs(ownerToken(), "/api/v1/branches/" + other,
                JSON.writeValueAsString(Map.of("name", taken)));

        assertThat(res.getStatusCode().value())
                .as("save() defers the unique-index violation past the catch; saveAndFlush does not")
                .isEqualTo(409);
        assertThat(res.getBody()).contains("name").contains(taken);
    }

    // ══ helpers ═══════════════════════════════════════════════════════════════════════════════

    private void stubOwnRoles(List<Map<String, String>> assignments) {
        try {
            WIRE_MOCK.stubFor(WireMock.get(urlPathMatching("/internal/auth/users/.*/branch-roles"))
                    .willReturn(aResponse().withStatus(200)
                            .withHeader("Content-Type", "application/json")
                            .withBody(JSON.writeValueAsString(assignments))));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Create through the PUBLIC endpoint, which is the path under test. */
    private UUID createViaApi(String name) throws Exception {
        ResponseEntity<String> created = postAs(ownerToken(), "/api/v1/branches",
                JSON.writeValueAsString(Map.of("name", name, "isHq", false)));
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        return UUID.fromString(JSON.readTree(created.getBody()).path("data").path("id").asText());
    }

    /** Create through the provisioning endpoint, for fixtures that are not the subject. */
    private UUID createInternalBranch(UUID tenantId, String name) {
        setRls(tenantId);
        ResponseEntity<String> created = postWithHeader("/internal/users/branches",
                Map.of("tenantId", tenantId.toString(), "name", name, "isHq", false),
                UserInternalServiceFilter.HEADER, INTERNAL_SECRET);
        assertThat(created.getStatusCode().value()).isEqualTo(201);
        try {
            return UUID.fromString(JSON.readTree(created.getBody()).path("branchId").asText());
        } catch (Exception e) {
            throw new IllegalStateException("could not read branchId from " + created.getBody(), e);
        }
    }

    private String ownerToken() {
        return ownerToken(null);
    }

    private String ownerToken(UUID branchId) {
        var builder = Jwts.builder()
                .header().keyId(KID).and()
                .subject(OWNER_ID.toString())
                .claim("tenant_id", TENANT_A.toString())
                .claim("roles", List.of("OWNER"))
                .claim("permissions", BRANCH_ADMIN)
                .issuedAt(Date.from(Instant.now()))
                .expiration(Date.from(Instant.now().plusSeconds(600)));
        if (branchId != null) {
            builder = builder.claim("branch_id", branchId.toString());
        }
        return builder.signWith(KEY_PAIR.getPrivate(), Jwts.SIG.RS256).compact();
    }

    private ResponseEntity<String> getAs(String token, String uri) {
        return rest.get().uri(uri).header("Authorization", "Bearer " + token)
                .exchange((req, res) -> toEntity(res), false);
    }

    private ResponseEntity<String> postAs(String token, String uri, String body) {
        return rest.post().uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + token)
                .body(body)
                .exchange((req, res) -> toEntity(res), false);
    }

    private ResponseEntity<String> putAs(String token, String uri, String body) {
        return rest.put().uri(uri)
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", "Bearer " + token)
                .body(body)
                .exchange((req, res) -> toEntity(res), false);
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
}
