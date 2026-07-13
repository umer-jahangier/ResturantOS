package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.dto.OrderPaymentDto;

import java.util.List;
import java.util.UUID;

public interface PaymentService {

    /**
     * Record a single payment against an order.
     * Returns the updated sum of all payments for the order.
     */
    long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa, String referenceNo);

    /**
     * List the persisted payment history for an order (POS-22/POS-23), tenant-scoped exactly
     * as {@link #recordPayment} — throws {@code OrderNotFoundException} (404) if the order does
     * not belong to the caller's tenant.
     */
    List<OrderPaymentDto> listPayments(UUID orderId);
}
