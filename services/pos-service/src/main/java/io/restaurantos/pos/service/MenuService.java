package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.UpdateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface MenuService {
    List<MenuCategoryDto> listCategories();

    /** Admin listing (Menu Items management page) — includes inactive categories, unlike
     * {@link #listCategories}, which backs the order-taking menu grid and must stay
     * active-only. */
    List<MenuCategoryDto> listCategoriesForAdmin();

    Page<MenuItemDto> listItems(UUID categoryId, UUID branchId, Pageable pageable);

    /** Admin listing — includes inactive items, unlike {@link #listItems}. No pricing/branch
     * override resolution (that's an order-taking concern); {@code categoryId} is optional. */
    List<MenuItemDto> listItemsForAdmin(UUID categoryId);
    MenuItemDto getItem(UUID itemId, UUID branchId);

    /**
     * Assign (or clear, when {@code stationId} is null) a menu item's canonical station (Phase 3).
     * The station must belong to the caller's tenant + branch; {@code branchId} is validated
     * against the JWT branch. Also mirrors the station's code into the retained free-text
     * {@code kds_station} so the two stay consistent for back-compat routing.
     */
    /** Route a whole category to a station for the caller's branch (28-05). Null station clears it. */
    void assignCategoryStation(UUID categoryId, UUID branchId, UUID stationId);

    MenuItemDto assignStation(UUID itemId, UUID branchId, UUID stationId);

    /**
     * Create a new menu item and publish MENU_ITEM_UPSERTED (D-02/INV-09) through the
     * transactional outbox in the same transaction as the write.
     */
    MenuItemDto createItem(CreateMenuItemRequest request);

    /**
     * Update an existing menu item and publish MENU_ITEM_UPSERTED. Omitting {@code categoryId}
     * on the request leaves the current category unchanged.
     */
    MenuItemDto updateItem(UUID itemId, UpdateMenuItemRequest request);

    /**
     * Activate/deactivate a menu item and publish MENU_ITEM_UPSERTED reflecting the new
     * {@code active} state.
     */
    MenuItemDto setActive(UUID itemId, boolean active);

    /**
     * Soft-delete a menu item (sets {@code deletedAt} + {@code active=false} — never a hard
     * DELETE, so historical orders/recipes referencing the item stay resolvable) and publish
     * MENU_ITEM_DELETED.
     */
    void deleteItem(UUID itemId);

    /**
     * D-05 backfill: re-publish MENU_ITEM_UPSERTED for every currently-active menu item in the
     * caller's current tenant. Returns the number of items republished.
     */
    int republishAllActive();

    /**
     * Create a new menu category. Purely pos-service-local — inventory-service's
     * {@code menu_item_catalog} read-model tracks items, never categories, so unlike
     * {@link #createItem} this publishes no event.
     */
    MenuCategoryDto createCategory(CreateMenuCategoryRequest request);

    /** Rename/redescribe/resort an existing menu category. {@code active} is untouched — use
     * {@link #setCategoryActive} for that. */
    MenuCategoryDto updateCategory(UUID categoryId, UpdateMenuCategoryRequest request);

    /**
     * Activate/deactivate a menu category (D-04 archive-not-delete, mirroring {@link #setActive}
     * for items). Deactivating does not touch the items inside it — an item's own
     * {@code active} flag is independent, matching how archiving an Inventory category doesn't
     * archive its ingredients.
     */
    MenuCategoryDto setCategoryActive(UUID categoryId, boolean active);
}
