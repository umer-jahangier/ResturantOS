package io.restaurantos.kitchen.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.kitchen.config.KitchenRabbitConfig;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderSentToKdsPayload;
import io.restaurantos.kitchen.service.ProcessedEventService;
import io.restaurantos.kitchen.service.TicketRoutingService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

/**
 * Consumes ORDER_SENT_TO_KDS events from pos.topic and routes items to KDS tickets.
 * Idempotent via processed_events; tenant-aware via TenantAwareMessageProcessor.
 */
@Component
public class OrderSentToKdsConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderSentToKdsConsumer.class);
    static final String CONSUMER_NAME = "kitchen.order-sent";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final TicketRoutingService ticketRoutingService;
    private final ObjectMapper objectMapper;

    public OrderSentToKdsConsumer(ProcessedEventService processedEventService,
                                   TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                   TicketRoutingService ticketRoutingService,
                                   ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.ticketRoutingService = ticketRoutingService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = KitchenRabbitConfig.KITCHEN_ORDER_SENT_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderSentToKdsPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("OrderSentToKdsConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("OrderSentToKdsConsumer: received eventId={} orderId={}",
                envelope.eventId(), envelope.payload().orderId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env ->
                        ticketRoutingService.route(env.payload(), env.payload().orderNo())
                )
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<OrderSentToKdsPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, OrderSentToKdsPayload.class));
        } catch (Exception e) {
            log.error("OrderSentToKdsConsumer: deserialization failed: {}", e.getMessage());
            return null;
        }
    }
}
