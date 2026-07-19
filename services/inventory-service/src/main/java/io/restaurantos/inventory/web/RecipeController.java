package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageResponse;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeDto;
import io.restaurantos.inventory.service.RecipeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Versioned recipe/BOM CRUD (INV-02). Every endpoint calls {@link InventoryAuthorizationService}
 * before touching data: reads require {@code inventory.item.view}, the create-version write
 * requires {@code inventory.item.manage} — the T-8-AC mitigation (real OPA enforcement, not just
 * the coarse {@code @RequiresFeature} gate).
 */
@RestController
@RequestMapping("/api/v1/inventory/recipes")
@RequiresFeature("FEATURE_INVENTORY")
public class RecipeController {

    private final InventoryAuthorizationService authz;
    private final RecipeService recipeService;

    public RecipeController(InventoryAuthorizationService authz, RecipeService recipeService) {
        this.authz = authz;
        this.recipeService = recipeService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<RecipeDto>> createVersion(
            @Valid @RequestBody CreateRecipeVersionRequest request, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(recipeService.createVersion(request)));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<RecipeDto>>> list(
            @RequestParam UUID menuItemId, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(recipeService.listVersions(menuItemId)));
    }

    @GetMapping("/{menuItemId}/effective")
    public ResponseEntity<ApiResponse<RecipeDto>> effective(
            @PathVariable UUID menuItemId, @RequestParam Instant at,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(recipeService.getEffectiveRecipe(menuItemId, at)));
    }

    /** INV-11: recipe-coverage report — which active catalog menu items currently lack an effective recipe. */
    @GetMapping("/coverage")
    public ResponseEntity<ApiResponse<CoverageResponse>> coverage(@AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(recipeService.getCoverage()));
    }
}
