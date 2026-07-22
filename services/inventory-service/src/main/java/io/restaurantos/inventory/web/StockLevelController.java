package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.StockLevelDtos.StockLevelsResponse;
import io.restaurantos.inventory.service.StockLevelService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import io.restaurantos.shared.security.JwtClaims;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * Read-only on-hand stock projection per branch (INV-15) — {@code ingredient_branch_stock}'s
 * first read path; until now receipts/transfers/counts/opening-balance were write-only. Gated on
 * {@code inventory.item.view} via {@link InventoryAuthorizationService} (the T-8-AC mitigation,
 * OPA seam) — this module authorizes through that seam only, no method-security annotation.
 * {@code branchId} is never trusted as the source of truth: it must equal the caller's JWT
 * branch claim or the request is refused before any data is read (T-08.2-021).
 */
@RestController
@RequestMapping("/api/v1/inventory/stock")
@RequiresFeature("FEATURE_INVENTORY")
public class StockLevelController {

    private final InventoryAuthorizationService authz;
    private final StockLevelService stockLevelService;

    public StockLevelController(InventoryAuthorizationService authz, StockLevelService stockLevelService) {
        this.authz = authz;
        this.stockLevelService = stockLevelService;
    }

    @GetMapping
    public ResponseEntity<ApiResponse<StockLevelsResponse>> list(
            @RequestParam UUID branchId,
            @RequestParam(required = false) String search,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        if (!branchId.equals(claims.branchId())) {
            throw new AccessDeniedException("Cannot read stock levels for another branch");
        }
        return ResponseEntity.ok(ApiResponse.ok(stockLevelService.listStockLevels(branchId, search)));
    }
}
