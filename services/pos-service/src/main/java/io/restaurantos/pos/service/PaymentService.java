package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.PaymentMethod;

import java.util.UUID;

public interface PaymentService {

    /**
     * Record a single payment against an order.
     * Returns the updated sum of all payments for the order.
     */
    long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa, String referenceNo);
}
