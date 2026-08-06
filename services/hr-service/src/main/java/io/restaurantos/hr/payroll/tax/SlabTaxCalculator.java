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
        return bracket.baseTaxPaisa() + Math.round(excess * bracket.ratePct() / 100.0);
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
