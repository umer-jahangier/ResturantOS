package io.restaurantos.shared.exception;

public abstract class RestaurantOsException extends RuntimeException {
    private final String code;
    protected RestaurantOsException(String code, String message) { super(message); this.code = code; }
    protected RestaurantOsException(String code, String message, Throwable cause) { super(message, cause); this.code = code; }
    public String getCode() { return code; }
}
