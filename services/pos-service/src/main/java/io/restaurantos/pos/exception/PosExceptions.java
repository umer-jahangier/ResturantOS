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

    private PosExceptions() {}
}
