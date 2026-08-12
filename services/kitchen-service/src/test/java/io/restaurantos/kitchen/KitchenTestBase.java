package io.restaurantos.kitchen;

import io.restaurantos.kitchen.client.PosStationClient;
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
 * Base class for kitchen-service integration tests.
 * Static singleton Postgres container shared across all subclasses in same JVM run.
 * RabbitTemplate is mocked to prevent actual AMQP publishing.
 * Requires TESTCONTAINERS_RYUK_DISABLED=true for Colima Docker environment.
 */
@SpringBootTest
public abstract class KitchenTestBase {

    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("kitchen_db")
            .withUsername("kitchen_user")
            .withPassword("kitchen_pass");

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
        // @RabbitListener containers dial the broker at startup even though RabbitTemplate is
        // mocked. Point them at a dead port so that is a connection-refused — retried in the
        // background, non-fatal — instead of whatever the developer happens to be running.
        //
        // With the dev stack UP, they reached the REAL broker on 5672, were refused for using the
        // default guest/guest, and Spring treats ACCESS_REFUSED as a FATAL listener-startup error.
        // The IT suite therefore passed or failed depending on whether the dev stack was running
        // at the time, for a reason nothing in the failure pointed at.
        registry.add("spring.rabbitmq.host", () -> "127.0.0.1");
        registry.add("spring.rabbitmq.port", () -> "1");
        registry.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");
        // OpaClient is @MockitoBean below — this value is never dialed, only needed so the
        // restaurantos.opa.url placeholder resolves during context startup (matches
        // authorization-service's BaseIntegrationTest pattern).
        registry.add("restaurantos.opa.url", () -> "http://127.0.0.1:1");
    }

    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    @MockitoBean
    protected StringRedisTemplate stringRedisTemplate;

    @MockitoBean
    protected OpaClient opaClient;

    /**
     * The station registry seam to pos-service.
     *
     * <p>Mocked here rather than pointed at a stub server so every existing IT keeps the exact
     * behaviour it had: Mockito's default answer for an {@code Optional}-returning method is
     * {@code Optional.empty()}, which {@code StationRegistryService} reads as "registry
     * unreachable" and therefore leaves the projection exactly as ticket routing built it. A test
     * that wants a registry stubs this bean itself.
     */
    @MockitoBean
    protected PosStationClient posStationClient;
}
