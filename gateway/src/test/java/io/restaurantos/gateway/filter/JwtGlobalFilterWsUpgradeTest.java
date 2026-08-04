package io.restaurantos.gateway.filter;

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
 * Regression coverage for the 12-12 gap closure (12-E2E-EVIDENCE §1h): {@link JwtGlobalFilter}
 * must validate a {@code ?token=} query-param JWT for genuine WebSocket UPGRADE handshakes on the
 * reporting-dashboard and kitchen (KDS) socket path prefixes — using the SAME RS256/JWKS
 * validation path used for the {@code Authorization} header — while leaving ordinary (non-upgrade)
 * REST traffic strictly header-only.
 *
 * <h3>Assertions:</h3>
 * <ul>
 *   <li>WS upgrade to {@code /api/v1/reporting/dashboard/<branchId>?token=<validJwt>} → forwarded,
 *       mutated request carries {@code X-Tenant-Id} + {@code X-User-Id}.</li>
 *   <li>Same path/upgrade with NO {@code token} query param → 401, upstream NOT called.</li>
 *   <li>Same path/upgrade with an invalid/garbage {@code token} → 401, upstream NOT called.</li>
 *   <li>WS upgrade to {@code /api/v1/kitchen/<branchId>/<stationId>?token=<validJwt>} → forwarded
 *       (proves KDS is fixed by the same code).</li>
 *   <li>A NON-upgrade GET to a reporting REST path with {@code ?token=<validJwt>} but no
 *       {@code Authorization} header → 401 (query-param fallback must NOT apply to ordinary REST).</li>
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
@Import(JwtGlobalFilterWsUpgradeTest.TestRouteConfig.class)
@Testcontainers
class JwtGlobalFilterWsUpgradeTest {

    @SuppressWarnings("resource")
    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379).toString());
        registry.add("test.upstream.port", () -> mockUpstream.getPort());
    }

    static KeyPair keyPair;
    static final String TEST_KID = "jwt-ws-test-key";
    static MockWebServer mockUpstream;

    static final UUID BRANCH_ID = UUID.randomUUID();
    static final UUID STATION_ID = UUID.randomUUID();

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
        while (mockUpstream.takeRequest(50, TimeUnit.MILLISECONDS) != null) {
            // drain
        }
    }

    // ── Test 1: WS upgrade + valid ?token= on the dashboard path → forwarded, headers injected ──

    @Test
    void wsUpgrade_dashboardPath_validToken_isForwarded_withIdentityHeaders() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = buildToken(TEST_KID, userId, tenantId, false);

        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.get()
                .uri("/api/v1/reporting/dashboard/" + BRANCH_ID + "?token=" + token)
                .header(HttpHeaders.CONNECTION, "Upgrade")
                .header(HttpHeaders.UPGRADE, "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                .exchange()
                .expectStatus().isEqualTo(org.springframework.http.HttpStatus.SWITCHING_PROTOCOLS);

        RecordedRequest upstreamRequest = mockUpstream.takeRequest();
        assertThat(upstreamRequest.getHeader("X-Tenant-Id")).isEqualTo(tenantId.toString());
        assertThat(upstreamRequest.getHeader("X-User-Id")).isEqualTo(userId.toString());
    }

    // ── Test 2: WS upgrade, dashboard path, NO token → 401, upstream not called ──────────────

    @Test
    void wsUpgrade_dashboardPath_noToken_returns401_upstreamNotCalled() {
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/reporting/dashboard/" + BRANCH_ID)
                .header(HttpHeaders.CONNECTION, "Upgrade")
                .header(HttpHeaders.UPGRADE, "websocket")
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("UNAUTHENTICATED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
    }

    // ── Test 3: WS upgrade, dashboard path, garbage token → 401, upstream not called ─────────

    @Test
    void wsUpgrade_dashboardPath_garbageToken_returns401_upstreamNotCalled() {
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/reporting/dashboard/" + BRANCH_ID + "?token=not.a.real.token")
                .header(HttpHeaders.CONNECTION, "Upgrade")
                .header(HttpHeaders.UPGRADE, "websocket")
                .exchange()
                .expectStatus().isUnauthorized();

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
    }

    // ── Test 4: WS upgrade + valid ?token= on the KDS path → forwarded (same code fixes KDS) ──

    @Test
    void wsUpgrade_kitchenPath_validToken_isForwarded() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = buildToken(TEST_KID, userId, tenantId, false);

        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));

        webTestClient.get()
                .uri("/api/v1/kitchen/" + BRANCH_ID + "/" + STATION_ID + "?token=" + token)
                .header(HttpHeaders.CONNECTION, "Upgrade")
                .header(HttpHeaders.UPGRADE, "websocket")
                .header("Sec-WebSocket-Version", "13")
                .header("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
                .exchange()
                .expectStatus().isEqualTo(org.springframework.http.HttpStatus.SWITCHING_PROTOCOLS);

        RecordedRequest upstreamRequest = mockUpstream.takeRequest();
        assertThat(upstreamRequest.getHeader("X-Tenant-Id")).isEqualTo(tenantId.toString());
        assertThat(upstreamRequest.getHeader("X-User-Id")).isEqualTo(userId.toString());
    }

    // ── Test 5: NON-upgrade REST request with ?token= but no header → still 401 ──────────────

    @Test
    void nonUpgradeRestRequest_queryParamTokenOnly_stillReturns401() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        String token = buildToken(TEST_KID, userId, tenantId, false);
        int requestsBefore = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/reporting/reports/sales-by-day?token=" + token)
                .exchange()
                .expectStatus().isUnauthorized()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("UNAUTHENTICATED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(requestsBefore);
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
     * Test configuration: provides a pre-seeded JwksKeyProvider (no HTTP fetching) and routes
     * that wire the MockWebServer as the upstream for the reporting and kitchen path prefixes.
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
                    .route("test-reporting-route", r -> r
                            .path("/api/v1/reporting/**")
                            .uri("http://localhost:" + port))
                    .route("test-kitchen-route", r -> r
                            .path("/api/v1/kitchen/**")
                            .uri("http://localhost:" + port))
                    .build();
        }
    }
}
