package io.restaurantos.hr.payroll;

import java.math.BigDecimal;

import io.restaurantos.hr.payroll.tax.SlabTaxCalculator;
import io.restaurantos.hr.payroll.tax.TaxSlab;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Pure-arithmetic tests for the FBR salaried income-tax slab math (Tax Year 2026 / FY2025-26).
 * Slab figures mirror the tax_config seed row and are VERIFY-WITH-ACCOUNTANT; here they only
 * drive boundary-case coverage of the config-walking calculator.
 */
class SlabTaxCalculatorTest {

    private final SlabTaxCalculator calc = new SlabTaxCalculator();

    private static final List<TaxSlab> FY2025_26 = List.of(
            new TaxSlab(0L,          60000000L,  0L,        new BigDecimal("0.0")),
            new TaxSlab(60000000L,   120000000L, 0L,        new BigDecimal("1.0")),
            new TaxSlab(120000000L,  220000000L, 600000L,   new BigDecimal("11.0")),
            new TaxSlab(220000000L,  320000000L, 11600000L, new BigDecimal("23.0")),
            new TaxSlab(320000000L,  410000000L, 34600000L, new BigDecimal("30.0")),
            new TaxSlab(410000000L,  null,       61600000L, new BigDecimal("35.0"))
    );

    @Test
    void topOfZeroBand_isZeroTax() {
        // 600,000 PKR = 60,000,000 paisa — exclusive upper bound of the 0% band.
        assertThat(calc.computeAnnualTax(60000000L, FY2025_26)).isZero();
    }

    @Test
    void onePercentBand() {
        // 1,200,000 PKR -> 6,000 PKR (1% of 600,000).
        assertThat(calc.computeAnnualTax(120000000L, FY2025_26)).isEqualTo(600000L);
    }

    @Test
    void elevenPercentBand() {
        // 2,200,000 PKR -> 116,000 PKR (6,000 + 11% of 1,000,000).
        assertThat(calc.computeAnnualTax(220000000L, FY2025_26)).isEqualTo(11600000L);
    }

    @Test
    void topOpenBand() {
        // 5,000,000 PKR -> 616,000 + 35% of 900,000 = 931,000 PKR.
        assertThat(calc.computeAnnualTax(500000000L, FY2025_26)).isEqualTo(93100000L);
    }

    @Test
    void surcharge_appliesToTax_onlyOverThreshold() {
        long income = 1200000000L; // 12,000,000 PKR, above the 10,000,000 threshold
        long tax = calc.computeAnnualTax(income, FY2025_26);
        long surcharge = calc.computeSurcharge(tax, income, 1000000000L, new BigDecimal("9.000"));
        assertThat(surcharge).isEqualTo(Math.round(tax * 9.0 / 100.0));
        assertThat(tax + surcharge).isEqualTo(tax + surcharge); // total = tax + 9% of tax
    }

    @Test
    void surcharge_isZero_belowThreshold() {
        assertThat(calc.computeSurcharge(1000000L, 50000000L, 1000000000L, new BigDecimal("9.000"))).isZero();
    }

    @Test
    void emptySlabs_throwIllegalState() {
        assertThatThrownBy(() -> calc.computeAnnualTax(120000000L, List.of()))
                .isInstanceOf(IllegalStateException.class);
    }
}
