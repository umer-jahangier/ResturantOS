package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.domain.model.MenuItemCatalog;
import io.restaurantos.inventory.domain.model.RecipeLine;
import io.restaurantos.inventory.domain.model.UnitOfMeasure;
import io.restaurantos.inventory.dto.RecipeDtos.PreviewRecipeCostRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeCostLineDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeCostPreviewDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeLineRequest;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.inventory.repository.MenuItemCatalogRepository;
import io.restaurantos.inventory.repository.UnitOfMeasureRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * INV-15: the non-persisting recipe cost-preview the live plate-cost panel round-trips to
 * (08.2-UI-SPEC.md Screen 3). Every repository read is batched across the whole draft line array
 * — one query per lookup kind, never one per line (T-08.2-074) — and every arithmetic step is
 * {@link BigDecimal}, rounding only once at the paisa boundary (D-08). This service never calls
 * save/saveAll/delete/flush; it reads {@link IngredientBranchStock#getAvgCostPaisa()} (the same
 * moving-average value COGS is valued at, {@link MacCalculator}) so the authoring estimate and the
 * depletion ledger always agree on one number.
 *
 * <p>A line whose ingredient id is unknown, whose UOM code is unknown, whose UOM's dimension
 * doesn't match the ingredient's own {@code baseUomCode} (no in-dimension conversion exists), or
 * whose ingredient has never been costed (no stock row, or a zero {@code avgCostPaisa}) is
 * excluded from the batch total and reported with the UI contract's exact warning copy instead of
 * failing the whole request.
 */
@Service
@Transactional(readOnly = true)
public class RecipeCostPreviewService {

    private static final String WARNING_TEMPLATE = "Couldn't price this line — check the unit conversion for %s";

    private final IngredientRepository ingredientRepository;
    private final IngredientBranchStockRepository stockRepository;
    private final UnitOfMeasureRepository unitOfMeasureRepository;
    private final MenuItemCatalogRepository menuItemCatalogRepository;
    private final TenantContext tenantContext;

    public RecipeCostPreviewService(IngredientRepository ingredientRepository,
                                     IngredientBranchStockRepository stockRepository,
                                     UnitOfMeasureRepository unitOfMeasureRepository,
                                     MenuItemCatalogRepository menuItemCatalogRepository,
                                     TenantContext tenantContext) {
        this.ingredientRepository = ingredientRepository;
        this.stockRepository = stockRepository;
        this.unitOfMeasureRepository = unitOfMeasureRepository;
        this.menuItemCatalogRepository = menuItemCatalogRepository;
        this.tenantContext = tenantContext;
    }

    public RecipeCostPreviewDto preview(PreviewRecipeCostRequest request) {
        UUID tenantId = tenantContext.requireTenantId();
        List<RecipeLineRequest> lineRequests = request.lines();

        // Batch every lookup ONE time across the whole line array — no per-line repository calls.
        List<UUID> ingredientIds = lineRequests.stream()
                .map(RecipeLineRequest::ingredientId)
                .distinct()
                .toList();
        Map<UUID, Ingredient> ingredientsById = new HashMap<>();
        ingredientRepository.findAllById(ingredientIds).forEach(i -> ingredientsById.put(i.getId(), i));

        List<String> uomCodes = lineRequests.stream()
                .map(RecipeLineRequest::uomCode)
                .distinct()
                .toList();
        Map<String, UnitOfMeasure> uomsByCode = new HashMap<>();
        unitOfMeasureRepository.findByCodeIn(uomCodes).forEach(u -> uomsByCode.put(u.getCode(), u));

        Map<UUID, Long> avgCostByIngredientId = new HashMap<>();
        stockRepository
                .findByTenantIdAndBranchIdAndIngredientIdIn(tenantId, request.branchId(), ingredientIds)
                .forEach(s -> avgCostByIngredientId.put(s.getIngredientId(), s.getAvgCostPaisa()));

        // Pass 1: resolve each line's cost or warning; accumulate the batch total.
        List<PricedLine> priced = new ArrayList<>();
        BigDecimal batchCost = BigDecimal.ZERO;
        int excludedLineCount = 0;

        for (int i = 0; i < lineRequests.size(); i++) {
            RecipeLineRequest lineRequest = lineRequests.get(i);
            Ingredient ingredient = ingredientsById.get(lineRequest.ingredientId());
            String ingredientName = ingredient != null ? ingredient.getName() : null;

            PricedLine result = priceLine(lineRequest, ingredient, uomsByCode, avgCostByIngredientId,
                    request.yieldServings(), ingredientName);
            priced.add(result);
            if (result.warning() != null) {
                excludedLineCount++;
            } else {
                batchCost = batchCost.add(BigDecimal.valueOf(result.costPaisa()));
            }
        }

        long batchCostPaisa = batchCost.setScale(0, RoundingMode.HALF_UP).longValueExact();
        long portionCostPaisa = batchCostPaisa == 0
                ? 0L
                : BigDecimal.valueOf(batchCostPaisa)
                        .divide(request.yieldServings(), 0, RoundingMode.HALF_UP)
                        .longValueExact();

        List<RecipeCostLineDto> lines = new ArrayList<>();
        for (int i = 0; i < priced.size(); i++) {
            PricedLine result = priced.get(i);
            if (result.warning() != null) {
                lines.add(new RecipeCostLineDto(i, result.ingredientId(), result.ingredientName(),
                        null, null, null, result.warning()));
                continue;
            }
            Integer sharePct = batchCostPaisa == 0
                    ? 0
                    : BigDecimal.valueOf(result.costPaisa())
                            .divide(BigDecimal.valueOf(batchCostPaisa), 8, RoundingMode.HALF_UP)
                            .multiply(BigDecimal.valueOf(100))
                            .setScale(0, RoundingMode.HALF_UP)
                            .intValueExact();
            lines.add(new RecipeCostLineDto(i, result.ingredientId(), result.ingredientName(),
                    result.effectiveBaseQty(), result.costPaisa(), sharePct, null));
        }

        Long menuItemPricePaisa = null;
        if (request.menuItemId() != null) {
            Optional<MenuItemCatalog> catalog =
                    menuItemCatalogRepository.findByTenantIdAndMenuItemId(tenantId, request.menuItemId());
            if (catalog.isPresent() && catalog.get().getBasePricePaisa() != 0) {
                menuItemPricePaisa = catalog.get().getBasePricePaisa();
            }
        }

        BigDecimal foodCostPct = null;
        if (menuItemPricePaisa != null) {
            foodCostPct = BigDecimal.valueOf(portionCostPaisa)
                    .divide(BigDecimal.valueOf(menuItemPricePaisa), 8, RoundingMode.HALF_UP)
                    .multiply(BigDecimal.valueOf(100))
                    .setScale(1, RoundingMode.HALF_UP);
        }

        return new RecipeCostPreviewDto(batchCostPaisa, portionCostPaisa, request.yieldServings(),
                menuItemPricePaisa, foodCostPct, excludedLineCount, lines);
    }

