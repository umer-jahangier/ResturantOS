package io.restaurantos.shared.api;

import java.util.List;

/** Error body: { "error": { code, message, details, trace_id } }. */
public record ApiError(Error error) {
    public record Error(String code, String message, List<FieldError> details, String traceId) {}
    public record FieldError(String field, String issue) {}
    public static ApiError of(String code, String message, String traceId) {
        return new ApiError(new Error(code, message, List.of(), traceId));
    }
    public static ApiError of(String code, String message, List<FieldError> details, String traceId) {
        return new ApiError(new Error(code, message, details, traceId));
    }
}
