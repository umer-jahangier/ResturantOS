package io.restaurantos.pos.domain.enums;

/**
 * Derived (never client-set) payment status for an order — POS-23.
 * Computed server-side from {@code sum(OrderPayment.amountPaisa)} vs {@code Order.totalPaisa},
 * with REFUNDED overriding the sum whenever the order's settlement status is REFUNDED. See
 * {@link io.restaurantos.pos.service.PaymentStatusDerivationService#derive}.
 */
public enum PaymentStatus {
    UNPAID,
    PARTIALLY_PAID,
    PAID,
    REFUNDED
}
