package io.restaurantos.purchasing.adapter;

import io.restaurantos.purchasing.feign.InventoryCategoryClient;
import io.restaurantos.purchasing.service.IngredientCategoryResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Feign-backed {@link IngredientCategoryResolver} for {@code integration-mode=feign} (08.2-11, D-09):
 * replaces the deleted classpath category-map mock with the real inventory-service
 * ingredient-category lookup shipped in plan 08.2-09
 * ({@code GET /internal/inventory/ingredient-categories}). Selected by the same
 * {@code restaurantos.inventory.integration-mode} switch {@link InventoryGrnClientAdapter} uses for
 * GRN data (T-08.2-111: tenant/service headers are propagated by the same {@code FeignClientConfig}
 * interceptor chain the GRN client already relies on).
 *
 * <p>Batched by design: {@link #resolveAll} takes the full set of ingredient ids needed for a spend
 * report and issues at most one Feign call per 500-id chunk (T-08.2-096's cap on the internal
 * endpoint), never a per-invoice-line call (T-08.2-113).
 *
 * <p>Degrades rather than fails: a transport/connection failure on any chunk is caught, logged, and
 * every id in that chunk resolves to "Uncategorized" — the spend report must keep rendering even
 * when inventory-service is briefly unreachable (T-08.2-112).
 */
@Component
@ConditionalOnProperty(name = "restaurantos.inventory.integration-mode", havingValue = "feign")
public class FeignIngredientCategoryResolver implements IngredientCategoryResolver {

    private static final Logger log = LoggerFactory.getLogger(FeignIngredientCategoryResolver.class);
    private static final int MAX_BATCH_SIZE = 500;

    private final InventoryCategoryClient inventoryCategoryClient;

    public FeignIngredientCategoryResolver(InventoryCategoryClient inventoryCategoryClient) {
        this.inventoryCategoryClient = inventoryCategoryClient;
    }

    @Override
    public Map<UUID, String> resolveAll(Collection<UUID> ingredientIds) {
        if (ingredientIds == null || ingredientIds.isEmpty()) {
            return Map.of();
        }
        Set<UUID> distinctIds = new LinkedHashSet<>(ingredientIds);
        distinctIds.remove(null);
        if (distinctIds.isEmpty()) {
            return Map.of();
        }

        Map<UUID, String> result = new HashMap<>();
        List<UUID> ordered = new ArrayList<>(distinctIds);
        for (int start = 0; start < ordered.size(); start += MAX_BATCH_SIZE) {
            List<UUID> chunk = ordered.subList(start, Math.min(start + MAX_BATCH_SIZE, ordered.size()));
            resolveChunk(chunk, result);
        }
        return result;
    }

    private void resolveChunk(List<UUID> chunk, Map<UUID, String> result) {
        try {
            List<InventoryCategoryClient.IngredientCategoryResponse> responses =
                    inventoryCategoryClient.getIngredientCategories(chunk);
            for (InventoryCategoryClient.IngredientCategoryResponse response : responses) {
                String categoryName = response.categoryName();
                if (categoryName == null || categoryName.isBlank()) {
                    result.put(response.ingredientId(), "Uncategorized");
                } else {
                    result.put(response.ingredientId(), categoryName);
                }
            }
        } catch (Exception e) {
            log.warn("Ingredient category resolution failed for {} ingredient id(s); degrading to "
                    + "'Uncategorized' rather than failing the spend report: {}", chunk.size(), e.getMessage());
            for (UUID id : chunk) {
                result.put(id, "Uncategorized");
            }
        }
    }
}
