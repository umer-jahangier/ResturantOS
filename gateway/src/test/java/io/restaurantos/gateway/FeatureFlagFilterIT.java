package io.restaurantos.gateway;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import io.restaurantos.gateway.filter.FeatureFlagGlobalFilter;
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
import org.springframework.test.util.ReflectionTestUtils;
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
 * <p>Uses a real Redis 7 container (Testcontainers {@link GenericContainer}) and two
 * {@link MockWebServer}s — one standing in for the routed upstream, one for platform-admin-service.
 * Seeds Redis directly and verifies the filter enforces the correct responses.
 *
 * <h3>Feature-flag and quota assertions</h3>
 * <ul>
 *   <li>{@code tenant:status:{tid}=SUSPENDED} → 403 TENANT_SUSPENDED, upstream untouched.</li>
 *   <li>{@code tenant:status:{tid}=ACTIVE} + {@code tenant_features:{tid}:FEATURE_HR=false}
 *       on {@code /api/v1/hr/**} → 403 FEATURE_DISABLED with {@code X-Upgrade-CTA-URL} header.</li>
 *   <li>Same but FEATURE_HR=true → forwarded to upstream.</li>
 *   <li>{@code nlq_quota:{tid}:monthly_count} over limit on {@code /api/v1/nlq/**} → 429 QUOTA_EXCEEDED.</li>
 * </ul>
 *
 * <h3>Tenant-status resolution — the six behaviours (D-33)</h3>
 * <p>Suspension is the platform's primary non-payment lever. Before this, {@code getTenantStatus}
 * ended in {@code .defaultIfEmpty("ACTIVE")}: a cold cache plus a silent platform-admin was read as a
 * positive determination that the tenant was in good standing, so an infrastructure outage became an
 * authorization bypass and a suspended tenant was served. The six cases below fence that shut.
 *
 * <ol>
 *   <li>cache hit, ACTIVE → forwarded — {@link #featureEnabled_requestForwarded()}</li>
 *   <li>cache hit, SUSPENDED → 403 TENANT_SUSPENDED — {@link #suspendedTenant_returns403()}</li>
 *   <li>cache miss, platform answers ACTIVE → forwarded, cache warmed —
 *       {@link #cacheMiss_platformSaysActive_forwardsAndWarmsTheCache()}</li>
 *   <li>cache miss, platform answers SUSPENDED → 403, cache warmed —
 *       {@link #cacheMiss_platformSaysSuspended_refusesAndWarmsTheCache()}</li>
 *   <li>cache miss, platform errors or answers empty → 503 TENANT_STATUS_UNAVAILABLE, nothing cached —
 *       {@link #cacheMiss_platformErrors_returns503AndCachesNothing()},
 *       {@link #cacheMiss_platformAnswersEmpty_returns503AndCachesNothing()}</li>
 *   <li>the same error case forwards ONLY when fail-open-on-platform-down is explicitly enabled —
 *       {@link #cacheMiss_platformErrors_forwardsOnlyWhenFailOpenIsEnabled()}</li>
 * </ol>
 *
 * <p><b>{@code restaurantos.fail-open-on-platform-down} is deliberately NOT set below.</b> It used to
 * be pinned {@code true} here, which is the one value under which a fail-open regression cannot be
 * observed. Leaving it unset means the context binds the real default from {@code application.yml},
 * and {@link #failOpenDefaultsToClosed()} asserts that the value the whole suite runs under is the
 * production one rather than a value this file chose.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {
                "spring.main.web-application-type=reactive",
                "spring.cloud.gateway.server.webflux.trusted-proxies=.*",
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
    static void dynamicProps(DynamicPropertyRegistry registry) {
        registry.add("spring.data.redis.host", redis::getHost);
        registry.add("spring.data.redis.port", () -> redis.getMappedPort(6379).toString());
        // The cache-miss path has to reach something that can answer, refuse, and fall silent on
        // demand. Pointing this at a dead port (as it was) makes every miss indistinguishable from
        // every other miss, which is exactly the distinction D-33 turns on.
        registry.add("restaurantos.platform-admin.uri", () -> "http://localhost:" + platformAdmin().getPort());
    }

    static KeyPair keyPair;
    static final String TEST_KID = "ff-test-key";
    static MockWebServer mockUpstream;
    static MockWebServer mockPlatformAdmin;

    @LocalServerPort
    int port;

    WebTestClient webTestClient;

    @Autowired
    StringRedisTemplate redisTemplate;

    @Autowired
    FeatureFlagGlobalFilter featureFlagGlobalFilter;

    UUID tenantId;
    String validToken;

    /** Started on first use so it is running whether the context loads before or after {@code @BeforeAll}. */
    static MockWebServer platformAdmin() {
        if (mockPlatformAdmin == null) {
            mockPlatformAdmin = new MockWebServer();
            try {
                mockPlatformAdmin.start();
            } catch (Exception e) {
                throw new IllegalStateException("could not start the platform-admin stub", e);
            }
        }
        return mockPlatformAdmin;
    }

    @BeforeAll
    static void startMockUpstream() throws Exception {
        KeyPairGenerator gen = KeyPairGenerator.getInstance("RSA");
        gen.initialize(2048);
        keyPair = gen.generateKeyPair();

        mockUpstream = new MockWebServer();
        mockUpstream.start();
        platformAdmin();
    }

    @AfterAll
    static void stopMockUpstream() throws Exception {
        if (mockUpstream != null) {
            mockUpstream.shutdown();
        }
        if (mockPlatformAdmin != null) {
            mockPlatformAdmin.shutdown();
            mockPlatformAdmin = null;
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
        while (platformAdmin().takeRequest(50, TimeUnit.MILLISECONDS) != null) {
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

    // ── Tenant-status resolution (D-33) ─────────────────────────────────────────────────
    //
    // Behaviours 1 and 2 (cache hit ACTIVE / SUSPENDED) are the two tests above; they were already
    // correct and are deliberately not duplicated here. Behaviours 3–6 are the cache-MISS paths,
    // which is where the fail-open lived: `.defaultIfEmpty("ACTIVE")` at the end of the resolution
    // chain answered "in good standing" for a tenant nobody had been able to ask about.

    /** Behaviour 3: platform-admin answers ACTIVE on a cold cache → forwarded, and the answer is cached. */
    @Test
    void cacheMiss_platformSaysActive_forwardsAndWarmsTheCache() {
        // No tenant:status key at all — @BeforeEach deleted it.
        redisTemplate.opsForValue().set("tenant_features:" + tenantId + ":FEATURE_HR", "true");
        enqueueStatus("ACTIVE");
        mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{\"employees\":[]}"));
        int before = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isOk();

        assertThat(mockUpstream.getRequestCount()).isEqualTo(before + 1);
        assertThat(redisTemplate.opsForValue().get("tenant:status:" + tenantId)).isEqualTo("ACTIVE");
    }

    /** Behaviour 4: platform-admin answers SUSPENDED on a cold cache → 403, and the answer is cached. */
    @Test
    void cacheMiss_platformSaysSuspended_refusesAndWarmsTheCache() {
        enqueueStatus("SUSPENDED");
        int before = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isForbidden()
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("TENANT_SUSPENDED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(before);
        assertThat(redisTemplate.opsForValue().get("tenant:status:" + tenantId)).isEqualTo("SUSPENDED");
    }

    /**
     * Behaviour 5a — the regression this plan exists for.
     *
     * <p>Cold cache, platform-admin errors. The old chain fell through to {@code ACTIVE} and served
     * the request; a tenant suspended for non-payment kept full access for the duration of any
     * platform-admin blip. It must now be refused, with a code that says "we could not tell" rather
     * than "we refused you" — an operator staring at a 403 TENANT_SUSPENDED during an outage has been
     * told the wrong thing.
     */
    @Test
    void cacheMiss_platformErrors_returns503AndCachesNothing() {
        platformAdmin().enqueue(new MockResponse().setResponseCode(500).setBody("{\"error\":\"boom\"}"));
        int before = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectBody(String.class)
                .value(body -> assertThat(body)
                        .contains("TENANT_STATUS_UNAVAILABLE")
                        .doesNotContain("TENANT_SUSPENDED"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(before);
        assertThat(redisTemplate.hasKey("tenant:status:" + tenantId))
                .as("an unknown answer is not a determination and must never be cached — caching one "
                        + "turns a momentary blip into a hard refusal for the whole 5-minute TTL")
                .isFalse();
    }

    /**
     * Behaviour 5b: an empty answer is not a determination either.
     *
     * <p>platform-admin returning no body is exactly as uninformative as it failing to answer, and the
     * old chain treated the two identically — as ACTIVE. This is the branch {@code .defaultIfEmpty}
     * literally sat on.
     */
    @Test
    void cacheMiss_platformAnswersEmpty_returns503AndCachesNothing() {
        platformAdmin().enqueue(new MockResponse().setResponseCode(204));
        int before = mockUpstream.getRequestCount();

        webTestClient.get()
                .uri("/api/v1/hr/employees")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                .exchange()
                .expectStatus().isEqualTo(HttpStatus.SERVICE_UNAVAILABLE)
                .expectBody(String.class)
                .value(body -> assertThat(body).contains("TENANT_STATUS_UNAVAILABLE"));

        assertThat(mockUpstream.getRequestCount()).isEqualTo(before);
        assertThat(redisTemplate.hasKey("tenant:status:" + tenantId)).isFalse();
    }

    /**
     * Behaviour 6: the break-glass, and only when it is explicitly pulled.
     *
     * <p>The property is flipped on the live bean rather than in a second Spring context — the same
     * {@link ReflectionTestUtils} idiom {@code PlatformAdminClientTest} already uses for this exact
     * field. {@link #failOpenDefaultsToClosed()} pins that the value being flipped FROM is the one the
     * context really bound, so this cannot quietly become a test of a default that is already open.
     *
     * <p>Note what is still true even here: nothing is written to the cache. Fail-open is a decision
     * to proceed, not a determination that the tenant is in good standing, and persisting it would
     * outlive the operator turning the lever back off.
     */
    @Test
    void cacheMiss_platformErrors_forwardsOnlyWhenFailOpenIsEnabled() {
        Object original = ReflectionTestUtils.getField(featureFlagGlobalFilter, "failOpen");
        ReflectionTestUtils.setField(featureFlagGlobalFilter, "failOpen", true);
        try {
            redisTemplate.opsForValue().set("tenant_features:" + tenantId + ":FEATURE_HR", "true");
            platformAdmin().enqueue(new MockResponse().setResponseCode(500).setBody("{\"error\":\"boom\"}"));
            mockUpstream.enqueue(new MockResponse().setResponseCode(200).setBody("{\"employees\":[]}"));
            int before = mockUpstream.getRequestCount();

            webTestClient.get()
                    .uri("/api/v1/hr/employees")
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + validToken)
                    .exchange()
                    .expectStatus().isOk();

            assertThat(mockUpstream.getRequestCount()).isEqualTo(before + 1);
            assertThat(redisTemplate.hasKey("tenant:status:" + tenantId))
                    .as("fail-open is a decision to proceed, not a determination; it must not be persisted")
                    .isFalse();
        } finally {
            ReflectionTestUtils.setField(featureFlagGlobalFilter, "failOpen", original);
        }
    }

    /**
     * The lever defaults to closed, and this suite runs with the default rather than a value it chose.
     *
     * <p>Without this, someone re-pinning {@code fail-open-on-platform-down=true} in the
     * {@code @SpringBootTest} properties — where it used to be — would turn all four assertions above
     * green for the wrong reason and remove the guard silently.
     */
    @Test
    void failOpenDefaultsToClosed() {
        assertThat(ReflectionTestUtils.getField(featureFlagGlobalFilter, "failOpen"))
                .as("restaurantos.fail-open-on-platform-down must bind false unless deliberately enabled")
                .isEqualTo(false);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────────────────

    /** platform-admin wraps every response in the shared ApiResponse envelope. */
    private static void enqueueStatus(String status) {
        platformAdmin().enqueue(new MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "application/json")
                .setBody("{\"data\":{\"status\":\"" + status + "\",\"tier\":\"GROWTH\"},"
                        + "\"meta\":null,\"warnings\":[]}"));
    }

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
