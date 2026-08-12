package io.restaurantos.shared.integration;

import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRelay;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.feature.FeatureFlagService;
import io.restaurantos.shared.idempotency.IdempotencyService;
import io.restaurantos.shared.money.MoneyUtils;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import io.restaurantos.shared.tenant.TenantContext;
import io.restaurantos.shared.tenant.TenantTaskDecorator;
import io.restaurantos.shared.testsupport.AbstractRlsCoverageTest;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitAdmin;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assertions.*;

/**
 * ONE Testcontainers integration test proving SC3, SC4, and SC5.
 *
 * SC3: shared-lib beans load + @Async tenant propagation + RabbitMQ consumer propagation
 * SC4: MoneyUtils arithmetic/rounding + RLS-or-fail guard (pass/fail)
 * SC5: DomainEventPublisher → event_outbox → OutboxRelay → RabbitMQ → idempotent exactly-once
 */
class SharedLibVerificationIT extends BaseIntegrationTest {

    @Autowired private FeatureFlagService featureFlagService;
    @Autowired private IdempotencyService idempotencyService;
    @Autowired private EventPublisher eventPublisher;
    @Autowired private OutboxRelay outboxRelay;
    @Autowired private OutboxRepository outboxRepository;
    @Autowired private TenantAwareMessageProcessor tenantAwareMessageProcessor;
    @Autowired private TenantTaskDecorator tenantTaskDecorator;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private TransactionTemplate transactionTemplate;
    @PersistenceContext private EntityManager entityManager;

    @BeforeEach
    void cleanOutboxBetweenTests() {
        transactionTemplate.executeWithoutResult(tx ->
            entityManager.createNativeQuery("DELETE FROM event_outbox").executeUpdate());
    }

    // ══════════════════════════════════════════════════════════════════════
    // SC3 — Beans load + @Async tenant propagation + RabbitMQ consumer propagation
    // ══════════════════════════════════════════════════════════════════════

    @Test
    void sc3_sharedBeansLoad() {
        assertNotNull(featureFlagService,        "FeatureFlagService must be autowired");
        assertNotNull(idempotencyService,         "IdempotencyService must be autowired");
        assertNotNull(eventPublisher,             "EventPublisher/DomainEventPublisher must be autowired");
        assertNotNull(outboxRelay,                "OutboxRelay must be autowired");
        assertNotNull(tenantAwareMessageProcessor,"TenantAwareMessageProcessor must be autowired");
        assertNotNull(tenantTaskDecorator,        "TenantTaskDecorator must be autowired");
    }

    @Test
    void sc3_tenantContextPropagatesAcrossAsync() throws Exception {
        UUID expectedTenantId = TestFixtures.testTenantId();
        AtomicReference<UUID> capturedTenantId = new AtomicReference<>();

        Runnable task = tenantTaskDecorator.decorate(() ->
            capturedTenantId.set(tenantContext.getTenantId().orElse(null)));

        CompletableFuture.runAsync(task).get(5, TimeUnit.SECONDS);

        assertThat(capturedTenantId.get())
            .as("TenantContext must propagate to @Async worker thread via TenantTaskDecorator")
            .isEqualTo(expectedTenantId);
    }

    @Test
    void sc3_tenantAwareMessageProcessorSetsContextForConsumer() {
        UUID expectedTenantId = TestFixtures.testTenantId();
        AtomicReference<UUID> capturedTenantId = new AtomicReference<>();

        EventEnvelope<String> envelope = new EventEnvelope<>(
            UUID.randomUUID(), "TEST_EVENT",
            expectedTenantId, TestFixtures.testBranchId(),
            java.time.Instant.now(), UUID.randomUUID(), 1, "test", "payload");

        // process() is @Transactional — it creates its own transaction, enables the
        // Hibernate tenant filter, and sets app.current_tenant_id for RLS.
        tenantAwareMessageProcessor.process(envelope, env ->
            capturedTenantId.set(tenantContext.getTenantId().orElse(null)));

        assertThat(capturedTenantId.get())
            .as("TenantAwareMessageProcessor must set TenantContext inside consumer lambda")
            .isEqualTo(expectedTenantId);
    }

