package io.restaurantos.purchasing.exception;

import io.restaurantos.shared.exception.RestaurantOsException;

/**
 * Inventory-service could not be reached while building order suggestions. Maps to HTTP 503 via
 * {@code PurchasingExceptionHandler}.
 *
 * <p>503 and not a partial answer: the suggestion list is something a buyer acts on directly, so
 * quietly returning the subset that happened to resolve would omit exactly the items about to run
 * out. A retryable failure is honest; a short list that looks complete is not.
 */
public class InventoryUnavailableException extends RestaurantOsException {

    public InventoryUnavailableException(String message, Throwable cause) {
        super("INVENTORY_UNAVAILABLE", message);
        initCause(cause);
    }
}
