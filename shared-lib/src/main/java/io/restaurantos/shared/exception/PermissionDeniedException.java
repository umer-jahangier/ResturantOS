package io.restaurantos.shared.exception;

public class PermissionDeniedException extends RestaurantOsException {
    public PermissionDeniedException(String message) { super("PERMISSION_DENIED", message); }
    public PermissionDeniedException(String message, Throwable cause) { super("PERMISSION_DENIED", message, cause); }
}
