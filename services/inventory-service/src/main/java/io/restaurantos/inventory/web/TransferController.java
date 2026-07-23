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
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Inter-branch stock transfers (INV-05). Ship and receive are both writes — enforces
 * {@code inventory.item.manage} via {@link InventoryAuthorizationService} on BOTH endpoints
 * (T-8-AC), mirroring {@code ReceiptController}/{@code KdsController}. {@code /pending} (08.2-17)
 * is a read — gated on {@code inventory.item.view}, mirroring {@code StockLevelController}'s
 * own-branch-only enforcement exactly (a caller can never list another branch's in-transit
 * transfers by passing a foreign {@code branchId}).
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

    /** 08.2-17: transfers SHIPPED to {@code branchId}, awaiting receive — the stock screen's
     * Transfer-receive list (UI-SPEC Screen 7). No consumer existed for this list before this
     * plan; ship/receive were write-only. */
    @GetMapping("/pending")
    public ResponseEntity<ApiResponse<List<TransferDto>>> pending(
            @RequestParam UUID branchId,
            @AuthenticationPrincipal JwtClaims claims) {
        authz.authorizeView(claims.tenantId(), claims.branchId());
        if (!branchId.equals(claims.branchId())) {
            throw new AccessDeniedException("Cannot read transfers for another branch");
        }
        return ResponseEntity.ok(ApiResponse.ok(transferService.listPendingForBranch(branchId)));
    }
}