    // ══════════════════════════════════════════════════════════════════════
    // SC4 — MoneyUtils + RLS-or-fail guard
    // ══════════════════════════════════════════════════════════════════════

    @Test
    void sc4_moneyUtilsArithmeticAndRounding() {
        // Basic conversion
        assertThat(MoneyUtils.toMoney(100).pkr()).isEqualTo(1.0);
        assertThat(MoneyUtils.toMoney(100).paisa()).isEqualTo(100L);

        // fromPkr: HALF_UP rounding
        assertThat(MoneyUtils.fromPkr(new BigDecimal("1.005"))).isEqualTo(101L);
        assertThat(MoneyUtils.fromPkr(new BigDecimal("1.004"))).isEqualTo(100L);
        assertThat(MoneyUtils.fromPkr(new BigDecimal("10.50"))).isEqualTo(1050L);

        // Tax per line: FLOOR (per-line floored tax)
        // 1000 paisa * 15% = 150 paisa (exact)
        assertThat(MoneyUtils.taxPerLine(1000L, 1500)).isEqualTo(150L);
        // 1001 paisa * 15% = 150.15 → floored = 150
        assertThat(MoneyUtils.taxPerLine(1001L, 1500)).isEqualTo(150L);

        // roundToRupee: HALF_UP
        assertThat(MoneyUtils.roundToRupee(150L)).isEqualTo(200L); // 1.50 → 2 PKR
        assertThat(MoneyUtils.roundToRupee(149L)).isEqualTo(100L); // 1.49 → 1 PKR
    }

    @Test
    @org.springframework.transaction.annotation.Transactional
    void sc4_rlsGuardPassesForWidgetsTable() {
        // The widgets table has ENABLE RLS + FORCE RLS + tenant_isolation policy (test-changelog.xml)
        // AbstractRlsCoverageTest.allTenantScopedTablesMustHaveForceRlsAndAPolicy() will pass for widgets
        AbstractRlsCoverageTest rlsTest = new AbstractRlsCoverageTest() {
            @Override
            protected EntityManager entityManager() { return entityManager; }
        };
        // Should not throw — widgets has both FORCE RLS and a policy
        assertDoesNotThrow(rlsTest::allTenantScopedTablesMustHaveForceRlsAndAPolicy,
            "widgets table must have FORCE RLS + tenant_isolation policy");
    }

    @Test
    void sc4_widgetsTableRlsFiltersOtherTenantRows() {
        UUID myTenantId = TestFixtures.testTenantId();
        UUID otherTenantId = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

        // Insert a widget for our tenant (with RLS GUC set)
        transactionTemplate.executeWithoutResult(tx -> {
            entityManager.createNativeQuery(
                "SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", myTenantId.toString()).getSingleResult();
            entityManager.createNativeQuery(
                "INSERT INTO widgets (id, tenant_id, name, created_at, updated_at) " +
                "VALUES (gen_random_uuid(), :tid, 'MyWidget', NOW(), NOW())")
                .setParameter("tid", myTenantId).executeUpdate();
        });

        // Insert a widget for a different tenant (bypass RLS via separate raw insert)
        transactionTemplate.executeWithoutResult(tx -> {
            entityManager.createNativeQuery(
                "SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", otherTenantId.toString()).getSingleResult();
            entityManager.createNativeQuery(
                "INSERT INTO widgets (id, tenant_id, name, created_at, updated_at) " +
                "VALUES (gen_random_uuid(), :tid, 'OtherWidget', NOW(), NOW())")
                .setParameter("tid", otherTenantId).executeUpdate();
        });

        // Query with our tenant's RLS GUC: should see only our widget
        transactionTemplate.executeWithoutResult(tx -> {
            entityManager.createNativeQuery(
                "SELECT set_config('app.current_tenant_id', :tid, true)")
                .setParameter("tid", myTenantId.toString()).getSingleResult();
            @SuppressWarnings("unchecked")
            java.util.List<Object[]> results = entityManager
                .createNativeQuery("SELECT tenant_id, name FROM widgets")
                .getResultList();
            assertThat(results).hasSize(1);
            assertThat(results.get(0)[1].toString()).isEqualTo("MyWidget");
        });
    }

