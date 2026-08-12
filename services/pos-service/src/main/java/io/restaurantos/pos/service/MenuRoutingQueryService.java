package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.dto.MenuRoutingDto;
import io.restaurantos.pos.dto.MenuRoutingDto.RouteSource;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuCategoryStationRouteRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.repository.MenuItemStationRouteRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The READ half of station routing (S1-01). Writes stay on {@code MenuServiceImpl}.
 *
 * <h2>Why a separate service and a separate controller</h2>
 *
 * <p>Two reasons, and the second is the load-bearing one.
 *
 * <ol>
 *   <li>This is a projection assembled from four tables for one screen. It has no business rules
 *       of its own and it writes nothing, so putting it behind {@code MenuService} — an interface
 *       whose every other member mutates something — would only widen a write contract.</li>
 *   <li>{@code MenuController} and {@code MenuServiceImpl} were being edited by another change in
 *       the same working tree when this landed. A new file cannot collide with an in-flight edit;
 *       a new method inside a file being rewritten can, and the reconciliation is done by hand
 *       under time pressure. The seam is real either way.</li>
 * </ol>
 *
 * <h2>The effective station is never re-derived here</h2>
 *
 * <p>{@link StationRoutingResolver} answers "where does this fire", exactly as it does for the
 * order path and for {@code MenuItemDto}. This class only LABELS that answer — it compares the
 * resolved station against the two route tables to say which rule won. A second implementation of
 * the resolution order would be a second answer, and the two would disagree the first time a step
 * was added to one of them.
 *
 * <h2>On the query count</h2>
 *
 * <p>The resolver is consulted once per item, and each call is up to four small indexed lookups.
 * For an admin screen opened a handful of times a week against a menu of tens-to-hundreds of items
 * that is the right trade against holding a second copy of the rule. If a tenant's catalogue ever
 * makes this slow, the fix is a batch method ON THE RESOLVER, not a reimplementation in here.
 */
@Service
@Transactional(readOnly = true)
public class MenuRoutingQueryService {

    private final MenuCategoryRepository categoryRepository;
    private final MenuItemRepository itemRepository;
    private final StationRepository stationRepository;
    private final MenuItemStationRouteRepository itemStationRoutes;
    private final MenuCategoryStationRouteRepository categoryStationRoutes;
    private final StationRoutingResolver stationRoutingResolver;
    private final PosAuthorizationService posAuthorizationService;
    private final TenantContext tenantContext;

    public MenuRoutingQueryService(MenuCategoryRepository categoryRepository,
                                   MenuItemRepository itemRepository,
                                   StationRepository stationRepository,
                                   MenuItemStationRouteRepository itemStationRoutes,
                                   MenuCategoryStationRouteRepository categoryStationRoutes,
                                   StationRoutingResolver stationRoutingResolver,
                                   PosAuthorizationService posAuthorizationService,
                                   TenantContext tenantContext) {
        this.categoryRepository = categoryRepository;
        this.itemRepository = itemRepository;
        this.stationRepository = stationRepository;
        this.itemStationRoutes = itemStationRoutes;
        this.categoryStationRoutes = categoryStationRoutes;
        this.stationRoutingResolver = stationRoutingResolver;
        this.posAuthorizationService = posAuthorizationService;
        this.tenantContext = tenantContext;
    }

    /**
     * Every category and every item, each with its route and its effective destination, for one
     * branch.
     *
     * <p>{@code branchId} must equal the caller's JWT branch. A station code is unique within a
     * BRANCH, not within a tenant, so answering for another branch would be answering a different
     * question with this branch's authority — the same guard {@code MenuServiceImpl} applies to
     * every other branch-scoped menu read.
     */
    public MenuRoutingDto routingFor(UUID branchId) {
        posAuthorizationService.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (branchId == null) {
            throw new PermissionDeniedException("branchId is required to read station routing");
        }
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot read station routing for a different branch");
        }

