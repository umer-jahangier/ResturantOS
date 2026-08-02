package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.math.BigDecimal;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OrderRlsIsolationIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired OrderRepository orderRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantA;
    UUID tenantB;
    UUID branchA;
    UUID branchB;
    UUID menuItemIdA;
    UUID menuItemIdB;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantA = UUID.randomUUID();
        tenantB = UUID.randomUUID();
        branchA = UUID.randomUUID();
        branchB = UUID.randomUUID();

        tenantContext.set(tenantA, branchA, null, null);
        MenuCategory catA = new MenuCategory();
        catA.setTenantId(tenantA);
        catA.setName("Main A");
        catA.setSortOrder(1);
        catA = menuCategoryRepository.save(catA);
        MenuItem itemA = new MenuItem();
        itemA.setTenantId(tenantA);
        itemA.setCategory(catA);
        itemA.setName("Biryani A");
        itemA.setBasePricePaisa(50000L);
        itemA.setTaxRatePct(BigDecimal.ZERO);
        itemA = menuItemRepository.save(itemA);
        menuItemIdA = itemA.getId();

        tenantContext.set(tenantB, branchB, null, null);
        MenuCategory catB = new MenuCategory();
        catB.setTenantId(tenantB);
        catB.setName("Main B");
        catB.setSortOrder(1);
        catB = menuCategoryRepository.save(catB);
        MenuItem itemB = new MenuItem();
        itemB.setTenantId(tenantB);
        itemB.setCategory(catB);
        itemB.setName("Nihari B");
        itemB.setBasePricePaisa(60000L);
        itemB.setTaxRatePct(BigDecimal.ZERO);
        itemB = menuItemRepository.save(itemB);
        menuItemIdB = itemB.getId();
    }

    @Test
    void order_created_under_tenantA_not_visible_under_tenantB() {
        // Create and open order for tenant A
        tenantContext.set(tenantA, branchA, null, null);
        UUID clientId = UUID.randomUUID();
        OrderDto orderA = orderService.createOrder(
                new CreateOrderRequest(branchA, clientId, null, null, 1, null, null));
        orderService.addItem(orderA.id(), new AddOrderItemRequest(menuItemIdA, branchA, 1, null, null));

        // Switch to tenant B and ask for branch A's orders.
        //
        // listOrders now REFUSES a branchId that is not the caller's own, rather than returning an
        // empty page: branchId is a client-supplied parameter, and pos_db's tables are ENABLE (not
        // FORCE) ROW LEVEL SECURITY with the application as owner, so RLS is inert here and the
        // check has to be in the service. Refusing beats returning 0 — it distinguishes "you may
        // not ask that" from "there is nothing there", and it matches the guard listOrderSummaries
        // has always had. This assertion previously expected 0 and failed, because the query was
        // neither tenant- nor branch-scoped and really did return tenant A's order.
        tenantContext.set(tenantB, branchB, null, null);

        assertThatThrownBy(() -> orderService.listOrders(
                branchA, List.of(OrderStatus.OPEN.name()), Pageable.unpaged()))
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("different branch");

        // And a caller asking for their OWN branch sees none of tenant A's orders either.
        Page<OrderDto> ownBranch = orderService.listOrders(
                branchB, List.of(OrderStatus.OPEN.name()), Pageable.unpaged());
        assertThat(ownBranch.getTotalElements()).isEqualTo(0L);
    }

    @Test
    void getOrder_crossBranch_deniedByBranchGuard() {
        // Create an order under tenant A / branch A
        tenantContext.set(tenantA, branchA, null, null);
        UUID clientId = UUID.randomUUID();
        OrderDto orderA = orderService.createOrder(
                new CreateOrderRequest(branchA, clientId, null, null, 1, null, null));
        orderService.addItem(orderA.id(), new AddOrderItemRequest(menuItemIdA, branchA, 1, null, null));

        // Switch to tenant B / branch B, try to GET tenant A's order by passing branchA.
        // The branch-isolation guard (requireOwnBranch) now rejects the request-supplied
        // sibling branchId BEFORE the tenant-RLS repository lookup — a stronger, earlier
        // denial than the previous OrderNotFoundException. Cross-tenant RLS itself remains
        // covered by order_created_under_tenantA_not_visible_under_tenantB (via listOrders).
        tenantContext.set(tenantB, branchB, null, null);

        assertThatThrownBy(() -> orderService.getOrder(orderA.id(), branchA))
                .isInstanceOf(PermissionDeniedException.class);
    }
}
