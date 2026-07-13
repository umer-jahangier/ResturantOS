package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.PaymentStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.OrderPayment;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderSummaryDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderPaymentRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * POS-24: proves {@code OrderSummaryDto} carries settlement/payment/item-quantity data, the
 * empty-filter default excludes DRAFT, and an explicit terminal-status request (e.g. [CLOSED])
 * still returns closed orders. Mirrors {@link TableOrderLookupIT}'s setup shape.
 */
class OrderSummaryDtoIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderPaymentRepository orderPaymentRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID burgerId;
    UUID cokeId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        // listOrderSummaries own-vs-all-branch scoping (T-07.1d-01) silently filters to the
        // caller's own orders (cashierId) unless pos.order.view.all is granted — a null
        // cashierId in the JPQL predicate never matches (SQL NULL semantics), so a non-null
        // cashierId is required for these rows to be visible at all (mirrors TableOrderLookupIT).
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        burgerId = seedMenuItem(cat, "Burger", 55000L);
        cokeId = seedMenuItem(cat, "Coke", 15000L);

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new io.restaurantos.pos.feign.FinancePeriodClient.PeriodStatusDto(
                                UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    private UUID seedMenuItem(MenuCategory cat, String name, long pricePaisa) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName(name);
        item.setBasePricePaisa(pricePaisa);
        item.setTaxRatePct(new BigDecimal("0.00"));
        return menuItemRepository.save(item).getId();
    }

    @Test
    void summaryRow_reportsItemQuantity_distinctItemCount_andPaymentStatus() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(burgerId, branchId, 3, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(cokeId, branchId, 2, null, null));
        OrderDto fetched = orderService.getOrder(order.id(), branchId);

        // Partial payment — half the total — before any list call, to prove paymentStatus and
        // amountPaidPaisa are correctly derived on the summary row (not just closeOrder's path).
        OrderPayment payment = new OrderPayment();
        payment.setTenantId(tenantId);
        payment.setOrderId(order.id());
        payment.setMethod(PaymentMethod.CASH);
        payment.setAmountPaisa(fetched.totalPaisa() / 2);
        payment.setRecordedAt(Instant.now());
        orderPaymentRepository.save(payment);

        Page<OrderSummaryDto> page = orderService.listOrderSummaries(branchId, null, PageRequest.of(0, 20));
        OrderSummaryDto row = page.getContent().stream()
                .filter(r -> r.orderId().equals(order.id()))
                .findFirst()
                .orElseThrow();

        assertThat(row.itemQuantity()).isEqualTo(5);
        assertThat(row.distinctItemCount()).isEqualTo(2);
        assertThat(row.settlementStatus()).isEqualTo(OrderStatus.OPEN);
        assertThat(row.paymentStatus()).isEqualTo(PaymentStatus.PARTIALLY_PAID);
        assertThat(row.amountPaidPaisa()).isEqualTo(fetched.totalPaisa() / 2);
    }

    @Test
    void defaultFilter_excludesDraftOrder_butIncludesOpenOrder() {
        // DRAFT: created but never fired an item — stays DRAFT (client-only cart never
        // persisted an addItem, mirroring POS-16's no-draft-persistence contract).
        orderService.createOrder(new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));

        OrderDto openOrder = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(openOrder.id(), new AddOrderItemRequest(burgerId, branchId, 1, null, null));

        Page<OrderSummaryDto> page = orderService.listOrderSummaries(branchId, null, PageRequest.of(0, 20));

        assertThat(page.getContent()).extracting(OrderSummaryDto::orderId).contains(openOrder.id());
        assertThat(page.getContent()).extracting(OrderSummaryDto::settlementStatus).doesNotContain(OrderStatus.DRAFT);
    }

    @Test
    void explicitClosedStatusFilter_returnsClosedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(burgerId, branchId, 1, null, null));

        OrderDto closed = closeViaServeAndPay(orderService, paymentService, order, branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        Pageable pageable = PageRequest.of(0, 20);
        Page<OrderSummaryDto> defaultPage = orderService.listOrderSummaries(branchId, null, pageable);
        assertThat(defaultPage.getContent()).extracting(OrderSummaryDto::orderId).doesNotContain(order.id());

        Page<OrderSummaryDto> closedPage = orderService.listOrderSummaries(branchId, List.of("CLOSED"), pageable);
        assertThat(closedPage.getContent()).extracting(OrderSummaryDto::orderId).contains(order.id());
        OrderSummaryDto closedRow = closedPage.getContent().stream()
                .filter(r -> r.orderId().equals(order.id()))
                .findFirst()
                .orElseThrow();
        assertThat(closedRow.settlementStatus()).isEqualTo(OrderStatus.CLOSED);
    }
}
