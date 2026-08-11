package io.restaurantos.reporting.etl;

import com.clickhouse.jdbc.ClickHouseDataSource;
import io.restaurantos.reporting.event.ReportingEventPayloads.ItemEntry;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
import io.restaurantos.reporting.event.ReportingEventPayloads.TillClosedPayload;
import io.restaurantos.shared.event.EventEnvelope;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.testcontainers.clickhouse.ClickHouseContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Properties;
import java.util.TimeZone;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * DEFECT-37-03-B — the analytics facts stored the JVM's local wall-clock in columns declared
 * {@code DateTime64(3,'UTC')}, putting every fact five hours in the future on this deployment and
 * making every time-of-day report (including daily takings) wrong.
 *
 * <p>This test drives the REAL writers against a REAL ClickHouse with the JVM default zone forced
 * to a non-UTC zone. Forcing the zone is the whole point: the defect is invisible when the JVM
 * already runs in UTC, so a test that merely inherits the CI zone would pass on a broken build.
 * {@link EtlPipelineIT} asserts the same property end to end through RabbitMQ; this one isolates
 * the binding so a failure points straight at the writer rather than at the pipeline.
 *
 * <p>No Spring context, no RabbitMQ — just the writer, a JdbcTemplate and the database, so the
 * assertion cannot be satisfied by anything except correct parameter binding.
 */
@Testcontainers
class AnalyticsInstantBindingIT {

    /** UTC+5, no DST — the deployment zone, and non-UTC, which is what makes this test able to fail. */
    private static final TimeZone NON_UTC_ZONE = TimeZone.getTimeZone("Asia/Karachi");

    private static TimeZone originalZone;

