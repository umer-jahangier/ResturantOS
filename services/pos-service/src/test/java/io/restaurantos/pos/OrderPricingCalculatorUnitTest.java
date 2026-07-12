package io.restaurantos.pos;

import io.restaurantos.pos.service.OrderPricingCalculator;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class OrderPricingCalculatorUnitTest {

    private OrderPricingCalculator calc;

    @BeforeEach
    void setUp() {
        calc = new OrderPricingCalculator();
    }

    @Test
    void discountGreaterThanSubtotalClampsToZeroLineTotal() {
        // line subtotal = 1000 paisa, discount request = 2000 paisa
        long subtotal = calc.lineSubtotal(1000L, List.of(), 1);
        long effectiveDiscount = calc.effectiveDiscount(2000L, subtotal);
        long net = calc.lineNet(subtotal, effectiveDiscount);

        assertThat(effectiveDiscount).isEqualTo(1000L);
        assertThat(net).isEqualTo(0L);
    }

    @Test
    void discountEqualToSubtotalProducesZeroNet() {
        long subtotal = calc.lineSubtotal(500L, List.of(), 2); // 1000
        long effectiveDiscount = calc.effectiveDiscount(1000L, subtotal);
        long net = calc.lineNet(subtotal, effectiveDiscount);

        assertThat(effectiveDiscount).isEqualTo(1000L);
        assertThat(net).isEqualTo(0L);
    }

    @Test
    void perLineTaxHalfUpRounding() {
        // net = 1000 paisa, 16% tax => 160 paisa exactly
        long tax = calc.perLineTax(1000L, BigDecimal.valueOf(16));
        assertThat(tax).isEqualTo(160L);
    }

    @Test
    void perLineTaxHalfUpFractionRounded() {
        // net = 1001 paisa, 16% tax = 160.16 => rounds HALF_UP to 160
        long tax = calc.perLineTax(1001L, BigDecimal.valueOf(16));
        assertThat(tax).isEqualTo(160L);
    }

    @Test
    void perLineTaxHalfUpFractionRoundsUp() {
        // net = 1003 paisa, 16% tax = 160.48 => rounds HALF_UP to 160
        long tax = calc.perLineTax(1003L, BigDecimal.valueOf(16));
        assertThat(tax).isEqualTo(160L);
    }

    @Test
    void perLineTaxExactHalfRoundsUp() {
        // 5 paisa net, 10% tax = 0.5 paisa, HALF_UP => 1
        long tax = calc.perLineTax(5L, BigDecimal.valueOf(10));
        assertThat(tax).isEqualTo(1L);
    }

    @Test
    void totalCompositionIsCorrect() {
        long subtotal = calc.lineSubtotal(1000L, List.of(), 1);
        long discount = calc.effectiveDiscount(100L, subtotal);
        long net = calc.lineNet(subtotal, discount);
        long tax = calc.perLineTax(net, BigDecimal.valueOf(10));
        long total = calc.lineTotal(net, tax);

        // net = 900, tax = 90, total = 990
        assertThat(net).isEqualTo(900L);
        assertThat(tax).isEqualTo(90L);
        assertThat(total).isEqualTo(990L);
    }

    @Test
    void modifierDeltasIncludedInLineSubtotal() {
        // base 1000, +200 modifier, qty 2 => (1000+200)*2 = 2400
        long subtotal = calc.lineSubtotal(1000L, List.of(200L), 2);
        assertThat(subtotal).isEqualTo(2400L);
    }

    @Test
    void negativeModifierDeltaDecreasesSubtotal() {
        // base 1000, -100 modifier, qty 1 => 900
        long subtotal = calc.lineSubtotal(1000L, List.of(-100L), 1);
        assertThat(subtotal).isEqualTo(900L);
    }

    @Test
    void multiLineAggregationIsCorrect() {
        // Multiple lines, verify totals accumulate
        var line1 = calc.computeItemLine(1000L, List.of(), 2, 0L, BigDecimal.valueOf(10));
        var line2 = calc.computeItemLine(500L, List.of(100L), 1, 50L, BigDecimal.valueOf(10));

        // line1: subtotal=2000, discount=0, net=2000, tax=200, total=2200
        assertThat(line1.subtotalPaisa()).isEqualTo(2000L);
        assertThat(line1.discountPaisa()).isEqualTo(0L);
        assertThat(line1.taxPaisa()).isEqualTo(200L);
        assertThat(line1.lineTotalPaisa()).isEqualTo(2200L);

        // line2: subtotal=600, discount=50, net=550, tax=55, total=605
        assertThat(line2.subtotalPaisa()).isEqualTo(600L);
        assertThat(line2.discountPaisa()).isEqualTo(50L);
        assertThat(line2.taxPaisa()).isEqualTo(55L);
        assertThat(line2.lineTotalPaisa()).isEqualTo(605L);
    }

    @Test
    void zeroTaxRateProducesZeroTax() {
        long tax = calc.perLineTax(5000L, BigDecimal.ZERO);
        assertThat(tax).isEqualTo(0L);
    }

    @Test
    void nullTaxRateProducesZeroTax() {
        long tax = calc.perLineTax(5000L, null);
        assertThat(tax).isEqualTo(0L);
    }
}
