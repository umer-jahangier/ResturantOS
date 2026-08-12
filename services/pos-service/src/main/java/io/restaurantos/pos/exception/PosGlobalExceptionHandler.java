package io.restaurantos.pos.exception;

import io.restaurantos.shared.exception.IdempotencyConflictException;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.PeriodLockedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.exception.StateInvalidException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.net.URI;

@RestControllerAdvice
public class PosGlobalExceptionHandler {

    @ExceptionHandler(StateInvalidException.class)
    public ResponseEntity<ProblemDetail> handleStateInvalid(StateInvalidException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("STATE_INVALID");
        pd.setType(URI.create("urn:restaurantos:pos:state-invalid"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    @ExceptionHandler({PosExceptions.OrderNotFoundException.class, ResourceNotFoundException.class})
    public ResponseEntity<ProblemDetail> handleNotFound(RuntimeException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("NOT_FOUND");
        pd.setType(URI.create("urn:restaurantos:pos:not-found"));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
    }

    @ExceptionHandler(PosExceptions.ZeroValueOrderException.class)
    public ResponseEntity<ProblemDetail> handleZeroValue(PosExceptions.ZeroValueOrderException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("ZERO_VALUE_ORDER");
        pd.setType(URI.create("urn:restaurantos:pos:zero-value-order"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }

    @ExceptionHandler(IdempotencyConflictException.class)
    public ResponseEntity<ProblemDetail> handleIdempotency(IdempotencyConflictException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("IDEMPOTENCY_CONFLICT");
        pd.setType(URI.create("urn:restaurantos:pos:idempotency-conflict"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    @ExceptionHandler(PermissionDeniedException.class)
    public ResponseEntity<ProblemDetail> handlePermission(PermissionDeniedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, ex.getMessage());
        pd.setTitle("FORBIDDEN");
        pd.setType(URI.create("urn:restaurantos:pos:forbidden"));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    @ExceptionHandler(PeriodLockedException.class)
    public ResponseEntity<ProblemDetail> handlePeriodLocked(PeriodLockedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.LOCKED, ex.getMessage());
        pd.setTitle("PERIOD_LOCKED");
        pd.setType(URI.create("urn:restaurantos:pos:period-locked"));
        return ResponseEntity.status(HttpStatus.LOCKED).body(pd);
    }

    @ExceptionHandler(PosExceptions.TillAlreadyOpenException.class)
    public ResponseEntity<ProblemDetail> handleTillAlreadyOpen(PosExceptions.TillAlreadyOpenException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("TILL_ALREADY_OPEN");
        pd.setType(URI.create("urn:restaurantos:pos:till-already-open"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    /**
     * F11. 403, not 409: the caller is not allowed to do this at all, whatever the drawer's state.
     * Its own title so the browser can print the named refusal instead of a generic "forbidden".
     */
    @ExceptionHandler(PosExceptions.TillOpenForOtherDeniedException.class)
    public ResponseEntity<ProblemDetail> handleTillOpenForOtherDenied(
            PosExceptions.TillOpenForOtherDeniedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.FORBIDDEN, ex.getMessage());
        pd.setTitle("TILL_OPEN_FOR_OTHER_DENIED");
        pd.setType(URI.create("urn:restaurantos:pos:till-open-for-other-denied"));
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(pd);
    }

    /**
     * F11. 422: the request is well-formed and the CALLER is entitled to make it — the named
     * target is the problem (not rostered here, or holds no role that may run a drawer, or the
     * directory that knows could not be reached).
     */
    @ExceptionHandler(PosExceptions.CashierNotEligibleForTillException.class)
    public ResponseEntity<ProblemDetail> handleCashierNotEligible(
            PosExceptions.CashierNotEligibleForTillException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("CASHIER_NOT_ELIGIBLE_FOR_TILL");
        pd.setType(URI.create("urn:restaurantos:pos:cashier-not-eligible-for-till"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }

    @ExceptionHandler(PosExceptions.TillHasOpenOrdersException.class)
    public ResponseEntity<ProblemDetail> handleTillHasOpenOrders(PosExceptions.TillHasOpenOrdersException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("TILL_HAS_OPEN_ORDERS");
        pd.setType(URI.create("urn:restaurantos:pos:till-has-open-orders"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    @ExceptionHandler(PosExceptions.NoOpenTillException.class)
    public ResponseEntity<ProblemDetail> handleNoOpenTill(PosExceptions.NoOpenTillException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("NO_OPEN_TILL");
        pd.setType(URI.create("urn:restaurantos:pos:no-open-till"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    @ExceptionHandler({PosExceptions.TillNotFoundException.class})
    public ResponseEntity<ProblemDetail> handleTillNotFound(PosExceptions.TillNotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setTitle("NOT_FOUND");
        pd.setType(URI.create("urn:restaurantos:pos:not-found"));
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
    }

    @ExceptionHandler(PosExceptions.PaymentMismatchException.class)
    public ResponseEntity<ProblemDetail> handlePaymentMismatch(PosExceptions.PaymentMismatchException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("PAYMENT_MISMATCH");
        pd.setType(URI.create("urn:restaurantos:pos:payment-mismatch"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }

    @ExceptionHandler(PosExceptions.PaymentExceedsBalanceException.class)
    public ResponseEntity<ProblemDetail> handlePaymentExceedsBalance(PosExceptions.PaymentExceedsBalanceException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("PAYMENT_EXCEEDS_BALANCE");
        pd.setType(URI.create("urn:restaurantos:pos:payment-exceeds-balance"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }

    @ExceptionHandler(PosExceptions.OrderAlreadyPaidException.class)
    public ResponseEntity<ProblemDetail> handleOrderAlreadyPaid(PosExceptions.OrderAlreadyPaidException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("ORDER_ALREADY_PAID");
        pd.setType(URI.create("urn:restaurantos:pos:order-already-paid"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    /**
     * 409, not 422: the request is well-formed and the caller is authorised — the ORDER is in a
     * state (money taken) where a void is not a legal operation. Same class of refusal as
     * ORDER_ALREADY_PAID, and the frontend branches on the 409 to swap Void for Refund.
     */
    @ExceptionHandler(PosExceptions.OrderHasPaymentsException.class)
    public ResponseEntity<ProblemDetail> handleOrderHasPayments(PosExceptions.OrderHasPaymentsException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setTitle("ORDER_HAS_PAYMENTS");
        pd.setType(URI.create("urn:restaurantos:pos:order-has-payments"));
        return ResponseEntity.status(HttpStatus.CONFLICT).body(pd);
    }

    @ExceptionHandler(PosExceptions.ChargeToAccountRefusedException.class)
    public ResponseEntity<ProblemDetail> handleChargeRefused(PosExceptions.ChargeToAccountRefusedException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("CHARGE_TO_ACCOUNT_REFUSED");
        pd.setType(URI.create("urn:restaurantos:pos:charge-to-account-refused"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }

    @ExceptionHandler(PosExceptions.CustomerAccountRequiredException.class)
    public ResponseEntity<ProblemDetail> handleCustomerAccountRequired(PosExceptions.CustomerAccountRequiredException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("CUSTOMER_ACCOUNT_REQUIRED");
        pd.setType(URI.create("urn:restaurantos:pos:customer-account-required"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }

    // Server-side validation failures raised explicitly by service methods (e.g.
    // instruction char-limit enforcement — RESEARCH.md Security Domain V5) that bypass
    // the MVC @Valid layer when called directly (service-layer tests, offline sync).
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ProblemDetail> handleValidation(IllegalArgumentException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.UNPROCESSABLE_ENTITY, ex.getMessage());
        pd.setTitle("VALIDATION_FAILED");
        pd.setType(URI.create("urn:restaurantos:pos:validation-failed"));
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(pd);
    }
}
