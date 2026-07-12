package io.restaurantos.purchasing.web;

import io.restaurantos.purchasing.dto.ClosePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.CreatePurchaseOrderRequest;
import io.restaurantos.purchasing.dto.PurchaseOrderDto;
import io.restaurantos.purchasing.service.PoApprovalService;
import io.restaurantos.purchasing.service.PurchaseOrderService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/purchasing/purchase-orders")
@RequiresFeature("FEATURE_VENDOR")
public class PurchaseOrderController {

    private final PurchaseOrderService purchaseOrderService;
    private final PoApprovalService poApprovalService;

    public PurchaseOrderController(PurchaseOrderService purchaseOrderService,
                                   PoApprovalService poApprovalService) {
        this.purchaseOrderService = purchaseOrderService;
        this.poApprovalService = poApprovalService;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('vendor.po.create')")
    public ApiResponse<PurchaseOrderDto> create(@Valid @RequestBody CreatePurchaseOrderRequest req) {
        return ApiResponse.ok(purchaseOrderService.create(req));
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAuthority('vendor.view')")
    public ApiResponse<PurchaseOrderDto> get(@PathVariable UUID id) {
        return ApiResponse.ok(purchaseOrderService.get(id));
    }

    @PostMapping("/{id}/submit")
    @PreAuthorize("hasAuthority('vendor.po.create')")
    public ApiResponse<PurchaseOrderDto> submit(@PathVariable UUID id) {
        return ApiResponse.ok(purchaseOrderService.submit(id));
    }

    @PostMapping("/{id}/withdraw")
    @PreAuthorize("hasAuthority('vendor.po.create')")
    public ApiResponse<PurchaseOrderDto> withdraw(@PathVariable UUID id) {
        return ApiResponse.ok(purchaseOrderService.withdraw(id));
    }

    @PostMapping("/{id}/approve")
    @PreAuthorize("hasAuthority('vendor.po.approve')")
    public ApiResponse<PurchaseOrderDto> approve(@PathVariable UUID id) {
        return ApiResponse.ok(poApprovalService.approve(id));
    }

    @PostMapping("/{id}/reject")
    @PreAuthorize("hasAuthority('vendor.po.approve')")
    public ApiResponse<PurchaseOrderDto> reject(@PathVariable UUID id, @RequestBody Map<String, String> body) {
        return ApiResponse.ok(poApprovalService.reject(id, body.get("reason")));
    }

    @PostMapping("/{id}/send")
    @PreAuthorize("hasAuthority('vendor.po.send')")
    public ApiResponse<PurchaseOrderDto> send(@PathVariable UUID id) {
        return ApiResponse.ok(purchaseOrderService.send(id));
    }

    @PostMapping("/{id}/close")
    @PreAuthorize("hasAuthority('vendor.po.close')")
    public ApiResponse<PurchaseOrderDto> close(@PathVariable UUID id,
                                               @RequestBody(required = false) ClosePurchaseOrderRequest req) {
        return ApiResponse.ok(purchaseOrderService.close(id, req == null ? null : req.reason()));
    }
}
