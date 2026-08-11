package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.UnitOfMeasure;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Optional;

/**
 * How many of an ingredient's OWN stock units one unit of some other UOM is worth.
 *
 * <p><b>The bug this exists to kill.</b> {@code units_of_measure.to_base_factor} converts a unit
 * into its <i>family's canonical base</i> — KG&nbsp;→&nbsp;1000&nbsp;G, L&nbsp;→&nbsp;1000&nbsp;ML,
 * DOZEN&nbsp;→&nbsp;12&nbsp;EACH. It does <b>not</b> convert into the ingredient's stock unit, and
 * an ingredient is free to be stocked in any unit of its family. {@code DepletionService} and
 * {@code RecipeCostPreviewService} both applied {@code to_base_factor} raw, so a recipe line of
 * "0.25 KG" against an ingredient stocked in <b>KG</b> was read as 250 — a 1000&times; over-count
 * on both quantity and cost.
 *
 * <p>Measured on the live stack before this class existed: 100&nbsp;KG of Basmati Rice received at
 * 25,000&nbsp;paisa/KG, then two plates sold whose recipe called for 0.25&nbsp;KG each.
 * {@code qty_on_hand} went from 100 to <b>&minus;400</b> (it depleted 500, not 0.5) and finance
 * posted {@code JE ORDER_COGS DR 5100 / CR 1300 = 12,500,000} paisa against revenue of 290,000 —
 * a food cost of 4,310%. Nothing failed: the depletion succeeded, the event balanced, the journal
 * entry balanced, {@code JE_UNBALANCED} had nothing to catch. Only the numbers were wrong, which
 * is the failure mode this codebase keeps producing.
 *
 * <p><b>The rule.</b> Both units are meaningful only inside one family, so the conversion is a
 * ratio of the two families' factors:
 *
 * <pre>
 *   factor = to_base_factor(fromUom) / to_base_factor(ingredientStockUom)
 * </pre>
 *
 * which is 1 for KG&rarr;KG, 1000 for KG&rarr;G, 0.001 for G&rarr;KG, and undefined across
 * families. Returning {@link Optional#empty()} rather than a guessed 1 is deliberate: a silent
 * fallback is exactly how a wrong-family unit becomes a wrong number nobody sees. Each caller
 * decides what "undefined" means for it — the cost preview warns the line, depletion skips it and
 * raises {@code DEPLETION_INCOMPLETE}, the GRN path logs and receives at face value.
 */
public final class IngredientUomFactorResolver {

    /** Working scale for the ratio — G&rarr;OZ is 0.03527396, so 8 places is the floor. */
    private static final int FACTOR_SCALE = 8;

    private IngredientUomFactorResolver() {}

    /**
     * @param fromUom            the unit the quantity is expressed in (a recipe line's
     *                           {@code uom_code}, a vendor pack unit) — may be null when the code
     *                           did not resolve in the registry
     * @param ingredientBaseCode the ingredient's {@code base_uom_code}, i.e. the unit
     *                           {@code qty_on_hand} and {@code avg_cost_paisa} are denominated in
     * @param ingredientBaseUom  the registry row for {@code ingredientBaseCode}, or null when the
     *                           ingredient is stocked in a unit this tenant never defined
     * @return the multiplier onto the ingredient's stock unit, or empty when the two units are not
     *         in the same family (or cannot be shown to be)
     */
    public static Optional<BigDecimal> factorToIngredientBase(UnitOfMeasure fromUom,
                                                              String ingredientBaseCode,
                                                              UnitOfMeasure ingredientBaseUom) {
        if (fromUom == null || isBlank(ingredientBaseCode)) {
            return Optional.empty();
        }
        // Same unit: no conversion, whatever the family factor happens to say. This is the case
        // that was silently wrong — KG stock, KG recipe line, factor 1000.
        if (ingredientBaseCode.equalsIgnoreCase(fromUom.getCode())) {
            return Optional.of(BigDecimal.ONE);
        }

        String fromFamily = familyBaseCode(fromUom);

        if (ingredientBaseUom == null) {
            // The stock unit is not in the registry. The one case still provable is the ingredient
            // being stocked in the family's canonical base itself (G, ML, EACH) — that is what
            // to_base_factor already targets, so it is the right multiplier unchanged.
            return ingredientBaseCode.equalsIgnoreCase(fromFamily)
                    ? Optional.of(fromUom.getToBaseFactor())
                    : Optional.empty();
        }

        if (!fromFamily.equalsIgnoreCase(familyBaseCode(ingredientBaseUom))) {
            return Optional.empty();
        }

        BigDecimal stockFactor = ingredientBaseUom.getToBaseFactor();
        if (stockFactor == null || stockFactor.signum() <= 0) {
            return Optional.empty();
        }
        return Optional.of(fromUom.getToBaseFactor()
                .divide(stockFactor, FACTOR_SCALE, RoundingMode.HALF_UP));
    }

    /**
     * The canonical unit of a UOM's family. A base unit (G, ML, EACH) carries a null/blank
     * {@code base_unit_code} because it IS the base, so it is its own family key — without this
     * every base unit would compare unequal to the derived units that point at it.
     */
    private static String familyBaseCode(UnitOfMeasure uom) {
        return isBlank(uom.getBaseUnitCode()) ? uom.getCode() : uom.getBaseUnitCode();
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }
}
