package io.restaurantos.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.audit.entity.AuditEventEntity;
import io.restaurantos.audit.repository.AuditEventRepository;
import io.restaurantos.audit.repository.ProcessedEventRepository;
import io.restaurantos.shared.event.EventEnvelope;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.containers.RabbitMQContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static java.util.concurrent.TimeUnit.SECONDS;

/**
 * Verifies the all-events consumer:
 *   1. Auditable event (USER_LOGIN_SUCCEEDED) → audit row created.
 *   2. Duplicate eventId → processed exactly once (idempotent dedup).
 *   3. Non-auditable event → no audit row created.
 *
 * Note [03-01-D]: TESTCONTAINERS_RYUK_DISABLED=true may be required in Colima environments.
 */
@SpringBootTest(
        classes = AuditServiceApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT
)
@Testcontainers
class AuditConsumerIT {

    @Container
    static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>(DockerImageName.parse("postgres:16"))
                    .withDatabaseName("audit_db")
                    .withUsername("audit_admin")
                    .withPassword("test-pass");

    @Container
    static final RabbitMQContainer RABBIT =
            new RabbitMQContainer(DockerImageName.parse("rabbitmq:3.12-management"));

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        r.add("spring.datasource.username", POSTGRES::getUsername);
        r.add("spring.datasource.password", POSTGRES::getPassword);
        r.add("spring.liquibase.url", POSTGRES::getJdbcUrl);
        r.add("spring.liquibase.user", POSTGRES::getUsername);
        r.add("spring.liquibase.password", POSTGRES::getPassword);
        r.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        r.add("spring.rabbitmq.host", RABBIT::getHost);
        r.add("spring.rabbitmq.port", () -> String.valueOf(RABBIT.getAmqpPort()));
        r.add("spring.rabbitmq.username", RABBIT::getAdminUsername);
        r.add("spring.rabbitmq.password", RABBIT::getAdminPassword);
        r.add("eureka.client.enabled", () -> "false");
        r.add("TESTCONTAINERS_RYUK_DISABLED", () -> "true");
    }

    @Autowired private AuditEventRepository auditEventRepository;
    @Autowired private ProcessedEventRepository processedEventRepository;
    @Autowired private RabbitTemplate rabbitTemplate;
    @Autowired private AmqpAdmin amqpAdmin;
    @Autowired private ObjectMapper objectMapper;

    private static final String AUTH_EXCHANGE = "auth.topic";
    private static final String ALL_EVENTS_QUEUE = "audit.all-events.queue";
    private static final UUID FIXED_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @BeforeEach
    void setupQueueAndExchange() {
        // Declare exchange + queue + binding (mirrors rabbitmq-definitions.json)
        amqpAdmin.declareExchange(new TopicExchange(AUTH_EXCHANGE, true, false));
        amqpAdmin.declareQueue(new Queue(ALL_EVENTS_QUEUE, true));
        amqpAdmin.declareBinding(BindingBuilder
                .bind(new Queue(ALL_EVENTS_QUEUE))
                .to(new TopicExchange(AUTH_EXCHANGE))
                .with("#"));
    }

    // ---- Test 1: Auditable event produces audit row ----

    @Test
    void publishLoginSucceeded_producesAuditRow() throws Exception {
        UUID eventId = UUID.randomUUID();
        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId,
                "USER_LOGIN_SUCCEEDED",
                FIXED_TENANT_ID,
                null,
                Instant.now(),
                UUID.randomUUID(),
                1,
                "auth-service",
                Map.of("userId", UUID.randomUUID().toString())
        );

        byte[] body = objectMapper.writeValueAsBytes(envelope);
        rabbitTemplate.send(AUTH_EXCHANGE, "user.login.succeeded",
                new org.springframework.amqp.core.Message(body));

        // Await the consumer to process the message
        await().atMost(10, SECONDS).untilAsserted(() -> {
            List<AuditEventEntity> rows = auditEventRepository.findByTenantIdAndOccurredAtBetween(
                    FIXED_TENANT_ID,
                    Instant.now().minusSeconds(60),
                    Instant.now().plusSeconds(60),
                    PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "occurredAt")));
            assertThat(rows).isNotEmpty();
            assertThat(rows.get(0).getAction()).isEqualTo("USER_LOGIN_SUCCEEDED");
            assertThat(rows.get(0).getTenantId()).isEqualTo(FIXED_TENANT_ID);
        });
    }

    // ---- Test 2: Duplicate eventId is deduplicated ----

    @Test
    void duplicateEventId_processedExactlyOnce() throws Exception {
        UUID eventId = UUID.randomUUID();
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000002");

        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId,
                "USER_LOGIN_SUCCEEDED",
                tenantId,
                null,
                Instant.now(),
                UUID.randomUUID(),
                1,
                "auth-service",
                Map.of("userId", UUID.randomUUID().toString())
        );

        byte[] body = objectMapper.writeValueAsBytes(envelope);

        // Publish the same event twice
        rabbitTemplate.send(AUTH_EXCHANGE, "user.login.succeeded",
                new org.springframework.amqp.core.Message(body));
        rabbitTemplate.send(AUTH_EXCHANGE, "user.login.succeeded",
                new org.springframework.amqp.core.Message(body));

        await().atMost(10, SECONDS).untilAsserted(() -> {
            // Exactly 1 row in processed_events for this eventId
            assertThat(processedEventRepository.existsByConsumerAndEventId(
                    "audit.all-events", eventId)).isTrue();

            // Exactly 1 audit row
            List<AuditEventEntity> rows = auditEventRepository.findByTenantIdAndOccurredAtBetween(
                    tenantId,
                    Instant.now().minusSeconds(60),
                    Instant.now().plusSeconds(60),
                    PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "occurredAt")));
            assertThat(rows).hasSize(1);
        });
    }

    // ---- Test 3: Non-auditable event produces no audit row ----

    @Test
    void nonAuditableEvent_producesNoAuditRow() throws Exception {
        UUID tenantId = UUID.fromString("00000000-0000-0000-0000-000000000003");
        UUID eventId = UUID.randomUUID();

        EventEnvelope<Map<String, Object>> envelope = new EventEnvelope<>(
                eventId,
                "HEARTBEAT_PING",  // not in auditable set, non-auth source
                tenantId,
                null,
                Instant.now(),
                UUID.randomUUID(),
                1,
                "pos-service",  // not in ALWAYS_AUDIT_SOURCES
                Map.of("status", "ok")
        );

        byte[] body = objectMapper.writeValueAsBytes(envelope);
        rabbitTemplate.send(AUTH_EXCHANGE, "heartbeat.ping",
                new org.springframework.amqp.core.Message(body));

        // Wait a moment to ensure the message was processed
        Thread.sleep(2000);

        List<AuditEventEntity> rows = auditEventRepository.findByTenantIdAndOccurredAtBetween(
                tenantId,
                Instant.now().minusSeconds(60),
                Instant.now().plusSeconds(60),
                PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "occurredAt")));
        assertThat(rows).isEmpty();
    }
}
