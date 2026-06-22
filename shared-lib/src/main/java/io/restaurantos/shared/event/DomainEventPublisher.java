package io.restaurantos.shared.event;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Transactional outbox publisher (resolves MAJOR-12).
 * Serializes the payload as an EventEnvelope JSON String and INSERTs an OutboxEntry
 * inside the CALLER's @Transactional business transaction.
 * The OutboxRelay polls and delivers to RabbitMQ at-least-once after commit.
 *
 * Payload is stored as a JSON String column (not bytes) so the relay can
 * publish the raw bytes directly without re-serialization (no double-encode — SC5 gotcha).
 */
public class DomainEventPublisher implements EventPublisher {

    private final OutboxRepository outboxRepository;
    private final TenantContext tenantContext;
    private final ObjectMapper objectMapper;

    public DomainEventPublisher(OutboxRepository outboxRepository,
                                TenantContext tenantContext,
                                ObjectMapper objectMapper) {
        this.outboxRepository = outboxRepository;
        this.tenantContext = tenantContext;
        this.objectMapper = objectMapper;
    }

    @Override
    @Transactional
    public void publish(String exchange, String routingKey, String eventType, UUID branchId, Object payload) {
        UUID tenantId = tenantContext.requireTenantId();
        UUID eventId = UUID.randomUUID();
        UUID correlationId = UUID.randomUUID();

        EventEnvelope<Object> envelope = new EventEnvelope<>(
            eventId, eventType, tenantId, branchId,
            Instant.now(), correlationId, 1, "shared-lib", payload);

        String envelopeJson;
        try {
            envelopeJson = objectMapper.writeValueAsString(envelope);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize EventEnvelope for eventType=" + eventType, e);
        }

        OutboxEntry entry = new OutboxEntry();
        entry.setEventId(eventId);
        entry.setExchange(exchange);
        entry.setRoutingKey(routingKey);
        entry.setEventType(eventType);
        entry.setTenantId(tenantId);
        entry.setBranchId(branchId);
        entry.setCorrelationId(correlationId);
        entry.setSource("shared-lib");
        entry.setEnvelopeJson(envelopeJson);
        entry.setStatus("PENDING");
        entry.setCreatedAt(Instant.now());

        outboxRepository.save(entry);
    }
}
