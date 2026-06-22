package io.restaurantos.shared.exception;

import java.util.UUID;

public class ResourceNotFoundException extends RestaurantOsException {
    public ResourceNotFoundException(String type, UUID id) { super("NOT_FOUND", type + " not found: " + id); }
    public ResourceNotFoundException(String message) { super("NOT_FOUND", message); }
}
