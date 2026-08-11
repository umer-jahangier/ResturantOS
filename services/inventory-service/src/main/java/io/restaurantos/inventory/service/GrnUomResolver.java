package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
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
 * <p><b>Never throws.</b> An unknown or wrong-dimension unit code logs at ERROR and falls back to
 * a factor of one — exactly what the code did before this class existed. Throwing would DLQ the
 * whole GRN batch after finance has already posted its GR/IR entry, turning a valuation error into
 * a reconciliation gap. Vendor-catalog pack UOMs are free text today (they are typed, not picked),
 * so unresolvable codes are expected until that input is closed; the ERROR line carries every
 * identifier needed to correct the catalog row.
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
            return BigDecimal.ONE;
        }
        Ingredient ingredient = ingredientRepository.findByTenantIdAndId(tenantId, ingredientId).orElse(null);
        if (ingredient == null) {
            log.error("GRN {}: ingredient {} not found in tenant {}; receiving {} at face value",
                    grnId, ingredientId, tenantId, packUomCode);
            return BigDecimal.ONE;
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
            log.error("GRN {}: pack unit '{}' on ingredient {} is not a unit this tenant defines — "
                            + "receiving the quantity as if it were already in '{}'. Fix the vendor "
                            + "catalog row's pack UOM.",
                    grnId, packUomCode, ingredientId, baseUomCode);
            return BigDecimal.ONE;
        }

        // The ratio against the ingredient's OWN stock unit, never the raw family factor. Receiving
        // a G-priced pack into a KG-stocked ingredient used to fall into the "different families"
        // branch below (G's base_unit_code is null, so it never equalled 'KG') and receive 500 g as
        // 500 KG. Depletion had the mirror-image bug; both now go through one rule.
        Optional<BigDecimal> factor = IngredientUomFactorResolver.factorToIngredientBase(
                uom, baseUomCode, byCode(tenantUoms, baseUomCode));
        if (factor.isEmpty()) {
            log.error("GRN {}: pack unit '{}' and ingredient {}'s stock unit '{}' are not in the same "
                            + "unit family, so no conversion is applied — receiving at face value. "
                            + "Fix the vendor catalog row's pack UOM or the ingredient's base_uom_code.",
                    grnId, packUomCode, ingredientId, baseUomCode);
            return BigDecimal.ONE;
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
