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

    private final IngredientRepository ingredientRepository;
    private final UnitOfMeasureRepository unitOfMeasureRepository;

    public GrnUomResolver(IngredientRepository ingredientRepository,
                          UnitOfMeasureRepository unitOfMeasureRepository) {
        this.ingredientRepository = ingredientRepository;
        this.unitOfMeasureRepository = unitOfMeasureRepository;
    }

    /**
     * @param qtyInBaseUom        quantity in the ingredient's own stock unit
     * @param unitCostPaisaPerBaseUom cost of ONE stock unit, whole paisa
     * @param converted           whether a factor other than one was applied — for logging/tests
     */
    public record BaseUnitReceipt(BigDecimal qtyInBaseUom, long unitCostPaisaPerBaseUom,
                                  boolean converted) {}

    /**
     * @param packQty  quantity in {@code packUomCode} units
     * @param packCost cost of one {@code packUomCode} unit, in paisa, unrounded
     */
    public BaseUnitReceipt toBaseUnits(UUID tenantId, UUID ingredientId, UUID grnId,
                                       BigDecimal packQty, BigDecimal packCost, String packUomCode) {
        BigDecimal factor = resolveFactor(tenantId, ingredientId, grnId, packUomCode);

        BigDecimal qty = packQty.multiply(factor).setScale(QTY_SCALE, RoundingMode.HALF_UP);
        long unitCost = unitCostPaisa(packCost, factor, ingredientId, grnId);
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
        UnitOfMeasure uom = unitOfMeasureRepository.findByTenantId(tenantId).stream()
                .filter(u -> packUomCode.equalsIgnoreCase(u.getCode()))
                .findFirst()
                .orElse(null);
        if (uom == null) {
            log.error("GRN {}: pack unit '{}' on ingredient {} is not a unit this tenant defines — "
                            + "receiving the quantity as if it were already in '{}'. Fix the vendor "
                            + "catalog row's pack UOM.",
                    grnId, packUomCode, ingredientId, baseUomCode);
            return BigDecimal.ONE;
        }

        // Same rule RecipeCostPreviewService.dimensionMatches applies, and for the same reason:
        // toBaseFactor is only meaningful inside one unit family. Applying a WEIGHT factor to a
        // VOLUME ingredient would convert into a different dimension entirely.
        if (baseUomCode == null || !baseUomCode.equalsIgnoreCase(uom.getBaseUnitCode())) {
            log.error("GRN {}: pack unit '{}' converts to base '{}' but ingredient {} is stocked in "
                            + "'{}' — different unit families, so no conversion is applied. Receiving "
                            + "at face value.",
                    grnId, packUomCode, uom.getBaseUnitCode(), ingredientId, baseUomCode);
            return BigDecimal.ONE;
        }
        return uom.getToBaseFactor();
    }

    /**
     * Cost per stock unit. {@code avg_cost_paisa}, {@code receipt_unit_cost_paisa} and
     * {@code inventory_movements.unit_cost_paisa} are all BIGINT, so a per-gram cost quantizes to a
     * whole paisa — PKR&nbsp;100/kg is 10 paisa/g exactly, PKR&nbsp;62/kg rounds 6.2 to 6. That
     * quantization predates this method and applies equally to a hand-keyed receipt; widening those
     * columns is a separate schema change.
     *
     * <p>A positive receipt cost never rounds to zero, which would read as free stock and drag MAC
     * toward it: it clamps to one paisa and says so.
     */
    private long unitCostPaisa(BigDecimal packCost, BigDecimal factor, UUID ingredientId, UUID grnId) {
        if (packCost == null || packCost.signum() <= 0) {
            return 0L;
        }
        long unitCost = packCost.divide(factor, 6, RoundingMode.HALF_UP)
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();
        if (unitCost == 0L) {
            log.warn("GRN {}: ingredient {} costs {} paisa per pack over a factor of {} — under half a "
                            + "paisa per stock unit, clamped to 1 so the stock is not valued at zero.",
                    grnId, ingredientId, packCost.toPlainString(), factor.toPlainString());
            return 1L;
        }
        return unitCost;
    }
}
