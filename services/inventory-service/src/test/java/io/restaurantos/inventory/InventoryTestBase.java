package io.restaurantos.inventory;

import io.restaurantos.shared.authz.OpaClient;
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
 * Base class for inventory-service integration tests.
 * Static singleton Postgres container shared across all subclasses in the same JVM run
 * (mirrors KitchenTestBase/FinanceTestBase — avoids Spring context-cache conflicts pointing
 * at a stopped container's port).
 *
 * RabbitTemplate is mocked (not a live RabbitMQContainer) — per 08-PATTERNS.md this base
 * class is entity-independent and broker-independent; event-driven consumer ITs (e.g. the
 * depletion consumer in 08-05) drive the service layer directly rather than through a live
 * queue, matching KitchenTestBase's precedent exactly.
 *
 * Requires TESTCONTAINERS_RYUK_DISABLED=true for the repo's Docker environment.
 *
 * IMPORTANT: this base class must remain entity-independent — do NOT import any
 * io.restaurantos.inventory.domain.model.* class here. Phase-8 domain entities are
 * introduced by later Wave-3+ plans; this harness operates at the migration/JDBC level only.
 */
@SpringBootTest
public abstract class InventoryTestBase {

    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("inventory_db")
            .withUsername("inventory_user")
            .withPassword("inventory_pass");

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
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
        registry.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
        // OpaClient is @MockitoBean below — this value is never dialed, only needed so the
        // restaurantos.opa.url placeholder resolves during context startup (matches
        // kitchen-service/authorization-service's BaseIntegrationTest pattern).
        registry.add("restaurantos.opa.url", () -> "http://127.0.0.1:1");
    }

    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    @MockitoBean
    protected StringRedisTemplate stringRedisTemplate;

    @MockitoBean
    protected OpaClient opaClient;
}
