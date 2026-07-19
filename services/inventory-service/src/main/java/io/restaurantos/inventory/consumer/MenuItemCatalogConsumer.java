package io.restaurantos.inventory.consumer;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.inventory.config.InventoryRabbitConfig;
import io.restaurantos.inventory.event.InventoryEventPayloads;
import io.restaurantos.inventory.event.InventoryEventPayloads.MenuItemDeletedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.MenuItemUpsertedPayload;
import io.restaurantos.inventory.service.MenuItemCatalogService;
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
 * Consumes BOTH MENU_ITEM_UPSERTED and MENU_ITEM_DELETED from the SAME
 * {@code inventory.menu-item.queue} (D-08 — this queue has two bindings, unlike every other
 * queue in this service). Parses the envelope JSON once, reads {@code eventType}, THEN
 * dispatches to the matching payload class before calling MenuItemCatalogService — an
 * unrecognized eventType is logged and skipped rather than mis-dispatched (T-082-02).
 * Idempotent via processed_events (consumer name {@code inventory.menu-item-catalog}); tenant
 * from the envelope, never the payload body.
 */
@Component
public class MenuItemCatalogConsumer {

    private static final Logger log = LoggerFactory.getLogger(MenuItemCatalogConsumer.class);
    static final String CONSUMER_NAME = "inventory.menu-item-catalog";

    private final ProcessedEventService processedEventService;
    private final TenantAwareMessageProcessor tenantAwareMessageProcessor;
    private final MenuItemCatalogService catalogService;
    private final ObjectMapper objectMapper;

    public MenuItemCatalogConsumer(ProcessedEventService processedEventService,
                                    TenantAwareMessageProcessor tenantAwareMessageProcessor,
                                    MenuItemCatalogService catalogService,
                                    @Qualifier("eventObjectMapper") ObjectMapper objectMapper) {
        this.processedEventService = processedEventService;
        this.tenantAwareMessageProcessor = tenantAwareMessageProcessor;
        this.catalogService = catalogService;
        this.objectMapper = objectMapper;
    }

    @RabbitListener(queues = InventoryRabbitConfig.INVENTORY_MENU_ITEM_QUEUE)
    public void onMessage(Message message) {
        JsonNode root = parse(message);
        String eventType = root.path("eventType").asText(null);

        try {
            if (InventoryEventPayloads.MENU_ITEM_UPSERTED.equals(eventType)) {
                EventEnvelope<MenuItemUpsertedPayload> envelope = objectMapper.convertValue(root,
                        objectMapper.getTypeFactory().constructParametricType(
                                EventEnvelope.class, MenuItemUpsertedPayload.class));
                processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                        tenantAwareMessageProcessor.process(envelope, env -> catalogService.upsert(env.payload())));
            } else if (InventoryEventPayloads.MENU_ITEM_DELETED.equals(eventType)) {
                EventEnvelope<MenuItemDeletedPayload> envelope = objectMapper.convertValue(root,
                        objectMapper.getTypeFactory().constructParametricType(
                                EventEnvelope.class, MenuItemDeletedPayload.class));
                processedEventService.tryProcess(CONSUMER_NAME, envelope.eventId(), () ->
                        tenantAwareMessageProcessor.process(envelope, env -> catalogService.softDelete(env.payload())));
            } else {
                log.warn("MenuItemCatalogConsumer: unrecognized eventType={} — skipping", eventType);
            }
        } catch (Exception e) {
            log.error("MenuItemCatalogConsumer: processing failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("processing failed", e);
        }
    }

    private JsonNode parse(Message message) {
        try {
            return objectMapper.readTree(message.getBody());
        } catch (Exception e) {
            // Poison message — reject WITHOUT requeue so it dead-letters to the DLQ immediately
            // instead of being acked and silently lost.
            log.error("MenuItemCatalogConsumer: deserialization failed, routing to DLQ: {}", e.getMessage());
            throw new AmqpRejectAndDontRequeueException("deserialization failed", e);
        }
    }
}
