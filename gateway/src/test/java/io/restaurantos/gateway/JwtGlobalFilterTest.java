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
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "spring.main.web-application-type=reactive",
                "spring.cloud.gateway.server.webflux.trusted-proxies=.*",
                "restaurantos.fail-open-on-platform-down=true",
                "restaurantos.platform-admin.uri=http://localhost:9999",
                "restaurantos.jwks.uri=http://localhost:9999/.well-known/jwks.json",
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

    // ── Helpers ───────────────────────────────────────────────────────────────────────────

    private String buildToken(String kid, UUID userId, UUID tenantId, boolean expired) throws Exception {
        Date now = new Date();
        Date exp = expired
                ? new Date(now.getTime() - 60_000)
                : new Date(now.getTime() + 3_600_000);

        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(userId.toString())
                .claim("tenant_id", tenantId.toString())
                .claim("roles", List.of("TENANT_ADMIN"))
                .claim("permissions", List.of())
                .claim("attributes", Map.of())
                .issueTime(now)
                .expirationTime(exp)
                .build();

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
                    .build();
        }
    }
}
