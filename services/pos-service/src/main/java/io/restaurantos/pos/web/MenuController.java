package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.MenuCategoryAdminDtos.CreateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryAdminDtos.UpdateMenuCategoryRequest;
import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemAdminDtos.CreateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemAdminDtos.UpdateMenuItemRequest;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.service.MenuItemImageService;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.tenant.TenantContext;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/menu")
@RequiresFeature("FEATURE_POS")
public class MenuController {

    private final MenuService menuService;
    private final MenuItemImageService menuItemImageService;
    private final TenantContext tenantContext;

    public MenuController(MenuService menuService,
                          MenuItemImageService menuItemImageService,
                          TenantContext tenantContext) {
        this.menuService = menuService;
        this.menuItemImageService = menuItemImageService;
        this.tenantContext = tenantContext;
    }

    /**
     * The bytes of a menu item's picture — the {@code imageUrl} every menu DTO carries.
     *
     * <h2>Why the picture is served here and not by file-service</h2>
     *
     * <p>Because of who works this screen. file-service's download route is gated on
     * {@code file.view}, which reads EVERY file the tenant stores; the roles that hold it are
     * OWNER, TENANT_ADMIN, MANAGER, ACCOUNTANT and INVENTORY_MANAGER. The cashier — the one
     * person who looks at the till grid all day — holds {@code pos.menu.view} and nothing from
     * the {@code file.*} family. Driven live on 2026-08-12: the cashier's own bearer against
     * {@code /api/v1/files/{id}/download} answered {@code 403 PERMISSION_DENIED}. Any fix that
     * only taught the grid to emit an {@code <img>} would have shipped forty failed pictures.
     *
     * <p>The two ways out were "give CASHIER {@code file.view}" and this. The first makes the
     * screen work by handing every till a read of the payroll folder, which is not a trade
     * anybody would make deliberately. So the picture is served under the permission that already
     * governs the thing the picture is part of — the menu — and
     * {@code MenuItemImageService.readMenuImage} will only answer for a file id that is the image
     * of a menu item in the caller's own tenant.
     *
     * <h2>Caching</h2>
     *
     * <p>The path is keyed by FILE id, not item id, so replacing a dish's photograph changes the
     * URL. That makes {@code immutable} an honest thing to say, and it is what keeps a
     * touchscreen from re-fetching the whole grid every time the cashier taps a category pill.
     *
     * <p>{@code private} because the response is tenant data and must never enter a shared cache.
     */
    @PreAuthorize("hasAuthority('pos.menu.view')")
    @GetMapping("/images/{fileId}")
    public ResponseEntity<byte[]> menuImage(@PathVariable UUID fileId) {
        UUID tenantId = tenantContext.requireTenantId();
        return menuItemImageService.readMenuImage(tenantId, fileId)
                .map(image -> ResponseEntity.ok()
                        .header(HttpHeaders.CONTENT_TYPE, image.contentType())
                        .header(HttpHeaders.CACHE_CONTROL, "private, max-age=31536000, immutable")
                        .body(image.bytes()))
                .orElseGet(() -> ResponseEntity.notFound().build());
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
