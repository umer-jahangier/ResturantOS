package io.restaurantos.shared.api;

public record PageMeta(Page page, Long totalCount) {
    public record Page(String cursor, String nextCursor, int limit) {}
}
