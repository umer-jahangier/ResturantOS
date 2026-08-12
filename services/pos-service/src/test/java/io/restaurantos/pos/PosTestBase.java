package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.dto.OpenTillRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.TillSessionDto;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.feign.UserBranchClient;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.authz.OpaClient;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.mockito.ArgumentMatchers;
import org.mockito.Mockito;
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

        // RabbitTemplate is mocked below, but pos-service also has @RabbitListener consumers
        // (kitchen item-status, order-ready, the DLQ monitor) whose containers still dial the
        // broker at startup. Pointing them at a dead port makes that a connection-refused —
        // retried in the background, non-fatal — instead of whatever the developer's machine
        // happens to be running.
        //
        // This matters: with the dev stack UP, the containers reached the REAL broker on 5672,
        // were refused for using the default guest/guest, and Spring treats ACCESS_REFUSED as a
        // FATAL listener-startup error. So the entire POS IT suite passed or failed depending on
        // whether the dev stack was running at the time — green in CI, red on a developer's
        // machine, for a reason nothing in the failure pointed at.
        registry.add("spring.rabbitmq.host", () -> "127.0.0.1");
        registry.add("spring.rabbitmq.port", () -> "1");
        registry.add("spring.rabbitmq.listener.simple.missing-queues-fatal", () -> "false");
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

    /**
     * user-service, mocked once for the whole hierarchy.
     *
     * <p>It was declared separately by the seven suites that stub {@code getBranch} for a receipt
     * header. It is declared HERE now because {@code ActiveBranchGuard} made this client
     * load-bearing on {@code openTill} and {@code createOrder} — the two calls almost every suite in
     * this module makes — and that guard is fail-CLOSED. Left unmocked, the real Feign client cannot
     * resolve {@code user-service} (Eureka is off in these tests), the guard reads that as "cannot
     * verify", and every order in the suite is refused. A duplicate {@code @MockitoBean} for the
     * same bean in a subclass is rejected by Spring, so the seven declarations were removed rather
     * than added to; their {@code when(userBranchClient...)} lines bind to this inherited field.
     */
    @MockitoBean
    protected UserBranchClient userBranchClient;

    /**
     * "The branch is open" — the ambient truth for every test that is not about a closed branch.
     *
     * <p>Runs before any subclass {@code @BeforeEach} (JUnit 5 walks the hierarchy top-down), so a
     * suite that wants a DEACTIVATED branch simply re-stubs it. Without this, the unstubbed mock
     * returns null and {@code ActiveBranchGuard} — correctly — refuses everything.
     *
     * <p>Note what this default costs, because it is the harness's blind spot and not a small one:
     * with the client mocked in every IT, nothing in this module proves that pos-service can
     * actually reach user-service, that the URL is right or that the internal secret is accepted.
     * That half is proved against the running fleet, not here.
     */
    @BeforeEach
    void branchIsActiveUnlessTheTestSaysOtherwise() {
        Mockito.when(userBranchClient.getBranchStatus(ArgumentMatchers.any(), ArgumentMatchers.any()))
                .thenReturn(new UserBranchClient.BranchStatus(null, true, false));
    }

    @Autowired
    protected TillService tillService;

    /**
     * Opens an OPEN till for the cashier currently in {@code TenantContext}. IT fixtures that
     * model a cashier taking and SETTLING orders call this once, after setting their
     * tenant/security context. {@code branchId} must equal the caller's context branch (openTill
     * enforces the same branch-isolation guard as createOrder). Callers that ALSO assert
     * till-opening behaviour must open their own till per-test instead of using this.
     *
     * <p>As of 13-16 (D-30) this is no longer needed merely to CREATE an order — createOrder binds
     * a till opportunistically and a waiter with none is fine ({@link WaiterOrderNoTillIT}). It is
     * required to settle in CASH: {@code PaymentServiceImpl.recordPayment} refuses a cash tender
     * unless the paying user holds an OPEN till ({@link CashPaymentRequiresTillIT}). Note
     * {@link #closeViaServeAndPay} settles in cash, so every caller of that needs this.
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
