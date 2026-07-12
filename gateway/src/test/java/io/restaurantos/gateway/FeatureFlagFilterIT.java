package io.restaurantos.gateway;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import io.restaurantos.shared.security.JwksKeyProvider;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.cloud.gateway.route.RouteLocator;
import org.springframework.cloud.gateway.route.builder.RouteLocatorBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
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
 * Integration test for {@link io.restaurantos.gateway.filter.FeatureFlagGlobalFilter}.
 *
 * <p>Uses a real Redis 7 container (Testcontainers {@link GenericContainer}) and
 * {@link MockWebServer} as the upstream. Seeds Redis directly and verifies the
 * filter enforces the correct responses.
 *
 * <h3>Assertions:</h3>
 * <ul>
 *   <li>{@code tenant:status:{tid}=SUSPENDED} → 403 TENANT_SUSPENDED, upstream untouched.</li>
 *   <li>{@code tenant:status:{tid}=ACTIVE} + {@code tenant_features:{tid}:FEATURE_HR=false}
 *       on {@code /api/v1/hr/**} → 403 FEATURE_DISABLED with {@code X-Upgrade-CTA-URL} header.</li>
 *   <li>Same but FEATURE_HR=true → forwarded to upstream.</li>
 *   <li>{@code nlq_quota:{tid}:monthly_count} over limit on {@code /api/v1/nlq/**} → 429 QUOTA_EXCEEDED.</li>
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
@Import(FeatureFlagFilterIT.TestConfig.class)
@Testcontainers
class FeatureFlagFilterIT {

    @SuppressWarnings("resource")
    @Container
    static GenericContainer<?> redis = new GenericContainer<>("redis:7-alpine")
            .withExposedPorts(6379);

    @DynamicPropertySource
    static void redisProps(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379).toString());
    }

    static KeyPair keyPair;
    static final String TEST_KID = "ff-test-key";
    static MockWebServer mockUpstream;

    @LocalServerPort
    int port;

    WebTestClient webTestClient;

    @Autowired
    StringRedisTemplate redisTemplate;

    UUID tenantId;
    String validToken;

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
    void setup() throws Exception {
        webTestClient = WebTestClient.bindToServer()
                .baseUrl("http://localhost:" + port)
                .build();

        tenantId = UUID.randomUUID();
        validToken = buildToken(tenantId);

        // Clear any leftover Redis keys from previous tests
        redisTemplate.delete("tenant:status:" + tenantId);
        redisTemplate.delete("tenant_features:" + tenantId + ":FEATURE_HR");
        redisTemplate.delete("tenant_features:" + tenantId + ":FEATURE_NLQ");
        redisTemplate.delete("nlq_quota:" + tenantId + ":monthly_count");
    }

    @AfterEach
    void cleanup() throws InterruptedException {
        // Drain any leftover recorded requests from MockWebServer.
        // Use a short timeout — getRequestCount() is cumulative and cannot be used safely.
        while (mockUpstream.takeRequest(50, TimeUnit.MILLISECONDS) != null) {
            // drain
        }
    }

    // ── Test 1: SUSPENDED tenant → 403 TENANT_SUSPENDED ────────────────────────────────

    @Test
    void suspendedTenant_returns403() {
        redisTemplate.opsForValue().set("tenant:status:" + tenantId, "SUSPENDED");
        int before = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isForbidden()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("TENANT_SUSPENDED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(before);
    }

    // ── Test 2: ACTIVE tenant, FEATURE_HR disabled → 403 FEATURE_DISABLED + CTA header ─

    @Test
    void featureDisabled_returns403WithCtaHeader() {
        redisTemplate.opsForValue().set("tenant:status:" + tenantId, "ACTIVE");
        redisTemplate.opsForValue().set("tenant_features:" + tenantId + ":FEATURE_HR", "false");
        int before = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isForbidden()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("FEATURE_DISABLED"))
                .returnResult()
                .getResponseHeaders()
                .forEach((name, values) -> {
                    if ("X-Upgrade-CTA-URL".equals(name)) {
                        assertThat(values.get(0)).contains("FEATURE_HR");
                    }
                });

        // Verify the header is present
        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectHeader().exists("X-Upgrade-CTA-URL");

        assertThat(mockUpstream.getRequestCount()).isEqualTo(before);
    }

    // ── Test 3: ACTIVE tenant, FEATURE_HR enabled → forwarded ───────────────────────────

    @Test
    void featureEnabled_requestForwarded() throws Exception {
        redisTemplate.opsForValue().set("tenant:status:" + tenantId, "ACTIVE");
        redisTemplate.opsForValue().set("tenant_features:" + tenantId + ":FEATURE_HR", "true");
        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{\"employees\":[]}"));

        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isOk();

        assertThat(mockUpstream.getRequestCount()).isEqualTo(1);
    }

    // ── Test 4: NLQ quota exceeded → 429 QUOTA_EXCEEDED ─────────────────────────────────

    @Test
    void nlqQuotaExceeded_returns429() {
        redisTemplate.opsForValue().set("tenant:status:" + tenantId, "ACTIVE");
        redisTemplate.opsForValue().set("tenant_features:" + tenantId + ":FEATURE_NLQ", "true");
        // Set count above the 5000 default limit
        redisTemplate.opsForValue().set("nlq_quota:" + tenantId + ":monthly_count", "5001");
        int before = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/nlq/query")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                // Over-quota is 429 TOO_MANY_REQUESTS, not 403 — 403 is reserved for
                // FEATURE_DISABLED. The filter has always returned 429 here; this
                // assertion previously expected 403 and failed.
                .expectStatus().isEqualTo(HttpStatus.TOO_MANY_REQUESTS)
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("QUOTA_EXCEEDED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(before);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────

    private String buildToken(UUID tenantId) throws Exception {
        Date now = new Date();
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(UUID.randomUUID().toString())
                .claim("tenant_id", tenantId.toString())
                .claim("roles", List.of("TENANT_ADMIN"))
                .claim("permissions", List.of())
                .claim("attributes", Map.of())
                .issueTime(now)
                .expirationTime(new Date(now.getTime() + 3_600_000))
                .build();
        SignedJWT jwt = new SignedJWT(
                new JWSHeader.Builder(JWSAlgorithm.RS256).keyID(TEST_KID).build(),
                claims
        );
        jwt.sign(new RSASSASigner(keyPair.getPrivate()));
        return jwt.serialize();
    }

    @TestConfiguration
    static class TestConfig {

        @Bean
        public JwksKeyProvider jwksKeyProvider() throws Exception {
            if (keyPair == null) {
                KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
                gen.initialize(2048);
                keyPair = gen.generateKeyPair();
            }
            return new JwksKeyProvider(TEST_KID, (RSAPublicKey) keyPair.getPublic());
        }

        @Bean
        public RouteLocator testRoutes(RouteLocatorBuilder builder) {
            int port = mockUpstream.getPort();
            return builder.routes()
                    .route("test-hr-route", r -> r
                            .path("/api/v1/hr/**")
                            .uri("http://localhost:" + port))
                    .route("test-nlq-route", r -> r
                            .path("/api/v1/nlq/**")
                            .uri("http://localhost:" + port))
                    .build();
        }
    }
}
