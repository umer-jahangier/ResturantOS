package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.StateInvalidException;
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

/**
 * POS-24: proves {@code OrderService.assignTable} binds an AVAILABLE table to a tableless
 * order (flipping the table to OCCUPIED via the single {@code TableService.syncStatusForOrder}
 * seam), rejects OCCUPIED/NEEDS_BUSSING tables and terminal orders, and never mutates
 * {@code table.setStatus(...)} inline.
 */
class AssignTableIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired DiningTableRepository tableRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

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
                .thenReturn(new ApiResponse<>(
                        new io.restaurantos.pos.feign.FinancePeriodClient.PeriodStatusDto(
                                UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    private UUID seedTable(TableStatus status) {
        DiningTable table = new DiningTable();
        table.setTenantId(tenantId);
        table.setBranchId(branchId);
        table.setTableNumber("T-" + UUID.randomUUID().toString().substring(0, 8));
        table.setCapacity(4);
        table.setStatus(status);
        return tableRepository.save(table).getId();
    }

    private OrderDto createTablelessOpenOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    @Test
    void assignAvailableTable_toTablelessOrder_setsOrderTableId_andFlipsTableToOccupied() {
        UUID tableId = seedTable(TableStatus.AVAILABLE);
        OrderDto order = createTablelessOpenOrder();
        assertThat(order.tableId()).isNull();

        OrderDto assigned = orderService.assignTable(order.id(), tableId);

        assertThat(assigned.tableId()).isEqualTo(tableId);
        DiningTable table = tableRepository.findById(tableId).orElseThrow();
        assertThat(table.getStatus()).isEqualTo(TableStatus.OCCUPIED);
    }

    @Test
    void assignOccupiedTable_isRejected_orderUnchanged() {
        UUID occupiedTableId = seedTable(TableStatus.OCCUPIED);
        OrderDto order = createTablelessOpenOrder();

        assertThatThrownBy(() -> orderService.assignTable(order.id(), occupiedTableId))
                .isInstanceOf(StateInvalidException.class);

        OrderDto reloaded = orderService.getOrder(order.id(), branchId);
        assertThat(reloaded.tableId()).isNull();
    }

    @Test
    void assignNeedsBussingTable_isRejected() {
        UUID needsBussingTableId = seedTable(TableStatus.NEEDS_BUSSING);
        OrderDto order = createTablelessOpenOrder();

        assertThatThrownBy(() -> orderService.assignTable(order.id(), needsBussingTableId))
                .isInstanceOf(StateInvalidException.class);
    }

    @Test
    void assignTable_toClosedOrder_isRejected() {
        UUID tableId = seedTable(TableStatus.AVAILABLE);
        OrderDto order = createTablelessOpenOrder();

        OrderDto closed = closeViaServeAndPay(orderService, paymentService, order, branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        assertThatThrownBy(() -> orderService.assignTable(order.id(), tableId))
                .isInstanceOf(StateInvalidException.class);
    }
}
