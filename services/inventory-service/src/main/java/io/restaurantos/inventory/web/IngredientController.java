package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.InventoryDtos.CreateIngredientRequest;
import io.restaurantos.inventory.dto.InventoryDtos.IngredientDto;
import io.restaurantos.inventory.dto.InventoryDtos.UpdateIngredientRequest;
import io.restaurantos.inventory.service.IngredientService;
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
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Ingredient master-data CRUD (INV-01). Every endpoint calls {@link InventoryAuthorizationService}
 * before touching data: reads require {@code inventory.item.view}, writes require
 * {@code inventory.item.manage} — the T-8-AC mitigation (real OPA enforcement, not just the coarse
 * {@code @RequiresFeature} gate).
 */
@RestController
@RequestMapping("/api/v1/inventory/ingredients")
@RequiresFeature("FEATURE_INVENTORY")
public class IngredientController {

    private final InventoryAuthorizationService authz;
    private final IngredientService ingredientService;

    public IngredientController(InventoryAuthorizationService authz, IngredientService ingredientService) {
        this.authz = authz;
        this.ingredientService = ingredientService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<IngredientDto>>> list(@AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.listIngredients()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<IngredientDto>> get(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.getIngredient(id)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<IngredientDto>> create(
            @Valid @RequestBody CreateIngredientRequest request, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.createIngredient(request)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<IngredientDto>> update(
            @PathVariable UUID id, @Valid @RequestBody UpdateIngredientRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.updateIngredient(id, request)));
    }
}
