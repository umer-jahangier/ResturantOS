package io.restaurantos.pos.dto;

import java.math.BigDecimal;
import java.util.UUID;

/**
 * {@code imageUrl} is DERIVED from {@code imageFileId}, never stored. Persisting a URL would
 * bake a route into every row and go stale the day that route changes; deriving it means the
 * database holds an identity and the API holds a location, which is the correct split.
 *
 * <p>Both are on the wire because the client needs both: {@code imageUrl} to render, and
 * {@code imageFileId} to echo back unchanged on the next update (an edit that only changed the
 * price must not silently drop the picture).
 */
public record MenuItemDto(
        UUID id,
        UUID categoryId,
        String categoryName,
        String name,
        String description,
        long basePricePaisa,
        BigDecimal taxRatePct,
        String taxRateCode,
        String kdsStation,
        boolean active,
        Long overridePricePaisa,
        UUID stationId,
        UUID imageFileId,
        String imageUrl
) {
    /** The single place the download route is spelled out for menu images. */
    public static String imageUrlFor(UUID imageFileId) {
        return imageFileId == null ? null : "/api/v1/files/" + imageFileId + "/download";
    }
}
