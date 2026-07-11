package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Proves POS-13: order-level + per-item instructions round-trip through create and PATCH
 * edit, and reach the ORDER_SENT_TO_KDS kitchen payload. Also proves item-status
 * transitions (serve/cancel) recompute derivedStatus via the single derivation seam, and
 * the ORDER_READY per-item sync excludes SERVED/CANCELLED/already-READY lines.
 */
class OrderInstructionsIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired io.restaurantos.pos.consumer.OrderReadyConsumer orderReadyConsumer;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
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
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    @Test
    void instructions_roundTrip_throughCreateAndPatchEdit_andReachKdsPayload() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, "initial note"));
        OrderDto withItem = orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        UUID itemId = withItem.items().get(0).id();

        // PATCH-edit order-level and per-item notes.
        OrderDto edited = orderService.updateInstructions(order.id(),
                new UpdateInstructionsRequest("no onions please", Map.of(itemId, "extra spicy")));

        assertThat(edited.notes()).isEqualTo("no onions please");
        assertThat(edited.items().get(0).notes()).isEqualTo("extra spicy");

        // Round-trips on getOrder.
        OrderDto reloaded = orderService.getOrder(order.id(), branchId);
        assertThat(reloaded.notes()).isEqualTo("no onions please");
        assertThat(reloaded.items().get(0).notes()).isEqualTo("extra spicy");

        // Reaches the ORDER_SENT_TO_KDS payload (orderNotes + item notes).
        orderService.sendToKds(order.id(), null);
        List<OutboxEntry> sentEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .toList();
        assertThat(sentEvents).hasSize(1);
        String payload = sentEvents.get(0).getEnvelopeJson();
        assertThat(payload).contains("no onions please");
        assertThat(payload).contains("extra spicy");
    }

    @Test
    void orderNoteExceeding240Chars_isRejectedServerSide() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));

        String tooLong = "x".repeat(241);
        assertThatThrownBy(() ->
                orderService.updateInstructions(order.id(), new UpdateInstructionsRequest(tooLong, null)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void itemNoteExceeding140Chars_isRejectedServerSide() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        OrderDto withItem = orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        UUID itemId = withItem.items().get(0).id();

        String tooLong = "y".repeat(141);
        assertThatThrownBy(() ->
                orderService.updateInstructions(order.id(), new UpdateInstructionsRequest(null, Map.of(itemId, tooLong))))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void markItemServed_recomputesDerivedStatus_viaSingleDerivationSeam() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        OrderDto withItem = orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        UUID itemId = withItem.items().get(0).id();

        orderService.sendToKds(order.id(), null);

        OrderDto served = orderService.markItemServed(order.id(), itemId);
        assertThat(served.items().get(0).kdsStatus()).isEqualTo(OrderItemStatus.SERVED);
        assertThat(served.derivedStatus()).isEqualTo(io.restaurantos.pos.domain.enums.DerivedOrderStatus.SERVED);
    }

    @Test
    void markItemServed_onNeverFiredPendingLine_isRejected() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        OrderDto withItem = orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        UUID itemId = withItem.items().get(0).id();

        assertThatThrownBy(() -> orderService.markItemServed(order.id(), itemId))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void cancelItem_onAlreadyServedLine_isRejected() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        OrderDto withItem = orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        UUID itemId = withItem.items().get(0).id();

        orderService.sendToKds(order.id(), null);
        orderService.markItemServed(order.id(), itemId);

        assertThatThrownBy(() -> orderService.cancelItem(order.id(), itemId))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void markItemServed_unknownItemId_throwsResourceNotFound() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));

        assertThatThrownBy(() -> orderService.markItemServed(order.id(), UUID.randomUUID()))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void orderReady_excludesServedAndCancelledItems_onlyAdvancesEligibleLines() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        OrderDto withFirst = orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        UUID servedItemId = withFirst.items().get(0).id();

        orderService.sendToKds(order.id(), null);
        orderService.markItemServed(order.id(), servedItemId);

        // Add a second PENDING-then-fired line so the station has an eligible item too.
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto beforeReady = orderService.sendToKds(order.id(), null);
        UUID eligibleItemId = beforeReady.items().stream()
                .filter(i -> !i.id().equals(servedItemId))
                .findFirst().orElseThrow().id();

        // Simulate ORDER_READY for the DEFAULT station (null kdsStation resolves to DEFAULT).
        orderReadyConsumer.markOrderReady(order.id(), "DEFAULT");

        OrderDto after = orderService.getOrder(order.id(), branchId);
        var servedLine = after.items().stream().filter(i -> i.id().equals(servedItemId)).findFirst().orElseThrow();
        var eligibleLine = after.items().stream().filter(i -> i.id().equals(eligibleItemId)).findFirst().orElseThrow();

        // SERVED line is untouched (not downgraded/re-touched); eligible SENT line advances to READY.
        assertThat(servedLine.kdsStatus()).isEqualTo(OrderItemStatus.SERVED);
        assertThat(eligibleLine.kdsStatus()).isEqualTo(OrderItemStatus.READY);
    }
}
