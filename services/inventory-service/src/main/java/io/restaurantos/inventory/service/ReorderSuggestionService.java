package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.dto.ReorderDtos.ReorderShortfallDto;
import io.restaurantos.inventory.dto.ReorderDtos.ReorderShortfallsResponse;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Answers "what needs ordering, and how much?" for one branch — the first thing in the system to
 * read {@code ingredients.par_level} or {@code item_categories.exclude_from_po_suggestions}.
 *
 * <p>Both fields have been settable since 08.2-01/08.2-09 and read by NOTHING. A manager could
 * type "par level 25", have it stored and displayed back faithfully, and have it change no
 * behaviour anywhere. Meanwhile {@code reorderPoint} beside it drove real low-stock alerts, so the
 * system could say *something is low* but never *buy this much*.
 *
 * <p>The two fields are a pair, and keeping them straight is the whole model:
 * <ul>
 *   <li>{@code reorderPoint} — WHEN to order. The alarm line, sized to cover supplier lead time.</li>
 *   <li>{@code parLevel} — HOW MUCH to order. The target the shelf should be topped back up to.</li>
 * </ul>
 *
 * <p>Shape mirrors {@link StockLevelService}: load the branch's stock rows and the tenant's
 * ingredient list once each, walk the category tree once, then join in memory. No per-row lookup.
 */
@Service
@Transactional(readOnly = true)
public class ReorderSuggestionService {

    private static final String NO_PAR_LEVEL =
            "No par level set, so there is no target to order up to.";
    private static final String PAR_BELOW_REORDER_POINT =
            "Par level is at or below the reorder point, so topping up would leave it still low.";

    private final IngredientBranchStockRepository stockRepository;
    private final IngredientRepository ingredientRepository;
    private final ItemCategoryService itemCategoryService;
    private final TenantContext tenantContext;

    public ReorderSuggestionService(IngredientBranchStockRepository stockRepository,
                                     IngredientRepository ingredientRepository,
                                     ItemCategoryService itemCategoryService,
                                     TenantContext tenantContext) {
        this.stockRepository = stockRepository;
        this.ingredientRepository = ingredientRepository;
        this.itemCategoryService = itemCategoryService;
        this.tenantContext = tenantContext;
    }

    /**
     * Every live ingredient at or below its reorder point at {@code branchId}, excluding categories
     * opted out of suggestions.
     *
     * <p>An ingredient with NO stock row counts as zero on hand, not as absent — a brand-new item
     * nobody has received yet is exactly the thing most worth ordering, and skipping it would make
     * the list quietly incomplete.
     *
     * <p>An item with {@code reorderPoint == 0} is never suggested. Zero means "no alarm line set",
     * which is also how {@link StockLevelService} reads it for the below-reorder-point flag; if the
     * two disagreed, the Stock page would highlight rows this list omits.
     */
    public ReorderShortfallsResponse shortfalls(UUID branchId) {
        UUID tenantId = tenantContext.requireTenantId();

        Map<UUID, IngredientBranchStock> stockByIngredientId =
                stockRepository.findByTenantIdAndBranchIdOrderByIngredientIdAsc(tenantId, branchId).stream()
                        .collect(Collectors.toMap(IngredientBranchStock::getIngredientId, Function.identity()));

        Map<UUID, ItemCategoryService.CategoryDefaults> categoryDefaults =
                itemCategoryService.resolveDefaultsByCategory(tenantId);

        List<ReorderShortfallDto> items = new ArrayList<>();
        for (Ingredient ingredient : ingredientRepository.findByTenantIdAndActiveTrue(tenantId)) {
            ItemCategoryService.CategoryDefaults category = categoryDefaults.get(ingredient.getCategoryId());
            if (category != null && category.excludedFromPoSuggestions()) {
                continue;
            }

            BigDecimal reorderPoint = ingredient.getReorderPoint();
            if (reorderPoint == null || reorderPoint.signum() <= 0) {
                continue;
            }

            IngredientBranchStock stock = stockByIngredientId.get(ingredient.getId());
            BigDecimal qtyOnHand = stock != null ? stock.getQtyOnHand() : BigDecimal.ZERO;
            if (qtyOnHand.compareTo(reorderPoint) > 0) {
                continue;
            }

            items.add(toDto(ingredient, category, qtyOnHand, reorderPoint));
        }

        items.sort(Comparator
                // Actionable rows first: a manager scanning this wants the things they can order
                // now, with the "you need to configure something" rows gathered underneath.
                .comparing((ReorderShortfallDto dto) -> dto.blockedReason() != null)
                .thenComparing(dto -> dto.ingredientName().toLowerCase(Locale.ROOT)));

        int blockedCount = (int) items.stream().filter(dto -> dto.blockedReason() != null).count();
        return new ReorderShortfallsResponse(branchId, items, blockedCount);
    }

    private static ReorderShortfallDto toDto(Ingredient ingredient,
                                              ItemCategoryService.CategoryDefaults category,
                                              BigDecimal qtyOnHand, BigDecimal reorderPoint) {
        BigDecimal parLevel = ingredient.getParLevel() != null ? ingredient.getParLevel() : BigDecimal.ZERO;

        // Par is the ONLY source of a quantity. Falling back to the reorder point would look
        // helpful and be wrong: it tops the shelf up to exactly the alarm line, so the item is
        // still "low" the moment the delivery lands and reappears on this list tomorrow.
        String blockedReason = null;
        BigDecimal suggestedQty = null;
        if (parLevel.signum() <= 0) {
            blockedReason = NO_PAR_LEVEL;
        } else if (parLevel.compareTo(reorderPoint) <= 0) {
            blockedReason = PAR_BELOW_REORDER_POINT;
        } else {
            suggestedQty = parLevel.subtract(qtyOnHand);
        }

        return new ReorderShortfallDto(
                ingredient.getId(),
                ingredient.getName(),
                ingredient.getSku(),
                ingredient.getBaseUomCode(),
                ingredient.getCategoryId(),
                category == null ? null : category.categoryName(),
                qtyOnHand,
                reorderPoint,
                parLevel,
                suggestedQty,
                blockedReason);
    }
}
