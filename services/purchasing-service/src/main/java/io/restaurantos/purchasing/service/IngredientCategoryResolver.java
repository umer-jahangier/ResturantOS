package io.restaurantos.purchasing.service;

import java.util.UUID;

/**
 * Resolves a spend-analytics category label for an ingredient. Mock-first seam (PUR-06): Phase 10 ships
 * {@link MockIngredientCategoryResolver}, which reads a classpath map with no inventory-service dependency.
 * Phase 8 will add a feign-backed resolver keyed on {@code restaurantos.inventory.integration-mode},
 * mirroring the {@code GrnDataPort} mock/feign seam already used for GRN data.
 */
public interface IngredientCategoryResolver {

    String resolve(UUID ingredientId);
}
