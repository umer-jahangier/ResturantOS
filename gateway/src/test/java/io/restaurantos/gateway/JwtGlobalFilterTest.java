package io.restaurantos.gateway;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import io.restaurantos.shared.security.JwksKeyProvider;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit/slice test for {@link io.restaurantos.gateway.filter.JwtGlobalFilter}.
 *
 * <p>Uses a static {@link MockWebServer} (started in {@code @BeforeAll} so the port is
 * known at Spring context initialization time) and a Testcontainers Redis container (required
 * by the {@code RequestRateLimiter} default filter). A pre-seeded {@link JwksKeyProvider}
 * trusts a test RS256 keypair without making any HTTP calls.
 *
 * <h3>Assertions:</h3>
 * <ul>
 *   <li>Protected route, no Authorization header → 401 UNAUTHENTICATED; upstream got 0 requests.</li>
 *   <li>Public path {@code /api/v1/auth/login} with no JWT → forwarded.</li>
 *   <li>Valid JWT → forwarded with X-Tenant-Id and X-User-Id; inbound X-Internal-Service stripped.</li>
 *   <li>Expired/garbage JWT → 401.</li>
 *   <li>Inbound X-TOTP-Verified is destroyed and rewritten from the signed {@code totp_verified}
 *       claim — on authenticated routes and on public paths alike.</li>
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "spring.main.web-application-type=reactive",
                "spring.cloud.gateway.server.webflux.trusted-proxies=.*",
                "restaurantos.fail-open-on-platform-down=true",
                "restaurantos.platform-admin.uri=http://localhost:9999",
                "restaurantos.jwks.uri=http://localhost:9999/.well-known/jwks.json",
                // Bind Netty to LOOPBACK ONLY. This is the fix for the
                // `PrematureCloseException: Connection prematurely closed BEFORE response` that
                // plan 13-01 investigated, time-boxed and left explicitly unresolved, and it is a
                // SECOND cause distinct from the JDK-version one in DEV-STACK-RUNBOOK.md.
                //
                // Spring Boot binds the test server to the wildcard address, so the listener is
                // LAN-reachable; macOS's Application Firewall filters incoming connections to
                // wildcard-bound sockets per binary and, when it decides against one, accepts and
                // closes it having written zero bytes. Hence a client-side EOF and complete silence
                // server-side. Loopback traffic is never filtered, so this removes the firewall
                // from the path rather than asking it for permission — the runbook is explicit that
                // approving a JDK binary is not an acceptable fix. Measured: 18/18 errors before,
                // 0 after, same commit. CI (Linux) is unaffected.
                "server.address=127.0.0.1",
                "eureka.client.enabled=false",
                "spring.cloud.discovery.enabled=false",
                "spring.main.allow-bean-definition-overriding=true"
        })
@Import(JwtGlobalFilterTest.TestRouteConfig.class)
@Testcontainers
class JwtGlobalFilterTest {

