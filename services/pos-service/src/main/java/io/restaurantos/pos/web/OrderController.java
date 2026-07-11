package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.service.OrderService;
import io.restaurantos.pos.service.RefundService;
import io.restaurantos.shared.api.ApiResponse;
import io.restaurantos.shared.api.PageMeta;
import io.restaurantos.shared.feature.RequiresFeature;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpStatus;
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

    public OrderController(OrderService orderService, RefundService refundService) {
        this.orderService = orderService;
        this.refundService = refundService;
    }

    @PostMapping
    public ResponseEntity<ApiResponse<OrderDto>> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(orderService.createOrder(request)));
    }

    @GetMapping
    public ResponseEntity<ApiResponse<List<OrderDto>>> listOrders(
            @RequestParam UUID branchId,
            @RequestParam(required = false) List<String> status,
            Pageable pageable) {
        Page<OrderDto> page = orderService.listOrders(branchId, status, pageable);
        return ResponseEntity.ok(ApiResponse.paginated(page.getContent(), new PageMeta(
                new PageMeta.Page(
                        String.valueOf(page.getNumber()),
                        page.hasNext() ? String.valueOf(page.getNumber() + 1) : null,
                        page.getSize()),
                page.getTotalElements())));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<OrderDto>> getOrder(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.getOrder(id, branchId)));
    }

    @PostMapping("/{id}/items")
    public ResponseEntity<ApiResponse<OrderDto>> addItem(
            @PathVariable UUID id,
            @Valid @RequestBody AddOrderItemRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.addItem(id, request)));
    }

    @DeleteMapping("/{id}/items/{itemId}")
    public ResponseEntity<ApiResponse<OrderDto>> removeItem(
            @PathVariable UUID id,
            @PathVariable UUID itemId) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.removeItem(id, itemId)));
    }

    @PostMapping("/{id}/discounts")
    public ResponseEntity<ApiResponse<OrderDto>> applyDiscount(
            @PathVariable UUID id,
            @Valid @RequestBody ApplyDiscountRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.applyDiscount(id, request)));
    }

    @PostMapping("/{id}/send-to-kds")
    public ResponseEntity<ApiResponse<OrderDto>> sendToKds(
            @PathVariable UUID id,
            @RequestHeader(value = "Idempotency-Key", required = false) String idempotencyKey) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.sendToKds(id, idempotencyKey)));
    }

    @PostMapping("/{id}/void")
    public ResponseEntity<ApiResponse<OrderDto>> voidOrder(
            @PathVariable UUID id,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody VoidOrderRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(orderService.voidOrder(id, request, idempotencyKey)));
    }

    @PostMapping("/{id}/refund")
    public ResponseEntity<ApiResponse<OrderDto>> refundOrder(
            @PathVariable UUID id,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody RefundRequest request) {
        return ResponseEntity.ok(ApiResponse.ok(refundService.refund(id, request, idempotencyKey)));
    }
}
