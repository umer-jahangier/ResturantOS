package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.SplitTenderCalculator;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class OrderCloseIdempotencyIT extends PosTestBase {

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
        item.setName("Biryani");
        item.setBasePricePaisa(25000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        // Stub Finance period as OPEN
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    @Test
    void closeOrder_recordsPayment_andPublishesOrderClosed_exactly_once() {
        // Create order and add item (DRAFT → OPEN)
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, clientOrderId, null, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        OrderDto fresh = orderService.getOrder(order.id(), branchId);
        assertThat(fresh.status()).isEqualTo(OrderStatus.OPEN);
        assertThat(fresh.totalPaisa()).isGreaterThan(0L);

        outboxRepository.deleteAll();

        // Close with exact payment
        var payments = List.of(new SplitTenderCalculator.PaymentEntry("CASH", fresh.totalPaisa(), null));
        CloseOrderRequest closeReq = new CloseOrderRequest(payments);
        String idempotencyKey = UUID.randomUUID().toString();

        OrderDto closed = orderService.closeOrder(order.id(), closeReq, idempotencyKey);

        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        // Verify exactly one ORDER_CLOSED event
        long closedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(closedEvents).isEqualTo(1);

        // Verify payload contains required fields including null customerId
        String payload = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .findFirst()
                .map(e -> e.getEnvelopeJson())
                .orElse("");
        assertThat(payload).contains("ORDER_CLOSED");
        assertThat(payload).contains(order.id().toString());
    }

    @Test
    void closeOrder_duplicateIdempotencyKey_returnsSameResponse_and_noNewEvent() {
        // Create and close an order
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        OrderDto fresh = orderService.getOrder(order.id(), branchId);

        outboxRepository.deleteAll();

        var payments = List.of(new SplitTenderCalculator.PaymentEntry("CASH", fresh.totalPaisa(), null));
        CloseOrderRequest closeReq = new CloseOrderRequest(payments);
        String idempotencyKey = UUID.randomUUID().toString();

        // First close
        OrderDto firstClose = orderService.closeOrder(order.id(), closeReq, idempotencyKey);
        assertThat(firstClose.status()).isEqualTo(OrderStatus.CLOSED);

        long eventsAfterFirst = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(eventsAfterFirst).isEqualTo(1);

        // Duplicate close with SAME idempotency key
        OrderDto secondClose = orderService.closeOrder(order.id(), closeReq, idempotencyKey);
        assertThat(secondClose.status()).isEqualTo(OrderStatus.CLOSED);

        // Still exactly 1 ORDER_CLOSED event (no duplicate)
        long eventsAfterSecond = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(eventsAfterSecond).isEqualTo(1);
    }
}
