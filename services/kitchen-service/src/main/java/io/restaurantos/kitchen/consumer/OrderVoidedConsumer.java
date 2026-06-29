package io.restaurantos.kitchen.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.kitchen.config.KitchenRabbitConfig;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderVoidedPayload;
import io.restaurantos.kitchen.service.ProcessedEventService;
import io.restaurantos.kitchen.service.TicketService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * Consumes ORDER_VOIDED events from pos.topic and cancels all KDS tickets for the order.
 * Idempotent via processed_events; tenant-aware via TenantAwareMessageProcessor.
 */
@Component
public class OrderVoidedConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderVoidedConsumer.class);
    static final String CONSUMER_NAME = "kitchen.order-voided";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final TicketService ticketService;
    private final ObjectMapper objectMapper;

    public OrderVoidedConsumer(ProcessedEventService processedEventService,
                                TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                TicketService ticketService,
                                ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.ticketService = ticketService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = KitchenRabbitConfig.KITCHEN_ORDER_VOIDED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderVoidedPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("OrderVoidedConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("OrderVoidedConsumer: received eventId={} orderId={}",
                envelope.eventId(), envelope.payload().orderId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env ->
                        ticketService.cancelTicketsForOrder(env.payload().orderId())
                )
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<OrderVoidedPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, OrderVoidedPayload.class));
        } catch (Exception e) {
            log.error("OrderVoidedConsumer: deserialization failed: {}", e.getMessage());
            return null;
        }
    }
}
