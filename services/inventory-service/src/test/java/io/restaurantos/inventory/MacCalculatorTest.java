package io.restaurantos.inventory;

import io.restaurantos.inventory.service.MacCalculator;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;

/** Plain unit test — MacCalculator is a pure static utility, no Spring context needed. */
class MacCalculatorTest {

    private static BigDecimal p(String v) {
        return new BigDecimal(v);
    }

    @Test
    void recompute_weightedAverage_roundsHalfUp() {
        // (10*500 + 10*700) / 20 = 600
        assertThat(MacCalculator.recomputeAvgCostPaisa(p("10"), p("500"), p("10"), p("700")))
                .isEqualByComparingTo("600");
    }

    @Test
    void recompute_ontoEmptyStock_returnsReceiptUnitCost() {
        assertThat(MacCalculator.recomputeAvgCostPaisa(BigDecimal.ZERO, BigDecimal.ZERO, p("5"), p("350")))
                .isEqualByComparingTo("350");
    }

    @Test
    void recompute_ontoNegativeOnHand_resetsToReceiptUnitCost() {
        // D-02 oversell policy: oldQty <= 0 -> reset to the receipt's own unit cost, not a blend.
        assertThat(MacCalculator.recomputeAvgCostPaisa(p("-2"), p("400"), p("10"), p("600")))
                .isEqualByComparingTo("600");
    }

    /**
     * The reason V12 widened these columns. A per-stock-unit cost is a RATE, and rounding a rate to
     * a whole paisa is not an ordinary rounding error — it is a systematic one, because every later
     * blend compounds it. PKR 62/kg is 6.2 paisa per gram; the old {@code long} pipeline stored 6.
     */
    @Test
    void recompute_keepsAFractionalRate_insteadOfRoundingItToWholePaisa() {
        assertThat(MacCalculator.recomputeAvgCostPaisa(BigDecimal.ZERO, BigDecimal.ZERO, p("1000"), p("6.2")))
                .as("6.2 paisa/g must survive; storing 6 mis-values the stock by 3.2%")
                .isEqualByComparingTo("6.2");
    }

    @Test
    void recompute_blendsTwoFractionalRates() {
        // (1000*6.2 + 1000*8.4) / 2000 = 7.3
        assertThat(MacCalculator.recomputeAvgCostPaisa(p("1000"), p("6.2"), p("1000"), p("8.4")))
                .isEqualByComparingTo("7.3");
    }

    /** A quotient finer than the stored scale still rounds — HALF_UP, never floor. */
    @Test
    void recompute_roundsHalfUpAtTheStoredScale() {
        // (1*1 + 2*2) / 3 = 1.66666... -> 1.6667 at scale 4
        assertThat(MacCalculator.recomputeAvgCostPaisa(p("1"), p("1"), p("2"), p("2")))
                .isEqualByComparingTo("1.6667");
    }

    @Test
    void recompute_toleratesNullsRatherThanThrowing() {
        assertThat(MacCalculator.recomputeAvgCostPaisa(BigDecimal.ZERO, null, p("5"), null))
                .isEqualByComparingTo("0");
    }

    /**
     * The rate→amount boundary. Money is integral: a quantity times a fractional rate rounds to
     * whole paisa exactly once, here, rather than the rate being pre-rounded at rest.
     */
    @Test
    void extendedCost_isWholePaisa_fromAFractionalRate() {
        // 10,000 g at 6.2 paisa/g = 62,000 paisa — the true value of a PKR 620 receipt.
        assertThat(MacCalculator.extendedCostPaisa(p("10000"), p("6.2"))).isEqualTo(62_000L);
    }

    @Test
    void extendedCost_roundsHalfUp() {
        assertThat(MacCalculator.extendedCostPaisa(p("3"), p("0.5"))).isEqualTo(2L);   // 1.5 -> 2
        assertThat(MacCalculator.extendedCostPaisa(p("1"), p("0.4"))).isZero();
    }

    @Test
    void extendedCost_ofNothing_isZero() {
        assertThat(MacCalculator.extendedCostPaisa(null, p("6.2"))).isZero();
        assertThat(MacCalculator.extendedCostPaisa(p("10"), null)).isZero();
    }
}
