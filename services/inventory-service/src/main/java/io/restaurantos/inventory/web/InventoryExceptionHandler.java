package io.restaurantos.inventory.web;

import io.restaurantos.inventory.exception.MenuItemNotFoundException;
import io.restaurantos.shared.api.ApiError;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Inventory-service-local exception advice. shared-lib's {@code GlobalExceptionHandler} always
 * resolves {@code RestaurantOsException} to 400 (its {@code handleBase} catch-all), so a distinct
 * 404 for {@link MenuItemNotFoundException} requires its own advice bean here — Spring resolves
 * the MORE SPECIFIC exception-type handler across ALL @ControllerAdvice beans, so this coexists
 * safely alongside the shared handler for the RestaurantOsException supertype.
 */
@RestControllerAdvice
public class InventoryExceptionHandler {

    private String traceId() {
        String t = MDC.get("traceId");
        return t != null ? t : "unknown";
    }

    @ExceptionHandler(MenuItemNotFoundException.class)
    public ResponseEntity<ApiError> handleMenuItemNotFound(MenuItemNotFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }
}