    private PricedLine priceLine(RecipeLineRequest lineRequest, Ingredient ingredient,
                                  Map<String, UnitOfMeasure> uomsByCode,
                                  Map<UUID, Long> avgCostByIngredientId,
                                  BigDecimal recipeYieldServings, String ingredientName) {
        if (ingredient == null) {
            return PricedLine.warned(lineRequest.ingredientId(), null,
                    String.format(WARNING_TEMPLATE, "ingredient " + lineRequest.ingredientId()));
        }

        UnitOfMeasure uom = uomsByCode.get(lineRequest.uomCode());
        if (uom == null || !dimensionMatches(uom, ingredient)) {
            return PricedLine.warned(ingredient.getId(), ingredientName,
                    String.format(WARNING_TEMPLATE, ingredientName));
        }

        Long avgCostPaisa = avgCostByIngredientId.get(ingredient.getId());
        if (avgCostPaisa == null || avgCostPaisa == 0L) {
            return PricedLine.warned(ingredient.getId(), ingredientName,
                    String.format(WARNING_TEMPLATE, ingredientName));
        }

        RecipeLine line = new RecipeLine();
        line.setIngredientId(lineRequest.ingredientId());
        line.setQty(lineRequest.qty());
        line.setUomCode(lineRequest.uomCode());
        line.setYieldPct(lineRequest.yieldPct() != null ? lineRequest.yieldPct() : BigDecimal.valueOf(100));

        BigDecimal effectiveBaseQty =
                UomConverter.effectiveBaseQty(line, 1, recipeYieldServings, uom.getToBaseFactor());
        long lineCostPaisa = effectiveBaseQty.multiply(BigDecimal.valueOf(avgCostPaisa))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();

        return PricedLine.priced(ingredient.getId(), ingredientName, effectiveBaseQty, lineCostPaisa);
    }

    /**
     * A UOM is dimension-compatible with an ingredient when either the UOM code IS the
     * ingredient's own base unit (no conversion needed, {@code toBaseFactor} is a no-op 1), or the
     * UOM's declared {@code baseUnitCode} equals the ingredient's {@code baseUomCode} — otherwise
     * {@code toBaseFactor} would convert into a different unit family entirely.
     */
    private static boolean dimensionMatches(UnitOfMeasure uom, Ingredient ingredient) {
        String ingredientBase = ingredient.getBaseUomCode();
        if (uom.getCode().equalsIgnoreCase(ingredientBase)) {
            return true;
        }
        return ingredientBase.equals(uom.getBaseUnitCode());
    }

    /** Internal per-line pricing outcome — never exposed outside this service. */
    private record PricedLine(UUID ingredientId, String ingredientName, BigDecimal effectiveBaseQty,
                               long costPaisa, String warning) {
        static PricedLine priced(UUID ingredientId, String ingredientName, BigDecimal effectiveBaseQty, long costPaisa) {
            return new PricedLine(ingredientId, ingredientName, effectiveBaseQty, costPaisa, null);
        }

        static PricedLine warned(UUID ingredientId, String ingredientName, String warning) {
            return new PricedLine(ingredientId, ingredientName, null, 0L, warning);
        }
    }
}
