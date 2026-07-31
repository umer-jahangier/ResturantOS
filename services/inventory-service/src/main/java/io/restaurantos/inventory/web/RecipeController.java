package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.RecipeDtos.CoverageResponse;
import io.restaurantos.inventory.dto.RecipeDtos.CreateRecipeVersionRequest;
import io.restaurantos.inventory.dto.RecipeDtos.PreviewRecipeCostRequest;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeCostPreviewDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeDto;
import io.restaurantos.inventory.dto.RecipeDtos.RecipeOptionDto;
import io.restaurantos.inventory.service.RecipeCostPreviewService;
import io.restaurantos.inventory.service.RecipeService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
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
    private final RecipeCostPreviewService recipeCostPreviewService;

    public RecipeController(InventoryAuthorizationService authz, RecipeService recipeService,
                             RecipeCostPreviewService recipeCostPreviewService) {
        this.authz = authz;
        this.recipeService = recipeService;
        this.recipeCostPreviewService = recipeCostPreviewService;
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

    /**
     * The option list behind the ingredient form's "Produced by" picker — one entry per menu item's
     * current recipe version. Gated on {@code authorizeView} rather than {@code authorizeManage}
     * (unlike {@code /preview} below) because it carries names and versions only, no costs.
     */
    @GetMapping("/options")
    public ResponseEntity<ApiResponse<List<RecipeOptionDto>>> options(@AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(recipeService.listOptions()));
    }

    /** INV-11: recipe-coverage report — which active catalog menu items currently lack an effective recipe. */
    @GetMapping("/coverage")
    public ResponseEntity<ApiResponse<CoverageResponse>> coverage(@AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(recipeService.getCoverage()));
    }

    /**
     * INV-15: non-persisting plate-cost preview for the live cost panel (08.2-UI-SPEC.md
     * Screen 3). Gated on {@code inventory.item.manage} — not {@code authorizeView} — because
     * per-ingredient moving-average cost is commercially sensitive (T-08.2-071) and this endpoint
     * is only ever reached from the recipe authoring surface, which already requires manage.
     * {@code branchId} selects which branch's costs are read and must equal the caller's JWT
     * branch claim (T-08.2-072) — never caller-chosen, mirroring
     * {@code StockLevelController}'s guard.
     */
    @PostMapping("/preview")
    public ResponseEntity<ApiResponse<RecipeCostPreviewDto>> preview(
            @Valid @RequestBody PreviewRecipeCostRequest request, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        if (!request.branchId().equals(claims.branchId())) {
            throw new AccessDeniedException("Cannot preview recipe cost for another branch");
        }
        return ResponseEntity.ok(ApiResponse.ok(recipeCostPreviewService.preview(request)));
    }
}
