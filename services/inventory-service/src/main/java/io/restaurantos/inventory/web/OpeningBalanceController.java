package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.InventoryDtos.RecordOpeningBalanceRequest;
import io.restaurantos.inventory.service.OpeningBalanceService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Opening-balance recording (INV-07). Recording opening stock is a write — enforces
 * {@code inventory.item.manage} via {@link InventoryAuthorizationService}, exactly as the
 * master-data controllers do.
 */
@RestController
@RequestMapping("/api/v1/inventory/opening-balance")
@RequiresFeature("FEATURE_INVENTORY")
public class OpeningBalanceController {

    private final InventoryAuthorizationService authz;
    private final OpeningBalanceService openingBalanceService;

    public OpeningBalanceController(InventoryAuthorizationService authz,
                                     OpeningBalanceService openingBalanceService) {
        this.authz = authz;
        this.openingBalanceService = openingBalanceService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<Void>> record(
            @Valid @RequestBody RecordOpeningBalanceRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        openingBalanceService.recordOpeningBalance(request);
        return ResponseEntity.ok(ApiResponse.ok(null));
    }
}