    @Container
    static final ClickHouseContainer CLICKHOUSE =
            new ClickHouseContainer(DockerImageName.parse("clickhouse/clickhouse-server:25.9"));

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
    }

    private static JdbcTemplate clickHouse;

    @BeforeAll
    static void setUp() throws Exception {
        originalZone = TimeZone.getDefault();
        TimeZone.setDefault(NON_UTC_ZONE);

        String jdbcUrl = "jdbc:clickhouse://" + CLICKHOUSE.getHost() + ":"
                + CLICKHOUSE.getMappedPort(8123);

        // Apply the real DDL from disk, exactly as EtlPipelineIT does, so this test cannot drift
        // from the deployed schema (in particular, from the columns' declared UTC timezone).
        Path ddl = locateRepoFile("deploy/clickhouse/V001__analytics_facts.sql");
        String sql = Files.readString(ddl);
        String withoutComments = sql.lines()
                .map(line -> {
                    int c = line.indexOf("--");
                    return c >= 0 ? line.substring(0, c) : line;
                })
                .reduce("", (a, b) -> a + "\n" + b);
        try (Connection connection = DriverManager.getConnection(
                jdbcUrl, CLICKHOUSE.getUsername(), CLICKHOUSE.getPassword());
             Statement statement = connection.createStatement()) {
            for (String raw : withoutComments.split(";")) {
                String cleaned = raw.trim();
                if (!cleaned.isEmpty()) {
                    statement.execute(cleaned);
                }
            }
        }

        Properties props = new Properties();
        props.setProperty("user", CLICKHOUSE.getUsername());
        props.setProperty("password", CLICKHOUSE.getPassword());
        clickHouse = new JdbcTemplate(new ClickHouseDataSource(
                jdbcUrl + "/clickhouse_analytics", props));
    }

    @AfterAll
    static void restoreZone() {
        if (originalZone != null) {
            TimeZone.setDefault(originalZone);
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

    /**
     * The precondition that gives every other assertion here its teeth. If this fails, the JVM is
     * running in UTC and the timezone defect would be unobservable — a green suite would mean
     * nothing.
     */
    @Test
    void jvmZoneIsNotUtc_soThisSuiteCanActuallyFail() {
        assertThat(TimeZone.getDefault().getRawOffset())
                .as("this suite must run in a non-UTC zone or it cannot detect the defect")
                .isNotZero();
    }

    @Test
    void salesFactWriter_storesTheTrueUtcInstant() {
        UUID orderId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        // 14:30:00.932 UTC — deliberately in the afternoon, so a +5h error lands the row on the
        // SAME calendar day and cannot be caught by a business_date assertion alone.
        Instant closedAt = Instant.parse("2026-07-16T14:30:00.932Z");

        new SalesFactWriter(clickHouse).write(
                envelope(tenantId, "ORDER_CLOSED", orderClosedPayload(orderId, closedAt)),
                LocalDate.parse("2026-07-16"));

        assertStoredInstant("sales_order_facts", "closed_at", "order_id", orderId, closedAt);
        assertStoredInstant("sales_item_facts", "closed_at", "order_id", orderId, closedAt);
    }

    @Test
    void tillSessionFactWriter_storesTheTrueUtcInstant() {
        UUID tillSessionId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        Instant occurredAt = Instant.parse("2026-07-16T14:30:00.932Z");

        TillClosedPayload payload =
                new TillClosedPayload(tillSessionId, 1000000L, 998000L, -2000L, UUID.randomUUID());
        new TillSessionFactWriter(clickHouse).write(
                new EventEnvelope<>(UUID.randomUUID(), "TILL_CLOSED", tenantId, UUID.randomUUID(),
                        occurredAt, UUID.randomUUID(), 1, "pos-service", payload),
                LocalDate.parse("2026-07-16"));

        assertStoredInstant("till_session_facts", "closed_at", "till_session_id", tillSessionId,
                occurredAt);
    }

    /**
     * Guards the helper itself, in every zone: the returned value must carry an explicit UTC
     * offset. A zoneless value happens to work today but is only accidentally correct.
     */
    @Test
    void analyticsInstant_carriesAnExplicitUtcOffset() {
        Instant instant = Instant.parse("2026-07-16T14:30:00.932Z");
        var bound = AnalyticsInstant.utc(instant);

        assertThat(bound.getOffset()).isEqualTo(java.time.ZoneOffset.UTC);
        assertThat(bound.toInstant()).isEqualTo(instant);
        assertThat(AnalyticsInstant.utc(null)).isNull();
    }

    // ── Helpers ────────────────────────────────────────────────────────────────────

    private void assertStoredInstant(String table, String column, String keyColumn, UUID key,
                                     Instant expected) {
        Long storedMillis = clickHouse.queryForObject(
                "SELECT toUnixTimestamp64Milli(" + column + ") FROM clickhouse_analytics." + table
                        + " WHERE " + keyColumn + " = ?", Long.class, key);

        assertThat(storedMillis)
                .as("%s.%s must be the true instant. JVM zone is %s; a local-wall-clock binding "
                                + "would land %d ms out.",
                        table, column, TimeZone.getDefault().getID(),
                        NON_UTC_ZONE.getRawOffset())
                .isEqualTo(expected.toEpochMilli());
    }

    private <T> EventEnvelope<T> envelope(UUID tenantId, String type, T payload) {
        return new EventEnvelope<>(UUID.randomUUID(), type, tenantId, UUID.randomUUID(),
                Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);
    }

    private OrderClosedPayload orderClosedPayload(UUID orderId, Instant closedAt) {
        List<ItemEntry> items =
                List.of(new ItemEntry(UUID.randomUUID(), "Item 0", 1, 50000L, 50000L));
        return new OrderClosedPayload(
                orderId, "ORD-" + orderId.toString().substring(0, 8), "DINE_IN", null,
                50000L, 0L, 0L, 4500L, 54500L,
                List.of(), items,
                UUID.randomUUID(), UUID.randomUUID(), closedAt,
                io.restaurantos.shared.time.BusinessDay.of(closedAt));
    }
}
