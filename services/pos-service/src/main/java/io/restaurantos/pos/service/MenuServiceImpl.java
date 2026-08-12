package io.restaurantos.pos.service;

import io.restaurantos.pos.authz.PosAuthorizationService;
import io.restaurantos.pos.domain.model.BranchMenuOverride;
import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.domain.model.MenuItem;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.UpdateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.domain.model.Station;
import io.restaurantos.pos.event.PosEventPayloads.MenuItemDeletedPayload;
import io.restaurantos.pos.event.PosEventPayloads.MenuItemUpsertedPayload;
import io.restaurantos.pos.repository.BranchMenuOverrideRepository;
import io.restaurantos.pos.repository.MenuCategoryRepository;
import io.restaurantos.pos.repository.MenuItemRepository;
import io.restaurantos.pos.domain.model.MenuItemStationRoute;
import io.restaurantos.pos.domain.model.MenuCategoryStationRoute;
import io.restaurantos.pos.repository.MenuItemStationRouteRepository;
import io.restaurantos.pos.repository.MenuCategoryStationRouteRepository;
import io.restaurantos.pos.repository.StationRepository;
import io.restaurantos.shared.event.EventPublisher;
import io.restaurantos.shared.exception.PermissionDeniedException;
import io.restaurantos.shared.exception.ResourceNotFoundException;
import io.restaurantos.shared.tenant.TenantContext;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Service
@Transactional(readOnly = true)
public class MenuServiceImpl implements MenuService {

    private static final String POS_EXCHANGE = "pos.topic";
    private static final String MENU_ITEM_UPSERTED_KEY = "pos.menu_item.upserted";
    private static final String MENU_ITEM_UPSERTED_TYPE = "MENU_ITEM_UPSERTED";
    private static final String MENU_ITEM_DELETED_KEY = "pos.menu_item.deleted";
    private static final String MENU_ITEM_DELETED_TYPE = "MENU_ITEM_DELETED";

    private final MenuCategoryRepository categoryRepository;
    private final MenuItemRepository itemRepository;
    private final BranchMenuOverrideRepository overrideRepository;
    private final StationRepository stationRepository;
    private final TenantContext tenantContext;
    private final EventPublisher eventPublisher;
    private final PosAuthorizationService posAuthorizationService;
    private final MenuItemImageService menuItemImageService;
    private final MenuItemStationRouteRepository itemStationRoutes;
    private final MenuCategoryStationRouteRepository categoryStationRoutes;
    private final StationRoutingResolver stationRoutingResolver;

    public MenuServiceImpl(MenuCategoryRepository categoryRepository,
                           MenuItemRepository itemRepository,
                           BranchMenuOverrideRepository overrideRepository,
                           StationRepository stationRepository,
                           TenantContext tenantContext,
                           EventPublisher eventPublisher,
                           PosAuthorizationService posAuthorizationService,
                           MenuItemImageService menuItemImageService,
                           MenuItemStationRouteRepository itemStationRoutes,
                           MenuCategoryStationRouteRepository categoryStationRoutes,
                           StationRoutingResolver stationRoutingResolver) {
        this.categoryRepository = categoryRepository;
        this.itemRepository = itemRepository;
        this.overrideRepository = overrideRepository;
        this.stationRepository = stationRepository;
        this.tenantContext = tenantContext;
        this.eventPublisher = eventPublisher;
        this.posAuthorizationService = posAuthorizationService;
        this.menuItemImageService = menuItemImageService;
        this.itemStationRoutes = itemStationRoutes;
        this.categoryStationRoutes = categoryStationRoutes;
        this.stationRoutingResolver = stationRoutingResolver;
    }

    @Override
    public List<MenuCategoryDto> listCategories() {
        return categoryRepository.findAllActiveOrderBySortOrder().stream()
                .map(this::toCategoryDto)
                .toList();
    }

    @Override
    public List<MenuCategoryDto> listCategoriesForAdmin() {
        posAuthorizationService.requireMenuManage();
        return categoryRepository.findAllOrderBySortOrder().stream()
                .map(this::toCategoryDto)
                .toList();
    }

