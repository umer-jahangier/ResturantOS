package io.restaurantos.reporting.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.restaurantos.reporting.ReportingServiceApplication;
import io.restaurantos.reporting.config.ReportingRabbitConfig;
import io.restaurantos.reporting.dto.DashboardTileDto;
import io.restaurantos.reporting.event.ReportingEventPayloads.ItemEntry;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
import io.restaurantos.reporting.event.ReportingEventPayloads.TillClosedPayload;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.security.JwksKeyProvider;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.testcontainers.clickhouse.ClickHouseContainer;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.net.URI;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static java.util.concurrent.TimeUnit.SECONDS;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

/**
 * The real proof for RPT-02's headline claim: connect a REAL WebSocket client to a REAL running
 * service, publish a REAL ORDER_CLOSED/TILL_CLOSED to a REAL RabbitMQ, and measure the elapsed
 * time to the frame landing in the client — against a REAL ClickHouse for the fact write and a
 * REAL Redis for the tile cache (mirrors EtlPipelineIT's container set, decision 12-03).
 *
 * <p>{@link JwksKeyProvider} is overridden with a test key pair so a self-signed JWT (built with
 * jjwt directly, matching shared-lib's TestFixtures pattern) verifies against the real
 * {@link DashboardWebSocketHandler} auth path — this is NOT a mocked handler; the socket, the
 * JWT verification, the RabbitMQ consumer, the ClickHouse write, and the throttle are all real.
 */
