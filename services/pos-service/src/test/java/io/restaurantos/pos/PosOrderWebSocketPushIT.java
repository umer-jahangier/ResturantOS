package io.restaurantos.pos;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.restaurantos.pos.consumer.KitchenItemStatusConsumer;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.ws.PosOrderWebSocketHandler;
import io.restaurantos.shared.event.EventEnvelope;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageBuilder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Proves the POS-side live-push wire: when {@link KitchenItemStatusConsumer} applies a
 * kitchen→pos item-status transition, it notifies {@link PosOrderWebSocketHandler} with the
 * FRESHLY-UPDATED {@link OrderDto} for the order's branch — the trigger the new POS order
 * WebSocket relies on to push kitchen progress to the cashier terminal live. The handler is
 * mocked here (mirroring how kitchen's tests treat its WS handler) so the assertion is on the
 * notification contract, not on socket transport.
 *
 * <p>Also proves the DTO is resolved WHILE the message-scope TenantContext/JPA session is
 * still open (its lazy item collection is materialized): the captured DTO carries the applied
 * status. And that an idempotent no-op delivery (SERVED line, no change) does NOT push.
 */
class PosOrderWebSocketPushIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired KitchenItemStatusConsumer kitchenItemStatusConsumer;
    @Autowired TenantContext tenantContext;
    @Autowired ObjectMapper objectMapper;

    @MockitoBean PosOrderWebSocketHandler webSocketHandler;

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
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id(), null);
        return orderService.getOrder(order.id(), branchId);
    }

    private void deliver(Message message) {
        kitchenItemStatusConsumer.onMessage(message);
        tenantContext.set(tenantId, branchId, null, null);
    }

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
    void appliedTransition_pushesUpdatedOrderDto_toOrdersBranch() throws Exception {
        OrderDto order = createSentOrder();
        UUID itemId = order.items().get(0).id();

        deliver(buildEnvelopeMessage(order.id(), itemId, "PREPARING", 1, "GRILL"));

        ArgumentCaptor<OrderDto> dtoCaptor = ArgumentCaptor.forClass(OrderDto.class);
        verify(webSocketHandler, times(1)).notifyOrderUpdate(eq(branchId), dtoCaptor.capture());

        OrderDto pushed = dtoCaptor.getValue();
        assertThat(pushed.id()).isEqualTo(order.id());
        // DTO resolved in-scope: its lazy item collection loaded and carries the applied status.
        assertThat(pushed.items()).isNotEmpty();
        assertThat(pushed.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.PREPARING);
    }

    @Test
    void idempotentNoOp_doesNotPush() throws Exception {
        OrderDto order = createSentOrder();
        UUID itemId = order.items().get(0).id();
        orderService.markItemServed(order.id(), itemId);

        // A SERVED line is never downgraded — the consumer skips the update, so nothing is pushed.
        deliver(buildEnvelopeMessage(order.id(), itemId, "ACCEPTED", 1, "GRILL"));

        verify(webSocketHandler, never()).notifyOrderUpdate(any(), any());
    }

    // Mirror of kitchen-service's KitchenEventPayloads.ItemStatusChangedPayload — field
    // names+order IDENTICAL by construction (wire parity is the property under test).
    private record KitchenSideItemStatusChangedPayload(
            UUID orderId,
            UUID orderItemId,
            String newStatus,
            int revisionNo,
            String station
    ) {}
}
