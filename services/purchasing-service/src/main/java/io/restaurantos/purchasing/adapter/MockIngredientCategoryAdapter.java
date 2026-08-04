package io.restaurantos.purchasing.adapter;

import io.restaurantos.purchasing.service.IngredientCategoryResolver;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Degraded-mode stub {@link IngredientCategoryResolver} for {@code integration-mode=mock} (08.2-11,
 * D-09). The classpath-backed category-map mock that used to fill this role has been deleted from
 * the repository per D-09 ("delete the mock, don't bypass it") — mock mode no longer produces
 * fabricated category names, it simply resolves
 * everything to "Uncategorized" so the Spring context still has exactly one
 * {@link IngredientCategoryResolver} bean and boots without a real inventory-service dependency.
 * Real category resolution only happens under {@code integration-mode=feign} via
 * {@link FeignIngredientCategoryResolver}.
 */
@Component
@ConditionalOnProperty(name = "restaurantos.inventory.integration-mode", havingValue = "mock", matchIfMissing = true)
public class MockIngredientCategoryAdapter implements IngredientCategoryResolver {

    @Override
    public Map<UUID, String> resolveAll(Collection<UUID> ingredientIds) {
        if (ingredientIds == null || ingredientIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> result = new HashMap<>();
        for (UUID id : ingredientIds) {
            if (id != null) {
                result.put(id, "Uncategorized");
            }
        }
        return result;
    }
}
