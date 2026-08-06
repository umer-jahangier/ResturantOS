package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.shared.event.OutboxEntry;
import io.restaurantos.shared.event.OutboxRepository;
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

/**
 * Plan 13-16 (D-30): the WAITER persona seeded by 13-02 holds {@code pos.order.create} and
 * {@code pos.order.send_to_kds} and deliberately NO till permission — in table service the waiter
 * takes the order and a cashier settles it. Before this plan, {@code OrderServiceImpl.createOrder}
 * hard-required the CREATING user's OPEN till, so a correctly-permissioned waiter was authorized to
 * take an order and then refused by the service with {@code 409 NO_OPEN_TILL}: the grants were right
 * and the workflow was impossible.
 *
 * <p>This pins the waiter path end to end — create, add a line, fire to the KDS — with no till
 * anywhere in the picture, and asserts the order persists with {@code tillSessionId == null}. The
 * till requirement now lives at cash settlement ({@code PaymentServiceImpl}); see
 * {@link CashPaymentRequiresTillIT} for the other half of the invariant, which is what makes the
 * pair STRICTER than the create-time guard it replaces.
 */
class WaiterOrderNoTillIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired OrderRepository orderRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID waiterId;
    UUID menuItemId;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        waiterId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, waiterId, null);
        // Service-layer permission gates read the Spring SecurityContext, which TenantContext does
        // NOT populate (mirrors StationAdminIT.authenticateAs). The waiter carries exactly the two
        // grants 13-02 seeds — notably no pos.till.* — so this test fails for the RIGHT reason if a
        // till permission ever becomes a precondition of taking an order again.
        authenticateAs(List.of("pos.order.create", "pos.order.send_to_kds"));

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Chicken Karahi");
        item.setBasePricePaisa(85000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();
    }

    @Test
    void waiterWithNoTill_createsOrder_andSendsToKds() {
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        outboxRepository.deleteAll();
        OrderDto fired = orderService.sendToKds(order.id(), null);

        assertThat(fired.status()).isEqualTo(OrderStatus.SENT_TO_KDS);

        List<OutboxEntry> sent = outboxRepository.findAll().stream()
                .filter(e -> "ORDER_SENT_TO_KDS".equals(e.getEventType()))
                .toList();
        assertThat(sent).hasSize(1);
    }

    @Test
    void waiterOrder_persistsWithNullTill_andWaiterAsCashier() {
        OrderDto order = orderService.createOrder(new CreateOrderRequest(
                branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 2, null, null));

        Order persisted = orderRepository.findById(order.id()).orElseThrow();
        // No till exists for this user, so none is bound — creation-time binding is now
        // opportunistic, not mandatory.
        assertThat(persisted.getTillSessionId()).isNull();
        // The waiter is still recorded as the order's originator (own-orders VIEW scoping and the
        // void OPA rule both key off cashierId), which is unchanged by this plan.
        assertThat(persisted.getCashierId()).isEqualTo(waiterId);
    }

    /** Mirrors StationAdminIT.authenticateAs — service-layer gates read the SecurityContext. */
    private void authenticateAs(List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                waiterId, tenantId, branchId, List.of("WAITER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }
}
