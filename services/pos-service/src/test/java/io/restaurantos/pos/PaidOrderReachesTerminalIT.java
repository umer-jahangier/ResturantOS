package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.DerivedOrderStatus;
import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.OrderType;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.enums.TableStatus;
import io.restaurantos.pos.domain.model.DiningTable;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.RefundRequest;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.DiningTableRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.authz.OpaDecision;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.exception.StateInvalidException;
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
import static org.mockito.Mockito.when;

/**
 * S0-06 — <b>a paid order must reach a terminal state.</b>
 *
 * <p>The defect this pins down was not that closing was impossible: it was that the ONLY route to
 * CLOSED ran through {@code markItemServed} once per line, from two controls
 * ({@code order-panel.tsx}, {@code order-table-detail-drawer.tsx}) that a cashier never passes
 * after taking the money. So the normal end state of a settled check was
 * {@code SENT_TO_KDS / PAID} — open, and therefore still offering the destructive button while
 * refusing the corrective one.
 *
 * <p>These tests assert the <b>consequences an operator can see</b>, not the internals: after the
 * one settlement-screen operation the order is CLOSED, a void is refused, and a refund is
 * accepted. They are written against {@code OrderService}/{@code RefundService} directly — the
 * controllers' exact delegates — which is this suite's established convention (see
 * {@code SettlementSemanticsIT}).
 */
class PaidOrderReachesTerminalIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired RefundService refundService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired DiningTableRepository tableRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID menuItemId;
    static final long ITEM_PRICE_PAISA = 49900L;

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
        item.setName("Audit Item");
        item.setBasePricePaisa(ITEM_PRICE_PAISA);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
        // Refund and void both run through OPA. Allow every rule so these tests measure the
        // STATE gate (CLOSED vs not), which is the whole of S0-06 — never the policy engine.
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));
        setSecurityContext(cashierId, List.of("pos.order.refund", "pos.order.void.any"));

        openTillForCashier(branchId);
    }

    private void setSecurityContext(UUID userId, List<String> permissions) {
        JwtClaims claims = new JwtClaims(
                userId, tenantId, branchId, List.of("CASHIER"), permissions, Map.of(), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null, List.of()));
    }

    private UUID seedTable() {
        DiningTable table = new DiningTable();
        table.setTenantId(tenantId);
        table.setBranchId(branchId);
        table.setTableNumber("T-" + UUID.randomUUID().toString().substring(0, 8));
        table.setCapacity(4);
        table.setStatus(TableStatus.AVAILABLE);
        return tableRepository.save(table).getId();
    }

    /** Rings two lines, fires them, and settles the whole bill in CASH — the DONE-MEANS path. */
    private OrderDto ringFireAndSettle(UUID tableId, OrderType type) {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), type, tableId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id(), null);

        long total = orderService.getOrder(order.id(), branchId).totalPaisa();
        paymentService.recordPayment(order.id(), PaymentMethod.CASH, total, null);
        return orderService.getOrder(order.id(), branchId);
    }

    /**
     * The baseline the register recorded, restated as an assertion so it cannot silently change:
     * a two-line fired order, paid in full, is NOT closed by the payment alone. This is correct
     * behaviour (the food has not been handed over yet) and it is exactly why an explicit
     * operator step has to exist.
     */
    @Test
    void fullPaymentAlone_leavesTheCheckOpenAtSentToKds() {
        OrderDto paid = ringFireAndSettle(null, OrderType.TAKEAWAY);

        assertThat(paid.status()).isEqualTo(OrderStatus.SENT_TO_KDS);
        assertThat(paid.derivedStatus()).isEqualTo(DerivedOrderStatus.IN_PROGRESS);
    }

    /**
     * THE GAP. One operation, reachable from the settlement screen, must take a fully-paid
     * dine-in check to CLOSED — every line SERVED, the order terminal, without the cashier
     * hunting for a per-line control on a screen they are not on.
     */
    @Test
    void oneSettlementStep_closesAFullyPaidDineInCheck() {
        UUID tableId = seedTable();
        OrderDto paid = ringFireAndSettle(tableId, OrderType.DINE_IN);
        assertThat(paid.status()).isNotEqualTo(OrderStatus.CLOSED);

        OrderDto closed = orderService.markAllItemsServed(paid.id());

        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);
        assertThat(closed.derivedStatus()).isEqualTo(DerivedOrderStatus.SERVED);
        assertThat(closed.items()).allSatisfy(
                i -> assertThat(i.kdsStatus()).isEqualTo(OrderItemStatus.SERVED));
        // Read back over a fresh load, not the returned DTO — a terminal state that only exists
        // in the response object is the shape this whole repair is about.
        assertThat(orderService.getOrder(paid.id(), branchId).status()).isEqualTo(OrderStatus.CLOSED);
    }

    /** The same, for a takeaway check that has no table at all. */
    @Test
    void oneSettlementStep_closesAFullyPaidTakeawayCheck() {
        OrderDto paid = ringFireAndSettle(null, OrderType.TAKEAWAY);
        assertThat(paid.tableId()).isNull();

        OrderDto closed = orderService.markAllItemsServed(paid.id());

        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);
        assertThat(orderService.getOrder(paid.id(), branchId).status()).isEqualTo(OrderStatus.CLOSED);
    }

    /**
     * The point of closing: the destructive button goes away and the corrective one arrives.
     * {@code OrderStateMachine} allows no transition out of CLOSED except REFUNDED, and
     * {@code RefundServiceImpl} accepts only CLOSED — so before this fix a settled check sat in
     * the one state where void worked and refund did not.
     */
    @Test
    void afterClosing_voidIsRefused_andRefundIsAccepted() {
        OrderDto paid = ringFireAndSettle(null, OrderType.TAKEAWAY);
        OrderDto closed = orderService.markAllItemsServed(paid.id());
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);

        assertThatThrownBy(() -> orderService.voidOrder(
                closed.id(),
                new io.restaurantos.pos.dto.VoidOrderRequest("audit — must be refused"),
                UUID.randomUUID().toString()))
                .isInstanceOf(RuntimeException.class);
        assertThat(orderService.getOrder(closed.id(), branchId).status())
                .isEqualTo(OrderStatus.CLOSED);

        OrderDto refunded = refundService.refund(
                closed.id(),
                new RefundRequest(closed.totalPaisa(), "audit — full refund", "FULL"),
                UUID.randomUUID().toString());

        assertThat(refunded.status()).isEqualTo(OrderStatus.REFUNDED);
    }

    /**
     * A line that was never fired cannot have been served. Refusing loudly is deliberate: the
     * failure mode being repaired is a control that appears to work and changes nothing, so a
     * silent partial success here would recreate it one level down.
     */
    @Test
    void refusesWhenALineWasNeverFiredToTheKitchen() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.TAKEAWAY, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id(), null);
        // A second line rung after the fire — PENDING, never sent.
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        assertThatThrownBy(() -> orderService.markAllItemsServed(order.id()))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("not been fired");

        assertThat(orderService.getOrder(order.id(), branchId).status())
                .isNotEqualTo(OrderStatus.CLOSED);
    }

    /**
     * Serving without money leaves the check open — {@code markAllItemsServed} must not become a
     * second close path that skips the Paid half of the Paid-AND-Served rule.
     */
    @Test
    void servingAnUnpaidCheck_doesNotCloseIt() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), OrderType.TAKEAWAY, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        orderService.sendToKds(order.id(), null);

        OrderDto served = orderService.markAllItemsServed(order.id());

        assertThat(served.derivedStatus()).isEqualTo(DerivedOrderStatus.SERVED);
        assertThat(served.status()).isNotEqualTo(OrderStatus.CLOSED);
        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType())).count()).isZero();
    }

    /**
     * A double-tap on the button (or two cashiers on two terminals) must not throw and must not
     * close twice — {@code performClose} publishes ORDER_CLOSED exactly once, and finance posts
     * revenue off that event. CLOSED is the state this operation exists to reach, so reaching it
     * again is success; a 409 here would paint an error under a button that had just worked.
     */
    @Test
    void secondCallIsARetry_notADoubleClose() {
        OrderDto paid = ringFireAndSettle(null, OrderType.TAKEAWAY);
        orderService.markAllItemsServed(paid.id());

        OrderDto again = orderService.markAllItemsServed(paid.id());

        assertThat(again.status()).isEqualTo(OrderStatus.CLOSED);
        assertThat(outboxRepository.findAll().stream()
                .filter(e -> "ORDER_CLOSED".equals(e.getEventType())).count()).isEqualTo(1);
    }
}
