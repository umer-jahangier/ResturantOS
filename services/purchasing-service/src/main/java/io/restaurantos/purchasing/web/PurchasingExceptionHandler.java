package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.exception.IngredientNotInTenantException;
import io.restaurantos.purchasing.exception.VendorItemCatalogMismatchException;
import io.restaurantos.shared.api.ApiError;
import org.slf4j.MDC;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Purchasing-service-local exception advice, mirroring inventory-service's {@code
 * InventoryExceptionHandler}. shared-lib's {@code GlobalExceptionHandler} always resolves {@code
 * RestaurantOsException} to 400 (its {@code handleBase} catch-all), so the 422 this plan's PO-line
 * catalog validation needs requires its own advice bean here — Spring resolves the MORE SPECIFIC
 * exception-type handler across ALL {@code @ControllerAdvice} beans, so this coexists safely
 * alongside the shared handler for the {@code RestaurantOsException} supertype.
 */
@RestControllerAdvice
public class PurchasingExceptionHandler {

    private String traceId() {
        String t = MDC.get("traceId");
        return t != null ? t : "unknown";
    }

    @ExceptionHandler(VendorItemCatalogMismatchException.class)
    public ResponseEntity<ApiError> handleVendorItemCatalogMismatch(VendorItemCatalogMismatchException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    @ExceptionHandler(IngredientNotInTenantException.class)
    public ResponseEntity<ApiError> handleIngredientNotInTenant(IngredientNotInTenantException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }
}