@SpringBootTest(
        classes = ReportingServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Import(DashboardPushIT.JwksTestConfig.class)
@Testcontainers
class DashboardPushIT {

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
    private static final String TEST_KID = "dashboard-test-key";
    private static final KeyPair KEY_PAIR = generateKeyPair();

    static {
        System.setProperty("TESTCONTAINERS_RYUK_DISABLED", "true");
    }

    @org.junit.jupiter.api.BeforeAll
    static void applyClickHouseSchema() throws Exception {
        Path ddlFile = locateRepoFile("deploy/clickhouse/V001__analytics_facts.sql");
        String sql = Files.readString(ddlFile);
        String clickHouseJdbcUrl = "jdbc:clickhouse://" + CLICKHOUSE.getHost() + ":"
                + CLICKHOUSE.getMappedPort(8123);
        try (Connection connection = DriverManager.getConnection(
                clickHouseJdbcUrl, CLICKHOUSE.getUsername(), CLICKHOUSE.getPassword());
             Statement statement = connection.createStatement()) {
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

    @TestConfiguration
    static class JwksTestConfig {
        @Bean
        @Primary
        JwksKeyProvider testJwksKeyProvider() {
            return new JwksKeyProvider(TEST_KID, (RSAPublicKey) KEY_PAIR.getPublic());
        }
    }

    @LocalServerPort
    private int port;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    @Qualifier("eventObjectMapper")
    private ObjectMapper eventObjectMapper;

    @Autowired
    private ObjectMapper objectMapper;

    // ── Test 1: ORDER_CLOSED pushes within 5 seconds ─────────────────────────────

    @Test
    void orderClosed_pushesWithinFiveSeconds() throws Exception {
        UUID branchId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        String jwt = mintJwt(List.of("reporting.dashboard.view"));

        RecordingHandler handler = new RecordingHandler();
        WebSocketSession session = connect(branchId, jwt, handler);
        try {
            long totalPaisa = 123_456L;
            OrderClosedPayload payload = orderClosedPayload(UUID.randomUUID(), totalPaisa);
            EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                    UUID.randomUUID(), "ORDER_CLOSED", tenantId, branchId,
                    Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);

            Instant t0 = Instant.now();
            publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);

            String frame = handler.frames.poll(5, SECONDS);
            Instant received = Instant.now();

            assertThat(frame).as("expected a tile push frame within 5 seconds").isNotNull();
            assertThat(Duration.between(t0, received))
                    .as("push must land within the 5s RPT-02 budget")
                    .isLessThan(Duration.ofSeconds(5));

            List<DashboardTileDto> tiles = parseFrame(frame);
            assertThat(revenueOf(tiles)).isEqualTo(totalPaisa);
        } finally {
            session.close();
        }
    }

    // ── Test 2: TILL_CLOSED pushes within 5 seconds ──────────────────────────────

    @Test
    void tillClosed_pushesWithinFiveSeconds() throws Exception {
        UUID branchId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        String jwt = mintJwt(List.of("reporting.dashboard.view"));

        RecordingHandler handler = new RecordingHandler();
        WebSocketSession session = connect(branchId, jwt, handler);
        try {
            TillClosedPayload payload = new TillClosedPayload(
                    UUID.randomUUID(), 1_000_000L, 998_000L, -2_000L, UUID.randomUUID());
            EventEnvelope<TillClosedPayload> envelope = new EventEnvelope<>(
                    UUID.randomUUID(), "TILL_CLOSED", tenantId, branchId,
                    Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);

            Instant t0 = Instant.now();
            publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.till.closed", envelope);

            String frame = handler.frames.poll(5, SECONDS);
            Instant received = Instant.now();

            assertThat(frame).as("expected a tile push frame within 5 seconds").isNotNull();
            assertThat(Duration.between(t0, received))
                    .as("push must land within the 5s RPT-02 budget")
                    .isLessThan(Duration.ofSeconds(5));
            assertThat(parseFrame(frame)).isNotEmpty();
        } finally {
            session.close();
        }
    }

    // ── Test 3: a 100-event burst is throttled but converges to the true total ──

    @Test
    void burstOfOrders_isThrottledButConverges() throws Exception {
        UUID branchId = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        String jwt = mintJwt(List.of("reporting.dashboard.view"));

        RecordingHandler handler = new RecordingHandler();
        WebSocketSession session = connect(branchId, jwt, handler);
        try {
            int orderCount = 100;
            long perOrderPaisa = 1_000L;
            for (int i = 0; i < orderCount; i++) {
                OrderClosedPayload payload = orderClosedPayload(UUID.randomUUID(), perOrderPaisa);
                EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                        UUID.randomUUID(), "ORDER_CLOSED", tenantId, branchId,
                        Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);
                publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);
            }

            long expectedTotal = orderCount * perOrderPaisa;
            AtomicInteger frameCount = new AtomicInteger();
            AtomicReference<Long> lastRevenue = new AtomicReference<>();

            // Drain frames as they arrive until the client's state converges to the true total —
            // this is what proves the trailing flush works, not just "some frame arrived".
            await().atMost(20, SECONDS).untilAsserted(() -> {
                String frame;
                while ((frame = handler.frames.poll()) != null) {
                    frameCount.incrementAndGet();
                    lastRevenue.set(revenueOf(parseFrame(frame)));
                }
                assertThat(lastRevenue.get()).isEqualTo(expectedTotal);
            });

            // Settle window: one more scheduler tick (fixedDelay=1000ms) to be sure nothing further
            // trickles in — the burst must be DONE converging, not still climbing.
            Thread.sleep(1_200);
            String extra;
            while ((extra = handler.frames.poll()) != null) {
                frameCount.incrementAndGet();
                lastRevenue.set(revenueOf(parseFrame(extra)));
            }

            assertThat(lastRevenue.get())
                    .as("the final frame must carry the TRUE total across all 100 orders")
                    .isEqualTo(expectedTotal);
            assertThat(frameCount.get())
                    .as("100 events must NOT produce anywhere near 100 pushes")
                    .isLessThan(15);
        } finally {
            session.close();
        }
    }

    // ── Test 4: no token -> 1008 ──────────────────────────────────────────────────

    @Test
    void noToken_isRejected() throws Exception {
        UUID branchId = UUID.randomUUID();
        RecordingHandler handler = new RecordingHandler();
        connect(branchId, null, handler);

        CloseStatus status = handler.closeStatus.get(5, SECONDS);
        assertThat(status.getCode()).isEqualTo(1008);
    }

    // ── Test 5: valid JWT, wrong permission -> 1008 ──────────────────────────────

    @Test
    void insufficientPermission_isRejected() throws Exception {
        UUID branchId = UUID.randomUUID();
        String jwt = mintJwt(List.of("some.other.permission"));
        RecordingHandler handler = new RecordingHandler();
        connect(branchId, jwt, handler);

        CloseStatus status = handler.closeStatus.get(5, SECONDS);
        assertThat(status.getCode()).isEqualTo(1008);
    }

    // ── Test 6: cross-branch isolation ────────────────────────────────────────────

    @Test
    void crossBranch_isolation() throws Exception {
        UUID branch1 = UUID.randomUUID();
        UUID branch2 = UUID.randomUUID();
        UUID tenantId = UUID.randomUUID();
        String jwt = mintJwt(List.of("reporting.dashboard.view"));

        RecordingHandler handler1 = new RecordingHandler();
        WebSocketSession session1 = connect(branch1, jwt, handler1);
        try {
            OrderClosedPayload payload = orderClosedPayload(UUID.randomUUID(), 5_000L);
            EventEnvelope<OrderClosedPayload> envelope = new EventEnvelope<>(
                    UUID.randomUUID(), "ORDER_CLOSED", tenantId, branch2,
                    Instant.now(), UUID.randomUUID(), 1, "pos-service", payload);
            publish(ReportingRabbitConfig.POS_TOPIC_EXCHANGE, "pos.order.closed", envelope);

            String frame = handler1.frames.poll(3, SECONDS);
            assertThat(frame).as("branch-1 subscriber must NOT see branch-2's push").isNull();
        } finally {
            session1.close();
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────────

    private WebSocketSession connect(UUID branchId, String jwt, RecordingHandler handler) throws Exception {
        StandardWebSocketClient client = new StandardWebSocketClient();
        String url = "ws://localhost:" + port + "/api/v1/reporting/dashboard/" + branchId
                + (jwt != null ? "?token=" + jwt : "");
        return client.execute(handler, new WebSocketHttpHeaders(), URI.create(url))
                .get(5, TimeUnit.SECONDS);
    }

    private List<DashboardTileDto> parseFrame(String json) throws Exception {
        return objectMapper.readValue(json,
                objectMapper.getTypeFactory().constructCollectionType(List.class, DashboardTileDto.class));
    }

    private Long revenueOf(List<DashboardTileDto> tiles) {
        return tiles.stream()
                .filter(t -> "todays-revenue".equals(t.tileId()))
                .findFirst()
                .map(DashboardTileDto::valuePaisa)
                .orElse(null);
    }

    private OrderClosedPayload orderClosedPayload(UUID orderId, long totalPaisa) {
        return new OrderClosedPayload(
                orderId, "ORD-" + orderId.toString().substring(0, 8), "DINE_IN", null,
                totalPaisa, 0L, 0L, 0L, totalPaisa,
                List.of(), List.<ItemEntry>of(),
                UUID.randomUUID(), UUID.randomUUID(), Instant.now());
    }

    private <T> void publish(String exchange, String routingKey, EventEnvelope<T> envelope) {
        try {
            byte[] body = eventObjectMapper.writeValueAsBytes(envelope);
            rabbitTemplate.send(exchange, routingKey, new Message(body));
        } catch (Exception e) {
            throw new RuntimeException("Failed to publish test event", e);
        }
    }

    private static String mintJwt(List<String> permissions) {
        Instant now = Instant.now();
        return Jwts.builder()
                .header().keyId(TEST_KID).and()
                .subject(UUID.randomUUID().toString())
                .claim("tenant_id", UUID.randomUUID().toString())
                .claim("branch_id", UUID.randomUUID().toString())
                .claim("roles", List.of("OWNER"))
                .claim("permissions", permissions)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(15, ChronoUnit.MINUTES)))
                .signWith(KEY_PAIR.getPrivate(), Jwts.SIG.RS256)
                .compact();
    }

    private static KeyPair generateKeyPair() {
        try {
            KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
            g.initialize(2048);
            return g.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Records every text frame + the eventual close status of a client-side WS session. */
    private static final class RecordingHandler extends TextWebSocketHandler {
        final BlockingQueue<String> frames = new LinkedBlockingQueue<>();
        final CompletableFuture<CloseStatus> closeStatus = new CompletableFuture<>();

        @Override
        protected void handleTextMessage(WebSocketSession session, TextMessage message) {
            frames.offer(message.getPayload());
        }

        @Override
        public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
            closeStatus.complete(status);
        }
    }
}
