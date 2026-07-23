package io.restaurantos.inventory.web;

import io.restaurantos.inventory.exception.CategoryInUseException;
import io.restaurantos.inventory.exception.IngredientCategoryInvalidException;
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

    /**
     * D-04 archive-refusal (INV-13) — a category still referenced by a non-archived child or an
     * ingredient is never deleted, it is refused with a 409 the "Archive category" dialog can
     * render verbatim (08.2-UI-SPEC.md Copywriting Contract).
     */
    @ExceptionHandler(CategoryInUseException.class)
    public ResponseEntity<ApiError> handleCategoryInUse(CategoryInUseException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiError.of("CATEGORY_IN_USE", ex.getMessage(), traceId()));
    }

    /**
     * T-08.2-093 / D-02 (08.2-09): the requested {@code categoryId} exists for the tenant but is
     * archived, so it cannot be assigned as a primary category. A tenant-foreign or nonexistent
     * id is instead a plain 404 via {@code ResourceNotFoundException} — this handler is only for
     * "found, but not currently assignable."
     */
    @ExceptionHandler(IngredientCategoryInvalidException.class)
    public ResponseEntity<ApiError> handleIngredientCategoryInvalid(IngredientCategoryInvalidException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of("INGREDIENT_CATEGORY_INVALID", ex.getMessage(), traceId()));
    }
}
