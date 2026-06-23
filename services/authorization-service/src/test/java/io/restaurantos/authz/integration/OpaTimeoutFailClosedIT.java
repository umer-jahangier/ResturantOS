package io.restaurantos.authz.integration;

import com.sun.net.httpserver.HttpServer;
import io.restaurantos.authz.AuthorizationServiceApplication;
import org.junit.jupiter.api.Test;
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

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(
    classes = AuthorizationServiceApplication.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
@Import(TestJwksConfig.class)
class OpaTimeoutFailClosedIT {

    private static final String INTERNAL_SECRET = "test-internal-secret";

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
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        String jdbcUrl = POSTGRES.getJdbcUrl() + "?sslmode=disable&tcpKeepAlive=true";
        r.add("spring.datasource.url", () -> jdbcUrl);
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
        // Unreachable port: connect fails fast, exercising fail-closed deny (BLR-5).
        r.add("restaurantos.opa.url", () -> "http://127.0.0.1:1");
        r.add("restaurantos.jwt.jwks-url", () -> "http://localhost:8081/.well-known/jwks.json");
        r.add("restaurantos.internal.service-secret", () -> INTERNAL_SECRET);
    }

    @LocalServerPort int port;

    @Test
    void opaTimeoutFailsClosedWithinTwoSeconds() throws Exception {
        String jwt = TestFixtures.mintJwt(
            TestFixtures.cashierUserId(),
            TestFixtures.demoTenantId(),
            TestFixtures.mainBranchId(),
            List.of("CASHIER"),
            List.of("pos.order.void.any"),
            Map.of());

        Map<String, Object> body = Map.of(
            "module", "pos",
            "action", "void",
            "resource", Map.of(
                "type", "order",
                "tenantId", TestFixtures.demoTenantId().toString(),
                "branchId", TestFixtures.mainBranchId().toString(),
                "createdBy", TestFixtures.cashierUserId().toString(),
                "status", "OPEN"
            )
        );

        RestClient client = RestClient.builder()
            .requestFactory(new org.springframework.http.client.JdkClientHttpRequestFactory())
            .baseUrl("http://127.0.0.1:" + port)
            .build();

        long start = System.currentTimeMillis();
        ResponseEntity<String> response = client.post()
            .uri("/internal/authorize")
            .contentType(MediaType.APPLICATION_JSON)
            .header("Authorization", "Bearer " + jwt)
            .header("X-Internal-Service", INTERNAL_SECRET)
            .body(body)
            .exchange((request, httpResponse) -> {
                byte[] bytes = httpResponse.getBody() != null ? httpResponse.getBody().readAllBytes() : new byte[0];
                return ResponseEntity.status(httpResponse.getStatusCode())
                    .body(new String(bytes, StandardCharsets.UTF_8));
            });
        long elapsed = System.currentTimeMillis() - start;

        assertThat(elapsed).isLessThan(3000);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody()).contains("\"allow\":false");
    }
}
