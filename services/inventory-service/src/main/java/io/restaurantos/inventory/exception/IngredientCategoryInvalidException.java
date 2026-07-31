package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Thrown by {@code IngredientService} when a create/update request's {@code categoryId} resolves
 * to a category that exists for the tenant but cannot be assigned right now — currently only the
 * archived case (T-08.2-093's tenant-foreign case is instead a plain 404 via
 * {@code ResourceNotFoundException}, since the row is simply not visible to this tenant). Maps to
 * HTTP 422 {@code INGREDIENT_CATEGORY_INVALID} via {@code InventoryExceptionHandler} — distinct
 * from 404 (not found) and 400 (missing/malformed) because the category id is well-formed and
 * exists, it just cannot be used as a primary category in its current state.
 */
public class IngredientCategoryInvalidException extends RestaurantOsException {
    public IngredientCategoryInvalidException(String message) {
        super("INGREDIENT_CATEGORY_INVALID", message);
    }
}
