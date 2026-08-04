package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
import io.restaurantos.inventory.dto.InventoryDtos.UomDto;
import io.restaurantos.inventory.service.IngredientService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Unit-of-measure master data (INV-01). Same OPA-enforcement shape as {@link IngredientController}:
 * reads require {@code inventory.item.view}, writes require {@code inventory.item.manage}.
 */
@RestController
@RequestMapping("/api/v1/inventory/uom")
@RequiresFeature("FEATURE_INVENTORY")
public class UnitOfMeasureController {

    private final InventoryAuthorizationService authz;
    private final IngredientService ingredientService;

    public UnitOfMeasureController(InventoryAuthorizationService authz, IngredientService ingredientService) {
        this.authz = authz;
        this.ingredientService = ingredientService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<UomDto>>> list(@AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.listUoms()));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<UomDto>> create(
            @Valid @RequestBody CreateUomRequest request, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.createUom(request)));
    }
}
