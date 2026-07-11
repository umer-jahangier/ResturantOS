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

import java.nio.charset.StandardCharsets;
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

    static final WireMockServer WIREMOCK = new WireMockServer(
        WireMockConfiguration.wireMockConfig().dynamicPort()
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
        r.add("restaurantos.jwks.uri", () -> "http://localhost:" + WIREMOCK.port() + "/test-jwks");
        r.add("restaurantos.auth-service.uri", () -> "http://localhost:" + WIREMOCK.port());
        r.add("restaurantos.user-service.uri", () -> "http://localhost:" + WIREMOCK.port());
        r.add("restaurantos.finance-service.uri", () -> "http://localhost:" + WIREMOCK.port());
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

    protected void wireMockStubJwks() {
        WIREMOCK.stubFor(WireMock.get(WireMock.urlPathEqualTo("/test-jwks"))
            .willReturn(WireMock.aResponse()
                .withStatus(200)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"keys\":[]}")));
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

    protected void stubUserCreateBranch(UUID branchId) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo("/internal/users/branches"))
            .willReturn(WireMock.aResponse()
                .withStatus(201)
                .withHeader("Content-Type", "application/json")
                .withBody("{\"data\":{\"id\":\"" + branchId + "\",\"name\":\"HQ\"}}")));
    }

    protected void stubUserCreateBranchFail() {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo("/internal/users/branches"))
            .willReturn(WireMock.aResponse().withStatus(500).withBody("{\"error\":\"simulated\"}")));
    }

    protected void stubFinanceSeedCoa(UUID tenantId) {
        WIREMOCK.stubFor(WireMock.post(WireMock.urlPathEqualTo(
                "/internal/finance/tenants/" + tenantId + "/seed-coa"))
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
