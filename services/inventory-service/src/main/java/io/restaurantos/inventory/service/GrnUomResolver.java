package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.exception.GrnUomUnresolvableException;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Step 2 of the purchase-unit conversion: a GRN line's quantity and cost arrive in the vendor's
 * PACK unit (10&nbsp;kg per carton, already divided out by purchasing) and have to land in the
 * ingredient's own stock unit before {@link ReceiptService} touches {@code qty_on_hand} or
 * moving-average cost.
 *
 * <p>Nothing performed this conversion. A carton of 10&nbsp;kg received against an ingredient
 * stocked in grams added <b>10</b> to {@code qty_on_hand} instead of 10,000, and fed the carton
 * price in as the price of one gram: on the live stack a PKR&nbsp;6,200 receipt moved MAC from 50
 * to 222 paisa/gram. Nothing failed — the receipt succeeded, the GR/IR entry balanced, the invoice
 * three-way-matched — so the error is invisible until someone asks why food cost is wrong.
 *
 * <p>Inventory does this rather than purchasing because inventory owns
 * {@code units_of_measure}: purchasing knows a carton holds 10 of something, only inventory knows
 * what "kg" means to <i>this</i> ingredient.
 *
 * <p><b>REFUSES rather than guesses (36-06, D-36-05).</b> An unknown or wrong-dimension unit code
 * throws {@link io.restaurantos.inventory.exception.GrnUomUnresolvableException}, so the message
 * dead-letters and no stock, no moving-average blend and no movement row is written.
 *
 * <p>This class used to log at ERROR and fall back to a factor of one, and that choice had a stated
 * reason: throwing would DLQ the batch <em>after finance had already posted its GR/IR entry</em>,
 * turning a valuation error into a reconciliation gap. <b>The reason no longer holds.</b> Since
 * phase 14 finance posts the receipt entry from the real stock lot, not from this message, so a
 * refused receipt strands nothing — there is no entry yet to strand.
 *
 * <p>What the fallback cost, measured on the live stack in plan 36-01: a purchase-order line whose
 * unit was the string {@code FURLONG} was received, and seven furlongs became <b>seven kilograms</b>
 * of Basmati Rice. Nothing failed — the receipt succeeded, the entry balanced, the invoice
 * three-way-matched. Only the numbers were wrong.
 *
 * <p>Plan 36-04 refuses the same line at the API, where a person can fix it. This is the second line
 * of defence, and it is deliberately loud.
 */
@Service
public class GrnUomResolver {

    private static final Logger log = LoggerFactory.getLogger(GrnUomResolver.class);

    /** {@code qty_on_hand} and {@code stock_lots.qty} are both NUMERIC(18,4). */
    private static final int QTY_SCALE = 4;
    /** Per-unit costs are NUMERIC(18,4) as of V12 — a rate, not a whole-paisa amount. */
    private static final int COST_SCALE = 4;

    private final IngredientRepository ingredientRepository;
    private final UnitOfMeasureRepository unitOfMeasureRepository;

    public GrnUomResolver(IngredientRepository ingredientRepository,
                          UnitOfMeasureRepository unitOfMeasureRepository) {
        this.ingredientRepository = ingredientRepository;
        this.unitOfMeasureRepository = unitOfMeasureRepository;
    }

    /**
     * @param qtyInBaseUom        quantity in the ingredient's own stock unit
     * @param unitCostPaisaPerBaseUom cost of ONE stock unit, in paisa — a rate, so fractional (V12)
     * @param converted           whether a factor other than one was applied — for logging/tests
     */
    public record BaseUnitReceipt(BigDecimal qtyInBaseUom, BigDecimal unitCostPaisaPerBaseUom,
                                  boolean converted) {}

    /**
     * @param packQty  quantity in {@code packUomCode} units
     * @param packCost cost of one {@code packUomCode} unit, in paisa, unrounded
     */
    public BaseUnitReceipt toBaseUnits(UUID tenantId, UUID ingredientId, UUID grnId,
                                       BigDecimal packQty, BigDecimal packCost, String packUomCode) {
        BigDecimal factor = resolveFactor(tenantId, ingredientId, grnId, packUomCode);

        BigDecimal qty = packQty.multiply(factor).setScale(QTY_SCALE, RoundingMode.HALF_UP);
        BigDecimal unitCost = unitCostPaisa(packCost, factor);
        return new BaseUnitReceipt(qty, unitCost, factor.compareTo(BigDecimal.ONE) != 0);
    }

