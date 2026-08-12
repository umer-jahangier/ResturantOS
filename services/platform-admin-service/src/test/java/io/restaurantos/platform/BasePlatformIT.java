package io.restaurantos.platform;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.github.tomakehurst.wiremock.client.WireMock;
import com.github.tomakehurst.wiremock.core.WireMockConfiguration;
import io.restaurantos.platform.repository.TenantRepository;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.List;
import java.util.UUID;

/**
 * Base class for platform-admin-service Testcontainers integration tests.
 * Mirrors BaseIntegrationTest from auth-service (Doc 10 pattern).
 * - Postgres: platform_db (Liquibase applied with seed context)
 * - Redis: feature-flag dual-key validation
 * - RabbitMQ: outbox relay
 * - WireMock: stubs for auth-service, user-service, finance-service
 */
@SpringBootTest(
    classes = PlatformAdminApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
@ActiveProfiles("test")
public abstract class BasePlatformIT {

    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
            .withDatabaseName("platform_db")
            .withUsername("platform_admin")
            .withPassword("test-pass");

    @SuppressWarnings("resource")
    static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:8"))
            .withExposedPorts(6379);

    static final RabbitMQContainer RABBIT =
        new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3-management"));

    // bindAddress is not optional here. WireMock otherwise binds the wildcard address, and the
    // macOS Application Firewall filters wildcard-bound sockets — it accepts the connection, writes
    // zero bytes and closes — so stubbed calls fail intermittently with "header parser received no
    // bytes" and nothing is logged. Same cause as server.address on the Spring test server; the
    // stub server is a second listener and needs the same treatment. See DEV-STACK-RUNBOOK.md,
    // "The silent EOF".
    static final WireMockServer WIREMOCK = new WireMockServer(
        WireMockConfiguration.wireMockConfig().bindAddress("127.0.0.1").dynamicPort()
    );

    static {
        POSTGRES.start();
        REDIS.start();
        RABBIT.start();
        WIREMOCK.start();
        awaitPostgresReady();
    }

    private static void awaitPostgresReady() {
        String url = jdbcUrl();
        RuntimeException last = null;
        for (int i = 0; i < 60; i++) {
            try (java.sql.Connection c =
                     java.sql.DriverManager.getConnection(url, POSTGRES.getUsername(), POSTGRES.getPassword());
                 java.sql.Statement s = c.createStatement()) {
                s.execute("SELECT 1");
                return;
            } catch (Exception e) {
                last = new IllegalStateException("Postgres not reachable: " + e.getMessage(), e);
                try { Thread.sleep(500); } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt(); throw new IllegalStateException(ie);
                }
            }
        }
        throw last;
    }

    private static String jdbcUrl() {
        String url = POSTGRES.getJdbcUrl();
        return url + (url.contains("?") ? "&" : "?") + "sslmode=disable&tcpKeepAlive=true";
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        // Bind the test server to loopback. Spring Boot otherwise binds the wildcard address,
        // and the macOS Application Firewall filters wildcard-bound sockets: it accepts the
        // connection, writes zero bytes and closes, so requests fail with "header parser received
        // no bytes" / PrematureCloseException and NOTHING is logged server-side. Intermittent, and
        // it looks exactly like an application or network bug. See DEV-STACK-RUNBOOK.md.
        r.add("server.address", () -> "127.0.0.1");
        r.add("spring.datasource.url", BasePlatformIT::jdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.change-log", () -> "classpath:db/changelog/db.changelog-master.xml");
        r.add("spring.liquibase.contexts", () -> "seed");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        r.add("restaurantos.internal.secret", () -> "test-internal-secret");
        r.add("restaurantos.jwks.uri", () -> "http://127.0.0.1:" + WIREMOCK.port() + "/test-jwks");
        r.add("restaurantos.auth-service.uri", () -> "http://127.0.0.1:" + WIREMOCK.port());
        r.add("restaurantos.user-service.uri", () -> "http://127.0.0.1:" + WIREMOCK.port());
        r.add("restaurantos.finance-service.uri", () -> "http://127.0.0.1:" + WIREMOCK.port());
    }

    @LocalServerPort protected int port;
    @Autowired protected TenantContext tenantContext;
    @Autowired protected TenantRepository tenantRepository;
    @Autowired protected OutboxRepository outboxRepository;
    @Autowired protected StringRedisTemplate redis;
    @Autowired protected JdbcTemplate jdbc;

    protected RestClient rest;
    protected RestClient internalRest;

    @BeforeEach
    void initBase() {
        WIREMOCK.resetAll();
        wireMockStubJwks();

        rest = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl("http://127.0.0.1:" + port)
            .build();
        internalRest = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl("http://127.0.0.1:" + port)
            .defaultHeader("X-Internal-Service", "test-internal-secret")
            .build();
    }

    @AfterEach
    void clearTenant() {
        tenantContext.clear();
    }

    /**
     * Serves a REAL JWKS containing {@link #TEST_KID}'s public key.
     *
     * <p>It used to serve {@code {"keys":[]}}, which is fine for a suite that never presents a token
     * but makes it impossible to test an authorization gate at all: {@code JwksKeyProvider} cannot
     * resolve any kid, so every request with an {@code Authorization} header is a 401 and a 403 that
     * should be produced by {@code @PreAuthorize("hasAuthority('SUPER_ADMIN')")} is
     * indistinguishable from one produced by "the signature did not verify". 13-14 needs the
     * distinction, because "a tenant OWNER is refused the tier endpoint" is only meaningful if the
     * OWNER's token was genuinely valid.
     *
     * <p>Harmless to the classes that present no token: they never trigger a JWKS fetch.
     */
    protected void wireMockStubJwks() {
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo("/test-jwks"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody(JWKS_JSON)));
    }

    // --- Real RS256 tokens, so authorization can be tested rather than assumed ---

    protected static final String TEST_KID = "platform-it-key";
    private static final KeyPair TEST_KEYS;
    private static final String JWKS_JSON;

    static {
        try {
            KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
            gen.initialize(2048);
            TEST_KEYS = gen.generateKeyPair();
            JWKS_JSON = new JWKSet(new RSAKey.Builder((RSAPublicKey) TEST_KEYS.getPublic())
                .keyID(TEST_KID)
                .build()).toString();
        } catch (Exception e) {
            throw new IllegalStateException("could not build the test signing key", e);
        }
    }

    /**
     * A tenant-less control-plane token, exactly the shape
     * {@code JwtSigningService.signPlatformToken} mints: the platform user's id as the subject and
     * the role in BOTH the {@code roles} and {@code permissions} claims.
     */
    protected String platformToken(UUID platformUserId, String platformRole) {
        return signToken(platformUserId, null, List.of(platformRole), List.of(platformRole));
    }

    /** A tenant user's token — a real, valid credential that simply is not a platform one. */
    protected String tenantToken(UUID userId, UUID tenantId, String role, List<String> permissions) {
        return signToken(userId, tenantId, List.of(role), permissions);
    }

    protected String signToken(UUID subject, UUID tenantId, List<String> roles, List<String> permissions) {
        try {
            Date now = new Date();
            var claims = new JWTClaimsSet.Builder()
                .subject(subject.toString())
                .claim("roles", roles)
                .claim("permissions", permissions)
                .issueTime(now)
                .expirationTime(new Date(now.getTime() + 3_600_000));
            if (tenantId != null) {
                claims.claim("tenant_id", tenantId.toString());
            }
            SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(TEST_KID).build(), claims.build());
            jwt.sign(new RSASSASigner(TEST_KEYS.getPrivate()));
            return jwt.serialize();
        } catch (Exception e) {
            throw new IllegalStateException("could not sign a test token", e);
        }
    }

    // --- Authenticated HTTP helpers ---

    protected ResponseEntity<String> httpGetAs(String token, String uri) {
        return rest.get().uri(uri)
            .header("Authorization", "Bearer " + token)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> httpPostAs(String token, String uri, Object body) {
        return rest.post().uri(uri)
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> httpPatchAs(String token, String uri, Object body) {
        return rest.patch().uri(uri)
            .header("Authorization", "Bearer " + token)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    // --- HTTP helpers (prefixed 'http' to avoid clash with WireMock static methods) ---

    protected ResponseEntity<String> httpPost(String uri, Object body) {
        return rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> httpPostInternal(String uri, Object body) {
        return internalRest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> httpGet(String uri) {
        return rest.get().uri(uri)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> httpGetInternal(String uri) {
        return internalRest.get().uri(uri)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> httpPatchInternal(String uri, Object body) {
        return internalRest.patch().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse res)
            throws java.io.IOException {
        byte[] bytes = res.getBody() != null ? res.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(res.getStatusCode())
            .headers(res.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }

    // --- WireMock stub helpers (use WireMock. prefix throughout) ---

    protected void stubAuthProvisionAdmin(UUID tenantId, UUID userId, String tempPassword) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo(
                "/internal/auth/tenants/" + tenantId + "/provision-admin"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"userId\":\"" + userId + "\",\"tempPassword\":\"" + tempPassword + "\"}}")));
    }

    /**
     * The REAL shape of {@code POST /internal/users/branches}: a bare {@code {"branchId": …}},
     * NOT an ApiResponse envelope — {@code BranchInternalController.createBranch} returns its
     * response record directly. This stub previously produced {@code {"data":{"id": …}}}, which is
     * what the saga's old {@code extractBranchId} looked for, so the test suite and the defect
     * agreed with each other and disagreed with production: every provisioned tenant got a
     * {@code UUID.randomUUID()} branch id (audit B2). A stub that mirrors the producer is the only
     * thing that makes this class capable of catching that.
     */
    protected void stubUserCreateBranch(UUID branchId) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo("/internal/users/branches"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"branchId\":\"" + branchId + "\"}")));
    }

    protected void stubUserCreateBranchFail() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo("/internal/users/branches"))
            .willReturn(WireMock.aResponse().withStatus(500).withBody("{\"error\":\"simulated\"}")));
    }

    /**
     * A 201 carrying no readable branch id — deliberately the OLD enveloped shape, so this stub is
     * simultaneously "a response the saga cannot parse" and "the exact response the deleted
     * fallback used to swallow". The saga must abort here, not invent an id.
     */
    protected void stubUserCreateBranchUnparseable() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo("/internal/users/branches"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"id\":\"" + UUID.randomUUID() + "\",\"name\":\"HQ\"}}")));
    }

    /** Compensation target: DELETE /internal/users/branches/{id} (13-10). */
    protected void stubUserDeactivateBranch() {
        WIREMOCK.stubFor(WireMock.delete(WireMock.urlPathMatching("/internal/users/branches/.*"))
            .willReturn(WireMock.aResponse().withStatus(204)));
    }

    protected void stubUserDeactivateBranchFail() {
        WIREMOCK.stubFor(WireMock.delete(WireMock.urlPathMatching("/internal/users/branches/.*"))
            .willReturn(WireMock.aResponse().withStatus(500).withBody("{\"error\":\"simulated\"}")));
    }

    /** {@code POST /internal/auth/tenants} — 13-06's idempotent upsert; 200 on create AND replay. */
    protected void stubAuthRegisterTenant() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo("/internal/auth/tenants"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"tenantId\":\"" + UUID.randomUUID() + "\",\"slug\":\"stub\","
                    + "\"name\":\"Stub\",\"status\":\"ACTIVE\",\"created\":true}}")));
    }

    /** 13-06 raises 409 STATE_INVALID when the slug is held by a DIFFERENT tenant. */
    protected void stubAuthRegisterTenantSlugConflict() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo("/internal/auth/tenants"))
            .willReturn(WireMock.aResponse()
                .withStatus(409)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"error\":{\"code\":\"STATE_INVALID\",\"message\":\"slug already held\"}}")));
    }

    protected void stubAuthSetTenantStatus() {
        WIREMOCK.stubFor(WireMock.patch(WireMock.urlPathMatching("/internal/auth/tenants/.*/status"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"tenantId\":\"" + UUID.randomUUID() + "\",\"slug\":\"stub\","
                    + "\"status\":\"PROVISIONING_FAILED\",\"loginAllowed\":false}}")));
    }

    /**
     * The saga's compensating revoke — {@code DELETE /internal/auth/tenants/{id}/provision-admin}.
     *
     * <p>It used to be {@code DELETE /internal/auth/users/{id}/branch-roles}, the same door
     * user-service uses for a human pressing Revoke. S2 made that door require
     * {@code X-Acting-User-Id} and bound the revoke by that human's own role ceiling — without it a
     * tenant admin who cannot create an OWNER could destroy every OWNER in a tenant, irreversibly.
     * This caller has no acting human, so it moved to the system-context door beside the operation
     * it compensates rather than being let through the human one by omitting a header.
     */
    protected void stubAuthRevokeBranchRole() {
        WIREMOCK.stubFor(
            WireMock.delete(WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin"))
                .willReturn(WireMock.aResponse().withStatus(204)));
    }

    /**
     * {@code POST /internal/auth/tenants/{id}/provision-admin} as 13-06 extended it: the response
     * echoes the branchId and roleCode the caller sent, alongside userId and tempPassword.
     */
    protected void stubAuthProvisionAdminAnyTenant(UUID userId, String tempPassword, UUID branchId) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/auth/tenants/.*/provision-admin"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"userId\":\"" + userId + "\",\"tempPassword\":\"" + tempPassword
                    + "\",\"branchId\":\"" + branchId + "\",\"roleCode\":\"OWNER\","
                    + "\"mustChangePassword\":true}}")));
    }

    protected void stubFinanceSeedCoa(UUID tenantId) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo(
                "/internal/finance/tenants/" + tenantId + "/seed-coa"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{}}")));
    }

    /**
     * Every external call the provisioning saga makes, all succeeding — in ONE place, so a future
     * saga step is added to one helper rather than silently missed by whichever test classes happen
     * to drive {@code provision()} for their own setup. Adding the 13-10 auth-tenant registration
     * step broke {@code TenantLifecycleIT} and {@code FeatureFlagInvalidationIT} precisely because
     * each had hand-rolled its own partial stub set.
     */
    protected void stubProvisioningSagaHappyPath(UUID adminUserId, UUID branchId, String tempPassword) {
        stubUserCreateBranch(branchId);
        stubUserDeactivateBranch();
        stubAuthRegisterTenant();
        stubAuthSetTenantStatus();
        stubAuthRevokeBranchRole();
        stubAuthProvisionAdminAnyTenant(adminUserId, tempPassword, branchId);
    }

    protected void stubFinanceSeedCoaAnyTenant() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/finance/tenants/.*/seed-coa"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{}}")));
    }

    protected void stubFinanceSeedCoaFail() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathMatching("/internal/finance/tenants/.*/seed-coa"))
            .willReturn(WireMock.aResponse().withStatus(500).withBody("{\"error\":\"simulated\"}")));
    }
}
