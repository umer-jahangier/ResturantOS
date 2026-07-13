package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PeriodLockedException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class PeriodLockCloseIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
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
        cat.setName("Starters-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Samosa");
        item.setBasePricePaisa(5000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();
    }

    private OrderDto createOpenOrder() {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    /**
     * Drives an order to fully-SERVED (via sendToKds + markItemServed) WITHOUT paying it yet —
     * maybeCloseOrder is a no-op while unpaid, so no period check fires during this setup, only
     * once the caller records the final payment.
     */
    private OrderDto createServedUnpaidOrder() {
        OrderDto order = createOpenOrder();
        OrderDto sent = orderService.sendToKds(order.id(), null);
        UUID itemId = sent.items().get(0).id();
        return orderService.markItemServed(order.id(), itemId);
    }

    @Test
    void recordingFinalPayment_whenPeriodLocked_throws423_andNoOrderClosedEvent() {
        OrderDto served = createServedUnpaidOrder();

        // Stub Finance to return LOCKED period
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "LOCKED", 2026, 5),
                        null, List.of()));

        assertThatThrownBy(() ->
                paymentService.recordPayment(served.id(), PaymentMethod.CASH, served.totalPaisa(), null))
                .isInstanceOf(PeriodLockedException.class)
                .hasMessageContaining("locked");

        long closedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(closedEvents).isEqualTo(0);
    }

    @Test
    void recordingFinalPayment_whenFinanceUnreachable_failsClosed_andNoOrderClosedEvent() {
        OrderDto served = createServedUnpaidOrder();

        // Stub Finance to throw (simulating network failure)
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenThrow(new RuntimeException("Connection refused: finance-service unavailable"));

        // Fail-closed: Finance unreachable → treat as LOCKED
        assertThatThrownBy(() ->
                paymentService.recordPayment(served.id(), PaymentMethod.CASH, served.totalPaisa(), null))
                .isInstanceOf(PeriodLockedException.class);

        long closedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(closedEvents).isEqualTo(0);
    }
}
