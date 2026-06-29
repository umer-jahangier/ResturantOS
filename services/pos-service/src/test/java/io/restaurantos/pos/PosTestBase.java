package io.restaurantos.pos;

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
 * Base class for pos-service integration tests.
 * Uses a static singleton container shared across ALL subclasses in the same JVM run.
 * OutboxRepository is NOT mocked — IT tests query it directly to verify in-tx event writing.
 * RabbitTemplate IS mocked to prevent actual AMQP publishing during tests.
 * Requires TESTCONTAINERS_RYUK_DISABLED=true for Colima Docker environment [03-01-D].
 */
@SpringBootTest
public abstract class PosTestBase {

    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("pos_db")
            .withUsername("pos_user")
            .withPassword("pos_pass");

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
    }

    // Mock AMQP to prevent actual broker publishing
    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    // Mock Redis — not used in POS unit flows
    @MockitoBean
    protected StringRedisTemplate stringRedisTemplate;
}
