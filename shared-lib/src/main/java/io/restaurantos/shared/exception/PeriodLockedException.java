package io.restaurantos.shared.exception;

public class PeriodLockedException extends RestaurantOsException {
    public PeriodLockedException(String message) { super("PERIOD_LOCKED", message); }
}
