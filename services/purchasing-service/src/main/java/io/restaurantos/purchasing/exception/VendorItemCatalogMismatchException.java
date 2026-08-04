package io.restaurantos.purchasing.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Thrown when a purchase-order line's {@code vendorItemId} does not resolve to an active catalog
 * row belonging to the purchase order's own vendor, under the caller's own tenant (T-08.2-101
 * cross-vendor guard, T-08.2-102 cross-tenant guard). A nonexistent id, an archived row, a
 * different vendor's row and a different tenant's row are all indistinguishable to the caller —
 * each is simply "not in this vendor's active catalog" — so they share this one exception rather
 * than leaking which specific reason applied.
 *
 * <p>Maps to HTTP 422 via {@code PurchasingExceptionHandler}, following the same dedicated-{@code
 * @ExceptionHandler} pattern as inventory-service's {@code IngredientCategoryInvalidException}: a
 * bare {@code @ResponseStatus} exception here would silently resolve to 500 once shared-lib's
 * {@code GlobalExceptionHandler}'s {@code @ExceptionHandler(Exception.class)} catch-all is in the
 * chain (the exact latent defect documented in 08.2-08-SUMMARY.md's Deviations section).
 */
public class VendorItemCatalogMismatchException extends RestaurantOsException {
    public VendorItemCatalogMismatchException(String message) {
        super("VENDOR_ITEM_CATALOG_MISMATCH", message);
    }
}
