package io.restaurantos.shared.exception;

public class StateInvalidException extends RestaurantOsException {
    public StateInvalidException(String message) { super("STATE_INVALID", message); }
}
