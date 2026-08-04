package io.restaurantos.pos.domain.enums;

public enum PaymentMethod {
    CASH,
    CARD,
    LOYALTY_POINTS,
    BANK_TRANSFER,
    VOUCHER,
    /**
     * Charge to a corporate/house account rather than settling now (FIN-05 SC7).
     *
     * <p>Unlike every other method, this one has a side effect outside pos-service: the tender is
     * only valid if finance-service accepts the receivable, so {@code PaymentServiceImpl} calls
     * the AR seam BEFORE persisting the payment and surfaces a refusal as a tender failure. The
     * order stays open on refusal — it is never closed against a charge that was declined.
     */
    CHARGE_TO_ACCOUNT
}
