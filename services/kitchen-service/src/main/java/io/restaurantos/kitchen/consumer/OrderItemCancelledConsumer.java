package io.restaurantos.kitchen.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.kitchen.config.KitchenRabbitConfig;
import io.restaurantos.kitchen.event.KitchenEventPayloads.OrderItemCancelledPayload;
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
 * Consumes ORDER_ITEM_CANCELLED from pos.topic and strikes the matching KDS line (by
 * orderItemId) so a cancelled item stops showing as active work on the board. Idempotent via
 * processed_events; tenant-aware via TenantAwareMessageProcessor.
 */
@Component
public class OrderItemCancelledConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderItemCancelledConsumer.class);
    static final String CONSUMER_NAME = "kitchen.order-item-cancelled";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final TicketService ticketService;
    private final ObjectMapper objectMapper;

    public OrderItemCancelledConsumer(ProcessedEventService processedEventService,
                                      TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                      TicketService ticketService,
                                      ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.ticketService = ticketService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = KitchenRabbitConfig.KITCHEN_ITEM_CANCELLED_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderItemCancelledPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("OrderItemCancelledConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("OrderItemCancelledConsumer: eventId={} orderItemId={}",
                envelope.eventId(), envelope.payload().orderItemId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env ->
                        ticketService.cancelTicketItem(env.payload().orderItemId())
                )
        );
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<OrderItemCancelledPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, OrderItemCancelledPayload.class));
        } catch (Exception e) {
            log.error("OrderItemCancelledConsumer: deserialization failed: {}", e.getMessage());
            return null;
        }
    }
}
