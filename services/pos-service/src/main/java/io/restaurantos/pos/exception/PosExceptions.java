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
