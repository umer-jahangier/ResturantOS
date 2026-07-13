package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.model.OrderPayment;

import java.time.Instant;
import java.util.UUID;

/**
 * Read-model for a persisted {@link OrderPayment} row — POS-22/POS-23 payments-history
 * endpoint. {@code method} is the payment method name as a String (mirrors
 * {@code PosClosePayloads.PaymentEntry} and {@code SplitTenderCalculator.PaymentEntry}'s wire
 * shape), never the enum directly.
 */
public record OrderPaymentDto(
        UUID id,
        String method,
        long amountPaisa,
        String referenceNo,
        Instant recordedAt
) {
    public static OrderPaymentDto from(OrderPayment payment) {
        return new OrderPaymentDto(
                payment.getId(),
                payment.getMethod().name(),
                payment.getAmountPaisa(),
                payment.getReferenceNo(),
                payment.getRecordedAt()
        );
    }
}
