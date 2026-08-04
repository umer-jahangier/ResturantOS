package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.exception.ApprovalLimitExceededException;
import io.restaurantos.purchasing.exception.DuplicateApproverException;
import io.restaurantos.purchasing.exception.IngredientNotInTenantException;
import io.restaurantos.purchasing.exception.InvalidPoStateException;
import io.restaurantos.purchasing.exception.InventoryUnavailableException;
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

    /**
     * 503, not a 4xx — inventory being unreachable says nothing about whether the caller's request
     * was valid, and telling someone to fix input that is not wrong wastes their time. Retryable
     * and honest, mirroring inventory-service's own {@code FinanceUnavailableException} handling.
     */
    @ExceptionHandler(InventoryUnavailableException.class)
    public ResponseEntity<ApiError> handleInventoryUnavailable(InventoryUnavailableException ex) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiError.of(ex.getCode(), ex.getMessage(), traceId()));
    }

    /**
     * The three approval/lifecycle refusals below all declare a {@code @ResponseStatus} and none of
     * it ever reached a client. Spring resolves an {@code @ExceptionHandler} by exception hierarchy
     * before it considers {@code @ResponseStatus}, and shared-lib's {@code GlobalExceptionHandler}
     * declares {@code @ExceptionHandler(Exception.class)} — so every one of them came back
     * <b>500 INTERNAL_ERROR</b>. {@code BackdatedPriceException} documents the same trap and dodges
     * it by extending {@code RestaurantOsException}; these three did not.
     *
     * <p>The cost was not academic. The PO detail page already translates
     * {@code APPROVAL_LIMIT_EXCEEDED} and {@code DUPLICATE_APPROVER} into sentences a buyer can act
     * on, and the MSW handlers return exactly those codes at 403/409 — so the frontend was written
     * and tested against a contract the real backend never honoured. Approving your own second tier
     * showed "an unexpected error occurred" instead of "you have already approved this".
     *
     * <p>Codes are preserved verbatim because the frontend branches on them.
     */
    @ExceptionHandler(ApprovalLimitExceededException.class)
    public ResponseEntity<ApiError> handleApprovalLimit(ApprovalLimitExceededException ex) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ApiError.of("APPROVAL_LIMIT_EXCEEDED",
                        "This purchase order exceeds your approval limit", traceId()));
    }

    @ExceptionHandler(DuplicateApproverException.class)
    public ResponseEntity<ApiError> handleDuplicateApprover(DuplicateApproverException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiError.of("DUPLICATE_APPROVER",
                        "You have already approved this purchase order", traceId()));
    }

    /**
     * 409, not the 400 the annotation declared: nothing is wrong with the request, the purchase
     * order is simply not in a state where this is legal. Matches shared-lib's
     * {@code StateInvalidException} so the two read the same to a client.
     */
    @ExceptionHandler(InvalidPoStateException.class)
    public ResponseEntity<ApiError> handleInvalidPoState(InvalidPoStateException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ApiError.of("INVALID_PO_STATE", ex.getMessage(), traceId()));
    }
}
