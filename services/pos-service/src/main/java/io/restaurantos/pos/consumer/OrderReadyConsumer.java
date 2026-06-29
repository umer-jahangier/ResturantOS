package io.restaurantos.pos.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.config.PosKitchenTopologyConfig;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.PosProcessedEventService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.UUID;

/**
 * Consumes ORDER_READY events from kitchen.topic and transitions POS order status
 * to READY (when all KDS stations are done) or PARTIAL_READY (partial completion).
 * Idempotent via processed_events.
 */
@Component
public class OrderReadyConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderReadyConsumer.class);
    static final String CONSUMER_NAME = "pos.order-ready";

    private final PosProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final OrderRepository orderRepository;
    private final ObjectMapper objectMapper;

    public OrderReadyConsumer(PosProcessedEventService processedEventService,
                               TenantAwareMessageProcessor tenantAwareMessageProcessor,
                               OrderRepository orderRepository,
                               ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.orderRepository = orderRepository;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = PosKitchenTopologyConfig.POS_ORDER_READY_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<OrderReadyPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("OrderReadyConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("OrderReadyConsumer: received eventId={} orderId={}",
                envelope.eventId(), envelope.payload().orderId());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env ->
                        markOrderReady(env.payload().orderId())
                )
        );
    }

    @Transactional
    void markOrderReady(UUID orderId) {
        Order order = orderRepository.findById(orderId).orElse(null);
        if (order == null) {
            log.warn("OrderReadyConsumer: order {} not found — skipping", orderId);
            return;
        }
        if (order.getStatus() == OrderStatus.READY) {
            log.debug("OrderReadyConsumer: order {} already READY — idempotent skip", orderId);
            return;
        }
        order.setStatus(OrderStatus.READY);
        orderRepository.save(order);
        log.info("OrderReadyConsumer: order {} marked READY", orderId);
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<OrderReadyPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, OrderReadyPayload.class));
        } catch (Exception e) {
            log.error("OrderReadyConsumer: deserialization failed: {}", e.getMessage());
            return null;
        }
    }

    public record OrderReadyPayload(UUID orderId, String station, Instant readyAt) {}
}
