package io.restaurantos.purchasing.adapter;

import io.restaurantos.purchasing.service.IngredientReferenceValidator;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * Permissive {@link IngredientReferenceValidator} for {@code integration-mode=mock} (the default,
 * {@code matchIfMissing = true}). Mock mode has no reachable inventory-service, so — exactly like
 * {@link MockIngredientCategoryAdapter} degrades category resolution to "Uncategorized" — there is
 * nothing to check against and the reference is trusted. This keeps the Spring context to exactly
 * one {@link IngredientReferenceValidator} bean and never breaks vendor catalog creation in dev or
 * integration tests. Real cross-tenant validation (T-08.2-044) happens only under
 * {@code integration-mode=feign} via {@link FeignIngredientReferenceValidator}.
 */
@Component
@ConditionalOnProperty(name = "restaurantos.inventory.integration-mode", havingValue = "mock", matchIfMissing = true)
public class MockIngredientReferenceValidator implements IngredientReferenceValidator {

    @Override
    public void requireIngredientInTenant(UUID ingredientId) {
        // No-op: inventory-service is not reachable in mock mode, so the reference is trusted.
    }
}
