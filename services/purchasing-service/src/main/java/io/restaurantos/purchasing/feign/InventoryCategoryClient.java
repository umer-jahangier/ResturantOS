package io.restaurantos.purchasing.feign;

import io.restaurantos.purchasing.config.FeignClientConfig;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

import java.util.List;
import java.util.UUID;

/**
 * Real ingredient-category batch lookup (08.2-09, D-09): the seam
 * {@code FeignIngredientCategoryResolver} calls to replace the deleted classpath category-map
 * mock. The internal endpoint caps a single call at 500 ids
 * (T-08.2-096) — the resolver chunks larger id sets rather than raising the limit here. Unused
 * while {@code integration-mode=mock}.
 *
 * <p>{@code contextId} is required here: {@link InventoryGrnClient} already declares a
 * {@code @FeignClient(name = "inventory-service", ...)} for the same downstream service, and
 * Spring Cloud OpenFeign registers one {@code FeignClientSpecification} bean per {@code name}
 * (or {@code contextId} when present) — two clients sharing a bare {@code name} collide with a
 * {@code BeanDefinitionOverrideException} at context startup.
 */
@FeignClient(name = "inventory-service", contextId = "inventoryCategoryClient", configuration = FeignClientConfig.class)
public interface InventoryCategoryClient {

    @GetMapping("/internal/inventory/ingredient-categories")
    List<IngredientCategoryResponse> getIngredientCategories(@RequestParam("ingredientIds") List<UUID> ingredientIds);

    /** Mirrors {@code InventoryDtos.IngredientCategoryLookupDto} on the inventory-service side field-for-field. */
    record IngredientCategoryResponse(
            UUID ingredientId,
            UUID categoryId,
            String categoryName,
            String categoryPath
    ) {}
}
