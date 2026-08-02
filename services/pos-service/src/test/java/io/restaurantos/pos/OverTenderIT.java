package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.OrderPaymentDto;
import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.feign.FinancePeriodClient;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.PaymentService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.event.OutboxRepository;
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
 * Over-tender is a cash-drawer fact, never a ledger fact.
 *
 * <p><b>The defect this pins.</b> {@code recordPayment} accepted any amount with no cap, and
 * {@code PaymentStatusDerivationService} documented the consequence as intended ("overpay clamps to
 * PAID"). ORDER_CLOSED then carried the tendered amount, finance debited it against credits of
 * subtotal − discount + tax + serviceCharge, and the deferred balance trigger rejected the entry.
 * Reproduced live on 2026-08-01 against the running stack:
 *
 * <pre>
 *   pay 129300 (total 124300) -> 200, order CLOSED
 *   ERROR: JE_UNBALANCED: entry 51f1a4f1-... DR=129300 CR=124300
 * </pre>
 *
 * <p>The message did not dead-letter — it was requeued with no backoff and no cap, still climbing
 * past 2,371 failed attempts at ~17/second, while the order sat CLOSED with a posted COGS entry and
 * no revenue entry. Half-posted books, and an unbounded hot loop, from an ordinary cash payment.
 */
class OverTenderIT extends PosTestBase {

    @Autowired OrderService orderService;
    @Autowired PaymentService paymentService;
    @Autowired OutboxRepository outboxRepository;
    @Autowired MenuItemRepository menuItemRepository;
    @Autowired MenuCategoryRepository menuCategoryRepository;
    @Autowired TenantContext tenantContext;

    UUID tenantId;
    UUID branchId;
    UUID menuItemId;
    static final long ITEM_PRICE_PAISA = 20_000L;

    @BeforeEach
    void setUp() {
        outboxRepository.deleteAll();
        tenantId = UUID.randomUUID();
        branchId = UUID.randomUUID();
        tenantContext.set(tenantId, branchId, null, null);

        MenuCategory cat = new MenuCategory();
        cat.setTenantId(tenantId);
        cat.setName("Mains-" + UUID.randomUUID());
        cat.setSortOrder(1);
        cat = menuCategoryRepository.save(cat);

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(cat);
        item.setName("Karahi");
        item.setBasePricePaisa(ITEM_PRICE_PAISA);
        item.setTaxRatePct(new BigDecimal("0.00"));
        item = menuItemRepository.save(item);
        menuItemId = item.getId();

        when(financePeriodClient.getPeriodStatus(any(), any(), any()))
                .thenReturn(new ApiResponse<>(
                        new FinancePeriodClient.PeriodStatusDto(UUID.randomUUID(), "OPEN", 2026, 6),
                        null, List.of()));
    }

    private OrderDto createServedOrder() {
        OrderDto order = orderService.createOrder(
                new CreateOrderRequest(branchId, UUID.randomUUID(), null, null, 1, null, null));
        orderService.addItem(order.id(), new AddOrderItemRequest(menuItemId, branchId, 1, null, null));
        OrderDto sent = orderService.sendToKds(order.id(), null);
        return orderService.markItemServed(sent.id(), sent.items().get(0).id());
    }

    @Test
    void cashOverTender_appliesOnlyTheBalance_andReturnsTheRestAsChange() {
        OrderDto served = createServedOrder();
        long overTender = ITEM_PRICE_PAISA + 5_000L;

        long applied = paymentService.recordPayment(
                served.id(), PaymentMethod.CASH, overTender, null);

        // The ledger only ever sees the applied amount.
        assertThat(applied)
                .as("applied total must equal the bill, not the tender")
                .isEqualTo(ITEM_PRICE_PAISA);

        List<OrderPaymentDto> payments = paymentService.listPayments(served.id());
        assertThat(payments).hasSize(1);
        assertThat(payments.get(0).amountPaisa()).isEqualTo(ITEM_PRICE_PAISA);
        assertThat(payments.get(0).tenderedPaisa()).isEqualTo(overTender);
        assertThat(payments.get(0).changePaisa()).isEqualTo(5_000L);

        // Paid AND served, so it closes — the point is that it closes with a BALANCEABLE payload.
        assertThat(orderService.getOrder(served.id(), branchId).status())
                .isEqualTo(OrderStatus.CLOSED);
    }

    /**
     * The invariant finance depends on, asserted directly: whatever the customer hands over, the
     * applied payments sum to exactly the order total, so debits equal credits.
     */
    @Test
    void appliedPaymentsAlwaysSumToOrderTotal() {
        OrderDto served = createServedOrder();
        paymentService.recordPayment(served.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA * 3, null);

        long appliedSum = paymentService.listPayments(served.id()).stream()
                .mapToLong(OrderPaymentDto::amountPaisa)
                .sum();

        assertThat(appliedSum).isEqualTo(orderService.getOrder(served.id(), branchId).totalPaisa());
    }

    /**
     * There is no drawer to give change from on a card, so an over-charge is an input error rather
     * than change. Silently applying less would leave the operator believing they charged the full
     * amount.
     */
    @Test
    void nonCashOverTender_isRejected() {
        OrderDto served = createServedOrder();

        assertThatThrownBy(() -> paymentService.recordPayment(
                served.id(), PaymentMethod.CARD, ITEM_PRICE_PAISA + 1, null))
                .isInstanceOf(PosExceptions.PaymentExceedsBalanceException.class)
                .hasMessageContaining("exceeds the outstanding balance");
    }

    /** Split tender: the second payment is capped at what is left, not at the full bill. */
    @Test
    void splitTender_secondPaymentIsCappedAtTheRemainder() {
        OrderDto served = createServedOrder();
        paymentService.recordPayment(served.id(), PaymentMethod.CARD, 15_000L, "card-1");

        long applied = paymentService.recordPayment(served.id(), PaymentMethod.CASH, 10_000L, "cash-1");

        assertThat(applied).isEqualTo(ITEM_PRICE_PAISA);
        List<OrderPaymentDto> payments = paymentService.listPayments(served.id());
        assertThat(payments).extracting(OrderPaymentDto::amountPaisa)
                .containsExactlyInAnyOrder(15_000L, 5_000L);
        assertThat(payments).filteredOn(p -> "CASH".equals(p.method()))
                .singleElement()
                .satisfies(p -> assertThat(p.changePaisa()).isEqualTo(5_000L));
    }

    /** POS-24: a settled bill cannot be charged twice. */
    @Test
    void payingAnAlreadySettledOrder_isRejected() {
        OrderDto served = createServedOrder();
        paymentService.recordPayment(served.id(), PaymentMethod.CASH, ITEM_PRICE_PAISA, null);

        // The order is CLOSED by now, so the terminal-status guard fires first — either way a
        // second charge is refused rather than silently over-applied.
        assertThatThrownBy(() -> paymentService.recordPayment(
                served.id(), PaymentMethod.CASH, 1_000L, null))
                .isInstanceOfAny(PosExceptions.OrderAlreadyPaidException.class,
                        io.restaurantos.shared.exception.StateInvalidException.class);
    }
}
