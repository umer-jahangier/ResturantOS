package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.security.JwtClaims;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Verifies that a KITCHEN_STAFF role (pos.kds.view, pos.kds.update only)
 * is denied all POS management operations that require order-level permissions.
 */
class KitchenRoleDeniedPosIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID kitchenStaffId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        kitchenStaffId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, kitchenStaffId, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("KDS-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Pizza");
        item.setBasePricePaisa(20000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        // Set KITCHEN_STAFF security context — only KDS permissions
        JwtClaims kitchenClaims = new JwtClaims(
                kitchenStaffId, tenantId, branchId,
                List.of("KITCHEN_STAFF"),
                List.of("pos.kds.view", "pos.kds.update"),
                Map.of(), null);
        UsernamePasswordAuthenticationToken auth =
                new UsernamePasswordAuthenticationToken(kitchenClaims, null, List.of());
        SecurityContextHolder.getContext().setAuthentication(auth);

        // OPA returns DENY for any pos module action (kitchen staff has no pos.order.* permissions)
        when(opaClient.evaluate(eq("pos"), any())).thenReturn(new OpaDecision(false));

        // Financial-integrity guard: createOrder now requires an OPEN till for the current user.
        // These tests assert order CREATION is not OPA-gated (only void is), so the user needs a
        // till; openTill itself is not OPA-gated.
        openTillForCashier(branchId);
    }

    private OrderDto createOpenOrder() {
        UUID clientOrderId = UUID.randomUUID();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, clientOrderId, null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    @Test
    void kitchen_staff_denied_void_operation() {
        OrderDto order = createOpenOrder();

        assertThatThrownBy(() ->
                orderService.voidOrder(order.id(), new VoidOrderRequest("Kitchen staff test"), UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class)
                .hasMessageContaining("Not permitted");
    }

    @Test
    void kitchen_staff_can_create_order_but_not_void() {
        // Kitchen staff CAN create orders (no OPA check on createOrder)
        UUID clientOrderId = UUID.randomUUID();
        OrderDto created = orderService.createOrder(
                new CreateOrderRequest(branchId, clientOrderId, null, null, 1, null, null));
        assertThat(created).isNotNull();

        // But CANNOT void — OPA denies
        orderService.addItem(created.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        assertThatThrownBy(() ->
                orderService.voidOrder(created.id(), new VoidOrderRequest("Denied"), UUID.randomUUID().toString()))
                .isInstanceOf(PermissionDeniedException.class);
    }
}
