package io.restaurantos.reporting.report;

import io.restaurantos.reporting.ReportingServiceApplication;
import io.restaurantos.reporting.dto.ReportRequest;
import io.restaurantos.reporting.dto.ReportResultDto;
import io.restaurantos.reporting.service.ReportService;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
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
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Real ClickHouse + real Postgres proof that {@link ReportService}'s tenant/branch isolation is
 * structural, not merely assumed: rows are seeded for TWO tenants and TWO branches, and every
 * assertion checks that a caller's report totals equal ONLY their own seeded numbers.
 *
 * <p>Runs {@link ReportService} directly (not through {@code MockMvc}/HTTP) — this exercises the
 * real Spring-wired service against real ClickHouse/Postgres, which is where the isolation logic
 * (server-derived tenant bind, branch-scoping resolution) actually lives; the REST layer
 * ({@code ReportController}) is a thin pass-through proven by its own compile-time
 * {@code @PreAuthorize} annotations and the live-stack curl check in 12-05-PLAN.md's verification.
 */
@SpringBootTest(
        classes = ReportingServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
class ReportServiceIT {

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
    private static final UUID BRANCH_1 = UUID.randomUUID(); // tenant A
    private static final UUID BRANCH_2 = UUID.randomUUID(); // tenant A
    private static final UUID BRANCH_3 = UUID.randomUUID(); // tenant B
    private static final LocalDate BUSINESS_DATE = LocalDate.of(2026, 3, 10);

    // Known totals, seeded once, asserted against below.
    private static final long TENANT_A_BRANCH_1_SUBTOTAL = 10_000L;
    private static final long TENANT_A_BRANCH_2_SUBTOTAL = 5_000L;
    private static final long TENANT_B_BRANCH_3_SUBTOTAL = 7_000L;

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
            seedSalesFacts(connection);
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

    private static void seedSalesFacts(Connection connection) throws Exception {
        String insertOrder = """
                INSERT INTO clickhouse_analytics.sales_order_facts
                    (tenant_id, branch_id, business_date, order_id, order_no, order_type, customer_id,
                     subtotal_paisa, discount_paisa, service_charge_paisa, tax_paisa, total_paisa,
                     till_session_id, cashier_id, closed_at, event_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """;
        insertOrderFact(connection, insertOrder, TENANT_A, BRANCH_1, TENANT_A_BRANCH_1_SUBTOTAL);
        insertOrderFact(connection, insertOrder, TENANT_A, BRANCH_2, TENANT_A_BRANCH_2_SUBTOTAL);
        insertOrderFact(connection, insertOrder, TENANT_B, BRANCH_3, TENANT_B_BRANCH_3_SUBTOTAL);

        // A dedicated order + item pair for salesByItem_cogsIsNull, isolated from the above so
        // this test's assertions are not polluted by the other seeded orders.
        UUID cogsOrderId = UUID.randomUUID();
        insertOrderFactExplicit(connection, insertOrder, TENANT_A, BRANCH_1, cogsOrderId, 20_000L);
        insertItemFact(connection, TENANT_A, BRANCH_1, cogsOrderId);
    }

    private static void insertOrderFact(Connection connection, String sql, UUID tenantId, UUID branchId,
                                         long subtotalPaisa) throws Exception {
        insertOrderFactExplicit(connection, sql, tenantId, branchId, UUID.randomUUID(), subtotalPaisa);
    }

    private static void insertOrderFactExplicit(Connection connection, String sql, UUID tenantId, UUID branchId,
                                                 UUID orderId, long subtotalPaisa) throws Exception {
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            long taxPaisa = subtotalPaisa / 10;
            ps.setObject(1, tenantId);
            ps.setObject(2, branchId);
            // Bind business_date as a LocalDate — the type SalesFactWriter writes with. NOT
            // java.sql.Date.valueOf: on this non-UTC JVM (Australia/Sydney) clickhouse-jdbc stores
            // it a day early, so the LocalDate-bound report query would never match. Proven empirically.
            ps.setObject(3, BUSINESS_DATE);
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
            ps.setTimestamp(15, Timestamp.from(
                    BUSINESS_DATE.atTime(14, 0).atZone(java.time.ZoneOffset.UTC).toInstant()));
            ps.setObject(16, UUID.randomUUID());
            ps.execute();
        }
    }

    private static void insertItemFact(Connection connection, UUID tenantId, UUID branchId, UUID orderId)
            throws Exception {
        String sql = """
                INSERT INTO clickhouse_analytics.sales_item_facts
                    (tenant_id, branch_id, business_date, order_id, line_no, menu_item_id, item_name,
                     qty, unit_price_paisa, line_total_paisa, cogs_paisa, gross_margin_paisa,
                     category_name, closed_at, event_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """;
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setObject(1, tenantId);
            ps.setObject(2, branchId);
            // Bind business_date as a LocalDate — the type SalesFactWriter writes with. NOT
            // java.sql.Date.valueOf: on this non-UTC JVM (Australia/Sydney) clickhouse-jdbc stores
            // it a day early, so the LocalDate-bound report query would never match. Proven empirically.
            ps.setObject(3, BUSINESS_DATE);
            ps.setObject(4, orderId);
            ps.setInt(5, 0);
            ps.setObject(6, UUID.randomUUID());
            ps.setString(7, "Chicken Karahi");
            ps.setInt(8, 1);
            ps.setLong(9, 20_000L);
            ps.setLong(10, 20_000L);
            ps.setNull(11, java.sql.Types.BIGINT);
            ps.setNull(12, java.sql.Types.BIGINT);
            ps.setNull(13, java.sql.Types.VARCHAR);
            ps.setTimestamp(14, Timestamp.from(
                    BUSINESS_DATE.atTime(14, 0).atZone(java.time.ZoneOffset.UTC).toInstant()));
            ps.setObject(15, UUID.randomUUID());
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
    private ReportService reportService;

    @Autowired
    private TenantContext tenantContext;

    @Autowired
    @Qualifier("jdbcTemplate")
    private JdbcTemplate postgresJdbcTemplate;

    @AfterEach
    void clearContext() {
        tenantContext.clear();
        SecurityContextHolder.clearContext();
    }

    private void authenticateAs(UUID tenantId, UUID branchId, boolean owner) {
        tenantContext.set(tenantId, branchId, UUID.randomUUID(), null);
        List<String> roles = owner ? List.of("OWNER") : List.of("MANAGER");
        List<String> permissions = List.of("reporting.report.view", "reporting.report.fbr");
        JwtClaims claims = new JwtClaims(UUID.randomUUID(), tenantId, branchId, roles, permissions, Map.of(), null);
        var authorities = permissions.stream().map(SimpleGrantedAuthority::new).toList();
        var authentication = new UsernamePasswordAuthenticationToken(claims, null, authorities);
        SecurityContextHolder.getContext().setAuthentication(authentication);
    }

    @Test
    void salesByDay_returnsOnlyCallersTenant() {
        // OWNER, no branchId => tenant-wide (both of tenant A's branches, never tenant B's).
        authenticateAs(TENANT_A, BRANCH_1, true);

        ReportResultDto result = reportService.run("sales-by-day",
                new ReportRequest(null, BUSINESS_DATE, BUSINESS_DATE, null));

        long totalSubtotal = result.rows().stream()
                .mapToLong(row -> ((Number) row.get("subtotal_paisa")).longValue())
                .sum();
        // Tenant A's two seeded orders (10,000 + 5,000) PLUS the dedicated cogs-test order
        // (20,000) = 35,000. Tenant B's 7,000 must never appear.
        assertThat(totalSubtotal).isEqualTo(TENANT_A_BRANCH_1_SUBTOTAL + TENANT_A_BRANCH_2_SUBTOTAL + 20_000L);
        assertThat(totalSubtotal).isNotEqualTo(TENANT_B_BRANCH_3_SUBTOTAL);
    }

    @Test
    void salesByDay_branchScoped() {
        // Non-OWNER caller, JWT-pinned to BRANCH_1: must see ONLY branch 1's rows.
        authenticateAs(TENANT_A, BRANCH_1, false);

        ReportResultDto result = reportService.run("sales-by-day",
                new ReportRequest(null, BUSINESS_DATE, BUSINESS_DATE, null));

        long totalSubtotal = result.rows().stream()
                .mapToLong(row -> ((Number) row.get("subtotal_paisa")).longValue())
                .sum();
        // Only branch 1's own 10,000 (the dedicated cogs order is also on branch 1: +20,000).
        assertThat(totalSubtotal).isEqualTo(TENANT_A_BRANCH_1_SUBTOTAL + 20_000L);
    }

    @Test
    void salesByItem_cogsIsNull() {
        authenticateAs(TENANT_A, BRANCH_1, false);

        ReportResultDto result = reportService.run("sales-by-item",
                new ReportRequest(null, BUSINESS_DATE, BUSINESS_DATE, null));

        assertThat(result.rows()).isNotEmpty();
        assertThat(result.rows()).allSatisfy(row -> {
            assertThat(row.get("cogs_paisa")).isNull();
            assertThat(row.get("gross_margin_paisa")).isNull();
        });
        assertThat(result.dataNotes()).anyMatch(note -> note.contains("Phase 8"));
    }

    @Test
    void reportRun_isLogged() {
        UUID dedicatedTenant = UUID.randomUUID();
        UUID dedicatedBranch = UUID.randomUUID();
        authenticateAs(dedicatedTenant, dedicatedBranch, true);

        reportService.run("sales-by-day", new ReportRequest(null, BUSINESS_DATE, BUSINESS_DATE, null));

        Integer rowCount = postgresJdbcTemplate.queryForObject(
                "SELECT count(*) FROM report_run_log WHERE tenant_id = ? AND report_code = ?",
                Integer.class, dedicatedTenant, "sales-by-day");
        assertThat(rowCount).isEqualTo(1);

        Integer durationNotNull = postgresJdbcTemplate.queryForObject(
                "SELECT count(*) FROM report_run_log WHERE tenant_id = ? AND report_code = ? AND duration_ms IS NOT NULL",
                Integer.class, dedicatedTenant, "sales-by-day");
        assertThat(durationNotNull).isEqualTo(1);
    }
}
