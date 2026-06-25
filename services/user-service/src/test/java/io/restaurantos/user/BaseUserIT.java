package io.restaurantos.user;

import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.user.repository.BranchRepository;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
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

import java.nio.charset.StandardCharsets;
import java.util.UUID;

@SpringBootTest(
    classes = UserServiceApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
public abstract class BaseUserIT {

    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
            .withDatabaseName("user_db")
            .withUsername("user_service")
            .withPassword("test-pass");

    @SuppressWarnings("resource")
    static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:8"))
            .withExposedPorts(6379);

    static final RabbitMQContainer RABBIT =
        new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.3-management"));

    static {
        POSTGRES.start();
        REDIS.start();
        RABBIT.start();
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
        r.add("spring.datasource.url", BaseUserIT::jdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.liquibase.change-log", () -> "classpath:db/changelog/db.changelog-master.xml");
        r.add("spring.liquibase.contexts", () -> "");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        // JWKS: use the test constructor path; bypass real JWKS fetch with a stub URI
        r.add("restaurantos.jwks.uri", () -> "http://localhost:9999/test-jwks-placeholder");
        r.add("restaurantos.internal.secret", () -> "test-internal-secret");
        r.add("restaurantos.auth-service.uri", () -> "http://localhost:9999");
    }

    @LocalServerPort protected int port;
    @Autowired protected TenantContext tenantContext;
    @Autowired protected BranchRepository branchRepository;
    @Autowired protected EntityManager entityManager;

    protected RestClient rest;

    /** Tenant A for primary test data */
    protected static final UUID TENANT_A = UUID.fromString("aa000001-0000-4000-8000-000000000001");
    /** Tenant B for cross-tenant isolation assertions */
    protected static final UUID TENANT_B = UUID.fromString("bb000001-0000-4000-8000-000000000002");

    @BeforeEach
    void setUp() {
        rest = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl("http://127.0.0.1:" + port)
            .build();
        setRls(TENANT_A);
        tenantContext.set(TENANT_A, null, null, null);
    }

    @AfterEach
    void tearDown() {
        tenantContext.clear();
    }

    protected void setRls(UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }

    protected ResponseEntity<String> post(String uri, Object body) {
        return rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> postWithHeader(String uri, Object body, String name, String value) {
        return rest.post().uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .header(name, value)
            .body(body)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> get(String uri) {
        return rest.get().uri(uri)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> getWithHeader(String uri, String name, String value) {
        return rest.get().uri(uri)
            .header(name, value)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected ResponseEntity<String> deleteWithHeader(String uri, String name, String value) {
        return rest.delete().uri(uri)
            .header(name, value)
            .exchange((req, res) -> toEntity(res), false);
    }

    protected static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse res)
            throws java.io.IOException {
        byte[] bytes = res.getBody() != null ? res.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(res.getStatusCode())
            .headers(res.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }
}
