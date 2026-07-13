package io.restaurantos.pos;

import io.restaurantos.pos.domain.enums.OrderStatus;
import io.restaurantos.pos.domain.enums.PaymentStatus;
import io.restaurantos.pos.service.PaymentStatusDerivationService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Unit test for the pure {@link PaymentStatusDerivationService} — no Spring context, mirrors
 * {@code OrderStatusDerivationService}'s test shape. Covers the 5 behavior rows from
 * 07.3-01-PLAN.md Task 1.
 */
class PaymentStatusDerivationTest {

    private final PaymentStatusDerivationService service = new PaymentStatusDerivationService();

    @Test
    void zeroPaid_isUnpaid() {
        assertThat(service.derive(0, 5000, OrderStatus.OPEN)).isEqualTo(PaymentStatus.UNPAID);
    }

    @Test
    void partialPaid_isPartiallyPaid() {
        assertThat(service.derive(3000, 5000, OrderStatus.OPEN)).isEqualTo(PaymentStatus.PARTIALLY_PAID);
    }

    @Test
    void exactPaid_isPaid() {
        assertThat(service.derive(5000, 5000, OrderStatus.SERVED)).isEqualTo(PaymentStatus.PAID);
    }

    @Test
    void overpay_clampsToPaid() {
        assertThat(service.derive(6000, 5000, OrderStatus.OPEN)).isEqualTo(PaymentStatus.PAID);
    }

    @Test
    void refundedSettlementStatus_winsOverSum() {
        assertThat(service.derive(5000, 5000, OrderStatus.REFUNDED)).isEqualTo(PaymentStatus.REFUNDED);
        assertThat(service.derive(0, 5000, OrderStatus.REFUNDED)).isEqualTo(PaymentStatus.REFUNDED);
    }
}
