package io.restaurantos.purchasing.service;

import java.util.UUID;

/**
 * Validates that an {@code ingredientId} supplied when creating a {@link
 * io.restaurantos.purchasing.domain.model.VendorItem} resolves to a live ingredient owned by the
 * caller's tenant (T-08.2-044). {@code ingredients} lives in inventory-service's database, so a
 * cross-database FK is impossible; plan 08.2-04 deferred this to a service-layer check that was
 * never delivered — a tenant could persist a catalog row referencing an arbitrary or another
 * tenant's ingredient id, which then propagates onto PO lines and spend analytics as a dangling
 * reference.
 *
 * <p>Deliberately mode-gated exactly like {@link IngredientCategoryResolver}: the real,
 * inventory-service-backed check only runs under {@code restaurantos.inventory.integration-mode=feign}
 * (mirroring the GRN / category-resolution seams). Under {@code integration-mode=mock} there is no
 * reachable inventory-service, so the check is a permissive no-op — mock mode never breaks vendor
 * catalog creation.
 */
public interface IngredientReferenceValidator {

    /**
     * @param ingredientId the ingredient a new vendor-catalog row will reference
     * @throws io.restaurantos.purchasing.exception.IngredientNotInTenantException if inventory-service
     *         is reachable and confirms the id does not resolve to a live ingredient in this tenant
     */
    void requireIngredientInTenant(UUID ingredientId);
}
