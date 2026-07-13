package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.authz.OpaClient;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;

import java.util.UUID;

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
        // OpaClient is @MockitoBean below — this value is never dialed, only needed so the
        // restaurantos.opa.url placeholder resolves during context startup (matches
        // authorization-service's BaseIntegrationTest pattern).
        registry.add("restaurantos.opa.url", () -> "http://127.0.0.1:1");
    }

    // Mock AMQP to prevent actual broker publishing
    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    // Mock Redis — not used in POS unit flows
    @MockitoBean
    protected StringRedisTemplate stringRedisTemplate;

    // Mock Finance Feign client — prevents HTTP connections in tests; configure per test
    @MockitoBean
    protected FinancePeriodClient financePeriodClient;

    // Mock OpaClient — prevents real OPA connections; configure in each test for OPA-protected operations
    @MockitoBean
    protected OpaClient opaClient;

    @Autowired
    protected TillService tillService;

    /**
     * Opens an OPEN till for the cashier currently in {@code TenantContext}, satisfying
     * {@code OrderServiceImpl.createOrder}'s financial-integrity guard ("no order without an
     * open till"). IT fixtures that model a cashier taking orders call this once, after setting
     * their tenant/security context. {@code branchId} must equal the caller's context branch
     * (openTill enforces the same branch-isolation guard as createOrder). Callers that ALSO
     * assert till-opening behaviour must open their own till per-test instead of using this.
     */
    protected TillSessionDto openTillForCashier(UUID branchId) {
        return tillService.openTill(new OpenTillRequest(branchId, 0L));
    }

    /**
     * Plan 07.3-11 (POS-23 / D-08): drives {@code order} to CLOSED through the REAL
     * Paid-AND-Served seam — the ONLY remaining close path now that the legacy exact-tender
     * {@code closeOrder} service method is deleted. Fires any still-PENDING lines via
     * {@code sendToKds} first (a precondition of {@code markItemServed}), marks every non-
     * terminal item SERVED, then records a single CASH payment for the full order total —
     * {@code recordPayment} persists the {@code OrderPayment} row and invokes
     * {@code maybeCloseOrder}, which closes the order once it is fully Paid AND fully Served.
     * Requires the Finance period to be stubbed OPEN (each caller already stubs
     * {@code financePeriodClient} in its own {@code setUp}). The payment amount is always
     * read from a freshly-reloaded order (NOT the caller-supplied {@code order} param, which
     * may have been captured before items were added and therefore carry a stale/zero
     * {@code totalPaisa}).
     */
    protected OrderDto closeViaServeAndPay(OrderService orderService, PaymentService paymentService,
                                            OrderDto order, UUID branchId) {
        OrderDto current = orderService.getOrder(order.id(), branchId);
        boolean hasPendingLines = current.items().stream()
                .anyMatch(item -> item.kdsStatus() == OrderItemStatus.PENDING);
        if (hasPendingLines) {
            current = orderService.sendToKds(order.id(), null);
        }

        for (OrderDto.OrderItemDto item : current.items()) {
            if (item.kdsStatus() != OrderItemStatus.SERVED && item.kdsStatus() != OrderItemStatus.CANCELLED) {
                orderService.markItemServed(order.id(), item.id());
            }
        }

        long freshTotalPaisa = orderService.getOrder(order.id(), branchId).totalPaisa();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, freshTotalPaisa, null);
        return orderService.getOrder(order.id(), branchId);
    }
}
