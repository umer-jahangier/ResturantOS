package io.restaurantos.shared.integration;

import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/**
 * Testcontainers base class for shared-lib integration tests.
 * Starts PostgreSQL 18, RabbitMQ 4.3, and Redis 8 once per JVM.
 * Runs Liquibase (test-changelog.xml) on context start.
 * Sets the test tenant context before each test (§10.2 fixtures).
 */
@SpringBootTest(
    classes = SharedLibTestApplication.class,
    webEnvironment = org.springframework.boot.test.context.SpringBootTest.WebEnvironment.NONE
)
@Testcontainers
public abstract class BaseIntegrationTest {

    static final PostgreSQLContainer<?> POSTGRES =
        new PostgreSQLContainer<>(DockerImageName.parse("postgres:18"))
            .withDatabaseName("shared_test_db")
            .withInitScript("db/init-test-db.sql");

    @SuppressWarnings("resource")
    static final GenericContainer<?> REDIS =
        new GenericContainer<>(DockerImageName.parse("redis:8"))
            .withExposedPorts(6379);

    static final RabbitMQContainer RABBIT =
        new RabbitMQContainer(DockerImageName.parse("rabbitmq:4.1-management"));

    static {
        POSTGRES.start();
        REDIS.start();
        RABBIT.start();
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", () -> "shared_test_user");
        r.add("spring.datasource.password", () -> "test-pass");
        r.add("spring.liquibase.url", POSTGRES::getJdbcUrl);
        r.add("spring.liquibase.user", POSTGRES::getUsername);
        r.add("spring.liquibase.password", POSTGRES::getPassword);
        r.add("spring.datasource.driver-class-name", () -> "org.postgresql.Driver");
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.jpa.database-platform", () -> "org.hibernate.dialect.PostgreSQLDialect");
        r.add("spring.liquibase.change-log", () -> "classpath:db/changelog/test-changelog.xml");
        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> REDIS.getMappedPort(6379).toString());
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        // OPA is optional in dev; no OPA_URL so ConditionalOnProperty skips OpaClient bean
        r.add("restaurantos.feature-flags.cache-ttl-seconds", () -> "300");
    }

    @Autowired protected TenantContext tenantContext;

    @BeforeEach
    void setTenant() {
        tenantContext.set(
            TestFixtures.testTenantId(),
            TestFixtures.testBranchId(),
            TestFixtures.testUserId(),
            null);
    }

    @AfterEach
    void clearTenant() { tenantContext.clear(); }
}
