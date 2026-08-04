package io.restaurantos.purchasing.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Thrown when a new vendor-catalog row's {@code ingredientId} does not resolve to a live ingredient
 * owned by the caller's tenant (T-08.2-044). A nonexistent id and another tenant's real id are
 * indistinguishable to the caller — both are simply "not an ingredient in your inventory" — so they
 * share this one exception rather than leaking which case applied.
 *
 * <p>Maps to HTTP 422 via {@code PurchasingExceptionHandler}, following the same dedicated-{@code
 * @ExceptionHandler} pattern as its sibling cross-tenant guard {@link
 * VendorItemCatalogMismatchException}: a bare {@code @ResponseStatus} exception would silently
 * resolve to 400 through shared-lib's {@code GlobalExceptionHandler#handleBase} catch-all for
 * {@code RestaurantOsException}.
 */
public class IngredientNotInTenantException extends RestaurantOsException {
    public IngredientNotInTenantException(String message) {
        super("INGREDIENT_NOT_FOUND", message);
    }
}
