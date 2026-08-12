package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.repository.*;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.*;

class TillReconciliationIT extends PosTestBase {

    @Autowired TillService tillService;
    @Autowired OrderService orderService;
    @Autowired TenantContext tenantContext;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired OrderRepository orderRepository;

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
        item.setName("Test Item");
        item.setBasePricePaisa(10000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();
    }

    @Test
    void openTill_createsOpenSession_and_TILL_OPENED_event() {
        OpenTillRequest req = new OpenTillRequest(branchId, 50000L);
        TillSessionDto dto = tillService.openTill(req);

        assertThat(dto.status().name()).isEqualTo("OPEN");
        assertThat(dto.openingFloatPaisa()).isEqualTo(50000L);
        assertThat(dto.cashierId()).isEqualTo(cashierId);

        long tillOpenedCount = outboxRepository.findAll().stream()
                .filter(e -> "TILL_OPENED".equals(e.getEventType()))
                .count();
        assertThat(tillOpenedCount).isEqualTo(1);
    }

    @Test
    void openTill_secondOpenForSameCashier_returns409() {
        tillService.openTill(new OpenTillRequest(branchId, 10000L));

        assertThatThrownBy(() -> tillService.openTill(new OpenTillRequest(branchId, 5000L)))
                .isInstanceOf(PosExceptions.TillAlreadyOpenException.class);
    }

    @Test
    void closeTill_withNonClosedOrder_throws409() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 10000L));

        // Create an OPEN order linked to this till session
        Order order = new Order();
        order.setTenantId(tenantId);
        order.setBranchId(branchId);
        order.setClientOrderId(UUID.randomUUID());
        order.setStatus(OrderStatus.OPEN);
        order.setTillSessionId(till.id());
        order.setOrderNo("TEST-001");
        order.setOpenedAt(Instant.now());
        orderRepository.save(order);

        assertThatThrownBy(() -> tillService.closeTill(till.id(), new CloseTillRequest(10000L, null)))
                .isInstanceOf(PosExceptions.TillHasOpenOrdersException.class);
    }

    @Test
    void closeTill_withAllOrdersTerminal_computesVariance_and_TILL_CLOSED_event() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 50000L));

        // Create a CLOSED order linked to this till
        Order order = new Order();
        order.setTenantId(tenantId);
        order.setBranchId(branchId);
        order.setClientOrderId(UUID.randomUUID());
        order.setStatus(OrderStatus.CLOSED);
        order.setTillSessionId(till.id());
        order.setOrderNo("TEST-002");
        order.setOpenedAt(Instant.now());
        orderRepository.save(order);

        // Close with declared cash = 60000 (no cash payments on order, so expected = float only = 50000)
        // Variance = 60000 - 50000 = 10000
        CloseTillRequest closeReq = new CloseTillRequest(60000L, "Drawer over by 100 — customer overpaid tip");
        TillSessionDto closed = tillService.closeTill(till.id(), closeReq);

        assertThat(closed.status().name()).isEqualTo("CLOSED");
        assertThat(closed.expectedClosingPaisa()).isEqualTo(50000L);
        assertThat(closed.declaredClosingPaisa()).isEqualTo(60000L);
        assertThat(closed.variancePaisa()).isEqualTo(10000L);
        assertThat(closed.note()).isEqualTo("Drawer over by 100 — customer overpaid tip");
        assertThat(closed.reviewStatus().name()).isEqualTo("PENDING_REVIEW");

        long tillClosedCount = outboxRepository.findAll().stream()
                .filter(e -> "TILL_CLOSED".equals(e.getEventType()))
                .count();
        assertThat(tillClosedCount).isEqualTo(1);
    }

    @Test
    void createOrder_withNoOpenTill_isAllowed_andLeavesTillUnbound() {
        // INVERTED BY 13-16 (D-30). This used to assert that an order was NOT creatable without an
        // open till. That guard made the WAITER role unusable — a waiter holds no till by design,
        // so 13-02's correctly-granted waiter was refused here — while not actually establishing
        // the invariant it claimed, since it only fired when a userId was present and every path
        // without one already produced a null till.
        //
        // The requirement moved to where the cash physically moves: PaymentServiceImpl refuses a
        // CASH tender without an OPEN till for the paying user. That is STRICTER than what this
        // test protected, because a cash payment against a null-till order used to be accepted
        // outright — see CashPaymentRequiresTillIT. What must hold here is only that creation
        // leaves the till unbound rather than binding something arbitrary.
        OrderDto created = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 2, null, null));

        Order persisted = orderRepository.findById(created.id()).orElseThrow();
        assertThat(persisted.getTillSessionId()).isNull();
        assertThat(persisted.getCashierId()).isEqualTo(cashierId);
    }

    /**
     * {@code createOrder} binds the caller's OPEN till and cashier to the row — that is this
     * test's subject and it is unchanged.
     *
     * <p>What changed is the second half. This used to end
     * {@code …_blocksClose} and assert that the bare {@code createOrder} above — a DRAFT shell
     * with no order number, no lines, no total and no payment — held the drawer open. B2 measured
     * what that meant in service: five such shells on the seeded cashier's till, invisible to
     * Order Management (its default listing excludes DRAFT and the "Draft" chip filters that same
     * listing), refusing every cash-up with "Settle, serve, or void them before closing" —
     * three operations none of which can be performed on a row with no lines and no number, by
     * any persona, manager included.
     *
     * <p>So the assertion is corrected rather than deleted, and it now pins BOTH directions: the
     * shell does not block, and the same order blocks the moment a line lands on it. See
     * {@code TillCloseDraftShellIT} for the fuller treatment.
     */
    @Test
    void closeTill_withOrderCreatedViaOrderService_linksTillSessionAndCashier() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 50000L));

        OrderDto created = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.DINE_IN, null, 2, null, null));

        Order persisted = orderRepository.findById(created.id()).orElseThrow();
        assertThat(persisted.getTillSessionId()).isEqualTo(till.id());
        assertThat(persisted.getCashierId()).isEqualTo(cashierId);
        assertThat(persisted.getStatus()).isEqualTo(OrderStatus.DRAFT);
        assertThat(persisted.getOrderNo()).isNull();

        // A line lands: now it is a check, and it holds the drawer open.
        orderService.addItem(created.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        assertThat(orderRepository.findById(created.id()).orElseThrow().getStatus())
                .isEqualTo(OrderStatus.OPEN);
        assertThatThrownBy(() -> tillService.closeTill(till.id(), new CloseTillRequest(50000L, null)))
                .isInstanceOf(PosExceptions.TillHasOpenOrdersException.class);

        // ...and once it is voided, the drawer closes. (The void's own authorization is decided by
        // the REAL pos.rego in VoidOwnOrderIT; here it is stubbed because the subject is the till
        // guard, not the policy.)
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        orderService.voidOrder(created.id(), new VoidOrderRequest("Guest left"),
                UUID.randomUUID().toString());
        TillSessionDto closed = tillService.closeTill(till.id(), new CloseTillRequest(50000L, null));
        assertThat(closed.status().name()).isEqualTo("CLOSED");
    }
}
