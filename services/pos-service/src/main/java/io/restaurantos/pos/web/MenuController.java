package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.UpdateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/menu")
@RequiresFeature("FEATURE_POS")
public class MenuController {

    private final MenuService menuService;

    public MenuController(MenuService menuService) {
        this.menuService = menuService;
    }

    @GetMapping("/categories")
    public ResponseEntity<ApiResponse<List<MenuCategoryDto>>> listCategories() {
        return ResponseEntity.ok(ApiResponse.ok(menuService.listCategories()));
    }

    /** Admin listing (Menu Items management page) — includes inactive categories. Gated on
     * {@code pos.menu.manage} inside {@code MenuServiceImpl}, same as every write below: a
     * cashier has no reason to see a deactivated category either. */
    @GetMapping("/categories/admin")
    public ResponseEntity<ApiResponse<List<MenuCategoryDto>>> listCategoriesForAdmin() {
        return ResponseEntity.ok(ApiResponse.ok(menuService.listCategoriesForAdmin()));
    }

    @PostMapping("/categories")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> createCategory(
            @Valid @RequestBody CreateMenuCategoryRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.createCategory(request)));
    }

    @PutMapping("/categories/{id}")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> updateCategory(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateMenuCategoryRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.updateCategory(id, request)));
    }

    @PatchMapping("/categories/{id}/activate")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> activateCategory(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setCategoryActive(id, true)));
    }

    @PatchMapping("/categories/{id}/deactivate")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> deactivateCategory(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setCategoryActive(id, false)));
    }

    @GetMapping("/items")
    public ResponseEntity<ApiResponse<List<MenuItemDto>>> listItems(
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID branchId,
            Pageable pageable) {
        Page<MenuItemDto> page = menuService.listItems(categoryId, branchId, pageable);
        return ResponseEntity.ok(ApiResponse.ok(page.getContent()));
    }

    /** Admin listing — includes inactive items. See {@code listCategoriesForAdmin}'s note on
     * why the permission gate lives in the service, not here. */
    @GetMapping("/items/admin")
    public ResponseEntity<ApiResponse<List<MenuItemDto>>> listItemsForAdmin(
            @RequestParam(required = false) UUID categoryId) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.listItemsForAdmin(categoryId)));
    }

    @GetMapping("/items/{id}")
    public ResponseEntity<ApiResponse<MenuItemDto>> getItem(
            @PathVariable UUID id,
            @RequestParam(required = false) UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.getItem(id, branchId)));
    }

    /**
     * Assign (or clear, with a null {@code stationId}) a menu item's canonical station (Phase 3).
     * The station must belong to the caller's tenant + branch; {@code branchId} is validated
     * against the JWT branch inside the service.
     */
    @PutMapping("/items/{id}/station")
    public ResponseEntity<ApiResponse<MenuItemDto>> assignStation(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @RequestBody AssignStationRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                menuService.assignStation(id, branchId, request.stationId())));
    }

    public record AssignStationRequest(UUID stationId) {}

    @PostMapping("/items")
    public ResponseEntity<ApiResponse<MenuItemDto>> createItem(
            @Valid @RequestBody CreateMenuItemRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.createItem(request)));
    }

    @PutMapping("/items/{id}")
    public ResponseEntity<ApiResponse<MenuItemDto>> updateItem(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateMenuItemRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.updateItem(id, request)));
    }

    @PatchMapping("/items/{id}/activate")
    public ResponseEntity<ApiResponse<MenuItemDto>> activateItem(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setActive(id, true)));
    }

    @PatchMapping("/items/{id}/deactivate")
    public ResponseEntity<ApiResponse<MenuItemDto>> deactivateItem(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setActive(id, false)));
    }

    @DeleteMapping("/items/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteItem(@PathVariable UUID id) {
        menuService.deleteItem(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
