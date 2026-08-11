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
        String imageUrl,
        /**
         * Where this item ACTUALLY fires at the requested branch (28-05), and the code and type of
         * that station.
         *
         * <p>Resolved server-side by {@code StationRoutingResolver}, which walks item route →
         * category route → legacy FK (branch-checked) → legacy free text → nothing. Sent rather
         * than left to the client, so plan 28-10's picker can show what a dish currently does
         * without reimplementing that order in TypeScript — a second copy of a resolution rule is
         * a second answer, and the two disagree the first time a step is added.
         *
         * <p>Null when nothing resolves, which is what an unconfigured item has always been and
         * which the fire path renders as the DEFAULT key.
         */
        UUID effectiveStationId,
        String effectiveStationCode,
        String effectiveStationName
) {
    /** The single place the download route is spelled out for menu images. */
    public static String imageUrlFor(UUID imageFileId) {
        return imageFileId == null ? null : "/api/v1/files/" + imageFileId + "/download";
    }
}
