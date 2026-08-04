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
 */
public final class MacCalculator {

    private MacCalculator() {}

    public static long recomputeAvgCostPaisa(BigDecimal oldQty, long oldAvgCostPaisa,
                                              BigDecimal recvQty, long recvUnitCostPaisa) {
        BigDecimal newQty = oldQty.add(recvQty);

        // Degenerate: nothing on hand before and after (shouldn't occur on a real receipt, since
        // a receipt always adds positive qty, but guarded per Pitfall 4).
        if (newQty.signum() == 0) {
            return recvUnitCostPaisa;
        }

        // D-02 oversell policy: a receipt onto zero/negative on-hand resets MAC to the receipt's
        // own unit cost instead of blending against a prior average that no longer means anything.
        if (oldQty.signum() <= 0) {
            return recvUnitCostPaisa;
        }

        BigDecimal oldValue = oldQty.multiply(BigDecimal.valueOf(oldAvgCostPaisa));
        BigDecimal recvValue = recvQty.multiply(BigDecimal.valueOf(recvUnitCostPaisa));
        return oldValue.add(recvValue)
                .divide(newQty, 0, RoundingMode.HALF_UP)
                .longValueExact();
    }
}