    /**
     * How many of the ingredient's stock units are in one {@code packUomCode}. One when the pack
     * unit IS the stock unit, when no unit was supplied, or when the code cannot be trusted.
     */
    private BigDecimal resolveFactor(UUID tenantId, UUID ingredientId, UUID grnId, String packUomCode) {
        if (packUomCode == null || packUomCode.isBlank()) {
            // No unit was stated at all. The quantity is already in whatever unit the ingredient is
            // stocked in — there is nothing to convert and nothing to guess. This is the one
            // remaining factor-of-one case, and it is not a fallback.
            return BigDecimal.ONE;
        }
        Ingredient ingredient = ingredientRepository.findByTenantIdAndId(tenantId, ingredientId).orElse(null);
        if (ingredient == null) {
            throw new GrnUomUnresolvableException(grnId, ingredientId, packUomCode, "<unknown>",
                    "that ingredient does not exist in this tenant, so it has no stock unit to "
                            + "convert into");
        }
        String baseUomCode = ingredient.getBaseUomCode();
        if (packUomCode.equalsIgnoreCase(baseUomCode)) {
            return BigDecimal.ONE;
        }

        // Tenant id passed explicitly rather than leaning on the Hibernate tenantFilter: this runs
        // on a @RabbitListener thread, and findByCode's ambient scoping has already been shown to
        // leak across tenants when the filter is not enabled on the session.
        List<UnitOfMeasure> tenantUoms = unitOfMeasureRepository.findByTenantId(tenantId);
        UnitOfMeasure uom = byCode(tenantUoms, packUomCode);
        if (uom == null) {
            throw new GrnUomUnresolvableException(grnId, ingredientId, packUomCode, baseUomCode,
                    "that is not a unit this tenant defines. Fix the vendor catalog row's pack "
                            + "unit, or add the unit in Inventory > Setup");
        }

        // The ratio against the ingredient's OWN stock unit, never the raw family factor. Receiving
        // a G-priced pack into a KG-stocked ingredient used to fall into the "different families"
        // branch below (G's base_unit_code is null, so it never equalled 'KG') and receive 500 g as
        // 500 KG. Depletion had the mirror-image bug; both now go through one rule.
        Optional<BigDecimal> factor = IngredientUomFactorResolver.factorToIngredientBase(
                uom, baseUomCode, byCode(tenantUoms, baseUomCode));
        if (factor.isEmpty()) {
            // NEVER across families, under any circumstance — including when the two codes look
            // interchangeable to a reader. There is no ratio between a litre and a kilogram, and
            // inventing one is how a wrong-family unit becomes a wrong number nobody sees.
            throw new GrnUomUnresolvableException(grnId, ingredientId, packUomCode, baseUomCode,
                    "they are not in the same unit family, so there is no conversion between them");
        }
        return factor.get();
    }

    /** Case-insensitive lookup — unit codes are not normalised at rest (see UomProvisioningService). */
    private static UnitOfMeasure byCode(List<UnitOfMeasure> uoms, String code) {
        if (code == null) {
            return null;
        }
        return uoms.stream().filter(u -> code.equalsIgnoreCase(u.getCode())).findFirst().orElse(null);
    }

    /**
     * Cost per stock unit — a rate, so it keeps its decimals (V12).
     *
     * <p>This used to round to a whole paisa, because that was all the columns could hold, and then
     * clamp a sub-paisa result up to 1 so the stock was not valued at zero. Both were damage
     * control: PKR&nbsp;62/kg is 6.2 paisa/g and was stored as 6, a 3.2% error compounded into
     * every later moving-average blend. The columns are {@code NUMERIC(18,4)} now, so the true rate
     * is stored and neither the rounding nor the clamp is needed.
     */
    private static BigDecimal unitCostPaisa(BigDecimal packCost, BigDecimal factor) {
        if (packCost == null || packCost.signum() <= 0) {
            return BigDecimal.ZERO;
        }
        return packCost.divide(factor, COST_SCALE, RoundingMode.HALF_UP);
    }
}
