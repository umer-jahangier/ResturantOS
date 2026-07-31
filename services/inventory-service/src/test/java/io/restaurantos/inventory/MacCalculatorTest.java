package io.restaurantos.inventory;

import io.restaurantos.inventory.service.MacCalculator;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/** Plain unit test — MacCalculator is a pure static utility, no Spring context needed. */
class MacCalculatorTest {

    @Test
    void recompute_weightedAverage_roundsHalfUp() {
        // (10*500 + 10*700) / 20 = 600
        long result = MacCalculator.recomputeAvgCostPaisa(
                BigDecimal.valueOf(10), 500L, BigDecimal.valueOf(10), 700L);
        assertThat(result).isEqualTo(600L);
    }

    @Test
    void recompute_fractionalQuotient_roundsHalfUpNeverFloor() {
        // (1*1 + 1*2) / 2 = 1.5 -> HALF_UP -> 2 (FLOOR would incorrectly yield 1)
        long result = MacCalculator.recomputeAvgCostPaisa(
                BigDecimal.ONE, 1L, BigDecimal.ONE, 2L);
        assertThat(result).isEqualTo(2L);
    }

    @Test
    void recompute_ontoEmptyStock_returnsReceiptUnitCost() {
        long result = MacCalculator.recomputeAvgCostPaisa(
                BigDecimal.ZERO, 0L, BigDecimal.valueOf(5), 350L);
        assertThat(result).isEqualTo(350L);
    }

    @Test
    void recompute_ontoNegativeOnHand_resetsToReceiptUnitCost() {
        // D-02 oversell policy: oldQty <= 0 -> reset to the receipt's own unit cost, not a blend.
        long result = MacCalculator.recomputeAvgCostPaisa(
                BigDecimal.valueOf(-2), 400L, BigDecimal.valueOf(10), 600L);
        assertThat(result).isEqualTo(600L);
    }
}
