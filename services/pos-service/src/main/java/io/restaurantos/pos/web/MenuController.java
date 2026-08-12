package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.UpdateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
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

    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping("/categories")
    public ResponseEntity<ApiResponse<List<MenuCategoryDto>>> listCategories() {
        return ResponseEntity.ok(ApiResponse.ok(menuService.listCategories()));
    }

    /** Admin listing (Menu Items management page) — includes inactive categories. Gated on
     * {@code pos.menu.manage} inside {@code MenuServiceImpl}, same as every write below: a
     * cashier has no reason to see a deactivated category either. */
    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @GetMapping("/categories/admin")
    public ResponseEntity<ApiResponse<List<MenuCategoryDto>>> listCategoriesForAdmin() {
        return ResponseEntity.ok(ApiResponse.ok(menuService.listCategoriesForAdmin()));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PostMapping("/categories")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> createCategory(
            @Valid @RequestBody CreateMenuCategoryRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.createCategory(request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PutMapping("/categories/{id}")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> updateCategory(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateMenuCategoryRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.updateCategory(id, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PatchMapping("/categories/{id}/activate")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> activateCategory(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setCategoryActive(id, true)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PatchMapping("/categories/{id}/deactivate")
    public ResponseEntity<ApiResponse<MenuCategoryDto>> deactivateCategory(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setCategoryActive(id, false)));
    }

    /**
     * Order-taking menu listing (the till's grid).
     *
     * <p>This used to answer with {@code ApiResponse.ok(page.getContent())} — the page's contents
     * and nothing else. With Spring's default page size of 20 and no {@code size} sent by the
     * till, a tenant whose menu ran past 20 active items got the first 20 and <em>no way to learn
     * that</em>: no total, no next cursor, no warning. The cashier saw a full-looking grid and the
     * rest of the menu was unsellable and unsearchable. Returning {@code meta} is what makes a
     * short answer detectable, and it is the same envelope {@code OrderController.listOrders}
     * already uses, so the shared {@code getPaginated} client helper reads it unchanged.
     */
    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping("/items")
    public ResponseEntity<ApiResponse<List<MenuItemDto>>> listItems(
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID branchId,
            Pageable pageable) {
        Page<MenuItemDto> page = menuService.listItems(categoryId, branchId, pageable);
        return ResponseEntity.ok(ApiResponse.paginated(page.getContent(), new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements())));
    }

    /** Admin listing — includes inactive items. See {@code listCategoriesForAdmin}'s note on
     * why the permission gate lives in the service, not here. */
    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @GetMapping("/items/admin")
    public ResponseEntity<ApiResponse<List<MenuItemDto>>> listItemsForAdmin(
            @RequestParam(required = false) UUID categoryId) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.listItemsForAdmin(categoryId)));
    }

    @PreAuthorize("hasAuthority('pos.menu.view')")
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
    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PutMapping("/items/{id}/station")
    public ResponseEntity<ApiResponse<MenuItemDto>> assignStation(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @RequestBody AssignStationRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(
                menuService.assignStation(id, branchId, request.stationId())));
    }

    public record AssignStationRequest(UUID stationId) {}

    /**
     * Route a whole CATEGORY to a station for the caller's branch (28-05).
     *
     * <p>"All drinks go to the bar" is one call, not two hundred. An item-level route overrides
     * this, so the exception is still expressible; clearing the category route (null station) does
     * NOT discard those exceptions.
     *
     * <p>The route applies to THIS BRANCH ONLY. Menu categories are tenant-scoped and stations are
     * branch-scoped, which is the whole reason these route tables exist.
     */
    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PutMapping("/categories/{id}/station")
    public ResponseEntity<Void> assignCategoryStation(
            @PathVariable UUID id,
            @RequestParam UUID branchId,
            @RequestBody AssignStationRequest request) {
        menuService.assignCategoryStation(id, branchId, request.stationId());
        return ResponseEntity.noContent().build();
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PostMapping("/items")
    public ResponseEntity<ApiResponse<MenuItemDto>> createItem(
            @Valid @RequestBody CreateMenuItemRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.createItem(request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PutMapping("/items/{id}")
    public ResponseEntity<ApiResponse<MenuItemDto>> updateItem(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateMenuItemRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.updateItem(id, request)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PatchMapping("/items/{id}/activate")
    public ResponseEntity<ApiResponse<MenuItemDto>> activateItem(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setActive(id, true)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @PatchMapping("/items/{id}/deactivate")
    public ResponseEntity<ApiResponse<MenuItemDto>> deactivateItem(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(menuService.setActive(id, false)));
    }

    @PreAuthorize("hasAuthority('pos.menu.manage')")
    @DeleteMapping("/items/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteItem(@PathVariable UUID id) {
        menuService.deleteItem(id);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
