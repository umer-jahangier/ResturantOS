package io.restaurantos.shared.event;

import java.time.Instant;
import java.util.UUID;

/**
 * Canonical event envelope transmitted on every RabbitMQ exchange.
 * Matches agent-spec 02 §2.1 and agent-spec 03 §3.10.
 */
public record EventEnvelope<T>(
        UUID eventId,
        String eventType,
        UUID tenantId,
        UUID branchId,
        Instant occurredAt,
        UUID correlationId,
        int schemaVersion,
        String source,
        T payload) {}
