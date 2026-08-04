package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.RecipeLine;

import java.math.BigDecimal;
import java.math.RoundingMode;

/**
 * M2.4 {@code effective_base_qty} conversion (INV-02/INV-03): converts a recipe line's quantity
 * into the ingredient's BASE unit of measure, scaled by the order's item quantity and the recipe's
 * yield.
 *
 * <pre>
 * effective_base_qty = (line.qty * uom.to_base_factor / (line.yield_pct / 100))
 *                       * order_item.qty / recipe.yield_servings
 * </pre>
 *
 * {@code RecipeLine.yieldPct} is persisted as a PERCENT (NUMERIC(6,2), default {@code 100.00} = no
 * trim loss) — the spec's illustrative pseudocode instead uses a 0.0-1.0 fraction (e.g. 0.85 for
 * 15% trim loss); dividing by {@code yieldPct / 100} recovers the same fractional yield this
 * schema's percent column represents.
 *
 * <p>Computed in {@link BigDecimal} at a working scale (8) then rounded {@link RoundingMode#HALF_UP}
 * to the {@code qty} persistence boundary (scale 4, mirroring {@code NUMERIC(18,4)}) — HALF_UP
 * mirrors {@code MoneyUtils.fromPkr}, never {@code MoneyUtils.taxPerLine}'s floored rounding
 * (08-RESEARCH.md Anti-Patterns).
 */
public final class UomConverter {

    private static final int WORKING_SCALE = 8;
    private static final int PERSISTENCE_SCALE = 4;
    private static final BigDecimal ONE_HUNDRED = BigDecimal.valueOf(100);

    private UomConverter() {}

    public static BigDecimal effectiveBaseQty(RecipeLine line, int orderQty,
                                               BigDecimal recipeYieldServings, BigDecimal toBaseFactor) {
        BigDecimal yieldFraction = line.getYieldPct().divide(ONE_HUNDRED, WORKING_SCALE, RoundingMode.HALF_UP);
        BigDecimal numerator = line.getQty()
                .multiply(toBaseFactor)
                .multiply(BigDecimal.valueOf(orderQty));
        BigDecimal denominator = yieldFraction.multiply(recipeYieldServings);
        BigDecimal working = numerator.divide(denominator, WORKING_SCALE, RoundingMode.HALF_UP);
        return working.setScale(PERSISTENCE_SCALE, RoundingMode.HALF_UP);
    }
}
