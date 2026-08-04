package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.WastageDtos.RecordWastageRequest;
import io.restaurantos.inventory.dto.WastageDtos.WastageDto;
import io.restaurantos.inventory.service.WastageService;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * Recording stock write-offs (INV-06). Gated exactly as stock counts are — writing stock off is a
 * manage-level action, and it posts to the general ledger.
 */
@RestController
@RequestMapping("/api/v1/inventory/wastage")
@RequiresFeature("FEATURE_INVENTORY")
public class WastageController {

    private final InventoryAuthorizationService authz;
    private final WastageService wastageService;

    public WastageController(InventoryAuthorizationService authz, WastageService wastageService) {
        this.authz = authz;
        this.wastageService = wastageService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<WastageDto>> record(
            @Valid @RequestBody RecordWastageRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(wastageService.record(request)));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<WastageDto>>> list(
            @RequestParam UUID branchId,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(wastageService.list(branchId)));
    }
}
