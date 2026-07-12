package io.restaurantos.pos;

import io.restaurantos.pos.exception.PosExceptions;
import io.restaurantos.pos.service.SplitTenderCalculator;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Unit tests for SplitTenderCalculator — pure arithmetic, no Spring context.
 */
class SplitTenderCalculatorUnitTest {

    private final SplitTenderCalculator calculator = new SplitTenderCalculator();

    // ── equalSplit ────────────────────────────────────────────────────────────

    @Test
    void equalSplit_1000_by3_remainderGoesToFirst() {
        List<Long> shares = calculator.equalSplit(1000L, 3);
        assertThat(shares).hasSize(3);
        assertThat(shares.get(0)).isEqualTo(334L); // 333 + 1 remainder
        assertThat(shares.get(1)).isEqualTo(333L);
        assertThat(shares.get(2)).isEqualTo(333L);
        assertThat(shares.stream().mapToLong(Long::longValue).sum()).isEqualTo(1000L);
    }

    @Test
    void equalSplit_zero_returnAllZeros() {
        List<Long> shares = calculator.equalSplit(0L, 3);
        assertThat(shares).containsOnly(0L).hasSize(3);
    }

    @Test
    void equalSplit_divisible_noRemainder() {
        List<Long> shares = calculator.equalSplit(900L, 3);
        assertThat(shares).containsOnly(300L).hasSize(3);
    }

    @Test
    void equalSplit_single_diner() {
        List<Long> shares = calculator.equalSplit(555L, 1);
        assertThat(shares).containsExactly(555L);
    }

    @Test
    void equalSplit_zeroDiners_throws() {
        assertThatThrownBy(() -> calculator.equalSplit(100L, 0))
                .isInstanceOf(IllegalArgumentException.class);
    }

    // ── validateExact ─────────────────────────────────────────────────────────

    @Test
    void validateExact_sumsMatch_noException() {
        var payments = List.of(
                new SplitTenderCalculator.PaymentEntry("CASH", 500L, null),
                new SplitTenderCalculator.PaymentEntry("CARD", 500L, "REF-001")
        );
        calculator.validateExact(payments, 1000L);
    }

    @Test
    void validateExact_sumLow_throwsPaymentMismatch() {
        var payments = List.of(
                new SplitTenderCalculator.PaymentEntry("CASH", 400L, null)
        );
        assertThatThrownBy(() -> calculator.validateExact(payments, 1000L))
                .isInstanceOf(PosExceptions.PaymentMismatchException.class)
                .hasMessageContaining("1000");
    }

    @Test
    void validateExact_sumHigh_throwsPaymentMismatch() {
        var payments = List.of(
                new SplitTenderCalculator.PaymentEntry("CASH", 1500L, null)
        );
        assertThatThrownBy(() -> calculator.validateExact(payments, 1000L))
                .isInstanceOf(PosExceptions.PaymentMismatchException.class);
    }

    @Test
    void validateExact_exactlyZeroTotal_withZeroPayments() {
        var payments = List.of(
                new SplitTenderCalculator.PaymentEntry("CASH", 0L, null)
        );
        calculator.validateExact(payments, 0L);
    }
}
