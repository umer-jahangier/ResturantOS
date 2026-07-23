package io.restaurantos.purchasing.service;

import java.util.Collection;
import java.util.Map;
import java.util.UUID;

/**
 * Resolves spend-analytics category labels for a batch of ingredient ids in one call. This is the
 * real, inventory-service-backed seam (08.2-09/08.2-11, D-09): {@code FeignIngredientCategoryResolver}
 * calls {@code GET /internal/inventory/ingredient-categories}, gated on
 * {@code restaurantos.inventory.integration-mode}, mirroring the {@code GrnDataPort} mock/feign seam
 * already used for GRN data. The classpath-backed category-map mock this replaced has been deleted
 * from the repository, not merely bypassed.
 *
 * <p>Deliberately batch-only: there is no single-id overload, so a caller cannot reintroduce
 * per-invoice-line resolution (T-08.2-113) — {@link #resolveAll} must be called once per report.
 */
public interface IngredientCategoryResolver {

    /**
     * @param ingredientIds the distinct ingredient ids needed for a report; a null/empty collection
     *                      returns an empty map
     * @return ingredientId -> category name for every id that could be resolved; an id absent from
     * the result is the caller's responsibility to default (typically to {@code Uncategorized})
     */
    Map<UUID, String> resolveAll(Collection<UUID> ingredientIds);
}
