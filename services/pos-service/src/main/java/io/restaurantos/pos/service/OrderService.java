package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.model.Order;
import io.restaurantos.pos.dto.AddOrderItemRequest;
import io.restaurantos.pos.dto.ApplyDiscountRequest;
import io.restaurantos.pos.dto.CreateOrderRequest;
import io.restaurantos.pos.dto.OrderDto;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.UUID;

public interface OrderService {
    OrderDto createOrder(CreateOrderRequest request);
    OrderDto addItem(UUID orderId, AddOrderItemRequest request);
    OrderDto removeItem(UUID orderId, UUID itemId);
    OrderDto applyDiscount(UUID orderId, ApplyDiscountRequest request);
    OrderDto sendToKds(UUID orderId);
    OrderDto getOrder(UUID orderId, UUID branchId);
    Page<OrderDto> listOrders(UUID branchId, List<String> statuses, Pageable pageable);
}
