package io.restaurantos.reporting.report;

import io.restaurantos.reporting.ReportingServiceApplication;
import io.restaurantos.reporting.dto.FbrTaxSummaryDto;
import io.restaurantos.reporting.feign.UserInternalClient;
import io.restaurantos.reporting.service.FbrTaxSummaryService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.clickhouse.ClickHouseContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * The real proof for RPT-01's headline claim: output tax (POS, {@code sales_order_facts}) minus
 * input tax (Purchasing, {@code purchase_tax_facts}) equals net payable, exact to the paisa,
 * against real fact rows in a real ClickHouse.
 *
 * <p>{@link UserInternalClient} is stubbed with {@code @MockitoBean} for the branch header
 * (name/ntn/fbrStrn) — this means this IT does NOT exercise the real JWT-forwarding Feign call
 * path. That is exactly the blind spot commit 990026a fell into (PurchasingEndpointAuthorizationIT
 * -style ITs that stub the internal client never catch a missing-JWT-forward regression). The real
 * call path is proven only in 12-10's live-stack run — flagged in 12-05-SUMMARY.md.
 */
@SpringBootTest(
        classes = ReportingServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
class FbrTaxSummaryIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("reporting_db")
                    .withUsername("reporting_user")
                    .withPassword("test-pass");

    @Container
    static final RabbitMQContainer RABBIT =
            new RabbitMQContainer(DockerImageName.parse("rabbitmq:3.12-management"));

    @Container
    static final ClickHouseContainer CLICKHOUSE =
            new ClickHouseContainer(DockerImageName.parse("clickhouse/clickhouse-server:25.9"));

    @Container
    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    private static final String CLICKHOUSE_ANALYTICS_DB = "clickhouse_analytics";

    private static final UUID TENANT_A = UUID.randomUUID();
    private static final UUID TENANT_B = UUID.randomUUID();
    private static final UUID BRANCH_A = UUID.randomUUID();
    private static final UUID BRANCH_B = UUID.randomUUID();
    private static final LocalDate PERIOD_FROM = LocalDate.of(2026, 3, 1);
    private static final LocalDate PERIOD_TO = LocalDate.of(2026, 3, 31);
    // Business date D+1 at 01:00 rolls back to D under the 4h boundary — used by
    // fbrSummary_usesBusinessDateBoundary. Both fall within the March period above.
    private static final LocalDate BOUNDARY_BUSINESS_DATE = LocalDate.of(2026, 3, 15);

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
    }

    @BeforeAll
    static void applySchemaAndSeed() throws Exception {
        Path ddlFile = locateRepoFile("deploy/clickhouse/V001__analytics_facts.sql");
        String clickHouseJdbcUrl = "jdbc:clickhouse://" + CLICKHOUSE.getHost() + ":"
                + CLICKHOUSE.getMappedPort(8123);
        try (Connection connection = DriverManager.getConnection(
                clickHouseJdbcUrl, CLICKHOUSE.getUsername(), CLICKHOUSE.getPassword())) {
            applyDdl(connection, ddlFile);
            seedFacts(connection);
        }
    }

    private static void applyDdl(Connection connection, Path ddlFile) throws Exception {
        String sql = Files.readString(ddlFile);
        String withoutComments = sql.lines()
                .map(line -> {
                    int commentStart = line.indexOf("--");
                    return commentStart >= 0 ? line.substring(0, commentStart) : line;
                })
                .reduce("", (a, b) -> a + "\n" + b);
        try (Statement statement = connection.createStatement()) {
            for (String rawStatement : withoutComments.split(";")) {
                String cleaned = rawStatement.trim();
                if (!cleaned.isEmpty()) {
                    statement.execute(cleaned);
                }
            }
        }
    }

    /**
     * Known integers, asserted exactly (this is money, no tolerance):
     * Tenant A / Branch A output tax: 1,000 + 2,500 + 500 = 4,000 paisa (three orders).
     * Tenant A / Branch A input tax: 1,500 + 250 = 1,750 paisa (two invoices).
     * netPayable = 4,000 - 1,750 = 2,250.
     *
     * Tenant B / Branch B: a single order with output tax 9,999 — must NEVER leak into tenant A's
     * summary (fbrSummary_isTenantScoped).
     *
     * A dedicated tenant/branch pair carries ONLY input tax (900) with zero output tax, proving
     * netPayable_canBeNegative (900 input, 0 output -> -900, not clamped to 0).
     */
    private static void seedFacts(Connection connection) throws Exception {
        insertOrder(connection, TENANT_A, BRANCH_A, PERIOD_FROM.plusDays(1), 1_000L);
        insertOrder(connection, TENANT_A, BRANCH_A, PERIOD_FROM.plusDays(2), 2_500L);
        insertOrder(connection, TENANT_A, BRANCH_A, PERIOD_FROM.plusDays(3), 500L);
        insertInvoice(connection, TENANT_A, BRANCH_A, PERIOD_FROM.plusDays(1), 1_500L);
        insertInvoice(connection, TENANT_A, BRANCH_A, PERIOD_FROM.plusDays(2), 250L);

        insertOrder(connection, TENANT_B, BRANCH_B, PERIOD_FROM.plusDays(1), 9_999L);

        // Business-day boundary: an order that occurred at 01:00 on BOUNDARY_BUSINESS_DATE+1
        // (Asia/Karachi) is written with business_date = BOUNDARY_BUSINESS_DATE by the real ETL
        // (BusinessDay's 4h offset formula, proven in 12-03's EtlPipelineIT). This IT seeds the
        // fact row directly with that already-computed business_date (the same value the ETL
        // would have produced) — the assertion is that the FBR query's BETWEEN predicate keys off
        // business_date, so this row counts toward BOUNDARY_BUSINESS_DATE's period even though the
        // wall-clock timestamp is technically the next day.
        insertOrderWithClosedAt(connection, TENANT_A, BRANCH_A, BOUNDARY_BUSINESS_DATE, 321L,
                BOUNDARY_BUSINESS_DATE.plusDays(1).atTime(1, 0).atZone(ZoneOffset.UTC).toInstant());

        // Negative-net-payable tenant/branch: only input tax, no output tax.
        insertInvoice(connection, NEGATIVE_TENANT, NEGATIVE_BRANCH, PERIOD_FROM.plusDays(1), 900L);
    }

    private static final UUID NEGATIVE_TENANT = UUID.randomUUID();
    private static final UUID NEGATIVE_BRANCH = UUID.randomUUID();

    private static void insertOrder(Connection connection, UUID tenantId, UUID branchId,
                                     LocalDate businessDate, long taxPaisa) throws Exception {
        insertOrderWithClosedAt(connection, tenantId, branchId, businessDate, taxPaisa,
                businessDate.atTime(14, 0).atZone(ZoneOffset.UTC).toInstant());
    }

    private static void insertOrderWithClosedAt(Connection connection, UUID tenantId, UUID branchId,
                                                 LocalDate businessDate, long taxPaisa,
                                                 java.time.Instant closedAt) throws Exception {
        String sql = """
                INSERT INTO clickhouse_analytics.sales_order_facts
                    (tenant_id, branch_id, business_date, order_id, order_no, order_type, customer_id,
                     subtotal_paisa, discount_paisa, service_charge_paisa, tax_paisa, total_paisa,
                     till_session_id, cashier_id, closed_at, event_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """;
        UUID orderId = UUID.randomUUID();
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            long subtotalPaisa = taxPaisa * 10;
            ps.setObject(1, tenantId);
            ps.setObject(2, branchId);
            // LocalDate, not java.sql.Date.valueOf: the latter stores a day early on a non-UTC JVM
            // (clickhouse-jdbc 0.8.6, Australia/Sydney). Matches SalesFactWriter's write type.
            ps.setObject(3, businessDate);
            ps.setObject(4, orderId);
            ps.setString(5, "ORD-" + orderId.toString().substring(0, 8));
            ps.setString(6, "DINE_IN");
            ps.setObject(7, UUID.randomUUID());
            ps.setLong(8, subtotalPaisa);
            ps.setLong(9, 0L);
            ps.setLong(10, 0L);
            ps.setLong(11, taxPaisa);
            ps.setLong(12, subtotalPaisa + taxPaisa);
            ps.setObject(13, UUID.randomUUID());
            ps.setObject(14, UUID.randomUUID());
            ps.setTimestamp(15, Timestamp.from(closedAt));
            ps.setObject(16, UUID.randomUUID());
            ps.execute();
        }
    }

    private static void insertInvoice(Connection connection, UUID tenantId, UUID branchId,
                                       LocalDate businessDate, long inputTaxPaisa) throws Exception {
        String sql = """
                INSERT INTO clickhouse_analytics.purchase_tax_facts
                    (tenant_id, branch_id, business_date, invoice_id, purchase_order_id,
                     input_tax_paisa, total_paisa, match_status, matched_at, event_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            long totalPaisa = inputTaxPaisa * 10;
            ps.setObject(1, tenantId);
            ps.setObject(2, branchId);
            // LocalDate, not java.sql.Date.valueOf: the latter stores a day early on a non-UTC JVM
            // (clickhouse-jdbc 0.8.6, Australia/Sydney). Matches SalesFactWriter's write type.
            ps.setObject(3, businessDate);
            ps.setObject(4, UUID.randomUUID());
            ps.setObject(5, UUID.randomUUID());
            ps.setLong(6, inputTaxPaisa);
            ps.setLong(7, totalPaisa);
            ps.setString(8, "APPROVED_FOR_PAYMENT");
            ps.setTimestamp(9, Timestamp.from(businessDate.atTime(10, 0).atZone(ZoneOffset.UTC).toInstant()));
            ps.setObject(10, UUID.randomUUID());
            ps.execute();
        }
    }

    private static Path locateRepoFile(String relativePath) {
        Path cwd = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        for (Path candidate : List.of(
                cwd.resolve(relativePath).normalize(),
                cwd.resolve("../../" + relativePath).normalize(),
                cwd.resolve("../" + relativePath).normalize())) {
            if (Files.exists(candidate)) {
                return candidate;
            }
        }
        throw new IllegalStateException("Could not locate " + relativePath + " from " + cwd);
    }

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.flyway.enabled", () -> "true");

        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);

        r.add("restaurantos.clickhouse.url",
                () -> "http://" + CLICKHOUSE.getHost() + ":" + CLICKHOUSE.getMappedPort(8123));
        r.add("restaurantos.clickhouse.database", () -> CLICKHOUSE_ANALYTICS_DB);
        r.add("restaurantos.clickhouse.user", CLICKHOUSE::getUsername);
        r.add("restaurantos.clickhouse.password", CLICKHOUSE::getPassword);

        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> String.valueOf(REDIS.getMappedPort(6379)));

        r.add("eureka.client.enabled", () -> "false");
        r.add("spring.cloud.config.enabled", () -> "false");
        r.add("spring.cloud.discovery.enabled", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @Autowired
    private FbrTaxSummaryService fbrTaxSummaryService;

    @Autowired
    private TenantContext tenantContext;

    @MockitoBean
    private UserInternalClient userInternalClient;

    @AfterEach
    void clearContext() {
        tenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(UUID tenantId, UUID branchId) {
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        List<String> permissions = List.of("reporting.report.fbr");
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId,
                List.of("OWNER"), permissions, Map.of(), null);
        var authorities = permissions.stream().map(SimpleGrantedAuthority::new).toList();
        var authentication = new UsernamePasswordAuthenticationToken(claims, null, authorities);
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }

    @Test
    void netPayable_isOutputMinusInput() {
        authenticateAs(TENANT_A, BRANCH_A);
        when(userInternalClient.getBranch(any()))
                .thenReturn(new UserInternalClient.BranchInternalDto(
                        BRANCH_A, "Main Branch", "1234567-8", "STRN-001", "Asia/Karachi"));

        FbrTaxSummaryDto summary = fbrTaxSummaryService.summary(BRANCH_A, PERIOD_FROM, PERIOD_TO);

        // Three orders (1,000 + 2,500 + 500) plus the boundary order (321) = 4,321.
        assertThat(summary.outputTaxPaisa()).isEqualTo(4_321L);
        assertThat(summary.inputTaxPaisa()).isEqualTo(1_750L);
        assertThat(summary.netPayablePaisa()).isEqualTo(4_321L - 1_750L);
        assertThat(summary.branchName()).isEqualTo("Main Branch");
        assertThat(summary.ntn()).isEqualTo("1234567-8");
        assertThat(summary.fbrStrn()).isEqualTo("STRN-001");
    }

    @Test
    void netPayable_canBeNegative() {
        authenticateAs(NEGATIVE_TENANT, NEGATIVE_BRANCH);
        when(userInternalClient.getBranch(any()))
                .thenReturn(new UserInternalClient.BranchInternalDto(
                        NEGATIVE_BRANCH, "Credit Branch", null, null, "Asia/Karachi"));

        FbrTaxSummaryDto summary = fbrTaxSummaryService.summary(NEGATIVE_BRANCH, PERIOD_FROM, PERIOD_TO);

        assertThat(summary.outputTaxPaisa()).isEqualTo(0L);
        assertThat(summary.inputTaxPaisa()).isEqualTo(900L);
        assertThat(summary.netPayablePaisa()).isEqualTo(-900L);
        assertThat(summary.netPayablePaisa()).isNegative();
    }

    @Test
    void fbrSummary_isTenantScoped() {
        authenticateAs(TENANT_A, BRANCH_A);
        when(userInternalClient.getBranch(any()))
                .thenReturn(new UserInternalClient.BranchInternalDto(
                        BRANCH_A, "Main Branch", "1234567-8", "STRN-001", "Asia/Karachi"));

        FbrTaxSummaryDto summary = fbrTaxSummaryService.summary(BRANCH_A, PERIOD_FROM, PERIOD_TO);

        // Tenant B's 9,999 output tax must never leak into tenant A's summary.
        assertThat(summary.outputTaxPaisa()).isNotEqualTo(9_999L);
        assertThat(summary.outputTaxPaisa()).isEqualTo(4_321L);
    }

    @Test
    void fbrSummary_usesBusinessDateBoundary() {
        authenticateAs(TENANT_A, BRANCH_A);
        when(userInternalClient.getBranch(any()))
                .thenReturn(new UserInternalClient.BranchInternalDto(
                        BRANCH_A, "Main Branch", "1234567-8", "STRN-001", "Asia/Karachi"));

        // Narrow the period to ONLY the boundary business date — the 01:00-next-day order (321
        // paisa tax) must still be counted here because its business_date (not its wall-clock
        // closed_at) is BOUNDARY_BUSINESS_DATE.
        FbrTaxSummaryDto summary = fbrTaxSummaryService.summary(
                BRANCH_A, BOUNDARY_BUSINESS_DATE, BOUNDARY_BUSINESS_DATE);

        assertThat(summary.outputTaxPaisa()).isEqualTo(321L);
    }
}
