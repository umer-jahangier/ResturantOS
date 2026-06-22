package io.restaurantos.shared.exception;

public class QuotaExceededException extends RestaurantOsException {
    private final String resource;
    public QuotaExceededException(String resource, String message) { super("QUOTA_EXCEEDED", message); this.resource = resource; }
    public String getResource() { return resource; }
}
