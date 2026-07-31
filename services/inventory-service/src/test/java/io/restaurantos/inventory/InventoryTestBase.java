package io.restaurantos.inventory;

import io.restaurantos.inventory.feign.FinanceCoaClient;
import io.restaurantos.inventory.feign.GlAccountDto;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaClient;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.when;

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

    /**
     * finance-service's chart of accounts, mocked at the transport boundary — the same treatment
     * {@link #opaClient} gets, and for the same reason: there is no finance-service (nor Eureka to
     * find one) in an integration test. Without this, every category write that names a GL account
     * would fail with a 503 from {@code GlAccountLookupService}'s fail-closed error handling.
     *
     * <p>Imports from {@code io.restaurantos.inventory.feign} rather than {@code domain.model}, so
     * this class stays free of Phase-8 domain entities per the note above.
     */
    @MockitoBean
    protected FinanceCoaClient financeCoaClient;

    /**
     * Default stub: every requested account code resolves to a real, active account whose TYPE
     * follows standard chart-of-accounts numbering — 1xxx is an asset, everything else an expense.
     * That keeps the type check in {@code ItemCategoryService} meaningful (an inventory slot still
     * demands a 1xxx account) while letting the many ITs that merely pass a plausible code through
     * work without each stubbing finance themselves.
     *
     * <p>Runs before every subclass {@code @BeforeEach} (JUnit orders superclass callbacks first),
     * and any test needing different behaviour just re-stubs the mock.
     */
    @BeforeEach
    void stubFinanceChartOfAccounts() {
        when(financeCoaClient.resolveByCodes(any(), anyList())).thenAnswer(invocation -> {
            List<String> codes = invocation.getArgument(1);
            Map<String, GlAccountDto> resolved = new LinkedHashMap<>();
            for (String code : codes) {
                resolved.put(code, account(code));
            }
            return ApiResponse.ok(resolved);
        });
        when(financeCoaClient.searchAccounts(any(), any(), anyList(), anyInt()))
                .thenReturn(ApiResponse.ok(List.of()));
    }

    protected static GlAccountDto account(String code) {
        String type = code != null && code.startsWith("1") ? "ASSET" : "EXPENSE";
        return new GlAccountDto(UUID.randomUUID(), code, "Account " + code, type, null, false, null, true);
    }
}
