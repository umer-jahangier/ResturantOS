package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.TableService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.IncorrectResultSizeDataAccessException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * POS-10: table-centric dine-in. Proves {@code TableService.getActiveOrderForTable} resolves
 * the (at most one) non-terminal order for a table with a correct live bill summary, that the
 * table status derives from the order lifecycle (OCCUPIED while open, AVAILABLE once closed),
 * and that the "at most one active order per table" invariant is enforced (not silently
 * tolerated) by {@code OrderRepository.findByTableIdAndStatusNotIn}'s {@code Optional} return
 * type.
 */
class TableOrderLookupIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired TableService tableService;
    @Autowired OrderRepository orderRepository;
    @Autowired DiningTableRepository tableRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;
    UUID tableId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        cashierId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, cashierId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Grill-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Seekh Kebab");
        item.setBasePricePaisa(60000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        DiningTable table = new DiningTable();
        table.setTenantId(tenantId);
        table.setBranchId(branchId);
        table.setTableNumber("T-" + UUID.randomUUID().toString().substring(0, 8));
        table.setCapacity(4);
        table.setStatus(TableStatus.AVAILABLE);
        table = tableRepository.save(table);
        tableId = table.getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new io.restaurantos.pos.feign.FinancePeriodClient.PeriodStatusDto(
                                UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    private void setSecurityContext(UUID userId, List<String> permissions) {
        JwtClaims claims = new JwtClaims(userId, tenantId, branchId, List.of("CASHIER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private OrderDto createOpenOrderOnTable() {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, clientOrderId, null, tableId, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    @Test
    void activeOrder_resolvesForTable_withCorrectBillSummary_andTableOccupied() {
        OrderDto order = createOpenOrderOnTable();

        TableDetailDto detail = tableService.getActiveOrderForTable(tableId, branchId);

        assertThat(detail.id()).isEqualTo(tableId);
        assertThat(detail.status()).isEqualTo(TableStatus.OCCUPIED);
        assertThat(detail.activeOrder()).isNotNull();
        assertThat(detail.activeOrder().id()).isEqualTo(order.id());
        assertThat(detail.derivedStatus()).isNotNull();
        assertThat(detail.cashierId()).isEqualTo(cashierId);
        assertThat(detail.totalPaisa()).isEqualTo(order.totalPaisa());
        assertThat(detail.subtotalPaisa()).isEqualTo(order.subtotalPaisa());
        assertThat(detail.taxPaisa()).isEqualTo(order.taxPaisa());
    }

    @Test
    void afterClose_activeOrder_isEmpty_andTableIsAvailable() {
        OrderDto order = createOpenOrderOnTable();

        closeViaServeAndPay(orderService, paymentService, order, branchId);

        TableDetailDto detail = tableService.getActiveOrderForTable(tableId, branchId);

        assertThat(detail.activeOrder()).isNull();
        assertThat(detail.status()).isEqualTo(TableStatus.AVAILABLE);
        assertThat(detail.derivedStatus()).isNull();
    }

    @Test
    void afterVoid_activeOrder_isEmpty_andTableIsAvailable() {
        OrderDto order = createOpenOrderOnTable();

        // voidOrder is OPA-gated (VoidOwnOrderIT owns testing the authorization path itself);
        // grant + allow here purely to exercise the table-status-derivation side effect.
        setSecurityContext(cashierId, List.of("pos.order.void.own"));
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(true));

        orderService.voidOrder(order.id(), new VoidOrderRequest("Guest left"), UUID.randomUUID().toString());

        TableDetailDto detail = tableService.getActiveOrderForTable(tableId, branchId);
        assertThat(detail.status()).isEqualTo(TableStatus.AVAILABLE);
        assertThat(detail.activeOrder()).isNull();
    }

    @Test
    void onlyOneActiveOrderPerTable_repositoryEnforcesInvariant() {
        // Directly create two non-terminal orders bound to the SAME table (bypassing the
        // service layer, which does not currently guard against double-booking a table — out
        // of this plan's scope) to prove findByTableIdAndStatusNotIn FAILS LOUDLY rather than
        // silently returning an arbitrary row when the "at most one active order per table"
        // invariant is violated.
        Order first = newDraftOrderOnTable();
        Order second = newDraftOrderOnTable();
        orderRepository.save(first);
        orderRepository.save(second);

        assertThatThrownBy(() -> tableService.getActiveOrderForTable(tableId, branchId))
                .isInstanceOf(IncorrectResultSizeDataAccessException.class);
    }

    private Order newDraftOrderOnTable() {
        Order order = new Order();
        order.setTenantId(tenantId);
        order.setBranchId(branchId);
        order.setClientOrderId(UUID.randomUUID());
        order.setStatus(OrderStatus.OPEN);
        order.setTableId(tableId);
        order.setCoverCount(1);
        order.setOpenedAt(Instant.now());
        order.setOrderNo("ORD-TEST-" + UUID.randomUUID().toString().substring(0, 6));
        return order;
    }
}
