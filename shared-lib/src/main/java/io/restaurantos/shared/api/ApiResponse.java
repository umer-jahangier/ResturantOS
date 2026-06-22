package io.restaurantos.shared.api;

import java.util.List;

public record ApiResponse<T>(T data, PageMeta meta, List<ApiWarning> warnings) {
    public static <T> ApiResponse<T> ok(T data) { return new ApiResponse<>(data, null, List.of()); }
    public static <T> ApiResponse<List<T>> paginated(List<T> data, PageMeta meta) { return new ApiResponse<>(data, meta, List.of()); }
    public record ApiWarning(String code, String message) {}
}
