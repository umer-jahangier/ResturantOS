package io.restaurantos.inventory.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Thrown by {@code ItemCategoryService} when a create/move request would violate the D-02
 * 3-level depth cap or the re-parent cycle guard — a readable, client-facing rejection produced
 * before the request ever reaches {@code trg_item_category_depth}, the database's own
 * enforcement point. Not caught by a dedicated {@code InventoryExceptionHandler} handler — falls
 * through to shared-lib's {@code GlobalExceptionHandler#handleBase}, which maps any bare
 * {@link RestaurantOsException} to HTTP 400.
 */
public class CategoryValidationException extends RestaurantOsException {
    public CategoryValidationException(String message) {
        super("CATEGORY_VALIDATION_FAILED", message);
    }
}