    // ══════════════════════════════════════════════════════════════════════
    // SC5 — Transactional outbox → OutboxRelay → idempotent exactly-once consumer
    // ══════════════════════════════════════════════════════════════════════

    @Test
    void sc5_domainEventPublisherWritesToOutboxInSameTransaction() {
        UUID branchId = TestFixtures.testBranchId();
        long countBefore = outboxRepository.count();

        transactionTemplate.executeWithoutResult(tx ->
            eventPublisher.publish("test.topic", "test.event", "TEST_EVENT", branchId,
                new TestPayload("hello")));

        long countAfter = outboxRepository.count();
        assertThat(countAfter).isGreaterThan(countBefore);

        // Verify the row is PENDING
        outboxRepository.findTop200ByStatusOrderByCreatedAtAsc("PENDING")
            .stream()
            .filter(e -> "TEST_EVENT".equals(e.getEventType()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("Expected PENDING outbox entry for TEST_EVENT"));
    }

    @Test
    void sc5_outboxRelayPublishesToRabbitMqAndMarksSent() throws Exception {
        UUID branchId = TestFixtures.testBranchId();
        String exchangeName = "sc5-test-exchange";
        String routingKey = "sc5.relay.test";

        // Declare exchange, queue, and binding before publishing
        String queueName = "sc5-test-queue-" + UUID.randomUUID();
        RabbitAdmin admin = new RabbitAdmin(rabbitTemplate.getConnectionFactory());
        org.springframework.amqp.core.TopicExchange exchange =
            new org.springframework.amqp.core.TopicExchange(exchangeName);
        org.springframework.amqp.core.Queue queue =
            new org.springframework.amqp.core.Queue(queueName, true, false, false);
        admin.declareExchange(exchange);
        admin.declareQueue(queue);
        admin.declareBinding(new org.springframework.amqp.core.Binding(
            queueName,
            org.springframework.amqp.core.Binding.DestinationType.QUEUE,
            exchangeName, routingKey, null));

        // Publish event to outbox
        transactionTemplate.executeWithoutResult(tx ->
            eventPublisher.publish(exchangeName, routingKey, "SC5_RELAY_TEST",
                branchId, new TestPayload("relay-test")));

        // Trigger relay manually (scheduler disabled in test profile)
        outboxRelay.relay();

        // Confirm outbox row relayed before polling RabbitMQ
        assertThat(outboxRepository.findAll().stream()
            .filter(e -> "SC5_RELAY_TEST".equals(e.getEventType()))
            .map(e -> e.getStatus())
            .findFirst())
            .contains("SENT");

        // Poll for the message on RabbitMQ
        Awaitility.await()
            .atMost(10, TimeUnit.SECONDS)
            .pollInterval(500, TimeUnit.MILLISECONDS)
            .untilAsserted(() -> {
                Message msg = rabbitTemplate.receive(queueName, 1000);
                assertThat(msg)
                    .as("OutboxRelay must have published the event to RabbitMQ")
                    .isNotNull();
                String body = new String(msg.getBody(), java.nio.charset.StandardCharsets.UTF_8);
                assertThat(body).contains("SC5_RELAY_TEST");
            });

        // Verify outbox row is now SENT
        outboxRepository.findAll().stream()
            .filter(e -> "SC5_RELAY_TEST".equals(e.getEventType()))
            .forEach(e -> assertThat(e.getStatus()).isEqualTo("SENT"));
    }

    @Test
    void sc5_idempotentConsumerProcessesEventExactlyOnce() {
        String key = "test-idem-key-" + UUID.randomUUID();
        String requestHash = "hash-abc";

        // First claim: should succeed
        boolean first = transactionTemplate.execute(tx ->
            idempotencyService.checkAndLock(key, requestHash, 86400));
        assertThat(first).isTrue();

        // Mark complete
        transactionTemplate.executeWithoutResult(tx ->
            idempotencyService.markComplete(key, "{\"status\":\"ok\"}"));

        // Second claim with same key+hash: returns false (already processed)
        boolean second = transactionTemplate.execute(tx ->
            idempotencyService.checkAndLock(key, requestHash, 86400));
        assertThat(second).isFalse();

        // Cached response is available
        var response = transactionTemplate.execute(tx ->
            idempotencyService.getCompletedResponse(key));
        assertThat(response).isPresent().contains("{\"status\":\"ok\"}");
    }

    @Test
    void sc5_idempotencyConflictOnDifferentHash() {
        String key = "conflict-key-" + UUID.randomUUID();
        transactionTemplate.executeWithoutResult(tx ->
            idempotencyService.checkAndLock(key, "hash-1", 86400));

        // Same key, different hash → conflict
        assertThatThrownBy(() ->
            transactionTemplate.executeWithoutResult(tx ->
                idempotencyService.checkAndLock(key, "hash-2", 86400)))
            .isInstanceOf(io.restaurantos.shared.exception.IdempotencyConflictException.class);
    }

    /**
     * A publish the broker refuses must NEVER be recorded as delivered.
     *
     * <p>basic.publish is fire-and-forget, so before publisher confirms were wired the relay's
     * {@code send()} returned normally for an exchange that does not exist, the broker answered
     * 404 on the channel, and the row was still stamped SENT — the event was gone and nothing in
     * the system knew. This test fails against that implementation (status would be SENT).
     */
    @Test
    void sc5_relayLeavesRowPendingWhenTheBrokerRefusesIt() {
        UUID branchId = TestFixtures.testBranchId();
        String deadExchange = "no-such-exchange-" + UUID.randomUUID();

        transactionTemplate.executeWithoutResult(tx ->
            eventPublisher.publish(deadExchange, "poison.key", "POISON_EVENT", branchId,
                new TestPayload("undeliverable")));

        try {
            outboxRelay.relay();

            OutboxEntry poison = outboxEntryOfType("POISON_EVENT");
            assertThat(poison.getStatus())
                .as("a message the broker discarded must not be recorded as delivered")
                .isEqualTo("PENDING");
            assertThat(poison.getSentAt())
                .as("sentAt must stay null for an event that was never sent")
                .isNull();
        } finally {
            // Otherwise the @Scheduled relay retries this row every second for the rest of the
            // run — which is the intended production behaviour, just not wanted in a test suite.
            deleteOutboxEntriesOfType("POISON_EVENT");
        }
    }

    /**
     * One undeliverable row must not take its neighbours down with it.
     *
     * <p>The 404 for a nonexistent exchange closes the channel it was published on. When the whole
     * batch shared one cached channel, a correctly-addressed message relayed alongside a poison
     * row was destroyed too — and also marked SENT. Publishing each row in its own invoke scope
     * contains that. This test fails against the shared-channel implementation: the good message
     * never arrives.
     */
    @Test
    void sc5_poisonRowDoesNotDestroyAGoodMessageInTheSameBatch() {
        UUID branchId = TestFixtures.testBranchId();
        String deadExchange = "no-such-exchange-" + UUID.randomUUID();
        String queueName = "sc5-collateral-" + UUID.randomUUID();

        RabbitAdmin admin = new RabbitAdmin(rabbitTemplate.getConnectionFactory());
        admin.declareQueue(new org.springframework.amqp.core.Queue(queueName, false, false, false));
        admin.declareBinding(new org.springframework.amqp.core.Binding(
            queueName,
            org.springframework.amqp.core.Binding.DestinationType.QUEUE,
            "amq.topic", "sc5.collateral", null));

        try {
            // Poison first so it is relayed first (findTop200...OrderByCreatedAtAsc).
            transactionTemplate.executeWithoutResult(tx ->
                eventPublisher.publish(deadExchange, "poison.key", "COLLATERAL_POISON", branchId,
                    new TestPayload("undeliverable")));
            transactionTemplate.executeWithoutResult(tx ->
                eventPublisher.publish("amq.topic", "sc5.collateral", "COLLATERAL_GOOD", branchId,
                    new TestPayload("must-still-arrive")));

            outboxRelay.relay();

            Awaitility.await()
                .atMost(20, TimeUnit.SECONDS)
                .pollInterval(500, TimeUnit.MILLISECONDS)
                .untilAsserted(() -> {
                    Message msg = rabbitTemplate.receive(queueName, 1000);
                    assertThat(msg)
                        .as("a poison row in the same batch must not destroy this message")
                        .isNotNull();
                    assertThat(new String(msg.getBody(), java.nio.charset.StandardCharsets.UTF_8))
                        .contains("COLLATERAL_GOOD");
                });

            assertThat(outboxEntryOfType("COLLATERAL_GOOD").getStatus()).isEqualTo("SENT");
            assertThat(outboxEntryOfType("COLLATERAL_POISON").getStatus()).isEqualTo("PENDING");
        } finally {
            deleteOutboxEntriesOfType("COLLATERAL_POISON");
            admin.deleteQueue(queueName);
        }
    }

    /**
     * request_hash is VARCHAR(64) and callers hand in unbounded free text — a POS void reason
     * is capped at 500 characters and written by the operator. checkAndLock must digest the
     * payload rather than store it verbatim, or an ordinary explanatory sentence overflows the
     * column and aborts the caller's whole transaction with Postgres 22001.
     */
    @Test
    void sc5_longRequestPayloadIsDigestedToFitTheColumn() {
        String key = "long-payload-key-" + UUID.randomUUID();
        String payload = "x".repeat(500);

        boolean claimed = transactionTemplate.execute(tx ->
            idempotencyService.checkAndLock(key, payload, 86400));
        assertThat(claimed).isTrue();

        String stored = transactionTemplate.execute(tx -> (String) entityManager
            .createNativeQuery("SELECT request_hash FROM idempotency_keys WHERE idem_key = :k")
            .setParameter("k", key)
            .getSingleResult());

        assertThat(stored)
            .as("payload must be stored as a SHA-256 hex digest, not verbatim")
            .hasSize(64)
            .matches("[0-9a-f]{64}")
            .isNotEqualTo(payload);

        // Replaying the same key with the same payload still dedupes.
        boolean replay = transactionTemplate.execute(tx ->
            idempotencyService.checkAndLock(key, payload, 86400));
        assertThat(replay).isFalse();
    }

    /**
     * Digesting must not blunt conflict detection. These two payloads are identical for their
     * first 64 characters, so any "fix" that merely truncated to the column width would treat
     * a genuinely different request as a replay and silently return the wrong result.
     */
    @Test
    void sc5_conflictDetectedWhenPayloadsDivergeBeyondColumnWidth() {
        String key = "divergent-key-" + UUID.randomUUID();
        String shared = "y".repeat(64);

        transactionTemplate.executeWithoutResult(tx ->
            idempotencyService.checkAndLock(key, shared + "-first-request", 86400));

        assertThatThrownBy(() ->
            transactionTemplate.executeWithoutResult(tx ->
                idempotencyService.checkAndLock(key, shared + "-second-request", 86400)))
            .isInstanceOf(io.restaurantos.shared.exception.IdempotencyConflictException.class);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private OutboxEntry outboxEntryOfType(String eventType) {
        return outboxRepository.findAll().stream()
            .filter(e -> eventType.equals(e.getEventType()))
            .findFirst()
            .orElseThrow(() -> new AssertionError("No outbox entry of type " + eventType));
    }

    private void deleteOutboxEntriesOfType(String eventType) {
        transactionTemplate.executeWithoutResult(tx ->
            outboxRepository.deleteAll(outboxRepository.findAll().stream()
                .filter(e -> eventType.equals(e.getEventType()))
                .toList()));
    }

    record TestPayload(String value) {}
}
