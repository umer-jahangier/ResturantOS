package io.restaurantos.inventory.service;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * Weighted moving-average-cost (MAC) recompute (INV-04/INV-07). No shared-lib helper exists for
 * this (08-RESEARCH.md Pitfall 4) — written fresh, mirroring {@code MoneyUtils.fromPkr}'s HALF_UP
 * rounding mode, never {@code MoneyUtils.taxPerLine}'s floored rounding.
 *
 * <p>D-02 oversell policy: a receipt landing on zero or negative on-hand (oversold stock) resets
 * the average cost to the receipt's own unit cost rather than blending against a meaningless prior
 * average — see 08-RESEARCH.md Pitfall 4.
 *
 * <p><b>Costs here are rates, not amounts (V12).</b> This used to compute in {@code long} paisa and
 * round the result to whole paisa per stock unit. That is correct for a total and wrong for a rate:
 * an ingredient stocked in grams and bought by the kilogram has a genuinely fractional per-gram
 * cost, so PKR 62/kg became 6 paisa/g instead of 6.2 and every subsequent blend compounded the
 * error. The blend now carries {@value #SCALE} decimal places, which is finer than any real
 * purchase price and matches the {@code NUMERIC(18,4)} the column stores.
 */
public final class MacCalculator {

    /** Matches {@code NUMERIC(18,4)}; 0.0001 paisa/gram is PKR 1 per tonne. */
    static final int SCALE = 4;

    private MacCalculator() {}

    public static BigDecimal recomputeAvgCostPaisa(BigDecimal oldQty, BigDecimal oldAvgCostPaisa,
                                                    BigDecimal recvQty, BigDecimal recvUnitCostPaisa) {
        BigDecimal oldAvg = oldAvgCostPaisa == null ? BigDecimal.ZERO : oldAvgCostPaisa;
        BigDecimal recvCost = recvUnitCostPaisa == null ? BigDecimal.ZERO : recvUnitCostPaisa;
        BigDecimal newQty = oldQty.add(recvQty);

        // Degenerate: nothing on hand before and after (shouldn't occur on a real receipt, since
        // a receipt always adds positive qty, but guarded per Pitfall 4).
        if (newQty.signum() == 0) {
            return scaled(recvCost);
        }

        // D-02 oversell policy: a receipt onto zero/negative on-hand resets MAC to the receipt's
        // own unit cost instead of blending against a prior average that no longer means anything.
        if (oldQty.signum() <= 0) {
            return scaled(recvCost);
        }

        BigDecimal oldValue = oldQty.multiply(oldAvg);
        BigDecimal recvValue = recvQty.multiply(recvCost);
        return oldValue.add(recvValue).divide(newQty, SCALE, RoundingMode.HALF_UP);
    }

    /**
     * An extended amount in WHOLE paisa — a rate times a quantity is money, and money is integral.
     * Every caller that writes a {@code total_cost_paisa}, a COGS figure or a journal-entry line
     * goes through here, so the rate/amount boundary is crossed in exactly one place.
     */
    public static long extendedCostPaisa(BigDecimal qty, BigDecimal unitCostPaisa) {
        if (qty == null || unitCostPaisa == null) {
            return 0L;
        }
        return qty.multiply(unitCostPaisa).setScale(0, RoundingMode.HALF_UP).longValueExact();
    }

    private static BigDecimal scaled(BigDecimal v) {
        return v.setScale(SCALE, RoundingMode.HALF_UP);
    }
}
