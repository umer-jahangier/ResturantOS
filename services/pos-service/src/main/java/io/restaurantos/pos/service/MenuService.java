package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface MenuService {
    List<MenuCategoryDto> listCategories();
    Page<MenuItemDto> listItems(UUID categoryId, UUID branchId, Pageable pageable);
    MenuItemDto getItem(UUID itemId, UUID branchId);

    /**
     * Assign (or clear, when {@code stationId} is null) a menu item's canonical station (Phase 3).
     * The station must belong to the caller's tenant + branch; {@code branchId} is validated
     * against the JWT branch. Also mirrors the station's code into the retained free-text
     * {@code kds_station} so the two stay consistent for back-compat routing.
     */
    MenuItemDto assignStation(UUID itemId, UUID branchId, UUID stationId);
}
