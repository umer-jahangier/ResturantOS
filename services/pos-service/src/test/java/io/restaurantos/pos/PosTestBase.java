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

        // ── Why this module ran the Testcontainers Postgres out of connections ───────────────
        //
        // Eight suites here declare a @MockitoBean of their own, and a bean override is part of
        // Spring's context cache KEY, so one Failsafe fork ends the module holding TEN distinct
        // application contexts (measured: HikariPool-1 … HikariPool-10 in a single run). None is
        // ever evicted — spring.test.context.cache.maxSize is 32.
        //
        // Hikari's defaults are maximumPoolSize=10 AND minimumIdle=10, so each of those ten
        // contexts opens and PARKS ten physical connections. 10 x 10 = 100, against a
        // Testcontainers postgres:16 whose max_connections is 100 with 3 of those reserved for
        // the superuser. The module therefore hit the ceiling near its end and the NEXT class's
        // Flyway @BeforeAll could no longer connect at all: TableCatalogueIT, OrderLifecycleIT,
        // DiscountedTaxBaseIT and DiscountAuditTrailIT each reported "Tests run: 1, Errors: 1"
        // with FATAL: sorry, too many clients already — a harness failure wearing the costume of
        // a test failure, and one that lands on whichever classes happen to run last.
        //
        // Sized DOWN here rather than raising max_connections on the container, because the idle
        // pools are the cause and the ceiling is only where it becomes visible. Failsafe runs
        // this module in ONE fork on ONE thread: at most one context is doing work at any moment,
        // and none of them needs ten connections to serve a single-threaded test plus its
        // scheduler. minimum-idle=1 with the shortest idle-timeout Hikari accepts lets the nine
        // dormant contexts fall back to a single connection each, which puts the steady state
        // near a dozen instead of at the limit.
        registry.add("spring.datasource.hikari.maximum-pool-size", () -> "5");
        registry.add("spring.datasource.hikari.minimum-idle", () -> "1");
        registry.add("spring.datasource.hikari.idle-timeout", () -> "10000");
    }

    // Mock AMQP to prevent actual broker publishing
    @MockitoBean
    protected RabbitTemplate rabbitTemplate;

    /**
     * The outbox RELAY is stopped for this module. The outbox REPOSITORY deliberately is not —
     * suites here read {@code event_outbox} directly to prove an event was written in the same
     * transaction as the row it describes, and mocking the repository would delete that proof.
     *
     * <p>This is what silences the {@code relation "event_outbox" does not exist} stack traces a
     * full run used to print (measured: 20 of them, all logged by {@code [scheduling-1]}). The
     * table is NOT missing — {@code V2__pos_infra_tables.sql} creates it, and every one of those
     * errors names a window of a few milliseconds rather than a schema gap. {@link
     * #applyMigrations} runs {@code flyway.clean()} before every test CLASS, but the contexts are
     * cached and keep running: while class N+1 is dropping and re-creating the schema, the
     * relays belonging to the ten contexts already in the cache are still polling
     * {@code event_outbox} once a second and find it briefly gone.
     *
     * <p>Nothing here needs the relay. It has no broker to reach (the properties above point AMQP
     * at a dead port), so its only possible outcomes are a failed publish or an exception, and no
     * suite in this module asserts that a row reaches {@code SENT}. Stopping it also removes a
     * per-second transaction from each cached context, which is connections this module was
     * measurably short of.
     */
    @MockitoBean
    protected io.restaurantos.shared.event.OutboxRelay outboxRelay;

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

    /**
     * "OPA allows it" — the ambient default for every suite that is not ABOUT authorization.
     *
     * <p>Needed from Program A onward because {@code OrderServiceImpl.addItem} now evaluates a
     * policy ({@code pos.order.add_item}, the per-user menu-category boundary), and adding a line to
     * a check is what almost every suite in this module does. An unstubbed Mockito mock returns
     * {@code null} from {@code evaluate}, and {@code AuthorizationService.authorize} immediately
     * calls {@code .allow()} on it — so without this, twenty ITs that have nothing to do with
     * authorization fail with a {@code NullPointerException} inside the shared client.
     *
     * <p>Runs before any subclass {@code @BeforeEach} (JUnit 5 walks the hierarchy top-down), so a
     * suite that wants REAL decisions simply re-stubs it — which is exactly what
     * {@code VoidOwnOrderIT}, {@code VoidRefundOpaIT} and {@code MenuCategoryBoundaryIT} do, each
     * pointing the mock at a live OPA container holding this repository's real {@code policies/}.
     *
     * <p><b>Read what this default does NOT prove, because it is a blind spot and not a small one.</b>
     * A suite that inherits it is asserting behaviour on the assumption that policy said yes. It can
     * therefore never catch a rule that wrongly denies, and it makes an OPA-gated path look
     * unconditional. That is acceptable ONLY because the suites that own each boundary drive a real
     * engine — a boundary whose only coverage is a suite inheriting this line is not covered at all,
     * it is asserted by its own test fixture. Standing lesson 10-06-A: a test that mocks the thing
     * that broke proves nothing.
     */
    @BeforeEach
    void opaAllowsUnlessTheTestSaysOtherwise() {
        Mockito.when(opaClient.evaluate(ArgumentMatchers.any(), ArgumentMatchers.any()))
                .thenReturn(new io.restaurantos.shared.authz.OpaDecision(true));
    }

    /**
     * "Somebody is logged in" — a minimal authenticated principal for suites that never set one.
     *
     * <p>Nineteen ITs in this module call {@code orderService.addItem} without ever touching
     * {@code SecurityContextHolder}. That worked because nothing on the add-item path read the
     * principal; Program A's policy call does, through
     * {@code AuthorizationService.authorize} → {@code getAuthentication().getPrincipal()}.
     *
     * <p>What it exposed is worse than the immediate NPE, and is the reason this is fixed here
     * rather than in each suite. {@code SecurityContextHolder} is a THREAD-LOCAL and Failsafe runs a
     * whole module in one fork, so a context set by an earlier test CLASS is still on the thread
     * when a later one starts. Measured in a single run: {@code OrderLifecycleIT},
     * {@code OrderRevisionIT} and {@code KitchenTicketAssemblerIT} all passed while
     * {@code AssignTableIT} — which is no different in this respect — failed with
     * {@code getAuthentication() is null}. Which suites pass therefore depended on execution order.
     * That is a pre-existing latent flake this change surfaced, not one it introduced.
     *
     * <p><b>Only when there is none.</b> A suite that sets its own principal, in its own
     * {@code @BeforeEach} or inside the test, still wins — JUnit walks the hierarchy top-down.
     *
     * <p><b>Exactly one permission</b>, the one the add-item endpoint already requires. Not a
     * convenient bundle: {@code PosAuthorizationService.hasPermission} drives own-vs-all-branch
     * view scoping off this same claim list, so a generous default here would silently widen what
     * {@code listOrderSummaries} returns and quietly invalidate the suites that test it.
     */
    /**
     * Clears the principal AFTER every test, so the next one starts from a known state.
     *
     * <p>Without this the guard below is worse than useless. SecurityContextHolder is a
     * THREAD-LOCAL and Failsafe runs the whole module in ONE fork, so a principal set by an
     * earlier TEST CLASS is still on the thread when a later one starts — and the guard's early
     * return then declines to install the default in precisely the case where a leak happened.
     * Which principal a suite ran under was execution-order dependent, with a plausible principal
     * instead of a loud failure, which is the harder version to notice. Measured 2026-08-12: 41
     * files here touch SecurityContextHolder and only 4 cleared it.
     */
    @org.junit.jupiter.api.AfterEach
    void noPrincipalOutlivesItsTest() {
        org.springframework.security.core.context.SecurityContextHolder.clearContext();
    }

    @BeforeEach
    void someoneIsLoggedInUnlessTheTestSaysOtherwise() {
        if (org.springframework.security.core.context.SecurityContextHolder.getContext()
                .getAuthentication() != null) {
            return;
        }
        io.restaurantos.shared.security.JwtClaims claims = new io.restaurantos.shared.security.JwtClaims(
                java.util.UUID.randomUUID(), java.util.UUID.randomUUID(), java.util.UUID.randomUUID(),
                java.util.List.of("CASHIER"), java.util.List.of("pos.order.update"),
                java.util.Map.of(), null);
        org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
                new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(
                        claims, null, java.util.List.of()));
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
