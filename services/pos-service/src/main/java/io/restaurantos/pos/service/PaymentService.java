package io.restaurantos.pos.service;

import io.restaurantos.pos.domain.enums.PaymentMethod;
import io.restaurantos.pos.dto.OrderPaymentDto;

import java.util.List;
import java.util.UUID;

public interface PaymentService {

    /**
     * Record a single payment against an order, with the customer's tender.
     *
     * <p>{@code amountPaisa} is what the caller wants applied to the bill; it is capped at the
     * outstanding balance. {@code tenderedPaisa} is what the customer handed over — pass
     * {@code null} for "exactly the applied amount", which is the right answer for every
     * card/bank/voucher tender and for exact cash.
     *
     * <p>Over-tender is CASH-only and becomes change. A non-cash tender above the outstanding
     * balance is rejected ({@code PaymentExceedsBalanceException}, 422) rather than silently
     * over-applied: ORDER_CLOSED carries the applied amounts and finance debits them, so an
     * over-application makes the revenue journal entry unbalanceable.
     *
     * <p>{@code tipPaisa} is money taken ON TOP of the bill for the staff (F20). It is never
     * applied to the balance, never part of {@code orders.totalPaisa}, and never revenue — finance
     * credits it to a Tips Payable liability. It IS counted into the drawer at till close, because
     * the cash is physically there.
     *
     * @return the updated sum of APPLIED payments for the order
     */
    long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa, Long tenderedPaisa,
                       String referenceNo, UUID customerAccountId, long tipPaisa);

    /** No tip — the overwhelming majority of tenders, and every pre-F20 caller. */
    default long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa,
                               Long tenderedPaisa, String referenceNo, UUID customerAccountId) {
        return recordPayment(orderId, method, amountPaisa, tenderedPaisa, referenceNo,
                customerAccountId, 0L);
    }

    /** Every tender except CHARGE_TO_ACCOUNT, which needs a house account to bill. */
    default long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa,
                               Long tenderedPaisa, String referenceNo) {
        return recordPayment(orderId, method, amountPaisa, tenderedPaisa, referenceNo, null, 0L);
    }

    /** Exact-tender convenience — {@code tenderedPaisa == amountPaisa}. */
    default long recordPayment(UUID orderId, PaymentMethod method, long amountPaisa, String referenceNo) {
        return recordPayment(orderId, method, amountPaisa, null, referenceNo);
    }

    /**
     * List the persisted payment history for an order (POS-22/POS-23), tenant-scoped exactly
     * as {@link #recordPayment} — throws {@code OrderNotFoundException} (404) if the order does
     * not belong to the caller's tenant.
     */
    List<OrderPaymentDto> listPayments(UUID orderId);
}
