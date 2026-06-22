package io.restaurantos.shared.exception;

import java.util.UUID;

public class TenantNotFoundException extends RestaurantOsException {
    public TenantNotFoundException(UUID tenantId) { super("NOT_FOUND", "Tenant not found: " + tenantId); }
    public TenantNotFoundException(String message) { super("NOT_FOUND", message); }
}
