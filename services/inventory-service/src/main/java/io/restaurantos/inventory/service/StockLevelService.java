package io.restaurantos.inventory.service;

import io.restaurantos.inventory.domain.model.Ingredient;
import io.restaurantos.inventory.domain.model.IngredientBranchStock;
import io.restaurantos.inventory.dto.StockLevelDtos.StockLevelDto;
import io.restaurantos.inventory.dto.StockLevelDtos.StockLevelsResponse;
import io.restaurantos.inventory.repository.IngredientBranchStockRepository;
import io.restaurantos.inventory.repository.IngredientRepository;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * Read model over {@code ingredient_branch_stock} (INV-15) — {@code ingredient_branch_stock} was
 * write-only (receipts/transfers/counts/opening-balance) until this service. Mirrors
 * {@link RecipeService#getCoverage()}'s left-join-in-the-service-layer shape: load the branch's
 * stock rows and the tenant's ingredient master list once each, then join in memory — no
 * per-row lookup.
 */
@Service
@Transactional(readOnly = true)
public class StockLevelService {

    private final IngredientBranchStockRepository stockRepository;
    private final IngredientRepository ingredientRepository;
    private final ItemCategoryService itemCategoryService;
    private final TenantContext tenantContext;

    public StockLevelService(IngredientBranchStockRepository stockRepository,
                              IngredientRepository ingredientRepository,
                              ItemCategoryService itemCategoryService,
                              TenantContext tenantContext) {
        this.stockRepository = stockRepository;
        this.ingredientRepository = ingredientRepository;
        this.itemCategoryService = itemCategoryService;
        this.tenantContext = tenantContext;
    }

    public StockLevelsResponse listStockLevels(UUID branchId, String search) {
        UUID tenantId = tenantContext.requireTenantId();

        List<IngredientBranchStock> stockRows =
                stockRepository.findByTenantIdAndBranchIdOrderByIngredientIdAsc(tenantId, branchId);
        Map<UUID, IngredientBranchStock> stockByIngredientId = stockRows.stream()
                .collect(Collectors.toMap(IngredientBranchStock::getIngredientId, Function.identity()));

        List<Ingredient> activeIngredients = ingredientRepository.findByTenantIdAndActiveTrue(tenantId);

        // Union of every active ingredient (even with no stock row yet, rendered at zero
        // on-hand) plus any archived ingredient that still holds nonzero stock at this branch —
        // an archived ingredient with zero on-hand is excluded so the list does not grow forever.
        Set<UUID> distinctIds = new HashSet<>();
        for (Ingredient ingredient : activeIngredients) {
            distinctIds.add(ingredient.getId());
        }
        for (IngredientBranchStock stock : stockRows) {
            if (stock.getQtyOnHand().signum() != 0) {
                distinctIds.add(stock.getIngredientId());
            }
        }

        Map<UUID, Ingredient> ingredientsById = ingredientRepository.findAllById(distinctIds).stream()
                .collect(Collectors.toMap(Ingredient::getId, Function.identity(), (a, b) -> a, HashMap::new));

        String needle = (search == null || search.isBlank()) ? null : search.trim().toLowerCase(Locale.ROOT);

        // One whole-tenant category walk for the whole page: supplies each row's category name and
        // its inherited variance cap, both of which are per-category rather than per-ingredient.
        Map<UUID, ItemCategoryService.CategoryDefaults> categoryDefaults =
                itemCategoryService.resolveDefaultsByCategory(tenantId);

        List<StockLevelDto> items = distinctIds.stream()
                .map(ingredientsById::get)
                .filter(Objects::nonNull)
                .filter(ingredient -> matchesSearch(ingredient, needle))
                .map(ingredient -> toDto(ingredient, stockByIngredientId.get(ingredient.getId()),
                        categoryDefaults.get(ingredient.getCategoryId())))
                .sorted(Comparator.comparing(dto -> dto.ingredientName().toLowerCase(Locale.ROOT)))
                .toList();

        long totalStockValuePaisa = items.stream().mapToLong(StockLevelDto::stockValuePaisa).sum();

        return new StockLevelsResponse(branchId, items, totalStockValuePaisa);
    }

    private static boolean matchesSearch(Ingredient ingredient, String needle) {
        if (needle == null) {
            return true;
        }
        boolean nameMatches = ingredient.getName() != null
                && ingredient.getName().toLowerCase(Locale.ROOT).contains(needle);
        boolean skuMatches = ingredient.getSku() != null
                && ingredient.getSku().toLowerCase(Locale.ROOT).contains(needle);
        return nameMatches || skuMatches;
    }

    private static StockLevelDto toDto(Ingredient ingredient, IngredientBranchStock stock,
                                        ItemCategoryService.CategoryDefaults category) {
        BigDecimal qtyOnHand = stock != null ? stock.getQtyOnHand() : BigDecimal.ZERO;
        long avgCostPaisa = stock != null ? stock.getAvgCostPaisa() : 0L;
        var lastCountedAt = stock != null ? stock.getLastCountedAt() : null;
        BigDecimal reorderPoint = ingredient.getReorderPoint();

        long stockValuePaisa = qtyOnHand
                .multiply(BigDecimal.valueOf(avgCostPaisa))
                .setScale(0, RoundingMode.HALF_UP)
                .longValueExact();

        boolean belowReorderPoint = reorderPoint.signum() > 0 && qtyOnHand.compareTo(reorderPoint) <= 0;
        boolean nonPositive = qtyOnHand.signum() <= 0;

        return new StockLevelDto(
                ingredient.getId(),
                ingredient.getName(),
                ingredient.getSku(),
                ingredient.getBaseUomCode(),
                // These two were hardcoded null pending "plan 08.2-09 once the ingredient DTO
                // exposes item_categories" — which landed, but these were never wired up. The
                // visible effect: every Stock row showed "—" for Category, and the page's category
                // filter matched nothing at all, since it compares against this always-null id.
                // Populated here because resolving the variance cap needs the very same map.
                ingredient.getCategoryId(),
                category == null ? null : category.categoryName(),
                qtyOnHand,
                reorderPoint,
                avgCostPaisa,
                stockValuePaisa,
                lastCountedAt,
                belowReorderPoint,
                nonPositive,
                category == null ? null : category.varianceCapPct());
    }
}
