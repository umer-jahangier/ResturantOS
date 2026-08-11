package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.repository.MenuCategoryStationRouteRepository;
import io.restaurantos.pos.repository.MenuItemStationRouteRepository;
import io.restaurantos.pos.repository.StationRepository;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/**
 * The ONE place that decides where a menu item goes, at a given branch (28-05).
 *
 * <h2>Resolution order</h2>
 *
 * <ol>
 *   <li><b>The item-level route for this branch.</b> The most specific answer wins.</li>
 *   <li><b>The category-level route for this branch.</b> "All drinks go to the bar", with the
 *       per-item route above as the exception mechanism.</li>
 *   <li><b>The legacy {@code menu_items.station_id} — ONLY IF that station belongs to THIS
 *       branch.</b></li>
 *   <li><b>The legacy free-text {@code menu_items.kds_station}, matched against a station code in
 *       this branch.</b></li>
 *   <li><b>Nothing</b>, which the caller renders as the DEFAULT key.</li>
 * </ol>
 *
 * <h2>Step 3 is the bug fix, not a fallback</h2>
 *
 * <p>Today that column applies regardless of branch. A shared menu item has one {@code station_id},
 * so an admin at Branch B assigning it to B's grill re-points the same item for Branch A — and A's
 * tickets then route to a station id that belongs to another building. With the branch check, the
 * legacy value STOPS APPLYING to the wrong branch instead of mis-routing it: A falls through to
 * step 4, then to DEFAULT, which is where an unconfigured item was always going to land. The
 * failure mode changes from "wrong kitchen" to "unconfigured", and only one of those is recoverable
 * by looking at a screen.
 *
 * <h2>Steps 3 to 5 reproduce today's behaviour byte for byte</h2>
 *
 * <p>For a tenant who configures no routes at all — every tenant, the day this ships — steps 1 and
 * 2 find nothing and the resolver behaves exactly as the code it replaces did, with the single
 * exception above, which only ever fires on data that was already corrupt. That is the whole
 * back-compatibility story and it is why the legacy steps stay rather than being migrated away.
 *
 * <h2>Why it is a standalone service</h2>
 *
 * <p>So it can be unit-tested without constructing an order, an HTTP context or a fire. A routing
 * rule that can only be exercised through {@code addItem} is a routing rule whose edge cases get
 * asserted through six layers of setup, which is how they stop being asserted.
 */
@Service
public class StationRoutingResolver {

    private final MenuItemStationRouteRepository itemRoutes;
    private final MenuCategoryStationRouteRepository categoryRoutes;
    private final StationRepository stationRepository;

    public StationRoutingResolver(MenuItemStationRouteRepository itemRoutes,
                                  MenuCategoryStationRouteRepository categoryRoutes,
                                  StationRepository stationRepository) {
        this.itemRoutes = itemRoutes;
        this.categoryRoutes = categoryRoutes;
        this.stationRepository = stationRepository;
    }

    /**
     * The station this item fires to at this branch, or empty if nothing resolves.
     *
     * <p>Empty is not an error. It is what an unconfigured item has always produced, and the caller
     * renders it as the DEFAULT key exactly as it does today.
     */
    public Optional<Station> resolve(UUID tenantId, UUID branchId, MenuItem item) {
        if (tenantId == null || branchId == null || item == null) {
            return Optional.empty();
        }

        // 1 — the item's own route for this branch.
        Optional<Station> itemRoute = itemRoutes
                .findByTenantIdAndBranchIdAndMenuItemId(tenantId, branchId, item.getId())
                .flatMap(r -> stationRepository.findByIdAndTenantIdAndBranchId(
                        r.getStationId(), tenantId, branchId));
        if (itemRoute.isPresent()) {
            return itemRoute;
        }

        // 2 — the category's route for this branch.
        UUID categoryId = item.getCategory() != null ? item.getCategory().getId() : null;
        if (categoryId != null) {
            Optional<Station> categoryRoute = categoryRoutes
                    .findByTenantIdAndBranchIdAndCategoryId(tenantId, branchId, categoryId)
                    .flatMap(r -> stationRepository.findByIdAndTenantIdAndBranchId(
                            r.getStationId(), tenantId, branchId));
            if (categoryRoute.isPresent()) {
                return categoryRoute;
            }
        }

        // 3 — the legacy FK, AND ONLY IF IT BELONGS TO THIS BRANCH. See the class javadoc: this
        // branch predicate is the fix. Without it, one branch's assignment answers for every
        // branch, which is how a tenant's second location started routing biryani to a grill in
        // the first location.
        if (item.getStationId() != null) {
            Optional<Station> legacy = stationRepository
                    .findByIdAndTenantIdAndBranchId(item.getStationId(), tenantId, branchId);
            if (legacy.isPresent()) {
                return legacy;
            }
        }

        // 4 — the legacy free-text key, matched against a code in THIS branch. Same branch
        // discipline; a code is only unique within a branch.
        if (item.getKdsStation() != null && !item.getKdsStation().isBlank()) {
            Optional<Station> byCode = stationRepository
                    .findByTenantIdAndBranchIdAndCode(tenantId, branchId, item.getKdsStation());
            if (byCode.isPresent()) {
                return byCode;
            }
        }

        // 5 — nothing. The caller uses DEFAULT, exactly as today.
        return Optional.empty();
    }
}
