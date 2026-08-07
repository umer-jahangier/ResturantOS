package io.restaurantos.finance;

import io.restaurantos.shared.idempotency.IdempotencyKeyRepository;
import io.restaurantos.shared.event.OutboxRepository;
import org.flywaydb.core.Flyway;
import io.restaurantos.finance.feign.AuthorizationClient;
import io.restaurantos.shared.api.ApiResponse;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.Set;

import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.when;

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
        // Listeners are down, but FinanceRabbitConfig's Declarables bean still makes AmqpAdmin
        // connect at startup to declare the topology. Point it at a dead port so that is a
        // connection-refused (logged, retried lazily, harmless) rather than an ACCESS_REFUSED
        // against the REAL dev broker on 5672 — which Spring treats as fatal, and which made
        // these ITs pass or fail purely on whether the dev stack happened to be running.
        registry.add("spring.rabbitmq.host", () -> "127.0.0.1");
        registry.add("spring.rabbitmq.port", () -> "1");
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

    /**
     * The OPA gate, allowed by default for the LEDGER actions only.
     *
     * <p>Phase 18b wired {@code finance.rego}'s six dead-letter rules into this service. Most ITs
     * here post journal entries, read them back, or close a period as part of asserting something
     * else entirely — balance triggers, immutability, AR ledger mechanics — and without a stub the
     * real Feign client tries to reach authorization-service, which is not running, and
     * {@code FinanceAuthorizationService} correctly turns that into a deny.
     *
     * <p>Matched on the action rather than {@code any()} deliberately. A blanket allow would also
     * satisfy {@code approve}, whose deny path {@code ExpenseApprovalIT} and
     * {@code ExpenseOpaPolicyIT} assert against real approval limits — the over-limit test would
     * have gone green while proving nothing. Only the six actions this phase introduced are
     * defaulted; {@code approve} keeps whatever behaviour each test gives it.
     *
     * <p>The policy itself is exercised for real, against the rego bundle in a container, by
     * {@code ExpenseOpaPolicyIT} and by the reachability test in authorization-service.
     */
    @MockitoBean
    protected AuthorizationClient authorizationClient;

    private static final Set<String> LEDGER_ACTIONS = Set.of(
            "close_period", "view_coa", "manage_coa",
            "view_journal", "post_journal", "reverse_journal");

    @BeforeEach
    void allowLedgerActionsByDefault() {
        when(authorizationClient.authorize(argThat(
                payload -> payload != null && LEDGER_ACTIONS.contains(payload.action()))))
            .thenReturn(ApiResponse.ok(new AuthorizationClient.AuthorizeResult(true, null)));
    }
}
