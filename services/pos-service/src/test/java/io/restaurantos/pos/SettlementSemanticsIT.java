package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
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

/**
 * POS-22/POS-23: proves the (paid x served) close matrix — CLOSED ONLY in the (paid, served)
 * cell — and that GET /orders/{id}/payments (via PaymentService.listPayments, the controller's
 * exact delegate — mirrors 07.2-05's direct-service-call IT convention) returns persisted rows.
 * Mirrors OrderCloseIdempotencyIT/PeriodLockCloseIT's Testcontainers + open-period-seeding setup.
 */
class SettlementSemanticsIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;
    static final long ITEM_PRICE_PAISA = 20000L;

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
        item.setName("Karahi");
        item.setBasePricePaisa(ITEM_PRICE_PAISA);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        // Stub Finance period as OPEN — precondition for any close (07.3-01-PLAN.md context).
        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    private OrderDto createSentOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.sendToKds(order.id(), null);
    }

    private OrderDto createServedOrder() {
        OrderDto sent = createSentOrder();
        UUID itemId = sent.items().get(0).id();
        return orderService.markItemServed(sent.id(), itemId);
    }

    @Test
    void getPayments_returnsPersistedRows_withMethodAmountReferenceRecordedAt() {
        OrderDto order = createSentOrder();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, 8000L, "ref-1");
        paymentService.recordPayment(order.id(), PaymentMethod.CARD, 5000L, "ref-2");

        List<OrderPaymentDto> payments = paymentService.listPayments(order.id());

        assertThat(payments).hasSize(2);
        assertThat(payments).extracting(OrderPaymentDto::referenceNo)
                .containsExactlyInAnyOrder("ref-1", "ref-2");
        assertThat(payments).extracting(OrderPaymentDto::amountPaisa)
                .containsExactlyInAnyOrder(8000L, 5000L);
        assertThat(payments).allSatisfy(p -> {
            assertThat(p.method()).isIn("CASH", "CARD");
            assertThat(p.recordedAt()).isNotNull();
        });
    }

    @Test
    void partialPayment_onServedOrder_staysOpen_partiallyPaid_notClosed() {
        OrderDto served = createServedOrder();
        assertThat(served.derivedStatus()).isEqualTo(DerivedOrderStatus.SERVED);
        assertThat(served.status()).isNotEqualTo(OrderStatus.CLOSED);

        paymentService.recordPayment(served.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA / 2, null);

        OrderDto fresh = orderService.getOrder(served.id(), branchId);
        assertThat(fresh.status()).isNotEqualTo(OrderStatus.CLOSED);
        assertThat(fresh.derivedStatus()).isEqualTo(DerivedOrderStatus.SERVED);
    }

    @Test
    void finalPayment_onServedOrder_closesOrder() {
        OrderDto served = createServedOrder();

        paymentService.recordPayment(served.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA, null);

        OrderDto fresh = orderService.getOrder(served.id(), branchId);
        assertThat(fresh.status()).isEqualTo(OrderStatus.CLOSED);
    }

    /**
     * Retirement backstop (plan 07.3-11, POS-23/D-08): now that the legacy exact-tender
     * {@code closeOrder} bypass and its {@code OrderCloseIdempotencyIT} single-publish coverage
     * are both deleted, this reasserts that the ONLY remaining close path (recordPayment ->
     * maybeCloseOrder -> performClose) publishes ORDER_CLOSED exactly once per close — never
     * zero, never duplicated.
     */
    @Test
    void servedAndPaidClose_publishesExactlyOneOrderClosedEvent() {
        OrderDto served = createServedOrder();

        paymentService.recordPayment(served.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA, null);

        long closedEvents = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(closedEvents).isEqualTo(1);
    }

    @Test
    void fullPayment_onUnservedOrder_staysOpen_paidButNotClosed() {
        OrderDto sent = createSentOrder();
        assertThat(sent.derivedStatus()).isNotEqualTo(DerivedOrderStatus.SERVED);

        paymentService.recordPayment(sent.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA, null);

        OrderDto fresh = orderService.getOrder(sent.id(), branchId);
        assertThat(fresh.status()).isNotEqualTo(OrderStatus.CLOSED);
    }

    @Test
    void servingLastItem_ofAlreadyFullyPaidOrder_closesOrder() {
        OrderDto sent = createSentOrder();
        paymentService.recordPayment(sent.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA, null);

        OrderDto afterPayment = orderService.getOrder(sent.id(), branchId);
        assertThat(afterPayment.status()).isNotEqualTo(OrderStatus.CLOSED);

        UUID itemId = afterPayment.items().get(0).id();
        OrderDto served = orderService.markItemServed(sent.id(), itemId);

        assertThat(served.status()).isEqualTo(OrderStatus.CLOSED);
    }
}
