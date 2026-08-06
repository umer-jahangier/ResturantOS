package io.restaurantos.hr;

import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base class for hr-service integration tests.
 *
 * <p>Static singleton Postgres container shared across all subclasses in the same JVM run
 * (mirrors Crm/Finance/InventoryTestBase — avoids Spring context-cache conflicts pointing at a
 * stopped container's port). Unlike finance/inventory it wires <b>Liquibase</b> (the hr-service
 * migration engine), not Flyway: Spring Liquibase runs the full master changelog on context
 * startup with {@code contexts=""} (schema only, skip seed data), so a subclass whose Spring
 * context loads has proven the migration.
 *
 * <p>Kept entity-independent on purpose: later HR plans add {@code @Entity} classes onto the
 * tables created here, and each extends this base. It operates at the migration/JDBC level.
 */
@SpringBootTest
public abstract class HrTestBase {

    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("hr_db")
            .withUsername("hr_user")
            .withPassword("hr_pass");

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
        postgres.start();
    }

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        // Spring Liquibase runs the master changelog against the container; contexts="" skips seed.
        registry.add("spring.liquibase.contexts", () -> "");
        registry.add("eureka.client.enabled", () -> "false");
        registry.add("spring.cloud.config.enabled", () -> "false");
        // @EnableRabbit registers listener infrastructure that dials the broker at startup even with
        // RabbitTemplate mocked. Point it at a dead port (connection-refused, retried, non-fatal)
        // rather than whatever broker the developer happens to be running (ACCESS_REFUSED is fatal).
        registry.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
        registry.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");
        registry.add("spring.rabbitmq.host", () -> "127.0.0.1");
        registry.add("spring.rabbitmq.port", () -> "1");
        // Field-encryption key must be present so EncryptionAutoConfiguration
        // (@ConditionalOnProperty) activates for the encrypted PII columns later plans add.
        // 32 zero-bytes, Base64 — a valid AES-256 test key (same shape as PurchasingTestBase).
        registry.add("restaurantos.encryption.key", () -> "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
        registry.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    // Shared-lib infrastructure beans hr-service scans but does not exercise in these tests.
    @MockitoBean
    protected StringRedisTemplate stringRedisTemplate;

    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    @MockitoBean
    protected IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    protected OutboxRepository outboxRepository;
}
