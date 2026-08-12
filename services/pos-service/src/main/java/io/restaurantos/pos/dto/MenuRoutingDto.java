package io.restaurantos.pos.dto;

import java.util.List;
import java.util.UUID;

/**
 * Everything the station-routing screen needs, for ONE branch, in one read (S1-01).
 *
 * <h2>Why this exists at all</h2>
 *
 * <p>Routing has been writable since 28-05 — {@code PUT /menu/items/{id}/station} and
 * {@code PUT /menu/categories/{id}/station} both work and both persist. It has never been
 * READABLE. {@code MenuItemDto} carries the item's <em>effective</em> destination, but nothing
 * anywhere returns a CATEGORY's route, so a screen could write "all Drinks go to the bar" and
 * then had no way to show that it had. Inferring the category rule from its items' effective
 * stations is not a substitute: it is wrong for an empty category, wrong for a category where
 * every item is individually overridden, and it is a second copy of a resolution rule that lives
 * in exactly one place today.
 *
 * <h2>The two station fields on an item are different questions</h2>
 *
 * <p>{@code stationId} is <b>this item's own route at this branch</b> — null means "no exception
 * set", which the screen renders as "Follow the category". {@code effectiveStationId} is
 * <b>where the item actually fires</b>, resolved by {@link
 * io.restaurantos.pos.service.StationRoutingResolver} and never re-derived here. {@code source}
 * says which rule produced it, so the screen can label an inherited route as inherited instead of
 * making it look like a per-item choice somebody made.
 */
public record MenuRoutingDto(
        UUID branchId,
        List<CategoryRoute> categories,
        List<ItemRoute> items
) {

    /** Which rule produced an item's effective station. */
    public enum RouteSource {
        /** The item's own per-branch route. */
        ITEM,
        /** The item's category's per-branch route. */
        CATEGORY,
        /**
         * The pre-28-05 columns on {@code menu_items} (branch-checked). Shown distinctly because
         * an admin who has never opened this screen still has routing, and telling them it came
         * from the old data is more useful than presenting it as something they configured.
         */
        LEGACY,
        /** Nothing resolves — the ticket lands on the DEFAULT board. */
        NONE
    }

    public record CategoryRoute(
            UUID categoryId,
            String categoryName,
            int sortOrder,
            boolean active,
            /** The category's route AT THIS BRANCH, or null when it has none. */
            UUID stationId,
            String stationCode,
            String stationName
    ) {}

    public record ItemRoute(
            UUID itemId,
            String itemName,
            UUID categoryId,
            String categoryName,
            boolean active,
            /** The item's OWN route at this branch — null means "follow the category". */
            UUID stationId,
            UUID effectiveStationId,
            String effectiveStationCode,
            String effectiveStationName,
            RouteSource source
    ) {}
}
