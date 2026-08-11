package io.restaurantos.purchasing.adapter;

import io.restaurantos.purchasing.exception.IngredientNotInTenantException;
import io.restaurantos.purchasing.feign.InventoryCategoryClient;
import io.restaurantos.purchasing.service.IngredientReferenceValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Feign-backed {@link IngredientReferenceValidator}, active whenever
 * {@code restaurantos.inventory.validate-references} is on — which is the default (T-08.2-044):
 * confirms an {@code ingredientId} resolves to a live ingredient in the caller's tenant before a
 * vendor-catalog row referencing it is persisted.
 *
 * <p>Reuses the existing {@link InventoryCategoryClient} internal lookup
 * ({@code GET /internal/inventory/ingredient-categories}, shipped in plan 08.2-09) rather than
 * introducing a new endpoint — the same tenant / X-Internal-Service / JWT header propagation the
 * spend-analytics category resolver already relies on (via {@code FeignClientConfig}) applies here
 * unchanged. That endpoint returns an entry for <em>every</em> requested id: a real, in-tenant
 * ingredient carries a non-null {@code categoryId} (ingredients have a NOT NULL category FK since
 * plan 08.2-01), while an unknown or foreign id comes back with a {@code null categoryId}. Presence
 * of a non-null {@code categoryId} is therefore the existence-and-ownership signal.
 *
 * <p>Degrades open on a transport failure — consistent with the same seam's resilience contract
 * (T-08.2-112): if inventory-service is briefly unreachable the create is allowed (and logged)
 * rather than coupling vendor-catalog availability to inventory-service uptime. A definitive
 * "does not exist" answer (endpoint reachable, no non-null-category match) is fail-closed.
 */
@Component
@ConditionalOnProperty(name = "restaurantos.inventory.validate-references", havingValue = "true",
        matchIfMissing = true)
public class FeignIngredientReferenceValidator implements IngredientReferenceValidator {

    private static final Logger log = LoggerFactory.getLogger(FeignIngredientReferenceValidator.class);

    private final InventoryCategoryClient inventoryCategoryClient;

    public FeignIngredientReferenceValidator(InventoryCategoryClient inventoryCategoryClient) {
        this.inventoryCategoryClient = inventoryCategoryClient;
    }

    @Override
    public void requireIngredientInTenant(UUID ingredientId) {
        if (ingredientId == null) {
            // @NotNull on the request already rejects this; nothing to resolve.
            return;
        }
        boolean exists;
        try {
            List<InventoryCategoryClient.IngredientCategoryResponse> responses =
                    inventoryCategoryClient.getIngredientCategories(List.of(ingredientId));
            exists = responses.stream()
                    .anyMatch(r -> ingredientId.equals(r.ingredientId()) && r.categoryId() != null);
        } catch (Exception e) {
            log.warn("Ingredient existence check could not reach inventory-service for {}; allowing "
                    + "vendor-item create (degrade-open, T-08.2-112): {}", ingredientId, e.getMessage());
            return;
        }
        if (!exists) {
            throw new IngredientNotInTenantException(
                    "Ingredient " + ingredientId + " does not exist in this tenant's inventory");
        }
    }
}