    private MenuCategoryDto toCategoryDto(MenuCategory c) {
        return new MenuCategoryDto(c.getId(), c.getName(), c.getDescription(), c.getSortOrder(), c.isActive());
    }

    @Override
    public List<MenuItemDto> listItemsForAdmin(UUID categoryId) {
        posAuthorizationService.requireMenuManage();
        List<MenuItem> items = categoryId != null
                ? itemRepository.findByCategoryIdOrderByName(categoryId)
                : itemRepository.findAllOrderByName(Pageable.unpaged()).getContent();
        return items.stream().map(item -> toDto(item, null)).toList();
    }

    /**
     * Order-taking menu listing — the till's grid.
     *
     * <p>Both branches now return a page whose metadata describes what was actually returned.
     * The category branch used to read every row and hand it to
     * {@code PageableExecutionUtils.getPage}, which does not slice: a 30-item category answered
     * "page 0, size 20" with 30 rows and {@code hasNext=true}, so metadata and body disagreed in
     * one direction while the uncategorised branch (a real {@code Page}) truncated at 20 in the
     * other. The controller discarded the metadata in both cases, which is why neither was
     * visible. A caller can now page to the end and know when it has reached it.
     */
    @Override
    public Page<MenuItemDto> listItems(UUID categoryId, UUID branchId, Pageable pageable) {
        requireOwnBranchIfPresent(branchId);
        Page<MenuItem> page = categoryId != null
                ? itemRepository.findByCategoryIdAndActiveTrue(categoryId, pageable)
                : itemRepository.findByActiveTrue(pageable);
        return page.map(item -> toDto(item, branchId));
    }

