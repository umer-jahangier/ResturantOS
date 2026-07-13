package io.restaurantos.kitchen.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import io.restaurantos.kitchen.config.KitchenRabbitConfig;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderClosedPayload;
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
 * Consumes ORDER_CLOSED from pos.topic and marks the order's active tickets SERVED, removing
 * them from the board — the "served" removal signal the KDS otherwise lacks (an order closes
 * only when fully paid AND served, so READY tickets stay visible until then). Idempotent via
 * processed_events; tenant-aware via TenantAwareMessageProcessor.
 */
@Component
public class OrderClosedConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderClosedConsumer.class);
    static final String CONSUMER_NAME = "kitchen.order-closed";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final TicketService ticketService;
    private final ObjectMapper objectMapper;

    public OrderClosedConsumer(ProcessedEventService processedEventService,
                               TenantAwareMessageProcessor tenantAwareMessageProcessor,
                               TicketService ticketService,
                               @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.ticketService = ticketService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = KitchenRabbitConfig.KITCHEN_ORDER_CLOSED_QUEUE)
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
                        ticketService.serveTicketsForOrder(env.payload().orderId())
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
            // (the DeadLetterMonitor logs + counts it) instead of being acked and silently lost.
            log.error("OrderClosedConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }
}
