package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.StateInvalidException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderLifecycleIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
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
        cat.setName("Mains");
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Chicken Karahi");
        item.setBasePricePaisa(85000L);
        item.setTaxRatePct(new BigDecimal("5.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();
    }

    @Test
    void createOrder_thenAddItem_transitions_DRAFT_to_OPEN_and_writes_ORDER_CREATED() {
        UUID clientOrderId = UUID.randomUUID();
        CreateOrderRequest createReq = new CreateOrderRequest(
                branchId, clientOrderId, null, null, 2, null, null);
        OrderDto created = orderService.createOrder(createReq);

        assertThat(created.status()).isEqualTo(OrderStatus.DRAFT);
        assertThat(created.clientOrderId()).isEqualTo(clientOrderId);

        // Add first item -> triggers DRAFT -> OPEN
        AddOrderItemRequest addReq = new AddOrderItemRequest(menuItemId, branchId, 1, null, null);
        OrderDto withItem = orderService.addItem(created.id(), addReq);

        assertThat(withItem.status()).isEqualTo(OrderStatus.OPEN);
        assertThat(withItem.orderNo()).startsWith("ORD-");
        assertThat(withItem.items()).hasSize(1);

        // Verify exactly one ORDER_CREATED outbox entry
        List<OutboxEntry> outboxEntries = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CREATED".equals(e.getEventType()))
                .toList();
        assertThat(outboxEntries).hasSize(1);
        assertThat(outboxEntries.get(0).getEnvelopeJson()).contains("ORDER_CREATED");
    }

    @Test
    void sendToKds_transitions_to_SENT_TO_KDS_and_writes_ORDER_SENT_TO_KDS() {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 2, null, "extra spicy"));

        outboxRepository.deleteAll();

        OrderDto sentOrder = orderService.sendToKds(order.id());

        assertThat(sentOrder.status()).isEqualTo(OrderStatus.SENT_TO_KDS);
        assertThat(sentOrder.sentToKdsAt()).isNotNull();

        List<OutboxEntry> outboxEntries = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .toList();
        assertThat(outboxEntries).hasSize(1);
        String payload = outboxEntries.get(0).getEnvelopeJson();
        assertThat(payload).contains("ORDER_SENT_TO_KDS");
        // Null kdsStation resolved to DEFAULT
        assertThat(payload).contains("DEFAULT");
    }

    @Test
    void reSendToKds_returns_409_StateInvalidException() {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id());

        assertThatThrownBy(() -> orderService.sendToKds(order.id()))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void discountExceedingSubtotal_clampsLineTotalToZero() {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        UUID itemId = order.id(); // We need to find the item id
        OrderDto withItem = orderService.getOrder(order.id(), branchId);
        UUID actualItemId = withItem.items().get(0).id();

        // Apply a discount way larger than the item price (850 PKR = 85000 paisa)
        // BigDecimal 9999 PKR = 999900 paisa
        ApplyDiscountRequest hugeDiscount = new ApplyDiscountRequest(
                "LINE", actualItemId, "FLAT", new BigDecimal("9999.00"));
        OrderDto discounted = orderService.applyDiscount(withItem.id(), hugeDiscount);

        // Line total should be clamped to 0 (not negative)
        assertThat(discounted.totalPaisa()).isGreaterThanOrEqualTo(0L);
    }

    @Test
    void duplicateCreate_sameclientOrderId_returnsSameOrder() {
        UUID clientOrderId = UUID.randomUUID();
        CreateOrderRequest req = new CreateOrderRequest(branchId, clientOrderId, null, null, 1, null, null);

        OrderDto first = orderService.createOrder(req);
        OrderDto second = orderService.createOrder(req);

        assertThat(second.id()).isEqualTo(first.id());
    }
}
