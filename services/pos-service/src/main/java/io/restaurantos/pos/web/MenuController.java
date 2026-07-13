package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.MenuCategoryDto;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.service.MenuService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
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

    @GetMapping("/items")
    public ResponseEntity<ApiResponse<List<MenuItemDto>>> listItems(
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID branchId,
            Pageable pageable) {
        Page<MenuItemDto> page = menuService.listItems(categoryId, branchId, pageable);
        return ResponseEntity.ok(ApiResponse.ok(page.getContent()));
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
}
