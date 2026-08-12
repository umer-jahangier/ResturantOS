package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.OrderRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.TillService;
import io.restaurantos.shared.event.OutboxRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

import java.math.BigDecimal;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A cash-up must not be held open by a row nobody can act on.
 *
 * <h2>The dead end</h2>
 *
 * <p>{@code closeTill} refused on any order whose status was not CLOSED/VOIDED/REFUNDED, and
 * {@code DRAFT} was in that set. A DRAFT order is {@code createOrder} before the first
 * {@code addItem}: no order number (the number is minted on the DRAFT -> OPEN transition), no
 * lines, no total, no payment — measured across every tenant in the live database on 2026-08-12,
 * 24 DRAFT rows, all four counts zero. Order Management's default listing also excludes DRAFT and
 * its "Draft" chip filters that same listing client-side, so those rows appear on no screen.
 *
 * <p>The result was a refusal telling the cashier to "Settle, serve, or void them before closing"
 * about orders that have nothing to settle, nothing to serve, and no route to a void button.
 * Five of them sat on the seeded drawer. No persona could clear them — this was never a permission
 * problem, so a manager was no help either.
 *
 * <p><b>Falsification.</b> Put {@code OrderStatus.DRAFT} back into the blocking set in
 * {@code TillServiceImpl} and {@link #aDraftShellDoesNotHoldTheDrawerOpen} fails with
 * {@code TillHasOpenOrdersException}. Confirmed by running it against the unfixed service.
 *
 * <p>{@link #aRealUnsettledCheckStillHoldsTheDrawerOpen} is the other half and matters just as
 * much: this change must not turn the guard off. A rung check still blocks.
 */
class TillCloseDraftShellIT extends PosTestBase {

    @Autowired TillService tillService;
    @Autowired OrderService orderService;
    @Autowired OrderRepository orderRepository;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
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
        item.setName("Seekh Kebab");
        item.setBasePricePaisa(45000L);
        item.setTaxRatePct(new BigDecimal("0.00"));
        menuItemId = menuItemRepository.save(item).getId();
    }

    /** {@code createOrder} with no {@code addItem} — the only way a DRAFT row exists. */
    private OrderDto draftShell() {
        OrderDto draft = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        var row = orderRepository.findById(draft.id()).orElseThrow();
        // The premise of the whole change, asserted rather than assumed: a DRAFT holds nothing.
        assertThat(row.getStatus()).isEqualTo(OrderStatus.DRAFT);
        assertThat(row.getOrderNo()).isNull();
        assertThat(row.getTotalPaisa()).isZero();
        return draft;
    }

    @Test
    void aDraftShellDoesNotHoldTheDrawerOpen() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 500000L));
        draftShell();

        TillSessionDto closed = tillService.closeTill(
                till.id(), new CloseTillRequest(500000L, "Nothing rung, nothing taken"));

        assertThat(closed.status().name()).isEqualTo("CLOSED");
        assertThat(closed.expectedClosingPaisa()).isEqualTo(500000L);
        assertThat(closed.declaredClosingPaisa()).isEqualTo(500000L);
    }

    @Test
    void aRealUnsettledCheckStillHoldsTheDrawerOpen() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 500000L));
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        assertThat(orderRepository.findById(order.id()).orElseThrow().getStatus())
                .isEqualTo(OrderStatus.OPEN);

        assertThatThrownBy(() -> tillService.closeTill(
                till.id(), new CloseTillRequest(500000L, "Trying to leave early")))
                .isInstanceOf(PosExceptions.TillHasOpenOrdersException.class);
    }

    /** A drawer carrying both still refuses — the shell must not mask the real check. */
    @Test
    void aDraftShellDoesNotMaskARealOpenCheck() {
        TillSessionDto till = tillService.openTill(new OpenTillRequest(branchId, 500000L));
        draftShell();
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(),
                new AddOrderItemRequest(menuItemId, branchId, 1, null, null));

        assertThatThrownBy(() -> tillService.closeTill(
                till.id(), new CloseTillRequest(500000L, "Still owes food")))
                .isInstanceOf(PosExceptions.TillHasOpenOrdersException.class);
    }
}
