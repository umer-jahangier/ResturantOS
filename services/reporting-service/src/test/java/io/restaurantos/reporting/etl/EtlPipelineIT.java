package io.restaurantos.reporting.etl;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.ReportingServiceApplication;
import io.restaurantos.reporting.config.ReportingRabbitConfig;
import io.restaurantos.reporting.event.ReportingEventPayloads.ItemEntry;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
import io.restaurantos.reporting.event.ReportingEventPayloads.TillClosedPayload;
import io.restaurantos.reporting.event.ReportingEventPayloads.VendorInvoiceMatchedPayload;
import io.restaurantos.shared.event.EventEnvelope;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.clickhouse.ClickHouseContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.UUID;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * The real proof: publish a real ORDER_CLOSED / TILL_CLOSED / VENDOR_INVOICE_MATCHED to a real
 * RabbitMQ and assert the correct row lands in a real ClickHouse, bucketed by the business-day
 * formula, with a redelivery producing no duplicate. Postgres + RabbitMQ + ClickHouse are all
 * Testcontainers (TESTCONTAINERS_RYUK_DISABLED=true — decision 03-01-D, required for Colima);
 * Redis is a plain container too so the branch-timezone cache path never depends on host state.
 *
 * <p>Applies deploy/clickhouse/V001__analytics_facts.sql BY READING THE FILE FROM DISK — never a
 * duplicated copy of the DDL, so this test cannot silently drift from the real schema.
 */
