package io.restaurantos.pos.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Qualifier;
import io.restaurantos.pos.config.PosKitchenTopologyConfig;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.domain.model.OrderItem;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderMapper;
import io.restaurantos.pos.service.OrderStatusDerivationService;
import io.restaurantos.pos.service.PosProcessedEventService;
import io.restaurantos.pos.service.TableService;
import io.restaurantos.pos.ws.PosOrderWebSocketHandler;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantAwareMessageProcessor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.UUID;

/**
 * Consumes KITCHEN_ITEM_STATUS_CHANGED events from kitchen.topic and applies the
 * per-item kitchen transition live to the matching {@link OrderItem#getItemStatus()}
 * (POS-20 / D-05), recomputing {@link Order#getDerivedStatus()} via
 * {@link OrderStatusDerivationService} on every update — never hand-set (Pitfall 3).
 * Mirrors {@link OrderReadyConsumer}'s shape (processed_events dedup + tenant-aware
 * processing) but generalizes the ELIGIBLE guard to an ordinal comparison since the
 * target status varies per message (not fixed at READY): a line already SERVED or
 * CANCELLED is never touched, and an incoming status is only applied if it is strictly
 * further along {@link OrderItemStatus}'s declared lifecycle order than the item's
 * current status — so a kitchen event can never downgrade or re-touch a line that has
 * already advanced (by kitchen redelivery, out-of-order delivery, or POS-side action).
 */
@Component
public class KitchenItemStatusConsumer {

    private static final Logger log = LoggerFactory.getLogger(KitchenItemStatusConsumer.class);
    static final String CONSUMER_NAME = "pos.kitchen-item-status";

    // kitchen TicketItemStatus name() -> pos OrderItemStatus. Kitchen PENDING (e.g. a
    // re-armed line on a new revision) maps to SENT — a fired line never goes back to the
    // pos-side PENDING value, which specifically means "never sent to kitchen at all".
    // COOKING is kitchen's legacy alias for PREPARING (kept for old persisted rows).
    private static final Map<String, OrderItemStatus> STATUS_MAP = Map.of(
            "PENDING", OrderItemStatus.SENT,
            "ACCEPTED", OrderItemStatus.ACCEPTED,
            "PREPARING", OrderItemStatus.PREPARING,
            "COOKING", OrderItemStatus.PREPARING,
            "READY", OrderItemStatus.READY);

    private final PosProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final OrderRepository orderRepository;
    private final ObjectMapper objectMapper;
    private final OrderStatusDerivationService orderStatusDerivationService;
    private final TableService tableService;
    private final OrderMapper orderMapper;
    private final PosOrderWebSocketHandler webSocketHandler;

    public KitchenItemStatusConsumer(PosProcessedEventService processedEventService,
                                      TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                      OrderRepository orderRepository,
                                      @Qualifier("eventObjectMapper") ObjectMapper objectMapper,
                                      OrderStatusDerivationService orderStatusDerivationService,
                                      TableService tableService,
                                      OrderMapper orderMapper,
                                      PosOrderWebSocketHandler webSocketHandler) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.orderRepository = orderRepository;
        this.objectMapper = objectMapper;
        this.orderStatusDerivationService = orderStatusDerivationService;
        this.tableService = tableService;
        this.orderMapper = orderMapper;
        this.webSocketHandler = webSocketHandler;
    }

    @RabbitListener(queues = PosKitchenTopologyConfig.POS_KITCHEN_ITEM_STATUS_QUEUE)
    public void onMessage(Message message) {
        EventEnvelope<ItemStatusChangedPayload> envelope = deserialize(message);
        if (envelope == null) {
            log.warn("KitchenItemStatusConsumer: could not deserialize message — skipping");
            return;
        }

        log.debug("KitchenItemStatusConsumer: received eventId={} orderId={} orderItemId={} newStatus={}",
                envelope.eventId(), envelope.payload().orderId(),
                envelope.payload().orderItemId(), envelope.payload().newStatus());

        processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                tenantAwareMessageProcessor.process(envelope, env ->
                        applyItemStatus(env.payload().orderId(), env.payload().orderItemId(), env.payload().newStatus())
                )
        );
    }

    @Transactional
    public void applyItemStatus(UUID orderId, UUID orderItemId, String newStatus) {
        Order order = orderRepository.findById(orderId).orElse(null);
        if (order == null) {
            log.warn("KitchenItemStatusConsumer: order {} not found — skipping", orderId);
            return;
        }

        OrderItemStatus mapped = STATUS_MAP.get(newStatus);
        if (mapped == null) {
            log.warn("KitchenItemStatusConsumer: unknown kitchen status {} — skipping", newStatus);
            return;
        }

        OrderItem item = order.getItems().stream()
                .filter(i -> orderItemId.equals(i.getId()))
                .findFirst()
                .orElse(null);
        if (item == null) {
            log.warn("KitchenItemStatusConsumer: orderItemId {} not found on order {} — skipping",
                    orderItemId, orderId);
            return;
        }

        OrderItemStatus current = item.getItemStatus();
        if (current == OrderItemStatus.SERVED || current == OrderItemStatus.CANCELLED
                || mapped.ordinal() <= current.ordinal()) {
            log.debug("KitchenItemStatusConsumer: item {} current={} incoming={} — not eligible, idempotent skip",
                    orderItemId, current, mapped);
            return;
        }

        item.setItemStatus(mapped);
        order.setDerivedStatus(orderStatusDerivationService.derive(order.getItems()));
        tableService.syncStatusForOrder(order.getTableId(), order.getBranchId(),
                order.getStatus(), order.getDerivedStatus());
        Order saved = orderRepository.save(order);
        // Push the updated order LIVE to any POS terminal subscribed to this branch. Resolve
        // the DTO HERE — while this @Transactional method's TenantContext + JPA session are
        // still open — so lazy item/modifier collections load before serialization. The
        // TenantAwareMessageProcessor clears the context once the message scope ends, so a
        // deferred push (e.g. from an after-commit hook calling getOrder) would fail the
        // branch-context guard. Mirrors kitchen TicketRoutingService's in-scope notify.
        webSocketHandler.notifyOrderUpdate(saved.getBranchId(), orderMapper.toDto(saved));
        log.info("KitchenItemStatusConsumer: order {} item {} {} -> {}, derivedStatus={}",
                orderId, orderItemId, current, mapped, order.getDerivedStatus());
    }

    @SuppressWarnings("unchecked")
    private EventEnvelope<ItemStatusChangedPayload> deserialize(Message message) {
        try {
            return objectMapper.readValue(message.getBody(),
                    objectMapper.getTypeFactory().constructParametricType(
                            EventEnvelope.class, ItemStatusChangedPayload.class));
        } catch (Exception e) {
            // Poison message — reject WITHOUT requeue so it dead-letters to the DLQ immediately
            // (the DeadLetterMonitor logs + counts it) instead of being acked and silently lost.
            log.error("KitchenItemStatusConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }

    // Field names+order MUST be byte-identical to kitchen-service's
    // KitchenEventPayloads.ItemStatusChangedPayload (field-name parity is the ONLY contract
    // enforcement; a mismatch silently drops every message). Never reorder/rename.
    public record ItemStatusChangedPayload(
            UUID orderId,
            UUID orderItemId,
            String newStatus,
            int revisionNo,
            String station
    ) {}
}
