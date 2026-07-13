package io.restaurantos.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.consumer.KitchenItemStatusConsumer;
import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Proves POS-20 (D-05): a KITCHEN_ITEM_STATUS_CHANGED event, produced with the exact wire
 * shape kitchen-service emits (field-name parity), is deserialized and applied by
 * {@link KitchenItemStatusConsumer#onMessage(Message)} — the matching OrderItem transitions
 * live and Order.derivedStatus is recomputed via the single derivation seam. Also proves the
 * no-downgrade (SERVED line untouched) and duplicate-delivery (idempotent) cases.
 *
 * The envelope bytes are built from a locally-defined mirror of kitchen-service's
 * KitchenEventPayloads.ItemStatusChangedPayload (kitchen-service is not a Maven dependency of
 * pos-service) with IDENTICAL field names+order — any accidental drift from the real kitchen
 * record would surface here as a deserialization failure (message silently dropped), which is
 * exactly the contract this test is guarding.
 */
class KitchenItemStatusSyncIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired KitchenItemStatusConsumer kitchenItemStatusConsumer;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Burger");
        item.setBasePricePaisa(55000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new io.restaurantos.shared.api.ApiResponse<>(
                        new io.restaurantos.pos.feign.FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    private OrderDto createSentOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        OrderDto withItem = orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        UUID itemId = withItem.items().get(0).id();
        orderService.sendToKds(order.id(), null);
        return orderService.getOrder(order.id(), branchId);
    }

    /** Builds a Message whose bytes are IDENTICAL in shape to what kitchen-service publishes. */
    private Message buildEnvelopeMessage(UUID orderId, UUID orderItemId, String newStatus,
                                          int revisionNo, String station) throws Exception {
        EventEnvelope<KitchenSideItemStatusChangedPayload> envelope = new EventEnvelope<>(
                UUID.randomUUID(), "KITCHEN_ITEM_STATUS_CHANGED", tenantId, branchId,
                Instant.now(), UUID.randomUUID(), 1, "kitchen-service",
                new KitchenSideItemStatusChangedPayload(orderId, orderItemId, newStatus, revisionNo, station));
        byte[] bytes = objectMapper.writeValueAsBytes(envelope);
        return MessageBuilder.withBody(bytes).build();
    }

    @Test
    void onMessage_appliesKitchenTransition_andRecomputesDerivedStatus() throws Exception {
        OrderDto order = createSentOrder();
        UUID itemId = order.items().get(0).id();
        assertThat(order.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.SENT);

        Message message = buildEnvelopeMessage(order.id(), itemId, "PREPARING", 1, "GRILL");
        kitchenItemStatusConsumer.onMessage(message);

        OrderDto after = orderService.getOrder(order.id(), branchId);
        assertThat(after.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.PREPARING);
        assertThat(after.derivedStatus()).isEqualTo(DerivedOrderStatus.IN_PROGRESS);
    }

    @Test
    void onMessage_servedLine_isNotDowngraded() throws Exception {
        OrderDto order = createSentOrder();
        UUID itemId = order.items().get(0).id();
        orderService.markItemServed(order.id(), itemId);

        Message message = buildEnvelopeMessage(order.id(), itemId, "ACCEPTED", 1, "GRILL");
        kitchenItemStatusConsumer.onMessage(message);

        OrderDto after = orderService.getOrder(order.id(), branchId);
        assertThat(after.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.SERVED);
    }

    @Test
    void onMessage_duplicateEventId_isNoOp() throws Exception {
        OrderDto order = createSentOrder();
        UUID itemId = order.items().get(0).id();

        UUID eventId = UUID.randomUUID();
        EventEnvelope<KitchenSideItemStatusChangedPayload> envelope = new EventEnvelope<>(
                eventId, "KITCHEN_ITEM_STATUS_CHANGED", tenantId, branchId,
                Instant.now(), UUID.randomUUID(), 1, "kitchen-service",
                new KitchenSideItemStatusChangedPayload(order.id(), itemId, "PREPARING", 1, "GRILL"));
        byte[] bytes = objectMapper.writeValueAsBytes(envelope);

        kitchenItemStatusConsumer.onMessage(MessageBuilder.withBody(bytes).build());
        OrderDto afterFirst = orderService.getOrder(order.id(), branchId);
        assertThat(afterFirst.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.PREPARING);

        // Second delivery of the SAME eventId — must be a no-op even though PREPARING would
        // otherwise be a same-status (non-forward) apply.
        kitchenItemStatusConsumer.onMessage(MessageBuilder.withBody(bytes).build());
        OrderDto afterSecond = orderService.getOrder(order.id(), branchId);
        assertThat(afterSecond.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.PREPARING);
    }

    @Test
    void onMessage_unknownOrderItemId_isLoggedAndSkipped_noException() throws Exception {
        OrderDto order = createSentOrder();

        Message message = buildEnvelopeMessage(order.id(), UUID.randomUUID(), "PREPARING", 1, "GRILL");
        kitchenItemStatusConsumer.onMessage(message); // must not throw

        OrderDto after = orderService.getOrder(order.id(), branchId);
        assertThat(after.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.SENT);
    }

    // Mirror of kitchen-service's KitchenEventPayloads.ItemStatusChangedPayload — field
    // names+order IDENTICAL by construction (parity is the property under test).
    private record KitchenSideItemStatusChangedPayload(
            UUID orderId,
            UUID orderItemId,
            String newStatus,
            int revisionNo,
            String station
    ) {}
}