@SpringBootTest(
        classes = ReportingServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
class EtlPipelineIT {

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
    private static final UUID TENANT_ID = UUID.randomUUID();

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
    }

    @BeforeAll
    static void applyClickHouseSchema() throws Exception {
        Path ddlFile = locateRepoFile("deploy/clickhouse/V001__analytics_facts.sql");
        String sql = Files.readString(ddlFile);
        String clickHouseJdbcUrl = "jdbc:clickhouse://" + CLICKHOUSE.getHost() + ":"
                + CLICKHOUSE.getMappedPort(8123);
        try (Connection connection = DriverManager.getConnection(
                clickHouseJdbcUrl, CLICKHOUSE.getUsername(), CLICKHOUSE.getPassword());
             Statement statement = connection.createStatement()) {
            // ClickHouse's HTTP interface (and this JDBC driver's Statement) rejects
            // multi-statement bodies, so the file must be split into individual statements.
            //
            // Order matters: strip '--' comments to end-of-line BEFORE splitting on ';', exactly
            // as deploy/clickhouse/apply.sh does (`sed 's/--.*$//'`). Splitting first tears any
            // comment that itself contains a ';' — V001 line 8 ("(duplicates can be visible
            // between merges); acceptable for analytics facts, per 12-RESEARCH") — in half, and
            // the tail, no longer prefixed by '--', is then executed as SQL and fails with
            // "Syntax error: failed at position 1 (acceptable)".
            // (None of our DDL's string literals contain '--'.)
            String withoutComments = sql.lines()
                    .map(line -> {
                        int commentStart = line.indexOf("--");
                        return commentStart >= 0 ? line.substring(0, commentStart) : line;
                    })
                    .reduce("", (a, b) -> a + "\n" + b);
            for (String rawStatement : withoutComments.split(";")) {
                String cleaned = rawStatement.trim();
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
    private RabbitTemplate rabbitTemplate;

    @Autowired
    @Qualifier("eventObjectMapper")
    private ObjectMapper objectMapper;

    @Autowired
    @Qualifier("clickHouseJdbcTemplate")
    private JdbcTemplate clickHouseJdbcTemplate;

    @Autowired
    @Qualifier("jdbcTemplate")
    private JdbcTemplate postgresJdbcTemplate;

    // ── Test 1: order + item facts ─────────────────────────────────────────────

    @Test
    void orderClosed_landsOrderAndItemFacts() {
        UUID orderId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        Instant closedAt = ZonedDateTime.of(
                java.time.LocalDateTime.parse("2026-03-10T14:00:00"), ZoneId.of("Asia/Karachi")).toInstant();

        OrderClosedPayload payload = orderClosedPayload(orderId, closedAt, 2);
        EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                UUID.randomUUID(), "ORDER_CLOSED", TENANT_ID, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);

        publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            Long orderCount = clickHouseJdbcTemplate.queryForObject(
                    "SELECT count() FROM clickhouse_analytics.sales_order_facts WHERE order_id = ?",
                    Long.class, orderId);
            assertThat(orderCount).isEqualTo(1L);

            Long itemCount = clickHouseJdbcTemplate.queryForObject(
                    "SELECT count() FROM clickhouse_analytics.sales_item_facts WHERE order_id = ?",
                    Long.class, orderId);
            assertThat(itemCount).isEqualTo(2L);

            var row = clickHouseJdbcTemplate.queryForMap(
                    "SELECT total_paisa, tax_paisa FROM clickhouse_analytics.sales_order_facts WHERE order_id = ?",
                    orderId);
            assertThat(((Number) row.get("total_paisa")).longValue()).isEqualTo(payload.totalPaisa());
            assertThat(((Number) row.get("tax_paisa")).longValue()).isEqualTo(payload.taxPaisa());
        });
    }

    // ── Test 2: COGS columns are honestly NULL ───────────────────────────────────

    @Test
    void orderClosed_cogsColumnsAreNull() {
        UUID orderId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        Instant closedAt = ZonedDateTime.of(
                java.time.LocalDateTime.parse("2026-03-10T14:00:00"), ZoneId.of("Asia/Karachi")).toInstant();

        OrderClosedPayload payload = orderClosedPayload(orderId, closedAt, 2);
        EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                UUID.randomUUID(), "ORDER_CLOSED", TENANT_ID, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);

        publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            Long nonNullCount = clickHouseJdbcTemplate.queryForObject(
                    "SELECT count() FROM clickhouse_analytics.sales_item_facts "
                            + "WHERE order_id = ? AND (cogs_paisa IS NOT NULL OR gross_margin_paisa IS NOT NULL "
                            + "OR category_name IS NOT NULL)",
                    Long.class, orderId);
            assertThat(nonNullCount).isEqualTo(0L);

            Long totalRows = clickHouseJdbcTemplate.queryForObject(
                    "SELECT count() FROM clickhouse_analytics.sales_item_facts WHERE order_id = ?",
                    Long.class, orderId);
            assertThat(totalRows).isEqualTo(2L);
        });
    }

    // ── Test 3: business-day boundary, end to end ────────────────────────────────

    @Test
    void orderClosedAtOneAm_bucketsToPreviousBusinessDay() {
        UUID orderId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        // 01:00 Asia/Karachi on 2026-03-11 -> business_date 2026-03-10 (previous calendar day).
        // Note: BranchTimeZoneResolver falls back to the configured default timezone
        // (Asia/Karachi) in this IT, since there is no live user-service/Eureka to resolve the
        // branch against — see 12-03-SUMMARY.md.
        Instant closedAt = ZonedDateTime.of(
                java.time.LocalDateTime.parse("2026-03-11T01:00:00"), ZoneId.of("Asia/Karachi")).toInstant();

        OrderClosedPayload payload = orderClosedPayload(orderId, closedAt, 1);
        EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                UUID.randomUUID(), "ORDER_CLOSED", TENANT_ID, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);

        publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            java.sql.Date businessDate = clickHouseJdbcTemplate.queryForObject(
                    "SELECT business_date FROM clickhouse_analytics.sales_order_facts WHERE order_id = ?",
                    java.sql.Date.class, orderId);
            assertThat(businessDate).isNotNull();
            assertThat(businessDate.toLocalDate()).isEqualTo(LocalDate.parse("2026-03-10"));
        });
    }

    // ── Test 4: redelivery does not duplicate ────────────────────────────────────

    @Test
    void redeliveredEvent_doesNotDuplicate() {
        UUID orderId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID eventId = UUID.randomUUID();
        Instant closedAt = ZonedDateTime.of(
                java.time.LocalDateTime.parse("2026-03-10T14:00:00"), ZoneId.of("Asia/Karachi")).toInstant();

        OrderClosedPayload payload = orderClosedPayload(orderId, closedAt, 1);
        EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                eventId, "ORDER_CLOSED", TENANT_ID, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);

        publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);
        publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            Long orderCount = clickHouseJdbcTemplate.queryForObject(
                    "SELECT count() FROM clickhouse_analytics.sales_order_facts WHERE order_id = ?",
                    Long.class, orderId);
            assertThat(orderCount).isEqualTo(1L);

            Integer processedCount = postgresJdbcTemplate.queryForObject(
                    "SELECT count(*) FROM processed_events WHERE consumer = ? AND event_id = ?",
                    Integer.class, "reporting.order-closed", eventId);
            assertThat(processedCount).isEqualTo(1);
        });
    }

    // ── Test 5: input tax lands ───────────────────────────────────────────────────

    @Test
    void vendorInvoiceMatched_landsInputTax() {
        UUID invoiceId = UUID.randomUUID();
        UUID poId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();

        VendorInvoiceMatchedPayload payload = new VendorInvoiceMatchedPayload(
                invoiceId, poId, 500000L, 42500L, "APPROVED_FOR_PAYMENT");
        EventEnvelope<VendorInvoiceMatchedPayload> envelope = new EventEnvelope<>(
                UUID.randomUUID(), "VENDOR_INVOICE_MATCHED", TENANT_ID, branchId,
                Instant.now(), UUID.randomUUID(), 1, "purchasing-service", payload);

        publish(ReportingRabbitConfig.PURCHASING_TOPIC_EXCHANGE, "purchasing.invoice.matched", envelope);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            var row = clickHouseJdbcTemplate.queryForMap(
                    "SELECT count() AS cnt, any(input_tax_paisa) AS input_tax_paisa "
                            + "FROM clickhouse_analytics.purchase_tax_facts WHERE invoice_id = ?",
                    invoiceId);
            assertThat(((Number) row.get("cnt")).longValue()).isEqualTo(1L);
            assertThat(((Number) row.get("input_tax_paisa")).longValue()).isEqualTo(42500L);
        });
    }

    // ── Test 6: till fact lands ────────────────────────────────────────────────────

    @Test
    void tillClosed_landsTillFact() {
        UUID tillSessionId = UUID.randomUUID();
        UUID branchId = UUID.randomUUID();
        UUID cashierId = UUID.randomUUID();

        TillClosedPayload payload = new TillClosedPayload(tillSessionId, 1000000L, 998000L, -2000L, cashierId);
        EventEnvelope<TillClosedPayload> envelope = new EventEnvelope<>(
                UUID.randomUUID(), "TILL_CLOSED", TENANT_ID, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);

        publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.till.closed", envelope);

        await().atMost(15, SECONDS).untilAsserted(() -> {
            Long count = clickHouseJdbcTemplate.queryForObject(
                    "SELECT count() FROM clickhouse_analytics.till_session_facts WHERE till_session_id = ?",
                    Long.class, tillSessionId);
            assertThat(count).isEqualTo(1L);
        });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────────

    private OrderClosedPayload orderClosedPayload(UUID orderId, Instant closedAt, int itemCount) {
        List<ItemEntry> items = java.util.stream.IntStream.range(0, itemCount)
                .mapToObj(i -> new ItemEntry(UUID.randomUUID(), "Item " + i, 1, 50000L, 50000L))
                .toList();
        return new OrderClosedPayload(
                orderId, "ORD-" + orderId.toString().substring(0, 8), "DINE_IN", null,
                itemCount * 50000L, 0L, 0L, 4500L, itemCount * 50000L + 4500L,
                List.of(), items,
                UUID.randomUUID(), UUID.randomUUID(), closedAt);
    }

    private <T> void publish(String exchange, String routingKey, EventEnvelope<T> envelope) {
        try {
            byte[] body = objectMapper.writeValueAsBytes(envelope);
            rabbitTemplate.send(exchange, routingKey, new Message(body));
        } catch (Exception e) {
            throw new RuntimeException("Failed to publish test event", e);
        }
    }
}
