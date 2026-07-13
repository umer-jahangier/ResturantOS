package io.restaurantos.purchasing;

import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.feign.FinanceInternalClient;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.OutboxRepository;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;

@SpringBootTest
public abstract class PurchasingTestBase {

    static final PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16")
            .withDatabaseName("purchasing_db")
            .withUsername("purchasing_user")
            .withPassword("purchasing_pass");

    static {
        postgres.start();
    }

    @BeforeAll
    static void migrate() {
        Flyway flyway = Flyway.configure()
                .dataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword())
                .locations("classpath:db/migration")
                .cleanDisabled(false)
                .load();
        flyway.clean();
        flyway.migrate();
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", postgres::getJdbcUrl);
        registry.add("spring.datasource.username", postgres::getUsername);
        registry.add("spring.datasource.password", postgres::getPassword);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("eureka.client.enabled", () -> "false");
        registry.add("spring.cloud.config.enabled", () -> "false");
        registry.add("restaurantos.inventory.integration-mode", () -> "mock");
        registry.add("restaurantos.encryption.key", () -> "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    }

    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    @MockitoBean
    protected OutboxRepository outboxRepository;

    @MockitoBean
    protected EventPublisher eventPublisher;

    @MockitoBean
    protected IdempotencyKeyRepository idempotencyKeyRepository;

    @MockitoBean
    protected AuthorizationClient authorizationClient;

    @MockitoBean
    protected FinanceInternalClient financeInternalClient;

    @MockitoBean
    protected FeatureFlagService featureFlagService;
}
