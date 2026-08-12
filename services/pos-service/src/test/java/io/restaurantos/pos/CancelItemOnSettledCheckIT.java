package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderItemStatus;
import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.RefundRequest;
import io.restaurantos.pos.dto.VoidOrderRequest;
import io.restaurantos.pos.feign.FinancePeriodClient;
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
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * A settled check does not get its money restated by a line cancel.
 *
 * <p><b>The defect.</b> {@code OrderServiceImpl.cancelItem} was the only order-mutating method on
 * that class with no terminal-status guard. It refused a line whose own {@code itemStatus} was
 * {@code SERVED} and nothing else — it guarded the ITEM state machine and never the ORDER one —
 * then fell through to {@code recomputeOrderTotals} + {@code save} whatever the check's status. Its
 * siblings all guard: {@code addItem}, {@code updateInstructions} and {@code assignTable} refuse on
 * {@code isTerminal}, {@code removeItem} demands OPEN, and {@code applyDiscount} goes through
 * {@code assertDiscountable}. {@code OrderController} gates the route on {@code pos.order.update}
 * with no state filter, so nothing upstream made up the difference.
 *
 * <p><b>The two lines that got through</b>, one per test below:
 * <ul>
 *   <li>a still-unserved line on a VOIDED check — {@code voidOrder} refuses only on recorded
 *       payments and never requires the lines be SERVED, so a PENDING/SENT/READY line outlives
 *       the void; and</li>
 *   <li>an already-CANCELLED line on a CLOSED check — a cancelled line is excluded from the
 *       all-lines-SERVED close condition, so it is still CANCELLED afterwards and re-cancelling
 *       it passes the SERVED check, changes no status, and saves regardless.</li>
 * </ul>
 *
 * <p><b>Why it is not a harmless re-save.</b> Since V27 the recompute reads the tenant's
 * {@code TaxBase} and re-derives every line's tax from the discounted base, so what it writes back
 * can differ from the figures the check was settled at — materially, not by a paisa of rounding.
 * The ORDER_CLOSED event has already been published by then and the ClickHouse
 * {@code sales_order_facts} row built from it is frozen, so {@code DailyTakingsService} and
 * {@code TransactionRegisterRepository} (which read pos_db live) would move while
 * {@code FbrTaxSummaryService} (which reads the facts) would not — two systems of record
 * disagreeing about one historical order. Neither path re-checks the finance period lock (only
 * {@code performClose} calls {@code assertPeriodOpen}) and neither is idempotency-gated, so the
 * restatement left no audit trail to reconcile from.
 *
 * <p><b>Why the menu items are taxed at 16%.</b> Most POS fixtures price at {@code 0.00}, which
 * would make every "the money did not move" assertion below pass whether the guard exists or not:
 * the V27 recompute short-circuits a zero-rated line to zero tax, so there is no figure for the
 * bug to disturb. A real rate is what makes these assertions load-bearing.
 *
 * <p>Driven at the SERVICE seam rather than over MVC on purpose — the guard belongs to the domain,
 * and {@code cancelItem} is reachable without the controller (offline-sync replay, ITs), which is
 * the same reason {@code updateInstructions} enforces its own limits server-side.
 */
class CancelItemOnSettledCheckIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired RefundService refundService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID cashierId;
    UUID nihariId;
    UUID waterId;

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

        nihariId = saveMenuItem(cat, "Nihari", 45000L);
        waterId = saveMenuItem(cat, "Mineral Water", 8000L);

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
        when(opaClient.evaluate(any(), any())).thenReturn(new OpaDecision(true));

        setSecurityContext();
        openTillForCashier(branchId);
    }

    private UUID saveMenuItem(MenuCategory cat, String name, long pricePaisa) {
        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName(name);
        item.setBasePricePaisa(pricePaisa);
        item.setTaxRatePct(new BigDecimal("16.00"));
        return menuItemRepository.save(item).getId();
    }

    /**
     * {@code voidOrder} and {@code refund} both go through {@link
     * io.restaurantos.pos.authz.PosAuthorizationService}, which builds its OpaInput from the
     * claims in the SecurityContext — so the context has to be populated even though
     * {@code opaClient} is stubbed to allow. {@code approval_limit_paisa} is what the refund
     * rego reads.
     */
    private void setSecurityContext() {
        List<String> permissions = List.of(
                "pos.order.update", "pos.order.void.own", "pos.order.void.any",
                "pos.order.refund", "pos.order.view");
        JwtClaims claims = new JwtClaims(
                cashierId, tenantId, branchId,
                List.of("MANAGER"), permissions, Map.of("approval_limit_paisa", 30000000L), null);
        SecurityContextHolder.getContext().setAuthentication(
                new UsernamePasswordAuthenticationToken(claims, null,
                        permissions.stream().map(SimpleGrantedAuthority::new).toList()));
    }

    private OrderDto orderWithNihariAndWater() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 2, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(nihariId, branchId, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(waterId, branchId, 2, null, null));
        return orderService.getOrder(order.id(), branchId);
    }

    private UUID lineFor(OrderDto order, UUID menuItemId) {
        return order.items().stream()
                .filter(i -> i.menuItemId().equals(menuItemId))
                .findFirst().orElseThrow().id();
    }

    /**
     * Every figure the guest was billed on, and the one the ClickHouse fact row was built from.
     * Asserted as a group because the failure mode is a restatement, not a single field moving.
     */
    private void assertMoneyUnmoved(OrderDto before, String context) {
        OrderDto after = orderService.getOrder(before.id(), branchId);
        assertThat(after.subtotalPaisa()).as("%s — subtotal", context).isEqualTo(before.subtotalPaisa());
        assertThat(after.discountPaisa()).as("%s — discount", context).isEqualTo(before.discountPaisa());
        assertThat(after.taxPaisa()).as("%s — tax", context).isEqualTo(before.taxPaisa());
        assertThat(after.totalPaisa()).as("%s — total", context).isEqualTo(before.totalPaisa());
        assertThat(after.status()).as("%s — status", context).isEqualTo(before.status());
    }

    // ══ 1. A voided check ════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a voided check refuses to cancel a line the kitchen never served")
    void voidedCheck_refusesCancelOfAStillUnservedLine() {
        OrderDto order = orderWithNihariAndWater();
        OrderDto fired = orderService.sendToKds(order.id(), null);
        UUID waterLineId = lineFor(fired, waterId);

        orderService.voidOrder(order.id(),
                new VoidOrderRequest("Guest walked out before service"), UUID.randomUUID().toString());

        OrderDto voided = orderService.getOrder(order.id(), branchId);
        assertThat(voided.status()).isEqualTo(OrderStatus.VOIDED);
        assertThat(voided.items().stream().map(OrderDto.OrderItemDto::kdsStatus))
                .as("the void left the lines where they were — none of them is SERVED, "
                        + "which is exactly what the old item-only guard waved through")
                .doesNotContain(OrderItemStatus.SERVED);

        assertThatThrownBy(() -> orderService.cancelItem(order.id(), waterLineId))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("voided");

        assertMoneyUnmoved(voided, "voided check");
    }

    // ══ 2. A closed check ════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a closed check refuses to re-cancel a line that was already cancelled before close")
    void closedCheck_refusesReCancelOfAnAlreadyCancelledLine() {
        OrderDto order = orderWithNihariAndWater();
        OrderDto fired = orderService.sendToKds(order.id(), null);
        UUID waterLineId = lineFor(fired, waterId);

        // Legal while the check is live: the water is cancelled before anything is settled.
        orderService.cancelItem(order.id(), waterLineId);

        // closeViaServeAndPay serves every non-CANCELLED line and tenders the full total, so the
        // check closes still carrying the cancelled water line — the precondition for the re-cancel.
        OrderDto closed = closeViaServeAndPay(orderService, paymentService,
                orderService.getOrder(order.id(), branchId), branchId);
        assertThat(closed.status()).isEqualTo(OrderStatus.CLOSED);
        assertThat(closed.taxPaisa())
                .as("a real tax figure, or the restatement assertion below proves nothing")
                .isGreaterThan(0L);

        assertThatThrownBy(() -> orderService.cancelItem(order.id(), waterLineId))
                .as("the line is CANCELLED, not SERVED, so the old guard let it through to a save")
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("closed");

        assertMoneyUnmoved(closed, "closed check");
    }

    // ══ 3. A refunded check ══════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("a refunded check refuses the cancel too — the third terminal status")
    void refundedCheck_refusesCancel() {
        OrderDto order = orderWithNihariAndWater();
        OrderDto fired = orderService.sendToKds(order.id(), null);
        UUID waterLineId = lineFor(fired, waterId);
        orderService.cancelItem(order.id(), waterLineId);

        OrderDto closed = closeViaServeAndPay(orderService, paymentService,
                orderService.getOrder(order.id(), branchId), branchId);
        refundService.refund(closed.id(),
                new RefundRequest(closed.totalPaisa(), "Dish sent back cold", "FULL"),
                UUID.randomUUID().toString());

        OrderDto refunded = orderService.getOrder(order.id(), branchId);
        assertThat(refunded.status()).isEqualTo(OrderStatus.REFUNDED);

        assertThatThrownBy(() -> orderService.cancelItem(order.id(), waterLineId))
                .isInstanceOf(StateInvalidException.class)
                .hasMessageContaining("refunded");

        assertMoneyUnmoved(refunded, "refunded check");
    }

    // ══ 4. The guard did not close the live path ═════════════════════════════════════════════

    @Test
    @DisplayName("a live check still cancels a line, and the total drops by what the line was worth")
    void liveCheck_stillCancelsAndTheTotalDrops() {
        OrderDto order = orderWithNihariAndWater();
        OrderDto fired = orderService.sendToKds(order.id(), null);
        UUID waterLineId = lineFor(fired, waterId);
        long totalBefore = fired.totalPaisa();

        assertThatCode(() -> orderService.cancelItem(order.id(), waterLineId))
                .doesNotThrowAnyException();

        OrderDto after = orderService.getOrder(order.id(), branchId);
        assertThat(after.totalPaisa())
                .as("the cancelled line stopped counting toward the amount due")
                .isLessThan(totalBefore);
        assertThat(after.items().stream()
                .filter(i -> i.id().equals(waterLineId)).findFirst().orElseThrow().kdsStatus())
                .isEqualTo(OrderItemStatus.CANCELLED);
    }
}
