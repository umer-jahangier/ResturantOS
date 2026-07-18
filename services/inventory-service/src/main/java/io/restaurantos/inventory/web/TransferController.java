package io.restaurantos.inventory.web;

import io.restaurantos.inventory.authz.InventoryAuthorizationService;
import io.restaurantos.inventory.dto.TransferDtos.CreateTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.ReceiveTransferRequest;
import io.restaurantos.inventory.dto.TransferDtos.TransferDto;
import io.restaurantos.inventory.service.TransferService;
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
 * Inter-branch stock transfers (INV-05). Ship and receive are both writes — enforces
 * {@code inventory.item.manage} via {@link InventoryAuthorizationService} on BOTH endpoints
 * (T-8-AC), mirroring {@code ReceiptController}/{@code KdsController}.
 */
@RestController
@RequestMapping("/api/v1/inventory/transfers")
@RequiresFeature("FEATURE_INVENTORY")
public class TransferController {

    private final InventoryAuthorizationService authz;
    private final TransferService transferService;

    public TransferController(InventoryAuthorizationService authz, TransferService transferService) {
        this.authz = authz;
        this.transferService = transferService;
    }

    @PostMapping("/ship")
    public ResponseEntity<ApiResponse<TransferDto>> ship(
            @Valid @RequestBody CreateTransferRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(transferService.ship(request)));
    }

    @PostMapping("/receive")
    public ResponseEntity<ApiResponse<TransferDto>> receive(
            @Valid @RequestBody ReceiveTransferRequest request,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeManage(claims.tenantId(), claims.branchId());
        return ResponseEntity.ok(ApiResponse.ok(transferService.receive(request)));
    }
}