    @Override
    public MenuItemDto getItem(UUID itemId, UUID branchId) {
        requireOwnBranchIfPresent(branchId);
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));
        return toDto(item, branchId);
    }

    /**
     * SECURITY (branch isolation): {@code branchId} is an optional request parameter used to resolve
     * branch-specific override pricing. When supplied it must equal the caller's verified JWT branch —
     * otherwise a caller could read another branch's override prices. When absent, only tenant-scoped
     * base pricing is returned (no branch restriction needed).
     */
    private void requireOwnBranchIfPresent(UUID branchId) {
        if (branchId == null) {
            return;
        }
        UUID jwtBranchId = tenantContext.getBranchId()
                .orElseThrow(() -> new PermissionDeniedException("Branch context required"));
        if (!jwtBranchId.equals(branchId)) {
            throw new PermissionDeniedException("Cannot access menu pricing for a different branch");
        }
    }

    @Override
    @Transactional
    public MenuItemDto assignStation(UUID itemId, UUID branchId, UUID stationId) {
        posAuthorizationService.requireMenuManage();
        requireOwnBranchIfPresent(branchId);
        if (branchId == null) {
            throw new PermissionDeniedException("branchId is required to assign a station");
        }
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));

        UUID tenantId = tenantContext.requireTenantId();

        if (stationId == null) {
            // Clear THIS BRANCH's route. The item then falls through to its category's route, and
            // failing that to the legacy columns and finally to DEFAULT — see StationRoutingResolver.
            itemStationRoutes.deleteByTenantIdAndBranchIdAndMenuItemId(tenantId, branchId, itemId);
            itemStationRoutes.flush();
            // The legacy tenant-wide column is deliberately NOT cleared here. It is shared across
            // branches, and clearing it would do to the OTHER branches exactly what this plan
            // exists to stop: one branch's edit changing another branch's routing.
        } else {
            // Validate the station belongs to the caller's tenant AND branch — a client cannot
            // assign a sibling branch's station id to a menu item.
            Station station = stationRepository.findByIdAndTenantIdAndBranchId(stationId, tenantId, branchId)
                    .orElseThrow(() -> new ResourceNotFoundException("Station not found for this branch: " + stationId));

            // THE per-branch row. This replaces overwriting menu_items.station_id, which is
            // tenant-wide: a two-branch tenant has ONE row for a dish, so assigning it at branch B
            // silently re-pointed the same dish at branch A and overwrote the free-text mirror
            // with B's code. Each write passed its own branch guard; nothing guarded the collision.
            MenuItemStationRoute route = itemStationRoutes
                    .findByTenantIdAndBranchIdAndMenuItemId(tenantId, branchId, itemId)
                    .orElseGet(() -> {
                        MenuItemStationRoute r = new MenuItemStationRoute();
                        r.setTenantId(tenantId);
                        r.setBranchId(branchId);
                        r.setMenuItemId(itemId);
                        return r;
                    });
            route.setStationId(station.getId());
            itemStationRoutes.save(route);

            // The legacy columns are STILL written, for one release, and only ever widened toward
            // agreement with this branch's choice.
            //
            // The free-text mirror is still read by the order-ready consumer on the POS side, and
            // retiring it is a later phase's job with its own consumer audit — not a side effect of
            // this one. REMOVE THESE TWO LINES when: (a) no consumer reads menu_items.kds_station,
            // and (b) a migration has backfilled per-branch routes for every tenant that has a
            // non-null menu_items.station_id. Until both hold, dropping them silently un-routes
            // every tenant who upgraded and never opened the new screen.
            //
            // This is still a tenant-wide write and therefore still visible to the other branches.
            // It is now a FALLBACK they may or may not use rather than the answer they must use:
            // the resolver only consults it when the station it names is in the reading branch, so
            // a cross-branch value stops applying instead of mis-routing.
            item.setStationId(station.getId());
            item.setKdsStation(station.getCode());
        }
        return toDto(itemRepository.save(item), branchId);
    }

    @Override
    @Transactional
    public MenuItemDto createItem(CreateMenuItemRequest request) {
        posAuthorizationService.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        MenuCategory category = categoryRepository.findById(request.categoryId())
                .orElseThrow(() -> new ResourceNotFoundException("Menu category not found: " + request.categoryId()));

        // Validated BEFORE the row is written: a rejected image must not leave a half-created
        // item behind, and this call can fail (it crosses a service boundary).
        menuItemImageService.requireValidImage(tenantId, request.imageFileId());

        MenuItem item = new MenuItem();
        item.setTenantId(tenantId);
        item.setCategory(category);
        item.setName(request.name());
        item.setDescription(request.description());
        item.setBasePricePaisa(request.basePricePaisa());
        if (request.taxRatePct() != null) {
            item.setTaxRatePct(request.taxRatePct());
        }
        item.setTaxRateCode(request.taxRateCode());
        item.setImageFileId(request.imageFileId());
        item.setActive(true);

        MenuItem saved = itemRepository.save(item);
        publishUpserted(saved);
        return toDto(saved, null);
    }

    @Override
    @Transactional
    public MenuItemDto updateItem(UUID itemId, UpdateMenuItemRequest request) {
        posAuthorizationService.requireMenuManage();
        UUID tenantId = tenantContext.requireTenantId();
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));

        if (request.categoryId() != null) {
            MenuCategory category = categoryRepository.findById(request.categoryId())
                    .orElseThrow(() -> new ResourceNotFoundException("Menu category not found: " + request.categoryId()));
            item.setCategory(category);
        }

        // Captured before the setter, and only released after the save commits — releasing the
        // old file first would leave the item picture-less if the save then failed.
        UUID previousImageFileId = item.getImageFileId();
        menuItemImageService.requireValidImage(tenantId, request.imageFileId());

        item.setName(request.name());
        item.setDescription(request.description());
        item.setBasePricePaisa(request.basePricePaisa());
        // Null-guarded: absent taxRatePct means LEAVE UNCHANGED. Note this is the opposite of
        // the two setters below, which is precisely the asymmetry that produced register S0 #4 —
        // UpdateMenuItemRequest's javadoc now names all three fields and their three meanings.
        if (request.taxRatePct() != null) {
            item.setTaxRatePct(request.taxRatePct());
        }
        // Both of these are REMOVE-on-null, not "unchanged" — see UpdateMenuItemRequest's
        // javadoc. Kept that way deliberately: on a PUT, clearing a field has to be expressible,
        // and the caller's obligation is to send every field. MenuUpdateReplacesFieldsIT pins it.
        item.setTaxRateCode(request.taxRateCode());
        item.setImageFileId(request.imageFileId());

        MenuItem saved = itemRepository.save(item);
        // Replace and remove both land here: the old object is soft-deleted in file-service and
        // its bytes stop counting against the tenant's storage quota. Best-effort — a failure is
        // logged and never fails the menu edit.
        menuItemImageService.releaseIfReplaced(tenantId, previousImageFileId, saved.getImageFileId());
        publishUpserted(saved);
        return toDto(saved, null);
    }

    @Override
    @Transactional
    public MenuItemDto setActive(UUID itemId, boolean active) {
        posAuthorizationService.requireMenuManage();
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));
        item.setActive(active);
        MenuItem saved = itemRepository.save(item);
        publishUpserted(saved);
        return toDto(saved, null);
    }

    /**
     * <h2>What happens to the stored image object</h2>
     *
     * <p>Nothing. {@code image_file_id} is RETAINED on the row and the file is NOT released.
     *
     * <p>This is a soft delete — it sets {@code deleted_at} and clears {@code active}, and the
     * row stays. Reversibility is the entire reason it is a soft delete, and a soft delete that
     * hard-deletes its attachments is not reversible: restoring the item would bring back a row
     * pointing at a file that no longer resolves, and the manager would get a broken image with
     * no way to know what the picture used to be.
     *
     * <p>The image IS released in the two cases where the reference genuinely goes away —
     * replacing a picture and removing one — both handled in {@link #updateItem}. And
     * DEACTIVATION deliberately does nothing to the image either: a deactivated item that is
     * later reactivated must come back with its picture.
     *
     * <p>Nothing in the product hard-deletes a menu item today. If that is ever added, releasing
     * the image belongs to that change, and this paragraph is the note saying so.
     */
    @Override
    @Transactional
    public void deleteItem(UUID itemId) {
        posAuthorizationService.requireMenuManage();
        MenuItem item = itemRepository.findById(itemId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu item not found: " + itemId));
        item.setDeletedAt(Instant.now());
        item.setActive(false);
        itemRepository.save(item);
        eventPublisher.publish(POS_EXCHANGE, MENU_ITEM_DELETED_KEY, MENU_ITEM_DELETED_TYPE, null,
                new MenuItemDeletedPayload(item.getId()));
    }

    @Override
    @Transactional
    public int republishAllActive() {
        List<MenuItem> activeItems = itemRepository.findByActiveTrueOrderByName();
        for (MenuItem item : activeItems) {
            publishUpserted(item);
        }
        return activeItems.size();
    }

    @Override
    @Transactional
    public MenuCategoryDto createCategory(CreateMenuCategoryRequest request) {
        posAuthorizationService.requireMenuManage();
        MenuCategory category = new MenuCategory();
        category.setTenantId(tenantContext.requireTenantId());
        category.setName(request.name());
        category.setDescription(request.description());
        if (request.sortOrder() != null) {
            category.setSortOrder(request.sortOrder());
        }
        category.setActive(true);
        return toCategoryDto(categoryRepository.save(category));
    }

    @Override
    @Transactional
    public MenuCategoryDto updateCategory(UUID categoryId, UpdateMenuCategoryRequest request) {
        posAuthorizationService.requireMenuManage();
        MenuCategory category = categoryRepository.findById(categoryId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu category not found: " + categoryId));
        category.setName(request.name());
        category.setDescription(request.description());
        if (request.sortOrder() != null) {
            category.setSortOrder(request.sortOrder());
        }
        return toCategoryDto(categoryRepository.save(category));
    }

    @Override
    @Transactional
    public MenuCategoryDto setCategoryActive(UUID categoryId, boolean active) {
        posAuthorizationService.requireMenuManage();
        MenuCategory category = categoryRepository.findById(categoryId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu category not found: " + categoryId));
        category.setActive(active);
        return toCategoryDto(categoryRepository.save(category));
    }

    /**
     * Uses {@code Instant.now()} for the payload's {@code updatedAt}, NOT
     * {@code item.getUpdatedAt()}: Spring Data JPA's {@code @LastModifiedDate} only refreshes the
     * in-memory field on flush/commit for an update (merge), so reading it back immediately after
     * {@code save()} inside the same still-open transaction can return a stale value.
     */
    private void publishUpserted(MenuItem item) {
        var payload = new MenuItemUpsertedPayload(
                item.getId(),
                item.getName(),
                item.getCategory().getId(),
                item.getCategory().getName(),
                item.isActive(),
                item.getBasePricePaisa(),
                Instant.now()
        );
        eventPublisher.publish(POS_EXCHANGE, MENU_ITEM_UPSERTED_KEY, MENU_ITEM_UPSERTED_TYPE, null, payload);
    }

    /**
     * Route a whole CATEGORY to a station, for the caller's branch (28-05, D-28-05).
     *
     * <p>This is how "all drinks go to the bar" is actually configured. Expressing it per item
     * would be two hundred checkbox clicks that then drift every time an item is added to the
     * category — and a routing rule that drifts silently is worse than no routing rule.
     *
     * <p>A null station clears the branch's category route. Item-level routes are untouched either
     * way: they are the exception mechanism, and clearing a category rule must not also discard the
     * exceptions somebody set against it.
     */
    @Override
    @Transactional
    public void assignCategoryStation(UUID categoryId, UUID branchId, UUID stationId) {
        posAuthorizationService.requireMenuManage();
        requireOwnBranchIfPresent(branchId);
        if (branchId == null) {
            throw new PermissionDeniedException("branchId is required to route a category");
        }
        UUID tenantId = tenantContext.requireTenantId();
        categoryRepository.findByIdAndTenantId(categoryId, tenantId)
                .orElseThrow(() -> new ResourceNotFoundException("Menu category not found: " + categoryId));

        if (stationId == null) {
            categoryStationRoutes.deleteByTenantIdAndBranchIdAndCategoryId(tenantId, branchId, categoryId);
            categoryStationRoutes.flush();
            return;
        }
        Station station = stationRepository.findByIdAndTenantIdAndBranchId(stationId, tenantId, branchId)
                .orElseThrow(() -> new ResourceNotFoundException("Station not found for this branch: " + stationId));

        MenuCategoryStationRoute route = categoryStationRoutes
                .findByTenantIdAndBranchIdAndCategoryId(tenantId, branchId, categoryId)
                .orElseGet(() -> {
                    MenuCategoryStationRoute r = new MenuCategoryStationRoute();
                    r.setTenantId(tenantId);
                    r.setBranchId(branchId);
                    r.setCategoryId(categoryId);
                    return r;
                });
        route.setStationId(station.getId());
        categoryStationRoutes.save(route);
    }

    private MenuItemDto toDto(MenuItem item, UUID branchId) {
        Long overridePrice = null;
        if (branchId != null) {
            Optional<BranchMenuOverride> override = overrideRepository
                    .findByBranchIdAndMenuItemId(branchId, item.getId());
            if (override.isPresent() && override.get().getPricePaisa() != null) {
                overridePrice = override.get().getPricePaisa();
            }
        }
        // Where this item ACTUALLY fires at the requested branch (28-05). Resolved server-side so
        // the menu screen can show a dish's destination without reimplementing the resolution
        // order in TypeScript — a second copy of that rule is a second answer.
        Optional<Station> effective = branchId != null
                ? stationRoutingResolver.resolve(item.getTenantId(), branchId, item)
                : Optional.empty();

        return new MenuItemDto(
                item.getId(),
                item.getCategory().getId(),
                item.getCategory().getName(),
                item.getName(),
                item.getDescription(),
                item.getBasePricePaisa(),
                item.getTaxRatePct(),
                item.getTaxRateCode(),
                item.getKdsStation(),
                item.isActive(),
                overridePrice,
                item.getStationId(),
                item.getImageFileId(),
                MenuItemDto.imageUrlFor(item.getImageFileId()),
                effective.map(Station::getId).orElse(null),
                effective.map(Station::getCode).orElse(null),
                effective.map(Station::getName).orElse(null)
        );
    }
}
