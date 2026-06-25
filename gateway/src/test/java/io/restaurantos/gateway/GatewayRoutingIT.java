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
import org.springframework.cloud.gateway.filter.ratelimit.KeyResolver;
import org.springframework.cloud.gateway.filter.ratelimit.RedisRateLimiter;
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
import java.time.Duration;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Integration test for gateway routing, rate limiting, and circuit-breaker fallback.
 *
 * <p>Uses Testcontainers (Redis 7) for real token-bucket rate limiting and
 * {@link MockWebServer} as the upstream.
 *
 * <h3>Assertions:</h3>
 * <ul>
 *   <li>Rate limit: fire > burstCapacity requests from a fixed X-Forwarded-For IP →
 *       at least one 429 TOO_MANY_REQUESTS (proves token-bucket is working).</li>
 *   <li>Per-IP keying: two distinct IPs get independent rate-limit buckets
 *       (proves Pitfall 2 fix — X-Forwarded-For is being keyed correctly).</li>
 *   <li>Circuit-breaker fallback: point a route at a dead upstream →
 *       response is 503 SERVICE_UNAVAILABLE with the fallback body (not a hang/timeout error).</li>
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
                "spring.main.allow-bean-definition-overriding=true",
                // Very tight auth rate limit for testing: 1 token/sec, burst=3
                "RATE_LIMIT_AUTH_PER_MIN=3"
        })
@Import(GatewayRoutingIT.TestConfig.class)
@Testcontainers
class GatewayRoutingIT {

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
    static final String TEST_KID = "routing-test-key";
    static MockWebServer liveUpstream;
    static int deadPort;

    @LocalServerPort
    int port;

    WebTestClient webTestClient;

    @Autowired
    StringRedisTemplate redisTemplate;

    UUID tenantId;
    String validToken;

    @BeforeAll
    static void startUpstreams() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();

        liveUpstream = new MockWebServer();
        liveUpstream.start();

        // Find a free port to act as dead upstream
        try (var socket = new java.net.ServerSocket(0)) {
            deadPort = socket.getLocalPort();
        }
    }

    @AfterAll
    static void stopUpstreams() throws Exception {
        if (liveUpstream != null) {
            liveUpstream.shutdown();
        }
    }

    @BeforeEach
    void setup() throws Exception {
        webTestClient = WebTestClient.bindToServer()
                .baseUrl("http://localhost:" + port)
                .build();
        tenantId = UUID.randomUUID();
        validToken = buildToken(tenantId);
    }

    @AfterEach
    void cleanup() throws InterruptedException {
        // Drain leftover recorded requests from MockWebServer between tests.
        while (liveUpstream.takeRequest(50, TimeUnit.MILLISECONDS) != null) {
            // drain
        }
    }

    // ── Test 1: Rate limiting — at least one 429 from a single IP ───────────────────────

    @Test
    void rateLimiting_singleIp_returns429() {
        // Enqueue enough responses to absorb the burst
        for (int i = 0; i < 20; i++) {
            liveUpstream.enqueue(new MockResponse()
                    .setResponseCode(200)
                    .setBody("{\"token\":\"test\"}"));
        }

        String fixedIp = "10.0.0.1";
        AtomicInteger rateLimited = new AtomicInteger(0);

        // Fire > burst capacity (3) requests from the same IP
        for (int i = 0; i < 10; i++) {
            webTestClient.post()
                    .uri("/api/v1/auth/login")
                    .header("X-Forwarded-For", fixedIp)
                    .header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .bodyValue("{\"email\":\"t@t.com\",\"password\":\"p\"}")
                    .exchange()
                    .expectStatus()
                    .value(status -> {
                        if (status == HttpStatus.TOO_MANY_REQUESTS.value()) {
                            rateLimited.incrementAndGet();
                        }
                    });
        }

        // At least one request must have been rate-limited
        assertThat(rateLimited.get())
                .as("Expected at least one 429 from rate limiting")
                .isGreaterThan(0);
    }

    // ── Test 2: Per-IP keying — two IPs get independent buckets ─────────────────────────

    @Test
    void rateLimiting_twoIps_independentBuckets() {
        // Enqueue responses
        for (int i = 0; i < 30; i++) {
            liveUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{}"));
        }

        String ip1 = "10.1.1.1";
        String ip2 = "10.2.2.2";

        // Exhaust IP1 bucket (send > burst)
        List<Integer> ip1Statuses = new ArrayList<>();
        for (int i = 0; i < 10; i++) {
            webTestClient.post()
                    .uri("/api/v1/auth/login")
                    .header("X-Forwarded-For", ip1)
                    .header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .bodyValue("{}")
                    .exchange()
                    .expectStatus()
                    .value(ip1Statuses::add);
        }

        // IP2 should still get through (its bucket is independent and full)
        List<Integer> ip2Statuses = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            webTestClient.post()
                    .uri("/api/v1/auth/login")
                    .header("X-Forwarded-For", ip2)
                    .header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .bodyValue("{}")
                    .exchange()
                    .expectStatus()
                    .value(ip2Statuses::add);
        }

        // IP1 was rate-limited
        assertThat(ip1Statuses)
                .as("IP1 should have received at least one 429")
                .contains(HttpStatus.TOO_MANY_REQUESTS.value());

        // IP2's first requests should NOT be rate-limited (independent bucket)
        assertThat(ip2Statuses.subList(0, Math.min(2, ip2Statuses.size())))
                .as("IP2 should not be rate-limited by IP1's exhaustion")
                .doesNotContain(HttpStatus.TOO_MANY_REQUESTS.value());
    }

    // ── Test 3: Circuit-breaker fallback — dead upstream → 503 with fallback body ────────

    @Test
    void circuitBreakerFallback_deadUpstream_returns503() {
        // The test platform-admin route uses deadUpstream's port
        // The WebTestClient calls a route that should trip the circuit breaker
        // We configure the test route to point at the dead upstream

        webTestClient.mutate()
                .responseTimeout(Duration.ofSeconds(5))
                .build()
                .get()
                .uri("/api/v1/dead-upstream/test")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("SERVICE_UNAVAILABLE"));
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
        public RouteLocator testRoutes(RouteLocatorBuilder builder,
                                       RedisRateLimiter rateLimiter,
                                       KeyResolver ipKeyResolver) {
            // Configure tight per-route rate limit (burst=3) so tests trigger 429 reliably.
            // getConfig() returns a mutable map; put() registers the config keyed by routeId.
            rateLimiter.getConfig().put("test-auth-login", new RedisRateLimiter.Config()
                    .setReplenishRate(1)
                    .setBurstCapacity(3)
                    .setRequestedTokens(1));

            int livePort = liveUpstream.getPort();
            return builder.routes()
                    // Auth route: explicit rate limiter with burst=3 to make 429 easy to trigger
                    .route("test-auth-login", r -> r
                            .path("/api/v1/auth/login")
                            .filters(f -> f
                                    .requestRateLimiter(c -> c
                                            .setRateLimiter(rateLimiter)
                                            .setKeyResolver(ipKeyResolver)
                                            .setDenyEmptyKey(false)))
                            .uri("http://localhost:" + livePort))
                    // Dead upstream route: will trip circuit breaker immediately
                    .route("test-dead-upstream", r -> r
                            .path("/api/v1/dead-upstream/**")
                            .filters(f -> f
                                    .circuitBreaker(config -> config
                                            .setName("deadCircuitBreaker")
                                            .setFallbackUri("forward:/fallback/service-unavailable")))
                            .uri("http://localhost:" + GatewayRoutingIT.deadPort))
                    .build();
        }
    }
}
