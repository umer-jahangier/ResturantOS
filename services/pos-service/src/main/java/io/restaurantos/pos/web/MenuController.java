package io.restaurantos.pos.web;

import io.restaurantos.pos.domain.model.MenuCategory;
import io.restaurantos.pos.dto.MenuItemDto;
import io.restaurantos.pos.service.MenuService;
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
    public ResponseEntity<List<MenuCategory>> listCategories() {
        return ResponseEntity.ok(menuService.listCategories());
    }

    @GetMapping("/items")
    public ResponseEntity<Page<MenuItemDto>> listItems(
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(required = false) UUID branchId,
            Pageable pageable) {
        return ResponseEntity.ok(menuService.listItems(categoryId, branchId, pageable));
    }

    @GetMapping("/items/{id}")
    public ResponseEntity<MenuItemDto> getItem(
            @PathVariable UUID id,
            @RequestParam(required = false) UUID branchId) {
        return ResponseEntity.ok(menuService.getItem(id, branchId));
    }
}
