package io.restaurantos.inventory.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.event.InventoryEventPayloads.OrderClosedPayload;
import io.restaurantos.inventory.service.DepletionService;
import io.restaurantos.inventory.service.ProcessedEventService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;

/**
 * Consumes ORDER_CLOSED from pos.topic and depletes inventory stock (INV-03 — the core value
 * loop: POS sale -> inventory depletion with accurate quantities and moving-average COGS).
 * Idempotent via processed_events (consumer name {@code inventory.depletion}); tenant-aware via
 * TenantAwareMessageProcessor. Mirrors kitchen-service's OrderClosedConsumer shape exactly.
 */
@Component
public class OrderClosedConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderClosedConsumer.class);
    static final String CONSUMER_NAME = "inventory.depletion";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final DepletionService depletionService;
    private final ObjectMapper objectMapper;

    public OrderClosedConsumer(ProcessedEventService processedEventService,
                                TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                DepletionService depletionService,
                                @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.depletionService = depletionService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = InventoryRabbitConfig.INVENTORY_ORDER_CLOSED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderClosedPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("OrderClosedConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("OrderClosedConsumer: eventId={} orderId={}",
                envelope.eventId(), envelope.payload().orderId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env ->
                        depletionService.deplete(env.branchId(), env.payload())
                )
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<OrderClosedPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, OrderClosedPayload.class));
        } catch (Exception e) {
            // Poison message — reject WITHOUT requeue so it dead-letters to the DLQ immediately
            // instead of being acked and silently lost.
            log.error("OrderClosedConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }
}
