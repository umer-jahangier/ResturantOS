package io.restaurantos.authz.integration;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.restaurantos.authz.AuthorizationServiceApplication;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.client.RestClient;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.containers.BindMode;
import org.testcontainers.containers.wait.strategy.Wait;

import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@SpringBootTest(
    classes = AuthorizationServiceApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
@Import(TestJwksConfig.class)
public abstract class BaseIntegrationTest {

    static final String INTERNAL_SECRET = "test-internal-secret";

    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
            .withDatabaseName("auth_db")
            .withUsername("auth_user")
            .withPassword("test-pass");

    @SuppressWarnings("resource")
    static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:8"))
            .withExposedPorts(6379);

    static final RabbitMQContainer RABBIT =
        new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3-management"));

    static final GenericContainer<?> OPA =
        new GenericContainer<>(DockerImageName.parse("openpolicyagent/opa:1.17.1"))
            .withCommand("run", "--server", "--addr=0.0.0.0:8181", "/policies")
            .withExposedPorts(8181)
            .withFileSystemBind(policiesDir().toString(), "/policies", BindMode.READ_ONLY)
            .waitingFor(Wait.forHttp("/health").forPort(8181));

    private static Path policiesDir() {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(
            cwd.resolve("../../policies").normalize(),
            cwd.resolve("policies").normalize(),
            cwd.resolve("../../../policies").normalize())) {
            if (candidate.resolve("restaurantos/pos.rego").toFile().exists()) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not locate policies/ from " + cwd);
    }

    static String opaBaseUrl() {
        return "http://" + OPA.getHost() + ":" + OPA.getMappedPort(8181);
    }

    static {
        POSTGRES.start();
        REDIS.start();
        RABBIT.start();
        OPA.start();
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
                last = new IllegalStateException("Postgres not reachable yet: " + e.getMessage(), e);
                try {
                    Thread.sleep(500);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException(ie);
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
        r.add("spring.datasource.url", BaseIntegrationTest::jdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.change-log", () -> "classpath:db/changelog/db.changelog-master.xml");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        r.add("restaurantos.opa.url", BaseIntegrationTest::opaBaseUrl);
        r.add("restaurantos.jwt.jwks-url", () -> "http://localhost:8081/.well-known/jwks.json");
        r.add("restaurantos.internal.service-secret", () -> INTERNAL_SECRET);
    }

    @LocalServerPort protected int port;
    @Autowired protected ObjectMapper objectMapper;

    protected RestClient rest;

    @BeforeEach
    void initRestClient() {
        rest = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl(baseUrl())
            .build();
    }

    protected String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    protected ResponseEntity<String> postAuthorize(String jwt, Map<String, Object> body, String internalSecret) {
        var spec = rest.post()
            .uri("/internal/authorize")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + jwt)
            .body(body);
        if (internalSecret != null) {
            spec = spec.header("X-Internal-Service", internalSecret);
        }
        return spec.exchange((request, response) -> toEntity(response));
    }

    protected boolean readAllow(String responseBody) throws Exception {
        JsonNode root = objectMapper.readTree(responseBody);
        return root.path("data").path("allow").asBoolean(false);
    }

    protected Map<String, Object> resource(UUID tenantId, UUID branchId) {
        return Map.of(
            "type", "order",
            "id", UUID.randomUUID().toString(),
            "tenantId", tenantId.toString(),
            "branchId", branchId.toString(),
            "createdBy", TestFixtures.cashierUserId().toString(),
            "status", "OPEN"
        );
    }

    protected Map<String, Object> authorizeBody(String module, String action, Map<String, Object> resource) {
        return Map.of("module", module, "action", action, "resource", resource);
    }

    private static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse response)
            throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }
}