        // Stations are branch-scoped; a route naming a station that is not in this branch is not a
        // route this branch can act on, so it is treated as absent rather than rendered as a
        // destination nobody here has.
        Map<UUID, Station> stationsById = new LinkedHashMap<>();
        for (Station s : stationRepository.findByTenantIdAndBranchId(tenantId, branchId)) {
            stationsById.put(s.getId(), s);
        }

        Map<UUID, UUID> categoryRouteByCategory = new HashMap<>();
        categoryStationRoutes.findByTenantIdAndBranchId(tenantId, branchId)
                .forEach(r -> categoryRouteByCategory.put(r.getCategoryId(), r.getStationId()));

        Map<UUID, UUID> itemRouteByItem = new HashMap<>();
        itemStationRoutes.findByTenantIdAndBranchId(tenantId, branchId)
                .forEach(r -> itemRouteByItem.put(r.getMenuItemId(), r.getStationId()));

        // The explicit tenant filter is not redundant with RLS. Under FORCE an unscoped query
        // returns ZERO ROWS rather than erroring, and zero rows here reads as "this restaurant has
        // no menu" — a sentence this screen must never say by accident.
        List<MenuRoutingDto.CategoryRoute> categories = categoryRepository.findAllOrderBySortOrder()
                .stream()
                .filter(c -> tenantId.equals(c.getTenantId()))
                .map(c -> toCategoryRoute(c, stationsById.get(categoryRouteByCategory.get(c.getId()))))
                .toList();

        List<MenuRoutingDto.ItemRoute> items = itemRepository.findAllOrderByName(Pageable.unpaged())
                .getContent()
                .stream()
                .filter(i -> tenantId.equals(i.getTenantId()))
                .map(i -> toItemRoute(i, tenantId, branchId, categoryRouteByCategory, itemRouteByItem))
                .toList();

        return new MenuRoutingDto(branchId, categories, items);
    }

    private MenuRoutingDto.CategoryRoute toCategoryRoute(MenuCategory c, Station station) {
        return new MenuRoutingDto.CategoryRoute(
                c.getId(),
                c.getName(),
                c.getSortOrder(),
                c.isActive(),
                station == null ? null : station.getId(),
                station == null ? null : station.getCode(),
                station == null ? null : station.getName());
    }

    private MenuRoutingDto.ItemRoute toItemRoute(MenuItem item,
                                                 UUID tenantId,
                                                 UUID branchId,
                                                 Map<UUID, UUID> categoryRouteByCategory,
                                                 Map<UUID, UUID> itemRouteByItem) {
        UUID categoryId = item.getCategory() == null ? null : item.getCategory().getId();
        String categoryName = item.getCategory() == null ? null : item.getCategory().getName();

        Optional<Station> effective = stationRoutingResolver.resolve(tenantId, branchId, item);
        UUID effectiveId = effective.map(Station::getId).orElse(null);

        UUID ownRoute = itemRouteByItem.get(item.getId());
        UUID categoryRoute = categoryId == null ? null : categoryRouteByCategory.get(categoryId);

        // LABELLING only — the answer above came from the resolver. Equality against the route
        // tables is what distinguishes "somebody set this item" from "it inherited the category"
        // from "this is pre-28-05 data nobody has touched".
        RouteSource source;
        if (effectiveId == null) {
            source = RouteSource.NONE;
        } else if (effectiveId.equals(ownRoute)) {
            source = RouteSource.ITEM;
        } else if (effectiveId.equals(categoryRoute)) {
            source = RouteSource.CATEGORY;
        } else {
            source = RouteSource.LEGACY;
        }

        return new MenuRoutingDto.ItemRoute(
                item.getId(),
                item.getName(),
                categoryId,
                categoryName,
                item.isActive(),
                ownRoute,
                effectiveId,
                effective.map(Station::getCode).orElse(null),
                effective.map(Station::getName).orElse(null),
                source);
    }
}
