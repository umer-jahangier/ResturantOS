package io.restaurantos.pos.service;

import io.restaurantos.pos.dto.OrderDto;
import io.restaurantos.pos.dto.RefundRequest;

import java.util.UUID;

public interface RefundService {
    OrderDto refund(UUID orderId, RefundRequest request, String idempotencyKey);
}
