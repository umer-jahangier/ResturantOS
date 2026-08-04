package io.restaurantos.inventory;

import io.restaurantos.inventory.consumer.MenuItemCatalogConsumer;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.event.InventoryEventPayloads;
import io.restaurantos.inventory.event.InventoryEventPayloads.MenuItemDeletedPayload;
import io.restaurantos.inventory.event.InventoryEventPayloads.MenuItemUpsertedPayload;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantContext;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

/**
 * Proves the D-08 dual-event-type dispatch (both MENU_ITEM_UPSERTED and MENU_ITEM_DELETED on one
 * {@code inventory.menu-item.queue}), D-07 soft-delete-only, and T-082-01/T-082-02 idempotency +
 * type-safe dispatch. Mirrors {@link DepletionConsumerIT}'s Testcontainers + hand-built
 * EventEnvelope + direct {@code onMessage(Message)} harness — RabbitTemplate is mocked in
 * {@link InventoryTestBase}, so no live broker is needed.
 */
class MenuItemCatalogConsumerIT extends InventoryTestBase {

    @Autowired MenuItemCatalogConsumer menuItemCatalogConsumer;
    @Autowired MenuItemCatalogRepository menuItemCatalogRepository;
    @Autowired TenantContext tenantContext;
    @Autowired @Qualifier("eventObjectMapper") ObjectMapper eventObjectMapper;

    UUID tenantId;
    UUID branchId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);
    }

    @Test
    void upsertedEvent_createsNewCatalogRow() {
        UUID menuItemId = UUID.randomUUID();
        MenuItemUpsertedPayload payload = new MenuItemUpsertedPayload(
                menuItemId, "House Burger", UUID.randomUUID(), "Mains", true, 1200L, Instant.now());
        Message message = buildMessage(UUID.randomUUID(), InventoryEventPayloads.MENU_ITEM_UPSERTED, payload);

        tenantContext.clear();
        menuItemCatalogConsumer.onMessage(message);
        // Duplicate delivery — SAME eventId — must be a no-op (T-082-01).
        menuItemCatalogConsumer.onMessage(message);

        tenantContext.set(tenantId, branchId, null, null);
        Optional<MenuItemCatalog> row = menuItemCatalogRepository.findByTenantIdAndMenuItemId(tenantId, menuItemId);
        assertThat(row).isPresent();
        assertThat(row.get().getName()).isEqualTo("House Burger");
        assertThat(row.get().isActive()).isTrue();
        assertThat(row.get().getBasePricePaisa()).isEqualTo(1200L);
    }

    @Test
    void upsertedEvent_updatesExistingRow() {
        UUID menuItemId = UUID.randomUUID();
        MenuItemUpsertedPayload first = new MenuItemUpsertedPayload(
                menuItemId, "House Burger", UUID.randomUUID(), "Mains", true, 1200L, Instant.now());
        tenantContext.clear();
        menuItemCatalogConsumer.onMessage(buildMessage(UUID.randomUUID(), InventoryEventPayloads.MENU_ITEM_UPSERTED, first));

        MenuItemUpsertedPayload second = new MenuItemUpsertedPayload(
                menuItemId, "House Burger", UUID.randomUUID(), "Mains", false, 1200L, Instant.now());
        menuItemCatalogConsumer.onMessage(buildMessage(UUID.randomUUID(), InventoryEventPayloads.MENU_ITEM_UPSERTED, second));

        tenantContext.set(tenantId, branchId, null, null);
        assertThat(menuItemCatalogRepository.findByTenantIdAndActiveTrueOrderByNameAsc(tenantId)).isEmpty();
        Optional<MenuItemCatalog> row = menuItemCatalogRepository.findByTenantIdAndMenuItemId(tenantId, menuItemId);
        assertThat(row).isPresent(); // same row, upsert-by-menuItemId, not a duplicate
        assertThat(row.get().isActive()).isFalse();
    }

    @Test
    void deletedEvent_softDeletes_neverRemovesRow() {
        UUID menuItemId = UUID.randomUUID();
        MenuItemUpsertedPayload upserted = new MenuItemUpsertedPayload(
                menuItemId, "House Burger", UUID.randomUUID(), "Mains", true, 1200L, Instant.now());
        tenantContext.clear();
        menuItemCatalogConsumer.onMessage(buildMessage(UUID.randomUUID(), InventoryEventPayloads.MENU_ITEM_UPSERTED, upserted));

        MenuItemDeletedPayload deleted = new MenuItemDeletedPayload(menuItemId);
        menuItemCatalogConsumer.onMessage(buildMessage(UUID.randomUUID(), InventoryEventPayloads.MENU_ITEM_DELETED, deleted));

        tenantContext.set(tenantId, branchId, null, null);
        Optional<MenuItemCatalog> row = menuItemCatalogRepository.findByTenantIdAndMenuItemId(tenantId, menuItemId);
        assertThat(row).isPresent(); // D-07: row still exists
        assertThat(row.get().isActive()).isFalse();
    }

    @Test
    void deletedEvent_forUnknownMenuItem_isNoOp() {
        UUID menuItemId = UUID.randomUUID();
        MenuItemDeletedPayload deleted = new MenuItemDeletedPayload(menuItemId);
        Message message = buildMessage(UUID.randomUUID(), InventoryEventPayloads.MENU_ITEM_DELETED, deleted);

        tenantContext.clear();
        assertThatCode(() -> menuItemCatalogConsumer.onMessage(message)).doesNotThrowAnyException();

        tenantContext.set(tenantId, branchId, null, null);
        assertThat(menuItemCatalogRepository.findByTenantIdAndMenuItemId(tenantId, menuItemId)).isEmpty();
    }

    @Test
    void unrecognizedEventType_isSkipped_notThrown() {
        Message message = buildMessage(UUID.randomUUID(), "SOMETHING_ELSE", Map.of("foo", "bar"));

        tenantContext.clear();
        assertThatCode(() -> menuItemCatalogConsumer.onMessage(message)).doesNotThrowAnyException();
    }

    private Message buildMessage(UUID eventId, String eventType, Object payload) {
        EventEnvelope<Object> envelope = new EventEnvelope<>(
                eventId, eventType, tenantId, branchId,
                Instant.now(), UUID.randomUUID(), 1, "pos-service-test", payload);
        try {
            byte[] body = eventObjectMapper.writeValueAsBytes(envelope);
            return MessageBuilder.withBody(body).build();
        } catch (Exception e) {
            throw new IllegalStateException("Failed to serialize test EventEnvelope", e);
        }
    }
}
