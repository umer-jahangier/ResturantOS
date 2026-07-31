package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.ItemCategoryDtos.CreateItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ItemCategoryDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.ItemCategoryNodeDto;
import io.restaurantos.inventory.dto.ItemCategoryDtos.MoveItemCategoryRequest;
import io.restaurantos.inventory.dto.ItemCategoryDtos.UpdateItemCategoryRequest;
import io.restaurantos.inventory.service.ItemCategoryService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Item-category tree CRUD, re-parent and archive/restore (INV-13). Every endpoint calls
 * {@link InventoryAuthorizationService} before touching data: reads require
 * {@code inventory.item.view}, writes require {@code inventory.item.manage} — no new permission
 * code is introduced (CONTEXT.md's constraints). Archive/restore are POST sub-resources, not
 * {@code DELETE} — the API surface itself communicates that nothing is destroyed (D-04).
 */
@RestController
@RequestMapping("/api/v1/inventory/categories")
@RequiresFeature("FEATURE_INVENTORY")
public class ItemCategoryController {

    private final InventoryAuthorizationService authz;
    private final ItemCategoryService itemCategoryService;

    public ItemCategoryController(InventoryAuthorizationService authz, ItemCategoryService itemCategoryService) {
        this.authz = authz;
        this.itemCategoryService = itemCategoryService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<ItemCategoryDto>>> list(
            @RequestParam(defaultValue = "false") boolean includeArchived,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.listCategories(includeArchived)));
    }

    @GetMapping("/tree")
    public ResponseEntity<ApiResponse<List<ItemCategoryNodeDto>>> tree(
            @RequestParam(defaultValue = "false") boolean includeArchived,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.getTree(includeArchived)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<ItemCategoryDto>> get(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.getCategory(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<ItemCategoryDto>> create(
            @Valid @RequestBody CreateItemCategoryRequest request, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.create(request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<ItemCategoryDto>> update(
            @PathVariable UUID id, @Valid @RequestBody UpdateItemCategoryRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.update(id, request)));
    }

    @PutMapping("/{id}/parent")
    public ResponseEntity<ApiResponse<ItemCategoryDto>> move(
            @PathVariable UUID id, @Valid @RequestBody MoveItemCategoryRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.move(id, request)));
    }

    @PostMapping("/{id}/archive")
    public ResponseEntity<ApiResponse<ItemCategoryDto>> archive(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        itemCategoryService.archive(id);
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.getCategory(id)));
    }

    @PostMapping("/{id}/restore")
    public ResponseEntity<ApiResponse<ItemCategoryDto>> restore(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        itemCategoryService.restore(id);
        return ResponseEntity.ok(ApiResponse.ok(itemCategoryService.getCategory(id)));
    }
}
