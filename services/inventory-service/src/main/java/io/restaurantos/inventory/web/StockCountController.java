package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.StockCountDtos.CreateStockCountRequest;
import io.restaurantos.inventory.dto.StockCountDtos.StockCountDto;
import io.restaurantos.inventory.service.StockCountService;
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
 * Stock counts with variance posting (INV-06). Posting a count is a write — enforces
 * {@code inventory.item.manage} via {@link InventoryAuthorizationService} (T-8-AC), exactly as
 * {@code TransferController}/{@code ReceiptController} do.
 */
@RestController
@RequestMapping("/api/v1/inventory/counts")
@RequiresFeature("FEATURE_INVENTORY")
public class StockCountController {

    private final InventoryAuthorizationService authz;
    private final StockCountService stockCountService;

    public StockCountController(InventoryAuthorizationService authz, StockCountService stockCountService) {
        this.authz = authz;
        this.stockCountService = stockCountService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<StockCountDto>> postCount(
            @Valid @RequestBody CreateStockCountRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(stockCountService.postCount(request)));
    }
}
