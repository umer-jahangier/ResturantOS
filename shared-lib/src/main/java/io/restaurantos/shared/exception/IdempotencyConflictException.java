package io.restaurantos.shared.exception;

public class IdempotencyConflictException extends RestaurantOsException {
    public IdempotencyConflictException(String message) { super("IDEMPOTENCY_KEY_CONFLICT", message); }
}
