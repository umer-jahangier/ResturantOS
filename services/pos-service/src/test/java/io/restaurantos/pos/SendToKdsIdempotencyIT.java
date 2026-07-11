package io.restaurantos.pos;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Proves the per-fire idempotency contract (RESEARCH.md §4): a replayed sendToKds call with
 * the SAME clientFireId (Idempotency-Key) publishes ORDER_SENT_TO_KDS exactly once — no
 * double-fire on offline-outbox replay. Keyed on {@code sendToKds:{orderId}:{clientFireId}},
 * a NEW per-fire namespace, distinct from clientOrderId (one-per-order, order-create only).
 */
class SendToKdsIdempotencyIT extends PosTestBase {

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
    }

    @Test
    void replayedFire_withSameClientFireId_publishesExactlyOneEvent() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        String clientFireId = UUID.randomUUID().toString();

        OrderDto first = orderService.sendToKds(order.id(), clientFireId);
        OrderDto second = orderService.sendToKds(order.id(), clientFireId);

        assertThat(first.status()).isEqualTo(io.restaurantos.pos.domain.enums.OrderStatus.SENT_TO_KDS);
        assertThat(second.status()).isEqualTo(io.restaurantos.pos.domain.enums.OrderStatus.SENT_TO_KDS);

        long sentEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .count();
        assertThat(sentEvents).isEqualTo(1);
    }

    @Test
    void differentClientFireId_onSameOrder_firesEachRevisionIndependently() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        orderService.sendToKds(order.id(), UUID.randomUUID().toString());

        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id(), UUID.randomUUID().toString());

        long sentEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .count();
        assertThat(sentEvents).isEqualTo(2);
    }

    @Test
    void noClientFireId_stillFiresWithoutIdempotencyGovernance() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        OrderDto sent = orderService.sendToKds(order.id(), null);
        assertThat(sent.status()).isEqualTo(io.restaurantos.pos.domain.enums.OrderStatus.SENT_TO_KDS);

        long sentEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .count();
        assertThat(sentEvents).isEqualTo(1);
    }
}
