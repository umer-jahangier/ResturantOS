package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiptResultDto;
import io.restaurantos.inventory.dto.ReceiptDtos.ReceiveStockRequest;
import io.restaurantos.inventory.service.ReceiptService;
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
 * Stock receipts (INV-04). Recording a receipt is a write — enforces
 * {@code inventory.item.manage} via {@link InventoryAuthorizationService} (T-8-AC), exactly as
 * {@code OpeningBalanceController}/{@code IngredientController} do.
 */
@RestController
@RequestMapping("/api/v1/inventory/receipts")
@RequiresFeature("FEATURE_INVENTORY")
public class ReceiptController {

    private final InventoryAuthorizationService authz;
    private final ReceiptService receiptService;

    public ReceiptController(InventoryAuthorizationService authz, ReceiptService receiptService) {
        this.authz = authz;
        this.receiptService = receiptService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<ReceiptResultDto>> receive(
            @Valid @RequestBody ReceiveStockRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(receiptService.receive(request)));
    }
}
