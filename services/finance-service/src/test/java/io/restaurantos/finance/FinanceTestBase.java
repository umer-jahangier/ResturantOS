package io.restaurantos.finance;

import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.event.OutboxRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Base class for finance-service integration tests.
 * Uses a static singleton container (no @Container/@Testcontainers) so the container
 * is shared across ALL subclasses in the same JVM run. This prevents Spring context
 * caching conflicts where a cached context points to a stopped container's port.
 *
 * Decision [06-02-A]: Static singleton Testcontainers pattern — container starts once
 * via static initializer and lives until JVM exit. All subclasses share the same Spring
 * context (same JDBC URL), eliminating "Connection refused" errors between test classes.
 */
@SpringBootTest
public abstract class FinanceTestBase {

    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("finance_db")
            .withUsername("finance_user")
            .withPassword("finance_pass");

    static {
        postgres.start();
    }

    @BeforeAll
    static void applyMigrations() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .baselineOnMigrate(false)
                .load();
        flyway.clean();
        flyway.migrate();
    }

    @DynamicPropertySource
    static void configureProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("eureka.client.enabled", () -> "false");
        registry.add("spring.cloud.config.enabled", () -> "false");
        // Phase 9 added @EnableRabbit to FinanceServiceApplication, so @RabbitListener beans
        // now start in every context. These tests run no broker and mocking RabbitTemplate
        // does not prevent the listener registry from connecting — keep the listeners down.
        registry.add("spring.rabbitmq.listener.simple.auto-startup", () -> "false");
        registry.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    // Mock shared infrastructure beans not needed in finance-service tests
    @MockitoBean
    protected StringRedisTemplate stringRedisTemplate;

    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    @MockitoBean
    protected IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    protected OutboxRepository outboxRepository;
}
