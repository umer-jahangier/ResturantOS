package io.restaurantos.auth.integration;

import io.restaurantos.auth.AuthServiceApplication;
import io.restaurantos.auth.repository.UserRepository;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
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

import java.nio.charset.StandardCharsets;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(
    classes = AuthServiceApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
public abstract class BaseIntegrationTest {

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

    static {
        POSTGRES.start();
        REDIS.start();
        RABBIT.start();
        awaitPostgresReady();
    }

    /**
     * Colima publishes the container's mapped port via a host port-forward that can lag a few
     * hundred ms behind the container becoming "ready". Liquibase opens the very first JDBC
     * connection during context init, so we warm/verify the forwarded port here (retrying until a
     * real connection succeeds) to avoid a "Connection reset" race before Spring starts.
     */
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
        r.add("spring.liquibase.contexts", () -> "seed");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        r.add("restaurantos.auth.jwt.private-key-base64", TestFixtures::privateKeyBase64);
        r.add("restaurantos.auth.jwt.public-key-base64", TestFixtures::publicKeyBase64);
        r.add("restaurantos.auth.jwt.public-key-id", () -> "test-key-1");
        r.add("logging.level.org.apache.coyote", () -> "DEBUG");
        r.add("logging.level.org.apache.tomcat.util.net", () -> "DEBUG");
    }

    @LocalServerPort protected int port;
    @Autowired protected TenantContext tenantContext;
    @Autowired protected OutboxRepository outboxRepository;
    @Autowired protected UserRepository userRepository;
    @Autowired protected EntityManager entityManager;

    protected RestClient rest;

    @BeforeEach
    void initRestClient() {
        rest = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl(baseUrl())
            .build();
        tenantContext.set(TestFixtures.demoTenantId(), TestFixtures.mainBranchId(), TestFixtures.cashierUserId(), null);
        setRls(TestFixtures.demoTenantId());
    }

    @AfterEach
    void clearTenant() {
        tenantContext.clear();
    }

    protected void setRls(java.util.UUID tenantId) {
        entityManager.createNativeQuery("SELECT set_config('app.current_tenant_id', :tid, false)")
            .setParameter("tid", tenantId.toString())
            .getSingleResult();
    }

    protected String baseUrl() {
        return "http://127.0.0.1:" + port;
    }

    /** RestClient.retrieve() throws on 4xx/5xx; auth ITs need the status body for assertions. */
    protected ResponseEntity<String> exchangePost(String uri, Object body) {
        return rest.post()
            .uri(uri)
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .exchange((request, response) -> toEntity(response));
    }

    protected ResponseEntity<String> exchangePost(String uri, String cookieHeader) {
        var spec = rest.post().uri(uri);
        if (cookieHeader != null) {
            spec = spec.header("Cookie", cookieHeader);
        }
        return spec.exchange((request, response) -> toEntity(response));
    }

    private static ResponseEntity<String> toEntity(org.springframework.http.client.ClientHttpResponse response)
            throws java.io.IOException {
        byte[] bytes = response.getBody() != null ? response.getBody().readAllBytes() : new byte[0];
        return ResponseEntity.status(response.getStatusCode())
            .headers(response.getHeaders())
            .body(new String(bytes, StandardCharsets.UTF_8));
    }
}