    @SuppressWarnings("resource")
    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379).toString());
        // Expose the mock upstream port to the test route config
        registry.add("test.upstream.port", () -> mockUpstream.getPort());
    }

    static KeyPair keyPair;
    static final String TEST_KID = "jwt-test-key";
    static MockWebServer mockUpstream;

    @LocalServerPort
    int port;

    WebTestClient webTestClient;

    @BeforeAll
    static void startMockUpstream() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();

        mockUpstream = new MockWebServer();
        mockUpstream.start();
    }

    @AfterAll
    static void stopMockUpstream() throws Exception {
        if (mockUpstream != null) {
            mockUpstream.shutdown();
        }
    }

    @BeforeEach
    void setUp() throws InterruptedException {
        webTestClient = WebTestClient.bindToServer()
                .baseUrl("http://localhost:" + port)
                .build();
        // Drain leftover requests: use a short timeout so we don't block forever.
        // Note: getRequestCount() is cumulative and never resets, so we cannot use it
        // as a termination condition for takeRequest() calls.
        while (mockUpstream.takeRequest(50, TimeUnit.MILLISECONDS) != null) {
            // drain
        }
    }

    // ── Test 1: No Authorization header on protected route → 401, upstream untouched ──────

    @Test
    void protectedRoute_noToken_returns401_upstreamNotCalled() {
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/users/profile")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("UNAUTHENTICATED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
    }

    // ── Test 2: Public path /api/v1/auth/login with no JWT → forwarded ──────────────────

    @Test
    void publicPath_noToken_isForwarded() {
        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{\"token\":\"xyz\"}"));
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.post()
                .uri("/api/v1/auth/login")
                .bodyValue("{\"email\":\"test@example.com\",\"password\":\"secret\"}")
                .header(HttpHeaders.CONTENT_TYPE, "application/json")
                .exchange()
                .expectStatus().isOk();

        assertThat(mockUpstream.getRequestCount()).isGreaterThan(requestsBefore);
    }

    // ── Test 3: Valid JWT → X-Tenant-Id + X-User-Id injected, X-Internal-Service stripped ──

    @Test
    void validJwt_headersInjected_internalServiceStripped() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = buildToken(TEST_KID, userId, tenantId, false);

        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.get()
                .uri("/api/v1/users/me")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .header("X-Internal-Service", "attacker-value")
                .exchange()
                .expectStatus().isOk();

        RecordedRequest upstreamRequest = mockUpstream.takeRequest();
        assertThat(upstreamRequest.getHeader("X-Tenant-Id")).isEqualTo(tenantId.toString());
        assertThat(upstreamRequest.getHeader("X-User-Id")).isEqualTo(userId.toString());
        assertThat(upstreamRequest.getHeader("X-Internal-Service")).isNull();
    }

    // ── Test 4: Expired JWT → 401 ────────────────────────────────────────────────────────

    @Test
    void expiredJwt_returns401() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String expiredToken = buildToken(TEST_KID, userId, tenantId, true);
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/users/profile")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + expiredToken)
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("UNAUTHENTICATED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
    }

    // ── Test 5: Garbage token → 401 ──────────────────────────────────────────────────────

    @Test
    void garbageToken_returns401() {
        webTestClient.get()
                .uri("/api/v1/users/profile")
                .header(HttpHeaders.AUTHORIZATION, "Bearer not.a.real.token")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    // ── Test 6: forged X-TOTP-Verified is destroyed and rewritten from the claim ──────────

    /**
     * The audit HIGH-6 bypass, at the layer that has to stop it.
     *
     * <p>hr-service's payroll approval and finance-service's period close both read
     * {@code X-TOTP-Verified} and trust it absolutely. Nothing used to set, validate or strip it,
     * so a caller who held {@code hr.payroll.approve} simply sent {@code true} and disbursed money
     * with no second factor. Holding the permission is NOT the question here — this token holds
     * none — the question is whether the client's own word about its second factor can reach an
     * upstream at all. It must arrive as {@code false}: not merely absent (which would leave the
     * upstream's {@code defaultValue="false"} doing the work) but overwritten by the gateway.
     */
    @Test
    void forgedTotpVerifiedHeader_isReplacedWithFalse() throws Exception {
        String token = buildToken(TEST_KID, UUID.randomUUID(), UUID.randomUUID(), false, null);

        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.post()
                .uri("/api/v1/users/payroll-runs/x/approve")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .header("X-TOTP-Verified", "true")
                .exchange()
                .expectStatus().isOk();

        RecordedRequest upstreamRequest = mockUpstream.takeRequest();
        assertThat(upstreamRequest.getHeaders().values("X-TOTP-Verified"))
                .as("exactly one gateway-authored value; the client's must not survive alongside it")
                .containsExactly("false");
    }

    /** The claim the token really carries is the one the upstream sees. */
    @Test
    void genuineTotpVerifiedClaim_isInjectedAsTrue() throws Exception {
        String token = buildToken(TEST_KID, UUID.randomUUID(), UUID.randomUUID(), false, true);

        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.post()
                .uri("/api/v1/users/payroll-runs/x/approve")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isOk();

        RecordedRequest upstreamRequest = mockUpstream.takeRequest();
        assertThat(upstreamRequest.getHeader("X-TOTP-Verified")).isEqualTo("true");
    }

    /**
     * The strip must not depend on authentication succeeding. A public path never reaches
     * JwtGlobalFilter's injection step, so if stripping lived there instead of in the
     * earlier-ordered StripInternalHeaderFilter, a forged header would ride straight through.
     */
    @Test
    void forgedTotpVerifiedHeader_onPublicPath_isStripped() {
        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.post()
                .uri("/api/v1/auth/login")
                .header("X-TOTP-Verified", "true")
                .bodyValue("{}")
                .header(HttpHeaders.CONTENT_TYPE, "application/json")
                .exchange()
                .expectStatus().isOk();

        RecordedRequest upstreamRequest = takeNext();
        assertThat(upstreamRequest.getHeader("X-TOTP-Verified")).isNull();
    }

    /**
     * 13-11's role ceiling bounds a role assignment by the permissions of the user named in
     * {@code X-Acting-User-Id}, which the CALLING SERVICE asserts from a verified JWT. A client
     * able to set it would be choosing which authority to be measured against — so, like the other
     * two, it is removed unconditionally and regardless of whether the request authenticates.
     *
     * <p>The control assertion is not decorative: without it this test would still pass against a
     * gateway that dropped every header, or against a request that never reached the upstream at
     * all.
     */
    @Test
    void forgedActingUserHeader_isStripped() {
        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.post()
                .uri("/api/v1/auth/login")
                .header("X-Acting-User-Id", UUID.randomUUID().toString())
                .header("X-Control-Header", "survives")
                .bodyValue("{}")
                .header(HttpHeaders.CONTENT_TYPE, "application/json")
                .exchange()
                .expectStatus().isOk();

        RecordedRequest upstreamRequest = takeNext();
        assertThat(upstreamRequest.getHeader("X-Acting-User-Id")).isNull();
        assertThat(upstreamRequest.getHeader("X-Control-Header"))
                .as("an ordinary client header still reaches the upstream, so the assertion above "
                    + "measures the strip rather than a request that never arrived")
                .isEqualTo("survives");
    }

    // ── Tenant-less (platform) tokens: accepted on the platform prefix, nowhere else ──────

    /**
     * Audit B1, cause 3. A platform user belongs to no tenant, so its token carries no
     * {@code tenant_id}; {@code TenantResolutionSupport} therefore errors and
     * {@code authorizeAndForward} used to turn that into a 401 — making the whole
     * {@code /api/v1/platform/**} API unreachable even with a perfectly valid SuperAdmin token.
     *
     * <p>The request must arrive upstream with NO {@code X-Tenant-Id} at all. Not a placeholder,
     * not an empty string: the upstream has to be able to tell "control plane" from "some tenant"
     * (threat T-13-01-D).
     */
    @Test
    void tenantLessToken_onPlatformPath_isForwardedWithoutTenantHeader() throws Exception {
        UUID platformUserId = UUID.randomUUID();
        String token = buildTenantLessToken(platformUserId);

        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{\"data\":[]}"));

        webTestClient.get()
                .uri("/api/v1/platform/tenants")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isOk();

        RecordedRequest upstreamRequest = takeNext();
        assertThat(upstreamRequest.getHeader("X-User-Id")).isEqualTo(platformUserId.toString());
        assertThat(upstreamRequest.getHeader("X-Tenant-Id"))
                .as("a control-plane request must not carry, or imply, any tenant")
                .isNull();
        assertThat(upstreamRequest.getHeader("X-TOTP-Verified"))
                .as("still gateway-authored on this branch, so no upstream has to interpret absence")
                .isEqualTo("false");
    }

    /**
     * The T-13-01-A prohibition, on the two routes the audit called out by name. The exemption is
     * keyed on the platform prefix; a tenant-less token is worthless everywhere else and must be
     * rejected at the gateway, before any upstream sees it.
     */
    @Test
    void tenantLessToken_onPosRoute_returns401() throws Exception {
        String token = buildTenantLessToken(UUID.randomUUID());
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/pos/orders")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("UNAUTHENTICATED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
    }

    @Test
    void tenantLessToken_onUsersRoute_returns401() throws Exception {
        String token = buildTenantLessToken(UUID.randomUUID());
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/users/me")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isUnauthorized();

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
    }

    /** The exemption is additive: a tenant-bearing token on the platform prefix is unchanged. */
    @Test
    void tenantBearingToken_onPlatformPath_stillCarriesItsTenantHeader() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = buildToken(TEST_KID, userId, tenantId, false);

        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.get()
                .uri("/api/v1/platform/tenants")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .exchange()
                .expectStatus().isOk();

        RecordedRequest upstreamRequest = takeNext();
        assertThat(upstreamRequest.getHeader("X-Tenant-Id")).isEqualTo(tenantId.toString());
        assertThat(upstreamRequest.getHeader("X-User-Id")).isEqualTo(userId.toString());
    }

    /** The platform prefix is tenant-optional, not authentication-optional. */
    @Test
    void platformPath_withNoOrMalformedAuthHeader_returns401() {
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/platform/tenants")
                .exchange()
                .expectStatus().isUnauthorized();

        webTestClient.get()
                .uri("/api/v1/platform/tenants")
                .header(HttpHeaders.AUTHORIZATION, "Bearer not.a.real.token")
                .exchange()
                .expectStatus().isUnauthorized();

        webTestClient.get()
                .uri("/api/v1/platform/tenants")
                .header(HttpHeaders.AUTHORIZATION, "Basic YWRtaW46YWRtaW4=")
                .exchange()
                .expectStatus().isUnauthorized();

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────

    /**
     * A platform token as {@code JwtSigningService.signPlatformToken} mints it: the tenant and
     * branch claim keys are ABSENT, not null-valued.
     */
    private String buildTenantLessToken(UUID platformUserId) throws Exception {
        Date now = new Date();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(platformUserId.toString())
                .claim("roles", List.of("SUPER_ADMIN"))
                .claim("permissions", List.of("SUPER_ADMIN"))
                .claim("token_type", "platform")
                .claim("totp_verified", false)
                .issueTime(now)
                .expirationTime(new Date(now.getTime() + 3_600_000))
                .build();

        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(TEST_KID).build(), claims);
        jwt.sign(new RSASSASigner(keyPair.getPrivate()));
        return jwt.serialize();
    }

    private RecordedRequest takeNext() {
        try {
            RecordedRequest request = mockUpstream.takeRequest(5, TimeUnit.SECONDS);
            assertThat(request).as("upstream should have received a request").isNotNull();
            return request;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private String buildToken(String kid, UUID userId, UUID tenantId, boolean expired) throws Exception {
        return buildToken(kid, userId, tenantId, expired, null);
    }

    /**
     * @param totpVerified value of the {@code totp_verified} claim, or {@code null} to omit it
     *                     entirely — which is what every token minted before the claim existed
     *                     looks like, and must read as "no step-up".
     */
    private String buildToken(String kid, UUID userId, UUID tenantId, boolean expired,
                              Boolean totpVerified) throws Exception {
        Date now = new Date();
        Date exp = expired
                ? new Date(now.getTime() - 60_000)
                : new Date(now.getTime() + 3_600_000);

        JWTClaimsSet.Builder builder = new JWTClaimsSet.Builder()
                .subject(userId.toString())
                .claim("tenant_id", tenantId.toString())
                .claim("roles", List.of("TENANT_ADMIN"))
                .claim("permissions", List.of())
                .claim("attributes", Map.of())
                .issueTime(now)
                .expirationTime(exp);
        if (totpVerified != null) {
            builder.claim("totp_verified", totpVerified);
        }
        JWTClaimsSet claims = builder.build();

        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(kid).build(),
                claims
        );
        jwt.sign(new RSASSASigner(keyPair.getPrivate()));
        return jwt.serialize();
    }

    /**
     * Test configuration: provides a pre-seeded JwksKeyProvider (no HTTP fetching)
     * and routes that wire the MockWebServer as the upstream.
     *
     * <p>The MockWebServer is started in {@code @BeforeAll} before Spring context creation,
     * so the port is available via {@code @DynamicPropertySource} at bean wiring time.
     */
    @TestConfiguration
    static class TestRouteConfig {

        @Bean
        public JwksKeyProvider jwksKeyProvider() {
            return new JwksKeyProvider(TEST_KID, (RSAPublicKey) keyPair.getPublic());
        }

        @Bean
        public RouteLocator testRoutes(RouteLocatorBuilder builder) {
            int port = mockUpstream.getPort();
            return builder.routes()
                    .route("test-user-route", r -> r
                            .path("/api/v1/users/**")
                            .uri("http://localhost:" + port))
                    .route("test-auth-route", r -> r
                            .path("/api/v1/auth/**")
                            .uri("http://localhost:" + port))
                    .route("test-platform-route", r -> r
                            .path("/api/v1/platform/**")
                            .uri("http://localhost:" + port))
                    .route("test-pos-route", r -> r
                            .path("/api/v1/pos/**")
                            .uri("http://localhost:" + port))
                    .build();
        }
    }
}
