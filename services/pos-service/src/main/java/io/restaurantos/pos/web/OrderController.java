package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.OrderSettlementDetailService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/pos/orders")
@RequiresFeature("FEATURE_POS")
public class OrderController {

    private final OrderService orderService;
    private final RefundService refundService;
    private final OrderSettlementDetailService orderSettlementDetailService;

    public OrderController(OrderService orderService,
                           RefundService refundService,
                           OrderSettlementDetailService orderSettlementDetailService) {
        this.orderService = orderService;
        this.refundService = refundService;
        this.orderSettlementDetailService = orderSettlementDetailService;
    }

    @PreAuthorize("hasAuthority('pos.order.create')")
    @PostMapping
    public ResponseEntity<ApiResponse<OrderDto>> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(orderService.createOrder(request)));
    }

    @PreAuthorize("hasAuthority('pos.order.view')")
    @GetMapping
    public ResponseEntity<ApiResponse<List<OrderSummaryDto>>> listOrders(
            @RequestParam UUID branchId,
            @RequestParam(required = false) List<String> status,
            Pageable pageable) {
        Page<OrderSummaryDto> page = orderService.listOrderSummaries(branchId, status, pageable);
        // S0-04: attach WHY and BY WHOM for the VOIDED/REFUNDED rows on this page. A no-op (no
        // extra query at all) for a page of live orders, which is why it sits here as a second
        // pass rather than inside the row builder on the till's hot list path.
        List<OrderSummaryDto> rows = orderSettlementDetailService.withSettlementDetail(page.getContent());
        return ResponseEntity.ok(ApiResponse.paginated(rows, new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements())));
    }

    @PreAuthorize("hasAuthority('pos.order.view')")
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<OrderDto>> getOrder(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.getOrder(id, branchId)));
    }

    @PreAuthorize("hasAuthority('pos.order.update')")
    @PostMapping("/{id}/items")
    public ResponseEntity<ApiResponse<OrderDto>> addItem(
            @PathVariable UUID id,
            @Valid @RequestBody AddOrderItemRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.addItem(id, request)));
    }

    @PreAuthorize("hasAuthority('pos.order.update')")
    @DeleteMapping("/{id}/items/{itemId}")
    public ResponseEntity<ApiResponse<OrderDto>> removeItem(
            @PathVariable UUID id,
            @PathVariable UUID itemId) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.removeItem(id, itemId)));
    }

    /**
     * CRM-04: evaluate and apply the customer's qualifying promotions. Explicit rather than
     * automatic on every price change — a discount a cashier cannot explain is worse than none.
     *
     * <p>Gated on {@code pos.order.discount.order}: the engine produces an ORDER-scoped discount,
     * so it requires the same permission as applying one by hand.
     */
    @PostMapping("/{id}/promotions/apply")
    @PreAuthorize("hasAuthority('pos.order.discount.order')")
    public ResponseEntity<ApiResponse<OrderDto>> applyPromotions(@PathVariable UUID id) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.applyPromotions(id)));
    }

    @PreAuthorize("hasAuthority('pos.order.discount.line')")
    @PostMapping("/{id}/discounts")
    public ResponseEntity<ApiResponse<OrderDto>> applyDiscount(
            @PathVariable UUID id,
            @Valid @RequestBody ApplyDiscountRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.applyDiscount(id, request)));
    }

    @PreAuthorize("hasAuthority('pos.order.send_to_kds')")
    @PostMapping("/{id}/send-to-kds")
    public ResponseEntity<ApiResponse<OrderDto>> sendToKds(
            @PathVariable UUID id,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.sendToKds(id, idempotencyKey)));
    }

    @PreAuthorize("hasAnyAuthority('pos.order.void.own','pos.order.void.any')")
    @PostMapping("/{id}/void")
    public ResponseEntity<ApiResponse<OrderDto>> voidOrder(
            @PathVariable UUID id,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody VoidOrderRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.voidOrder(id, request, idempotencyKey)));
    }

    @PreAuthorize("hasAuthority('pos.order.refund')")
    @PostMapping("/{id}/refund")
    public ResponseEntity<ApiResponse<OrderDto>> refundOrder(
            @PathVariable UUID id,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody RefundRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(refundService.refund(id, request, idempotencyKey)));
    }

    @PreAuthorize("hasAuthority('pos.order.update')")
    @PatchMapping("/{id}/instructions")
    public ResponseEntity<ApiResponse<OrderDto>> updateInstructions(
            @PathVariable UUID id,
            @Valid @RequestBody UpdateInstructionsRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.updateInstructions(id, request)));
    }

    @PreAuthorize("hasAuthority('pos.order.update')")
    @PostMapping("/{id}/items/{itemId}/serve")
    public ResponseEntity<ApiResponse<OrderDto>> markItemServed(
            @PathVariable UUID id,
            @PathVariable UUID itemId) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.markItemServed(id, itemId)));
    }

    @PreAuthorize("hasAuthority('pos.order.update')")
    @PostMapping("/{id}/items/{itemId}/cancel")
    public ResponseEntity<ApiResponse<OrderDto>> cancelItem(
            @PathVariable UUID id,
            @PathVariable UUID itemId) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.cancelItem(id, itemId)));
    }

    @PreAuthorize("hasAuthority('pos.order.update')")
    @PatchMapping("/{id}/table")
    public ResponseEntity<ApiResponse<OrderDto>> assignTable(
            @PathVariable UUID id,
            @Valid @RequestBody AssignTableRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.assignTable(id, request.tableId())));
    }
}
