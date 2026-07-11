package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.ApplyDiscountRequest;
import io.restaurantos.pos.dto.CloseOrderRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.UpdateInstructionsRequest;
import io.restaurantos.pos.dto.VoidOrderRequest;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface OrderService {
    OrderDto createOrder(CreateOrderRequest request);
    OrderDto addItem(UUID orderId, AddOrderItemRequest request);
    OrderDto removeItem(UUID orderId, UUID itemId);
    OrderDto applyDiscount(UUID orderId, ApplyDiscountRequest request);
    OrderDto sendToKds(UUID orderId, String clientFireId);
    OrderDto getOrder(UUID orderId, UUID branchId);
    Page<OrderDto> listOrders(UUID branchId, List<String> statuses, Pageable pageable);
    OrderDto closeOrder(UUID orderId, CloseOrderRequest request, String idempotencyKey);
    OrderDto voidOrder(UUID orderId, VoidOrderRequest request, String idempotencyKey);
    OrderDto markItemServed(UUID orderId, UUID itemId);
    OrderDto cancelItem(UUID orderId, UUID itemId);
    OrderDto updateInstructions(UUID orderId, UpdateInstructionsRequest request);
}
