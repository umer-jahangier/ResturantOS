package io.restaurantos.shared.event;

import java.util.UUID;

public interface EventPublisher {
    /**
     * Enqueue an event for reliable publication. MUST be called inside the same
     * @Transactional method that mutates business state (resolves MAJOR-12).
     * @param exchange   target exchange, e.g. "pos.topic"
     * @param routingKey e.g. "pos.order.closed"
     * @param eventType  e.g. "ORDER_CLOSED"
     * @param branchId   may be null for tenant-wide events
     * @param payload    serialised to JSON as envelope.payload
     */
    void publish(String exchange, String routingKey, String eventType, UUID branchId, Object payload);
}
