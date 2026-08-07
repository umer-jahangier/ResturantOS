package io.restaurantos.purchasing;

import io.restaurantos.purchasing.feign.AuthorizationClient;
import io.restaurantos.purchasing.feign.FinanceInternalClient;
import io.restaurantos.purchasing.feign.InventoryReorderClient;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.OutboxRepository;
import org.flywaydb.core.Flyway;
import io.restaurantos.shared.api.ApiResponse;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;

import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.when;

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
        // Point AMQP at a dead port so any listener/AmqpAdmin startup is a connection-refused —
        // retried in the background, non-fatal — instead of an ACCESS_REFUSED against the REAL dev
        // broker on 5672, which Spring treats as fatal. Without this the suite passes or fails
        // depending on whether the developer's dev stack happens to be running.
        registry.add("spring.rabbitmq.host", () -> "127.0.0.1");
        registry.add("spring.rabbitmq.port", () -> "1");
        registry.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");
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

    /**
     * Lets {@code vendor.manage} through by default, and ONLY {@code vendor.manage}.
     *
     * <p>Phase 18b wired {@code vendor.rego}'s {@code manage} rule into
     * {@code VendorService.create/update}, which most ITs here call as a FIXTURE — they need a
     * vendor in order to test three-way matching, encryption, PO approval and so on. An
     * unstubbed Mockito mock returns null, which {@code VendorService} correctly treats as a deny,
     * so nine tests that have nothing to do with vendor administration started failing on their
     * setup.
     *
     * <p>Matched on the action rather than stubbed with {@code any()} deliberately. A blanket
     * allow-everything default would also have silently satisfied {@code approve_po} and
     * {@code close_po}, whose deny-by-default behaviour several ITs depend on to assert that an
     * over-limit approval is refused — turning real assertions green without anyone noticing.
     * Narrowing to one action keeps every existing expectation exactly as it was.
     *
     * <p>{@code PurchasingOpaPolicyIT} re-stubs {@code any()} in its own {@code @BeforeEach}, which
     * runs after this one and therefore wins: there, vendor.manage goes to the real OPA like
     * everything else.
     */
    @BeforeEach
    void allowVendorManageFixturesByDefault() {
        when(authorizationClient.authorize(argThat(
                payload -> payload != null && "manage".equals(payload.action()))))
            .thenReturn(ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));
    }

    @MockitoBean
    protected FinanceInternalClient financeInternalClient;

    @MockitoBean
    protected FeatureFlagService featureFlagService;

    /**
     * Order suggestions have NO mock port, unlike the GRN and category seams — a suggestion list
     * built from invented shortfalls would be actively misleading, since someone would order
     * against it. Tests that need shortfalls stub this directly.
     */
    @MockitoBean
    protected InventoryReorderClient inventoryReorderClient;
}
