package io.restaurantos.kitchen.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import io.restaurantos.kitchen.config.KitchenRabbitConfig;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderItemServedPayload;
import io.restaurantos.kitchen.service.ProcessedEventService;
import io.restaurantos.kitchen.service.TicketService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * Consumes ORDER_ITEM_SERVED from pos.topic and marks the matching KDS line (by orderItemId)
 * SERVED, so a line served while the order is still open leaves the Ready column immediately
 * instead of lingering until the whole order closes. Mirrors {@link OrderItemCancelledConsumer}.
 * Idempotent via processed_events; tenant-aware via TenantAwareMessageProcessor.
 */
@Component
public class OrderItemServedConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderItemServedConsumer.class);
    static final String CONSUMER_NAME = "kitchen.order-item-served";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final TicketService ticketService;
    private final ObjectMapper objectMapper;

    public OrderItemServedConsumer(ProcessedEventService processedEventService,
                                   TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                   TicketService ticketService,
                                   @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.ticketService = ticketService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = KitchenRabbitConfig.KITCHEN_ITEM_SERVED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderItemServedPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("OrderItemServedConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("OrderItemServedConsumer: eventId={} orderItemId={}",
                envelope.eventId(), envelope.payload().orderItemId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env ->
                        ticketService.serveTicketItem(env.payload().orderItemId())
                )
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<OrderItemServedPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, OrderItemServedPayload.class));
        } catch (Exception e) {
            // Poison message — reject WITHOUT requeue so it dead-letters to the DLQ immediately
            // (the DeadLetterMonitor logs + counts it) instead of being acked and silently lost.
            log.error("OrderItemServedConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }
}
