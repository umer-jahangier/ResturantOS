package io.restaurantos.reporting.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.reporting.etl.SalesFactWriter;
import io.restaurantos.reporting.event.ReportingEventPayloads.OrderClosedPayload;
import io.restaurantos.reporting.service.DashboardTileService;
import io.restaurantos.reporting.service.ProcessedEventService;
import io.restaurantos.reporting.support.BusinessDay;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import java.util.function.Consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 37-03: a sale belongs to exactly ONE trading day, decided once by pos-service, and every
 * downstream consumer records that day rather than recomputing it.
 *
 * <h2>Why this is a unit test and not the {@code OrderClosedBusinessDateIT} the plan named</h2>
 *
 * <p>Testcontainers cannot start a container in this environment — colima's docker socket cannot be
 * bind-mounted, so ryuk and postgres:18 both fail — and surefire additionally excludes
 * {@code **}{@code /*IT.java}, so an IT here would be a file that never runs. The defect being
 * closed lives entirely in this consumer's DECISION about which date to use, and that decision is
 * fully observable with test doubles. A test that runs and pins the decision is worth more than an
 * integration test that cannot be executed; the end-to-end behaviour is verified separately against
 * the live stack by {@code scripts/e2e/phase32-business-date-reconciliation.sh}.
 *
 * <p>The load-bearing case is {@link #dayBoundary_landsOnTheProducersDate_notTheRecomputedOne()}.
 * It does not hardcode a date: it computes BOTH the producer's answer and the old recomputation,
 * asserts they differ (so the fixture is genuinely inside the divergence window), and only then
 * asserts which one the consumer used. A configuration change that closed the window would fail
 * the test rather than silently make it vacuous.
 */
class OrderClosedBusinessDateTest {

    /** The branch timezone the old code would have resolved. UTC+5, no DST. */
    private static final ZoneId KARACHI = ZoneId.of("Asia/Karachi");

    private static final int OFFSET_HOURS = 4;

    private RecordingSalesFactWriter factWriter;
    private RecordingDashboard dashboard;
    private OrderClosedConsumer consumer;
    private ObjectMapper mapper;
    private BusinessDay businessDay;

    @BeforeEach
    void setUp() {
        // Same configuration as the eventObjectMapper bean the consumer is wired with in
        // production (SharedAutoConfiguration): JavaTimeModule so LocalDate/Instant round-trip,
        // ISO dates rather than timestamps, and unknown properties tolerated.
        mapper = new ObjectMapper()
                .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
                .disable(com.fasterxml.jackson.databind.SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
                .disable(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        businessDay = new BusinessDay(OFFSET_HOURS);
        factWriter = new RecordingSalesFactWriter();
        dashboard = new RecordingDashboard();
        consumer = new OrderClosedConsumer(
                new ImmediateProcessedEventService(),
                new PassThroughTenantProcessor(),
                factWriter,
                dashboard,
                mapper);
    }

    // ── Behaviour 1: the day-boundary case — the whole point of the plan ──────────────────────
    @Test
    void dayBoundary_landsOnTheProducersDate_notTheRecomputedOne() throws Exception {
        // 23:30Z. pos computes (t − 4h) in UTC → 19:30 on the 6th. The old reporting code computed
        // (t − 4h) in Asia/Karachi → 00:30 on the 7th. This is the window that misdated 26 orders.
        Instant closedAt = Instant.parse("2026-08-06T23:30:00Z");

        LocalDate producersDate = LocalDate.ofInstant(closedAt.minusSeconds(OFFSET_HOURS * 3600L), ZoneId.of("UTC"));
        LocalDate oldRecomputation = businessDay.businessDate(closedAt, KARACHI);

        // Guard: if these ever agree, this fixture is no longer inside the divergence window and
        // the assertion below would pass for the wrong reason.
        assertNotEquals(oldRecomputation, producersDate,
                "fixture must sit inside the window where the two formulas disagree");
        assertEquals(LocalDate.of(2026, 8, 6), producersDate);
        assertEquals(LocalDate.of(2026, 8, 7), oldRecomputation);

        consumer.onMessage(message(envelope(closedAt, producersDate)));

        assertEquals(producersDate, factWriter.lastBusinessDate,
                "the fact must land on the day the producer named, not the recomputed one");
        assertNotEquals(oldRecomputation, factWriter.lastBusinessDate);
    }

    // ── Behaviour 2: a midday order is unchanged — this is not a blanket shift ────────────────
    @Test
    void middayOrder_landsOnTheSameDayUnderEitherRule() throws Exception {
        Instant closedAt = Instant.parse("2026-08-06T12:00:00Z");
        LocalDate producersDate = LocalDate.of(2026, 8, 6);

        assertEquals(producersDate, businessDay.businessDate(closedAt, KARACHI),
                "midday is outside the divergence window; both rules must agree here");

        consumer.onMessage(message(envelope(closedAt, producersDate)));

        assertEquals(producersDate, factWriter.lastBusinessDate);
    }

    // ── Behaviour 3: two branches, two timezones, one instant — each takes its own payload ────
    @Test
    void twoBranchesInDifferentTimezones_eachLandOnTheDayItsOwnPayloadNames() throws Exception {
        Instant sameInstant = Instant.parse("2026-08-06T23:30:00Z");

        consumer.onMessage(message(envelope(sameInstant, LocalDate.of(2026, 8, 6))));
        LocalDate first = factWriter.lastBusinessDate;

        consumer.onMessage(message(envelope(sameInstant, LocalDate.of(2026, 8, 7))));
        LocalDate second = factWriter.lastBusinessDate;

        assertEquals(LocalDate.of(2026, 8, 6), first);
        assertEquals(LocalDate.of(2026, 8, 7), second);
        assertNotEquals(first, second,
                "the consumer must honour each payload, not impose one rule on both branches");
    }

    // ── Behaviour 4: a missing date dead-letters and names the field; it does NOT fall back ───
    @Test
    void payloadWithoutBusinessDate_deadLettersNamingTheField_andWritesNothing() throws Exception {
        Instant closedAt = Instant.parse("2026-08-06T23:30:00Z");

        AmqpRejectAndDontRequeueException thrown = assertThrows(
                AmqpRejectAndDontRequeueException.class,
                () -> consumer.onMessage(message(envelope(closedAt, null))));

        assertTrue(thrown.getMessage().contains("businessDate"),
                "the rejection must name the missing field, got: " + thrown.getMessage());
        assertNull(factWriter.lastBusinessDate,
                "nothing may be written — a silent fallback to recomputation is the defect returning");
        assertEquals(0, factWriter.writeCount);
    }

    // ── Behaviour 6: a dashboard failure is still swallowed and cannot undo the fact write ────
    @Test
    void dashboardPushFailure_isSwallowed_andTheFactWriteStands() throws Exception {
        dashboard.throwOnPush = true;
        Instant closedAt = Instant.parse("2026-08-06T23:30:00Z");
        LocalDate producersDate = LocalDate.of(2026, 8, 6);

        consumer.onMessage(message(envelope(closedAt, producersDate)));

        assertEquals(producersDate, factWriter.lastBusinessDate,
                "the fact row is the durable truth; a cosmetic WS push must not roll it back");
        assertEquals(1, factWriter.writeCount);
        assertTrue(dashboard.attempted, "the push must still have been attempted");
    }

    // ── Structural: the recomputation machinery is GONE from this path, not merely unused ─────
    @Test
    void orderClosedPathReferencesNeitherBusinessDayNorBranchTimeZoneResolver() throws Exception {
        Path source = Path.of("src/main/java/io/restaurantos/reporting/consumer/OrderClosedConsumer.java");
        assertTrue(Files.exists(source), "expected consumer source at " + source.toAbsolutePath());
        String code = stripComments(Files.readString(source, StandardCharsets.UTF_8));
        assertFalse(code.contains("BusinessDay"),
                "leaving BusinessDay present but unused on this path is how this defect returns");
        assertFalse(code.contains("BranchTimeZoneResolver"),
                "leaving BranchTimeZoneResolver present but unused on this path is how this defect returns");
    }

    // ── Behaviour 5: the till consumer, whose payload has no date, still derives one ──────────
    @Test
    void tillClosedPath_stillDerivesItsOwnDate_becauseItsPayloadCarriesNone() throws Exception {
        Path source = Path.of("src/main/java/io/restaurantos/reporting/consumer/TillClosedConsumer.java");
        assertTrue(Files.exists(source), "expected till consumer source at " + source.toAbsolutePath());
        String code = stripComments(Files.readString(source, StandardCharsets.UTF_8));
        assertTrue(code.contains("BusinessDay"),
                "TILL_CLOSED publishes no date, so this consumer must keep deriving one — "
                        + "removing BusinessDay from it would be collateral damage, not cleanup");
    }

    private static String stripComments(String java) {
        return java.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    // ── Fixtures ─────────────────────────────────────────────────────────────────────────────

    private EventEnvelope<OrderClosedPayload> envelope(Instant closedAt, LocalDate businessDate) {
        OrderClosedPayload payload = new OrderClosedPayload(
                UUID.randomUUID(), "ORD-0001", "DINE_IN", null,
                80000L, 0L, 4000L, 5600L, 89600L,
                List.of(), List.of(), null, UUID.randomUUID(),
                closedAt, businessDate);
        return new EventEnvelope<>(
                UUID.randomUUID(), "ORDER_CLOSED", UUID.randomUUID(), UUID.randomUUID(),
                Instant.now(), UUID.randomUUID(), 1, "pos-service", payload, null, null);
    }

    private Message message(EventEnvelope<OrderClosedPayload> envelope) throws Exception {
        return new Message(mapper.writeValueAsBytes(envelope), new MessageProperties());
    }

    // ── Test doubles ─────────────────────────────────────────────────────────────────────────

    private static final class RecordingSalesFactWriter extends SalesFactWriter {
        LocalDate lastBusinessDate;
        int writeCount;

        RecordingSalesFactWriter() {
            super(null);
        }

        @Override
        public void write(EventEnvelope<OrderClosedPayload> env, LocalDate businessDate) {
            this.lastBusinessDate = businessDate;
            this.writeCount++;
        }
    }

    private static final class RecordingDashboard extends DashboardTileService {
        boolean throwOnPush;
        boolean attempted;

        RecordingDashboard() {
            super(null, null, null, null, null, 10L);
        }

        @Override
        public void recomputeAndPush(UUID tenantId, UUID branchId, LocalDate businessDate) {
            attempted = true;
            if (throwOnPush) throw new IllegalStateException("websocket down");
        }
    }

    /** Runs the action inline — the idempotency guard is not what this test is about. */
    private static final class ImmediateProcessedEventService extends ProcessedEventService {
        ImmediateProcessedEventService() {
            super(null);
        }

        @Override
        public boolean tryProcess(String consumerName, UUID eventId, Runnable action) {
            action.run();
            return true;
        }
    }

    /** Invokes the handler without touching a tenant GUC. */
    private static final class PassThroughTenantProcessor extends TenantAwareMessageProcessor {
        PassThroughTenantProcessor() {
            super(null, null);
        }

        @Override
        public <T> void process(EventEnvelope<T> envelope, Consumer<EventEnvelope<T>> handler) {
            handler.accept(envelope);
        }
    }
}
