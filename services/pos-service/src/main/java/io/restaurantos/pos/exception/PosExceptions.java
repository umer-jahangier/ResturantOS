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

    private PosExceptions() {}
}
