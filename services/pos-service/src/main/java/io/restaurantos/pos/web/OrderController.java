package io.restaurantos.pos.web;

import io.restaurantos.pos.dto.*;
import io.restaurantos.pos.service.OrderService;
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

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    public ResponseEntity<OrderDto> createOrder(@Valid @RequestBody CreateOrderRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(orderService.createOrder(request));
    }

    @GetMapping
    public ResponseEntity<Page<OrderDto>> listOrders(
            @RequestParam UUID branchId,
            @RequestParam(required = false) List<String> status,
            Pageable pageable) {
        return ResponseEntity.ok(orderService.listOrders(branchId, status, pageable));
    }

    @GetMapping("/{id}")
    public ResponseEntity<OrderDto> getOrder(
            @PathVariable UUID id,
            @RequestParam UUID branchId) {
        return ResponseEntity.ok(orderService.getOrder(id, branchId));
    }

    @PostMapping("/{id}/items")
    public ResponseEntity<OrderDto> addItem(
            @PathVariable UUID id,
            @Valid @RequestBody AddOrderItemRequest request) {
        return ResponseEntity.ok(orderService.addItem(id, request));
    }

    @DeleteMapping("/{id}/items/{itemId}")
    public ResponseEntity<OrderDto> removeItem(
            @PathVariable UUID id,
            @PathVariable UUID itemId) {
        return ResponseEntity.ok(orderService.removeItem(id, itemId));
    }

    @PostMapping("/{id}/discounts")
    public ResponseEntity<OrderDto> applyDiscount(
            @PathVariable UUID id,
            @Valid @RequestBody ApplyDiscountRequest request) {
        return ResponseEntity.ok(orderService.applyDiscount(id, request));
    }

    @PostMapping("/{id}/send-to-kds")
    public ResponseEntity<OrderDto> sendToKds(@PathVariable UUID id) {
        return ResponseEntity.ok(orderService.sendToKds(id));
    }
}
