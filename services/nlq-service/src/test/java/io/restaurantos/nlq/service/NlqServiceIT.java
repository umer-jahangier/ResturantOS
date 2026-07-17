package io.restaurantos.nlq.service;

import io.restaurantos.nlq.NlqServiceApplication;
import io.restaurantos.nlq.audit.NlqQueryLogEntity;
import io.restaurantos.nlq.audit.NlqQueryLogRepository;
import io.restaurantos.nlq.claude.ClaudeClient;
import io.restaurantos.nlq.claude.ClaudeUnavailableException;
import io.restaurantos.nlq.dto.NlqQueryResponse;
import io.restaurantos.nlq.execution.NlqRowCapExceededException;
import io.restaurantos.nlq.quota.QuotaExceededException;
import io.restaurantos.nlq.validation.NlqRejectedException;
import io.restaurantos.nlq.validation.QueryContext;
import io.restaurantos.nlq.validation.RejectionCode;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.clickhouse.ClickHouseContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;
import org.testcontainers.utility.MountableFile;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The real proof for plan 12-07 / NLQ-01 / NLQ-02: a Testcontainers Postgres (nlq_db) + Redis
 * (quota + cache) + ClickHouse (real {@code nlq_readonly} user, applied from the actual
 * {@code deploy/clickhouse/V001}/{@code V002} files on disk) — {@link ClaudeClient} is
 * {@code @MockitoBean}-stubbed so the test supplies "generated" SQL directly, which is exactly
 * the threat model: Claude's output is untrusted either way, so a stub returning hostile SQL is a
 * faithful simulation of a compromised or hallucinating model.
 *
 * <p>{@code restaurantos.nlq.max-result-rows} is deliberately overridden DOWN to a small test
 * value (both in this service's LimitInjectStage/executor AND in the live ClickHouse
 * {@code nlq_readonly_profile}) so the row-cap test is provable without seeding tens of
 * thousands of rows. {@code restaurantos.nlq.default-limit} is left LARGER than that test cap —
 * 12-04's {@code LimitInjectStage} only clamps an EXPLICIT over-cap LIMIT, it does not re-check
 * an INJECTED default against the cap (a latent gap in the "polite first line of defence" found
 * while writing this IT, documented in 12-07-SUMMARY.md rather than touched, per the plan's
 * explicit instruction not to modify 12-04's validator) — which is exactly what lets a
 * missing-LIMIT query legitimately reach the ClickHouse server-side cap for this proof.
 */
@SpringBootTest(classes = NlqServiceApplication.class)
@Testcontainers
class NlqServiceIT {

    private static final long TEST_MAX_RESULT_ROWS = 5;
    private static final long TEST_DEFAULT_LIMIT = 1000; // > TEST_MAX_RESULT_ROWS, see class javadoc.
    private static final long TEST_HOURLY_LIMIT = 2;
    private static final long TEST_MONTHLY_LIMIT = 50;
    private static final String CLICKHOUSE_READONLY_PASSWORD = "test-readonly-pass-12-07";
    private static final String CLICKHOUSE_ANALYTICS_DB = "clickhouse_analytics";

    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
            .withDatabaseName("nlq_db")
            .withUsername("nlq_user")
            .withPassword("test-pass");

    static final GenericContainer<?> REDIS =
            new GenericContainer<>(DockerImageName.parse("redis:7-alpine")).withExposedPorts(6379);

    // Testcontainers' ClickHouseContainer provisions its admin user as CLICKHOUSE_USER=test (not
    // "default") — that entrypoint-generated user also ships with SQL-driven access control
    // (access_management) disabled by default, the same finding 12-02 made for the real stack's
    // "default" user. Fixed with a test-only twin of deploy/clickhouse/zz-access-management.xml
    // targeting "test", copied in BEFORE start() so no mid-test restart is needed.
    static final ClickHouseContainer CLICKHOUSE =
            new ClickHouseContainer(DockerImageName.parse("clickhouse/clickhouse-server:25.9"))
                    .withCopyToContainer(
                            MountableFile.forClasspathResource("clickhouse-test-access-management.xml"),
                            "/etc/clickhouse-server/users.d/zz-access-management.xml");

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
        POSTGRES.start();
        REDIS.start();
        CLICKHOUSE.start();
    }

    @BeforeAll
    static void applyClickHouseSchema() throws Exception {
        try (Connection admin = adminConnection()) {
            applyStatements(admin, readAndStrip("deploy/clickhouse/V001__analytics_facts.sql"));

            // V002 read from disk (no drift on GRANT/user structure) with only the numeric
            // row-cap literal substituted down for test practicality, and the password
            // placeholder substituted — see class javadoc.
            String v002 = readAndStrip("deploy/clickhouse/V002__nlq_readonly_user.sql")
                    .replace("${CLICKHOUSE_READONLY_PASSWORD}", CLICKHOUSE_READONLY_PASSWORD)
                    .replace("10000 MAX 10000", TEST_MAX_RESULT_ROWS + " MAX " + TEST_MAX_RESULT_ROWS);
            applyStatements(admin, v002);
        }
    }

    private static Connection adminConnection() throws Exception {
        String jdbcUrl = "jdbc:clickhouse://" + CLICKHOUSE.getHost() + ":" + CLICKHOUSE.getMappedPort(8123);
        return DriverManager.getConnection(jdbcUrl, CLICKHOUSE.getUsername(), CLICKHOUSE.getPassword());
    }

    private static String readAndStrip(String relativePath) throws Exception {
        Path file = locateRepoFile(relativePath);
        String sql = Files.readString(file);
        return sql.lines()
                .map(line -> {
                    int commentStart = line.indexOf("--");
                    return commentStart >= 0 ? line.substring(0, commentStart) : line;
                })
                .reduce("", (a, b) -> a + "\n" + b);
    }

    private static void applyStatements(Connection conn, String withoutComments) throws Exception {
        try (Statement statement = conn.createStatement()) {
            for (String raw : withoutComments.split(";")) {
                String cleaned = raw.trim();
                if (!cleaned.isEmpty()) {
                    statement.execute(cleaned);
                }
            }
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

        r.add("spring.data.redis.host", REDIS::getHost);
        r.add("spring.data.redis.port", () -> String.valueOf(REDIS.getMappedPort(6379)));

        r.add("restaurantos.clickhouse.url",
                () -> "http://" + CLICKHOUSE.getHost() + ":" + CLICKHOUSE.getMappedPort(8123));
        r.add("restaurantos.clickhouse.database", () -> CLICKHOUSE_ANALYTICS_DB);
        r.add("restaurantos.clickhouse.readonly-user", () -> "nlq_readonly");
        r.add("restaurantos.clickhouse.readonly-password", () -> CLICKHOUSE_READONLY_PASSWORD);

        r.add("restaurantos.nlq.max-result-rows", () -> String.valueOf(TEST_MAX_RESULT_ROWS));
        r.add("restaurantos.nlq.default-limit", () -> String.valueOf(TEST_DEFAULT_LIMIT));
        r.add("restaurantos.nlq.user-hourly-limit", () -> String.valueOf(TEST_HOURLY_LIMIT));
        r.add("restaurantos.nlq.monthly-quota-default", () -> String.valueOf(TEST_MONTHLY_LIMIT));
        r.add("restaurantos.nlq.cache-ttl-seconds", () -> "60");
        // No real Anthropic key needed — ClaudeClient itself is @MockitoBean-replaced below.
        r.add("restaurantos.nlq.anthropic.api-key", () -> "unused-in-this-it");

        r.add("eureka.client.enabled", () -> "false");
        r.add("spring.cloud.config.enabled", () -> "false");
        r.add("spring.cloud.discovery.enabled", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @MockitoBean
    private ClaudeClient claudeClient;

    @Autowired
    private NlqService nlqService;

    @Autowired
    private NlqQueryLogRepository queryLogRepository;

    @Autowired
    private TenantContext tenantContext;

    // ── Helpers ──────────────────────────────────────────────────────────────────

    private static QueryContext ctx(UUID tenantId, UUID branchId, String role, boolean isOwner, UUID userId) {
        return new QueryContext(tenantId, branchId, role, isOwner, userId, null);
    }

    private void seedTenantContext(QueryContext ctx) {
        tenantContext.set(ctx.tenantId(), ctx.branchId(), ctx.userId(), ctx.impersonatedBy());
    }

    /** Seeds one sales_order_facts row directly (plain Statement, never a PreparedStatement — see
     * the pinned clickhouse-jdbc 0.8.6 constraint). */
    private void seedOrderFact(UUID tenantId, UUID branchId, String orderNo, long totalPaisa) throws Exception {
        try (Connection admin = adminConnection(); Statement st = admin.createStatement()) {
            String sql = "INSERT INTO clickhouse_analytics.sales_order_facts "
                    + "(tenant_id, branch_id, business_date, order_id, order_no, order_type, customer_id, "
                    + "subtotal_paisa, discount_paisa, service_charge_paisa, tax_paisa, total_paisa, "
                    + "till_session_id, cashier_id, closed_at, event_id) VALUES ("
                    + "'" + tenantId + "', '" + branchId + "', today(), generateUUIDv4(), '" + orderNo + "', "
                    + "'DINE_IN', NULL, " + totalPaisa + ", 0, 0, 0, " + totalPaisa + ", "
                    + "generateUUIDv4(), generateUUIDv4(), now64(3), generateUUIDv4())";
            st.execute(sql);
        }
    }

    private long countClickHouseRows(String table) throws Exception {
        try (Connection admin = adminConnection(); Statement st = admin.createStatement();
             ResultSet rs = st.executeQuery("SELECT count() FROM clickhouse_analytics." + table)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private boolean clickHouseTableExists(String table) throws Exception {
        try (Connection admin = adminConnection(); Statement st = admin.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT count() FROM system.tables WHERE database = '" + CLICKHOUSE_ANALYTICS_DB
                             + "' AND name = '" + table + "'")) {
            rs.next();
            return rs.getLong(1) > 0;
        }
    }

    // ── Test 1: happy path ─────────────────────────────────────────────────────

    @Test
    void happyPath_returnsRowsAndLogs() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        seedOrderFact(tenantId, branchId, "ORD-1", 10000L);
        seedOrderFact(tenantId, branchId, "ORD-2", 20000L);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no, total_paisa FROM sales_order_facts");
        when(claudeClient.narrate(anyString(), anyList())).thenReturn("Two orders were found.");

        NlqQueryResponse response = nlqService.query("What are my recent orders?", ctx);

        assertThat(response.rows()).hasSize(2);
        assertThat(response.sql()).contains("tenant_id").contains(tenantId.toString());
        assertThat(response.narrative()).isEqualTo("Two orders were found.");

        List<NlqQueryLogEntity> logs = queryLogRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId())).toList();
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).getRejectionCode()).isNull();
    }

    // ── Test 2: missing/unprovable tenant filter is rejected, no cross-tenant leak ──

    @Test
    void missingTenantFilter_isRejected() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID otherTenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        seedOrderFact(otherTenantId, UUID.randomUUID(), "OTHER-TENANT-ORDER", 999999L);

        // A UNION is an unprovable shape (12-04-SUMMARY: the tenant predicate cannot be proven
        // present on every arm by re-parse) — the second arm is deliberately unfiltered.
        when(claudeClient.generateSql(anyString(), anyString())).thenReturn(
                "SELECT order_no, total_paisa FROM sales_order_facts "
                        + "UNION SELECT order_no, total_paisa FROM sales_order_facts");

        assertThatThrownBy(() -> nlqService.query("show me every order everywhere", ctx))
                .isInstanceOf(NlqRejectedException.class)
                .satisfies(ex -> assertThat(((NlqRejectedException) ex).code())
                        .isEqualTo(RejectionCode.TENANT_FILTER_MISSING));

        // No cross-tenant row was ever returned — the request never executed at all.
        List<NlqQueryLogEntity> logs = queryLogRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId())).toList();
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).getRejectionCode()).isEqualTo("TENANT_FILTER_MISSING");
        assertThat(logs.get(0).getExecutedSql()).isNull();
    }

    // ── Test 3: branch filter is injected for non-OWNER; branch-2 rows never leak ──

    @Test
    void missingBranchFilter_nonOwner_isRejected() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branch1 = UUID.randomUUID();
        UUID branch2 = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branch1, "MANAGER", false, userId);
        seedTenantContext(ctx);

        seedOrderFact(tenantId, branch1, "BRANCH1-ORDER", 10000L);
        seedOrderFact(tenantId, branch2, "BRANCH2-ORDER", 20000L);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no, total_paisa FROM sales_order_facts");
        when(claudeClient.narrate(anyString(), anyList())).thenReturn(null);

        NlqQueryResponse response = nlqService.query("show me my branch's orders", ctx);

        assertThat(response.sql()).contains("branch_id").contains(branch1.toString());
        List<String> orderNos = response.rows().stream()
                .map(row -> String.valueOf(row.get("order_no"))).toList();
        assertThat(orderNos).contains("BRANCH1-ORDER").doesNotContain("BRANCH2-ORDER");
    }

    // A dedicated case for the OTHER branch-filter path: no branchId at all on a non-OWNER
    // context is a hard rejection, never an unfiltered query.
    @Test
    void nonOwnerWithNoBranchContext_isRejected_neverUnfiltered() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, null, "MANAGER", false, userId);
        seedTenantContext(ctx);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no, total_paisa FROM sales_order_facts");

        assertThatThrownBy(() -> nlqService.query("show me everything", ctx))
                .isInstanceOf(NlqRejectedException.class)
                .satisfies(ex -> assertThat(((NlqRejectedException) ex).code())
                        .isEqualTo(RejectionCode.BRANCH_FILTER_MISSING));
    }

    // ── Test 4: DDL attempt is rejected, table provably still exists ────────────

    @Test
    void ddlAttempt_isRejected() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("DROP TABLE sales_order_facts");

        assertThatThrownBy(() -> nlqService.query("delete all my sales data", ctx))
                .isInstanceOf(NlqRejectedException.class)
                .satisfies(ex -> assertThat(((NlqRejectedException) ex).code())
                        .isEqualTo(RejectionCode.SHAPE_INVALID));

        assertThat(clickHouseTableExists("sales_order_facts")).isTrue();

        List<NlqQueryLogEntity> logs = queryLogRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId())).toList();
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).getRejectionCode()).isEqualTo("SHAPE_INVALID");
    }

    // ── Test 5: INSERT attempt is rejected, row count provably unchanged ────────

    @Test
    void insertAttempt_isRejected() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        long before = countClickHouseRows("sales_order_facts");

        when(claudeClient.generateSql(anyString(), anyString())).thenReturn(
                "INSERT INTO sales_order_facts (tenant_id) VALUES ('" + tenantId + "')");

        assertThatThrownBy(() -> nlqService.query("add a fake order", ctx))
                .isInstanceOf(NlqRejectedException.class)
                .satisfies(ex -> assertThat(((NlqRejectedException) ex).code())
                        .isEqualTo(RejectionCode.SHAPE_INVALID));

        long after = countClickHouseRows("sales_order_facts");
        assertThat(after).isEqualTo(before);
    }

    // ── Test 6: PII column is rejected ───────────────────────────────────────────

    @Test
    void piiColumn_isRejected() {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT customer_id FROM sales_order_facts");

        assertThatThrownBy(() -> nlqService.query("who are my customers", ctx))
                .isInstanceOf(NlqRejectedException.class)
                .satisfies(ex -> assertThat(((NlqRejectedException) ex).code())
                        .isEqualTo(RejectionCode.PII_COLUMN_DENIED));
    }

    // ── Test 7: disallowed table is rejected ─────────────────────────────────────

    @Test
    void disallowedTable_isRejected() {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT * FROM system.users");

        assertThatThrownBy(() -> nlqService.query("show me all users", ctx))
                .isInstanceOf(NlqRejectedException.class)
                .satisfies(ex -> assertThat(((NlqRejectedException) ex).code())
                        .isEqualTo(RejectionCode.TABLE_NOT_ALLOWED));
    }

    // ── Test 8: row cap is enforced, never silently truncated ───────────────────

    @Test
    void rowCap_isEnforced() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        // More rows than TEST_MAX_RESULT_ROWS (5) — the missing-LIMIT default (1000, see class
        // javadoc) is NOT clamped by LimitInjectStage, so the query really does ask ClickHouse
        // for more rows than the server-side nlq_readonly_profile allows.
        for (int i = 0; i < TEST_MAX_RESULT_ROWS + 3; i++) {
            seedOrderFact(tenantId, branchId, "ROWCAP-" + i, 1000L);
        }

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no, total_paisa FROM sales_order_facts");

        assertThatThrownBy(() -> nlqService.query("list every order", ctx))
                .isInstanceOf(NlqRowCapExceededException.class);

        List<NlqQueryLogEntity> logs = queryLogRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId())).toList();
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).getRejectionCode()).isEqualTo("ROW_CAP_EXCEEDED");
        // Never a silently truncated row count sitting in the log as if it were a real result.
        assertThat(logs.get(0).getRowCount()).isNull();
    }

    // ── Test 9: quota gates BEFORE the Claude call ───────────────────────────────

    @Test
    void quotaExceeded_returns429() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no FROM sales_order_facts");

        // Exhaust the hourly limit (2) with distinct, successful (non-cached) requests.
        for (int i = 0; i < TEST_HOURLY_LIMIT; i++) {
            nlqService.query("quota question " + i, ctx);
        }
        verify(claudeClient, times((int) TEST_HOURLY_LIMIT)).generateSql(anyString(), anyString());

        assertThatThrownBy(() -> nlqService.query("one too many", ctx))
                .isInstanceOf(QuotaExceededException.class)
                .satisfies(ex -> assertThat(((QuotaExceededException) ex).quota())
                        .isEqualTo(QuotaExceededException.Quota.HOURLY_USER));

        // The rejected request never reached Claude — still exactly TEST_HOURLY_LIMIT calls.
        verify(claudeClient, times((int) TEST_HOURLY_LIMIT)).generateSql(anyString(), anyString());
        verify(claudeClient, never()).narrate(anyString(), anyList());
    }

    // ── Test 10: a repeated question inside 60s is exactly one Claude call ──────

    @Test
    void identicalQuestion_within60s_isCacheHit() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        seedOrderFact(tenantId, branchId, "CACHE-ORDER", 5000L);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no, total_paisa FROM sales_order_facts");

        String question = "how much did I make on cache orders";
        NlqQueryResponse first = nlqService.query(question, ctx);
        NlqQueryResponse second = nlqService.query(question, ctx);

        assertThat(first.cacheHit()).isFalse();
        assertThat(second.cacheHit()).isTrue();
        assertThat(second.rows()).isEqualTo(first.rows());
        verify(claudeClient, times(1)).generateSql(anyString(), anyString());

        List<NlqQueryLogEntity> logs = queryLogRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId())).toList();
        assertThat(logs).hasSize(2);
        assertThat(logs.stream().filter(NlqQueryLogEntity::isCacheHit)).hasSize(1);
    }

    // ── Test 11: impersonation is stamped from the JWT-sourced context ──────────

    @Test
    void impersonatedCall_stampsImpersonatedBy() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID impersonatedBy = UUID.randomUUID();
        QueryContext ctx = new QueryContext(tenantId, branchId, "MANAGER", false, userId, impersonatedBy);
        seedTenantContext(ctx);

        seedOrderFact(tenantId, branchId, "IMPERSONATED-ORDER", 5000L);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no, total_paisa FROM sales_order_facts");

        nlqService.query("impersonated question", ctx);

        List<NlqQueryLogEntity> logs = queryLogRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId())).toList();
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).getImpersonatedBy()).isEqualTo(impersonatedBy);
    }

    // ── Test 12: a different tenant's identical question is NOT a cache hit ─────

    @Test
    void differentTenant_sameQuestion_isNotACacheHit() throws Exception {
        UUID tenantA = UUID.randomUUID();
        UUID branchA = UUID.randomUUID();
        UUID userA = UUID.randomUUID();
        QueryContext ctxA = ctx(tenantA, branchA, "MANAGER", false, userA);

        UUID tenantB = UUID.randomUUID();
        UUID branchB = UUID.randomUUID();
        UUID userB = UUID.randomUUID();
        QueryContext ctxB = ctx(tenantB, branchB, "MANAGER", false, userB);

        seedTenantContext(ctxA);
        seedOrderFact(tenantA, branchA, "TENANT-A-ORDER", 11111L);
        seedTenantContext(ctxB);
        seedOrderFact(tenantB, branchB, "TENANT-B-ORDER", 22222L);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenReturn("SELECT order_no, total_paisa FROM sales_order_facts");

        String question = "cross tenant cache poisoning probe";

        seedTenantContext(ctxA);
        NlqQueryResponse responseA = nlqService.query(question, ctxA);

        seedTenantContext(ctxB);
        NlqQueryResponse responseB = nlqService.query(question, ctxB);

        assertThat(responseA.cacheHit()).isFalse();
        assertThat(responseB.cacheHit()).isFalse();
        verify(claudeClient, times(2)).generateSql(anyString(), anyString());

        List<String> tenantBOrderNos = responseB.rows().stream()
                .map(row -> String.valueOf(row.get("order_no"))).toList();
        assertThat(tenantBOrderNos).contains("TENANT-B-ORDER").doesNotContain("TENANT-A-ORDER");
    }

    // ── Bonus: Claude failure fails closed, no execution reachable ──────────────

    @Test
    void claudeFailure_failsClosed_neverExecutesAnything() {
        UUID tenantId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        QueryContext ctx = ctx(tenantId, branchId, "MANAGER", false, userId);
        seedTenantContext(ctx);

        when(claudeClient.generateSql(anyString(), anyString()))
                .thenThrow(new ClaudeUnavailableException("simulated outage"));

        assertThatThrownBy(() -> nlqService.query("anything", ctx))
                .isInstanceOf(ClaudeUnavailableException.class);

        List<NlqQueryLogEntity> logs = queryLogRepository.findAll().stream()
                .filter(e -> tenantId.equals(e.getTenantId())).toList();
        assertThat(logs).hasSize(1);
        assertThat(logs.get(0).getRejectionCode()).isEqualTo("CLAUDE_UNAVAILABLE");
    }
}
