package io.restaurantos.hr.payroll.tax;

import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.util.List;

/**
 * Computes Pakistan annual salaried income tax by walking the {@code tax_config} slab rows —
 * no if/else ladder of hardcoded rates. Surcharge is applied to the tax payable (not income).
 */
@Component
public class SlabTaxCalculator {

    /**
     * Walk the slab rows to the bracket containing {@code annualTaxableIncomePaisa}
     * (income &gt;= min AND (max is null OR income &lt; max)); tax = baseTax + round(excess-over-min × rate%).
     */
    public long computeAnnualTax(long annualTaxableIncomePaisa, List<TaxSlab> slabs) {
        TaxSlab bracket = slabs.stream()
                .filter(s -> annualTaxableIncomePaisa >= s.minPaisa()
                        && (s.maxPaisa() == null || annualTaxableIncomePaisa < s.maxPaisa()))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException(
                        "No matching tax slab for income " + annualTaxableIncomePaisa + " paisa"));
        long excess = annualTaxableIncomePaisa - bracket.minPaisa();
        // PercentOfPaisa, not Math.round(x * rate / 100.0) — same reason the surcharge and EOBI
        // rates moved off double. It rounds HALF_UP explicitly and does the multiplication before
        // the division entirely in BigDecimal, so a rate an accountant types as 11.500 is applied
        // as written rather than as its nearest binary double.
        return bracket.baseTaxPaisa() + PercentOfPaisa.apply(excess, bracket.ratePct());
    }

    /**
     * Surcharge on the tax payable (never on income), applied only when taxable income exceeds
     * {@code surchargeThresholdPaisa}. Returns the surcharge amount (0 below the threshold).
     */
    public long computeSurcharge(long taxPaisa, long annualTaxableIncomePaisa,
                                 long surchargeThresholdPaisa, BigDecimal surchargeRatePct) {
        if (annualTaxableIncomePaisa <= surchargeThresholdPaisa) {
            return 0L;
        }
        return PercentOfPaisa.apply(taxPaisa, surchargeRatePct);
    }
}
