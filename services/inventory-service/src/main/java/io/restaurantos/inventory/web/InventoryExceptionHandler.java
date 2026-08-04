package io.restaurantos.inventory.web;

import io.restaurantos.inventory.exception.CategoryInUseException;
import io.restaurantos.inventory.exception.CategoryNameDuplicateException;
import io.restaurantos.inventory.exception.CountVarianceOverCapException;
import io.restaurantos.inventory.exception.FinanceUnavailableException;
import io.restaurantos.inventory.exception.GlAccountInvalidException;
import io.restaurantos.inventory.exception.IngredientCategoryInvalidException;
import io.restaurantos.inventory.exception.ItemTypeInvalidException;
import io.restaurantos.inventory.exception.MenuItemNotFoundException;
import io.restaurantos.inventory.exception.StorageLocationInvalidException;
import io.restaurantos.inventory.exception.UomInvalidException;
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
     * {@code uq_item_category_tenant_parent_name} pre-check tripped by create/rename/move — a
     * sibling under the same parent (or another root) already has this name. 409, same footing as
     * {@link CategoryInUseException}: the request is well-formed, it collides with an existing row.
     */
    @ExceptionHandler(CategoryNameDuplicateException.class)
    public ResponseEntity<ApiError> handleCategoryNameDuplicate(CategoryNameDuplicateException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
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

    /**
     * Unknown, mismatched or self-referential unit codes on an ingredient write — 422 for the same
     * reason as {@link IngredientCategoryInvalidException} above: the payload is well-formed, it
     * just names units the tenant does not have or cannot combine. The exception carries its own
     * code ({@code UOM_NOT_FOUND} / {@code UOM_DIMENSION_MISMATCH} / {@code UOM_CONVERSION_INVALID})
     * so the form can highlight the offending field rather than showing one generic message.
     */
    @ExceptionHandler(UomInvalidException.class)
    public ResponseEntity<ApiError> handleUomInvalid(UomInvalidException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    /**
     * A category's GL account reference does not resolve to a usable account — 422, same footing
     * as the category and unit validations it sits beside. The per-case code
     * ({@code GL_ACCOUNT_NOT_FOUND} / {@code _INACTIVE} / {@code _TYPE_INVALID}) lets the form mark
     * the offending field instead of showing one generic message for three different mistakes.
     */
    @ExceptionHandler(GlAccountInvalidException.class)
    public ResponseEntity<ApiError> handleGlAccountInvalid(GlAccountInvalidException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    /**
     * 503, NOT 422 — finance-service being unreachable says nothing about whether the user's input
     * was valid. A 4xx here would tell them to fix something that is not wrong; a 503 is honest and
     * retryable. The write is refused rather than persisting an unverified account code, which is
     * the whole point of validating these against finance in the first place.
     */
    /**
     * A count line exceeded its category's variance cap with no reason given — 422, and explicitly
     * NOT a permanent refusal. The same request resubmitted with a reason on the offending lines
     * posts fine; the cap exists to make a large write-off deliberate and attributed, not to insist
     * physical reality match the system.
     */
    @ExceptionHandler(CountVarianceOverCapException.class)
    public ResponseEntity<ApiError> handleCountVarianceOverCap(CountVarianceOverCapException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    /**
     * {@code itemType} and {@code producedByRecipeId} disagree — 422, alongside the other
     * well-formed-but-unacceptable payloads above. A named recipe that does not exist is instead a
     * plain 404 via {@code ResourceNotFoundException}, matching how a bad {@code categoryId} is
     * already handled.
     */
    @ExceptionHandler(ItemTypeInvalidException.class)
    public ResponseEntity<ApiError> handleItemTypeInvalid(ItemTypeInvalidException ex) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    /**
     * Storage-location writes and references. 409 for {@code STORAGE_LOCATION_IN_USE} — an archive
     * blocked by live ingredients is a state conflict, the same situation and the same status
     * {@link CategoryInUseException} already answers with — and 422 for the rest, which are
     * malformed references rather than conflicts.
     */
    @ExceptionHandler(StorageLocationInvalidException.class)
    public ResponseEntity<ApiError> handleStorageLocationInvalid(StorageLocationInvalidException ex) {
        HttpStatus status = "STORAGE_LOCATION_IN_USE".equals(ex.getCode())
                ? HttpStatus.CONFLICT
                : HttpStatus.UNPROCESSABLE_ENTITY;
        return ResponseEntity.status(status).body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    @ExceptionHandler(FinanceUnavailableException.class)
    public ResponseEntity<ApiError> handleFinanceUnavailable(FinanceUnavailableException ex) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }
}
