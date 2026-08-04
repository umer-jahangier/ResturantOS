package io.restaurantos.pos.exception;

import io.restaurantos.shared.exception.ResourceNotFoundException;

/**
 * POS-specific exception factory and custom exception types.
 */
public class PosExceptions {

    public static class OrderNotFoundException extends ResourceNotFoundException {
        public OrderNotFoundException(String orderId) {
            super("Order not found: " + orderId);
        }
    }

    public static class ZeroValueOrderException extends RuntimeException {
        public ZeroValueOrderException(String message) {
            super(message);
        }
    }

    public static class TillAlreadyOpenException extends RuntimeException {
        public TillAlreadyOpenException(String cashierId) {
            super("Cashier already has an open till session: " + cashierId);
        }
    }

    public static class TillHasOpenOrdersException extends RuntimeException {
        public TillHasOpenOrdersException(String tillId) {
            super("Till has orders that are not closed or voided: " + tillId);
        }
    }

    /**
     * Raised when a cashier attempts to create an order without an OPEN till session.
     * Enforces the financial-integrity invariant "no order without an open drawer" — the
     * counterpart to {@link TillHasOpenOrdersException} (can't CLOSE a till with open orders).
     */
    public static class NoOpenTillException extends RuntimeException {
        public NoOpenTillException(String cashierId) {
            super("Cashier has no open till session; open a till before taking orders: " + cashierId);
        }
    }

    public static class TillNotFoundException extends ResourceNotFoundException {
        public TillNotFoundException(String tillId) {
            super("Till session not found: " + tillId);
        }
    }

    public static class PaymentMismatchException extends RuntimeException {
        public PaymentMismatchException(long expected, long actual) {
            super("Payment sum mismatch: expected " + expected + " but got " + actual);
        }
    }

    /**
     * A non-cash tender was presented for more than the outstanding balance. Cash over-tender is
     * legitimate and becomes change; a card or bank transfer for more than the bill is an input
     * error, and accepting it would put more debits than credits on the revenue journal entry.
     */
    public static class PaymentExceedsBalanceException extends RuntimeException {
        public PaymentExceedsBalanceException(String method, long amountPaisa, long outstandingPaisa) {
            super("A " + method + " payment of " + amountPaisa
                    + " paisa exceeds the outstanding balance of " + outstandingPaisa
                    + " paisa. Only CASH may be over-tendered (the difference is returned as change).");
        }
    }

    /** The bill is already settled in full. Guards the duplicate-payment path (POS-24). */
    public static class OrderAlreadyPaidException extends RuntimeException {
        public OrderAlreadyPaidException(String orderId) {
            super("Order is already paid in full; no further payment can be recorded: " + orderId);
        }
    }

    /**
     * The AR seam refused the charge — credit limit, suspended account, unknown account, or a
     * locked accounting period. finance-service's contract (10-18) requires POS to surface each of
     * these as a tender failure and NOT close the order on that tender.
     */
    public static class ChargeToAccountRefusedException extends RuntimeException {
        public ChargeToAccountRefusedException(String detail) {
            super("Charge to account was refused: " + detail);
        }
    }

    /** CHARGE_TO_ACCOUNT was selected without naming which house account to bill. */
    public static class CustomerAccountRequiredException extends RuntimeException {
        public CustomerAccountRequiredException() {
            super("A customer account is required for a charge-to-account tender");
        }
    }

    private PosExceptions() {}
}
