package io.restaurantos.pos.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.config.PosKitchenTopologyConfig;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderItem;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderStatusDerivationService;
import io.restaurantos.pos.service.PosProcessedEventService;
import io.restaurantos.pos.service.TableService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.EnumSet;
import java.util.Set;
import java.util.UUID;

/**
 * Consumes ORDER_READY events from kitchen.topic and syncs the affected station's
 * {@link OrderItem#getItemStatus()} lines to READY (POS-11: item-granular, not
 * order-level). {@link Order#getDerivedStatus()} is recomputed via
 * {@link OrderStatusDerivationService} on every update — never hand-set (Pitfall 3).
 * Idempotent via processed_events AND by construction: items already READY (or beyond,
 * or SERVED/CANCELLED) are excluded from the update, so a redelivered/duplicate
 * ORDER_READY event never downgrades or re-touches a line that already advanced.
 */
@Component
public class OrderReadyConsumer {

    private static final Logger log = LoggerFactory.getLogger(OrderReadyConsumer.class);
    static final String CONSUMER_NAME = "pos.order-ready";
    private static final String DEFAULT_KDS_STATION = "DEFAULT";

    // Items in one of these statuses are eligible to advance to READY when their station
    // reports ready. SERVED/CANCELLED/READY (already at-or-beyond) are excluded — an
    // ORDER_READY event must never downgrade a line that already progressed further.
    private static final Set<OrderItemStatus> ELIGIBLE_FOR_READY = EnumSet.of(
            OrderItemStatus.PENDING, OrderItemStatus.SENT,
            OrderItemStatus.ACCEPTED, OrderItemStatus.PREPARING);

    private final PosProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final OrderRepository orderRepository;
    private final ObjectMapper objectMapper;
    private final OrderStatusDerivationService orderStatusDerivationService;
    private final TableService tableService;

    public OrderReadyConsumer(PosProcessedEventService processedEventService,
                               TenantAwareMessageProcessor tenantAwareMessageProcessor,
                               OrderRepository orderRepository,
                               ObjectMapper objectMapper,
                               OrderStatusDerivationService orderStatusDerivationService,
                               TableService tableService) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.orderRepository = orderRepository;
        this.objectMapper = objectMapper;
        this.orderStatusDerivationService = orderStatusDerivationService;
        this.tableService = tableService;
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
                        markOrderReady(env.payload().orderId(), env.payload().station())
                )
        );
    }

    @Transactional
    public void markOrderReady(UUID orderId, String station) {
        Order order = orderRepository.findById(orderId).orElse(null);
        if (order == null) {
            log.warn("OrderReadyConsumer: order {} not found — skipping", orderId);
            return;
        }

        String readiedStation = station != null ? station : DEFAULT_KDS_STATION;
        boolean anyUpdated = false;
        for (OrderItem item : order.getItems()) {
            String itemStation = item.getKdsStation() != null ? item.getKdsStation() : DEFAULT_KDS_STATION;
            if (readiedStation.equals(itemStation) && ELIGIBLE_FOR_READY.contains(item.getItemStatus())) {
                item.setItemStatus(OrderItemStatus.READY);
                anyUpdated = true;
            }
        }

        if (!anyUpdated) {
            log.debug("OrderReadyConsumer: order {} station {} — no eligible items to advance (idempotent skip)",
                    orderId, readiedStation);
            return;
        }

        order.setDerivedStatus(orderStatusDerivationService.derive(order.getItems()));
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());
        orderRepository.save(order);
        log.info("OrderReadyConsumer: order {} station {} — items advanced to READY, derivedStatus={}",
                orderId, readiedStation, order.getDerivedStatus());
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
