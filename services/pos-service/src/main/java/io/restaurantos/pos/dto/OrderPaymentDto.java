package io.restaurantos.pos.dto;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.domain.model.OrderPayment;
import io.restaurantos.pos.domain.model.OrderRefund;

import java.time.Instant;
import java.util.UUID;

/**
 * Read-model for one money row on an order — POS-22/POS-23 payments-history endpoint.
 * {@code method} is the payment method name as a String (mirrors
 * {@code PosClosePayloads.PaymentEntry} and {@code SplitTenderCalculator.PaymentEntry}'s wire
 * shape), never the enum directly.
 *
 * <p><b>S0-01: the history is now tenders AND their reversals.</b> It used to return
 * {@code order_payments} alone, so after a refund the endpoint still showed a live payment and
 * nothing giving it back — the same picture a voided-but-paid order showed, which is precisely
 * how money went missing without any screen contradicting itself. A refund row is returned with
 * {@code kind = REFUND} and a NEGATIVE {@code amountPaisa}, so the naive
 * {@code payments.reduce(sum)} every caller already does yields the NET amount held against the
 * order without any caller having to learn about a second collection.
 */
public record OrderPaymentDto(
        UUID id,
        String method,
        long amountPaisa,
        /**
         * Money taken on top of the bill for the staff (F20). Separate from {@code amountPaisa} on
         * the wire for the same reason it is separate in the database: a caller summing
         * {@code amountPaisa} is asking what settled the bill, and a tip settles none of it.
         */
        long tipPaisa,
        long tenderedPaisa,
        long changePaisa,
        String referenceNo,
        Instant recordedAt,
        /** {@code PAYMENT} for a tender taken, {@code REFUND} for money given back. */
        String kind
) {
    public static final String KIND_PAYMENT = "PAYMENT";
    public static final String KIND_REFUND = "REFUND";

    public static OrderPaymentDto from(OrderPayment payment) {
        return new OrderPaymentDto(
                payment.getId(),
                payment.getMethod().name(),
                payment.getAmountPaisa(),
                payment.getTipPaisa(),
                payment.getTenderedPaisa(),
                payment.getChangePaisa(),
                payment.getReferenceNo(),
                payment.getRecordedAt(),
                KIND_PAYMENT
        );
    }

    /**
     * A refund rendered as a reversing row. The amount is negative because that is what makes it
     * a reversal rather than a second charge; {@code tenderedPaisa} mirrors it (cash handed back
     * IS the tender here) and {@code changePaisa} is zero — there is no change on a refund.
     *
     * <p>{@code method} falls back to CASH for rows written before V20 added the column: an
     * unknown refund most likely came out of the drawer, and the migration documents that this
     * is the deliberate safe direction.
     */
    public static OrderPaymentDto reversalOf(OrderRefund refund) {
        PaymentMethod method = refund.getMethod() != null ? refund.getMethod() : PaymentMethod.CASH;
        return new OrderPaymentDto(
                refund.getId(),
                method.name(),
                -refund.getRefundPaisa(),
                // A refund reverses the BILL. It never claws a tip back out of the staff's
                // liability — that is a different decision, made by a person, and the product does
                // not have it. Always zero here rather than apportioned.
                0L,
                -refund.getRefundPaisa(),
                0L,
                refund.getReason(),
                refund.getCreatedAt(),
                KIND_REFUND
        );
    }
}
