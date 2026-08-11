package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.InventoryDtos.CreateUomRequest;
import io.restaurantos.inventory.dto.InventoryDtos.UomDto;
import io.restaurantos.inventory.dto.InventoryDtos.UpdateUomRequest;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

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

    /**
     * @param includeRetired the SETUP screen passes true so a retired unit is shown AS retired
     *        rather than vanishing with no explanation of where it went. Every picker leaves it
     *        false. The conversion paths do not come through here at all — see
     *        {@code IngredientService#listUoms(boolean)}.
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<UomDto>>> list(
            @RequestParam(name = "includeRetired", defaultValue = "false") boolean includeRetired,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.listUoms(includeRetired)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<UomDto>> create(
            @Valid @RequestBody CreateUomRequest request, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.createUom(request)));
    }

    /**
     * Correct a unit. The CODE is not in {@link UpdateUomRequest} and cannot be changed: it is a
     * foreign key by value into ingredients, conversion rows and another service's vendor catalog,
     * and nothing can follow those references backwards. Correcting a code is a retire-and-recreate.
     */
    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<UomDto>> update(
            @PathVariable UUID id, @Valid @RequestBody UpdateUomRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.updateUom(id, request)));
    }

    /** Retire — never delete. Refused, with a reference breakdown, while anything still names it. */
    @PostMapping("/{id}/archive")
    public ResponseEntity<ApiResponse<UomDto>> archive(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.archiveUom(id)));
    }

    @PostMapping("/{id}/restore")
    public ResponseEntity<ApiResponse<UomDto>> restore(
            @PathVariable UUID id, @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(ingredientService.restoreUom(id)));
    }
}
